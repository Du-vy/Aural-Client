import { useState } from "react";

import { useTranslation } from "@/lib/i18n";
import type { Embed } from "@/lib/protocol";
import { formatFull } from "@/lib/time";
import { Markdown } from "../attachments/Markdown";
import { ImageLightbox, getFilenameFromUrl } from "../attachments/ImageLightbox";

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
  const { t } = useTranslation();
  const [viewing, setViewing] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);

  const accent = colorOf(embed.color);
  const image = imageBroken ? undefined : embed.image?.url;
  const fields = embed.fields ?? [];

  return (
    <>
      <div className="rich-embed" style={accent ? { borderLeftColor: accent } : undefined}>
        <div className="rich-embed__grid">
          <div className="rich-embed__main">
            {embed.author?.name ? (
              <div className="rich-embed__author">
                {embed.author.icon_url ? (
                  <img
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
                <Markdown source={embed.description} onOpenLink={onOpenLink} />
              </div>
            ) : null}

            {fields.length > 0 ? (
              <div className="rich-embed__fields">
                {fields.map((field, index) => (
                  <div
                    key={index}
                    className={
                      field.inline ? "rich-embed__field rich-embed__field--inline" : "rich-embed__field"
                    }
                  >
                    {field.name ? <div className="rich-embed__field-name">{field.name}</div> : null}
                    {field.value ? (
                      <div className="rich-embed__field-value">
                        <Markdown source={field.value} onOpenLink={onOpenLink} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {image ? (
              <img
                src={image}
                alt={t("embeds.imageAttachment")}
                className="rich-embed__image"
                referrerPolicy="no-referrer"
                loading="lazy"
                onError={() => setImageBroken(true)}
                onClick={() => setViewing(true)}
              />
            ) : null}

            {embed.footer?.text || embed.timestamp ? (
              <div className="rich-embed__footer">
                {embed.footer?.icon_url ? (
                  <img
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

          {embed.thumbnail?.url ? (
            <img
              src={embed.thumbnail.url}
              alt=""
              className="rich-embed__thumbnail"
              referrerPolicy="no-referrer"
              loading="lazy"
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>

      {viewing && image ? (
        <ImageLightbox
          url={image}
          filename={getFilenameFromUrl(image)}
          width={embed.image?.width}
          height={embed.image?.height}
          onOpenExternal={() => onOpenLink(image)}
          onClose={() => setViewing(false)}
        />
      ) : null}
    </>
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
  return formatFull(Math.floor(at / 1000));
}
