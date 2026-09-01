/**
 * The search box and the suggestions under it.
 *
 * A query is one line of text, so the box is one plain input: what is typed can
 * be selected, corrected and pasted like any other sentence. The dropdown holds
 * no state of its own — it reads the caret, works out what is being written,
 * and offers the next thing to write.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { t, useTranslation } from "@/lib/i18n";
import type { Role, User } from "@/lib/protocol";
import {
  FILTER_KEYS,
  HAS_VALUES,
  activeTokenAt,
  buildDirectory,
  matchNamed,
  replaceTokenAt,
  todayAsFilterValue,
  writeFilter,
  type ActiveToken,
  type FilterKey,
  type SearchDirectory,
} from "@/lib/search";
import { useSession } from "@/store/session";
import { colorRoleOf } from "@/store/selectors";
import { Avatar } from "./Avatar";
import {
  CalendarIcon,
  CloseIcon,
  FileIcon,
  FilmIcon,
  HashIcon,
  ImageIcon,
  LinkIcon,
  MusicIcon,
  PaperclipIcon,
  SearchIcon,
  UserIcon,
} from "./Icons";

/** One row of the dropdown: what it shows, and what accepting it writes. */
interface Suggestion {
  id: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  /** The text this replaces the token under the caret with. */
  insert: string;
  /** A member's role colour, so the list reads as the member list does. */
  color?: string;
}

const HAS_ICONS = {
  link: <LinkIcon size={16} />,
  file: <FileIcon size={16} />,
  image: <ImageIcon size={16} />,
  video: <FilmIcon size={16} />,
  sound: <MusicIcon size={16} />,
} as const;

const KEY_ICONS: Record<FilterKey, React.ReactNode> = {
  from: <UserIcon size={16} />,
  in: <HashIcon size={16} />,
  has: <PaperclipIcon size={16} />,
  before: <CalendarIcon size={16} />,
  during: <CalendarIcon size={16} />,
  after: <CalendarIcon size={16} />,
};

/** How many members or channels one dropdown offers before it stops. */
const MAX_SUGGESTIONS = 10;

export function SearchBar() {
  const { language } = useTranslation();
  const box = useRef<HTMLInputElement>(null);

  const server = useSession((state) => state.server);
  const channels = useSession((state) => state.channels);
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const history = useSession((state) => state.history);
  const search = useSession((state) => state.search);
  const setSearchInput = useSession((state) => state.setSearchInput);
  const runSearch = useSession((state) => state.runSearch);
  const closeSearch = useSession((state) => state.closeSearch);

  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(-1);
  /** Written by the accept path, applied once React has rendered the new text. */
  const pendingCaret = useRef<number | null>(null);

  const directory = useMemo(
    () => buildDirectory(channels, users, history),
    [channels, users, history],
  );

  const active = useMemo<ActiveToken>(
    () => activeTokenAt(search.input, caret),
    [search.input, caret],
  );

  const suggestions = useMemo(
    // language is not read here: it is what tells the memo that every label it
    // built has just been translated into something else.
    () => suggestionsFor(active, directory, users, roles),
    [active, directory, users, roles, language],
  );

  // A new set of suggestions starts unhighlighted so typing and pressing Enter
  // runs the search unless an arrow key was deliberately pressed to choose a row.
  useEffect(() => setHighlighted(-1), [suggestions.items]);

  // Asked for from elsewhere: the shortcut that opens search, or a click on
  // the button that does. The text is selected so typing replaces the old query.
  useEffect(() => {
    if (search.focus === 0) return;
    box.current?.focus();
    box.current?.select();
  }, [search.focus]);

  // The caret is moved once the new text is on screen, which is the only point
  // at which the position being asked for exists.
  useEffect(() => {
    if (pendingCaret.current === null) return;
    const at = pendingCaret.current;
    pendingCaret.current = null;
    box.current?.setSelectionRange(at, at);
    setCaret(at);
  }, [search.input]);

  const showSuggestions = focused && suggestions.items.length > 0;

  function accept(suggestion: Suggestion) {
    const next = replaceTokenAt(search.input, caret, suggestion.insert);
    setSearchInput(next.input);
    pendingCaret.current = next.caret;
    setHighlighted(-1);
    box.current?.focus();
  }

  function submit() {
    setFocused(false);
    setHighlighted(-1);
    box.current?.blur();
    void runSearch({ input: search.input });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (showSuggestions) {
        setFocused(false);
        setHighlighted(-1);
      } else {
        closeSearch();
        box.current?.blur();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (showSuggestions && highlighted >= 0 && suggestions.items[highlighted]) {
        accept(suggestions.items[highlighted]!);
      } else {
        submit();
      }
      return;
    }

    if (event.key === "Tab") {
      if (showSuggestions && suggestions.items.length > 0) {
        event.preventDefault();
        const chosen = highlighted >= 0 ? suggestions.items[highlighted] : suggestions.items[0];
        if (chosen) accept(chosen);
      }
      return;
    }

    if (!showSuggestions) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlighted((at) => (at + 1 >= suggestions.items.length ? 0 : at + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setHighlighted((at) => (at <= 0 ? suggestions.items.length - 1 : at - 1));
        return;
    }
  }

  function syncCaret(event: React.SyntheticEvent<HTMLInputElement>) {
    setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
  }

  return (
    <div className={search.open ? "search search--open" : "search"}>
      <div className="search__box">
        <span className="search__icon">
          <SearchIcon size={15} />
        </span>
        <input
          ref={box}
          className="search__input"
          type="text"
          value={search.input}
          placeholder={
            server ? t("search.placeholder", { server: server.name }) : t("search.placeholderShort")
          }
          aria-label={t("search.open")}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setSearchInput(event.target.value);
            syncCaret(event);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onFocus={(event) => {
            setFocused(true);
            syncCaret(event);
          }}
          // The dropdown refuses the mousedown that would blur this, so a blur
          // here always means the box was really left.
          onBlur={() => setFocused(false)}
        />
        {search.input !== "" || search.open ? (
          <button
            className="search__clear"
            title={t("search.clear")}
            aria-label={t("search.clear")}
            onClick={() => {
              closeSearch();
              box.current?.focus();
            }}
          >
            <CloseIcon size={14} />
          </button>
        ) : null}
      </div>

      {showSuggestions ? (
        // Refusing the mousedown keeps the caret where it is: without that the
        // box loses focus before the click lands, and the token being replaced
        // is no longer the one that was under the caret.
        <div className="search__menu" onMouseDown={(event) => event.preventDefault()}>
          <p className="search__menu-title">{suggestions.title}</p>
          <ul className="search__menu-list">
            {suggestions.items.map((suggestion, index) => (
              <li key={suggestion.id}>
                <button
                  className={
                    index === highlighted
                      ? "search__suggestion search__suggestion--active"
                      : "search__suggestion"
                  }
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => accept(suggestion)}
                >
                  <span className="search__suggestion-icon">{suggestion.icon}</span>
                  <span
                    className="search__suggestion-label"
                    style={suggestion.color ? { color: suggestion.color } : undefined}
                  >
                    {suggestion.label}
                  </span>
                  {suggestion.hint ? (
                    <span className="search__suggestion-hint">{suggestion.hint}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="search__menu-foot">{t("search.tip")}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What to offer for whatever is under the caret: the filters a bare word could
 * still become, or the values the filter already written accepts.
 */
function suggestionsFor(
  active: ActiveToken,
  directory: SearchDirectory,
  users: ReadonlyMap<number, User>,
  roles: ReadonlyMap<number, Role>,
): { title: string; items: Suggestion[] } {
  if (active.kind === "word") {
    const typed = active.value.toLowerCase();
    const keys = FILTER_KEYS.filter((key) => key.startsWith(typed));
    // A word that starts no filter is simply a word to look for.
    if (keys.length === 0) return { title: "", items: [] };
    return {
      title: t("search.filters"),
      items: keys.map((key) => ({
        id: `key-${key}`,
        icon: KEY_ICONS[key],
        label: t(`search.keys.${key}`),
        hint: t(`search.keys.${key}Hint`),
        insert: `${key}:`,
      })),
    };
  }

  switch (active.key) {
    case "from":
      return {
        title: t("search.keys.from"),
        items: matchNamed(directory.users, active.value)
          .slice(0, MAX_SUGGESTIONS)
          .map((entry) => {
            const user = users.get(entry.id);
            const color = user ? colorRoleOf(user, roles)?.color : undefined;
            return {
              id: `from-${entry.id}`,
              icon: user ? <Avatar user={user} size="sm" /> : <UserIcon size={16} />,
              label: entry.name,
              // A member who has gone offline is still worth offering, because
              // their messages are still there; the hint says which they are.
              hint: user ? entry.alias : t("search.guests"),
              insert: writeFilter("from", entry.name),
              ...(color ? { color } : {}),
            };
          }),
      };

    case "in":
      return {
        title: t("search.keys.in"),
        items: matchNamed(directory.channels, active.value)
          .slice(0, MAX_SUGGESTIONS)
          .map((entry) => ({
            id: `in-${entry.id}`,
            icon: <HashIcon size={16} />,
            label: entry.name,
            insert: writeFilter("in", entry.name),
          })),
      };

    case "has": {
      const typed = active.value.toLowerCase();
      return {
        title: t("search.keys.has"),
        items: HAS_VALUES.filter((value) => value.startsWith(typed)).map((value) => ({
          id: `has-${value}`,
          icon: HAS_ICONS[value],
          label: t(`search.has.${value}`),
          insert: `has:${value}`,
        })),
      };
    }

    case "before":
    case "during":
    case "after":
      return {
        title: t(`search.keys.${active.key}`),
        items: dateSuggestions(active.key),
      };
  }
}

/**
 * The dates worth offering: the ones somebody would otherwise open a calendar
 * to write. Anything else is typed in full, which the footer of the menu says.
 */
function dateSuggestions(key: "before" | "during" | "after"): Suggestion[] {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const options = [
    { id: "today", label: t("search.dates.today"), value: todayAsFilterValue(now) },
    { id: "yesterday", label: t("search.dates.yesterday"), value: todayAsFilterValue(yesterday) },
    { id: "month", label: t("search.dates.thisMonth"), value: month },
    { id: "year", label: t("search.dates.thisYear"), value: String(now.getFullYear()) },
  ];

  return options.map((option) => ({
    id: `${key}-${option.id}`,
    icon: <CalendarIcon size={16} />,
    label: option.label,
    hint: option.value,
    insert: `${key}:${option.value}`,
  }));
}
