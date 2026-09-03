import { useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { formatTimeAgo } from "@/lib/time";
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
  ChevronLeftIcon,
  ForumIcon,
  LockIcon,
  MessageSquareIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  TrashIcon,
  UnlockIcon,
} from "../Icons";

interface ForumChannelViewProps {
  channel: Channel;
  posts: Post[];
  loading: boolean;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
}

export function ForumChannelView({
  channel,
  posts,
  loading,
  onOpenMember,
}: ForumChannelViewProps) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const updatePost = useSession((state) => state.updatePost);
  const deletePost = useSession((state) => state.deletePost);
  const permissions = useMyPermissions();

  const mentions = useMemo(() => buildMentions(users, roles), [users, roles]);

  const [activeTopicId, setActiveTopicId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const canManageChannels = has(permissions, Perm.ManageChannels) || has(permissions, Perm.Administrator);

  const activeTopic = activeTopicId ? posts.find((p) => p.id === activeTopicId) : null;

  // Filtered topics
  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q) ||
        p.body?.content.toLowerCase().includes(q),
    );
  }, [posts, searchQuery]);

  // Separate pinned and unpinned
  const { pinnedPosts, regularPosts } = useMemo(() => {
    const pinned: Post[] = [];
    const regular: Post[] = [];
    for (const p of filteredPosts) {
      if (p.pinned) pinned.push(p);
      else regular.push(p);
    }
    return { pinnedPosts: pinned, regularPosts: regular };
  }, [filteredPosts]);

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
    if (activeTopicId === postId) {
      setActiveTopicId(null);
    }
  }

  // Active Thread View
  if (activeTopic) {
    const authorUser = activeTopic.userId !== null ? users.get(activeTopic.userId) : undefined;
    const isAuthor = activeTopic.userId !== null && self?.id === activeTopic.userId;
    const canModerate = canManageChannels || isAuthor;

    return (
      <div className="forum-thread-view">
        <div className="forum-thread-view__nav">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setActiveTopicId(null)}
          >
            <ChevronLeftIcon size={16} style={{ marginRight: 4 }} />
            <span>{t("posts.backToTopics")}</span>
          </button>
        </div>

        {/* OP (Original Post) Card */}
        <article className="forum-op-card">
          <header className="forum-op-card__header">
            <div
              className="forum-op-card__avatar"
              onClick={(e) => {
                if (activeTopic.userId !== null) {
                  onOpenMember?.(activeTopic.userId, e.currentTarget.getBoundingClientRect());
                }
              }}
            >
              <Avatar
                user={authorUser ?? { id: activeTopic.userId ?? 0, nickname: activeTopic.author, avatar: null }}
                size="md"
              />
            </div>

            <div className="forum-op-card__meta">
              <h2 className="forum-op-card__title">
                {activeTopic.pinned ? <PinIcon size={16} className="forum-pin-icon" /> : null}
                {activeTopic.locked ? <LockIcon size={16} className="forum-lock-icon" /> : null}
                {activeTopic.title}
              </h2>
              <div className="forum-op-card__sub">
                <span
                  className="forum-op-card__author"
                  onClick={(e) => {
                    if (activeTopic.userId !== null) {
                      onOpenMember?.(activeTopic.userId, e.currentTarget.getBoundingClientRect());
                    }
                  }}
                >
                  {authorUser?.nickname ?? activeTopic.author}
                </span>
                <span className="forum-op-card__time">
                  {formatTimeAgo(activeTopic.createdAt)}
                </span>
              </div>
            </div>

            {canModerate ? (
              <div className="forum-op-card__actions">
                <button
                  type="button"
                  className="iconbtn"
                  title={activeTopic.pinned ? t("posts.unpin") : t("posts.pin")}
                  onClick={() => void handleTogglePin(activeTopic)}
                >
                  {activeTopic.pinned ? <PinOffIcon size={16} /> : <PinIcon size={16} />}
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  title={activeTopic.locked ? t("posts.unlock") : t("posts.lock")}
                  onClick={() => void handleToggleLock(activeTopic)}
                >
                  {activeTopic.locked ? <UnlockIcon size={16} /> : <LockIcon size={16} />}
                </button>
                <button
                  type="button"
                  className="iconbtn iconbtn--danger"
                  title={t("posts.delete")}
                  onClick={() => void handleDelete(activeTopic.id)}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            ) : null}
          </header>

          {activeTopic.body?.content ? (
            <div className="forum-op-card__content">
              <Markdown
                source={activeTopic.body.content}
                mentions={mentions}
                onOpenMember={onOpenMember}
                onOpenLink={(url) => window.open(url, "_blank", "noreferrer,noopener")}
              />
            </div>
          ) : null}

          {activeTopic.body?.attachments && activeTopic.body.attachments.length > 0 ? (
            <div className="forum-op-card__attachments">
              <MessageAttachments
                attachments={activeTopic.body.attachments}
                onOpenLink={(url) => window.open(url, "_blank", "noreferrer,noopener")}
              />
            </div>
          ) : null}
        </article>

        {/* Comment replies stream */}
        <div className="forum-thread-view__comments">
          <PostCommentsThread
            channelId={channel.id}
            post={activeTopic}
            onOpenMember={onOpenMember}
          />
        </div>
      </div>
    );
  }

  // Topic List View
  return (
    <div className="forum-view">
      <div className="forum-toolbar">
        <div className="forum-search-box">
          <SearchIcon size={15} className="forum-search-icon" />
          <input
            type="search"
            className="input forum-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("posts.filterSearch")}
          />
        </div>
      </div>

      {posts.length === 0 && !loading ? (
        <div className="post-channel__empty">
          <div className="post-channel__empty-icon">
            <ForumIcon size={40} />
          </div>
          <h3 className="post-channel__empty-title">{t("posts.emptyChannel")}</h3>
          <p className="post-channel__empty-desc">{t("posts.emptyChannelHint")}</p>
        </div>
      ) : null}

      <div className="forum-topics-list">
        {pinnedPosts.length > 0 ? (
          <div className="forum-topics-section">
            <div className="forum-section-label">
              <PinIcon size={12} />
              <span>{t("posts.pinned")}</span>
            </div>
            {pinnedPosts.map((post) => (
              <TopicRow
                key={post.id}
                post={post}
                users={users}
                onClick={() => setActiveTopicId(post.id)}
              />
            ))}
          </div>
        ) : null}

        {regularPosts.map((post) => (
          <TopicRow
            key={post.id}
            post={post}
            users={users}
            onClick={() => setActiveTopicId(post.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TopicRow({
  post,
  users,
  onClick,
}: {
  post: Post;
  users: ReadonlyMap<number, any>;
  onClick(): void;
}) {
  const { t } = useTranslation();
  const authorUser = post.userId !== null ? users.get(post.userId) : undefined;

  return (
    <div className="forum-topic-row" onClick={onClick} role="button" tabIndex={0}>
      <div className="forum-topic-row__main">
        <div className="forum-topic-row__title-line">
          {post.pinned ? <PinIcon size={14} className="forum-pin-icon" /> : null}
          {post.locked ? <LockIcon size={14} className="forum-lock-icon" /> : null}
          <span className="forum-topic-row__title">{post.title}</span>
        </div>

        <div className="forum-topic-row__meta">
          <span className="forum-topic-row__author">
            {authorUser?.nickname ?? post.author}
          </span>
          <span className="forum-topic-row__dot">•</span>
          <span className="forum-topic-row__time">
            {formatTimeAgo(post.createdAt)}
          </span>
        </div>
      </div>

      <div className="forum-topic-row__stats">
        <div className="forum-topic-row__replies">
          <MessageSquareIcon size={14} />
          <span>{post.comments}</span>
        </div>

        {post.lastCommentAt ? (
          <span className="forum-topic-row__activity" title="Last reply">
            {t("posts.lastActive", { time: formatTimeAgo(post.lastCommentAt) })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
