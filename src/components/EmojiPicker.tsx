import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n";
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
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<SkinToneKey>(() => storedTone());
  const [recent, setRecent] = useState<string[]>(() => recentEmoji());
  const [toneOpen, setToneOpen] = useState(false);
  const [active, setActive] = useState<string>(() => (recentEmoji().length > 0 ? RECENT : "Smileys"));

  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const modifier = modifierFor(tone);

  const getGroupName = (raw: string) => {
    switch (raw) {
      case "Recent":
        return t("emoji.recent");
      case "Smileys":
        return t("emoji.smileys");
      case "People":
        return t("emoji.people");
      case "Nature":
        return t("emoji.animals");
      case "Food":
        return t("emoji.food");
      case "Travel":
        return t("emoji.travel");
      case "Activities":
        return t("emoji.activities");
      case "Objects":
        return t("emoji.objects");
      case "Symbols":
        return t("emoji.symbols");
      case "Flags":
        return t("emoji.flags");
      default:
        return raw;
    }
  };

  const getToneLabel = (key: SkinToneKey) => {
    switch (key) {
      case "default":
        return t("emoji.skinToneDefault");
      case "light":
        return t("emoji.skinToneLight");
      case "medium-light":
        return t("emoji.skinToneMediumLight");
      case "medium":
        return t("emoji.skinToneMedium");
      case "medium-dark":
        return t("emoji.skinToneMediumDark");
      case "dark":
        return t("emoji.skinToneDark");
    }
  };

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
      return [{ id: "search", name: `${results.length}`, entries: results.map((m) => m.entry) }];
    }
    const groups = EMOJI_GROUPS.map((group) => ({ id: group.name, name: getGroupName(group.name), entries: [...group.emoji] }));
    return recentEntries.length > 0
      ? [{ id: RECENT, name: getGroupName(RECENT), entries: recentEntries }, ...groups]
      : groups;
  }, [searching, results, recentEntries, t]);

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

  function jumpTo(id: string) {
    setActive(id);
    const target = scroller.current?.querySelector<HTMLElement>(`[data-section="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ block: "start" });
  }

  return (
    <div className="picker" ref={panel} role="dialog" aria-label={t("composer.emoji")}>
      <header className="picker__head">
        <span className="picker__search">
          <SearchIcon size={14} />
          <input
            ref={search}
            className="picker__input"
            value={query}
            placeholder={t("emoji.searchPlaceholder")}
            aria-label={t("emoji.searchPlaceholder")}
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
              type="button"
              className="picker__clear"
              onClick={() => {
                setQuery("");
                search.current?.focus();
              }}
              aria-label={t("common.close")}
            >
              <CloseIcon size={13} />
            </button>
          ) : null}
        </span>

        <span className="picker__tone">
          <button
            type="button"
            className="picker__tone-button"
            onClick={() => setToneOpen((open) => !open)}
            title={t("emoji.skinTone")}
            aria-label={t("emoji.skinTone")}
            aria-expanded={toneOpen}
          >
            {SKIN_TONES.find((option) => option.key === tone)?.swatch}
          </button>
          {toneOpen ? (
            <div className="picker__tones" role="menu">
              {SKIN_TONES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={option.key === tone ? "picker__tone-option picker__tone-option--active" : "picker__tone-option"}
                  title={getToneLabel(option.key)}
                  aria-label={getToneLabel(option.key)}
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

      <nav className="picker__strip" aria-label={t("composer.emoji")}>
        {strip.map((id) => (
          <button
            key={id}
            type="button"
            className={!searching && id === active ? "picker__tab picker__tab--active" : "picker__tab"}
            title={getGroupName(id)}
            aria-label={getGroupName(id)}
            onClick={() => jumpTo(id)}
          >
            {GROUP_ICONS[id]}
          </button>
        ))}
      </nav>

      <div className="picker__body" ref={scroller}>
        {sections.map((section) => (
          <section key={section.id} data-section={section.id}>
            <h3 className="picker__label">{section.name}</h3>
            {section.entries.length === 0 ? (
              <p className="picker__empty">{t("emoji.noResults")}</p>
            ) : (
              <div className="picker__grid">
                {section.entries.map((entry, index) => {
                  const character = display(entry, modifier);
                  return (
                    <button
                      // A recent emoji can also appear in its own group, so the
                      // index is part of what makes the key unique.
                      key={`${entry[0]}-${index}`}
                      type="button"
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

