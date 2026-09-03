import { useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError, type Sound } from "@/lib/protocol";
import { playSoundClip, stopAllSounds } from "@/lib/soundboard";
import { formatBytes, parseBytes, serverOrigin } from "@/lib/uploads";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { MusicIcon, PlayIcon, SoundboardIcon, TrashIcon, UploadIcon } from "../../Icons";
import { ConfirmDialog } from "../ConfirmDialog";
import { SoundTrimDialog } from "./SoundTrimDialog";

/**
 * The soundboard's management screen: what the server carries, and the way to
 * put something new on it.
 *
 * Uploading always goes through the trimmer, even for a file that is already
 * short enough. That is what guarantees every clip arrives as WAV, which is
 * what lets the server read the length out of a header rather than believe a
 * number a client sent — and the length is the whole of how annoying a clip
 * played at a whole room can be made.
 */
export function ServerSoundsPage() {
  const { t } = useTranslation();
  const sounds = useSession((state) => state.sounds);
  const server = useSession((state) => state.server);
  const address = useSession((state) => state.address);
  const uploadSound = useSession((state) => state.uploadSound);
  const updateSound = useSession((state) => state.updateSound);
  const deleteSound = useSession((state) => state.deleteSound);

  const permissions = useMyPermissions();
  const allowed = has(permissions, Perm.ManageExpressions);

  const picker = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Sound | null>(null);

  const limits = server?.expressions;
  const maxSeconds = limits?.maxSoundSeconds ?? 10;
  const maxBytes = parseBytes(limits?.maxSoundBytes);
  const limit = limits?.maxSounds ?? 0;

  const list = useMemo(() => [...sounds.values()], [sounds]);
  const full = limit > 0 && list.length >= limit;

  async function save(input: { file: File; name: string; emoji: string }) {
    setError(null);
    try {
      await uploadSound(input.name, input.emoji, input.file);
      setPicked(null);
    } catch (failure) {
      setError(describeError(failure));
      throw failure;
    }
  }

  async function remove(sound: Sound) {
    setError(null);
    try {
      await deleteSound(sound.id);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setRemoving(null);
    }
  }

  function preview(sound: Sound) {
    if (!address) return;
    stopAllSounds();
    void playSoundClip(`${serverOrigin(address)}${sound.url}`, sound.volume);
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.serverSettings.sounds.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.serverSettings.sounds.desc")}</p>
      </header>

      <div className="settings-card">
        <div className="settings-card__header">
          <span className="settings-card__service-icon" aria-hidden="true">
            <SoundboardIcon size={18} />
          </span>
          <div className="settings-card__header-info">
            <h3 className="settings-card__title">
              {t("dialogs.serverSettings.sounds.slots", { used: list.length, total: limit })}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.serverSettings.sounds.limits", {
                seconds: maxSeconds,
                size: formatBytes(maxBytes),
              })}
            </p>
          </div>

          {allowed ? (
            <>
              <input
                ref={picker}
                type="file"
                accept="audio/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    setError(null);
                    setPicked(file);
                  }
                }}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={full}
                onClick={() => picker.current?.click()}
              >
                <UploadIcon size={15} />
                {t("dialogs.serverSettings.sounds.upload")}
              </button>
            </>
          ) : null}
        </div>

        {error ? <p className="settings-inline-error">{error}</p> : null}
        {full ? (
          <p className="settings-card__subtitle">{t("dialogs.serverSettings.sounds.full")}</p>
        ) : null}

        {list.length === 0 ? (
          <p className="settings-card__subtitle">{t("dialogs.serverSettings.sounds.empty")}</p>
        ) : (
          <ul className="sound-list">
            {list.map((sound) => (
              <li key={sound.id} className="sound-row">
                <span className="sound-row__glyph" aria-hidden="true">
                  {sound.emoji || <MusicIcon size={16} />}
                </span>

                <div className="sound-row__body">
                  <span className="sound-row__name">{sound.name}</span>
                  <span className="sound-row__meta">
                    {(sound.durationMs / 1000).toFixed(1)}s · {formatBytes(Number(sound.size) || 0)}
                  </span>
                </div>

                {allowed ? (
                  <label className="sound-row__volume">
                    <span className="field__hint">
                      {t("dialogs.serverSettings.sounds.volume")}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={sound.volume}
                      onChange={(event) => {
                        void updateSound({
                          soundId: sound.id,
                          volume: Number(event.target.value),
                        }).catch((failure: unknown) => setError(describeError(failure)));
                      }}
                    />
                  </label>
                ) : null}

                <button
                  type="button"
                  className="iconbtn"
                  title={t("dialogs.serverSettings.sounds.preview")}
                  onClick={() => preview(sound)}
                >
                  <PlayIcon size={15} />
                </button>

                {allowed ? (
                  <button
                    type="button"
                    className="iconbtn iconbtn--danger"
                    title={t("common.delete")}
                    onClick={() => setRemoving(sound)}
                  >
                    <TrashIcon size={15} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {picked ? (
        <SoundTrimDialog
          file={picked}
          maxSeconds={maxSeconds}
          maxBytes={maxBytes}
          onCancel={() => setPicked(null)}
          onDone={save}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={t("common.delete")}
          subtitle={t("dialogs.serverSettings.sounds.deleteConfirm", { name: removing.name })}
          confirmText={t("common.delete")}
          danger
          onConfirm={() => void remove(removing)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}
