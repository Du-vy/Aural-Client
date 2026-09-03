import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError, type Sound } from "@/lib/protocol";
import { playSoundClip, stopAllSounds } from "@/lib/soundboard";
import { formatBytes, parseBytes, serverOrigin } from "@/lib/uploads";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { MusicIcon, PlayIcon, SoundboardIcon, StopIcon, TrashIcon, UploadIcon } from "../../Icons";
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
  const [playingId, setPlayingId] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      stopAllSounds();
    };
  }, []);

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
    if (playingId === sound.id) {
      stopAllSounds();
      setPlayingId(null);
      return;
    }
    stopAllSounds();
    setPlayingId(sound.id);
    void playSoundClip(`${serverOrigin(address)}${sound.url}`, sound.volume)
      .finally(() => {
        setPlayingId((curr) => (curr === sound.id ? null : curr));
      })
      .catch(() => {});
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.serverSettings.sounds.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.serverSettings.sounds.desc")}</p>
      </header>

      <div className="settings-card">
        <div className="settings-card__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            <span
              className="settings-card__service-icon"
              aria-hidden="true"
              style={{
                width: 38,
                height: 38,
                borderRadius: "var(--radius-sm)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--accent-soft)",
                color: "var(--accent)",
                flexShrink: 0,
              }}
            >
              <SoundboardIcon size={20} />
            </span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 className="settings-card__title" style={{ margin: 0 }}>
                  {t("dialogs.serverSettings.sounds.title")}
                </h3>
                <span className="settings-badge" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)", fontSize: 11 }}>
                  {list.length} / {limit || "∞"}
                </span>
              </div>
              <p className="settings-card__subtitle" style={{ marginTop: 2 }}>
                {t("dialogs.serverSettings.sounds.slots", { used: list.length, total: limit })}
                {" · "}
                {t("dialogs.serverSettings.sounds.limits", {
                  seconds: maxSeconds,
                  size: formatBytes(maxBytes),
                })}
              </p>
            </div>
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
          <p className="settings-card__subtitle" style={{ marginTop: 10 }}>{t("dialogs.serverSettings.sounds.full")}</p>
        ) : null}

        {list.length === 0 ? (
          <div
            style={{
              padding: "36px 20px",
              textAlign: "center",
              background: "var(--bg-input)",
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-md)",
              marginTop: 14,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: "var(--bg-overlay)",
                color: "var(--text-dim)",
              }}
            >
              <SoundboardIcon size={22} />
            </span>
            <div>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                {t("dialogs.serverSettings.sounds.empty")}
              </h4>
              <p className="settings-card__subtitle" style={{ margin: "4px 0 0" }}>
                {t("dialogs.serverSettings.sounds.desc")}
              </p>
            </div>
            {allowed && !full ? (
              <button
                type="button"
                className="btn btn--secondary"
                style={{ marginTop: 6 }}
                onClick={() => picker.current?.click()}
              >
                <UploadIcon size={14} />
                {t("dialogs.serverSettings.sounds.upload")}
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="sound-list" style={{ marginTop: 14 }}>
            {list.map((sound) => (
              <li key={sound.id} className="sound-row">
                <span className="sound-row__glyph" aria-hidden="true">
                  {sound.emoji || <MusicIcon size={18} />}
                </span>

                <div className="sound-row__body">
                  <span className="sound-row__name">{sound.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <span className="chip" style={{ fontSize: 10, padding: "0 6px", height: 18, lineHeight: "18px" }}>
                      {(sound.durationMs / 1000).toFixed(1)}s
                    </span>
                    <span className="sound-row__meta">
                      {formatBytes(Number(sound.size) || 0)}
                    </span>
                  </div>
                </div>

                {allowed ? (
                  <label className="sound-row__volume">
                    <span className="field__hint" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span>{t("dialogs.serverSettings.sounds.volume")}</span>
                      <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>{sound.volume}%</span>
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

                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button"
                    className={`iconbtn ${playingId === sound.id ? "iconbtn--active" : ""}`}
                    title={playingId === sound.id ? t("dialogs.serverSettings.sounds.stop") : t("dialogs.serverSettings.sounds.preview")}
                    onClick={() => preview(sound)}
                  >
                    {playingId === sound.id ? <StopIcon size={15} /> : <PlayIcon size={15} />}
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
                </div>
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
