import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { assignableRoles, outranks, useMyPermissions } from "@/store/selectors";
import { Avatar, resolveAvatarUrl } from "../Avatar";
import { Modal } from "../Modal";
import { ConfirmDialog } from "./ConfirmDialog";

interface MemberDialogProps {
  userId: number;
  onClose(): void;
}

/** A member card: who they are, what they hold, and what you may do about it. */
export function MemberDialog({ userId, onClose }: MemberDialogProps) {
  const { t } = useTranslation();
  const user = useSession(
    (state) => state.users.get(userId) ?? (state.self?.id === userId ? state.self : undefined),
  );
  const self = useSession((state) => state.self);
  const roles = useSession((state) => state.roles);
  const channels = useSession((state) => state.channels);
  const address = useSession((state) => state.address);
  const setRoleMembership = useSession((state) => state.setRoleMembership);
  const moveUser = useSession((state) => state.moveUser);
  const kickUser = useSession((state) => state.kickUser);
  const permissions = useMyPermissions();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmKick, setConfirmKick] = useState(false);

  const grantable = useMemo(() => assignableRoles(self, roles), [self, roles]);
  const voiceChannels = useMemo(
    () =>
      [...channels.values()]
        .filter((channel) => channel.type === "voice")
        .sort((a, b) => a.position - b.position),
    [channels],
  );

  if (!user || !self) return null;

  const bannerSrc = resolveAvatarUrl(user.banner, address);
  const isSelf = user.id === self.id;
  const canModerate = outranks(self, user, roles);
  const held = user.roles
    .map((id) => roles.get(id))
    .filter((role) => role !== undefined)
    .sort((a, b) => b.position - a.position);

  async function guard(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={user.nickname} subtitle={user.registered ? `@${user.username}` : t("common.guest")} onClose={onClose}>
      {bannerSrc ? (
        <div
          className="member-dialog-banner"
          style={{ backgroundImage: `url("${bannerSrc}")`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: bannerSrc ? -20 : 0, position: "relative", zIndex: 1 }}>
        <Avatar user={user} size="lg" status={user.status} showStatus />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
          {user.customStatus ? (
            <div className="member-dialog-custom-status">
              💬 {user.customStatus}
            </div>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {held.map((role) => (
              <span
                key={role!.id}
                className="tag"
                style={role!.color ? { color: role!.color, background: `${role!.color}22` } : undefined}
              >
                {role!.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {error ? <p className="alert">{error}</p> : null}

      {grantable.length > 0 && !isSelf ? (
        <div className="field">
          <span className="field__label">{t("contextMenu.roles")}</span>
          <div className="permlist">
            {grantable.map((role) => {
              const granted = user.roles.includes(role.id);
              return (
                <label key={role.id} className="perm">
                  <input
                    type="checkbox"
                    checked={granted}
                    disabled={busy || !canModerate}
                    onChange={() =>
                      void guard(() => setRoleMembership(user.id, role.id, !granted))
                    }
                  />
                  <span>
                    <span className="perm__name" style={role.color ? { color: role.color } : undefined}>
                      {role.name}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {!canModerate ? (
            <span className="field__hint">{t("errors.forbidden")}</span>
          ) : null}
        </div>
      ) : null}

      {has(permissions, Perm.MoveUsers) && !isSelf ? (
        <div className="field">
          <label className="field__label" htmlFor="move-target">
            {t("permissions.names.MoveUsers")}
          </label>
          <select
            id="move-target"
            className="select"
            value={user.channelId === null ? "" : String(user.channelId)}
            disabled={busy || !canModerate}
            onChange={(event) =>
              void guard(() =>
                moveUser(user.id, event.target.value === "" ? null : Number(event.target.value)),
              )
            }
          >
            <option value="">{t("common.none")}</option>
            {voiceChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {has(permissions, Perm.KickUsers) && !isSelf ? (
        <button
          className="btn btn--danger"
          disabled={busy || !canModerate}
          onClick={() => setConfirmKick(true)}
        >
          {t("contextMenu.kickMember", { name: user.nickname })}
        </button>
      ) : null}

      {confirmKick ? (
        <ConfirmDialog
          title={t("dialogs.confirm.kickUserTitle")}
          subtitle={t("dialogs.confirm.kickUserConfirm", { name: user.nickname })}
          confirmText={t("members.kick")}
          danger
          onConfirm={() =>
            void guard(async () => {
              setConfirmKick(false);
              await kickUser(user.id);
              onClose();
            })
          }
          onClose={() => setConfirmKick(false)}
        />
      ) : null}
    </Modal>
  );
}
