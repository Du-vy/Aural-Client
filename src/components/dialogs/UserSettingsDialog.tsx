import { useState, useEffect, useRef, type FormEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import {
  useTheme,
  FONT_OPTIONS,
  readActiveBackground,
  writeActiveBackground,
  type ThemeColors,
  type AuralTheme,
} from "@/lib/theme";
import {
  readDensity,
  writeDensity,
  type MessageDensity,
} from "@/lib/storage";
import { formatBytes, parseBytes } from "@/lib/uploads";
import {
  SettingsModal,
  type SettingsNavCategory,
} from "../SettingsModal";
import { Avatar, resolveAvatarUrl } from "../Avatar";
import { ImageCropDialog } from "./ImageCropDialog";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  GlobeIcon,
  ImageIcon,
  KeyIcon,
  LockIcon,
  LogOutIcon,
  MicIcon,
  MonitorIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldIcon,
  SlidersIcon,
  TrashIcon,
  UploadIcon,
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
      <Avatar user={self} size="md" status={self.status} showStatus />
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
  const address = useSession((state) => state.address);
  const setNickname = useSession((state) => state.setNickname);
  const setStatus = useSession((state) => state.setStatus);
  const updateProfile = useSession((state) => state.updateProfile);
  const uploadAvatar = useSession((state) => state.uploadAvatar);
  const uploadBanner = useSession((state) => state.uploadBanner);
  const permissions = useMyPermissions();

  const [nickname, setNicknameValue] = useState(self?.nickname ?? "");
  const [selectedStatus, setSelectedStatus] = useState<"online" | "idle" | "dnd" | "invisible">(
    (self?.status as "online" | "idle" | "dnd" | "invisible") || "online",
  );
  const [customStatus, setCustomStatus] = useState(self?.customStatus ?? "");
  const [avatarUrlInput, setAvatarUrlInput] = useState(self?.avatar ?? "");
  const [bannerUrlInput, setBannerUrlInput] = useState(self?.banner ?? "");
  const [cropFile, setCropFile] = useState<{ file: File; type: "avatar" | "banner" } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const allowedNickname = has(permissions, Perm.ChangeNickname);

  const maxAvatarBytes = parseBytes(server?.uploads?.maxAvatarBytes) || 8 * 1024 * 1024;
  const maxBannerBytes = parseBytes(server?.uploads?.maxBannerBytes) || 16 * 1024 * 1024;

  const bannerSrc = resolveAvatarUrl(bannerUrlInput || self?.banner, address);
  const isNicknameDirty = nickname.trim() !== (self?.nickname ?? "") && nickname.trim() !== "";
  const isCustomStatusDirty = customStatus.trim() !== (self?.customStatus ?? "");

  async function handleSaveNickname(event?: FormEvent) {
    if (event) event.preventDefault();
    if (!isNicknameDirty || busy) return;
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

  async function handleStatusChange(newStatus: "online" | "idle" | "dnd" | "invisible") {
    setSelectedStatus(newStatus);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await setStatus(newStatus);
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCustomStatus(event?: FormEvent) {
    if (event) event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ customStatus: customStatus.trim() });
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyAvatarUrl(event?: FormEvent) {
    if (event) event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ avatar: avatarUrlInput.trim() || null });
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ avatar: null });
      setAvatarUrlInput("");
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyBannerUrl(event?: FormEvent) {
    if (event) event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ banner: bannerUrlInput.trim() || null });
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveBanner() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ banner: null });
      setBannerUrlInput("");
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>, type: "avatar" | "banner") {
    const file = e.target.files?.[0];
    if (!file) return;
    const max = type === "avatar" ? maxAvatarBytes : maxBannerBytes;
    if (file.size > max) {
      setError(t("crop.fileTooLarge", { max: formatBytes(max) }));
      e.target.value = "";
      return;
    }
    setError(null);
    setCropFile({ file, type });
    e.target.value = "";
  }

  async function handleCropConfirm(croppedFile: File) {
    const type = cropFile?.type;
    setCropFile(null);
    if (!type) return;

    setBusy(true);
    setError(null);
    setSaved(false);
    setUploadProgress(0);
    try {
      if (type === "avatar") {
        const res = await uploadAvatar(croppedFile, (fraction) => setUploadProgress(fraction));
        setAvatarUrlInput(res.url);
      } else {
        const res = await uploadBanner(croppedFile, (fraction) => setUploadProgress(fraction));
        setBannerUrlInput(res.url);
      }
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
      setUploadProgress(null);
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
      {saved ? <div className="alert alert--info">{t("common.saved")}</div> : null}
      {uploadProgress !== null ? (
        <div className="alert alert--info">
          {t("common.loading")} {Math.round(uploadProgress * 100)}%
        </div>
      ) : null}

      <div className="settings-grid-2">
        {/* Left Column: Form Controls */}
        <div className="settings-form">
          {/* Status Selection Card */}
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("status.title")}
            </h3>
            <p className="settings-card__subtitle">
              {t("status.selectStatusHint")}
            </p>
            <div className="status-grid-options" style={{ marginTop: 12 }}>
              {(
                [
                  { id: "online", title: "status.online", desc: "status.onlineDesc", color: "#23a55a" },
                  { id: "idle", title: "status.idle", desc: "status.idleDesc", color: "#f0b232" },
                  { id: "dnd", title: "status.dnd", desc: "status.dndDesc", color: "#f23f43" },
                  { id: "invisible", title: "status.invisible", desc: "status.invisibleDesc", color: "#80848e" },
                ] as const
              ).map((opt) => {
                const isSelected = selectedStatus === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`status-card-opt ${isSelected ? "status-card-opt--active" : ""}`}
                    onClick={() => void handleStatusChange(opt.id)}
                    disabled={busy}
                  >
                    <span className="status-card-opt__dot-wrap">
                      <span
                        className={`status-popover__dot status-popover__dot--${opt.id}`}
                        style={{ backgroundColor: opt.id === "invisible" ? "transparent" : opt.color }}
                      >
                        {opt.id === "dnd" ? (
                          <svg viewBox="0 0 10 10" className="avatar__badge-icon">
                            <circle cx="5" cy="5" r="5" fill="#f23f43" />
                            <rect x="2" y="4" width="6" height="2" rx="0.75" fill="#ffffff" />
                          </svg>
                        ) : opt.id === "idle" ? (
                          <svg viewBox="0 0 10 10" className="avatar__badge-icon">
                            <circle cx="5" cy="5" r="5" fill="#f0b232" />
                            <path d="M6.8 1.5A4 4 0 1 0 8.5 7.2 4.5 4.5 0 0 1 6.8 1.5z" fill="#1e1f22" opacity="0.9" />
                          </svg>
                        ) : opt.id === "invisible" ? (
                          <svg viewBox="0 0 10 10" className="avatar__badge-icon">
                            <circle cx="5" cy="5" r="3.75" fill="none" stroke="#80848e" strokeWidth="2.2" />
                          </svg>
                        ) : null}
                      </span>
                    </span>
                    <div className="status-card-opt__info">
                      <span className="status-card-opt__name">{t(opt.title)}</span>
                      <span className="status-card-opt__desc">{t(opt.desc)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Status Card */}
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("status.customStatusTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("status.customStatusDesc")}
            </p>
            <form onSubmit={(e) => void handleSaveCustomStatus(e)} style={{ marginTop: 12 }}>
              <div className="field">
                <input
                  className="input"
                  value={customStatus}
                  onChange={(e) => {
                    setCustomStatus(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={t("status.customPlaceholder")}
                  maxLength={128}
                />
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button
                  type="submit"
                  className="btn btn--primary btn--sm"
                  disabled={!isCustomStatusDirty || busy}
                >
                  {busy ? t("common.loading") : t("common.save")}
                </button>
                {self?.customStatus ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setCustomStatus("");
                      void updateProfile({ customStatus: "" });
                    }}
                    disabled={busy}
                  >
                    {t("common.delete")}
                  </button>
                ) : null}
              </div>
            </form>
          </div>

          {/* Nickname Card */}
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.profile.nickname")}
            </h3>
            <p className="settings-card__subtitle">
              {allowedNickname
                ? t("dialogs.userSettings.profile.nicknameHint")
                : t("errors.forbidden")}
            </p>

            <form onSubmit={(e) => void handleSaveNickname(e)} style={{ marginTop: 12 }}>
              <div className="field">
                <input
                  id="profile-nickname"
                  className="input"
                  value={nickname}
                  onChange={(e) => {
                    setNicknameValue(e.target.value);
                    setSaved(false);
                  }}
                  maxLength={32}
                  disabled={!allowedNickname}
                  placeholder={self?.nickname}
                />
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button
                  type="submit"
                  className="btn btn--primary btn--sm"
                  disabled={!isNicknameDirty || busy || !allowedNickname}
                >
                  {busy ? t("common.loading") : t("common.save")}
                </button>
                {isNicknameDirty ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setNicknameValue(self?.nickname ?? "")}
                    disabled={busy}
                  >
                    {t("dialogs.userSettings.reset")}
                  </button>
                ) : null}
              </div>
            </form>
          </div>

          {/* Avatar Settings Card */}
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("profile.avatarTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("profile.avatarDesc", { max: formatBytes(maxAvatarBytes) })}
            </p>

            <input
              type="file"
              ref={avatarInputRef}
              style={{ display: "none" }}
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
              onChange={(e) => handleFileSelected(e, "avatar")}
            />

            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => avatarInputRef.current?.click()}
                disabled={busy}
              >
                <UploadIcon size={14} />
                <span>{t("profile.uploadAvatar")}</span>
              </button>
              {self?.avatar ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void handleRemoveAvatar()}
                  disabled={busy}
                >
                  <TrashIcon size={14} />
                  <span>{t("profile.removeAvatar")}</span>
                </button>
              ) : null}
            </div>

            {/* URL input fallback */}
            <form onSubmit={(e) => void handleApplyAvatarUrl(e)} style={{ marginTop: 14 }}>
              <span className="profile-input-label">{t("profile.orEnterUrl")}</span>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <input
                  className="input input--sm"
                  value={avatarUrlInput}
                  onChange={(e) => setAvatarUrlInput(e.target.value)}
                  placeholder="https://example.com/avatar.png"
                  disabled={busy}
                />
                <button
                  type="submit"
                  className="btn btn--ghost btn--sm"
                  disabled={busy || avatarUrlInput.trim() === (self?.avatar ?? "")}
                >
                  {t("common.apply")}
                </button>
              </div>
            </form>
          </div>

          {/* Banner Settings Card */}
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("profile.bannerTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("profile.bannerDesc", { max: formatBytes(maxBannerBytes) })}
            </p>

            <input
              type="file"
              ref={bannerInputRef}
              style={{ display: "none" }}
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
              onChange={(e) => handleFileSelected(e, "banner")}
            />

            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => bannerInputRef.current?.click()}
                disabled={busy}
              >
                <UploadIcon size={14} />
                <span>{t("profile.uploadBanner")}</span>
              </button>
              {self?.banner ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void handleRemoveBanner()}
                  disabled={busy}
                >
                  <TrashIcon size={14} />
                  <span>{t("profile.removeBanner")}</span>
                </button>
              ) : null}
            </div>

            {/* URL input fallback */}
            <form onSubmit={(e) => void handleApplyBannerUrl(e)} style={{ marginTop: 14 }}>
              <span className="profile-input-label">{t("profile.orEnterUrl")}</span>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <input
                  className="input input--sm"
                  value={bannerUrlInput}
                  onChange={(e) => setBannerUrlInput(e.target.value)}
                  placeholder="https://example.com/banner.png"
                  disabled={busy}
                />
                <button
                  type="submit"
                  className="btn btn--ghost btn--sm"
                  disabled={busy || bannerUrlInput.trim() === (self?.banner ?? "")}
                >
                  {t("common.apply")}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Live Profile Card Preview */}
        <div className="settings-preview-wrap">
          <h3 className="settings-card__title" style={{ marginBottom: 8 }}>
            {t("dialogs.userSettings.profile.previewTitle")}
          </h3>
          <div className="profile-card-preview">
            <div
              className="profile-card-preview__banner"
              style={bannerSrc ? { backgroundImage: `url("${bannerSrc}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            />
            <div className="profile-card-preview__avatar-row">
              {self ? (
                <Avatar
                  user={{
                    ...self,
                    avatar: avatarUrlInput || self.avatar,
                    status: selectedStatus,
                  }}
                  size="lg"
                  status={selectedStatus}
                  showStatus
                />
              ) : null}
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

      {/* Crop Modal when a file is picked */}
      {cropFile ? (
        <ImageCropDialog
          file={cropFile.file}
          type={cropFile.type}
          onConfirm={(cropped) => void handleCropConfirm(cropped)}
          onClose={() => setCropFile(null)}
        />
      ) : null}
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
  const {
    activeTheme,
    allThemes,
    setActiveTheme,
    createCustomTheme,
    duplicateTheme,
    renameCustomTheme,
    deleteCustomTheme,
    resetToDefaultTheme,
    exportThemeToFile,
    importThemeFromFile,
    updateActiveColors,
    updateActiveBackground,
    updateActiveFont,
    updateActiveFontSize,
  } = useTheme();

  const [density, setDensityState] = useState<MessageDensity>(readDensity);
  const [feedback, setFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const setDensity = (d: MessageDensity) => {
    setDensityState(d);
    writeDensity(d);
  };

  // Modals / prompts state
  const [isCreating, setIsCreating] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const colorFields: { key: keyof ThemeColors; label: string }[] = [
    { key: "bgMain", label: t("dialogs.userSettings.appearance.colorMain") },
    { key: "bgSidebar", label: t("dialogs.userSettings.appearance.colorSidebar") },
    { key: "bgRail", label: t("dialogs.userSettings.appearance.colorRail") },
    { key: "bgRaised", label: t("dialogs.userSettings.appearance.colorRaised") },
    { key: "bgOverlay", label: t("dialogs.userSettings.appearance.colorOverlay") },
    { key: "bgInput", label: t("dialogs.userSettings.appearance.colorInput") },
    { key: "accent", label: t("dialogs.userSettings.appearance.colorAccent") },
    { key: "text", label: t("dialogs.userSettings.appearance.colorText") },
    { key: "textMuted", label: t("dialogs.userSettings.appearance.colorTextMuted") },
    { key: "danger", label: t("dialogs.userSettings.appearance.colorDanger") },
  ];

  const showFeedback = (msg: string, type: "success" | "error") => {
    setFeedback({ msg, type });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importThemeFromFile(file);
      showFeedback(`${t("dialogs.userSettings.appearance.importSuccess")} (${imported.name})`, "success");
    } catch {
      showFeedback(t("dialogs.userSettings.appearance.importError"), "error");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleExport = async (themeToExport: AuralTheme) => {
    try {
      const saved = await exportThemeToFile(themeToExport);
      if (saved) {
        showFeedback(`${t("dialogs.userSettings.appearance.exportSuccess")} (${themeToExport.name})`, "success");
      }
    } catch {
      showFeedback(t("dialogs.userSettings.appearance.exportError"), "error");
    }
  };

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateActiveBackground({ imageUrl: reader.result });
        showFeedback("¡Fondo de pantalla aplicado correctamente!", "success");
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
    if (imgInputRef.current) imgInputRef.current.value = "";
  };

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!newThemeName.trim()) return;
    const created = createCustomTheme(newThemeName.trim());
    setIsCreating(false);
    setNewThemeName("");
    showFeedback(`Tema "${created.name}" creado con éxito`, "success");
  };

  const handleRenameSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!renamingId || !renameValue.trim()) return;
    renameCustomTheme(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };

  const handleDeleteConfirm = () => {
    if (!deletingId) return;
    deleteCustomTheme(deletingId);
    setDeletingId(null);
  };

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

      {feedback && (
        <div className={`alert ${feedback.type === "error" ? "alert--danger" : "alert--info"}`} style={{ marginBottom: 12 }}>
          {feedback.msg}
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".json,.auraltheme"
        style={{ display: "none" }}
        onChange={handleImport}
      />
      <input
        type="file"
        ref={imgInputRef}
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleBgUpload}
      />

      {/* Theme Selection Grid */}
      <div className="settings-card">
        <div className="settings-theme-header-row">
          <div>
            <h3 className="settings-card__title">{t("dialogs.userSettings.appearance.themeTitle")}</h3>
            <p className="field__hint" style={{ marginTop: 2 }}>
              {t("dialogs.userSettings.appearance.themeDesc")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--primary"
              style={{ padding: "6px 12px", fontSize: 13 }}
              onClick={() => setIsCreating(true)}
            >
              <PlusIcon size={14} />
              {t("dialogs.userSettings.appearance.newTheme")}
            </button>
            <button
              type="button"
              className="btn"
              style={{ padding: "6px 12px", fontSize: 13 }}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadIcon size={14} />
              {t("dialogs.userSettings.appearance.importTheme")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ padding: "6px 10px", fontSize: 13 }}
              onClick={resetToDefaultTheme}
              title={t("dialogs.userSettings.appearance.resetDefault")}
            >
              <RotateCcwIcon size={14} />
            </button>
          </div>
        </div>

        {/* Modal: New Custom Theme */}
        {isCreating && (
          <form onSubmit={handleCreateSubmit} style={{ marginTop: 14, padding: 12, background: "var(--bg-input)", borderRadius: "var(--radius)", border: "1px solid var(--accent)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="field__label">Crear Nuevo Tema Personalizado</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Ej. Cyber Neon, Synthwave..."
                  value={newThemeName}
                  onChange={(e) => setNewThemeName(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn btn--primary" disabled={!newThemeName.trim()}>
                  Crear
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setIsCreating(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Modal: Rename Theme */}
        {renamingId && (
          <form onSubmit={handleRenameSubmit} style={{ marginTop: 14, padding: 12, background: "var(--bg-input)", borderRadius: "var(--radius)", border: "1px solid var(--accent)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="field__label">{t("dialogs.userSettings.appearance.renamePrompt")}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn btn--primary" disabled={!renameValue.trim()}>
                  Guardar
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setRenamingId(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Modal: Delete Theme Confirm */}
        {deletingId && (
          <div style={{ marginTop: 14, padding: 12, background: "var(--danger-soft)", borderRadius: "var(--radius)", border: "1px solid var(--danger)" }}>
            <p style={{ fontSize: 13, marginBottom: 8, color: "var(--text)" }}>
              {t("dialogs.userSettings.appearance.deleteThemeConfirm")}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn--danger" onClick={handleDeleteConfirm}>
                {t("dialogs.userSettings.appearance.deleteTheme")}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setDeletingId(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Theme Cards Grid */}
        <div className="settings-theme-grid" style={{ marginTop: 16 }}>
          {allThemes.map((item) => {
            const isActive = activeTheme.id === item.id;
            return (
              <div
                key={item.id}
                className={`theme-card ${isActive ? "theme-card--active" : ""}`}
                onClick={() => setActiveTheme(item.id)}
              >
                {/* Simulated UI Swatch Preview */}
                <div className="theme-card__swatches">
                  <div
                    className="theme-card__swatch-rail"
                    style={{ background: item.colors.bgRail }}
                  >
                    <div
                      className="theme-card__swatch-dot"
                      style={{ background: item.colors.accent }}
                    />
                  </div>
                  <div
                    className="theme-card__swatch-sidebar"
                    style={{ background: item.colors.bgSidebar }}
                  >
                    <div className="theme-card__swatch-line" style={{ background: item.colors.text }} />
                    <div className="theme-card__swatch-line" style={{ background: item.colors.textMuted }} />
                    <div className="theme-card__swatch-line" style={{ background: item.colors.textMuted }} />
                  </div>
                  <div
                    className="theme-card__swatch-main"
                    style={{ background: item.colors.bgMain }}
                  >
                    <div
                      className="theme-card__swatch-bubble"
                      style={{ background: item.colors.bgRaised }}
                    />
                    <div
                      className="theme-card__swatch-accent-pill"
                      style={{ background: item.colors.accent }}
                    />
                  </div>
                </div>

                <div className="theme-card__info">
                  <div className="theme-card__label-wrap">
                    <span className="theme-card__label">{item.name}</span>
                    <span className="theme-card__badge">
                      {isActive
                        ? t("dialogs.userSettings.appearance.activeBadge")
                        : item.isBuiltin
                        ? t("dialogs.userSettings.appearance.builtinBadge")
                        : t("dialogs.userSettings.appearance.customBadge")}
                    </span>
                  </div>

                  <div className="theme-card__actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="iconbtn"
                      style={{ width: 22, height: 22 }}
                      title={t("dialogs.userSettings.appearance.duplicateTheme")}
                      onClick={() => {
                        const dup = duplicateTheme(item.id);
                        showFeedback(`Tema "${dup.name}" duplicado`, "success");
                      }}
                    >
                      <CopyIcon size={12} />
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      style={{ width: 22, height: 22 }}
                      title={t("dialogs.userSettings.appearance.exportTheme")}
                      onClick={() => void handleExport(item)}
                    >
                      <DownloadIcon size={12} />
                    </button>
                    {!item.isBuiltin && (
                      <>
                        <button
                          type="button"
                          className="iconbtn"
                          style={{ width: 22, height: 22 }}
                          title={t("dialogs.userSettings.appearance.renameTheme")}
                          onClick={() => {
                            setRenamingId(item.id);
                            setRenameValue(item.name);
                          }}
                        >
                          <PencilIcon size={12} />
                        </button>
                        <button
                          type="button"
                          className="iconbtn iconbtn--danger"
                          style={{ width: 22, height: 22 }}
                          title={t("dialogs.userSettings.appearance.deleteTheme")}
                          onClick={() => setDeletingId(item.id)}
                        >
                          <TrashIcon size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Real-time Theme Customizer for Active Theme */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 className="settings-card__title">
            {t("dialogs.userSettings.appearance.themeCustomizerTitle")}: <span style={{ color: "var(--accent)" }}>{activeTheme.name}</span>
          </h3>
          <button
            type="button"
            className="btn btn--ghost"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => void handleExport(activeTheme)}
          >
            <DownloadIcon size={14} />
            {t("dialogs.userSettings.appearance.exportTheme")}
          </button>
        </div>

        {/* 1. Colors Palette */}
        <div className="theme-editor-section" style={{ marginTop: 8, paddingTop: 0, borderTop: "none" }}>
          <span className="theme-editor-title">
            <PaletteIcon size={15} />
            {t("dialogs.userSettings.appearance.colorsTitle")}
          </span>
          <div className="theme-color-grid">
            {colorFields.map((field) => {
              const val = activeTheme.colors[field.key];
              return (
                <div key={field.key} className="theme-color-item">
                  <div className="theme-color-picker-wrap" style={{ backgroundColor: val }}>
                    <input
                      type="color"
                      className="theme-color-picker-input"
                      value={val.startsWith("#") && (val.length === 7 || val.length === 4) ? val : "#12b8a0"}
                      onChange={(e) => updateActiveColors({ [field.key]: e.target.value })}
                    />
                  </div>
                  <div className="theme-color-info">
                    <span className="theme-color-label">
                      {field.label}
                    </span>
                    <span className="theme-color-hex">{val}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Optional Background Image */}
        {(() => {
          const currentBg = activeTheme.background?.imageUrl
            ? activeTheme.background
            : (readActiveBackground() || activeTheme.background);
          const hasImage = Boolean(currentBg?.imageUrl);

          return (
            <div className="theme-editor-section">
              <span className="theme-editor-title">
                <ImageIcon size={15} />
                {t("dialogs.userSettings.appearance.bgTitle")}
              </span>
              <div className="theme-bg-controls">
                <div className="theme-bg-input-row">
                  {hasImage && (
                    <div
                      className="theme-bg-preview"
                      style={{ backgroundImage: `url("${currentBg?.imageUrl}")` }}
                    />
                  )}
                  <input
                    type="text"
                    className="input"
                    placeholder={t("dialogs.userSettings.appearance.bgUrlPlaceholder")}
                    value={currentBg?.imageUrl || ""}
                    onChange={(e) => updateActiveBackground({ imageUrl: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (imgInputRef.current) imgInputRef.current.value = "";
                      imgInputRef.current?.click();
                    }}
                  >
                    <UploadIcon size={14} />
                    {t("dialogs.userSettings.appearance.bgUpload")}
                  </button>
                  {hasImage && (
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={() => {
                        updateActiveBackground({ imageUrl: "" });
                        writeActiveBackground(null);
                        showFeedback("Fondo eliminado", "success");
                      }}
                      title={t("dialogs.userSettings.appearance.bgRemove")}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>

                {hasImage && (
                  <div className="theme-sliders-grid" style={{ marginTop: 6 }}>
                    <div className="theme-slider-box">
                      <div className="theme-slider-header">
                        <span className="field__label">{t("dialogs.userSettings.appearance.bgBlur")}</span>
                        <span className="field__hint">{currentBg?.blur ?? 0}px</span>
                      </div>
                      <input
                        type="range"
                        className="slider"
                        min={0}
                        max={20}
                        value={currentBg?.blur ?? 0}
                        onChange={(e) => updateActiveBackground({ blur: Number(e.target.value) })}
                      />
                    </div>

                    <div className="theme-slider-box">
                      <div className="theme-slider-header">
                        <span className="field__label">{t("dialogs.userSettings.appearance.bgOpacity")}</span>
                        <span className="field__hint">{currentBg?.opacity ?? 100}%</span>
                      </div>
                      <input
                        type="range"
                        className="slider"
                        min={10}
                        max={100}
                        value={currentBg?.opacity ?? 100}
                        onChange={(e) => updateActiveBackground({ opacity: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* 3. Typography & Font Scaling */}
        <div className="theme-editor-section">
          <span className="theme-editor-title">
            <SlidersIcon size={15} />
            {t("dialogs.userSettings.appearance.fontTitle")}
          </span>
          <div className="theme-sliders-grid">
            <div className="field">
              <label className="field__label">{t("dialogs.userSettings.appearance.fontFamily")}</label>
              <select
                className="select"
                value={activeTheme.fontFamily || FONT_OPTIONS[0]!.value}
                onChange={(e) => updateActiveFont(e.target.value)}
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.value} style={{ fontFamily: f.value }}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="theme-slider-box">
              <div className="theme-slider-header">
                <span className="field__label">{t("dialogs.userSettings.appearance.fontSize")}</span>
                <span className="field__hint">{activeTheme.fontSize || 15}px</span>
              </div>
              <input
                type="range"
                className="slider"
                min={12}
                max={20}
                value={activeTheme.fontSize || 15}
                onChange={(e) => updateActiveFontSize(Number(e.target.value))}
              />
            </div>
          </div>
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
      </div>

      {/* Live Chat Preview */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title" style={{ marginBottom: 12 }}>
          {t("dialogs.userSettings.appearance.previewTitle")}
        </h3>
        <div
          className={`chat-preview-box ${density === "compact" ? "chat-preview-box--compact" : ""}`}
          style={{
            fontSize: `${activeTheme.fontSize || 15}px`,
            fontFamily: activeTheme.fontFamily,
          }}
        >
          <div className="chat-preview-item">
            <div className="chat-preview-avatar">A</div>
            <div className="chat-preview-content">
              <div className="chat-preview-header">
                <span className="chat-preview-author" style={{ color: "var(--accent)" }}>Aural Bot</span>
                <span className="chat-preview-time">Today at 12:00 PM</span>
              </div>
              <div className="chat-preview-msg">
                ¡Bienvenido a Aural! Este es un ejemplo de cómo se verá el chat con el tema <strong>{activeTheme.name}</strong> y tu tipografía seleccionada.
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
