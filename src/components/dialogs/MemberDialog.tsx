import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { assignableRoles, isOnline, outranks, useMyPermissions } from "@/store/selectors";
import { useVoice } from "@/store/voice";
import { ActivityCard } from "../ActivityCard";
import { Avatar, avatarColor, resolveAvatarUrl } from "../Avatar";
import { CheckIcon, CloseIcon, CopyIcon, CrownIcon, PlusIcon } from "../Icons";
import { ConfirmDialog } from "./ConfirmDialog";

interface MemberDialogProps {
  userId: number;
  anchorRect?: DOMRect;
  onClose(): void;
  /**
   * Show the conversation with this member. The card writes the first line
   * itself and then hands the reader over to the panel, which is where the
   * reply will arrive.
   */
  onOpenConversation?(userId: number): void;
}

/** A Discord-style member profile card popout. */
export function MemberDialog({
  userId,
  anchorRect,
  onClose,
  onOpenConversation,
}: MemberDialogProps) {
  const { t } = useTranslation();
  const user = useSession(
    (state) => state.users.get(userId) ?? (state.self?.id === userId ? state.self : undefined),
  );
  const self = useSession((state) => state.self);
  const server = useSession((state) => state.server);
  const roles = useSession((state) => state.roles);
  const channels = useSession((state) => state.channels);
  const address = useSession((state) => state.address);
  const setRoleMembership = useSession((state) => state.setRoleMembership);
  const moveUser = useSession((state) => state.moveUser);
  const kickUser = useSession((state) => state.kickUser);
  const sendDirectMessage = useSession((state) => state.sendDirectMessage);
  const permissions = useMyPermissions();

  const voiceState = useSession((state) => state.voiceStates.get(userId));
  // Volumes are keyed by server as well as by person, and this dialog is
  // always about the server on screen, which is not always the one in a call.
  const serverId = useSession((state) => state.serverId);
  const setUserVolume = useVoice((state) => state.setUserVolume);
  const volume = useVoice((state) => state.volumeFor(userId, serverId));

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmKick, setConfirmKick] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [showRoleManager, setShowRoleManager] = useState(false);
  /** The first line of a conversation, written from the card that starts it. */
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);

  const [coords, setCoords] = useState<{ top: number; left: number } | null>(() => {
    if (!anchorRect) return null;
    const popoutWidth = 340;
    const popoutHeight = 480;
    let left: number;
    if (anchorRect.left > window.innerWidth / 2) {
      left = Math.max(12, anchorRect.left - popoutWidth - 10);
    } else {
      left = Math.min(window.innerWidth - popoutWidth - 12, anchorRect.right + 10);
    }
    const maxTop = Math.max(12, window.innerHeight - popoutHeight - 12);
    const top = Math.max(12, Math.min(anchorRect.top, maxTop));
    return { top, left };
  });

  useLayoutEffect(() => {
    if (!anchorRect) return;

    function updatePos() {
      if (!anchorRect) return;
      const cardEl = cardRef.current;
      const popoutWidth = cardEl ? cardEl.offsetWidth : 340;
      const popoutHeight = cardEl ? cardEl.offsetHeight : 480;

      let left: number;
      if (anchorRect.left > window.innerWidth / 2) {
        left = Math.max(12, anchorRect.left - popoutWidth - 10);
      } else {
        left = Math.min(window.innerWidth - popoutWidth - 12, anchorRect.right + 10);
      }

      const maxTop = Math.max(12, window.innerHeight - popoutHeight - 12);
      const top = Math.max(12, Math.min(anchorRect.top, maxTop));
      setCoords({ top, left });
    }

    updatePos();

    function onResize() {
      onClose();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [anchorRect, onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
  // Three separate reasons the box may be closed, and they read differently:
  // the server carries none, this member may not send any, or they turned
  // their own off — which stops their writing as well as everybody else's.
  const dmAvailable = !isSelf && (server?.directMessages ?? false);
  const dmDisabledReason = !has(permissions, Perm.SendDirectMessages)
    ? t("dm.noPermission")
    : self.dmPrivacy === "none"
      ? t("dm.selfDisabled")
      : null;
  const canModerate = outranks(self, user, roles);
  // Moving somebody between voice channels and kicking them both act on a
  // connection, so neither is offered for a member who is away. Renaming and
  // role grants outlive one and stay.
  const here = isOnline(user);
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
    <div
      className="scrim--popout"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="member-profile-popout"
        style={
          coords
            ? { top: `${coords.top}px`, left: `${coords.left}px` }
            : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
        }
        role="dialog"
        aria-modal="true"
        aria-label={user.nickname}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Banner with frosted glass close button */}
        <div
          className="profile-card__banner"
          style={
            bannerSrc
              ? { backgroundImage: `url("${bannerSrc}")` }
              : {
                  background: `linear-gradient(135deg, ${avatarColor(user.id)}cc 0%, #18191c 100%)`,
                }
          }
        >
          <button
            type="button"
            className="profile-card__close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Avatar & Badges row */}
        <div className="profile-card__avatar-row">
          <div className="profile-card__avatar-wrap">
            <Avatar user={user} size="xl" status={user.status} showStatus />
          </div>

          <div className="profile-card__badges">
            {/* Ownership is not a role, so the role list below says nothing
                about it. This is the only place it is legible. */}
            {user.owner ? (
              <span
                className="profile-card__badge-pill profile-card__badge-pill--owner"
                title={t("dialogs.member.ownerUser")}
              >
                <CrownIcon size={13} />
                <span>{t("common.owner")}</span>
              </span>
            ) : null}
            <span
              className="profile-card__badge-pill"
              title={user.registered ? t("dialogs.member.registeredUser") : t("dialogs.member.guestUser")}
            >
              {user.registered ? <CheckIcon size={13} style={{ color: "var(--accent, #5865F2)" }} /> : null}
              <span>{user.registered ? t("dialogs.userSettings.account.registeredBadge") : t("dialogs.userSettings.account.guestBadge")}</span>
            </span>
            <button
              type="button"
              className="profile-card__copy-id"
              title={copiedId ? t("common.saved") : t("contextMenu.copyUserId")}
              onClick={() => {
                void navigator.clipboard.writeText(String(user.id));
                setCopiedId(true);
                setTimeout(() => setCopiedId(false), 1500);
              }}
            >
              {copiedId ? <CheckIcon size={13} style={{ color: "var(--online, #23a55a)" }} /> : <CopyIcon size={13} />}
            </button>
          </div>
        </div>

        {/* Profile Identity (Name, Username, Custom Status) */}
        <div className="profile-card__identity">
          <div className="profile-card__name">
            {user.nickname}
          </div>
          <div className="profile-card__username">
            {user.registered ? `@${user.username}` : t("common.guest")}
          </div>

          {user.customStatus ? (
            <div className="profile-card__custom-status">
              <span>💬</span>
              <span>{user.customStatus}</span>
            </div>
          ) : null}
        </div>

        {/* Dark Inner Section */}
        <div className="profile-card__inner">
          {error ? <div className="alert alert--danger">{error}</div> : null}

          {/* What they are doing outside Aural. First because it is the only
              thing on this card that is true right now rather than in general,
              and it is gone the moment their connection is. */}
          {user.activity ? <ActivityCard activity={user.activity} /> : null}

          {/* Server / Account Section */}
          <div className="profile-card__section">
            <span className="profile-card__label">
              {server?.name ? server.name : t("dialogs.member.account")}
            </span>
            <span style={{ fontSize: 13, color: "var(--text)" }}>
              {user.registered ? t("dialogs.member.registeredUser") : t("dialogs.member.guestUser")}
            </span>
          </div>

          <div className="profile-card__divider" />

          {/* Roles Section */}
          <div className="profile-card__section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="profile-card__label">{t("contextMenu.roles")}</span>
              {grantable.length > 0 && canModerate && !isSelf ? (
                <button
                  type="button"
                  className="discord-role-add-btn"
                  title={t("contextMenu.roles")}
                  onClick={() => setShowRoleManager(!showRoleManager)}
                >
                  <PlusIcon size={12} />
                  <span>{showRoleManager ? t("common.cancel") : t("common.apply")}</span>
                </button>
              ) : null}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {held.length > 0 ? (
                held.map((role) => (
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

            {showRoleManager && grantable.length > 0 && canModerate && !isSelf ? (
              <div className="profile-card__role-manage-box">
                {grantable.map((role) => {
                  const granted = user.roles.includes(role.id);
                  return (
                    <label key={role.id} className="perm" style={{ padding: "4px 6px" }}>
                      <input
                        type="checkbox"
                        checked={granted}
                        disabled={busy || !canModerate}
                        onChange={() =>
                          void guard(() => setRoleMembership(user.id, role.id, !granted))
                        }
                      />
                      <span>
                        <span
                          className="perm__name"
                          style={role.color ? { color: role.color } : undefined}
                        >
                          {role.name}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Voice Volume Slider */}
          {voiceState && !isSelf ? (
            <>
              <div className="profile-card__divider" />
              <div className="profile-card__section">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="profile-card__label" htmlFor="member-volume">
                    {t("voice.volume")}
                  </label>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{volume}%</span>
                </div>
                <input
                  id="member-volume"
                  type="range"
                  className="slider"
                  min={0}
                  max={200}
                  value={volume}
                  onChange={(event) => setUserVolume(user.id, Number(event.target.value), serverId)}
                />
                {volume !== 100 ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ alignSelf: "flex-start", marginTop: 4 }}
                    onClick={() => setUserVolume(user.id, 100, serverId)}
                  >
                    {t("voice.resetVolume")}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {/* Move User Voice Channel */}
          {has(permissions, Perm.MoveUsers) && !isSelf && here ? (
            <>
              <div className="profile-card__divider" />
              <div className="profile-card__section">
                <label className="profile-card__label" htmlFor="move-target">
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
            </>
          ) : null}

          {/* Write to them, which is what most of these cards are opened for */}
          {dmAvailable ? (
            <>
              <div className="profile-card__divider" />
              <form
                className="profile-card__dm"
                onSubmit={(event) => {
                  event.preventDefault();
                  const content = draft.trim();
                  if (content === "" || sending || dmDisabledReason) return;
                  setSending(true);
                  setError(null);
                  void sendDirectMessage(user.id, content)
                    .then(() => {
                      setDraft("");
                      // The reply lands in the conversation, not here, so the
                      // card gets out of the way once the line is away.
                      onOpenConversation?.(user.id);
                      onClose();
                    })
                    .catch((caught) => setError(describeError(caught)))
                    .finally(() => setSending(false));
                }}
              >
                <input
                  className="input profile-card__dm-input"
                  value={draft}
                  disabled={sending || dmDisabledReason !== null}
                  placeholder={dmDisabledReason ?? t("dm.placeholder", { name: user.nickname })}
                  aria-label={t("dm.messageNamed", { name: user.nickname })}
                  maxLength={2000}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn--primary btn--sm"
                  disabled={sending || draft.trim() === "" || dmDisabledReason !== null}
                >
                  {t("dm.message")}
                </button>
              </form>
            </>
          ) : null}

          {/* Kick User */}
          {has(permissions, Perm.KickUsers) && !isSelf && here ? (
            <>
              <div className="profile-card__divider" />
              <button
                type="button"
                className="btn btn--danger btn--sm"
                style={{ width: "100%", marginTop: 2 }}
                disabled={busy || !canModerate}
                onClick={() => setConfirmKick(true)}
              >
                {t("contextMenu.kickMember", { name: user.nickname })}
              </button>
            </>
          ) : null}
        </div>

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
      </div>
    </div>
  );
}
