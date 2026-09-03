import { useCallback, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { useSession } from "@/store/session";
import {
  buildMentions,
  findMentionQuery,
  rankMentions,
  type MentionQuery,
  type MentionTarget,
} from "@/lib/mentions";

export function insertAtCaret(
  value: string,
  start: number,
  end: number,
  insertion: string,
): { value: string; caret: number } {
  const rest = value.slice(end);
  const needsSpace = !/^\s/.test(rest);
  const inserted = needsSpace ? `${insertion} ` : insertion;

  return {
    value: value.slice(0, start) + inserted + rest,
    caret: start + inserted.length + (needsSpace ? 0 : 1),
  };
}

export function useMentionAutocomplete(
  text: string,
  setText: (val: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
) {
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);

  const mentions = useMemo(() => buildMentions(users, roles), [users, roles]);

  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!mentionQuery) return [];
    return rankMentions(mentionQuery.query, mentions);
  }, [mentionQuery, mentions]);

  const refreshMention = useCallback((val: string, caretPos: number) => {
    const q = findMentionQuery(val, caretPos);
    setMentionQuery(q);
    setActiveMentionIndex(0);
  }, []);

  const chooseMention = useCallback(
    (target: MentionTarget) => {
      if (!mentionQuery) return;
      const next = insertAtCaret(text, mentionQuery.start, mentionQuery.end, `@${target.name}`);
      setText(next.value);
      setMentionQuery(null);

      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(next.caret, next.caret);
      });
    },
    [mentionQuery, text, setText, textareaRef],
  );

  const handleMentionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (suggestions.length === 0) return false;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveMentionIndex((idx) => (idx + 1) % suggestions.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveMentionIndex((idx) => (idx <= 0 ? suggestions.length - 1 : idx - 1));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const target = suggestions[activeMentionIndex];
        if (target) {
          event.preventDefault();
          chooseMention(target);
          return true;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionQuery(null);
        return true;
      }
      return false;
    },
    [suggestions, activeMentionIndex, chooseMention],
  );

  return {
    mentions,
    suggestions,
    activeMentionIndex,
    setActiveMentionIndex,
    refreshMention,
    chooseMention,
    handleMentionKeyDown,
    closeMentions: () => setMentionQuery(null),
  };
}
