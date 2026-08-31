import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  PERMISSION_HELP,
  PERMISSION_ORDER,
  Perm,
  format,
  has,
  isSet,
  parse,
} from "@/lib/permissions";
import { describeError, type Role } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { useMyPermissions, useMyRank } from "@/store/selectors";
import { Modal } from "../Modal";
import { PlusIcon, TrashIcon } from "../Icons";

type Tab = "overview" | "roles";

export function ServerSettingsDialog({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const permissions = useMyPermissions();

  const canManageRoles = has(permissions, Perm.ManageRoles);

  return (
    <Modal
      title="Server settings"
      onClose={onClose}
      wide
      tabs={
        <>
          <button
            className={tab === "overview" ? "tab tab--active" : "tab"}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          {canManageRoles ? (
            <button
              className={tab === "roles" ? "tab tab--active" : "tab"}
              onClick={() => setTab("roles")}
            >
              Roles
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
      {saved ? <p className="alert alert--info">Saved to the server configuration file.</p> : null}
      {!allowed ? <p className="alert">You are not allowed to manage this server.</p> : null}

      <div className="field">
        <label className="field__label" htmlFor="server-name">
          Server name
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
          Description
        </label>
        <input
          id="server-description"
          className="input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={512}
          disabled={!allowed}
        />
        <span className="field__hint">Shown to anyone previewing this server before connecting.</span>
      </div>

      <button className="btn btn--primary" type="submit" disabled={busy || !allowed}>
        Save
      </button>
    </form>
  );
}

function RolesTab() {
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
      await createRole({ name: "New role", color: "#8b93a7" });
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
            New role
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
          <p className="field__hint">Select a role to edit it.</p>
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
  const updateRole = useSession((state) => state.updateRole);

  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color || "#8b93a7");
  const [hoist, setHoist] = useState(role.hoist);
  const [mask, setMask] = useState(() => parse(role.permissions));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <p className="alert">This role ranks at or above your own, so you cannot edit it.</p>
      ) : null}

      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="field__label" htmlFor={`role-name-${role.id}`}>
            Name
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
            Colour
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
          <span className="perm__name">List members separately</span>
          <span className="perm__help">Give this role its own heading in the member list</span>
        </span>
      </label>

      <div className="field">
        <span className="field__label">Permissions</span>
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
                title={locked && editable ? "You do not hold this permission" : undefined}
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
                  <span className="perm__name">{permission}</span>
                  <span className="perm__help">{PERMISSION_HELP[permission]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn--primary" onClick={() => void save()} disabled={!editable || !dirty || busy}>
          Save role
        </button>
        {role.managed === "" && editable ? (
          <button className="btn btn--ghost" onClick={onDelete} disabled={busy}>
            <TrashIcon size={15} />
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
