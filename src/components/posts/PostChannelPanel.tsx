import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { useMyPermissions } from "@/store/selectors";
import { useSession } from "@/store/session";
import type { Channel } from "@/lib/protocol";
import { AnnouncementFeed } from "./AnnouncementFeed";
import { CalendarChannelView } from "./CalendarChannelView";
import { CreatePostDialog } from "./CreatePostDialog";
import { ForumChannelView } from "./ForumChannelView";
import { MediaChannelView } from "./MediaChannelView";
import {
  CalendarIcon,
  ForumIcon,
  MediaIcon,
  MegaphoneIcon,
  PlusIcon,
} from "../Icons";

interface PostChannelPanelProps {
  channel: Channel;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
}

export function PostChannelPanel({ channel, onOpenMember }: PostChannelPanelProps) {
  const { t } = useTranslation();
  const openPostChannel = useSession((state) => state.openPostChannel);
  const loadOlderPosts = useSession((state) => state.loadOlderPosts);
  const permissions = useMyPermissions();

  const channelPosts = useSession((state) => state.posts.get(channel.id));
  const posts = channelPosts?.posts ?? [];
  const hasMore = channelPosts?.hasMore ?? false;
  const loading = channelPosts?.loading ?? false;

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogInitialDate, setCreateDialogInitialDate] = useState<Date | null>(null);

  // Load initial posts on mount or channel change
  useEffect(() => {
    void openPostChannel(channel.id);
  }, [channel.id, openPostChannel]);

  const canCreatePosts =
    has(permissions, Perm.CreatePosts) ||
    has(permissions, Perm.ManageChannels) ||
    has(permissions, Perm.Administrator);

  const newPostLabel =
    channel.type === "announcement"
      ? t("posts.newAnnouncement")
      : channel.type === "calendar"
        ? t("posts.newEvent")
        : channel.type === "media"
          ? t("posts.newMedia")
          : t("posts.newTopic");

  function renderChannelIcon() {
    switch (channel.type) {
      case "announcement":
        return <MegaphoneIcon size={18} />;
      case "calendar":
        return <CalendarIcon size={18} />;
      case "forum":
        return <ForumIcon size={18} />;
      case "media":
        return <MediaIcon size={18} />;
      default:
        return null;
    }
  }

  return (
    <main className="post-channel-panel">
      {/* Top Banner / Channel Action Header */}
      <div className="post-channel-header">
        <div className="post-channel-header__info">
          <div className="post-channel-header__title">
            <span className="post-channel-header__icon">{renderChannelIcon()}</span>
            <h2>{channel.name}</h2>
          </div>
          {channel.topic ? (
            <p className="post-channel-header__topic">{channel.topic}</p>
          ) : null}
        </div>

        {canCreatePosts ? (
          <button
            type="button"
            className="btn btn--primary post-channel-header__create-btn"
            onClick={() => {
              setCreateDialogInitialDate(null);
              setCreateDialogOpen(true);
            }}
          >
            <PlusIcon size={16} style={{ marginRight: 6 }} />
            <span>{newPostLabel}</span>
          </button>
        ) : null}
      </div>

      {/* Main Channel Content View */}
      <div className="post-channel-content">
        {channel.type === "announcement" ? (
          <AnnouncementFeed
            channel={channel}
            posts={posts}
            loading={loading}
            onOpenMember={onOpenMember}
          />
        ) : channel.type === "calendar" ? (
          <CalendarChannelView
            channel={channel}
            posts={posts}
            loading={loading}
            onOpenMember={onOpenMember}
            onRequestCreateEvent={(date) => {
              setCreateDialogInitialDate(date);
              setCreateDialogOpen(true);
            }}
          />
        ) : channel.type === "forum" ? (
          <ForumChannelView
            channel={channel}
            posts={posts}
            loading={loading}
            onOpenMember={onOpenMember}
          />
        ) : channel.type === "media" ? (
          <MediaChannelView
            channel={channel}
            posts={posts}
            loading={loading}
            onOpenMember={onOpenMember}
          />
        ) : null}

        {hasMore && channel.type !== "calendar" ? (
          <div className="post-channel-load-more">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={loading}
              onClick={() => void loadOlderPosts(channel.id)}
            >
              {loading ? t("common.loading") : t("chat.loadOlder")}
            </button>
          </div>
        ) : null}
      </div>

      {createDialogOpen ? (
        <CreatePostDialog
          channel={channel}
          initialDate={createDialogInitialDate}
          onClose={() => setCreateDialogOpen(false)}
        />
      ) : null}
    </main>
  );
}
