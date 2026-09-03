import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import {
  Perm,
  format,
  getPermissionHelp,
  getPermissionName,
  has,
  isSet,
  parse,
  type PermissionName,
} from "@/lib/permissions";
import { describeError, type Role, type VoiceSettings, type Webhook } from "@/lib/protocol";
import { formatDateTime } from "@/lib/time";
import { resolveServerIconUrl, serverOrigin } from "@/lib/uploads";
import { useSession } from "@/store/session";
import { manageableWebhookChannels, useMyPermissions, useMyRank } from "@/store/selectors";
import { SettingsModal, type SettingsNavCategory } from "../SettingsModal";
import {
  FileTextIcon,
  FolderIcon,
  GifIcon,
  HashIcon,
  LinkIcon,
  PlusIcon,
  ShieldIcon,
  SlidersIcon,
  FilterIcon,
  SmileyIcon,
  SoundboardIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
  UserXIcon,
  VoiceIcon,
  WebhookIcon,
  LogOutIcon,
  SearchIcon,
} from "../Icons";
import { ConfirmDialog } from "./ConfirmDialog";
import { ImageCropDialog } from "./ImageCropDialog";
import { ServerAuditPage } from "./server-settings/AuditPage";
import { ServerAutoModPage } from "./server-settings/AutoModPage";
import { ServerBansPage } from "./server-settings/BansPage";
import { ServerExpressionsPage } from "./server-settings/ExpressionsPage";
import { ServerSoundsPage } from "./server-settings/SoundsPage";

type ServerTabId =
  | "overview"
  | "roles"
  | "channels"
  | "voice"
  | "emojis"
  | "sounds"
  | "automod"
  | "integrations"
  | "audit"
  | "members"
  | "invites"
  | "bans";

interface ServerSettingsDialogProps {
  /** Which page to open on. Only a caller that means one uses it. */
  initialTab?: ServerTabId;
  onClose(): void;
}

export function ServerSettingsDialog({
  initialTab = "overview",
  onClose,
}: ServerSettingsDialogProps) {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const address = useSession((state) => state.address);
  const disconnect = useSession((state) => state.disconnect);

  const [activeTab, setActiveTab] = useState<ServerTabId>(initialTab);
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!server) return null;

  const categories: SettingsNavCategory[] = [
    {
      title: t("dialogs.serverSettings.categoryServer"),
      items: [
        {
          id: "overview",
          label: t("dialogs.serverSettings.tabOverview"),
          icon: <SlidersIcon size={16} />,
        },
        {
          id: "roles",
          label: t("dialogs.serverSettings.tabRoles"),
          icon: <ShieldIcon size={16} />,
        },
        {
          id: "channels",
          label: t("dialogs.serverSettings.tabChannels"),
          icon: <HashIcon size={16} />,
        },
        {
          id: "voice",
          label: t("dialogs.serverSettings.tabVoice"),
          icon: <VoiceIcon size={16} />,
        },
        {
          id: "emojis",
          label: t("dialogs.serverSettings.tabEmojis"),
          icon: <SmileyIcon size={16} />,
        },
        {
          id: "sounds",
          label: t("dialogs.serverSettings.tabSounds"),
          icon: <SoundboardIcon size={16} />,
        },
        {
          id: "automod",
          label: t("dialogs.serverSettings.tabAutoMod"),
          icon: <FilterIcon size={16} />,
        },
        {
          id: "integrations",
          label: t("dialogs.serverSettings.tabIntegrations"),
          icon: <LinkIcon size={16} />,
        },
        {
          id: "audit",
          label: t("dialogs.serverSettings.tabAudit"),
          icon: <FileTextIcon size={16} />,
        },
      ],
    },
    {
      title: t("dialogs.serverSettings.categoryUserManagement"),
      items: [
        {
          id: "members",
          label: t("dialogs.serverSettings.tabMembers"),
          icon: <UsersIcon size={16} />,
        },
        {
          id: "invites",
          label: t("dialogs.serverSettings.tabInvites"),
          icon: <LinkIcon size={16} />,
          badge: t("dialogs.userSettings.soonBadge"),
          badgeType: "soon",
        },
        {
          id: "bans",
          label: t("dialogs.serverSettings.tabBans"),
          icon: <UserXIcon size={16} />,
        },
      ],
    },
  ];

  const serverIconUrl = resolveServerIconUrl(server.icon, address);
  const [headerIconError, setHeaderIconError] = useState(false);

  useEffect(() => {
    setHeaderIconError(false);
  }, [server.icon]);

  const headerElement = (
    <div className="settings-server-header">
      <div className="settings-server-header__icon">
        {serverIconUrl && !headerIconError ? (
          <img
            src={serverIconUrl}
            alt={server.name}
            onError={() => setHeaderIconError(true)}
          />
        ) : (
          server.name.slice(0, 1).toUpperCase()
        )}
      </div>
      <div className="settings-server-header__info">
        <span className="settings-server-header__name">{server.name}</span>
        <span className="settings-server-header__sub">{t("dialogs.serverSettings.title")}</span>
      </div>
    </div>
  );

  const sidebarFooter = (
    <div className="settings-sidebar__footer-content">
      <button
        type="button"
        className="settings-nav-item settings-nav-item--danger"
        onClick={() => setConfirmLeave(true)}
      >
        <span className="settings-nav-item__icon">
          <LogOutIcon size={16} />
        </span>
        <span className="settings-nav-item__label">
          {t("dialogs.serverSettings.leaveServer")}
        </span>
      </button>
      <div className="settings-sidebar__version-wrap">
        <span className="settings-sidebar__version">Aural Client v0.7.6</span>
      </div>
    </div>
  );

  return (
    <>
      <SettingsModal
        headerElement={headerElement}
        categories={categories}
        activeTab={activeTab}
        onSelectTab={(tabId) => setActiveTab(tabId as ServerTabId)}
        onClose={onClose}
        sidebarFooter={sidebarFooter}
      >
        {activeTab === "overview" ? <ServerOverviewPage /> : null}
        {activeTab === "roles" ? <ServerRolesPage /> : null}
        {activeTab === "channels" ? <ServerChannelsPage /> : null}
        {activeTab === "voice" ? <ServerVoicePage /> : null}
        {activeTab === "emojis" ? <ServerExpressionsPage /> : null}
        {activeTab === "sounds" ? <ServerSoundsPage /> : null}
        {activeTab === "automod" ? <ServerAutoModPage /> : null}
        {activeTab === "integrations" ? <ServerIntegrationsPage /> : null}
        {activeTab === "audit" ? <ServerAuditPage /> : null}
        {activeTab === "members" ? <ServerMembersPage /> : null}
        {activeTab === "invites" ? <ServerInvitesPage /> : null}
        {activeTab === "bans" ? <ServerBansPage /> : null}
      </SettingsModal>

      {confirmLeave ? (
        <ConfirmDialog
          title={t("dialogs.serverSettings.leaveServer")}
          subtitle={t("dialogs.serverSettings.leaveServerConfirm")}
          confirmText={t("common.leave")}
          danger
          onConfirm={() => {
            setConfirmLeave(false);
            onClose();
            disconnect();
          }}
          onClose={() => setConfirmLeave(false)}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Server Tab: Overview                                                       */
/* -------------------------------------------------------------------------- */

function ServerOverviewPage() {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const address = useSession((state) => state.address);
  const updateServer = useSession((state) => state.updateServer);
  const uploadServerIcon = useSession((state) => state.uploadServerIcon);
  const claimAdmin = useSession((state) => state.claimAdmin);
  const permissions = useMyPermissions();

  const [name, setName] = useState(server?.name ?? "");
  const [description, setDescription] = useState(server?.description ?? "");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [claimDone, setClaimDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [iconError, setIconError] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const allowed = has(permissions, Perm.ManageServer);
  const isAdmin = has(permissions, Perm.Administrator);

  useEffect(() => {
    setIconError(false);
  }, [server?.icon]);

  const serverIconUrl = resolveServerIconUrl(server?.icon, address);

  const isDirty =
    name.trim() !== (server?.name ?? "") ||
    description.trim() !== (server?.description ?? "");

  async function handleSaveServer(event?: FormEvent) {
    if (event) event.preventDefault();
    if (!allowed || !isDirty || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateServer({ name: name.trim(), description: description.trim() });
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setCropFile(file);
    e.target.value = "";
  }

  async function handleCropConfirm(croppedFile: File) {
    setCropFile(null);
    setBusy(true);
    setError(null);
    setSaved(false);
    setUploadProgress(0);
    try {
      await uploadServerIcon(croppedFile, (fraction) => setUploadProgress(fraction));
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  async function handleRemoveIcon() {
    if (!allowed || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateServer({ icon: "" });
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleClaimAdmin(event: FormEvent) {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await claimAdmin(token.trim());
      setClaimDone(true);
      setToken("");
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
          {t("dialogs.serverSettings.overview.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.overview.desc")}
        </p>
      </header>

      {error ? <div className="alert alert--danger">{error}</div> : null}
      {saved ? <div className="alert alert--info">{t("common.saved")}</div> : null}
      {!allowed ? (
        <div className="alert alert--warning">{t("errors.forbidden")}</div>
      ) : null}

      <div className="settings-grid-2">
        {/* Server Identity Form */}
        <form onSubmit={(e) => void handleSaveServer(e)} className="settings-form">
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("dialogs.serverSettings.overview.serverName")}
            </h3>
            <div className="field" style={{ marginTop: 8 }}>
              <input
                id="server-name-input"
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                maxLength={64}
                disabled={!allowed || busy}
                required
              />
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 className="settings-card__title">
                {t("dialogs.serverSettings.overview.serverDescription")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.serverSettings.overview.serverDescriptionHint")}
              </p>
              <div className="field" style={{ marginTop: 8 }}>
                <textarea
                  id="server-desc-input"
                  className="input"
                  style={{ minHeight: 70, resize: "vertical" }}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setSaved(false);
                  }}
                  maxLength={512}
                  disabled={!allowed || busy}
                />
              </div>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!allowed || !isDirty || busy || !name.trim()}
              >
                {busy ? t("common.loading") : t("common.save")}
              </button>
              {isDirty ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setName(server?.name ?? "");
                    setDescription(server?.description ?? "");
                  }}
                  disabled={busy}
                >
                  {t("dialogs.userSettings.reset")}
                </button>
              ) : null}
            </div>
          </div>
        </form>

        {/* Server Icon & Details */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("dialogs.serverSettings.overview.serverIcon")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.serverSettings.overview.serverIconHint")}
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
              <div className="server-icon-preview">
                {serverIconUrl && !iconError ? (
                  <img
                    src={serverIconUrl}
                    alt={name || "Server"}
                    onError={() => setIconError(true)}
                  />
                ) : (
                  name ? name.slice(0, 1).toUpperCase() : "S"
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!allowed || busy}
                  >
                    <UploadIcon size={14} />
                    <span>{t("dialogs.serverSettings.overview.changeIcon")}</span>
                  </button>
                  {server?.icon ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--danger"
                      onClick={() => void handleRemoveIcon()}
                      disabled={!allowed || busy}
                    >
                      <TrashIcon size={14} />
                      <span>{t("dialogs.serverSettings.overview.removeIcon")}</span>
                    </button>
                  ) : null}
                </div>
                {uploadProgress !== null ? (
                  <span style={{ fontSize: 12, color: "var(--accent)" }}>
                    {Math.round(uploadProgress * 100)}%
                  </span>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp"
                  style={{ display: "none" }}
                  onChange={handleFileSelect}
                />
              </div>
            </div>
          </div>

          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("dialogs.serverSettings.overview.serverInfoTitle")}
            </h3>
            <div className="server-info-list" style={{ marginTop: 10 }}>
              <div className="server-info-row">
                <span className="server-info-label">
                  {t("dialogs.serverSettings.overview.serverAddress")}:
                </span>
                <span className="server-info-value" style={{ fontFamily: "var(--font-mono)" }}>
                  {address?.label ?? address?.raw ?? "127.0.0.1:9871"}
                </span>
              </div>
              <div className="server-info-row">
                <span className="server-info-label">
                  {t("dialogs.serverSettings.overview.voiceMode")}:
                </span>
                <span className="server-info-value">
                  {server?.voiceMode === "client_host"
                    ? t("dialogs.serverSettings.overview.voiceClient")
                    : t("dialogs.serverSettings.overview.voiceServer")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Claim Server Administrator Section */}
      <div className="settings-card">
        <h3 className="settings-card__title">
          {t("dialogs.serverSettings.overview.ownershipTitle")}
        </h3>

        {isAdmin ? (
          <div className="alert alert--info" style={{ marginTop: 10 }}>
            {t("dialogs.serverSettings.overview.ownerClaimed")}
          </div>
        ) : (
          <form onSubmit={(e) => void handleClaimAdmin(e)} style={{ marginTop: 12 }}>
            <p className="settings-card__subtitle">
              {t("dialogs.serverSettings.overview.ownerUnclaimedDesc")}
            </p>

            {claimDone ? (
              <div className="alert alert--info" style={{ marginTop: 10 }}>
                {t("dialogs.serverSettings.overview.claimSuccess")}
              </div>
            ) : null}

            <div className="field" style={{ marginTop: 10 }}>
              <input
                className="input"
                style={{ fontFamily: "var(--font-mono)" }}
                placeholder={t("dialogs.serverSettings.overview.tokenPlaceholder")}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
            </div>

            <button
              type="submit"
              className="btn btn--primary"
              style={{ marginTop: 10 }}
              disabled={busy || !token.trim()}
            >
              {busy ? t("common.loading") : t("dialogs.serverSettings.overview.claimButton")}
            </button>
          </form>
        )}
      </div>

      {cropFile ? (
        <ImageCropDialog
          file={cropFile}
          type="server-icon"
          onConfirm={(file) => void handleCropConfirm(file)}
          onClose={() => setCropFile(null)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Server Tab: Roles & Permissions                                            */
/* -------------------------------------------------------------------------- */

function ServerRolesPage() {
  const { t } = useTranslation();
  const roles = useSession((state) => state.roles);
  const createRole = useSession((state) => state.createRole);
  const deleteRole = useSession((state) => state.deleteRole);
  const myPermissions = useMyPermissions();
  const myRank = useMyRank();

  const ordered = useMemo(
    () => [...roles.values()].sort((a, b) => b.position - a.position),
    [roles],
  );
  const [selectedId, setSelectedId] = useState<number | null>(ordered[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const selected = selectedId === null ? null : (roles.get(selectedId) ?? null);

  useEffect(() => {
    if (selectedId !== null && !roles.has(selectedId)) {
      setSelectedId(ordered[0]?.id ?? null);
    }
  }, [roles, ordered, selectedId]);

  async function addRole() {
    setError(null);
    try {
      await createRole({ name: t("dialogs.serverSettings.roles.createRole"), color: "#8b93a7" });
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.serverSettings.roles.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.roles.desc")}
        </p>
      </header>

      {error ? <div className="alert alert--danger">{error}</div> : null}

      <div className="settings-role-manager">
        {/* Left Column: Role List */}
        <div className="settings-role-sidebar">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void addRole()}
            style={{ width: "100%", justifyContent: "center", marginBottom: 8 }}
          >
            <PlusIcon size={15} />
            {t("dialogs.serverSettings.roles.createRole")}
          </button>

          <div className="settings-role-list">
            {ordered.map((role) => (
              <button
                key={role.id}
                type="button"
                className={`rolelist__item ${role.id === selectedId ? "rolelist__item--active" : ""}`}
                onClick={() => setSelectedId(role.id)}
              >
                <span
                  className="rolelist__swatch"
                  style={role.color ? { background: role.color } : undefined}
                />
                <span className="rolelist__name">{role.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Column: Role Editor */}
        <div className="settings-role-content">
          {selected ? (
            <RoleEditor
              key={selected.id}
              role={selected}
              myPermissions={myPermissions}
              myRank={myRank}
              onDelete={() => void deleteRole(selected.id).catch((caught) => setError(describeError(caught)))}
            />
          ) : (
            <p className="field__hint">{t("dialogs.serverSettings.roles.desc")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface RoleEditorProps {
  role: Role;
  myPermissions: bigint;
  myRank: number;
  onDelete(): void;
}

function RoleEditor({ role, myPermissions, myRank, onDelete }: RoleEditorProps) {
  const { t } = useTranslation();
  const updateRole = useSession((state) => state.updateRole);

  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color || "#8b93a7");
  const [hoist, setHoist] = useState(role.hoist);
  const [mask, setMask] = useState(() => parse(role.permissions));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editable = role.position < myRank;
  const isEveryone = role.managed === "everyone";

  const dirty =
    name !== role.name ||
    (color !== (role.color || "#8b93a7") && !isEveryone) ||
    hoist !== role.hoist ||
    format(mask) !== format(parse(role.permissions));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateRole({
        roleId: role.id,
        ...(isEveryone ? {} : { name: name.trim(), color }),
        hoist,
        permissions: format(mask),
      });
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const [searchPerm, setSearchPerm] = useState("");

  const PERMISSION_CATEGORIES = useMemo(() => [
    {
      id: "general",
      nameKey: "dialogs.serverSettings.roles.categoryGeneral",
      fallbackName: "General",
      permissions: ["ViewChannel", "ChangeNickname", "Register", "ViewAuditLog"] as PermissionName[],
    },
    {
      id: "text",
      nameKey: "dialogs.serverSettings.roles.categoryText",
      fallbackName: "Canales de Texto y Chat",
      permissions: [
        "SendMessages",
        "AttachFiles",
        "SendDirectMessages",
        "CreatePosts",
        "ManageMessages",
      ] as PermissionName[],
    },
    {
      id: "voice",
      nameKey: "dialogs.serverSettings.roles.categoryVoice",
      fallbackName: "Canales de Voz y Audio",
      permissions: [
        "Connect",
        "Speak",
        "UseSoundboard",
        "MoveUsers",
        "MuteUsers",
        "DeafenUsers",
      ] as PermissionName[],
    },
    {
      id: "management",
      nameKey: "dialogs.serverSettings.roles.categoryManagement",
      fallbackName: "Gestión y Moderación",
      permissions: [
        "ManageChannels",
        "ManageRoles",
        "ManageServer",
        "ManageNicknames",
        "ManageWebhooks",
        "ManageExpressions",
        "KickUsers",
        "BanUsers",
      ] as PermissionName[],
    },
    {
      id: "advanced",
      nameKey: "dialogs.serverSettings.roles.categoryAdvanced",
      fallbackName: "Permisos Avanzados",
      permissions: ["Administrator"] as PermissionName[],
    },
  ], []);

  const query = searchPerm.trim().toLowerCase();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      {saved ? <div className="alert alert--info">{t("common.saved")}</div> : null}
      {!editable ? <div className="alert alert--warning">{t("errors.forbidden")}</div> : null}

      <div className="settings-card">
        <div style={{ display: "flex", gap: 10 }}>
          <div className="field" style={{ flex: 1, minWidth: 0 }}>
            <label className="field__label" htmlFor={`role-name-${role.id}`}>
              {t("dialogs.serverSettings.roles.roleName")}
            </label>
            <input
              id={`role-name-${role.id}`}
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              maxLength={48}
              disabled={!editable || isEveryone}
            />
          </div>

          <div className="field" style={{ width: 80 }}>
            <label className="field__label" htmlFor={`role-color-${role.id}`}>
              {t("dialogs.serverSettings.roles.roleColor")}
            </label>
            <input
              id={`role-color-${role.id}`}
              className="input"
              type="color"
              style={{ padding: 4, height: 42 }}
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setSaved(false);
              }}
              disabled={!editable || isEveryone}
            />
          </div>
        </div>

        <div className="settings-row" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h4 className="settings-card__title">{t("dialogs.serverSettings.roles.hoist")}</h4>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={hoist}
              onChange={(e) => {
                setHoist(e.target.checked);
                setSaved(false);
              }}
              disabled={!editable}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card__title">{t("dialogs.serverSettings.roles.permissions")}</h3>
        {isEveryone ? (
          <p className="settings-card__subtitle" style={{ marginBottom: 12 }}>
            {t("dialogs.serverSettings.roles.everyoneDesc")}
          </p>
        ) : null}

        <div style={{ position: "relative", marginTop: 12, marginBottom: 8 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)", display: "flex", pointerEvents: "none" }}>
            <SearchIcon size={14} />
          </span>
          <input
            type="text"
            className="input"
            style={{ paddingLeft: 32, fontSize: 13, height: 36 }}
            placeholder={t("dialogs.serverSettings.roles.searchPermissions" as never) || "Buscar permisos..."}
            value={searchPerm}
            onChange={(e) => setSearchPerm(e.target.value)}
          />
        </div>

        <div>
          {PERMISSION_CATEGORIES.map((category) => {
            const matching = category.permissions.filter((p) => {
              if (!query) return true;
              return (
                getPermissionName(p).toLowerCase().includes(query) ||
                getPermissionHelp(p).toLowerCase().includes(query)
              );
            });
            if (matching.length === 0) return null;

            const enabledCount = category.permissions.filter((p) => isSet(mask, Perm[p])).length;

            return (
              <div key={category.id} className="perm-category">
                <div className="perm-category__header">
                  <span className="perm-category__title">
                    {t(category.nameKey as never) || category.fallbackName}
                  </span>
                  <span className="perm-category__count">
                    {enabledCount} / {category.permissions.length}
                  </span>
                </div>

                <div className="permlist">
                  {matching.map((permission) => {
                    const bit = Perm[permission];
                    const locked = !editable || !has(myPermissions, bit);
                    const isAdmin = permission === "Administrator";
                    return (
                      <label
                        key={permission}
                        className={`perm ${locked ? "perm--locked" : ""} ${isAdmin ? "perm--admin" : ""}`}
                        title={locked && editable ? t("errors.forbidden") : undefined}
                      >
                        <div className="perm__info">
                          <span className="perm__name">{getPermissionName(permission)}</span>
                          <span className="perm__help">{getPermissionHelp(permission)}</span>
                        </div>
                        <span className="settings-switch">
                          <input
                            type="checkbox"
                            checked={isSet(mask, bit)}
                            disabled={locked}
                            onChange={(event) => {
                              setMask((current) => (event.target.checked ? current | bit : current & ~bit));
                              setSaved(false);
                            }}
                          />
                          <span className="settings-switch__slider" />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void save()}
          disabled={!editable || !dirty || busy}
        >
          {busy ? t("common.loading") : t("common.save")}
        </button>
        {role.managed === "" && editable ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            <TrashIcon size={15} />
            {t("common.delete")}
          </button>
        ) : null}
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title={t("dialogs.serverSettings.roles.deleteRole")}
          subtitle={t("dialogs.serverSettings.roles.deleteRoleConfirm", { name: role.name })}
          confirmText={t("common.delete")}
          danger
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Server Tab: Channels Overview                                              */
/* -------------------------------------------------------------------------- */

function ServerChannelsPage() {
  const { t } = useTranslation();
  const channels = useSession((state) => state.channels);

  const categories = useMemo(
    () => [...channels.values()].filter((c) => c.type === "category"),
    [channels],
  );
  const textChannels = useMemo(
    () => [...channels.values()].filter((c) => c.type === "text"),
    [channels],
  );
  const voiceChannels = useMemo(
    () => [...channels.values()].filter((c) => c.type === "voice"),
    [channels],
  );

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.serverSettings.channels.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.channels.desc")}
        </p>
      </header>

      <div className="settings-stats-grid">
        <div className="settings-stat-card">
          <FolderIcon size={24} />
          <span className="settings-stat-card__count">{categories.length}</span>
          <span className="settings-stat-card__label">
            {t("dialogs.serverSettings.channels.categoriesCount", { count: categories.length })}
          </span>
        </div>

        <div className="settings-stat-card">
          <HashIcon size={24} />
          <span className="settings-stat-card__count">{textChannels.length}</span>
          <span className="settings-stat-card__label">
            {t("dialogs.serverSettings.channels.textCount", { count: textChannels.length })}
          </span>
        </div>

        <div className="settings-stat-card">
          <VoiceIcon size={24} />
          <span className="settings-stat-card__count">{voiceChannels.length}</span>
          <span className="settings-stat-card__label">
            {t("dialogs.serverSettings.channels.voiceCount", { count: voiceChannels.length })}
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Server Tabs: Integrations, Members, Invites                                 */
/* -------------------------------------------------------------------------- */

function ServerIntegrationsPage() {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const updateServer = useSession((state) => state.updateServer);
  const permissions = useMyPermissions();

  // The key is write-only: the server tells us whether one is stored, never
  // what it is, so the field starts empty and saving replaces whatever is
  // there. A secret that could be read back out of a settings screen would be
  // a secret anyone who reaches this screen has.
  const [klipyKey, setKlipyKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = has(permissions, Perm.ManageServer);
  const isConfigured = server?.klipyEnabled ?? false;
  const isDirty = klipyKey.trim() !== "";

  async function submitKey(value: string) {
    if (!allowed || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateServer({ klipyApiKey: value });
      setKlipyKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(e?: FormEvent) {
    if (e) e.preventDefault();
    if (!isDirty) return;
    await submitKey(klipyKey.trim());
  }

  // Removing is its own action rather than saving an empty field: with nothing
  // shown to clear, an empty box means "leave it alone", not "delete it".
  async function handleRemove() {
    await submitKey("");
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.serverSettings.integrations.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.integrations.desc")}
        </p>
      </header>

      {/* KLIPY Service Card */}
      <div className="settings-card settings-card--integration">
        <div className="settings-card__header">
          <div className="settings-card__header-info">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span className="settings-card__service-icon" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: "var(--radius-sm)", background: "var(--accent-dim)", color: "var(--accent)" }}>
                <GifIcon size={20} />
              </span>
              <div>
                <h3 className="settings-card__title" style={{ margin: 0, fontSize: 16 }}>
                  {t("dialogs.serverSettings.integrations.klipyTitle")}
                </h3>
                <span
                  className={
                    isConfigured
                      ? "settings-badge settings-badge--active"
                      : "settings-badge settings-badge--inactive"
                  }
                  style={{
                    display: "inline-block",
                    marginTop: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: isConfigured ? "rgba(35, 165, 90, 0.15)" : "rgba(255, 255, 255, 0.08)",
                    color: isConfigured ? "#23a55a" : "var(--text-dim)",
                  }}
                >
                  {isConfigured
                    ? t("dialogs.serverSettings.integrations.klipyActive")
                    : t("dialogs.serverSettings.integrations.klipyInactive")}
                </span>
              </div>
            </div>
            <p className="settings-card__subtitle" style={{ marginTop: 8 }}>
              {t("dialogs.serverSettings.integrations.klipyDesc")}
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} style={{ marginTop: 16 }}>
          <div className="field">
            <label className="field__label" htmlFor="klipy-api-key">
              {t("dialogs.serverSettings.integrations.klipyKeyLabel")}
            </label>
            <input
              id="klipy-api-key"
              type="text"
              className="input"
              style={{ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)" }}
              value={klipyKey}
              onChange={(e) => setKlipyKey(e.target.value)}
              placeholder={
                isConfigured
                  ? t("dialogs.serverSettings.integrations.klipyKeyStored")
                  : t("dialogs.serverSettings.integrations.klipyKeyPlaceholder")
              }
              disabled={!allowed || busy}
              autoComplete="off"
              spellCheck={false}
            />
            <p style={{ margin: "2px 0 0", fontSize: 12 }}>
              <a
                href="https://klipy.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                {t("dialogs.serverSettings.integrations.klipyPortalLink")} &rarr;
              </a>
            </p>
          </div>

          {error && <p className="settings-error" style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{error}</p>}
          {saved && (
            <p className="settings-success" style={{ color: "#23a55a", fontSize: 13, marginTop: 10 }}>
              {t("dialogs.serverSettings.integrations.saved")}
            </p>
          )}

          {allowed && (
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              {isConfigured && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => void handleRemove()}
                  disabled={busy}
                >
                  {t("dialogs.serverSettings.integrations.removeKey")}
                </button>
              )}
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!isDirty || busy}
              >
                {busy ? t("common.loading") : t("dialogs.serverSettings.integrations.saveKey")}
              </button>
            </div>
          )}
        </form>
      </div>

      <ServerWebhooksCard />
    </div>
  );
}

/**
 * Webhook management.
 *
 * The list is fetched here rather than held in the session store: every entry
 * carries the token that is the whole of a webhook's authentication, and there
 * is no reason for a set of live credentials to sit in memory for the length of
 * a session when one screen reads them. There are no webhook events either, so
 * the list is re-read after every change this screen makes.
 */
function ServerWebhooksCard() {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const roles = useSession((state) => state.roles);
  const channels = useSession((state) => state.channels);
  const address = useSession((state) => state.address);
  const listWebhooks = useSession((state) => state.listWebhooks);
  const createWebhook = useSession((state) => state.createWebhook);
  const deleteWebhook = useSession((state) => state.deleteWebhook);

  const targets = useMemo(
    () => manageableWebhookChannels(self, roles, channels),
    [self, roles, channels],
  );

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [channelId, setChannelId] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Webhook | null>(null);

  const allowed = targets.length > 0;

  async function refresh() {
    try {
      setWebhooks(await listWebhooks());
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  useEffect(() => {
    if (!allowed) {
      setWebhooks([]);
      return;
    }
    let live = true;
    listWebhooks()
      .then((list) => {
        if (live) {
          setWebhooks(list);
          setError(null);
        }
      })
      .catch((caught) => {
        if (live) setError(describeError(caught));
      });
    return () => {
      live = false;
    };
  }, [allowed, listWebhooks]);

  // The picker starts on the first channel the caller may act in, so the common
  // case is a name and a button.
  useEffect(() => {
    if (channelId === null && targets.length > 0) setChannelId(targets[0]!.id);
  }, [channelId, targets]);

  /**
   * The URL an application is given. The server hands back a path, so a client
   * that reached this server by address, by hostname or through a proxy all
   * build the same working URL from the address they already hold.
   */
  function fullUrl(webhook: Webhook): string {
    if (!address) return webhook.url;
    return serverOrigin(address) + webhook.url;
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (busy || channelId === null || name.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const created = await createWebhook({
        channelId,
        name: name.trim(),
        avatar: avatar.trim() || undefined,
      });
      setName("");
      setAvatar("");
      setCreating(false);
      // Shown at once: the URL is the thing somebody came here for, and making
      // them find it again in the list is a step for nothing.
      setRevealed(created.id);
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(webhook: Webhook) {
    setPendingDelete(null);
    setBusy(true);
    setError(null);
    try {
      await deleteWebhook(webhook.id);
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(webhook: Webhook) {
    try {
      await navigator.clipboard.writeText(fullUrl(webhook));
      setCopied(webhook.id);
      setTimeout(() => setCopied((current) => (current === webhook.id ? null : current)), 2000);
    } catch {
      // Clipboard access can be refused. Showing the URL is the fallback: it
      // can then be selected and copied by hand.
      setRevealed(webhook.id);
    }
  }

  return (
    <>
      <div className="settings-card settings-card--integration">
        <div className="settings-card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div className="settings-card__header-info" style={{ flex: 1, minWidth: 0 }}>
            <div className="webhook-card__service">
              <span className="settings-card__service-icon webhook-card__icon">
                <WebhookIcon size={20} />
              </span>
              <h3 className="settings-card__title webhook-card__heading">
                {t("dialogs.serverSettings.integrations.webhooksTitle")}
              </h3>
            </div>
            <p className="settings-card__subtitle webhook-card__desc">
              {t("dialogs.serverSettings.integrations.webhooksDesc")}
            </p>
            <p className="webhook-card__compat">
              {t("dialogs.serverSettings.integrations.webhooksCompat")}
            </p>
          </div>

          {allowed && !creating ? (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              style={{ flexShrink: 0, marginTop: 4 }}
              onClick={() => setCreating(true)}
              disabled={busy}
            >
              <PlusIcon size={14} />
              {t("dialogs.serverSettings.integrations.createWebhook")}
            </button>
          ) : null}
        </div>

        {!allowed ? (
          <p className="webhook-card__empty">
            {t("dialogs.serverSettings.integrations.noChannels")}
          </p>
        ) : (
          <>
            {webhooks.length === 0 ? (
              <div className="webhook-card__empty" style={{ padding: "24px 16px", textAlign: "center", background: "var(--bg-input)", border: "1px dashed var(--border)", borderRadius: "var(--radius-md)", marginTop: 14 }}>
                <p className="settings-card__subtitle" style={{ margin: 0 }}>
                  {t("dialogs.serverSettings.integrations.empty")}
                </p>
              </div>
            ) : (
              <ul className="webhook-list">
                {webhooks.map((webhook) => {
                  const channel = channels.get(webhook.channelId);
                  const open = revealed === webhook.id;
                  return (
                    <li key={webhook.id} className="webhook">
                      <div className="webhook__row">
                        <span className="webhook__icon" aria-hidden="true">
                          {webhook.avatar ? (
                            <img src={webhook.avatar} alt="" referrerPolicy="no-referrer" />
                          ) : (
                            <WebhookIcon size={16} />
                          )}
                        </span>
                        <div className="webhook__info">
                          <span className="webhook__name">{webhook.name}</span>
                          <span className="webhook__meta">
                            {channel ? `#${channel.name} · ` : ""}
                            {webhook.lastUsedAt > 0
                              ? t("dialogs.serverSettings.integrations.lastUsed", {
                                  when: formatDateTime(webhook.lastUsedAt),
                                })
                              : t("dialogs.serverSettings.integrations.neverUsed")}
                          </span>
                        </div>
                        <div className="webhook__actions">
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setRevealed(open ? null : webhook.id)}
                          >
                            {open
                              ? t("dialogs.serverSettings.integrations.hideUrl")
                              : t("dialogs.serverSettings.integrations.showUrl")}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => void copyUrl(webhook)}
                          >
                            {copied === webhook.id
                              ? t("common.copied")
                              : t("dialogs.serverSettings.integrations.copyUrl")}
                          </button>
                          <button
                            type="button"
                            className="iconbtn iconbtn--danger"
                            title={t("dialogs.serverSettings.integrations.deleteWebhook")}
                            aria-label={t("dialogs.serverSettings.integrations.deleteWebhook")}
                            onClick={() => setPendingDelete(webhook)}
                            disabled={busy}
                          >
                            <TrashIcon size={14} />
                          </button>
                        </div>
                      </div>

                      {open ? (
                        <div className="field webhook__url">
                          <label className="field__label" htmlFor={`webhook-url-${webhook.id}`}>
                            {t("dialogs.serverSettings.integrations.urlLabel")}
                          </label>
                          <input
                            id={`webhook-url-${webhook.id}`}
                            className="input webhook__url-input"
                            value={fullUrl(webhook)}
                            readOnly
                            onFocus={(event) => event.currentTarget.select()}
                            spellCheck={false}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {creating ? (
              <form className="webhook-form" onSubmit={handleCreate}>
                <div className="field">
                  <label className="field__label" htmlFor="webhook-name">
                    {t("dialogs.serverSettings.integrations.nameLabel")}
                  </label>
                  <input
                    id="webhook-name"
                    className="input"
                    value={name}
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("dialogs.serverSettings.integrations.namePlaceholder")}
                    maxLength={80}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="webhook-channel">
                    {t("dialogs.serverSettings.integrations.channelLabel")}
                  </label>
                  <select
                    id="webhook-channel"
                    className="input"
                    value={channelId ?? ""}
                    onChange={(event) => setChannelId(Number(event.target.value))}
                  >
                    {targets.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        #{channel.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="webhook-avatar">
                    {t("dialogs.serverSettings.integrations.avatarLabel")}
                  </label>
                  <input
                    id="webhook-avatar"
                    className="input webhook__url-input"
                    value={avatar}
                    onChange={(event) => setAvatar(event.target.value)}
                    placeholder={t("dialogs.serverSettings.integrations.avatarPlaceholder")}
                    spellCheck={false}
                  />
                </div>
                <div className="webhook-form__actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setCreating(false)}
                    disabled={busy}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={busy || name.trim() === "" || channelId === null}
                  >
                    {busy ? t("common.loading") : t("dialogs.serverSettings.integrations.create")}
                  </button>
                </div>
              </form>
            ) : (
              <div className="webhook-card__footer">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setCreating(true)}
                  disabled={busy}
                >
                  <PlusIcon size={14} />
                  {t("dialogs.serverSettings.integrations.createWebhook")}
                </button>
              </div>
            )}
          </>
        )}

        {error ? <p className="webhook-card__error">{error}</p> : null}
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          title={t("dialogs.serverSettings.integrations.deleteWebhook")}
          subtitle={t("dialogs.serverSettings.integrations.deleteConfirm", {
            name: pendingDelete.name,
          })}
          confirmText={t("common.delete")}
          danger
          onConfirm={() => void handleDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </>
  );
}


function ServerMembersPage() {
  const { t } = useTranslation();
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);

  const memberList = useMemo(() => [...users.values()], [users]);

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.serverSettings.members.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.members.desc")} ({memberList.length})
        </p>
      </header>

      <div className="settings-card">
        <div className="settings-member-list">
          {memberList.map((user) => {
            const userRoles = (user.roles ?? [])
              .map((rId) => roles.get(rId))
              .filter((r): r is Role => r !== undefined);

            return (
              <div key={user.id} className="settings-member-row">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="userpanel__name" style={{ fontWeight: 600 }}>
                    {user.nickname}
                  </span>
                  {user.registered ? (
                    <span className="field__hint">@{user.username}</span>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {userRoles.map((r) => (
                    <span
                      key={r.id}
                      className="settings-badge"
                      style={{
                        background: r.color ? `${r.color}22` : "var(--bg-raised)",
                        color: r.color || "var(--text-muted)",
                        border: `1px solid ${r.color || "var(--border)"}`,
                      }}
                    >
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ServerInvitesPage() {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 className="settings-section__title">
            {t("dialogs.serverSettings.invites.title")}
          </h2>
          <span className="settings-badge settings-badge--soon">
            {t("dialogs.userSettings.soonBadge")}
          </span>
        </div>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.invites.desc")}
        </p>
      </header>

      <div className="settings-card">
        <p className="settings-card__subtitle">
          {t("dialogs.serverSettings.invites.empty")}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Voice                                                                 */
/* -------------------------------------------------------------------------- */

/** The sample rates Opus encodes at. 44.1 kHz is deliberately not among them. */
const SAMPLE_RATES = [8000, 12000, 16000, 24000, 48000];

function ServerVoicePage() {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const updateServer = useSession((state) => state.updateServer);
  const permissions = useMyPermissions();
  const canManage = has(permissions, Perm.ManageServer);

  const [draft, setDraft] = useState<VoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The server is the authority: an edit that was never saved is dropped the
  // moment the server says something different, which is what keeps this page
  // from showing a setting that is not in force.
  const live = server?.voice;
  useEffect(() => {
    if (!live) return;
    setDraft({
      enabled: live.enabled,
      mode: live.mode,
      sampleRate: live.sampleRate,
      bitrate: live.bitrate,
      minBitrate: live.minBitrate,
      maxBitrate: live.maxBitrate,
      fec: live.fec,
      dtx: live.dtx,
      stereo: live.stereo,
      maxParticipants: live.maxParticipants,
    });
  }, [live]);

  if (!draft) return null;

  const patch = (changes: Partial<VoiceSettings>) => {
    setSaved(false);
    setDraft({ ...draft, ...changes });
  };

  const kb = (value: number) => `${Math.round(value / 1000)} kb/s`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateServer({ voice: draft });
      setSaved(true);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="settings-section" onSubmit={submit}>
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.serverSettings.voice.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.serverSettings.voice.desc")}</p>
      </header>

      {!canManage ? (
        <p className="field__hint">{t("dialogs.serverSettings.voice.readOnly")}</p>
      ) : null}

      <fieldset disabled={!canManage || saving} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Group 1: Voice Service & Routing */}
        <div className="settings-group">
          <div className="settings-group__item">
            <div className="settings-row">
              <div className="settings-row__info">
                <h4 className="settings-card__title" style={{ margin: 0 }}>{t("dialogs.serverSettings.voice.enabled")}</h4>
                <p className="settings-card__subtitle" style={{ marginTop: 2 }}>
                  {t("dialogs.serverSettings.voice.enabledDesc")}
                </p>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => patch({ enabled: e.target.checked })}
                />
                <span className="settings-switch__slider" />
              </label>
            </div>
          </div>

          <div className="settings-group__item">
            <h4 className="settings-card__title" style={{ margin: 0 }}>{t("dialogs.serverSettings.voice.mode")}</h4>
            <div className="settings-radio-group" style={{ marginTop: 12 }}>
              <label className={`settings-radio-card ${draft.mode === "server_host" ? "settings-radio-card--active" : ""}`}>
                <input
                  type="radio"
                  name="voice-mode"
                  checked={draft.mode === "server_host"}
                  onChange={() => patch({ mode: "server_host" })}
                />
                <span className="settings-radio-card__body">
                  <span className="settings-radio-card__title">
                    {t("dialogs.serverSettings.voice.modeServer")}
                  </span>
                  <span className="settings-card__subtitle">
                    {t("dialogs.serverSettings.voice.modeServerDesc")}
                  </span>
                </span>
              </label>
              <label className={`settings-radio-card ${draft.mode === "client_host" ? "settings-radio-card--active" : ""}`}>
                <input
                  type="radio"
                  name="voice-mode"
                  checked={draft.mode === "client_host"}
                  onChange={() => patch({ mode: "client_host" })}
                />
                <span className="settings-radio-card__body">
                  <span className="settings-radio-card__title">
                    {t("dialogs.serverSettings.voice.modeClient")}
                  </span>
                  <span className="settings-card__subtitle">
                    {t("dialogs.serverSettings.voice.modeClientDesc")}
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Group 2: Audio Quality & Performance */}
        <div className="settings-group">
          <div className="settings-group__header">
            <div>
              <h3 className="settings-card__title" style={{ margin: 0 }}>{t("dialogs.serverSettings.voice.quality")}</h3>
              <p className="settings-card__subtitle" style={{ margin: "2px 0 0" }}>
                {t("dialogs.serverSettings.voice.sampleRateDesc")}
              </p>
            </div>
          </div>

          <div className="settings-group__item">
            <div className="field">
              <label className="field__label" htmlFor="voice-sample-rate">
                {t("dialogs.serverSettings.voice.sampleRate")}
              </label>
              <select
                id="voice-sample-rate"
                className="select"
                value={draft.sampleRate}
                onChange={(e) => patch({ sampleRate: Number(e.target.value) })}
              >
                {SAMPLE_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {(rate / 1000).toLocaleString()} kHz
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-grid-2" style={{ marginTop: 14 }}>
              <div className="field">
                <label className="field__label" htmlFor="voice-min-bitrate">
                  {t("dialogs.serverSettings.voice.bitrateRange")}
                </label>
                <div className="voice-device-row">
                  <input
                    id="voice-min-bitrate"
                    className="input"
                    type="number"
                    min={6}
                    max={510}
                    value={Math.round(draft.minBitrate / 1000)}
                    onChange={(e) => patch({ minBitrate: Number(e.target.value) * 1000 })}
                  />
                  <span className="field__hint">—</span>
                  <input
                    className="input"
                    type="number"
                    min={6}
                    max={510}
                    value={Math.round(draft.maxBitrate / 1000)}
                    onChange={(e) => patch({ maxBitrate: Number(e.target.value) * 1000 })}
                  />
                  <span className="field__hint">kb/s</span>
                </div>
                <p className="field__hint">{t("dialogs.serverSettings.voice.bitrateRangeDesc")}</p>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="voice-bitrate">
                  {t("dialogs.serverSettings.voice.bitrateDefault")}
                </label>
                <input
                  id="voice-bitrate"
                  type="range"
                  className="slider"
                  min={draft.minBitrate}
                  max={draft.maxBitrate}
                  step={1000}
                  value={Math.min(Math.max(draft.bitrate, draft.minBitrate), draft.maxBitrate)}
                  onChange={(e) => patch({ bitrate: Number(e.target.value) })}
                />
                <p className="field__hint">{kb(draft.bitrate)}</p>
              </div>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label className="field__label" htmlFor="voice-max-participants">
                {t("dialogs.serverSettings.voice.maxParticipants")}
              </label>
              <input
                id="voice-max-participants"
                className="input"
                type="number"
                min={0}
                max={512}
                value={draft.maxParticipants}
                onChange={(e) => patch({ maxParticipants: Number(e.target.value) })}
              />
              <p className="field__hint">
                {draft.maxParticipants === 0
                  ? t("dialogs.serverSettings.voice.unlimited")
                  : t("dialogs.serverSettings.voice.maxParticipantsDesc")}
              </p>
            </div>
          </div>

          <div className="settings-group__item">
            {(
              [
                ["fec", "fec", "fecDesc"],
                ["dtx", "dtx", "dtxDesc"],
                ["stereo", "stereo", "stereoDesc"],
              ] as const
            ).map(([key, title, description], index) => (
              <div
                key={key}
                className="settings-row"
                style={
                  index === 0
                    ? undefined
                    : { marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }
                }
              >
                <div className="settings-row__info">
                  <h4 className="settings-card__title" style={{ margin: 0 }}>
                    {t(`dialogs.serverSettings.voice.${title}`)}
                  </h4>
                  <p className="settings-card__subtitle" style={{ marginTop: 2 }}>
                    {t(`dialogs.serverSettings.voice.${description}`)}
                  </p>
                </div>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={(e) => patch({ [key]: e.target.checked } as Partial<VoiceSettings>)}
                  />
                  <span className="settings-switch__slider" />
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-card">
          <h3 className="settings-card__title">{t("dialogs.serverSettings.voice.deployment")}</h3>
          <p className="settings-card__subtitle">
            {t("dialogs.serverSettings.voice.deploymentDesc")}
          </p>
        </div>

        {error ? (
          <p className="field__error" style={{ marginTop: 0 }}>
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="field__hint" style={{ marginTop: 0 }}>
            {t("dialogs.serverSettings.voice.saved")}
          </p>
        ) : null}

        <div>
          <button type="submit" className="btn btn--primary" disabled={!canManage || saving}>
            {t("dialogs.serverSettings.voice.save")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
