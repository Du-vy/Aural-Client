import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { formatTimeAgo } from "@/lib/time";
import { Perm, has } from "@/lib/permissions";
import { useMyPermissions } from "@/store/selectors";
import { useSession } from "@/store/session";
import { buildMentions } from "@/lib/mentions";
import { attachmentKind, attachmentUrl } from "@/lib/uploads";
import type { Attachment, Channel, Post } from "@/lib/protocol";
import { Avatar } from "../Avatar";
import { Markdown } from "../attachments/Markdown";
import { PostCommentsThread } from "./PostCommentsThread";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FilmIcon,
  ImageIcon,
  MediaIcon,
  MessageSquareIcon,
  MusicIcon,
  TrashIcon,
} from "../Icons";

interface MediaChannelViewProps {
  channel: Channel;
  posts: Post[];
  loading: boolean;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
}

export function MediaChannelView({
  channel,
  posts,
  loading,
  onOpenMember,
}: MediaChannelViewProps) {
  const { t } = useTranslation();
  const address = useSession((state) => state.address);
  const self = useSession((state) => state.self);
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const deletePost = useSession((state) => state.deletePost);
  const permissions = useMyPermissions();

  const mentions = useMemo(() => buildMentions(users, roles), [users, roles]);

  const [activeMediaPost, setActiveMediaPost] = useState<Post | null>(null);
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState(0);

  const canManageChannels = has(permissions, Perm.ManageChannels) || has(permissions, Perm.Administrator);

  const currentPostIndex = activeMediaPost
    ? posts.findIndex((p) => p.id === activeMediaPost.id)
    : -1;

  const currentAttachments = activeMediaPost?.body?.attachments ?? [];

  const hasPrev = currentPostIndex > 0 || selectedAttachmentIndex > 0;
  const hasNext =
    (currentPostIndex >= 0 && currentPostIndex < posts.length - 1) ||
    selectedAttachmentIndex < currentAttachments.length - 1;

  const goToPrev = useCallback(() => {
    if (!activeMediaPost || currentPostIndex === -1) return;
    if (selectedAttachmentIndex > 0) {
      setSelectedAttachmentIndex((prev) => prev - 1);
    } else if (currentPostIndex > 0) {
      const prevPost = posts[currentPostIndex - 1];
      if (prevPost) {
        const prevAtts = prevPost.body?.attachments ?? [];
        setActiveMediaPost(prevPost);
        setSelectedAttachmentIndex(Math.max(0, prevAtts.length - 1));
      }
    }
  }, [activeMediaPost, currentPostIndex, selectedAttachmentIndex, posts]);

  const goToNext = useCallback(() => {
    if (!activeMediaPost || currentPostIndex === -1) return;
    if (selectedAttachmentIndex < currentAttachments.length - 1) {
      setSelectedAttachmentIndex((prev) => prev + 1);
    } else if (currentPostIndex < posts.length - 1) {
      const nextPost = posts[currentPostIndex + 1];
      if (nextPost) {
        setActiveMediaPost(nextPost);
        setSelectedAttachmentIndex(0);
      }
    }
  }, [
    activeMediaPost,
    currentPostIndex,
    selectedAttachmentIndex,
    currentAttachments.length,
    posts,
  ]);

  // Keyboard navigation for ArrowLeft, ArrowRight, and Escape
  useEffect(() => {
    if (!activeMediaPost) return;

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNext();
      } else if (event.key === "Escape") {
        event.preventDefault();
        setActiveMediaPost(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeMediaPost, goToPrev, goToNext]);

  async function handleDelete(postId: number) {
    await deletePost(postId);
    if (activeMediaPost?.id === postId) {
      setActiveMediaPost(null);
    }
  }

  function openMediaModal(post: Post) {
    setActiveMediaPost(post);
    setSelectedAttachmentIndex(0);
  }

  if (posts.length === 0 && !loading) {
    return (
      <div className="post-channel__empty">
        <div className="post-channel__empty-icon">
          <MediaIcon size={40} />
        </div>
        <h3 className="post-channel__empty-title">{t("posts.emptyChannel")}</h3>
        <p className="post-channel__empty-desc">{t("posts.emptyMediaHint")}</p>
      </div>
    );
  }

  return (
    <div className="media-view">
      <div className="media-grid">
        {posts.map((post) => {
          const attachments = post.body?.attachments ?? [];
          const primary = attachments[0];
          const kind = primary ? attachmentKind(primary) : "file";
          const url = primary ? attachmentUrl(address, primary) : "";
          const authorUser = post.userId !== null ? users.get(post.userId) : undefined;

          return (
            <div
              key={post.id}
              className="media-card"
              onClick={() => openMediaModal(post)}
              role="button"
              tabIndex={0}
            >
              <div className="media-card__thumb-wrapper">
                {kind === "image" && url ? (
                  <img src={url} alt={post.title} className="media-card__thumb" loading="lazy" />
                ) : kind === "video" && url ? (
                  <div className="media-card__video-thumb">
                    <video src={url} className="media-card__thumb" preload="metadata" />
                    <span className="media-card__kind-badge">
                      <FilmIcon size={16} />
                    </span>
                  </div>
                ) : kind === "audio" ? (
                  <div className="media-card__audio-thumb">
                    <MusicIcon size={32} />
                  </div>
                ) : (
                  <div className="media-card__file-thumb">
                    <ImageIcon size={32} />
                  </div>
                )}

                {attachments.length > 1 ? (
                  <span className="media-card__count-badge">
                    {t("posts.mediaFilesCount", { count: attachments.length })}
                  </span>
                ) : null}

                <div className="media-card__overlay">
                  <span className="media-card__title">{post.title}</span>
                  <div className="media-card__meta">
                    <span className="media-card__author">
                      {authorUser?.nickname ?? post.author}
                    </span>
                    <span className="media-card__comments">
                      <MessageSquareIcon size={12} />
                      <span>{post.comments}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox & Comments Viewer Modal */}
      {activeMediaPost ? (
        <div className="media-modal-backdrop" onClick={() => setActiveMediaPost(null)}>
          <div className="media-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="media-modal__close iconbtn"
              onClick={() => setActiveMediaPost(null)}
              aria-label={t("common.close")}
            >
              <CloseIcon size={20} />
            </button>

            {/* Left Preview Area */}
            <div className="media-modal__stage">
              {posts.length > 1 ? (
                <div className="media-modal__post-counter">
                  {currentPostIndex + 1} / {posts.length}
                </div>
              ) : null}

              {(posts.length > 1 || currentAttachments.length > 1) && (
                <>
                  <button
                    type="button"
                    className="media-modal__nav-btn media-modal__nav-btn--prev"
                    onClick={goToPrev}
                    disabled={!hasPrev}
                    title={t("posts.previousMedia")}
                    aria-label={t("posts.previousMedia")}
                  >
                    <ChevronLeftIcon size={24} />
                  </button>
                  <button
                    type="button"
                    className="media-modal__nav-btn media-modal__nav-btn--next"
                    onClick={goToNext}
                    disabled={!hasNext}
                    title={t("posts.nextMedia")}
                    aria-label={t("posts.nextMedia")}
                  >
                    <ChevronRightIcon size={24} />
                  </button>
                </>
              )}

              {(() => {
                const attachments = activeMediaPost.body?.attachments ?? [];
                const currentAttachment: Attachment | undefined = attachments[selectedAttachmentIndex] || attachments[0];

                if (!currentAttachment) {
                  return (
                    <div className="media-modal__no-media">
                      <ImageIcon size={48} />
                    </div>
                  );
                }

                const kind = attachmentKind(currentAttachment);
                const url = attachmentUrl(address, currentAttachment);

                return (
                  <div className="media-modal__display">
                    {kind === "image" ? (
                      <img src={url} alt={currentAttachment.filename} className="media-modal__img" />
                    ) : kind === "video" ? (
                      <video src={url} controls autoPlay className="media-modal__video" />
                    ) : kind === "audio" ? (
                      <div className="media-modal__audio-box">
                        <MusicIcon size={48} />
                        <p>{currentAttachment.filename}</p>
                        <audio src={url} controls className="media-modal__audio" />
                      </div>
                    ) : (
                      <div className="media-modal__file-box">
                        <p>{currentAttachment.filename}</p>
                        <a href={url} download className="btn btn--primary btn--sm">
                          <DownloadIcon size={16} />
                          <span>{t("attachments.download")}</span>
                        </a>
                      </div>
                    )}

                    {attachments.length > 1 ? (
                      <div className="media-modal__thumbnails">
                        {attachments.map((att, idx) => (
                          <button
                            key={att.id}
                            type="button"
                            className={`media-modal__thumb-btn ${idx === selectedAttachmentIndex ? "media-modal__thumb-btn--active" : ""}`}
                            onClick={() => setSelectedAttachmentIndex(idx)}
                          >
                            <span>{idx + 1}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </div>

            {/* Right Sidebar Area: Post details & Comments Thread */}
            <div className="media-modal__sidebar">
              <header className="media-modal__header">
                {(() => {
                  const postAuthor = activeMediaPost.userId !== null ? users.get(activeMediaPost.userId) : undefined;
                  const canDeletePost = canManageChannels || (activeMediaPost.userId !== null && self?.id === activeMediaPost.userId);

                  return (
                    <>
                      <div className="media-modal__author-row">
                        <div
                          className="media-modal__avatar"
                          onClick={(e) => {
                            if (activeMediaPost.userId !== null) {
                              onOpenMember?.(activeMediaPost.userId, e.currentTarget.getBoundingClientRect());
                            }
                          }}
                        >
                          <Avatar
                            user={postAuthor ?? { id: activeMediaPost.userId ?? 0, nickname: activeMediaPost.author, avatar: null }}
                            size="md"
                          />
                        </div>

                        <div className="media-modal__author-info">
                          <span
                            className="media-modal__author-name"
                            onClick={(e) => {
                              if (activeMediaPost.userId !== null) {
                                onOpenMember?.(activeMediaPost.userId, e.currentTarget.getBoundingClientRect());
                              }
                            }}
                          >
                            {postAuthor?.nickname ?? activeMediaPost.author}
                          </span>
                          <span className="media-modal__time">
                            {formatTimeAgo(activeMediaPost.createdAt)}
                          </span>
                        </div>
                      </div>

                      <div className="media-modal__title-row">
                        <h3 className="media-modal__title">{activeMediaPost.title}</h3>
                        {canDeletePost ? (
                          <button
                            type="button"
                            className="iconbtn iconbtn--danger media-modal__delete-btn"
                            title={t("posts.delete")}
                            onClick={() => void handleDelete(activeMediaPost.id)}
                          >
                            <TrashIcon size={15} />
                          </button>
                        ) : null}
                      </div>
                    </>
                  );
                })()}

                {activeMediaPost.body?.content ? (
                  <div className="media-modal__description">
                    <Markdown
                      source={activeMediaPost.body.content}
                      mentions={mentions}
                      onOpenMember={onOpenMember}
                      onOpenLink={(url) => window.open(url, "_blank", "noreferrer,noopener")}
                    />
                  </div>
                ) : null}
              </header>

              <div className="media-modal__comments">
                <PostCommentsThread
                  channelId={channel.id}
                  post={activeMediaPost}
                  onOpenMember={onOpenMember}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
