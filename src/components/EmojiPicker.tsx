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
import { getTwemojiFallbackUrl, getTwemojiUrl } from "@/lib/twemoji";
import {
  getGifCategories,
  getMediaPreviewUrl,
  getMediaSendUrl,
  getTrendingStickers,
  searchGifs,
  searchStickers,
  type KlipyCategory,
  type KlipyMediaItem,
} from "@/lib/klipy";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { Perm, has } from "@/lib/permissions";
import { CloseIcon, SearchIcon, TrendingIcon, HeartIcon, GifIcon } from "./Icons";

export type PickerTab = "gifs" | "stickers" | "emojis";

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
  initialTab?: PickerTab;
  onPick(emoji: string): void;
  onSendMedia?(mediaUrl: string): void;
  onClose(): void;
  onOpenSettings?(): void;
}

export function EmojiPicker({
  initialTab = "emojis",
  onPick,
  onSendMedia,
  onClose,
  onOpenSettings,
}: EmojiPickerProps) {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const permissions = useMyPermissions();
  const canManageServer = has(permissions, Perm.ManageServer);

  const [tab, setTab] = useState<PickerTab>(initialTab);
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<SkinToneKey>(() => storedTone());
  const [recent, setRecent] = useState<string[]>(() => recentEmoji());
  const [toneOpen, setToneOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>(() =>
    recentEmoji().length > 0 ? RECENT : "Smileys",
  );
  const [hoveredInfo, setHoveredInfo] = useState<{
    emoji?: string;
    name?: string;
    subtext?: string;
    imgUrl?: string;
  } | null>(null);

  // KLIPY State. The credential lives on the server, which proxies the
  // lookups; all a client needs to know is whether it will answer.
  const klipyEnabled = server?.klipyEnabled ?? false;
  const [categories, setCategories] = useState<KlipyCategory[]>([]);
  const [gifs, setGifs] = useState<KlipyMediaItem[]>([]);
  const [stickers, setStickers] = useState<KlipyMediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

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

  useLayoutEffect(() => {
    search.current?.focus();
  }, [tab]);

  // Escape closes, outside click dismisses
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

  // Load GIF categories when GIF tab is active
  useEffect(() => {
    if (tab === "gifs" && klipyEnabled && categories.length === 0) {
      getGifCategories()
        .then((cats) => setCategories(cats))
        .catch(() => setCategories([]));
    }
  }, [tab, klipyEnabled, categories.length]);

  // Fetch GIFs (trending or search) with debounce
  useEffect(() => {
    if (tab !== "gifs" || !klipyEnabled) return;
    const trimmed = query.trim();
    if (!trimmed) {
      // Clearing the box cancels the search it was typing, and with it the
      // spinner that search had put up.
      setGifs([]);
      setLoadingMedia(false);
      return;
    }

    setLoadingMedia(true);
    let current = true;
    const timer = setTimeout(() => {
      searchGifs(trimmed)
        .then((items) => current && setGifs(items))
        .catch(() => current && setGifs([]))
        .finally(() => current && setLoadingMedia(false));
    }, 280);

    return () => {
      // A reply that arrives after the query moved on describes the old one.
      current = false;
      clearTimeout(timer);
    };
  }, [tab, query, klipyEnabled]);

  // Fetch Stickers with debounce
  useEffect(() => {
    if (tab !== "stickers" || !klipyEnabled) return;
    setLoadingMedia(true);
    const trimmed = query.trim();

    let current = true;
    const timer = setTimeout(() => {
      const wanted = trimmed ? searchStickers(trimmed) : getTrendingStickers();
      wanted
        .then((items) => current && setStickers(items))
        .catch(() => current && setStickers([]))
        .finally(() => current && setLoadingMedia(false));
    }, 280);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [tab, query, klipyEnabled]);

  const results = useMemo(() => (tab === "emojis" ? searchEmoji(query) : []), [query, tab]);
  const searching = query.trim() !== "";

  const recentEntries = useMemo(
    () =>
      recent
        .map((emoji) => findEntry(emoji))
        .filter((entry): entry is EmojiEntry => entry !== undefined),
    [recent],
  );

  const sections = useMemo(() => {
    if (tab !== "emojis") return [];
    if (searching) {
      return [{ id: "search", name: `${results.length}`, entries: results.map((m) => m.entry) }];
    }
    const groups = EMOJI_GROUPS.map((group) => ({
      id: group.name,
      name: getGroupName(group.name),
      entries: [...group.emoji],
    }));
    return recentEntries.length > 0
      ? [{ id: RECENT, name: getGroupName(RECENT), entries: recentEntries }, ...groups]
      : groups;
  }, [tab, searching, results, recentEntries, t]);

  const strip = useMemo(
    () =>
      recentEntries.length > 0
        ? [RECENT, ...EMOJI_GROUPS.map((g) => g.name)]
        : EMOJI_GROUPS.map((g) => g.name),
    [recentEntries.length],
  );

  function chooseEmoji(entry: EmojiEntry) {
    setRecent(rememberEmoji(entry[0]));
    onPick(display(entry, modifier));
  }

  function handleSendMediaItem(item: KlipyMediaItem) {
    const url = getMediaSendUrl(item);
    if (!url) return;
    if (onSendMedia) {
      onSendMedia(url);
    } else {
      onPick(url);
    }
    onClose();
  }

  function jumpTo(id: string) {
    setActiveCategory(id);
    const target = scroller.current?.querySelector<HTMLElement>(`[data-section="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ block: "start" });
  }

  const getSearchPlaceholder = () => {
    switch (tab) {
      case "gifs":
        return t("emoji.gifs.searchPlaceholder");
      case "stickers":
        return t("emoji.stickers.searchPlaceholder");
      case "emojis":
        return t("emoji.searchPlaceholder");
    }
  };

  return (
    <div className="picker picker--unified" ref={panel} role="dialog" aria-label={t("composer.emoji")}>
      {/* Top Segmented Tabs Header */}
      <div className="picker__nav">
        <div className="picker__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "gifs"}
            className={tab === "gifs" ? "picker__tab-pill picker__tab-pill--active" : "picker__tab-pill"}
            onClick={() => {
              setTab("gifs");
              setQuery("");
              setHoveredInfo(null);
            }}
          >
            {t("emoji.tabs.gifs")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "stickers"}
            className={
              tab === "stickers" ? "picker__tab-pill picker__tab-pill--active" : "picker__tab-pill"
            }
            onClick={() => {
              setTab("stickers");
              setQuery("");
              setHoveredInfo(null);
            }}
          >
            {t("emoji.tabs.stickers")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "emojis"}
            className={
              tab === "emojis" ? "picker__tab-pill picker__tab-pill--active" : "picker__tab-pill"
            }
            onClick={() => {
              setTab("emojis");
              setQuery("");
              setHoveredInfo(null);
            }}
          >
            {t("emoji.tabs.emojis")}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <header className="picker__head">
        <span className="picker__search">
          <SearchIcon size={15} />
          <input
            ref={search}
            className="picker__input"
            value={query}
            placeholder={getSearchPlaceholder()}
            aria-label={getSearchPlaceholder()}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (tab === "emojis" && event.key === "Enter" && results[0]) {
                event.preventDefault();
                chooseEmoji(results[0].entry);
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

        {/* Skin Tone Selector (only on Emojis tab) */}
        {tab === "emojis" && (
          <span className="picker__tone">
            <button
              type="button"
              className="picker__tone-button"
              onClick={() => setToneOpen((open) => !open)}
              title={t("emoji.skinTone")}
              aria-label={t("emoji.skinTone")}
              aria-expanded={toneOpen}
            >
              <img
                src={getTwemojiUrl(SKIN_TONES.find((option) => option.key === tone)?.swatch || "👋")}
                alt=""
                className="picker__twemoji"
                width={18}
                height={18}
                draggable={false}
              />
            </button>
            {toneOpen ? (
              <div className="picker__tones" role="menu">
                {SKIN_TONES.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={
                      option.key === tone
                        ? "picker__tone-option picker__tone-option--active"
                        : "picker__tone-option"
                    }
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
                    <img
                      src={getTwemojiUrl(option.swatch)}
                      alt=""
                      className="picker__twemoji"
                      width={18}
                      height={18}
                      draggable={false}
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        )}
      </header>

      {/* Main Content Area */}
      <div className="picker__content-wrap">
        {/* GIF TAB */}
        {tab === "gifs" && (
          <div className="picker__body picker__body--gifs" ref={scroller}>
            {!klipyEnabled ? (
              <div className="picker__notice">
                <div className="picker__notice-icon">
                  <GifIcon size={32} />
                </div>
                <h4 className="picker__notice-title">{t("emoji.gifs.noKeyTitle")}</h4>
                <p className="picker__notice-desc">{t("emoji.gifs.noKeyDesc")}</p>
                {canManageServer && onOpenSettings && (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      onClose();
                      onOpenSettings();
                    }}
                  >
                    {t("emoji.gifs.openSettings")}
                  </button>
                )}
              </div>
            ) : query.trim() === "" ? (
              <div className="picker__categories-grid">
                {/* Favorites Card */}
                <button
                  type="button"
                  className="picker__category-card picker__category-card--fav"
                  onClick={() => setQuery("favorites")}
                >
                  <span className="picker__category-icon">
                    <HeartIcon size={18} />
                  </span>
                  <span className="picker__category-name">{t("emoji.gifs.favorites")}</span>
                </button>

                {/* Trending Card */}
                <button
                  type="button"
                  className="picker__category-card picker__category-card--trending"
                  onClick={() => setQuery("trending")}
                >
                  <span className="picker__category-icon">
                    <TrendingIcon size={18} />
                  </span>
                  <span className="picker__category-name">{t("emoji.gifs.popular")}</span>
                </button>

                {/* Category Cards from Klipy */}
                {categories.map((cat) => (
                  <button
                    key={cat.category}
                    type="button"
                    className="picker__category-card"
                    style={{ backgroundImage: `url(${cat.preview_url})` }}
                    onClick={() => setQuery(cat.query || cat.category)}
                  >
                    <span className="picker__category-overlay" />
                    <span className="picker__category-name">{cat.category}</span>
                  </button>
                ))}
              </div>
            ) : loadingMedia ? (
              <div className="picker--loading">{t("emoji.gifs.loading")}</div>
            ) : gifs.length === 0 ? (
              <p className="picker__empty">{t("emoji.gifs.noResults")}</p>
            ) : (
              <div className="picker__media-grid">
                {gifs.map((item) => {
                  const preview = getMediaPreviewUrl(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="picker__media-item"
                      onClick={() => handleSendMediaItem(item)}
                      title={item.title}
                    >
                      <img src={preview} alt={item.title} loading="lazy" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STICKERS TAB */}
        {tab === "stickers" && (
          <div className="picker__body picker__body--stickers" ref={scroller}>
            {!klipyEnabled ? (
              <div className="picker__notice">
                <div className="picker__notice-icon">
                  <GifIcon size={32} />
                </div>
                <h4 className="picker__notice-title">{t("emoji.stickers.noKeyTitle")}</h4>
                <p className="picker__notice-desc">{t("emoji.stickers.noKeyDesc")}</p>
                {canManageServer && onOpenSettings && (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      onClose();
                      onOpenSettings();
                    }}
                  >
                    {t("emoji.stickers.openSettings")}
                  </button>
                )}
              </div>
            ) : loadingMedia ? (
              <div className="picker--loading">{t("emoji.stickers.loading")}</div>
            ) : stickers.length === 0 ? (
              <p className="picker__empty">{t("emoji.stickers.noResults")}</p>
            ) : (
              <div className="picker__stickers-grid">
                {stickers.map((item) => {
                  const preview = getMediaPreviewUrl(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="picker__sticker-item"
                      onClick={() => handleSendMediaItem(item)}
                      onMouseEnter={() =>
                        setHoveredInfo({
                          name: item.title,
                          subtext: item.slug,
                          imgUrl: preview,
                        })
                      }
                      onMouseLeave={() => setHoveredInfo(null)}
                      title={item.title}
                    >
                      <img src={preview} alt={item.title} loading="lazy" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* EMOJIS TAB */}
        {tab === "emojis" && (
          <div className="picker__emoji-layout">
            {/* Left Sidebar Category Strip */}
            <nav className="picker__strip" aria-label={t("composer.emoji")}>
              {strip.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={
                    !searching && id === activeCategory
                      ? "picker__tab picker__tab--active"
                      : "picker__tab"
                  }
                  title={getGroupName(id)}
                  aria-label={getGroupName(id)}
                  onClick={() => jumpTo(id)}
                >
                  <img
                    src={getTwemojiUrl(GROUP_ICONS[id] || "😀")}
                    alt=""
                    className="picker__twemoji"
                    width={18}
                    height={18}
                    draggable={false}
                  />
                </button>
              ))}
            </nav>

            {/* Emoji Grid */}
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
                        const nameFormatted = `:${entry[1].toLowerCase().replace(/\s+/g, "_")}:`;
                        const twemojiUrl = getTwemojiUrl(character);
                        return (
                          <button
                            key={`${entry[0]}-${index}`}
                            type="button"
                            className="picker__emoji"
                            title={`${entry[1]}${tonable(entry) && modifier ? ", toned" : ""}`}
                            aria-label={entry[1]}
                            onClick={() => chooseEmoji(entry)}
                            onMouseEnter={() =>
                              setHoveredInfo({
                                emoji: character,
                                name: nameFormatted,
                                subtext: entry[1],
                                imgUrl: twemojiUrl,
                              })
                            }
                            onMouseLeave={() => setHoveredInfo(null)}
                          >
                            <img
                              src={twemojiUrl}
                              alt={character}
                              className="picker__twemoji"
                              width={22}
                              height={22}
                              loading="lazy"
                              draggable={false}
                              onError={(event) => {
                                const target = event.currentTarget;
                                // Twemoji spells a few joined emoji without
                                // their variation selectors, so that spelling
                                // is the second guess before giving up.
                                const fallback = getTwemojiFallbackUrl(character);
                                if (!target.dataset.retried && target.src !== fallback) {
                                  target.dataset.retried = "1";
                                  target.src = fallback;
                                  return;
                                }
                                // Neither name is there: show the system glyph
                                // rather than a broken image.
                                target.style.display = "none";
                                if (target.parentElement) {
                                  target.parentElement.textContent = character;
                                }
                              }}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Preview Bar */}
      <footer className="picker__footer">
        {hoveredInfo ? (
          <div className="picker__preview">
            {hoveredInfo.imgUrl && (
              <img
                src={hoveredInfo.imgUrl}
                alt=""
                className="picker__preview-img"
                width={28}
                height={28}
              />
            )}
            <div className="picker__preview-meta">
              <span className="picker__preview-name">{hoveredInfo.name}</span>
              {hoveredInfo.subtext && (
                <span className="picker__preview-sub">{hoveredInfo.subtext}</span>
              )}
            </div>
          </div>
        ) : (
          <div className="picker__preview picker__preview--placeholder">
            <span className="picker__preview-placeholder-text">
              {tab === "emojis"
                ? ":heart: :red_heart:"
                : tab === "gifs"
                  ? "Powered by KLIPY"
                  : "KLIPY Stickers"}
            </span>
          </div>
        )}
      </footer>
    </div>
  );
}
