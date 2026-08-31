import { useTranslation } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { Avatar } from "./Avatar";
import { GearIcon, HangUpIcon, LogOutIcon } from "./Icons";

interface UserPanelProps {
  onOpenAccount(): void;
}

/**
 * The bottom-left panel: who you are on this server, whether you are in a voice
 * channel, and the way out of both.
 */
export function UserPanel({ onOpenAccount }: UserPanelProps) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const channels = useSession((state) => state.channels);
  const status = useSession((state) => state.status);
  const leaveChannel = useSession((state) => state.leaveChannel);
  const disconnect = useSession((state) => state.disconnect);

  if (!self) return null;

  const channel = self.channelId === null ? null : channels.get(self.channelId);

  const state =
    status === "reconnecting"
      ? t("connect.reconnecting")
      : channel
        ? channel.name
        : self.registered
          ? `@${self.username}`
          : `${t("common.guest")}`;

  return (
    <div className="userpanel">
      <button className="userpanel__identity" onClick={onOpenAccount} title={t("dialogs.account.title")}>
        <Avatar user={self} size="md" online={status === "connected"} />
        <span className="userpanel__body">
          <span className="userpanel__name">{self.nickname}</span>
          <span className="userpanel__status">{state}</span>
        </span>
      </button>

      <div className="userpanel__actions">
        {channel ? (
          <button
            className="iconbtn iconbtn--danger"
            onClick={() => void leaveChannel()}
            title={`${t("common.leave")} ${channel.name}`}
            aria-label={`${t("common.leave")} ${channel.name}`}
          >
            <HangUpIcon size={17} />
          </button>
        ) : null}
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

