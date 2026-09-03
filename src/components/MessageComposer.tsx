import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { useTranslation } from "@/lib/i18n";
import {
  EMPTY_MENTIONS,
  findMentionQuery,
  rankMentions,
  type MentionDirectory,
  type MentionQuery,
  type MentionTarget,
} from "@/lib/mentions";
import { describeError, type Attachment, type UploadLimits } from "@/lib/protocol";
import { UploadCancelled, formatBytes, parseBytes } from "@/lib/uploads";
import { AttachmentTray, type PendingFile } from "./AttachmentTray";
import { EmojiPicker, type PickerTab } from "./EmojiPicker";
import { GifIcon, PlusIcon, SmileyIcon, StickerIcon } from "./Icons";
import { MentionPicker } from "./MentionPicker";

/** Matches the server's own limit, so the count means the same on both sides. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Below this many characters left, the counter is worth showing. */
const COUNTER_THRESHOLD = 200;

/**
 * Inserts text at the caret, replacing whatever is selected.
 *
 * Appending would be simpler and wrong: someone who moves the caret back to
 * fix a word and then picks an emoji means it to land there, not at the end.
 */
export function insertAtCaret(
  value: string,
  start: number,
  end: number,
  insertion: string,
): { value: string; caret: number } {
  const rest = value.slice(end);

  // A space after the emoji is what people type next anyway, and without one a
  // following word renders glued to it — but the text may already supply one,
  // and inserting mid-sentence should not leave a double space behind.
  const needsSpace = !/^\s/.test(rest);
  const inserted = needsSpace ? `${insertion} ` : insertion;

  return {
    value: value.slice(0, start) + inserted + rest,
    // The caret lands past the space either way, so typing continues as a new
    // word rather than glued to the emoji.
    caret: start + inserted.length + (needsSpace ? 0 : 1),
  };
}

interface MessageComposerProps {
  /**
   * What this box is writing into. It is only ever compared: changing it is
   * what abandons the draft and cancels the uploads, because a draft belongs
   * to the conversation it was written for.
   */
  draftKey: number | string;
  /** The name a drop overlay says files are going to. */
  channelName: string;
  /** What the empty box says. Defaults to the channel wording. */
  placeholder?: string;
  /** Why posting is unavailable, or null when it is allowed. */
  disabledReason: string | null;
  /** Whether this user may attach files in this channel. */
  canAttach: boolean;
  /** What the server accepts, so a file too large is refused before it is sent. */
  limits: UploadLimits | null;
  /** Who can be named here, for the picker an `@` opens. */
  mentions?: MentionDirectory;
  onSend(content: string, attachments: number[]): Promise<void>;
  onUpload(file: File, onProgress: (fraction: number) => void): {
    done: Promise<Attachment>;
    cancel(): void;
  };
}

let localIdSeq = 0;

export interface MessageComposerHandle {
  addFiles(files: FileList | File[]): void;
}

export const MessageComposer = forwardRef<MessageComposerHandle, MessageComposerProps>(
  function MessageComposer(
    {
      draftKey,
      channelName,
      placeholder,
      disabledReason,
      canAttach,
      limits,
      mentions = EMPTY_MENTIONS,
      onSend,
      onUpload,
    },
    ref,
  ) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerTab, setPickerTab] = useState<PickerTab | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  /** Depth rather than a flag: dragging over a child fires leave on the parent. */
  const [dragDepth, setDragDepth] = useState(0);
  /** The `@…` the caret is inside, which is what the picker is offering for. */
  const [mention, setMention] = useState<MentionQuery | null>(null);
  /** Which suggestion Enter would take. */
  const [mentionIndex, setMentionIndex] = useState(0);

  const input = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  /** Where the caret was before focus moved into the picker. */
  const caret = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  /** Cancels every upload still running, for when the channel changes. */
  const running = useRef(new Map<string, () => void>());

  const uploadsEnabled = canAttach && (limits?.enabled ?? false);
  const maxFileBytes = parseBytes(limits?.maxFileBytes);
  const maxPerMessage = limits?.maxPerMessage ?? 0;

  // Who the `@` being typed could mean. An empty list is what closes the
  // picker: there is no separate open flag to fall out of step with the draft,
  // so a query that names nobody stops offering rather than offering nothing.
  const suggestions = useMemo(
    () => (mention === null ? [] : rankMentions(mention.query, mentions)),
    [mention, mentions],
  );
  const active = Math.min(mentionIndex, Math.max(0, suggestions.length - 1));

  // The box grows with the message instead of scrolling a single line.
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
  }, [draft]);

  // Moving to another conversation abandons the draft rather than carrying it
  // into one it was not written for. Files go with it: an upload is bound to
  // the channel it was made for, so it could not be posted here anyway.
  useEffect(() => {
    setDraft("");
    setError(null);
    setPickerTab(null);
    setPending([]);
    setDragDepth(0);
    setMention(null);
    for (const cancel of running.current.values()) cancel();
    running.current.clear();
  }, [draftKey]);

  // An upload still in flight when the client closes has nothing to attach to.
  useEffect(() => {
    const inFlight = running.current;
    return () => {
      for (const cancel of inFlight.values()) cancel();
      inFlight.clear();
    };
  }, []);

  /** Remembers the caret, which is lost the moment the picker takes focus. */
  function rememberCaret() {
    const node = input.current;
    if (!node) return;
    caret.current = { start: node.selectionStart, end: node.selectionEnd };
  }

  function insertEmoji(emoji: string) {
    const { start, end } = caret.current;
    const at = Math.min(start, draft.length);
    const to = Math.min(end, draft.length);
    const next = insertAtCaret(draft, at, to, emoji);

    setDraft(next.value);
    caret.current = { start: next.caret, end: next.caret };

    // The caret has to be placed after React has written the new value, or the
    // browser puts it back at the end of the box.
    requestAnimationFrame(() => {
      const node = input.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
    });
  }

  /** Reads what is being named from wherever the caret has just landed. */
  function refreshMention(value: string, at: number) {
    setMention(findMentionQuery(value, at));
    setMentionIndex(0);
  }

  /**
   * Writes the chosen name over the `@…` it was picked for.
   *
   * The name goes in as text, because that is what a mention is here: the
   * server stores words, and the reader's client resolves them again. A
   * nickname holding a space survives it, since the longest name wins when the
   * message is read back.
   */
  function chooseMention(target: MentionTarget) {
    if (!mention) return;
    const next = insertAtCaret(draft, mention.start, mention.end, `@${target.name}`);

    setDraft(next.value);
    setMention(null);
    caret.current = { start: next.caret, end: next.caret };

    requestAnimationFrame(() => {
      const node = input.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
    });
  }

  const patchPending = useCallback((localId: string, patch: Partial<PendingFile>) => {
    setPending((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    );
  }, []);

  /**
   * Starts uploading the files somebody picked, dropped or pasted.
   *
   * Each one goes up on its own as soon as it is added, rather than when the
   * message is sent: by the time a sentence has been typed the picture is
   * usually already there, and pressing Enter is instant.
   */
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const chosen = [...files];
      if (chosen.length === 0) return;
      if (!uploadsEnabled) {
        setError(t("attachments.notAllowed"));
        return;
      }

      const room = maxPerMessage > 0 ? maxPerMessage - pending.length : chosen.length;
      if (room <= 0) {
        setError(t("attachments.tooMany", { count: maxPerMessage }));
        return;
      }
      setError(chosen.length > room ? t("attachments.tooMany", { count: maxPerMessage }) : null);

      const accepted: PendingFile[] = [];
      for (const file of chosen.slice(0, room)) {
        localIdSeq += 1;
        const localId = `f${localIdSeq}`;

        // Refusing an oversized file here, rather than letting the server
        // refuse it, is the difference between an instant answer and a long
        // upload that ends in one.
        if (maxFileBytes > 0 && file.size > maxFileBytes) {
          accepted.push({
            localId,
            file,
            previewUrl: null,
            progress: 0,
            attachment: null,
            error: t("attachments.tooLarge", { limit: formatBytes(maxFileBytes) }),
          });
          continue;
        }

        accepted.push({
          localId,
          file,
          // An image gets a thumbnail from the local file, so the tray shows
          // what was picked before the upload has finished.
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
          progress: 0,
          attachment: null,
          error: null,
        });

        const upload = onUpload(file, (fraction) => patchPending(localId, { progress: fraction }));
        running.current.set(localId, upload.cancel);
        void upload.done
          .then((attachment) => patchPending(localId, { attachment, progress: 1 }))
          .catch((failure) => {
            if (failure instanceof UploadCancelled) return;
            patchPending(localId, { error: describeError(failure) });
          })
          .finally(() => running.current.delete(localId));
      }

      setPending((current) => [...current, ...accepted]);
    },
    [uploadsEnabled, pending.length, maxPerMessage, maxFileBytes, onUpload, patchPending, t],
  );

  useImperativeHandle(
    ref,
    () => ({
      addFiles,
    }),
    [addFiles],
  );

  function removePending(localId: string) {
    running.current.get(localId)?.();
    running.current.delete(localId);
    setPending((current) => {
      const item = current.find((held) => held.localId === localId);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      // A file already accepted by the server is simply abandoned: nothing has
      // claimed it, so the server sweeps it with the rest of the unposted ones.
      return current.filter((held) => held.localId !== localId);
    });
  }

  function clearPending() {
    for (const item of pending) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    setPending([]);
  }

  const uploading = pending.some((item) => item.attachment === null && item.error === null);
  const ready = pending.filter((item) => item.attachment !== null);
  const hasFiles = ready.length > 0;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (sending || uploading) return;
    // A message needs something in it: words, files, or both.
    if (!content && !hasFiles) return;

    setSending(true);
    setError(null);
    try {
      await onSend(content, ready.map((item) => item.attachment!.id));
      setDraft("");
      setMention(null);
      clearPending();
    } catch (failure) {
      // The draft and its files are deliberately left in place: a rejected
      // message is one the writer still has, and making them redo it would be
      // the wrong outcome.
      setError(failure instanceof Error ? failure.message : t("errors.unknown"));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // While a name is being picked these keys belong to the list, and Enter
    // above all: somebody halfway through choosing who to talk to has not
    // finished writing the message yet.
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        // Wrapping rather than stopping, and by adding rather than
        // subtracting, so up from the first lands on the last.
        const step = event.key === "ArrowDown" ? 1 : suggestions.length - 1;
        setMentionIndex((current) => (Math.min(current, suggestions.length - 1) + step) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        chooseMention(suggestions[active]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Stopped here so Escape means "not that name" rather than closing
        // whatever else on screen would have taken it.
        event.stopPropagation();
        setMention(null);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length === 0) return;
    // A screenshot on the clipboard is a file, and pasting it should attach it
    // rather than doing nothing.
    event.preventDefault();
    addFiles(files);
  }

  /** Whether a drag carries files, as opposed to selected text. */
  function carriesFiles(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes("Files");
  }

  function onDrop(event: DragEvent) {
    setDragDepth(0);
    if (!carriesFiles(event)) return;
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  }

  if (disabledReason !== null) {
    return (
      <div className="composer composer--disabled">
        <p className="composer__notice">{disabledReason}</p>
      </div>
    );
  }

  const remaining = MAX_MESSAGE_LENGTH - draft.length;
  const dragging = dragDepth > 0;

  return (
    <form
      className={dragging ? "composer composer--dropping" : "composer"}
      onSubmit={submit}
      onDragEnter={(event) => {
        if (!carriesFiles(event) || !uploadsEnabled) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event) || !uploadsEnabled) return;
        // Without this the browser takes the drop itself and navigates away
        // from the client to display the file.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
      onDrop={onDrop}
    >
      {suggestions.length > 0 ? (
        <MentionPicker
          targets={suggestions}
          active={active}
          onHover={setMentionIndex}
          onPick={chooseMention}
        />
      ) : null}

      {error ? <p className="composer__error">{error}</p> : null}

      {pending.length > 0 ? (
        <AttachmentTray items={pending} onRemove={removePending} />
      ) : null}

      <div className="composer__box">
        {uploadsEnabled ? (
          <>
            <input
              ref={filePicker}
              type="file"
              multiple
              className="composer__file-input"
              tabIndex={-1}
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                // Reset, or picking the same file twice in a row does nothing.
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="composer__button composer__attach"
              title={t("attachments.attach")}
              aria-label={t("attachments.attach")}
              disabled={sending}
              onClick={() => filePicker.current?.click()}
            >
              <PlusIcon size={19} />
            </button>
          </>
        ) : null}

        <textarea
          ref={input}
          className="composer__input"
          value={draft}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={placeholder ?? t("chat.messagePlaceholder", { channel: channelName })}
          aria-label={placeholder ?? t("chat.messagePlaceholder", { channel: channelName })}
          disabled={sending}
          onChange={(event) => {
            setDraft(event.target.value);
            refreshMention(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onSelect={(event) => {
            rememberCaret();
            // Moving the caret into or out of a name changes who is being
            // offered, and arrow keys move it without changing the text.
            refreshMention(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onBlur={() => {
            rememberCaret();
            setMention(null);
          }}
        />

        {remaining <= COUNTER_THRESHOLD ? (
          <span className={remaining < 0 ? "composer__count composer__count--over" : "composer__count"}>
            {remaining}
          </span>
        ) : null}

        <span className="composer__picker-wrap">
          {pickerTab !== null ? (
            <EmojiPicker
              initialTab={pickerTab}
              onPick={insertEmoji}
              onSendMedia={async (url) => {
                setPickerTab(null);
                await onSend(url, []);
              }}
              onClose={() => setPickerTab(null)}
            />
          ) : null}
          <button
            type="button"
            className={pickerTab === "gifs" ? "composer__button composer__button--on" : "composer__button"}
            title={t("composer.gif")}
            aria-label={t("composer.gif")}
            disabled={sending}
            onClick={() => setPickerTab((current) => (current === "gifs" ? null : "gifs"))}
          >
            <GifIcon size={19} />
          </button>
          <button
            type="button"
            className={pickerTab === "stickers" ? "composer__button composer__button--on" : "composer__button"}
            title={t("composer.sticker")}
            aria-label={t("composer.sticker")}
            disabled={sending}
            onClick={() => setPickerTab((current) => (current === "stickers" ? null : "stickers"))}
          >
            <StickerIcon size={19} />
          </button>
          <button
            type="button"
            className={pickerTab === "emojis" ? "composer__button composer__button--on" : "composer__button"}
            title={t("composer.emoji")}
            aria-label={t("composer.emoji")}
            disabled={sending}
            aria-expanded={pickerTab !== null}
            onClick={() => {
              rememberCaret();
              setPickerTab((current) => (current === "emojis" ? null : "emojis"));
            }}
          >
            <SmileyIcon size={19} />
          </button>
        </span>
      </div>

      {dragging ? (
        <div className="composer__drop" aria-hidden="true">
          {t("attachments.dropHere", { channel: channelName })}
        </div>
      ) : null}
    </form>
  );
});
