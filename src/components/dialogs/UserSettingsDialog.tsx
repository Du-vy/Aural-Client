import { useState, useEffect, useRef, type FormEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import {
  SettingsModal,
  type SettingsNavCategory,
} from "../SettingsModal";
import { Avatar } from "../Avatar";
import {
  CheckIcon,
  GlobeIcon,
  KeyIcon,
  LockIcon,
  LogOutIcon,
  MicIcon,
  MonitorIcon,
  PaletteIcon,
  ShieldIcon,
  SparklesIcon,
  UserIcon,
} from "../Icons";

type TabId =
  | "profile"
  | "account"
  | "privacy"
  | "voice"
  | "appearance"
  | "language"
  | "startup";

export function UserSettingsDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const disconnect = useSession((state) => state.disconnect);

  const [activeTab, setActiveTab] = useState<TabId>("profile");

  if (!self) return null;

  const categories: SettingsNavCategory[] = [
    {
      title: t("dialogs.userSettings.categoryUser"),
      items: [
        {
          id: "profile",
          label: t("dialogs.userSettings.tabProfile"),
          icon: <UserIcon size={16} />,
        },
        {
          id: "account",
          label: t("dialogs.userSettings.tabAccount"),
          icon: <KeyIcon size={16} />,
        },
        {
          id: "privacy",
          label: t("dialogs.userSettings.tabPrivacy"),
          icon: <ShieldIcon size={16} />,
        },
      ],
    },
    {
      title: t("dialogs.userSettings.categoryApp"),
      items: [
        {
          id: "voice",
          label: t("dialogs.userSettings.tabVoice"),
          icon: <MicIcon size={16} />,
        },
        {
          id: "appearance",
          label: t("dialogs.userSettings.tabAppearance"),
          icon: <PaletteIcon size={16} />,
        },
        {
          id: "language",
          label: t("dialogs.userSettings.tabLanguage"),
          icon: <GlobeIcon size={16} />,
        },
        {
          id: "startup",
          label: t("dialogs.userSettings.tabStartup"),
          icon: <MonitorIcon size={16} />,
          badge: t("dialogs.userSettings.soonBadge"),
          badgeType: "soon",
        },
      ],
    },
  ];

  const headerElement = (
    <div className="settings-user-header">
      <Avatar user={self} size="md" />
      <div className="settings-user-header__info">
        <span className="settings-user-header__name">{self.nickname}</span>
        <span className="settings-user-header__sub">
          {self.registered ? `@${self.username}` : t("common.guest")}
        </span>
      </div>
    </div>
  );

  const sidebarFooter = (
    <div className="settings-sidebar__footer-content">
      <button
        type="button"
        className="settings-nav-item settings-nav-item--danger"
        onClick={() => {
          onClose();
          disconnect();
        }}
      >
        <span className="settings-nav-item__icon">
          <LogOutIcon size={16} />
        </span>
        <span className="settings-nav-item__label">{t("userPanel.disconnect")}</span>
      </button>
      <div className="settings-sidebar__version-wrap">
        <span className="settings-sidebar__version">Aural Client v0.1.0</span>
      </div>
    </div>
  );

  return (
    <SettingsModal
      headerElement={headerElement}
      categories={categories}
      activeTab={activeTab}
      onSelectTab={(tabId) => setActiveTab(tabId as TabId)}
      onClose={onClose}
      sidebarFooter={sidebarFooter}
    >
      {activeTab === "profile" ? <ProfilePage /> : null}
      {activeTab === "account" ? <AccountPage /> : null}
      {activeTab === "privacy" ? <PrivacyPage /> : null}
      {activeTab === "voice" ? <VoiceAudioPage /> : null}
      {activeTab === "appearance" ? <AppearancePage /> : null}
      {activeTab === "language" ? <LanguagePage /> : null}
      {activeTab === "startup" ? <StartupPage /> : null}
    </SettingsModal>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Profile                                                               */
/* -------------------------------------------------------------------------- */

function ProfilePage() {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const server = useSession((state) => state.server);
  const setNickname = useSession((state) => state.setNickname);
  const permissions = useMyPermissions();

  const [nickname, setNicknameValue] = useState(self?.nickname ?? "");
  const [customStatus, setCustomStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const allowed = has(permissions, Perm.ChangeNickname);
  const isDirty = nickname.trim() !== (self?.nickname ?? "") && nickname.trim() !== "";

  async function handleSave(event?: FormEvent) {
    if (event) event.preventDefault();
    if (!isDirty || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await setNickname(nickname.trim());
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.profile.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.profile.desc")}
        </p>
      </header>

      {error ? <div className="alert alert--danger">{error}</div> : null}
      {saved ? <div className="alert alert--info">{t("common.save")}</div> : null}

      <div className="settings-grid-2">
        {/* Left Column: Form Controls */}
        <form onSubmit={(e) => void handleSave(e)} className="settings-form">
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.profile.nickname")}
            </h3>
            <p className="settings-card__subtitle">
              {allowed
                ? t("dialogs.userSettings.profile.nicknameHint")
                : t("errors.forbidden")}
            </p>

            <div className="field" style={{ marginTop: 12 }}>
              <input
                id="profile-nickname"
                className="input"
                value={nickname}
                onChange={(e) => {
                  setNicknameValue(e.target.value);
                  setSaved(false);
                }}
                maxLength={32}
                disabled={!allowed}
                placeholder={self?.nickname}
              />
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!isDirty || busy || !allowed}
              >
                {busy ? t("common.loading") : t("common.save")}
              </button>
              {isDirty ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setNicknameValue(self?.nickname ?? "")}
                  disabled={busy}
                >
                  {t("dialogs.userSettings.reset")}
                </button>
              ) : null}
            </div>
          </div>

          <div className="settings-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.profile.statusTitle")}
              </h3>
              <span className="settings-badge settings-badge--soon">
                {t("dialogs.userSettings.soonBadge")}
              </span>
            </div>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.profile.desc")}
            </p>
            <div className="field" style={{ marginTop: 12 }}>
              <input
                className="input"
                value={customStatus}
                onChange={(e) => setCustomStatus(e.target.value)}
                placeholder={t("dialogs.userSettings.profile.statusPlaceholder")}
                maxLength={128}
              />
            </div>
          </div>

          <div className="settings-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.profile.avatarTitle")}
              </h3>
              <span className="settings-badge settings-badge--soon">
                {t("dialogs.userSettings.soonBadge")}
              </span>
            </div>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.profile.avatarDesc")}
            </p>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn--ghost" disabled>
                <SparklesIcon size={16} />
                {t("dialogs.userSettings.soonBadge")}
              </button>
            </div>
          </div>
        </form>

        {/* Right Column: Live Profile Card Preview */}
        <div className="settings-preview-wrap">
          <h3 className="settings-card__title" style={{ marginBottom: 8 }}>
            {t("dialogs.userSettings.profile.previewTitle")}
          </h3>
          <div className="profile-card-preview">
            <div className="profile-card-preview__banner" />
            <div className="profile-card-preview__avatar-row">
              {self ? <Avatar user={self} size="lg" online /> : null}
            </div>
            <div className="profile-card-preview__body">
              <div className="profile-card-preview__name">
                {nickname.trim() || self?.nickname || "User"}
              </div>
              <div className="profile-card-preview__username">
                {self?.registered ? `@${self.username}` : t("common.guest")}
              </div>
              {customStatus ? (
                <div className="profile-card-preview__status-text">
                  💬 {customStatus}
                </div>
              ) : null}

              <div className="profile-card-preview__divider" />

              <div className="profile-card-preview__section">
                <span className="profile-card-preview__label">
                  {server?.name ? server.name : "Server"}
                </span>
                <span className="profile-card-preview__value">
                  {self?.registered ? t("dialogs.member.registeredUser") : t("dialogs.member.guestUser")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Account                                                               */
/* -------------------------------------------------------------------------- */

function AccountPage() {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const server = useSession((state) => state.server);
  const permissions = useMyPermissions();
  const register = useSession((state) => state.register);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canRegister = (server?.registrationEnabled ?? false) && has(permissions, Perm.Register);

  async function submitRegister(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError(t("errors.invalid_credentials"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(username.trim(), password);
      setPassword("");
      setConfirm("");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.account.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.account.desc")}
        </p>
      </header>

      {self?.registered ? (
        <div className="settings-card settings-card--highlight">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="settings-card__icon-badge" style={{ background: "rgba(59, 165, 93, 0.15)", color: "var(--online)" }}>
              <CheckIcon size={20} />
            </span>
            <div>
              <h3 className="settings-card__title">
                {t("dialogs.account.registeredTitle")}: @{self.username}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.account.registeredDesc", { username: self.username })}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-card settings-card--highlight">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span className="settings-card__icon-badge" style={{ background: "rgba(224, 160, 48, 0.15)", color: "var(--warning)" }}>
              <LockIcon size={20} />
            </span>
            <div>
              <h3 className="settings-card__title">{t("dialogs.account.guestNoticeTitle")}</h3>
              <p className="settings-card__subtitle" style={{ marginTop: 4 }}>
                {t("dialogs.account.guestNoticeDesc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {!self?.registered ? (
        <div className="settings-card" style={{ marginTop: 16 }}>
          <h3 className="settings-card__title">{t("dialogs.account.registerTitle")}</h3>
          <p className="settings-card__subtitle">{t("dialogs.account.registerDesc")}</p>

          {!canRegister ? (
            <p className="alert alert--danger" style={{ marginTop: 12 }}>
              {t("errors.registration_closed")}
            </p>
          ) : null}

          {error ? (
            <p className="alert alert--danger" style={{ marginTop: 12 }}>
              {error}
            </p>
          ) : null}

          <form onSubmit={(e) => void submitRegister(e)} className="settings-form" style={{ marginTop: 16 }}>
            <div className="field">
              <label className="field__label" htmlFor="claim-username">
                {t("dialogs.account.username")}
              </label>
              <input
                id="claim-username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={!canRegister || busy}
                required
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="claim-password">
                {t("dialogs.account.password")}
              </label>
              <input
                id="claim-password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={!canRegister || busy}
                required
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="claim-confirm">
                {t("dialogs.account.confirmPassword")}
              </label>
              <input
                id="claim-confirm"
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={!canRegister || busy}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !canRegister || !username.trim() || !password}
            >
              {busy ? t("common.loading") : t("dialogs.account.registerButton")}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Privacy & Safety                                                      */
/* -------------------------------------------------------------------------- */

function PrivacyPage() {
  const { t } = useTranslation();
  const [allowDMs, setAllowDMs] = useState(true);
  const [telemetry, setTelemetry] = useState(false);
  const [embeds, setEmbeds] = useState(true);
  const [friendScope, setFriendScope] = useState<"everyone" | "mutual">("everyone");

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.privacy.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.privacy.desc")}
        </p>
      </header>

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.privacy.dmTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.privacy.dmDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={allowDMs}
              onChange={(e) => setAllowDMs(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title">
          {t("dialogs.userSettings.privacy.friendRequestsTitle")}
        </h3>
        <div className="settings-radio-group" style={{ marginTop: 12 }}>
          <label className="settings-radio-card">
            <input
              type="radio"
              name="friend-scope"
              checked={friendScope === "everyone"}
              onChange={() => setFriendScope("everyone")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.privacy.friendEveryone")}
              </span>
            </span>
          </label>

          <label className="settings-radio-card">
            <input
              type="radio"
              name="friend-scope"
              checked={friendScope === "mutual"}
              onChange={() => setFriendScope("mutual")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.privacy.friendMutual")}
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.privacy.embedsTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.privacy.embedsDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={embeds}
              onChange={(e) => setEmbeds(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.privacy.dataTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.privacy.dataDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={telemetry}
              onChange={(e) => setTelemetry(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Voice & Audio (Interactive Microphone Tester & Sound Device Select)   */
/* -------------------------------------------------------------------------- */

function VoiceAudioPage() {
  const { t } = useTranslation();
  const [inputVolume, setInputVolume] = useState(85);
  const [outputVolume, setOutputVolume] = useState(100);
  const [inputMode, setInputMode] = useState<"activity" | "ptt">("activity");
  const [pttKey, setPttKey] = useState("V");
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [echoCancellation, setEchoCancellation] = useState(true);
  const [gainControl, setGainControl] = useState(true);

  // Audio Testing Simulation / Visualizer
  const [testingMic, setTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!testingMic) {
      setMicLevel(0);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    let phase = 0;
    function animate() {
      phase += 0.08;
      // Simulated natural voice level fluctuations between 20% and 90%
      const base = 40 + Math.sin(phase) * 30 + Math.sin(phase * 2.3) * 15;
      const noise = (Math.random() - 0.5) * 12;
      const val = Math.max(5, Math.min(100, base + noise));
      setMicLevel(val);
      animationRef.current = requestAnimationFrame(animate);
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [testingMic]);

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.voice.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.voice.desc")}
        </p>
      </header>

      {/* Input & Output Devices Grid */}
      <div className="settings-grid-2">
        <div className="settings-card">
          <label className="settings-card__title" htmlFor="voice-input-dev">
            {t("dialogs.userSettings.voice.inputDevice")}
          </label>
          <div style={{ marginTop: 8 }}>
            <select id="voice-input-dev" className="select" defaultValue="default">
              <option value="default">Default Input (Realtek High Definition Audio)</option>
              <option value="usb-mic">USB Microphone (Cardioid Pattern)</option>
              <option value="headset-mic">Headset Microphone (Hands-Free AG Audio)</option>
            </select>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span className="field__label">{t("dialogs.userSettings.voice.inputVolume")}</span>
              <span className="field__hint">{inputVolume}%</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={100}
              value={inputVolume}
              onChange={(e) => setInputVolume(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="settings-card">
          <label className="settings-card__title" htmlFor="voice-output-dev">
            {t("dialogs.userSettings.voice.outputDevice")}
          </label>
          <div style={{ marginTop: 8 }}>
            <select id="voice-output-dev" className="select" defaultValue="default">
              <option value="default">Default Output (Speakers / Headphones)</option>
              <option value="headphones">Headphones (Realtek Audio)</option>
              <option value="digital-out">Digital Output (S/PDIF)</option>
            </select>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span className="field__label">{t("dialogs.userSettings.voice.outputVolume")}</span>
              <span className="field__hint">{outputVolume}%</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={100}
              value={outputVolume}
              onChange={(e) => setOutputVolume(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* Mic Test Section */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title">{t("dialogs.userSettings.voice.micTestTitle")}</h3>
        <p className="settings-card__subtitle">{t("dialogs.userSettings.voice.micTestPrompt")}</p>

        <div className="mic-test-row" style={{ marginTop: 14 }}>
          <button
            type="button"
            className={testingMic ? "btn btn--danger" : "btn btn--primary"}
            onClick={() => setTestingMic((prev) => !prev)}
          >
            <MicIcon size={16} />
            {testingMic
              ? t("dialogs.userSettings.voice.stopMic")
              : t("dialogs.userSettings.voice.checkMic")}
          </button>

          <div className="mic-meter-bar">
            <div
              className="mic-meter-bar__fill"
              style={{
                width: `${testingMic ? micLevel : 0}%`,
                background:
                  micLevel > 80
                    ? "var(--danger)"
                    : micLevel > 30
                      ? "var(--accent)"
                      : "var(--online)",
              }}
            />
            {/* Threshold indicator line */}
            <div className="mic-meter-bar__threshold" style={{ left: "35%" }} title="Threshold" />
          </div>
        </div>
      </div>

      {/* Input Mode */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title">{t("dialogs.userSettings.voice.inputMode")}</h3>
        <div className="settings-radio-group" style={{ marginTop: 12 }}>
          <label className="settings-radio-card">
            <input
              type="radio"
              name="input-mode"
              checked={inputMode === "activity"}
              onChange={() => setInputMode("activity")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.voice.voiceActivity")}
              </span>
            </span>
          </label>

          <label className="settings-radio-card">
            <input
              type="radio"
              name="input-mode"
              checked={inputMode === "ptt"}
              onChange={() => setInputMode("ptt")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.voice.pushToTalk")}
              </span>
            </span>
          </label>
        </div>

        {inputMode === "ptt" ? (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <span className="field__label">{t("dialogs.userSettings.voice.pushToTalkKey")}</span>
            <div className="kbd" style={{ padding: "6px 14px", fontSize: 13 }}>
              {pttKey}
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                const key = prompt("Press key (e.g. V, Space, CapsLock):", pttKey);
                if (key) setPttKey(key.toUpperCase());
              }}
            >
              {t("common.edit")}
            </button>
          </div>
        ) : null}
      </div>

      {/* Advanced Audio Processing */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title">{t("dialogs.userSettings.voice.processingTitle")}</h3>

        <div className="settings-row" style={{ marginTop: 14 }}>
          <div className="settings-row__info">
            <h4 className="settings-card__title">{t("dialogs.userSettings.voice.noiseSuppression")}</h4>
            <p className="settings-card__subtitle">{t("dialogs.userSettings.voice.noiseSuppressionDesc")}</p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={noiseSuppression}
              onChange={(e) => setNoiseSuppression(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h4 className="settings-card__title">{t("dialogs.userSettings.voice.echoCancellation")}</h4>
            <p className="settings-card__subtitle">{t("dialogs.userSettings.voice.echoCancellationDesc")}</p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={echoCancellation}
              onChange={(e) => setEchoCancellation(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h4 className="settings-card__title">{t("dialogs.userSettings.voice.gainControl")}</h4>
            <p className="settings-card__subtitle">{t("dialogs.userSettings.voice.gainControlDesc")}</p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={gainControl}
              onChange={(e) => setGainControl(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Appearance                                                            */
/* -------------------------------------------------------------------------- */

function AppearancePage() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<"dark" | "oled" | "system">("dark");
  const [density, setDensity] = useState<"cozy" | "compact">("cozy");
  const [fontSize, setFontSize] = useState(15);

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.appearance.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.appearance.desc")}
        </p>
      </header>

      {/* Theme Cards */}
      <div className="settings-card">
        <h3 className="settings-card__title">{t("dialogs.userSettings.appearance.themeTitle")}</h3>
        <div className="settings-theme-grid" style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`theme-card ${theme === "dark" ? "theme-card--active" : ""}`}
            onClick={() => setTheme("dark")}
          >
            <div className="theme-card__preview theme-card__preview--dark">
              <div className="theme-card__preview-sidebar" />
              <div className="theme-card__preview-main" />
            </div>
            <span className="theme-card__label">{t("dialogs.userSettings.appearance.themeDark")}</span>
          </button>

          <button
            type="button"
            className={`theme-card ${theme === "oled" ? "theme-card--active" : ""}`}
            onClick={() => setTheme("oled")}
          >
            <div className="theme-card__preview theme-card__preview--oled">
              <div className="theme-card__preview-sidebar" />
              <div className="theme-card__preview-main" />
            </div>
            <span className="theme-card__label">{t("dialogs.userSettings.appearance.themeOled")}</span>
          </button>

          <button
            type="button"
            className={`theme-card ${theme === "system" ? "theme-card--active" : ""}`}
            onClick={() => setTheme("system")}
          >
            <div className="theme-card__preview theme-card__preview--system">
              <div className="theme-card__preview-sidebar" />
              <div className="theme-card__preview-main" />
            </div>
            <span className="theme-card__label">{t("dialogs.userSettings.appearance.themeSystem")}</span>
          </button>
        </div>
      </div>

      {/* Message Density */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title">{t("dialogs.userSettings.appearance.densityTitle")}</h3>
        <div className="settings-radio-group" style={{ marginTop: 12 }}>
          <label className="settings-radio-card">
            <input
              type="radio"
              name="msg-density"
              checked={density === "cozy"}
              onChange={() => setDensity("cozy")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.appearance.densityCozy")}
              </span>
            </span>
          </label>

          <label className="settings-radio-card">
            <input
              type="radio"
              name="msg-density"
              checked={density === "compact"}
              onChange={() => setDensity("compact")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.appearance.densityCompact")}
              </span>
            </span>
          </label>
        </div>

        {/* Font scale slider */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span className="field__label">{t("dialogs.userSettings.appearance.fontScaling")}</span>
            <span className="field__hint">{fontSize}px</span>
          </div>
          <input
            type="range"
            className="slider"
            min={12}
            max={20}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Chat Preview */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title" style={{ marginBottom: 12 }}>
          {t("dialogs.userSettings.appearance.previewTitle")}
        </h3>
        <div
          className={`chat-preview-box ${density === "compact" ? "chat-preview-box--compact" : ""}`}
          style={{ fontSize: `${fontSize}px` }}
        >
          <div className="chat-preview-item">
            <div className="chat-preview-avatar">A</div>
            <div className="chat-preview-content">
              <div className="chat-preview-header">
                <span className="chat-preview-author" style={{ color: "var(--accent)" }}>Aural Bot</span>
                <span className="chat-preview-time">Today at 12:00 PM</span>
              </div>
              <div className="chat-preview-msg">
                Welcome to Aural! This is how your chat messages will appear.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Language                                                              */
/* -------------------------------------------------------------------------- */

function LanguagePage() {
  const { t, language, setLanguage, supportedLanguages } = useTranslation();

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.account.languageSetting")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.account.languageDesc")}
        </p>
      </header>

      <div className="settings-lang-grid">
        {supportedLanguages.map((lang) => {
          const isSelected = lang.code === language;
          return (
            <button
              key={lang.code}
              type="button"
              className={`lang-card ${isSelected ? "lang-card--selected" : ""}`}
              onClick={() => setLanguage(lang.code)}
            >
              <div className="lang-card__info">
                <span className="lang-card__native">{lang.nativeName}</span>
                {lang.name !== lang.nativeName ? (
                  <span className="lang-card__name">{lang.name}</span>
                ) : null}
              </div>
              {isSelected ? (
                <span className="lang-card__check">
                  <CheckIcon size={18} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Windows & Startup (Placeholder with interactive controls)             */
/* -------------------------------------------------------------------------- */

function StartupPage() {
  const { t } = useTranslation();
  const [startup, setStartup] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [hwAccel, setHwAccel] = useState(true);

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.startup.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.startup.desc")}
        </p>
      </header>

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.launchOnStartup")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.launchOnStartupDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={startup}
              onChange={(e) => setStartup(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.startMinimized")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.startMinimizedDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={minimized}
              onChange={(e) => setMinimized(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.minimizeToTray")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.minimizeToTrayDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={closeToTray}
              onChange={(e) => setCloseToTray(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.notifications")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.notificationsDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={notifications}
              onChange={(e) => setNotifications(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.hardwareAcceleration")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.hardwareAccelerationDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={hwAccel}
              onChange={(e) => setHwAccel(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>
    </div>
  );
}
