import { useEffect, useState, type DragEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { useMyPermissions } from "@/store/selectors";
import { useSession } from "@/store/session";
import type { Channel } from "@/lib/protocol";
import { formatBytes, parseBytes } from "@/lib/uploads";
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
  UploadCloudIcon,
} from "../Icons";

interface PostChannelPanelProps {
  channel: Channel;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
}

export function PostChannelPanel({ channel, onOpenMember }: PostChannelPanelProps) {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const openPostChannel = useSession((state) => state.openPostChannel);
  const loadOlderPosts = useSession((state) => state.loadOlderPosts);
  const permissions = useMyPermissions();

  const channelPosts = useSession((state) => state.posts.get(channel.id));
  const posts = channelPosts?.posts ?? [];
  const hasMore = channelPosts?.hasMore ?? false;
  const loading = channelPosts?.loading ?? false;

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogInitialDate, setCreateDialogInitialDate] = useState<Date | null>(null);
  const [createDialogInitialFiles, setCreateDialogInitialFiles] = useState<File[] | null>(null);
  const [dragDepth, setDragDepth] = useState(0);

  // Load initial posts on mount or channel change
  useEffect(() => {
    void openPostChannel(channel.id);
  }, [channel.id, openPostChannel]);

  useEffect(() => {
    setDragDepth(0);
  }, [channel.id]);

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

  function carriesFiles(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes("Files");
  }

  function handleDragEnter(event: DragEvent) {
    if (createDialogOpen || !carriesFiles(event)) return;
    event.preventDefault();
    setDragDepth((d) => d + 1);
  }

  function handleDragOver(event: DragEvent) {
    if (createDialogOpen || !carriesFiles(event)) return;
    event.preventDefault();
    const uploadsAllowed = canCreatePosts && (server?.uploads?.enabled ?? true);
    event.dataTransfer.dropEffect = uploadsAllowed ? "copy" : "none";
  }

  function handleDragLeave(event: DragEvent) {
    if (createDialogOpen || !carriesFiles(event)) return;
    event.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  }

  function handleDrop(event: DragEvent) {
    setDragDepth(0);
    if (createDialogOpen || !carriesFiles(event)) return;
    event.preventDefault();
    const uploadsAllowed = canCreatePosts && (server?.uploads?.enabled ?? true);
    if (!uploadsAllowed) return;
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const dropped = Array.from(event.dataTransfer.files);
      setCreateDialogInitialFiles(dropped);
      setCreateDialogInitialDate(null);
      setCreateDialogOpen(true);
    }
  }

  const isDraggingFiles = dragDepth > 0;
  const maxBytes = parseBytes(server?.uploads?.maxFileBytes);

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
    <main
      className="post-channel-panel"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFiles ? (
        <div className="chatpanel__drop-overlay" aria-hidden="true">
          <div className="chatpanel__drop-card">
            <div className="chatpanel__drop-icon">
              <UploadCloudIcon size={44} />
            </div>
            <h3 className="chatpanel__drop-title">
              {canCreatePosts
                ? t("attachments.dropHere", { channel: channel.name })
                : t("attachments.notAllowed")}
            </h3>
            {canCreatePosts && maxBytes > 0 ? (
              <p className="chatpanel__drop-hint">
                {t("attachments.maxFileSize", { limit: formatBytes(maxBytes) })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

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
              setCreateDialogInitialFiles(null);
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
              setCreateDialogInitialFiles(null);
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
          initialFiles={createDialogInitialFiles}
          onClose={() => {
            setCreateDialogOpen(false);
            setCreateDialogInitialFiles(null);
          }}
        />
      ) : null}
    </main>
  );
}
