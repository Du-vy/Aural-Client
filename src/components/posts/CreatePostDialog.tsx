import { useState, useRef, type FormEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { describeError, type Channel, type PostEventDetails } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { Modal } from "../Modal";
import { ClockIcon, MapPinIcon, PaperclipIcon, UploadCloudIcon, TrashIcon } from "../Icons";
import { DateTimePicker } from "./DateTimePicker";
import { MentionPicker } from "../MentionPicker";
import { useMentionAutocomplete } from "./useMentionAutocomplete";

interface CreatePostDialogProps {
  channel: Channel;
  initialDate?: Date | null;
  initialFiles?: File[] | null;
  onClose(): void;
  onCreated?(postId: number): void;
}

export function CreatePostDialog({ channel, initialDate, initialFiles, onClose, onCreated }: CreatePostDialogProps) {
  const { t } = useTranslation();
  const createPost = useSession((state) => state.createPost);
  const uploadAttachment = useSession((state) => state.uploadAttachment);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    suggestions,
    activeMentionIndex,
    setActiveMentionIndex,
    refreshMention,
    chooseMention,
    handleMentionKeyDown,
  } = useMentionAutocomplete(content, setContent, contentTextareaRef);

  // Calendar specific
  const [startsAtDate, setStartsAtDate] = useState(() => {
    const d = initialDate ? new Date(initialDate) : new Date();
    if (initialDate) {
      d.setHours(10, 0, 0, 0);
    } else {
      d.setMinutes(d.getMinutes() + 30);
      d.setSeconds(0, 0);
    }
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [endsAtDate, setEndsAtDate] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");

  // Media / Attachments
  const [files, setFiles] = useState<File[]>(() => initialFiles ?? []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCalendar = channel.type === "calendar";
  const isMedia = channel.type === "media";
  const isAnnouncement = channel.type === "announcement";
  const isForum = channel.type === "forum";

  const dialogTitle = isAnnouncement
    ? t("posts.newAnnouncement")
    : isCalendar
      ? t("posts.newEvent")
      : isMedia
        ? t("posts.newMedia")
        : t("posts.newTopic");

  const titlePlaceholder =
    files.length > 0
      ? files[0]!.name
      : isAnnouncement
        ? t("posts.announcementTitlePlaceholder")
        : isCalendar
          ? t("posts.eventTitlePlaceholder")
          : isMedia
            ? t("posts.mediaTitlePlaceholder")
            : t("posts.topicTitlePlaceholder");

  const submitLabel = isAnnouncement
    ? t("posts.createAnnouncement")
    : isCalendar
      ? t("posts.createEvent")
      : isMedia
        ? t("posts.createMedia")
        : t("posts.createTopic");

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      const added = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...added]);
      e.target.value = "";
    }
  }

  function handleDropFiles(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const added = Array.from(e.dataTransfer.files);
      setFiles((prev) => [...prev, ...added]);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const effectiveTitle = title.trim() || files[0]?.name || "";
    if (!effectiveTitle) return;
    if (isMedia && files.length === 0) {
      setError(t("posts.mediaRequired"));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      let attachmentIds: number[] | undefined;

      if (files.length > 0) {
        setUploadProgress(t("common.loading"));
        const uploadedIds: number[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i]!;
          setUploadProgress(`${file.name} (${i + 1}/${files.length})`);
          const runner = uploadAttachment(channel.id, file);
          const att = await runner.done;
          uploadedIds.push(att.id);
        }
        attachmentIds = uploadedIds;
      }

      let eventDetails: PostEventDetails | undefined;
      if (isCalendar) {
        const startSec = Math.floor(new Date(startsAtDate).getTime() / 1000);
        let endSec: number | undefined;
        if (endsAtDate) {
          endSec = Math.floor(new Date(endsAtDate).getTime() / 1000);
        }
        eventDetails = {
          startsAt: startSec,
          endsAt: endSec,
          allDay,
          location: location.trim() || undefined,
        };
      }

      const post = await createPost({
        channelId: channel.id,
        title: effectiveTitle,
        content: content.trim() || undefined,
        event: eventDetails,
        attachments: attachmentIds,
      });

      onCreated?.(post.id);
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  const effectiveTitle = title.trim() || files[0]?.name || "";

  return (
    <Modal
      title={dialogTitle}
      subtitle={`#${channel.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            className="btn btn--primary"
            type="submit"
            form="create-post-form"
            disabled={busy || !effectiveTitle || (isMedia && files.length === 0)}
          >
            {busy ? uploadProgress || t("common.loading") : submitLabel}
          </button>
        </>
      }
    >
      <form
        id="create-post-form"
        onSubmit={(e) => void handleSubmit(e)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropFiles}
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {error ? <div className="alert">{error}</div> : null}

        <div className="field">
          <label className="field__label" htmlFor="post-title">
            {t("posts.titleLabel")}
          </label>
          <input
            id="post-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={titlePlaceholder}
            required={files.length === 0 && !isMedia}
            autoFocus
            maxLength={256}
            disabled={busy}
          />
        </div>

        {isCalendar ? (
          <div className="post-form-calendar">
            <div className="post-form-calendar__grid">
              <div className="field">
                <label className="field__label" htmlFor="starts-at">
                  <ClockIcon size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
                  {t("posts.eventStartsAt")}
                </label>
                <DateTimePicker
                  id="starts-at"
                  value={startsAtDate}
                  onChange={setStartsAtDate}
                  allDay={allDay}
                  disabled={busy}
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="ends-at">
                  <ClockIcon size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
                  {t("posts.eventEndsAt")}
                </label>
                <DateTimePicker
                  id="ends-at"
                  value={endsAtDate}
                  onChange={setEndsAtDate}
                  allDay={allDay}
                  disabled={busy}
                />
              </div>
            </div>

            <div className="post-form-calendar__extra">
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="event-location">
                  <MapPinIcon size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
                  {t("posts.eventLocation")}
                </label>
                <input
                  id="event-location"
                  className="input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t("posts.eventLocationPlaceholder")}
                  maxLength={256}
                  disabled={busy}
                />
              </div>

              <label className="checkbox-label" style={{ marginTop: 22 }}>
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  disabled={busy}
                />
                <span>{t("posts.allDay")}</span>
              </label>
            </div>
          </div>
        ) : null}

        <div className="field field--mention-wrap">
          <label className="field__label" htmlFor="post-content">
            {isMedia ? t("posts.mediaCaptionPlaceholder") : t("posts.contentLabel")}
          </label>
          {suggestions.length > 0 ? (
            <MentionPicker
              targets={suggestions}
              active={activeMentionIndex}
              onHover={setActiveMentionIndex}
              onPick={chooseMention}
            />
          ) : null}
          <textarea
            ref={contentTextareaRef}
            id="post-content"
            className="input textarea"
            rows={isAnnouncement || isForum ? 6 : 3}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              refreshMention(e.target.value, e.target.selectionStart);
            }}
            onKeyUp={(e) => {
              refreshMention(content, (e.target as HTMLTextAreaElement).selectionStart);
            }}
            onClick={(e) => {
              refreshMention(content, (e.target as HTMLTextAreaElement).selectionStart);
            }}
            onKeyDown={(e) => {
              handleMentionKeyDown(e);
            }}
            placeholder={isMedia ? t("posts.mediaCaptionPlaceholder") : t("posts.contentPlaceholder")}
            disabled={busy}
          />
        </div>

        {/* Media / Attachments Section */}
        <div className="field">
          <label className="field__label">
            <PaperclipIcon size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
            {isMedia ? t("posts.newMedia") : t("attachments.pending")}
          </label>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            accept={isMedia ? "image/*,video/*,audio/*" : undefined}
            style={{ display: "none" }}
            disabled={busy}
          />

          <div
            className="post-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropFiles}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloudIcon size={24} />
            <span>{t("posts.dragDropFiles")}</span>
          </div>

          {files.length > 0 ? (
            <div className="post-files-preview">
              {files.map((f, i) => (
                <div key={i} className="post-files-preview__item">
                  <span className="post-files-preview__name">{f.name}</span>
                  <span className="post-files-preview__size">({Math.round(f.size / 1024)} KB)</span>
                  <button
                    type="button"
                    className="iconbtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFiles((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                    disabled={busy}
                    aria-label="Remove"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
