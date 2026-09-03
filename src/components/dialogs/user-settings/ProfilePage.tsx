import { useState, useRef, useEffect, type FormEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { formatBytes, parseBytes } from "@/lib/uploads";
import { Avatar, resolveAvatarUrl } from "@/components/Avatar";
import { ImageCropDialog } from "@/components/dialogs/ImageCropDialog";
import {
  CameraIcon,
  CheckIcon,
  ImageIcon,
  TrashIcon,
  UploadIcon,
  UserIcon,
} from "@/components/Icons";

export function ProfilePage() {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const server = useSession((state) => state.server);
  const roles = useSession((state) => state.roles);
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
  const [activeMediaTab, setActiveMediaTab] = useState<"avatar" | "banner">("avatar");

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Auto-dismiss saved message after 4 seconds
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [saved]);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const allowedNickname = has(permissions, Perm.ChangeNickname);

  const maxAvatarBytes = parseBytes(server?.uploads?.maxAvatarBytes) || 8 * 1024 * 1024;
  const maxBannerBytes = parseBytes(server?.uploads?.maxBannerBytes) || 16 * 1024 * 1024;

  const bannerSrc = resolveAvatarUrl(bannerUrlInput || self?.banner, address);
  const heldRoles = (self?.roles ?? [])
    .map((id) => roles.get(id))
    .filter((role) => role !== undefined)
    .sort((a, b) => b.position - a.position);
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

      {error ? (
        <div className="alert alert--danger">
          <span>{error}</span>
        </div>
      ) : null}
      {saved ? (
        <div className="alert alert--info">
          <CheckIcon size={16} />
          <span>{t("common.saved")}</span>
        </div>
      ) : null}
      {uploadProgress !== null ? (
        <div className="alert alert--info">
          <div className="spinner" />
          <span>
            {t("common.loading")} {Math.round(uploadProgress * 100)}%
          </span>
        </div>
      ) : null}

      {/* Hidden file inputs for avatar and banner */}
      <input
        type="file"
        ref={avatarInputRef}
        style={{ display: "none" }}
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
        onChange={(e) => handleFileSelected(e, "avatar")}
      />
      <input
        type="file"
        ref={bannerInputRef}
        style={{ display: "none" }}
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
        onChange={(e) => handleFileSelected(e, "banner")}
      />

      <div className="settings-grid-2">
        {/* Left Column: Form Controls (Streamlined into 2 cohesive cards) */}
        <div className="settings-form">
          {/* Card 1: Identity & Visual Appearance */}
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("profile.identityTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.profile.desc")}
            </p>

            {/* Nickname Input */}
            <div className="profile-field-group" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label htmlFor="profile-nickname" className="profile-input-label" style={{ fontWeight: 600, fontSize: 12 }}>
                  {t("dialogs.userSettings.profile.nickname")}
                </label>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {allowedNickname
                    ? t("dialogs.userSettings.profile.nicknameHint")
                    : t("errors.forbidden")}
                </span>
              </div>

              <form onSubmit={(e) => void handleSaveNickname(e)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  id="profile-nickname"
                  className="input"
                  value={nickname}
                  onChange={(e) => {
                    setNicknameValue(e.target.value);
                    setSaved(false);
                  }}
                  maxLength={32}
                  disabled={!allowedNickname || busy}
                  placeholder={self?.nickname}
                />
                {isNicknameDirty ? (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      type="submit"
                      className="btn btn--primary btn--sm"
                      disabled={busy || !allowedNickname}
                    >
                      {busy ? t("common.loading") : t("common.save")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setNicknameValue(self?.nickname ?? "")}
                      disabled={busy}
                    >
                      {t("dialogs.userSettings.reset")}
                    </button>
                  </div>
                ) : null}
              </form>
            </div>

            <div className="profile-card-divider" />

            {/* Profile Media Controls (Avatar & Banner Tabs) */}
            <div className="profile-media-section">
              <span className="profile-input-label" style={{ fontWeight: 600, fontSize: 12 }}>
                {t("dialogs.userSettings.tabAppearance")}
              </span>

              <div className="profile-media-switcher">
                <button
                  type="button"
                  className={`profile-media-tab-btn ${activeMediaTab === "avatar" ? "profile-media-tab-btn--active" : ""}`}
                  onClick={() => setActiveMediaTab("avatar")}
                >
                  <UserIcon size={14} />
                  <span>{t("profile.mediaTabAvatar")}</span>
                </button>
                <button
                  type="button"
                  className={`profile-media-tab-btn ${activeMediaTab === "banner" ? "profile-media-tab-btn--active" : ""}`}
                  onClick={() => setActiveMediaTab("banner")}
                >
                  <ImageIcon size={14} />
                  <span>{t("profile.mediaTabBanner")}</span>
                </button>
              </div>

              {activeMediaTab === "avatar" ? (
                <div className="profile-media-panel">
                  <div className="profile-media-actions">
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

                  <span className="profile-media-specs">
                    {t("profile.avatarDesc", { max: formatBytes(maxAvatarBytes) })}
                  </span>

                  <form onSubmit={(e) => void handleApplyAvatarUrl(e)} className="profile-media-url-row">
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
              ) : (
                <div className="profile-media-panel">
                  <div className="profile-media-actions">
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

                  <span className="profile-media-specs">
                    {t("profile.bannerDesc", { max: formatBytes(maxBannerBytes) })}
                  </span>

                  <form onSubmit={(e) => void handleApplyBannerUrl(e)} className="profile-media-url-row">
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
              )}
            </div>
          </div>

          {/* Card 2: Status & Presence */}
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("profile.presenceTitle")}
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

            <div className="profile-card-divider" />

            {/* Custom Status Message */}
            <div className="profile-field-group">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label htmlFor="profile-custom-status" className="profile-input-label" style={{ fontWeight: 600, fontSize: 12 }}>
                  {t("status.customStatusTitle")}
                </label>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {t("status.customStatusDesc")}
                </span>
              </div>

              <form onSubmit={(e) => void handleSaveCustomStatus(e)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  id="profile-custom-status"
                  className="input"
                  value={customStatus}
                  onChange={(e) => {
                    setCustomStatus(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={t("status.customPlaceholder")}
                  maxLength={128}
                  disabled={busy}
                />
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
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
                      title={t("common.delete")}
                    >
                      <TrashIcon size={14} />
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Right Column: Live Profile Card Preview with Click-to-Edit & Sticky Layout */}
        <div className="settings-preview-wrap">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <h3 className="settings-card__title" style={{ margin: 0 }}>
              {t("dialogs.userSettings.profile.previewTitle")}
            </h3>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {server?.name ? server.name : "Aural"}
            </span>
          </div>

          <div className="profile-card-preview">
            {/* Clickable Banner */}
            <div
              className="profile-card-preview__banner profile-card-preview__banner--editable"
              role="button"
              tabIndex={0}
              title={t("profile.changeBanner")}
              aria-label={t("profile.changeBanner")}
              onClick={() => bannerInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  bannerInputRef.current?.click();
                }
              }}
              style={
                bannerSrc
                  ? { backgroundImage: `url("${bannerSrc}")` }
                  : {
                      background: `linear-gradient(135deg, var(--accent, #5865F2) 0%, #0b5c51 100%)`,
                    }
              }
            >
              <div className="profile-card-preview__banner-overlay">
                <span className="profile-card-preview__banner-badge">
                  <CameraIcon size={14} />
                  <span>{t("profile.changeBanner")}</span>
                </span>
              </div>

              {self?.banner ? (
                <button
                  type="button"
                  className="profile-card-preview__banner-remove"
                  title={t("profile.removeBanner")}
                  aria-label={t("profile.removeBanner")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRemoveBanner();
                  }}
                  disabled={busy}
                >
                  <TrashIcon size={13} />
                </button>
              ) : null}
            </div>

            {/* Avatar Row with Clickable Avatar */}
            <div className="profile-card-preview__avatar-row">
              <div
                className="profile-card-preview__avatar-wrap profile-card-preview__avatar-wrap--editable"
                role="button"
                tabIndex={0}
                title={t("profile.changeAvatar")}
                aria-label={t("profile.changeAvatar")}
                onClick={() => avatarInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    avatarInputRef.current?.click();
                  }
                }}
              >
                {self ? (
                  <Avatar
                    user={{
                      ...self,
                      avatar: avatarUrlInput || self.avatar,
                      status: selectedStatus,
                    }}
                    size="xl"
                    status={selectedStatus}
                    showStatus
                  />
                ) : null}

                <div className="profile-card-preview__avatar-overlay">
                  <span className="profile-card-preview__avatar-overlay-icon">
                    <CameraIcon size={20} />
                  </span>
                  <span className="profile-card-preview__avatar-overlay-text">
                    {t("common.edit")}
                  </span>
                </div>
              </div>
            </div>

            {/* Profile Body */}
            <div className="profile-card-preview__body">
              <div className="profile-card-preview__name">
                {nickname.trim() || self?.nickname || "User"}
              </div>
              <div className="profile-card-preview__username">
                {self?.registered ? `@${self.username}` : t("common.guest")}
              </div>
              {customStatus ? (
                <div className="profile-card-preview__status-text">
                  <span>💬</span>
                  <span>{customStatus}</span>
                </div>
              ) : null}
            </div>

            <div className="profile-card-preview__inner">
              <div className="profile-card-preview__section">
                <span className="profile-card-preview__label">
                  {server?.name ? server.name : "Server"}
                </span>
                <span className="profile-card-preview__value">
                  {self?.registered ? t("dialogs.member.registeredUser") : t("dialogs.member.guestUser")}
                </span>
              </div>

              <div className="profile-card-preview__divider" />

              <div className="profile-card-preview__section">
                <span className="profile-card-preview__label">
                  {t("contextMenu.roles")}
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {heldRoles.length > 0 ? (
                    heldRoles.map((role) => (
                      <span
                        key={role!.id}
                        className="discord-role-pill"
                        style={
                          role!.color
                            ? {
                                color: role!.color,
                                backgroundColor: `${role!.color}18`,
                                borderColor: `${role!.color}33`,
                              }
                            : undefined
                        }
                      >
                        <span
                          className="discord-role-pill__dot"
                          style={{ backgroundColor: role!.color || "var(--text-dim)" }}
                        />
                        <span>{role!.name}</span>
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                      {t("dialogs.member.noRoles")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Hint Card */}
          <div className="profile-hint-card">
            <span className="profile-hint-card__icon">💡</span>
            <span>{t("profile.interactiveHint")}</span>
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
