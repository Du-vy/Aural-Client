import { useTranslation } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { Avatar } from "./Avatar";
import { ActivityGlyph, activityText, activityTooltip } from "./ActivityCard";
import { GearIcon, LogOutIcon } from "./Icons";

interface UserPanelProps {
  onOpenAccount(): void;
  onOpenStatus?(): void;
}

/**
 * The bottom-left panel: who you are on this server, your current status, and
 * the way out.
 *
 * Leaving a voice channel is not here. It belongs with everything else about a
 * call, on the voice strip directly above, which is where somebody in one is
 * already looking.
 */
export function UserPanel({ onOpenAccount, onOpenStatus }: UserPanelProps) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const channels = useSession((state) => state.channels);
  const status = useSession((state) => state.status);
  const disconnect = useSession((state) => state.disconnect);

  if (!self) return null;

  const channel = self.channelId === null ? null : channels.get(self.channelId);

  const statusLabel =
    self.status === "idle"
      ? t("status.idle")
      : self.status === "dnd"
        ? t("status.dnd")
        : self.status === "invisible"
          ? t("status.invisible")
          : t("status.online");

  // Same order as the member list, with reconnecting in front of all of it:
  // while the connection is coming back, what this person is doing is not the
  // thing they need to be told.
  const activity = status === "reconnecting" || channel ? null : self.activity;
  const state =
    status === "reconnecting"
      ? t("connect.reconnecting")
      : channel
        ? channel.name
        : activity
          ? activityText(activity)
          : self.customStatus
            ? self.customStatus
            : statusLabel;

  return (
    <div className="userpanel">
      <button
        className="userpanel__identity"
        onClick={onOpenStatus ?? onOpenAccount}
        title={t("status.changeStatus")}
      >
        <Avatar user={self} size="md" status={self.status || (status === "connected" ? "online" : "offline")} showStatus />
        <span className="userpanel__body">
          <span className="userpanel__name">{self.nickname}</span>
          <span
            className="userpanel__status"
            title={activity ? activityTooltip(activity) : state}
          >
            {activity ? <ActivityGlyph activity={activity} /> : null}
            {state}
          </span>
        </span>
      </button>

      <div className="userpanel__actions">
        <button
          className="iconbtn"
          onClick={onOpenAccount}
          title={t("userPanel.accountSettings")}
          aria-label={t("userPanel.accountSettings")}
        >
          <GearIcon size={17} />
        </button>
        <button
          className="iconbtn iconbtn--danger"
          onClick={disconnect}
          title={t("userPanel.disconnect")}
          aria-label={t("userPanel.disconnect")}
        >
          <LogOutIcon size={17} />
        </button>
      </div>
    </div>
  );
}

