import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError } from "@/lib/protocol";
import { useCall } from "@/store/servers";
import { useCallChannelPermissions } from "@/store/selectors";
import { MusicIcon, SoundboardIcon } from "./Icons";

/**
 * The soundboard: the clips this server carries, played at the channel the
 * reader is sitting in.
 *
 * It reads the connection carrying the call rather than the one on screen, for
 * the same reason the voice strip above it does: a call outlives looking at the
 * server it is on, and pressing a button has to play into the room you are
 * actually in.
 *
 * Nothing is mixed into anybody's microphone. Pressing a pad asks the server,
 * the server tells everybody in the channel, and each client plays the clip
 * into its own output — so it sounds the same to everybody, it works the same
 * whoever is relaying the call, and being deafened silences it exactly as it
 * silences everything else.
 */
export function SoundboardPanel({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const sounds = useCall((state) => state.sounds);
  const playSound = useCall((state) => state.playSound);
  const self = useCall((state) => state.self);
  const channelId = self?.channelId ?? null;

  const permissions = useCallChannelPermissions(channelId);
  const allowed = has(permissions, Perm.UseSoundboard);

  const [error, setError] = useState<string | null>(null);
  // Which pad is lit, and for how long. It is the only feedback there is that
  // a press did anything: the sound itself arrives over the same round trip
  // everybody else's copy does.
  const [pressed, setPressed] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const list = useMemo(() => [...sounds.values()], [sounds]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (panel.current && !panel.current.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function press(soundId: number, durationMs: number) {
    setError(null);
    setPressed(soundId);
    if (timer.current) clearTimeout(timer.current);
    // Lit for as long as the clip runs, bounded so a pad never sticks on.
    timer.current = setTimeout(() => setPressed(null), Math.min(Math.max(durationMs, 300), 10_000));

    try {
      await playSound(soundId);
    } catch (failure) {
      setPressed(null);
      setError(describeError(failure));
    }
  }

  return (
    <div className="soundboard" ref={panel} role="dialog" aria-label={t("soundboard.title")}>
      <header className="soundboard__head">
        <SoundboardIcon size={14} />
        <span className="soundboard__title">{t("soundboard.title")}</span>
        <span className="soundboard__count">{list.length}</span>
      </header>

      {error ? <p className="soundboard__error">{error}</p> : null}

      {!allowed ? (
        <p className="soundboard__empty">{t("soundboard.notAllowed")}</p>
      ) : list.length === 0 ? (
        <p className="soundboard__empty">{t("soundboard.empty")}</p>
      ) : (
        <div className="soundboard__grid">
          {list.map((sound) => (
            <button
              key={sound.id}
              type="button"
              className={
                pressed === sound.id ? "soundboard__pad soundboard__pad--playing" : "soundboard__pad"
              }
              onClick={() => void press(sound.id, sound.durationMs)}
              title={sound.name}
            >
              <span className="soundboard__pad-icon" aria-hidden="true">
                {sound.emoji || <MusicIcon size={16} />}
              </span>
              <span className="soundboard__pad-name">{sound.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
