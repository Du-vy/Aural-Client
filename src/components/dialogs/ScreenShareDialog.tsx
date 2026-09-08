import { useState } from "react";

import { Modal } from "@/components/Modal";
import { useTranslation } from "@/lib/i18n";
import {
  availableFramerates,
  availableHeights,
  clampQuality,
  requestedQuality,
  suggestedBitrate,
  type ScreenCodec,
  type ScreenPreferences,
  type ScreenPriority,
} from "@/lib/voice/screen";
import { useVoice } from "@/store/voice";

interface ScreenShareDialogProps {
  /**
   * Whether a share is already running. It changes the whole meaning of the
   * dialog: settling on a quality before a picker appears, or adjusting one
   * that people are already watching.
   */
  live: boolean;
  onClose(): void;
}

/**
 * What to share, and how well.
 *
 * The one thing it deliberately does not do is ask *which* screen. That is the
 * platform's question and the platform asks it: every monitor listed
 * separately, every window by name, in the dialog somebody already recognises
 * as the one that appears whenever anything captures their screen. Asking it
 * here would mean a worse list in a window with no authority to offer one.
 *
 * What is left is the part only this client knows: how much of the connection
 * a picture may have, and which half of the picture to protect when it cannot
 * have all of it.
 */
export function ScreenShareDialog({ live, onClose }: ScreenShareDialogProps) {
  const { t } = useTranslation();
  const config = useVoice((state) => state.config);
  const stored = useVoice((state) => state.screenPrefs);
  const setScreenPreferences = useVoice((state) => state.setScreenPreferences);
  const startScreen = useVoice((state) => state.startScreen);
  const applyScreenQuality = useVoice((state) => state.applyScreenQuality);
  const [busy, setBusy] = useState(false);

  // The dialog edits a copy: closing it without confirming must leave a share
  // that is already running exactly as it was.
  const [draft, setDraft] = useState<ScreenPreferences>(stored);

  const screen = config?.screen;
  const heights = availableHeights(screen);
  const framerates = availableFramerates(screen);
  const quality = clampQuality(requestedQuality(draft), screen);
  const patch = (changes: Partial<ScreenPreferences>) => setDraft({ ...draft, ...changes });

  const mb = (bits: number) => `${(bits / 1_000_000).toFixed(1)} Mb/s`;

  const submit = async () => {
    setBusy(true);
    setScreenPreferences(draft);
    try {
      if (live) await applyScreenQuality();
      else await startScreen();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Modal
      title={live ? t("voice.screen.changeQuality") : t("voice.screen.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {live ? t("voice.screen.apply") : t("voice.screen.start")}
          </button>
        </>
      }
    >
      <div className="screenshare">
        <p className="field__hint">
          {live ? t("voice.screen.liveHint") : t("voice.screen.sourceHint")}
        </p>

        <div className="settings-grid-2">
          <div className="field">
            <label className="field__label" htmlFor="screen-height">
              {t("voice.screen.resolution")}
            </label>
            <select
              id="screen-height"
              className="select"
              value={draft.height}
              onChange={(event) => patch({ height: Number(event.target.value) })}
            >
              {heights.map((height) => (
                <option key={height} value={height}>
                  {height}p
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="screen-framerate">
              {t("voice.screen.framerate")}
            </label>
            <select
              id="screen-framerate"
              className="select"
              value={draft.framerate}
              onChange={(event) => patch({ framerate: Number(event.target.value) })}
            >
              {framerates.map((rate) => (
                <option key={rate} value={rate}>
                  {t("voice.screen.fps", { rate })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="screen-bitrate">
            {t("voice.screen.bitrate")}
          </label>
          <input
            id="screen-bitrate"
            type="range"
            className="slider"
            min={500_000}
            max={screen?.enforced ? screen.maxBitrate : 20_000_000}
            step={100_000}
            value={quality.bitrate}
            onChange={(event) => patch({ bitrate: Number(event.target.value) })}
          />
          <p className="field__hint">
            {mb(quality.bitrate)}
            {draft.bitrate === 0 ? ` · ${t("voice.screen.bitrateAuto")}` : null}
            {draft.bitrate !== 0 ? (
              <>
                {" · "}
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => patch({ bitrate: 0 })}
                >
                  {t("voice.screen.bitrateReset", {
                    value: mb(suggestedBitrate(draft.height, draft.framerate)),
                  })}
                </button>
              </>
            ) : null}
          </p>
        </div>

        <div className="field">
          <span className="field__label">{t("voice.screen.priority")}</span>
          <div className="settings-radio-group">
            {(
              [
                ["detail", "priorityDetail", "priorityDetailDesc"],
                ["motion", "priorityMotion", "priorityMotionDesc"],
              ] as const
            ).map(([value, title, description]) => (
              <label
                key={value}
                className={`settings-radio-card ${
                  draft.priority === value ? "settings-radio-card--active" : ""
                }`}
              >
                <input
                  type="radio"
                  name="screen-priority"
                  checked={draft.priority === value}
                  onChange={() => patch({ priority: value as ScreenPriority })}
                />
                <span className="settings-radio-card__body">
                  <span className="settings-radio-card__title">
                    {t(`voice.screen.${title}`)}
                  </span>
                  <span className="settings-card__subtitle">
                    {t(`voice.screen.${description}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Sound is only offered where the server carries it, and stopped
            being offered is more honest than a switch that does nothing. */}
        {screen?.audio ? (
          <div className="settings-row">
            <div className="settings-row__info">
              <h4 className="settings-card__title" style={{ margin: 0 }}>
                {t("voice.screen.audio")}
              </h4>
              <p className="settings-card__subtitle" style={{ marginTop: 2 }}>
                {t("voice.screen.audioDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={draft.audio}
                disabled={live}
                onChange={(event) => patch({ audio: event.target.checked })}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        ) : (
          <p className="field__hint">{t("voice.screen.audioUnsupported")}</p>
        )}

        <details className="screenshare__advanced">
          <summary>{t("voice.screen.advanced")}</summary>
          <div className="field" style={{ marginTop: 10 }}>
            <label className="field__label" htmlFor="screen-codec">
              {t("voice.screen.codec")}
            </label>
            <select
              id="screen-codec"
              className="select"
              value={draft.codec}
              onChange={(event) => patch({ codec: event.target.value as ScreenCodec })}
            >
              <option value="auto">{t("voice.screen.codecAuto")}</option>
              <option value="vp9">VP9</option>
              <option value="h264">H.264</option>
              <option value="vp8">VP8</option>
              <option value="av1">AV1</option>
            </select>
            <p className="field__hint">
              {draft.codec === "auto"
                ? t("voice.screen.codecAutoDesc")
                : t("voice.screen.codecManualDesc")}
            </p>
          </div>
        </details>

        <p className="field__hint">
          {screen?.enforced
            ? t("voice.screen.capped", {
                height: screen.maxHeight,
                framerate: screen.maxFramerate,
                bitrate: mb(screen.maxBitrate),
              })
            : t("voice.screen.uncapped")}
        </p>
      </div>
    </Modal>
  );
}
