import { useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { formatFull, formatTimeAgo } from "@/lib/time";
import { Perm, has } from "@/lib/permissions";
import { useMyPermissions } from "@/store/selectors";
import { useSession } from "@/store/session";
import { buildMentions } from "@/lib/mentions";
import type { Channel, Post } from "@/lib/protocol";
import { Avatar } from "../Avatar";
import { Markdown } from "../attachments/Markdown";
import { MessageAttachments } from "../attachments/MessageAttachments";
import { PostCommentsThread } from "./PostCommentsThread";
import {
  LockIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  PinIcon,
  PinOffIcon,
  TrashIcon,
  UnlockIcon,
} from "../Icons";

interface AnnouncementFeedProps {
  channel: Channel;
  posts: Post[];
  loading: boolean;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
}

export function AnnouncementFeed({
  channel,
  posts,
  loading,
  onOpenMember,
}: AnnouncementFeedProps) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const updatePost = useSession((state) => state.updatePost);
  const deletePost = useSession((state) => state.deletePost);
  const permissions = useMyPermissions();

  const mentions = useMemo(() => buildMentions(users, roles), [users, roles]);

  const [expandedComments, setExpandedComments] = useState<ReadonlySet<number>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const canManageChannels = has(permissions, Perm.ManageChannels) || has(permissions, Perm.Administrator);

  function toggleComments(postId: number) {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  async function handleTogglePin(post: Post) {
    await updatePost({
      postId: post.id,
      pinned: !post.pinned,
    });
  }

  async function handleToggleLock(post: Post) {
    await updatePost({
      postId: post.id,
      locked: !post.locked,
    });
  }

  async function handleDelete(postId: number) {
    await deletePost(postId);
    setConfirmDeleteId(null);
  }

  if (posts.length === 0 && !loading) {
    return (
      <div className="post-channel__empty">
        <div className="post-channel__empty-icon">
          <MegaphoneIcon size={40} />
        </div>
        <h3 className="post-channel__empty-title">{t("posts.emptyChannel")}</h3>
        <p className="post-channel__empty-desc">{t("posts.emptyChannelHint")}</p>
      </div>
    );
  }

  return (
    <div className="announcement-feed">
      {posts.map((post) => {
        const authorUser = post.userId !== null ? users.get(post.userId) : undefined;
        const isAuthor = post.userId !== null && self?.id === post.userId;
        const canModerate = canManageChannels || isAuthor;
        const isCommentsOpen = expandedComments.has(post.id);
        const bodyContent = post.body?.content;
        const attachments = post.body?.attachments ?? [];

        return (
          <article key={post.id} className={`announcement-card ${post.pinned ? "announcement-card--pinned" : ""}`}>
            {post.pinned ? (
              <div className="announcement-card__pin-badge">
                <PinIcon size={12} />
                <span>{t("posts.pinned")}</span>
              </div>
            ) : null}

            <header className="announcement-card__header">
              <div
                className="announcement-card__avatar"
                onClick={(e) => {
                  if (post.userId !== null) {
                    onOpenMember?.(post.userId, e.currentTarget.getBoundingClientRect());
                  }
                }}
              >
                <Avatar
                  user={authorUser ?? { id: post.userId ?? 0, nickname: post.author, avatar: null }}
                  size="md"
                />
              </div>

              <div className="announcement-card__meta">
                <span
                  className="announcement-card__author"
                  onClick={(e) => {
                    if (post.userId !== null) {
                      onOpenMember?.(post.userId, e.currentTarget.getBoundingClientRect());
                    }
                  }}
                >
                  {authorUser?.nickname ?? post.author}
                </span>
                <time className="announcement-card__time" title={formatFull(post.createdAt)}>
                  {formatTimeAgo(post.createdAt)}
                </time>
                {post.locked ? (
                  <span className="announcement-card__locked-badge" title={t("posts.locked")}>
                    <LockIcon size={13} />
                  </span>
                ) : null}
              </div>

              {canModerate ? (
                <div className="announcement-card__actions">
                  <button
                    type="button"
                    className="iconbtn"
                    title={post.pinned ? t("posts.unpin") : t("posts.pin")}
                    onClick={() => void handleTogglePin(post)}
                  >
                    {post.pinned ? <PinOffIcon size={16} /> : <PinIcon size={16} />}
                  </button>

                  <button
                    type="button"
                    className="iconbtn"
                    title={post.locked ? t("posts.unlock") : t("posts.lock")}
                    onClick={() => void handleToggleLock(post)}
                  >
                    {post.locked ? <UnlockIcon size={16} /> : <LockIcon size={16} />}
                  </button>

                  <button
                    type="button"
                    className="iconbtn iconbtn--danger"
                    title={t("posts.delete")}
                    onClick={() => setConfirmDeleteId(post.id)}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              ) : null}
            </header>

            <h2 className="announcement-card__title">{post.title}</h2>

            {bodyContent ? (
              <div className="announcement-card__body">
                <Markdown
                  source={bodyContent}
                  mentions={mentions}
                  onOpenMember={onOpenMember}
                  onOpenLink={(url) => window.open(url, "_blank", "noreferrer,noopener")}
                />
              </div>
            ) : null}

            {attachments.length > 0 ? (
              <div className="announcement-card__attachments">
                <MessageAttachments
                  attachments={attachments}
                  onOpenLink={(url) => window.open(url, "_blank", "noreferrer,noopener")}
                />
              </div>
            ) : null}

            <footer className="announcement-card__footer">
              <button
                type="button"
                className={`btn btn--sm ${isCommentsOpen ? "btn--secondary" : "btn--ghost"}`}
                onClick={() => toggleComments(post.id)}
              >
                <MessageSquareIcon size={15} style={{ marginRight: 6 }} />
                <span>
                  {post.comments === 0
                    ? t("posts.comment")
                    : post.comments === 1
                      ? t("posts.oneReply")
                      : t("posts.repliesCount", { count: post.comments })}
                </span>
              </button>
            </footer>

            {isCommentsOpen ? (
              <div className="announcement-card__thread">
                <PostCommentsThread
                  channelId={channel.id}
                  post={post}
                  onOpenMember={onOpenMember}
                />
              </div>
            ) : null}

            {confirmDeleteId === post.id ? (
              <div className="announcement-card__confirm-delete alert alert--danger">
                <span>{t("posts.deleteConfirmDesc")}</span>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={() => void handleDelete(post.id)}
                  >
                    {t("common.delete")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
