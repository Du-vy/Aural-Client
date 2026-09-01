import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import {
  PERMISSION_ORDER,
  Perm,
  format,
  getPermissionHelp,
  getPermissionName,
  has,
  isSet,
  parse,
} from "@/lib/permissions";
import { describeError, type Role } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { useMyPermissions, useMyRank } from "@/store/selectors";
import { SettingsModal, type SettingsNavCategory } from "../SettingsModal";
import {
  FileTextIcon,
  FolderIcon,
  HashIcon,
  LinkIcon,
  PlusIcon,
  ShieldIcon,
  SlidersIcon,
  SmileyIcon,
  TrashIcon,
  UsersIcon,
  UserXIcon,
  VoiceIcon,
  LogOutIcon,
} from "../Icons";
import { ConfirmDialog } from "./ConfirmDialog";

type ServerTabId =
  | "overview"
  | "roles"
  | "channels"
  | "emojis"
  | "integrations"
  | "audit"
  | "members"
  | "invites"
  | "bans";

export function ServerSettingsDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const disconnect = useSession((state) => state.disconnect);

  const [activeTab, setActiveTab] = useState<ServerTabId>("overview");
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
          id: "emojis",
          label: t("dialogs.serverSettings.tabEmojis"),
          icon: <SmileyIcon size={16} />,
          badge: t("dialogs.userSettings.soonBadge"),
          badgeType: "soon",
        },
        {
          id: "integrations",
          label: t("dialogs.serverSettings.tabIntegrations"),
          icon: <LinkIcon size={16} />,
          badge: t("dialogs.userSettings.soonBadge"),
          badgeType: "soon",
        },
        {
          id: "audit",
          label: t("dialogs.serverSettings.tabAudit"),
          icon: <FileTextIcon size={16} />,
          badge: t("dialogs.userSettings.soonBadge"),
          badgeType: "soon",
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
          badge: t("dialogs.userSettings.soonBadge"),
          badgeType: "soon",
        },
      ],
    },
  ];

  const headerElement = (
    <div className="settings-server-header">
      <div className="settings-server-header__icon">
        {server.name.slice(0, 1).toUpperCase()}
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
        <span className="settings-sidebar__version">Aural Protocol v0.1</span>
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
        {activeTab === "emojis" ? <ServerEmojisPage /> : null}
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
  const claimAdmin = useSession((state) => state.claimAdmin);
  const permissions = useMyPermissions();

  const [name, setName] = useState(server?.name ?? "");
  const [description, setDescription] = useState(server?.description ?? "");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [claimDone, setClaimDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const allowed = has(permissions, Perm.ManageServer);
  const isAdmin = has(permissions, Perm.Administrator);

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
      {saved ? <div className="alert alert--info">{t("common.save")}</div> : null}
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
        <div>
          <div className="settings-card">
            <h3 className="settings-card__title">
              {t("dialogs.serverSettings.overview.serverIcon")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.serverSettings.overview.serverIconHint")}
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
              <div className="server-icon-preview">
                {name ? name.slice(0, 1).toUpperCase() : "S"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button type="button" className="btn btn--ghost btn--sm" disabled>
                  {t("dialogs.serverSettings.overview.changeIcon")}
                </button>
              </div>
            </div>
          </div>

          <div className="settings-card" style={{ marginTop: 16 }}>
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
      <div className="settings-card" style={{ marginTop: 16 }}>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      {saved ? <div className="alert alert--info">{t("common.save")}</div> : null}
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

        <div className="permlist" style={{ marginTop: 10 }}>
          {PERMISSION_ORDER.map((permission) => {
            const bit = Perm[permission];
            const locked = !editable || !has(myPermissions, bit);
            return (
              <label
                key={permission}
                className={locked ? "perm perm--locked" : "perm"}
                title={locked && editable ? t("errors.forbidden") : undefined}
              >
                <input
                  type="checkbox"
                  checked={isSet(mask, bit)}
                  disabled={locked}
                  onChange={(event) => {
                    setMask((current) => (event.target.checked ? current | bit : current & ~bit));
                    setSaved(false);
                  }}
                />
                <span>
                  <span className="perm__name">{getPermissionName(permission)}</span>
                  <span className="perm__help">{getPermissionHelp(permission)}</span>
                </span>
              </label>
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
/* Server Placeholders: Emojis, Integrations, Audit, Members, Invites, Bans    */
/* -------------------------------------------------------------------------- */

function ServerEmojisPage() {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 className="settings-section__title">
            {t("dialogs.serverSettings.emojis.title")}
          </h2>
          <span className="settings-badge settings-badge--soon">
            {t("dialogs.userSettings.soonBadge")}
          </span>
        </div>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.emojis.desc")}
        </p>
      </header>

      <div className="settings-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="settings-card__title">
              {t("dialogs.serverSettings.emojis.slotsAvailable", { used: 0, total: 50 })}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.serverSettings.emojis.uploadHint")}
            </p>
          </div>
          <button type="button" className="btn btn--primary" disabled>
            {t("dialogs.serverSettings.emojis.uploadButton")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServerIntegrationsPage() {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 className="settings-section__title">
            {t("dialogs.serverSettings.integrations.title")}
          </h2>
          <span className="settings-badge settings-badge--soon">
            {t("dialogs.userSettings.soonBadge")}
          </span>
        </div>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.integrations.desc")}
        </p>
      </header>

      <div className="settings-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="settings-card__title">Webhooks</h3>
            <p className="settings-card__subtitle">
              {t("dialogs.serverSettings.integrations.empty")}
            </p>
          </div>
          <button type="button" className="btn btn--ghost" disabled>
            {t("dialogs.serverSettings.integrations.createWebhook")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServerAuditPage() {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 className="settings-section__title">
            {t("dialogs.serverSettings.audit.title")}
          </h2>
          <span className="settings-badge settings-badge--soon">
            {t("dialogs.userSettings.soonBadge")}
          </span>
        </div>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.audit.desc")}
        </p>
      </header>

      <div className="settings-card">
        <p className="settings-card__subtitle">
          {t("dialogs.serverSettings.audit.empty")}
        </p>
      </div>
    </div>
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

function ServerBansPage() {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 className="settings-section__title">
            {t("dialogs.serverSettings.bans.title")}
          </h2>
          <span className="settings-badge settings-badge--soon">
            {t("dialogs.userSettings.soonBadge")}
          </span>
        </div>
        <p className="settings-section__desc">
          {t("dialogs.serverSettings.bans.desc")}
        </p>
      </header>

      <div className="settings-card">
        <p className="settings-card__subtitle">
          {t("dialogs.serverSettings.bans.empty")}
        </p>
      </div>
    </div>
  );
}
