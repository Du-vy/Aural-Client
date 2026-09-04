import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { formatTimeAgo } from "@/lib/time";
import { Perm, has } from "@/lib/permissions";
import { useMyPermissions } from "@/store/selectors";
import { useSession } from "@/store/session";
import type { Attachment, Post } from "@/lib/protocol";
import { Avatar } from "../Avatar";
import { MessageContent } from "../MessageContent";
import { MentionPicker } from "../MentionPicker";
import { useMentionAutocomplete } from "./useMentionAutocomplete";
import {
  LockIcon,
  PaperclipIcon,
  SendIcon,
  TrashIcon,
} from "../Icons";

interface PostCommentsThreadProps {
  channelId: number;
  post: Post;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
}

export function PostCommentsThread({
  channelId,
  post,
  onOpenMember,
}: PostCommentsThreadProps) {
  const { t } = useTranslation();
  const openPostComments = useSession((state) => state.openPostComments);
  const loadOlderPostComments = useSession((state) => state.loadOlderPostComments);
  const sendPostComment = useSession((state) => state.sendPostComment);
  const deleteMessage = useSession((state) => state.deleteMessage);
  const uploadAttachment = useSession((state) => state.uploadAttachment);
  const self = useSession((state) => state.self);
  const users = useSession((state) => state.users);
  const permissions = useMyPermissions();

  const commentState = useSession((state) => state.postComments.get(post.id));
  const messages = commentState?.messages ?? [];
  const hasMore = commentState?.hasMore ?? false;
  const loading = commentState?.loading ?? false;

  const [draft, setDraft] = useState("");
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    mentions,
    suggestions,
    activeMentionIndex,
    setActiveMentionIndex,
    refreshMention,
    chooseMention,
    handleMentionKeyDown,
  } = useMentionAutocomplete(draft, setDraft, composerInputRef);

  const [submitting, setSubmitting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void openPostComments(channelId, post.id);
  }, [channelId, post.id, openPostComments]);

  const canManageMessages = has(permissions, Perm.ManageMessages) || has(permissions, Perm.Administrator);

  async function handleSend(event?: FormEvent) {
    if (event) event.preventDefault();
    const content = draft.trim();
    if ((!content && pendingFiles.length === 0) || submitting || post.locked) return;

    const savedDraft = draft;
    const savedFiles = [...pendingFiles];

    setSubmitting(true);
    setDraft("");
    setPendingFiles([]);
    composerInputRef.current?.focus();

    try {
      let attachmentIds: number[] | undefined;
      if (savedFiles.length > 0) {
        setUploadingFiles(true);
        const uploaded: Attachment[] = [];
        for (const file of savedFiles) {
          const run = uploadAttachment(channelId, file);
          const att = await run.done;
          uploaded.push(att);
        }
        attachmentIds = uploaded.map((a) => a.id);
      }

      await sendPostComment(channelId, post.id, content, attachmentIds);
    } catch (err) {
      console.error("Failed to send post comment:", err);
      setDraft((current) => (current ? `${savedDraft} ${current}` : savedDraft));
      setPendingFiles(savedFiles);
    } finally {
      setSubmitting(false);
      setUploadingFiles(false);
      if (
        document.activeElement === null ||
        document.activeElement === document.body ||
        document.activeElement === composerInputRef.current
      ) {
        composerInputRef.current?.focus();
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      const added = Array.from(e.target.files);
      setPendingFiles((prev) => [...prev, ...added]);
      e.target.value = "";
    }
  }

  function removeFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="post-thread">
      <div className="post-thread__header">
        <h4 className="post-thread__title">
          {post.comments === 1
            ? t("posts.oneComment")
            : t("posts.commentsCount", { count: post.comments })}
        </h4>
        {hasMore ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={loading}
            onClick={() => void loadOlderPostComments(channelId, post.id)}
          >
            {loading ? t("common.loading") : t("chat.loadOlder")}
          </button>
        ) : null}
      </div>

      <div className="post-thread__list" ref={listRef}>
        {messages.length === 0 && !loading ? (
          <p className="post-thread__empty">{t("posts.noComments")}</p>
        ) : null}

        {messages.map((comment) => {
          const authorUser = comment.userId !== null ? users.get(comment.userId) : undefined;
          const isSelf = comment.userId !== null && self?.id === comment.userId;
          const canDelete = isSelf || canManageMessages;

          return (
            <div key={comment.id} className="post-comment">
              <div
                className="post-comment__avatar"
                onClick={(e) => {
                  if (comment.userId !== null) {
                    onOpenMember?.(comment.userId, e.currentTarget.getBoundingClientRect());
                  }
                }}
              >
                <Avatar
                  user={authorUser ?? { id: comment.userId ?? 0, nickname: comment.author, avatar: null }}
                  size="sm"
                />
              </div>

              <div className="post-comment__body">
                <div className="post-comment__meta">
                  <span
                    className="post-comment__author"
                    onClick={(e) => {
                      if (comment.userId !== null) {
                        onOpenMember?.(comment.userId, e.currentTarget.getBoundingClientRect());
                      }
                    }}
                  >
                    {authorUser?.nickname ?? comment.author}
                  </span>
                  <span className="post-comment__time">
                    {formatTimeAgo(comment.createdAt)}
                  </span>
                  {canDelete ? (
                    <button
                      type="button"
                      className="post-comment__delete iconbtn"
                      title={t("common.delete")}
                      onClick={() => void deleteMessage(comment.id)}
                    >
                      <TrashIcon size={13} />
                    </button>
                  ) : null}
                </div>

                <div className="post-comment__content">
                  <MessageContent
                    content={comment.content}
                    editedAt={comment.editedAt}
                    attachments={comment.attachments}
                    embeds={comment.embeds}
                    mentions={mentions}
                    self={self}
                    onOpenLink={(url) => window.open(url, "_blank", "noreferrer,noopener")}
                    onOpenMember={onOpenMember}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {post.locked ? (
        <div className="post-thread__locked">
          <LockIcon size={16} />
          <span>{t("posts.lockedPlaceholder")}</span>
        </div>
      ) : (
        <form className="post-thread__composer" onSubmit={(e) => void handleSend(e)} style={{ position: "relative" }}>
          {suggestions.length > 0 ? (
            <MentionPicker
              targets={suggestions}
              active={activeMentionIndex}
              onHover={setActiveMentionIndex}
              onPick={chooseMention}
            />
          ) : null}

          {pendingFiles.length > 0 ? (
            <div className="post-thread__files">
              {pendingFiles.map((file, idx) => (
                <span key={idx} className="post-thread__file-badge">
                  <span>{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="post-thread__input-bar">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ display: "none" }}
              multiple
            />
            <button
              type="button"
              className="iconbtn"
              title={t("attachments.attach")}
              aria-label={t("attachments.attach")}
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
            >
              <PaperclipIcon size={16} />
            </button>

            <textarea
              ref={composerInputRef}
              className="post-thread__input"
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                refreshMention(e.target.value, e.target.selectionStart);
              }}
              onKeyUp={(e) => {
                refreshMention(draft, (e.target as HTMLTextAreaElement).selectionStart);
              }}
              onClick={(e) => {
                refreshMention(draft, (e.target as HTMLTextAreaElement).selectionStart);
              }}
              onKeyDown={(e) => {
                const handled = handleMentionKeyDown(e);
                if (handled) return;
                handleKeyDown(e);
              }}
              placeholder={t("posts.replyPlaceholder")}
            />

            <button
              type="submit"
              className="btn btn--primary btn--sm post-thread__send"
              disabled={(!draft.trim() && pendingFiles.length === 0) || submitting || uploadingFiles}
              aria-label={t("posts.sendReply")}
            >
              <SendIcon size={14} />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
