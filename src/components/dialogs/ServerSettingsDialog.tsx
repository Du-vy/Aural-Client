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
import { Modal } from "../Modal";
import { PlusIcon, TrashIcon } from "../Icons";
import { ConfirmDialog } from "./ConfirmDialog";

type Tab = "overview" | "roles";

export function ServerSettingsDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("overview");
  const permissions = useMyPermissions();

  const canManageRoles = has(permissions, Perm.ManageRoles);

  return (
    <Modal
      title={t("dialogs.settings.title")}
      onClose={onClose}
      wide
      tabs={
        <>
          <button
            className={tab === "overview" ? "tab tab--active" : "tab"}
            onClick={() => setTab("overview")}
          >
            {t("dialogs.settings.overview")}
          </button>
          {canManageRoles ? (
            <button
              className={tab === "roles" ? "tab tab--active" : "tab"}
              onClick={() => setTab("roles")}
            >
              {t("dialogs.settings.roles")}
            </button>
          ) : null}
        </>
      }
    >
      {tab === "overview" ? <OverviewTab /> : <RolesTab />}
    </Modal>
  );
}

function OverviewTab() {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const updateServer = useSession((state) => state.updateServer);
  const permissions = useMyPermissions();

  const [name, setName] = useState(server?.name ?? "");
  const [description, setDescription] = useState(server?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const allowed = has(permissions, Perm.ManageServer);

  async function submit(event: FormEvent) {
    event.preventDefault();
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

  return (
    <form
      onSubmit={(event) => void submit(event)}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {error ? <p className="alert">{error}</p> : null}
      {saved ? <p className="alert alert--info">{t("common.save")}</p> : null}
      {!allowed ? <p className="alert">{t("errors.forbidden")}</p> : null}

      <div className="field">
        <label className="field__label" htmlFor="server-name">
          {t("dialogs.settings.serverName")}
        </label>
        <input
          id="server-name"
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={64}
          disabled={!allowed}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="server-description">
          {t("dialogs.settings.serverDescription")}
        </label>
        <input
          id="server-description"
          className="input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={512}
          disabled={!allowed}
        />
        <span className="field__hint">{t("dialogs.settings.serverDescriptionHint")}</span>
      </div>


      <button className="btn btn--primary" type="submit" disabled={busy || !allowed}>
        {t("common.save")}
      </button>
    </form>
  );
}

function RolesTab() {
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

  // Keep a valid selection when the chosen role is deleted underneath us.
  useEffect(() => {
    if (selectedId !== null && !roles.has(selectedId)) {
      setSelectedId(ordered[0]?.id ?? null);
    }
  }, [roles, ordered, selectedId]);

  async function addRole() {
    setError(null);
    try {
      await createRole({ name: t("dialogs.settings.createRole"), color: "#8b93a7" });
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error ? <p className="alert">{error}</p> : null}

      <div className="rolegrid">
        <div className="rolelist">
          <button className="btn btn--ghost" onClick={() => void addRole()} style={{ marginBottom: 4 }}>
            <PlusIcon size={15} />
            {t("dialogs.settings.createRole")}
          </button>
          {ordered.map((role) => (
            <button
              key={role.id}
              className={role.id === selectedId ? "rolelist__item rolelist__item--active" : "rolelist__item"}
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

        {selected ? (
          <RoleEditor
            key={selected.id}
            role={selected}
            myPermissions={myPermissions}
            myRank={myRank}
            onDelete={() => void deleteRole(selected.id).catch((caught) => setError(describeError(caught)))}
          />
        ) : (
          <p className="field__hint">{t("dialogs.settings.roles")}</p>
        )}
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
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Editing a role you do not outrank is refused by the server, so the whole
  // form is inert rather than misleading.
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
    try {
      await updateRole({
        roleId: role.id,
        ...(isEveryone ? {} : { name: name.trim(), color }),
        hoist,
        permissions: format(mask),
      });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {error ? <p className="alert">{error}</p> : null}
      {!editable ? (
        <p className="alert">{t("errors.forbidden")}</p>
      ) : null}

      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="field__label" htmlFor={`role-name-${role.id}`}>
            {t("dialogs.settings.roleName")}
          </label>
          <input
            id={`role-name-${role.id}`}
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={48}
            disabled={!editable || isEveryone}
          />
        </div>
        <div className="field" style={{ width: 76 }}>
          <label className="field__label" htmlFor={`role-color-${role.id}`}>
            {t("dialogs.settings.roleColor")}
          </label>
          <input
            id={`role-color-${role.id}`}
            className="input"
            type="color"
            style={{ padding: 4, height: 42 }}
            value={color}
            onChange={(event) => setColor(event.target.value)}
            disabled={!editable || isEveryone}
          />
        </div>
      </div>

      <label className="perm" style={{ padding: "6px 0" }}>
        <input
          type="checkbox"
          checked={hoist}
          onChange={(event) => setHoist(event.target.checked)}
          disabled={!editable}
        />
        <span>
          <span className="perm__name">{t("dialogs.settings.hoist")}</span>
        </span>
      </label>

      <div className="field">
        <span className="field__label">{t("dialogs.settings.permissions")}</span>
        <div className="permlist">
          {PERMISSION_ORDER.map((permission) => {
            const bit = Perm[permission];
            // You can only flip a bit you hold yourself, which is what stops
            // ManageRoles from becoming a route to Administrator.
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
                  onChange={(event) =>
                    setMask((current) => (event.target.checked ? current | bit : current & ~bit))
                  }
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

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn--primary" onClick={() => void save()} disabled={!editable || !dirty || busy}>
          {t("common.save")}
        </button>
        {role.managed === "" && editable ? (
          <button className="btn btn--ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
            <TrashIcon size={15} />
            {t("common.delete")}
          </button>
        ) : null}
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title={t("dialogs.settings.deleteRole")}
          subtitle={`"${role.name}"`}
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


