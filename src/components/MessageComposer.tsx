import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { useTranslation } from "@/lib/i18n";
import { EmojiPicker } from "./EmojiPicker";
import { SmileyIcon } from "./Icons";

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
  channelName: string;
  /** Why posting is unavailable, or null when it is allowed. */
  disabledReason: string | null;
  onSend(content: string): Promise<void>;
}

export function MessageComposer({ channelName, disabledReason, onSend }: MessageComposerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  /** Where the caret was before focus moved into the picker. */
  const caret = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // The box grows with the message instead of scrolling a single line.
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
  }, [draft]);

  // Moving to another channel abandons the draft rather than carrying it into
  // a conversation it was not written for.
  useEffect(() => {
    setDraft("");
    setError(null);
    setPickerOpen(false);
  }, [channelName]);

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

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    setError(null);
    try {
      await onSend(content);
      setDraft("");
    } catch (failure) {
      // The draft is deliberately left in the box: a rejected message is one
      // the writer still has, and retyping it would be the wrong outcome.
      setError(failure instanceof Error ? failure.message : t("errors.unknown"));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  if (disabledReason !== null) {
    return (
      <div className="composer composer--disabled">
        <p className="composer__notice">{disabledReason}</p>
      </div>
    );
  }

  const remaining = MAX_MESSAGE_LENGTH - draft.length;

  return (
    <form className="composer" onSubmit={submit}>
      {error ? <p className="composer__error">{error}</p> : null}
      <div className="composer__box">
        <textarea
          ref={input}
          className="composer__input"
          value={draft}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={t("chat.messagePlaceholder", { channel: channelName })}
          aria-label={t("chat.messagePlaceholder", { channel: channelName })}
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onSelect={rememberCaret}
          onBlur={rememberCaret}
        />

        {remaining <= COUNTER_THRESHOLD ? (
          <span className={remaining < 0 ? "composer__count composer__count--over" : "composer__count"}>
            {remaining}
          </span>
        ) : null}

        <span className="composer__emoji">
          {pickerOpen ? (
            <EmojiPicker onPick={insertEmoji} onClose={() => setPickerOpen(false)} />
          ) : null}
          <button
            type="button"
            className={pickerOpen ? "composer__button composer__button--on" : "composer__button"}
            title={t("composer.emoji")}
            aria-label={t("composer.emoji")}
            aria-expanded={pickerOpen}
            onClick={() => {
              rememberCaret();
              setPickerOpen((open) => !open);
            }}
          >
            <SmileyIcon size={19} />
          </button>
        </span>
      </div>
    </form>
  );
}

