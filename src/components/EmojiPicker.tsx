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
import {
  favoritesOf,
  isFavorited,
  readFavorites,
  toggleFavorite,
  type FavoriteKind,
  type FavoriteMedia,
} from "@/lib/favoriteMedia";
import { expressionUrl } from "@/lib/customEmoji";
import { AnimatedImage } from "./AnimatedImage";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { Perm, has } from "@/lib/permissions";
import {
  CloseIcon,
  SearchIcon,
  TrendingIcon,
  HeartIcon,
  GifIcon,
  StarIcon,
  ChevronLeftIcon,
} from "./Icons";

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

/**
 * One GIF category tile from Klipy.
 *
 * The preview is drawn as a real <img> instead of a CSS background so that an
 * animated one goes through AnimatedImage and freezes with the rest of the
 * client when the window is in the background — a background-image keeps
 * decoding frames whatever the window is doing. Hover is held by the tile
 * rather than the image, since the label sits on top and crossing it should
 * not stutter the animation.
 */
function CategoryCard({ category, onPick }: { category: KlipyCategory; onPick(): void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      className="picker__category-card"
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <AnimatedImage
        src={category.preview_url}
        alt=""
        className="picker__category-media"
        hovered={hovered}
        aria-hidden="true"
        loading="lazy"
      />
      <span className="picker__category-overlay" />
      <span className="picker__category-name">{category.category}</span>
    </button>
  );
}

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
  const address = useSession((state) => state.address);
  const expressions = useSession((state) => state.expressions);
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

  // Starred GIFs and stickers. Held as state rather than read per draw so the
  // star flips the moment it is clicked, without a trip through storage.
  const [favorites, setFavorites] = useState<FavoriteMedia[]>(() => readFavorites());
  // Whether the GIF tab is showing the favourites shelf instead of categories.
  const [showingFavorites, setShowingFavorites] = useState(false);

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

  // What this server carries for its own people, split by where it is drawn:
  // an emoji goes inline in a line of text, a sticker is the whole message.
  const serverEmoji = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...expressions.values()]
      .filter((item) => item.kind === "emoji")
      .filter((item) => term === "" || item.name.includes(term));
  }, [expressions, query]);

  const serverStickers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...expressions.values()]
      .filter((item) => item.kind === "sticker")
      .filter((item) => term === "" || item.name.includes(term));
  }, [expressions, query]);

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

  /**
   * Inserts a custom emoji as the text it is.
   *
   * `:name:` rather than a picture, because that is what the message stores:
   * nothing is rewritten on the way in, so a line written today still reads as
   * what somebody typed after the emoji is renamed or deleted.
   */
  function chooseServerEmoji(name: string) {
    onPick(`:${name}:`);
  }

  /**
   * Sends a custom sticker.
   *
   * It goes as a link to its own picture, which is what a Klipy sticker
   * already does: the message renderer draws a message that is nothing but a
   * media link as the media itself, so a sticker needs no field of its own on
   * a message and no second rendering path to draw it.
   */
  function chooseServerSticker(url: string) {
    if (onSendMedia) onSendMedia(url);
    else onPick(url);
    onClose();
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

  /**
   * Stars or unstars one Klipy item.
   *
   * The whole item is stored, not its id: see the note in `favoriteMedia`.
   */
  function toggleMediaFavorite(item: KlipyMediaItem, kind: FavoriteKind) {
    const url = getMediaSendUrl(item);
    if (!url) return;
    setFavorites(
      toggleFavorite({
        id: String(item.id),
        kind,
        title: item.title,
        preview: getMediaPreviewUrl(item) || url,
        url,
      }),
    );
  }

  /** Sends a starred item, which already carries the URL it was saved with. */
  function sendFavorite(item: FavoriteMedia) {
    if (onSendMedia) onSendMedia(item.url);
    else onPick(item.url);
    onClose();
  }

  function removeFavorite(item: FavoriteMedia) {
    setFavorites(toggleFavorite(item));
  }

  const favoriteGifs = useMemo(() => favoritesOf(favorites, "gif"), [favorites]);
  const favoriteStickers = useMemo(() => favoritesOf(favorites, "sticker"), [favorites]);

  /** The star drawn over a tile, in the state it is in for that item. */
  function favoriteStar(starred: boolean, onToggle: () => void) {
    const label = starred ? t("emoji.favorites.remove") : t("emoji.favorites.add");
    return (
      <button
        type="button"
        className={starred ? "picker__fav-star picker__fav-star--on" : "picker__fav-star"}
        onClick={onToggle}
        title={label}
        aria-label={label}
        aria-pressed={starred}
      >
        <StarIcon size={14} />
      </button>
    );
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
              setShowingFavorites(false);
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
              setShowingFavorites(false);
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
              setShowingFavorites(false);
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
            onChange={(event) => {
              setQuery(event.target.value);
              // A search is a different shelf from the favourites one.
              if (event.target.value.trim()) setShowingFavorites(false);
            }}
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
            ) : showingFavorites ? (
              <>
                <div className="picker__shelf-head">
                  <button
                    type="button"
                    className="picker__shelf-back"
                    onClick={() => setShowingFavorites(false)}
                    aria-label={t("emoji.favorites.back")}
                    title={t("emoji.favorites.back")}
                  >
                    <ChevronLeftIcon size={15} />
                  </button>
                  <h3 className="picker__shelf-title">{t("emoji.gifs.favorites")}</h3>
                </div>
                {favoriteGifs.length === 0 ? (
                  <p className="picker__empty">{t("emoji.favorites.empty")}</p>
                ) : (
                  <div className="picker__media-grid">
                    {favoriteGifs.map((item) => (
                      <div key={`${item.kind}:${item.id}`} className="picker__media-item">
                        <button
                          type="button"
                          className="picker__media-pick"
                          onClick={() => sendFavorite(item)}
                          title={item.title}
                        >
                          <AnimatedImage src={item.preview} alt={item.title} loading="lazy" />
                        </button>
                        {favoriteStar(true, () => removeFavorite(item))}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : query.trim() === "" ? (
              <div className="picker__categories-grid">
                {/* Favorites Card */}
                <button
                  type="button"
                  className="picker__category-card picker__category-card--fav"
                  onClick={() => setShowingFavorites(true)}
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
                  <CategoryCard
                    key={cat.category}
                    category={cat}
                    onPick={() => setQuery(cat.query || cat.category)}
                  />
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
                  const starred = isFavorited(favorites, "gif", String(item.id));
                  return (
                    <div key={item.id} className="picker__media-item">
                      <button
                        type="button"
                        className="picker__media-pick"
                        onClick={() => handleSendMediaItem(item)}
                        title={item.title}
                      >
                        <AnimatedImage src={preview} alt={item.title} loading="lazy" />
                      </button>
                      {favoriteStar(starred, () => toggleMediaFavorite(item, "gif"))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STICKERS TAB */}
        {tab === "stickers" && (
          <div className="picker__body picker__body--stickers" ref={scroller}>
            {/* Starred stickers sit above the rest, and only when nothing is
                being searched: a search is asking for something else. */}
            {!searching && favoriteStickers.length > 0 ? (
              <section data-section="favorite-stickers">
                <h3 className="picker__label">{t("emoji.gifs.favorites")}</h3>
                <div className="picker__stickers-grid">
                  {favoriteStickers.map((item) => (
                    <div key={`${item.kind}:${item.id}`} className="picker__sticker-item">
                      <button
                        type="button"
                        className="picker__sticker-pick"
                        onClick={() => sendFavorite(item)}
                        onMouseEnter={() =>
                          setHoveredInfo({ name: item.title, imgUrl: item.preview })
                        }
                        onMouseLeave={() => setHoveredInfo(null)}
                        title={item.title}
                      >
                        <AnimatedImage src={item.preview} alt={item.title} loading="lazy" />
                      </button>
                      {favoriteStar(true, () => removeFavorite(item))}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {serverStickers.length > 0 ? (
              <section data-section="server-stickers">
                <h3 className="picker__label">{t("emoji.stickers.serverSection")}</h3>
                <div className="picker__stickers-grid">
                  {serverStickers.map((item) => (
                    <div key={item.id} className="picker__sticker-item">
                      <button
                        type="button"
                        className="picker__sticker-pick"
                        onClick={() => chooseServerSticker(expressionUrl(address, item))}
                        onMouseEnter={() =>
                          setHoveredInfo({
                            name: item.name,
                            subtext: server?.name ?? "",
                            imgUrl: expressionUrl(address, item),
                          })
                        }
                        onMouseLeave={() => setHoveredInfo(null)}
                        title={item.name}
                      >
                        <AnimatedImage
                          src={expressionUrl(address, item)}
                          alt={item.name}
                          loading="lazy"
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {/* The notice about a missing Klipy key is only worth showing when
                there is nothing else in this tab: a server carrying its own
                stickers, or a shelf of starred ones, is not missing anything. */}
            {!klipyEnabled && (serverStickers.length > 0 || favoriteStickers.length > 0) ? null : !klipyEnabled ? (
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
                  const starred = isFavorited(favorites, "sticker", String(item.id));
                  return (
                    <div key={item.id} className="picker__sticker-item">
                      <button
                        type="button"
                        className="picker__sticker-pick"
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
                        <AnimatedImage src={preview} alt={item.title} loading="lazy" />
                      </button>
                      {favoriteStar(starred, () => toggleMediaFavorite(item, "sticker"))}
                    </div>
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
              {serverEmoji.length > 0 ? (
                <button
                  type="button"
                  className={
                    !searching && activeCategory === "server"
                      ? "picker__tab picker__tab--active"
                      : "picker__tab"
                  }
                  title={t("emoji.emojis.serverSection")}
                  aria-label={t("emoji.emojis.serverSection")}
                  onClick={() => jumpTo("server")}
                >
                  <span className="picker__tab-letter">
                    {(server?.name ?? "S").slice(0, 1).toUpperCase()}
                  </span>
                </button>
              ) : null}
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
              {serverEmoji.length > 0 ? (
                <section data-section="server">
                  <h3 className="picker__label">{t("emoji.emojis.serverSection")}</h3>
                  <div className="picker__grid">
                    {serverEmoji.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="picker__emoji"
                        title={`:${item.name}:`}
                        aria-label={item.name}
                        onClick={() => chooseServerEmoji(item.name)}
                        onMouseEnter={() =>
                          setHoveredInfo({
                            name: `:${item.name}:`,
                            subtext: server?.name ?? "",
                            imgUrl: expressionUrl(address, item),
                          })
                        }
                        onMouseLeave={() => setHoveredInfo(null)}
                      >
                        <AnimatedImage
                          src={expressionUrl(address, item)}
                          alt={item.name}
                          className="picker__twemoji"
                          width={22}
                          height={22}
                          loading="lazy"
                          draggable={false}
                          animated={item.animated ?? undefined}
                        />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
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
