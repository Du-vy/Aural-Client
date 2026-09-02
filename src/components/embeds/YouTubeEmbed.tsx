import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getLinkMetadata, type OgData } from "@/lib/opengraph";
import { PlayIcon, YouTubeIcon } from "../Icons";

interface YouTubeEmbedProps {
  url: string;
  videoId: string;
  startTime?: number;
  onOpenLink(url: string): void;
}

export function YouTubeEmbed({ url, videoId, startTime, onOpenLink }: YouTubeEmbedProps) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [metadata, setMetadata] = useState<OgData | null>(null);

  useEffect(() => {
    let active = true;
    getLinkMetadata(url).then((data) => {
      if (active && data) setMetadata(data);
    });
    return () => {
      active = false;
    };
  }, [url]);

  const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1${startTime ? `&start=${startTime}` : ""}`;
  const thumbnail = metadata?.image || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const title = metadata?.title;
  const author = metadata?.author;

  return (
    <div className="msg-embed msg-embed--youtube">
      <div className="msg-embed__yt-header">
        <div className="msg-embed__yt-provider">
          <span className="msg-embed__yt-icon">
            <YouTubeIcon size={16} />
          </span>
          <span className="msg-embed__yt-provider-name">{t("embeds.youtube")}</span>
          {author && <span className="msg-embed__yt-author">• {author}</span>}
        </div>
        {title && (
          <a
            href={url}
            className="msg-embed__yt-title"
            onClick={(e) => {
              e.preventDefault();
              onOpenLink(url);
            }}
          >
            {title}
          </a>
        )}
      </div>

      <div className="msg-embed__yt-player-wrap">
        {playing ? (
          <iframe
            src={embedSrc}
            title={title || "YouTube video"}
            className="msg-embed__yt-iframe"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className="msg-embed__yt-thumb-btn"
            onClick={() => setPlaying(true)}
            aria-label={t("embeds.playVideo")}
          >
            <img
              src={thumbnail}
              alt={title || "YouTube thumbnail"}
              className="msg-embed__yt-thumb"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
            <div className="msg-embed__yt-play-overlay">
              <span className="msg-embed__yt-play-btn">
                <PlayIcon size={20} />
              </span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
