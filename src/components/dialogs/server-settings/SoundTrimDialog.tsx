import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { describeError } from "@/lib/protocol";
import { decodeAudioFile, trimToWav, type DecodedAudio } from "@/lib/soundboard";
import { formatBytes } from "@/lib/uploads";
import { getAudioContext } from "@/lib/audioContext";
import { Modal } from "../../Modal";
import { PlayIcon, ScissorsIcon, StopIcon } from "../../Icons";

interface SoundTrimDialogProps {
  file: File;
  /** How long a clip this server allows. The window is clamped to it. */
  maxSeconds: number;
  maxBytes: number;
  onCancel(): void;
  onDone(input: { file: File; name: string; emoji: string; durationMs: number }): Promise<void>;
}

/**
 * The trimmer: pick the few seconds of a file worth keeping.
 *
 * It exists because the file somebody has is almost never the clip they want —
 * it is a three-minute song with eight interesting seconds in the middle — and
 * because a length limit that can only be met by editing the file elsewhere is
 * a limit that stops people using the feature.
 *
 * What leaves here is always WAV, even when nothing was cut. The server reads
 * the length out of a RIFF header rather than believing a number this client
 * sent, and that is only possible if every clip arrives in the one format whose
 * duration can be read exactly.
 */
export function SoundTrimDialog({ file, maxSeconds, maxBytes, onCancel, onDone }: SoundTrimDialogProps) {
  const { t } = useTranslation();

  const [decoded, setDecoded] = useState<DecodedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(maxSeconds);
  const [name, setName] = useState(() => suggestName(file.name));
  const [emoji, setEmoji] = useState("");

  const [playing, setPlaying] = useState(false);
  const preview = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    decodeAudioFile(file)
      .then((result) => {
        if (cancelled) return;
        setDecoded(result);
        // A file already shorter than the ceiling is offered whole: the common
        // case is somebody who cut the clip elsewhere and wants it as it is.
        setStart(0);
        setEnd(Math.min(result.durationSeconds, maxSeconds));
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(describeError(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [file, maxSeconds]);

  useEffect(() => () => stopPreview(), []);

  const duration = decoded?.durationSeconds ?? 0;
  const length = Math.max(0, end - start);
  // Sixteen-bit mono at the source rate, which is what the encoder writes.
  const estimatedBytes = decoded ? Math.round(length * decoded.buffer.sampleRate * 2) + 44 : 0;
  const tooBig = maxBytes > 0 && estimatedBytes > maxBytes;

  const peaks = decoded?.peaks ?? [];
  const columns = useMemo(() => peaks.length || 1, [peaks.length]);

  function stopPreview() {
    if (preview.current) {
      try {
        preview.current.stop();
      } catch {
        // Already finished.
      }
      preview.current = null;
    }
    setPlaying(false);
  }

  /** Plays exactly the window that would be uploaded, and nothing else. */
  function playSelection() {
    if (!decoded) return;
    stopPreview();

    const context = getAudioContext();
    if (!context) return;

    const source = context.createBufferSource();
    source.buffer = decoded.buffer;
    source.connect(context.destination);
    source.onended = () => {
      preview.current = null;
      setPlaying(false);
    };
    source.start(0, start, length);
    preview.current = source;
    setPlaying(true);
  }

  /** Moves one edge of the window, keeping it inside the server's ceiling. */
  function moveStart(value: number) {
    const next = Math.max(0, Math.min(value, duration - 0.1));
    setStart(next);
    if (end - next > maxSeconds) setEnd(next + maxSeconds);
    if (end <= next) setEnd(Math.min(duration, next + 0.1));
  }

  function moveEnd(value: number) {
    const next = Math.min(duration, Math.max(value, 0.1));
    setEnd(next);
    if (next - start > maxSeconds) setStart(next - maxSeconds);
    if (next <= start) setStart(Math.max(0, next - 0.1));
  }

  async function submit() {
    if (!decoded) return;
    const label = name.trim();
    if (label === "") {
      setError(t("dialogs.serverSettings.sounds.nameRequired"));
      return;
    }

    stopPreview();
    setBusy(true);
    setError(null);
    try {
      const clip = trimToWav(decoded, start, end, file.name);
      await onDone({ file: clip.file, name: label, emoji: emoji.trim(), durationMs: clip.durationMs });
    } catch (failure) {
      setError(describeError(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("dialogs.serverSettings.sounds.trimTitle")}
      subtitle={t("dialogs.serverSettings.sounds.trimSubtitle", { seconds: maxSeconds })}
      onClose={onCancel}
    >
      <div className="trimmer">
        {error ? <p className="settings-inline-error">{error}</p> : null}

        {!decoded ? (
          <p className="settings-card__subtitle">{t("common.loading")}</p>
        ) : (
          <>
            <div className="trimmer__wave" aria-hidden="true">
              {peaks.map((peak, index) => {
                const at = (index / columns) * duration;
                const inside = at >= start && at <= end;
                return (
                  <span
                    key={index}
                    className={inside ? "trimmer__bar trimmer__bar--on" : "trimmer__bar"}
                    style={{ height: `${Math.max(2, peak * 100)}%` }}
                  />
                );
              })}
            </div>

            <div className="trimmer__range">
              <label className="field__label" htmlFor="trim-start">
                {t("dialogs.serverSettings.sounds.start")}
              </label>
              <input
                id="trim-start"
                type="range"
                min={0}
                max={Math.max(0.1, duration)}
                step={0.05}
                value={start}
                onChange={(event) => moveStart(Number(event.target.value))}
              />
              <span className="trimmer__time">{start.toFixed(2)}s</span>
            </div>

            <div className="trimmer__range">
              <label className="field__label" htmlFor="trim-end">
                {t("dialogs.serverSettings.sounds.end")}
              </label>
              <input
                id="trim-end"
                type="range"
                min={0}
                max={Math.max(0.1, duration)}
                step={0.05}
                value={end}
                onChange={(event) => moveEnd(Number(event.target.value))}
              />
              <span className="trimmer__time">{end.toFixed(2)}s</span>
            </div>

            <div className="trimmer__summary">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => (playing ? stopPreview() : playSelection())}
              >
                {playing ? <StopIcon size={15} /> : <PlayIcon size={15} />}
                {playing
                  ? t("dialogs.serverSettings.sounds.stop")
                  : t("dialogs.serverSettings.sounds.preview")}
              </button>
              <span className={tooBig ? "trimmer__length trimmer__length--over" : "trimmer__length"}>
                {t("dialogs.serverSettings.sounds.selected", {
                  seconds: length.toFixed(2),
                  size: formatBytes(estimatedBytes),
                })}
              </span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="sound-name">
                {t("dialogs.serverSettings.sounds.nameLabel")}
              </label>
              <input
                id="sound-name"
                className="input"
                value={name}
                maxLength={32}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="sound-emoji">
                {t("dialogs.serverSettings.sounds.emojiLabel")}
              </label>
              <input
                id="sound-emoji"
                className="input input--narrow"
                value={emoji}
                maxLength={8}
                placeholder="🔊"
                onChange={(event) => setEmoji(event.target.value)}
              />
              <p className="field__hint">{t("dialogs.serverSettings.sounds.emojiHint")}</p>
            </div>
          </>
        )}

        <div className="settings-actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!decoded || busy || tooBig || length <= 0}
            onClick={() => void submit()}
          >
            <ScissorsIcon size={15} />
            {busy ? t("common.loading") : t("dialogs.serverSettings.sounds.saveClip")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The name to start from: the file's own, tidied. */
function suggestName(filename: string): string {
  const stem = filename.replace(/\.[^./\\]+$/, "").replace(/[_-]+/g, " ").trim();
  return stem.slice(0, 32) || "Sound";
}
