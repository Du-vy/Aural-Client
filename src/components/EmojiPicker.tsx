import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  EMOJI_GROUPS,
  SKIN_TONES,
  display,
  findEntry,
  modifierFor,
  recentEmoji,
  rememberEmoji,
  searchEmoji,
  storeTone,
  storedTone,
  tonable,
  type EmojiEntry,
  type SkinToneKey,
} from "@/lib/emoji-catalogue";
import { CloseIcon, SearchIcon } from "./Icons";

/** One icon per group, shown on the category strip. */
const GROUP_ICONS: Readonly<Record<string, string>> = {
  Recent: "\u{1F551}",
  Smileys: "\u{1F642}",
  People: "\u{1F44B}",
  Nature: "\u{1F33F}",
  Food: "\u{1F354}",
  Travel: "\u{1F697}",
  Activities: "\u{26BD}",
  Objects: "\u{1F4A1}",
  Symbols: "\u{1F523}",
  Flags: "\u{1F6A9}",
};

const RECENT = "Recent";

interface EmojiPickerProps {
  onPick(emoji: string): void;
  onClose(): void;
}

export function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<SkinToneKey>(() => storedTone());
  const [recent, setRecent] = useState<string[]>(() => recentEmoji());
  const [toneOpen, setToneOpen] = useState(false);
  const [active, setActive] = useState<string>(() => (recentEmoji().length > 0 ? RECENT : "Smileys"));

  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const modifier = modifierFor(tone);

  // Opening the picker to type is the common case, so the search box takes the
  // caret immediately.
  useLayoutEffect(() => {
    search.current?.focus();
  }, []);

  // Escape closes, and a click anywhere outside dismisses, which is what a
  // popover is expected to do.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (toneOpen) setToneOpen(false);
      else onClose();
    }
    function onPointerDown(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose, toneOpen]);

  const results = useMemo(() => searchEmoji(query), [query]);
  const searching = query.trim() !== "";

  const recentEntries = useMemo(
    () =>
      recent
        .map((emoji) => findEntry(emoji))
        .filter((entry): entry is EmojiEntry => entry !== undefined),
    [recent],
  );

  const sections = useMemo(() => {
    if (searching) {
      return [{ name: `${results.length} result${results.length === 1 ? "" : "s"}`, entries: results.map((m) => m.entry) }];
    }
    const groups = EMOJI_GROUPS.map((group) => ({ name: group.name, entries: [...group.emoji] }));
    return recentEntries.length > 0
      ? [{ name: RECENT, entries: recentEntries }, ...groups]
      : groups;
  }, [searching, results, recentEntries]);

  const strip = useMemo(
    () => (recentEntries.length > 0 ? [RECENT, ...EMOJI_GROUPS.map((g) => g.name)] : EMOJI_GROUPS.map((g) => g.name)),
    [recentEntries.length],
  );

  function choose(entry: EmojiEntry) {
    // The untoned character is what is remembered, so changing tone later
    // re-renders the same recents in the new tone.
    setRecent(rememberEmoji(entry[0]));
    onPick(display(entry, modifier));
  }

  function jumpTo(name: string) {
    setActive(name);
    const target = scroller.current?.querySelector<HTMLElement>(`[data-section="${CSS.escape(name)}"]`);
    target?.scrollIntoView({ block: "start" });
  }

  return (
    <div className="picker" ref={panel} role="dialog" aria-label="Pick an emoji">
      <header className="picker__head">
        <span className="picker__search">
          <SearchIcon size={14} />
          <input
            ref={search}
            className="picker__input"
            value={query}
            placeholder="Search emoji"
            aria-label="Search emoji"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter picks the best match, so a search can be finished without
              // reaching for the mouse.
              if (event.key === "Enter" && results[0]) {
                event.preventDefault();
                choose(results[0].entry);
              }
            }}
          />
          {query ? (
            <button
              className="picker__clear"
              onClick={() => {
                setQuery("");
                search.current?.focus();
              }}
              aria-label="Clear search"
            >
              <CloseIcon size={13} />
            </button>
          ) : null}
        </span>

        <span className="picker__tone">
          <button
            className="picker__tone-button"
            onClick={() => setToneOpen((open) => !open)}
            title="Skin tone"
            aria-label="Skin tone"
            aria-expanded={toneOpen}
          >
            {SKIN_TONES.find((option) => option.key === tone)?.swatch}
          </button>
          {toneOpen ? (
            <div className="picker__tones" role="menu">
              {SKIN_TONES.map((option) => (
                <button
                  key={option.key}
                  className={option.key === tone ? "picker__tone-option picker__tone-option--active" : "picker__tone-option"}
                  title={option.label}
                  aria-label={option.label}
                  role="menuitemradio"
                  aria-checked={option.key === tone}
                  onClick={() => {
                    setTone(option.key);
                    storeTone(option.key);
                    setToneOpen(false);
                  }}
                >
                  {option.swatch}
                </button>
              ))}
            </div>
          ) : null}
        </span>
      </header>

      <nav className="picker__strip" aria-label="Emoji categories">
        {strip.map((name) => (
          <button
            key={name}
            className={!searching && name === active ? "picker__tab picker__tab--active" : "picker__tab"}
            title={name}
            aria-label={name}
            onClick={() => jumpTo(name)}
          >
            {GROUP_ICONS[name]}
          </button>
        ))}
      </nav>

      <div className="picker__body" ref={scroller}>
        {sections.map((section) => (
          <section key={section.name} data-section={section.name}>
            <h3 className="picker__label">{section.name}</h3>
            {section.entries.length === 0 ? (
              <p className="picker__empty">No emoji match that.</p>
            ) : (
              <div className="picker__grid">
                {section.entries.map((entry, index) => {
                  const character = display(entry, modifier);
                  return (
                    <button
                      // A recent emoji can also appear in its own group, so the
                      // index is part of what makes the key unique.
                      key={`${entry[0]}-${index}`}
                      className="picker__emoji"
                      title={`${entry[1]}${tonable(entry) && modifier ? ", toned" : ""}`}
                      aria-label={entry[1]}
                      onClick={() => choose(entry)}
                    >
                      {character}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
