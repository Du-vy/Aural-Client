import { useState } from "react";

import { isBareMedia, pictureOf, playbackOf, type EmbedPlayback } from "@/lib/embeds";
import { useTranslation } from "@/lib/i18n";
import type { Embed, EmbedMedia } from "@/lib/protocol";
import { formatSmartDateTime } from "@/lib/time";
import { Markdown } from "../attachments/Markdown";
import { ImageLightbox, getFilenameFromUrl } from "../attachments/ImageLightbox";
import { AnimatedImage } from "../AnimatedImage";
import { PlayIcon } from "../Icons";

/**
 * A rich card carried by a message.
 *
 * These arrive from webhooks, in Discord's embed shape, which is what lets a
 * service already pointed at a Discord webhook post here unchanged. The layout
 * follows it too — a coloured edge, an author line, a title, a body, a grid of
 * fields, a picture and a footer — because the services that send them lay
 * their information out expecting exactly that arrangement.
 *
 * Everything in here came from outside this server. Text is rendered through
 * the Markdown component, which builds React elements rather than markup, and
 * every URL was already narrowed to http(s) by the server before it was
 * stored.
 */
interface RichEmbedsProps {
  embeds: readonly Embed[];
  onOpenLink(url: string): void;
}

/** What one message may draw. The server already caps a delivery at ten. */
const MAX_RICH_EMBEDS = 10;

export function RichEmbeds({ embeds, onOpenLink }: RichEmbedsProps) {
  if (!embeds || embeds.length === 0) return null;

  return (
    <div className="rich-embeds">
      {embeds.slice(0, MAX_RICH_EMBEDS).map((embed, index) => (
        <RichEmbed key={index} embed={embed} onOpenLink={onOpenLink} />
      ))}
    </div>
  );
}

function RichEmbed({ embed, onOpenLink }: { embed: Embed; onOpenLink(url: string): void }) {
  // Which picture the lightbox is showing, rather than a flag: a card has two,
  // and either of them can be the one that was opened.
  const [viewing, setViewing] = useState<EmbedMedia | null>(null);
  const [imageBroken, setImageBroken] = useState(false);
  const [thumbnailBroken, setThumbnailBroken] = useState(false);

  const accent = colorOf(embed.color);
  const playback = playbackOf(embed);
  const image = imageBroken ? undefined : embed.image;
  const thumbnail = thumbnailBroken ? undefined : embed.thumbnail;
  const fields = embed.fields ?? [];

  // A bare picture or loop is drawn as itself. Discord makes one of these out
  // of a link to an image, where the address was never the point and a card
  // around it would be a frame around a frame.
  if (isBareMedia(embed)) {
    const picture = pictureOf(embed);
    if (playback) {
      return (
        <EmbedPlayer playback={playback} poster={picture?.url} title={embed.title} bare />
      );
    }
    if (picture && !imageBroken) {
      return (
        <>
          <EmbedPicture
            media={picture}
            className="rich-embed__media"
            onOpen={() => setViewing(picture)}
            onBroken={() => setImageBroken(true)}
          />
          {viewing?.url ? (
            <ImageLightbox
              url={viewing.url}
              filename={getFilenameFromUrl(viewing.url)}
              width={viewing.width}
              height={viewing.height}
              onOpenExternal={() => onOpenLink(viewing.url!)}
              onClose={() => setViewing(null)}
            />
          ) : null}
        </>
      );
    }
  }

  return (
    <>
      <div className="rich-embed" style={accent ? { borderLeftColor: accent } : undefined}>
        <div className="rich-embed__grid">
          <div className="rich-embed__main">
            {embed.provider?.name ? (
              <EmbedLink
                href={embed.provider.url}
                className="rich-embed__provider"
                onOpenLink={onOpenLink}
              >
                {embed.provider.name}
              </EmbedLink>
            ) : null}

            {embed.author?.name ? (
              <div className="rich-embed__author">
                {embed.author.icon_url ? (
                  <AnimatedImage
                    src={embed.author.icon_url}
                    alt=""
                    className="rich-embed__author-icon"
                    referrerPolicy="no-referrer"
                    aria-hidden="true"
                  />
                ) : null}
                <EmbedLink href={embed.author.url} className="rich-embed__author-name" onOpenLink={onOpenLink}>
                  {embed.author.name}
                </EmbedLink>
              </div>
            ) : null}

            {embed.title ? (
              <EmbedLink href={embed.url} className="rich-embed__title" onOpenLink={onOpenLink}>
                {embed.title}
              </EmbedLink>
            ) : null}

            {embed.description ? (
              <div className="rich-embed__description">
                <Markdown source={embed.description} embed onOpenLink={onOpenLink} />
              </div>
            ) : null}

            {fields.length > 0 ? (
              <div className="rich-embed__fields">
                {(() => {
                  // Discord groups contiguous inline fields: if a group has 2 inline fields,
                  // each gets half width (span 6); if 3 or more, they take a third (span 4).
                  const spans = fields.map((f, i) => {
                    if (!f.inline) return 12;
                    let runLen = 1;
                    let start = i;
                    while (start > 0 && fields[start - 1]?.inline) {
                      start--;
                    }
                    let end = i;
                    while (end + 1 < fields.length && fields[end + 1]?.inline) {
                      end++;
                    }
                    runLen = end - start + 1;
                    return runLen === 2 ? 6 : 4;
                  });

                  return fields.map((field, index) => {
                    const span = spans[index];
                    const className =
                      span === 6
                        ? "rich-embed__field rich-embed__field--inline-half"
                        : span === 4
                        ? "rich-embed__field rich-embed__field--inline"
                        : "rich-embed__field";

                    return (
                      <div key={index} className={className}>
                        {field.name ? <div className="rich-embed__field-name">{field.name}</div> : null}
                        {field.value ? (
                          <div className="rich-embed__field-value">
                            <Markdown source={field.value} embed onOpenLink={onOpenLink} />
                          </div>
                        ) : null}
                      </div>
                    );
                  });
                })()}
              </div>
            ) : null}

            {playback ? (
              <EmbedPlayer
                playback={playback}
                poster={image?.url ?? thumbnail?.url}
                title={embed.title}
              />
            ) : image?.url ? (
              <EmbedPicture
                media={image}
                className="rich-embed__image"
                onOpen={() => setViewing(image)}
                onBroken={() => setImageBroken(true)}
              />
            ) : null}

            {embed.footer?.text || embed.timestamp ? (
              <div className="rich-embed__footer">
                {embed.footer?.icon_url ? (
                  <AnimatedImage
                    src={embed.footer.icon_url}
                    alt=""
                    className="rich-embed__footer-icon"
                    referrerPolicy="no-referrer"
                    aria-hidden="true"
                  />
                ) : null}
                {embed.footer?.text ? <span>{embed.footer.text}</span> : null}
                {embed.footer?.text && embed.timestamp ? (
                  <span className="rich-embed__footer-dot">•</span>
                ) : null}
                {embed.timestamp ? <span>{formatTimestamp(embed.timestamp)}</span> : null}
              </div>
            ) : null}
          </div>

          {thumbnail?.url && !playback ? (
            <EmbedPicture
              media={thumbnail}
              className="rich-embed__thumbnail"
              onOpen={() => setViewing(thumbnail)}
              onBroken={() => setThumbnailBroken(true)}
            />
          ) : null}
        </div>
      </div>

      {viewing?.url ? (
        <ImageLightbox
          url={viewing.url}
          filename={getFilenameFromUrl(viewing.url)}
          width={viewing.width}
          height={viewing.height}
          onOpenExternal={() => onOpenLink(viewing.url!)}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  );
}

/**
 * One of a card's two pictures, opened full size on a click.
 *
 * Both of them open, which is what Discord does and what anybody who has used
 * one expects: a monitoring graph arrives as the big picture and a build's
 * status icon as the thumbnail, and either can be the one worth looking at
 * closely.
 *
 * It is a button rather than an image with a click handler so that it can be
 * reached from the keyboard, exactly as an attached image is. The picture
 * itself is hidden from assistive technology and the button carries the label,
 * so the two are announced once rather than twice.
 */
function EmbedPicture({
  media,
  className,
  onOpen,
  onBroken,
}: {
  media: EmbedMedia;
  className: string;
  onOpen(): void;
  onBroken(): void;
}) {
  const { t } = useTranslation();
  const name = getFilenameFromUrl(media.url ?? "");

  return (
    <button
      type="button"
      className={`${className}-btn`}
      onClick={onOpen}
      title={t("attachments.openImage", { name })}
      aria-label={t("attachments.openImage", { name })}
    >
      <AnimatedImage
        src={media.url}
        alt=""
        className={className}
        referrerPolicy="no-referrer"
        loading="lazy"
        aria-hidden="true"
        onError={onBroken}
      />
    </button>
  );
}

/**
 * A card's clip, played where its picture would otherwise sit.
 *
 * Nothing loads until it is asked for: a channel of relayed links would
 * otherwise open a dozen players at once, and the poster is the picture the
 * card already carried. A silent loop — what a GIF host sends instead of a GIF
 * — is the exception, since a loop nobody starts is the whole of what it is.
 */
function EmbedPlayer({
  playback,
  poster,
  title,
  bare = false,
}: {
  playback: EmbedPlayback;
  poster?: string;
  title?: string;
  bare?: boolean;
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const className = bare ? "rich-embed__player rich-embed__player--bare" : "rich-embed__player";

  if (playback.kind === "file" && playback.loop) {
    return (
      <video
        className={`${className} rich-embed__player--loop`}
        src={playback.src}
        poster={poster}
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }

  if (!playing) {
    return (
      <button
        type="button"
        className={`${className} rich-embed__player-btn`}
        onClick={() => setPlaying(true)}
        aria-label={t("embeds.playVideo")}
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            className="rich-embed__player-poster"
            referrerPolicy="no-referrer"
            loading="lazy"
            aria-hidden="true"
          />
        ) : null}
        <span className="rich-embed__player-overlay">
          <span className="rich-embed__player-play">
            <PlayIcon size={20} />
          </span>
        </span>
      </button>
    );
  }

  if (playback.kind === "file") {
    return (
      <video
        className={className}
        src={playback.src}
        poster={poster}
        controls
        autoPlay
        playsInline
      />
    );
  }

  return (
    <iframe
      className={className}
      src={playback.src}
      title={title || t("embeds.playVideo")}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
    />
  );
}

/** A piece of the card that is a link when it has a URL and plain text when not. */
function EmbedLink({
  href,
  className,
  onOpenLink,
  children,
}: {
  href?: string;
  className: string;
  onOpenLink(url: string): void;
  children: React.ReactNode;
}) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      className={`${className} rich-embed__link`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        onOpenLink(href);
      }}
    >
      {children}
    </a>
  );
}

/** Turns the 24-bit integer an embed carries into a CSS colour. */
export function colorOf(color: number | undefined): string | undefined {
  if (color === undefined || !Number.isFinite(color)) return undefined;
  const value = Math.max(0, Math.floor(color)) & 0xffffff;
  return `#${value.toString(16).padStart(6, "0")}`;
}

/**
 * Renders the instant a card carries. It is an ISO 8601 string written by
 * whoever sent the delivery, so one that will not parse is shown as it arrived
 * rather than as "Invalid Date".
 */
function formatTimestamp(raw: string): string {
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return raw;
  return formatSmartDateTime(Math.floor(at / 1000));
}
