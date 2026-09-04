import { useState, useEffect, useRef } from "react";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { useVoice } from "@/store/voice";
import {
  Microphone,
  MicrophoneError,
  Monitor,
  type MicrophoneFailure,
  type NoiseSuppression,
} from "@/lib/voice/audio";
import { describeKey, resolveBitrate } from "@/lib/voice/settings";
import { MicIcon, VolumeIcon } from "@/components/Icons";
import { readAccessibility, writeAccessibility } from "@/lib/storage";
import { playVoiceSound } from "@/lib/voiceSounds";

/**
 * The three suppressors, in the order they cost.
 *
 * They are alternatives rather than levels — see `NoiseSuppression` — which is
 * why this is a choice of one and not three switches.
 */
const SUPPRESSION_CHOICES = [
  {
    value: "off",
    title: "dialogs.userSettings.voice.suppressionOff",
    description: "dialogs.userSettings.voice.suppressionOffDesc",
  },
  {
    value: "standard",
    title: "dialogs.userSettings.voice.suppressionStandard",
    description: "dialogs.userSettings.voice.suppressionStandardDesc",
  },
  {
    value: "rnnoise",
    title: "dialogs.userSettings.voice.suppressionRnnoise",
    description: "dialogs.userSettings.voice.suppressionRnnoiseDesc",
  },
] as const satisfies ReadonlyArray<{
  value: NoiseSuppression;
  title: TranslationKey;
  description: TranslationKey;
}>;

export function VoiceAudioPage() {
  const { t } = useTranslation();
  const prefs = useVoice((state) => state.prefs);
  const devices = useVoice((state) => state.devices);
  const config = useVoice((state) => state.config);
  const level = useVoice((state) => state.level);
  const status = useVoice((state) => state.status);
  const setPreferences = useVoice((state) => state.setPreferences);
  const refreshDevices = useVoice((state) => state.refreshDevices);
  const setMeterActive = useVoice((state) => state.setMeterActive);
  const denoising = useVoice((state) => state.denoising);

  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<MicrophoneFailure | null>(null);
  const [testLevel, setTestLevel] = useState(0);
  const [recordingKey, setRecordingKey] = useState(false);
  const [voiceAudioCues, setVoiceAudioCues] = useState(() => readAccessibility().voiceAudioCues);
  const [voiceParticipantCues, setVoiceParticipantCues] = useState(() => readAccessibility().voiceParticipantCues);
  /**
   * The microphone the test opened, once it is open.
   *
   * This is state rather than a ref because everything else the test does —
   * the meter, the playback, the input gain — has to start the moment it
   * appears, and a ref changing tells nothing that it did.
   */
  const [testMic, setTestMic] = useState<Microphone | null>(null);
  /**
   * The speakers the test plays into.
   *
   * One for the life of the page rather than one per test: it holds the volume
   * and the output device between tests, so the settings above it are already
   * in force by the time there is anything to play.
   */
  const monitor = useRef<Monitor | null>(null);
  monitor.current ??= new Monitor();

  // Device names are blank until a microphone has been granted once, so the
  // list is asked for again whenever this page is opened rather than only at
  // startup.
  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  // While a call is running the meter reads the microphone that is already
  // open; the store only publishes the level while something is watching.
  useEffect(() => {
    setMeterActive(true);
    return () => setMeterActive(false);
  }, [setMeterActive]);

  const inCall = status === "connected" || status === "connecting" || status === "reconnecting";

  // A call takes the test's place. The button that would stop it is gone by
  // then, and leaving it running would hold a second microphone open and play
  // your own voice back over everybody else's.
  useEffect(() => {
    if (inCall) setTesting(false);
  }, [inCall]);

  // Outside a call there is no microphone to read, so testing opens one of its
  // own and closes it again on the way out.
  useEffect(() => {
    if (!testing) return;

    let cancelled = false;
    let opened: Microphone | null = null;

    void Microphone.open({
      deviceId: prefs.inputDeviceId,
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
      autoGainControl: prefs.autoGainControl,
    })
      .then((mic) => {
        if (cancelled) {
          mic.close();
          return;
        }
        opened = mic;
        // The gate stays open for as long as the test runs, whatever the input
        // mode says. Push to talk would otherwise make this a test of holding
        // a key, and a threshold set too high would make it one of silence.
        mic.setOpen(true);
        // Pressing the button is the gesture a suspended context is waiting
        // for, but the context is built after the press rather than during it.
        void mic.resume();
        setTestError(null);
        // Device names arrive with the first grant, so the list is worth
        // asking for again the moment one is given.
        void refreshDevices();
        setTestMic(mic);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTestError(error instanceof MicrophoneError ? error.reason : "unknown");
        setTesting(false);
      });

    return () => {
      cancelled = true;
      opened?.close();
      setTestMic(null);
      setTestLevel(0);
    };
  }, [testing, prefs.inputDeviceId, prefs.echoCancellation, prefs.noiseSuppression, prefs.autoGainControl, refreshDevices]);

  // The meter reads the microphone the test opened, for as long as it is open.
  useEffect(() => {
    if (!testMic) return;
    return testMic.onLevel(setTestLevel);
  }, [testMic]);

  // Moving the input slider during a test has to be audible in the test: being
  // able to hear what a setting does to your voice is the reason for the test.
  useEffect(() => {
    testMic?.setInputVolume(prefs.inputVolume);
  }, [testMic, prefs.inputVolume]);

  // These two are declared before the playback so that they run before it as
  // well, and the first sound out of it is already at the chosen volume and on
  // the chosen device rather than correcting itself a moment later.
  useEffect(() => {
    monitor.current?.setVolume(prefs.outputVolume);
  }, [prefs.outputVolume]);

  useEffect(() => {
    void monitor.current?.setOutputDevice(prefs.outputDeviceId);
  }, [prefs.outputDeviceId]);

  /*
   * Hearing yourself is the point of the test.
   *
   * A meter answers "is anything arriving", which is the smaller half of the
   * question. Whether the microphone selected is the one being spoken into,
   * whether suppression is eating the voice along with the noise, whether the
   * output device chosen above is where sound actually comes out — none of
   * those can be read off a bar. What is played is the processed stream, the
   * one that would have been sent, so this is what the far end would hear.
   */
  useEffect(() => {
    const speakers = monitor.current;
    if (!testMic || !speakers) return;
    speakers.play(testMic.stream);
    return () => speakers.stop();
  }, [testMic]);

  // Capturing a shortcut has to swallow the key it captures, or assigning
  // Escape would close this dialog and assigning Space would press a button.
  useEffect(() => {
    if (!recordingKey) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code !== "Escape") setPreferences({ pttKey: event.code });
      setRecordingKey(false);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [recordingKey, setPreferences]);

  /**
   * Whether the device lists are being withheld for want of a permission.
   *
   * Browsers disagree about how to say it. Firefox hides the devices; Chrome
   * lists them with empty labels. Both mean the same thing, and both are fixed
   * by opening a microphone once.
   */
  const namesHidden =
    devices.inputs.length === 0 || devices.inputs.every((device) => !device.label);

  /**
   * Opens a microphone for as long as it takes to be granted one.
   *
   * Nothing is done with it. The point is the grant: device names arrive with
   * it, and it is the only way a page can ask, which is why the alternative to
   * this button is telling somebody to join a call to find out whether their
   * microphone works.
   */
  const grantAccess = async () => {
    try {
      const mic = await Microphone.open({
        deviceId: "",
        echoCancellation: prefs.echoCancellation,
        // This is about the permission and nothing else, so it does not fetch
        // a denoiser it is only going to close again.
        noiseSuppression: "off",
        autoGainControl: prefs.autoGainControl,
      });
      mic.close();
      setTestError(null);
    } catch (error) {
      setTestError(error instanceof MicrophoneError ? error.reason : "unknown");
    }
    await refreshDevices();
  };

  const shownLevel = testing ? testLevel : inCall ? level : 0;
  const bitrate = resolveBitrate(prefs, config ?? undefined);

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.userSettings.voice.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.userSettings.voice.desc")}</p>
      </header>

      {/* Section 1: Audio Devices & Mic Test */}
      <div className="settings-group">
        <div className="settings-group__item">
          <div className="settings-grid-2">
            <div>
              <label className="field__label" htmlFor="voice-input-dev">
                {t("dialogs.userSettings.voice.inputDevice")}
              </label>
              <div style={{ marginTop: 8 }}>
                <select
                  id="voice-input-dev"
                  className="select"
                  value={prefs.inputDeviceId}
                  onChange={(e) => setPreferences({ inputDeviceId: e.target.value })}
                >
                  <option value="">{t("dialogs.userSettings.voice.systemDefault")}</option>
                  {devices.inputs.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || device.deviceId}
                    </option>
                  ))}
                </select>
              </div>

              <Slider
                label={t("dialogs.userSettings.voice.inputVolume")}
                value={prefs.inputVolume}
                min={0}
                max={200}
                suffix="%"
                onChange={(inputVolume) => setPreferences({ inputVolume })}
              />
            </div>

            <div>
              <label className="field__label" htmlFor="voice-output-dev">
                {t("dialogs.userSettings.voice.outputDevice")}
              </label>
              <div style={{ marginTop: 8 }}>
                <select
                  id="voice-output-dev"
                  className="select"
                  value={prefs.outputDeviceId}
                  onChange={(e) => setPreferences({ outputDeviceId: e.target.value })}
                >
                  <option value="">{t("dialogs.userSettings.voice.systemDefault")}</option>
                  {devices.outputs.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || device.deviceId}
                    </option>
                  ))}
                </select>
              </div>

              <Slider
                label={t("dialogs.userSettings.voice.outputVolume")}
                value={prefs.outputVolume}
                min={0}
                max={200}
                suffix="%"
                onChange={(outputVolume) => setPreferences({ outputVolume })}
              />
            </div>
          </div>

          {namesHidden ? (
            <div className="voice-grant" style={{ marginTop: 16 }}>
              <p className="field__hint" style={{ margin: 0 }}>
                {t("dialogs.userSettings.voice.noDevices")}
              </p>
              <button type="button" className="btn" onClick={() => void grantAccess()}>
                <MicIcon size={15} />
                {t("voice.mic.allowAccess")}
              </button>
            </div>
          ) : null}
        </div>

        <div className="settings-group__item">
          <h3 className="settings-card__title">{t("dialogs.userSettings.voice.micTestTitle")}</h3>
          <p className="settings-card__subtitle">
            {testing
              ? t("dialogs.userSettings.voice.micTestListening")
              : t("dialogs.userSettings.voice.micTestPrompt")}
          </p>

          <div className="mic-test-row" style={{ marginTop: 14 }}>
            {inCall ? null : (
              <button
                type="button"
                className={testing ? "btn btn--danger" : "btn btn--primary"}
                onClick={() => setTesting((previous) => !previous)}
              >
                <MicIcon size={16} />
                {testing
                  ? t("dialogs.userSettings.voice.stopMic")
                  : t("dialogs.userSettings.voice.checkMic")}
              </button>
            )}

            <div className="voice-meter" style={{ flex: 1 }}>
              <div
                className={
                  shownLevel >= prefs.threshold
                    ? "voice-meter__fill"
                    : "voice-meter__fill voice-meter__fill--under"
                }
                style={{ width: `${shownLevel}%` }}
              />
              {prefs.mode === "activity" ? (
                <div className="voice-meter__threshold" style={{ left: `${prefs.threshold}%` }} />
              ) : null}
            </div>
          </div>

          {testError ? (
            <p className="field__error" style={{ marginTop: 10 }}>
              {t(`voice.mic.${testError}`)}
            </p>
          ) : null}

          {prefs.mode === "activity" ? (
            <div style={{ marginTop: 12 }}>
              <Slider
                label={t("dialogs.userSettings.voice.threshold")}
                value={prefs.threshold}
                min={0}
                max={100}
                suffix="%"
                onChange={(threshold) => setPreferences({ threshold })}
              />
              <p className="settings-card__subtitle" style={{ marginTop: 6 }}>
                {t("dialogs.userSettings.voice.thresholdDesc")}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Section 2: Input Mode */}
      <div className="settings-group" style={{ marginTop: 20 }}>
        <div className="settings-group__item">
          <h3 className="settings-card__title">{t("dialogs.userSettings.voice.inputMode")}</h3>
          <div className="settings-radio-group" style={{ marginTop: 12 }}>
            <label className={`settings-radio-card ${prefs.mode === "activity" ? "settings-radio-card--active" : ""}`}>
              <input
                type="radio"
                name="input-mode"
                checked={prefs.mode === "activity"}
                onChange={() => setPreferences({ mode: "activity" })}
              />
              <span className="settings-radio-card__body">
                <span className="settings-radio-card__title">
                  {t("dialogs.userSettings.voice.voiceActivity")}
                </span>
                <span className="settings-card__subtitle">
                  {t("dialogs.userSettings.voice.voiceActivityDesc")}
                </span>
              </span>
            </label>

            <label className={`settings-radio-card ${prefs.mode === "ptt" ? "settings-radio-card--active" : ""}`}>
              <input
                type="radio"
                name="input-mode"
                checked={prefs.mode === "ptt"}
                onChange={() => setPreferences({ mode: "ptt" })}
              />
              <span className="settings-radio-card__body">
                <span className="settings-radio-card__title">
                  {t("dialogs.userSettings.voice.pushToTalk")}
                </span>
                <span className="settings-card__subtitle">
                  {t("dialogs.userSettings.voice.pushToTalkDesc")}
                </span>
              </span>
            </label>
          </div>

          {prefs.mode === "ptt" ? (
            <div style={{ marginTop: 14 }}>
              <div className="voice-device-row">
                <span className="field__label">{t("dialogs.userSettings.voice.pushToTalkKey")}</span>
                <button
                  type="button"
                  className={recordingKey ? "voice-key voice-key--recording" : "voice-key"}
                  onClick={() => setRecordingKey(true)}
                >
                  {recordingKey
                    ? t("dialogs.userSettings.voice.pushToTalkRecording")
                    : describeKey(prefs.pttKey)}
                </button>
              </div>
              <Slider
                label={t("dialogs.userSettings.voice.pushToTalkRelease")}
                value={prefs.pttReleaseMs}
                min={0}
                max={1000}
                step={50}
                suffix=" ms"
                onChange={(pttReleaseMs) => setPreferences({ pttReleaseMs })}
              />
              <p className="settings-card__subtitle" style={{ marginTop: 6 }}>
                {t("dialogs.userSettings.voice.pushToTalkWindowOnly")}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Section 3: Advanced Audio & Voice Processing */}
      <div className="settings-group" style={{ marginTop: 20 }}>
        <div className="settings-group__item">
          <h3 className="settings-card__title">{t("dialogs.userSettings.voice.qualityTitle")}</h3>
          <p className="settings-card__subtitle">{t("dialogs.userSettings.voice.qualityDesc")}</p>

          <Slider
            label={t("dialogs.userSettings.voice.bitrate")}
            value={bitrate}
            min={config?.minBitrate ?? 16000}
            max={config?.maxBitrate ?? 128000}
            step={1000}
            format={(value) => `${Math.round(value / 1000)} kb/s`}
            onChange={(value) => setPreferences({ bitrate: value })}
          />
          <p className="settings-card__subtitle" style={{ marginTop: 6 }}>
            {config
              ? t("dialogs.userSettings.voice.bitrateServerRange", {
                  min: `${Math.round(config.minBitrate / 1000)} kb/s`,
                  max: `${Math.round(config.maxBitrate / 1000)} kb/s`,
                })
              : t("dialogs.userSettings.voice.bitrateNoServer")}
          </p>
        </div>

        <div className="settings-group__item">
          <h3 className="settings-card__title">
            {t("dialogs.userSettings.voice.noiseSuppression")}
          </h3>
          <p className="settings-card__subtitle">
            {t("dialogs.userSettings.voice.noiseSuppressionDesc")}
          </p>

          <div className="settings-radio-group" style={{ marginTop: 12 }}>
            {SUPPRESSION_CHOICES.map((choice) => {
              const isChecked = prefs.noiseSuppression === choice.value;
              return (
                <label
                  className={`settings-radio-card ${isChecked ? "settings-radio-card--active" : ""}`}
                  key={choice.value}
                >
                  <input
                    type="radio"
                    name="noise-suppression"
                    checked={isChecked}
                    onChange={() => setPreferences({ noiseSuppression: choice.value })}
                  />
                  <span className="settings-radio-card__body">
                    <span className="settings-radio-card__title">{t(choice.title)}</span>
                    <span className="settings-card__subtitle">{t(choice.description)}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {prefs.noiseSuppression === "rnnoise" && denoising === false ? (
            <p className="field__error" style={{ marginTop: 10 }}>
              {t("dialogs.userSettings.voice.rnnoiseUnavailable")}
            </p>
          ) : null}
        </div>

        <div className="settings-group__item">
          <h3 className="settings-card__title">{t("dialogs.userSettings.voice.processingTitle")}</h3>

          <VoiceToggle
            title={t("dialogs.userSettings.voice.echoCancellation")}
            description={t("dialogs.userSettings.voice.echoCancellationDesc")}
            checked={prefs.echoCancellation}
            onChange={(echoCancellation) => setPreferences({ echoCancellation })}
            first
          />
          <VoiceToggle
            title={t("dialogs.userSettings.voice.gainControl")}
            description={t("dialogs.userSettings.voice.gainControlDesc")}
            checked={prefs.autoGainControl}
            onChange={(autoGainControl) => setPreferences({ autoGainControl })}
          />
          <VoiceToggle
            title={t("dialogs.userSettings.voice.joinMuted")}
            description={t("dialogs.userSettings.voice.joinMutedDesc")}
            checked={prefs.joinMuted}
            onChange={(joinMuted) => setPreferences({ joinMuted })}
          />

          <div
            className="settings-row"
            style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}
          >
            <div className="settings-row__info">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h4 className="settings-card__title">
                  {t("dialogs.userSettings.accessibility.voiceAudioCuesTitle")}
                </h4>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ padding: "2px 8px", fontSize: 12, height: 26 }}
                  onClick={() => void playVoiceSound("join", { force: true })}
                  title={t("dialogs.userSettings.accessibility.testJoinCue")}
                >
                  <VolumeIcon size={13} />
                  {t("dialogs.userSettings.accessibility.testJoinCue")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ padding: "2px 8px", fontSize: 12, height: 26 }}
                  onClick={() => void playVoiceSound("leave", { force: true })}
                  title={t("dialogs.userSettings.accessibility.testLeaveCue")}
                >
                  <VolumeIcon size={13} />
                  {t("dialogs.userSettings.accessibility.testLeaveCue")}
                </button>
              </div>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.accessibility.voiceAudioCuesDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={voiceAudioCues}
                onChange={(e) => {
                  const val = e.target.checked;
                  setVoiceAudioCues(val);
                  writeAccessibility({ voiceAudioCues: val });
                }}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>

          <div
            className="settings-row"
            style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}
          >
            <div className="settings-row__info">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h4 className="settings-card__title">
                  {t("dialogs.userSettings.accessibility.voiceParticipantCuesTitle")}
                </h4>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ padding: "2px 8px", fontSize: 12, height: 26 }}
                  onClick={() => void playVoiceSound("user-join", { force: true })}
                  title={t("dialogs.userSettings.accessibility.testJoinCue")}
                >
                  <VolumeIcon size={13} />
                  {t("dialogs.userSettings.accessibility.testJoinCue")}
                </button>
              </div>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.accessibility.voiceParticipantCuesDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={voiceParticipantCues}
                onChange={(e) => {
                  const val = e.target.checked;
                  setVoiceParticipantCues(val);
                  writeAccessibility({ voiceParticipantCues: val });
                }}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A labelled slider that shows its own value, which every one here does. */
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  format?(value: number): string;
  onChange(value: number): void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="field__label">{label}</span>
        <span className="field__hint">{format ? format(value) : `${value}${suffix}`}</span>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/** One switch with its explanation, as the processing list is made of. */
function VoiceToggle({
  title,
  description,
  checked,
  onChange,
  first,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange(checked: boolean): void;
  first?: boolean;
}) {
  return (
    <div
      className="settings-row"
      style={
        first
          ? { marginTop: 14 }
          : { marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }
      }
    >
      <div className="settings-row__info">
        <h4 className="settings-card__title">{title}</h4>
        <p className="settings-card__subtitle">{description}</p>
      </div>
      <label className="settings-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="settings-switch__slider" />
      </label>
    </div>
  );
}
