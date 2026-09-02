import { useEffect, useState } from "react";
import { formatMetricCount, getLinkMetadata, type OgData } from "@/lib/opengraph";
import { formatDateTime } from "@/lib/time";
import { EyeIcon, HeartIcon, MessageSquareIcon, RepeatIcon } from "../Icons";

interface OpenGraphEmbedProps {
  url: string;
  onOpenLink(url: string): void;
}

export function OpenGraphEmbed({ url, onOpenLink }: OpenGraphEmbedProps) {
  const [data, setData] = useState<OgData | null>(null);

  useEffect(() => {
    let active = true;
    getLinkMetadata(url).then((res) => {
      if (active && res) {
        setData(res);
      }
    });
    return () => {
      active = false;
    };
  }, [url]);

  if (!data || (!data.title && !data.description && !data.image && !data.video)) {
    return null;
  }

  const borderStyle = data.color ? { borderLeftColor: data.color } : undefined;
  const metrics = data.metrics;
  const hasMetrics =
    metrics &&
    (metrics.replies !== undefined ||
      metrics.retweets !== undefined ||
      metrics.likes !== undefined ||
      metrics.views !== undefined);

  return (
    <div className="msg-embed msg-embed--og" style={borderStyle}>
      <div className="msg-embed__og-inner">
        <div className="msg-embed__og-content">
          {/* Author or Site Header */}
          {(data.author || data.siteName) && (
            <div className="msg-embed__og-provider">
              {(data.authorIcon || data.favicon) && (
                <img
                  src={data.authorIcon || data.favicon}
                  alt=""
                  className={data.authorIcon ? "msg-embed__og-author-avatar" : "msg-embed__og-favicon"}
                  referrerPolicy="no-referrer"
                  aria-hidden="true"
                />
              )}
              {data.author ? (
                <a
                  href={data.authorUrl || url}
                  className="msg-embed__og-author"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenLink(data.authorUrl || url);
                  }}
                >
                  {data.author}
                </a>
              ) : (
                <span className="msg-embed__og-sitename">{data.siteName}</span>
              )}
            </div>
          )}

          {/* Title (if different from author) */}
          {data.title && data.title !== data.author && (
            <a
              href={url}
              className="msg-embed__og-title"
              onClick={(e) => {
                e.preventDefault();
                onOpenLink(url);
              }}
            >
              {data.title}
            </a>
          )}

          {/* Description */}
          {data.description && (
            <p className="msg-embed__og-description">{data.description}</p>
          )}

          {/* Metrics Counters (Replies, Retweets, Likes, Views) */}
          {hasMetrics && (
            <div className="msg-embed__og-metrics">
              {metrics.replies !== undefined && (
                <span className="msg-embed__og-metric" title="Replies">
                  <MessageSquareIcon size={14} />
                  <span>{formatMetricCount(metrics.replies)}</span>
                </span>
              )}
              {metrics.retweets !== undefined && (
                <span className="msg-embed__og-metric" title="Retweets / Reposts">
                  <RepeatIcon size={14} />
                  <span>{formatMetricCount(metrics.retweets)}</span>
                </span>
              )}
              {metrics.likes !== undefined && (
                <span className="msg-embed__og-metric" title="Likes">
                  <HeartIcon size={14} />
                  <span>{formatMetricCount(metrics.likes)}</span>
                </span>
              )}
              {metrics.views !== undefined && (
                <span className="msg-embed__og-metric" title="Views">
                  <EyeIcon size={14} />
                  <span>{formatMetricCount(metrics.views)}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Video Player or Image Preview */}
        {data.video ? (
          <div className="msg-embed__og-video-wrap">
            <video
              src={data.video}
              poster={data.image}
              controls
              preload="metadata"
              playsInline
              className="msg-embed__og-video"
            >
              <source src={data.video} type={data.videoType || "video/mp4"} />
            </video>
          </div>
        ) : data.image ? (
          <div className="msg-embed__og-image-wrap">
            <img
              src={data.image}
              alt={data.title || "Preview"}
              className="msg-embed__og-image"
              loading="lazy"
              referrerPolicy="no-referrer"
              onClick={(e) => {
                e.preventDefault();
                onOpenLink(url);
              }}
            />
          </div>
        ) : null}

        {/* Footer */}
        {(data.siteName || data.timestamp) && (
          <footer className="msg-embed__og-footer">
            {data.favicon && (
              <img
                src={data.favicon}
                alt=""
                className="msg-embed__og-footer-icon"
                referrerPolicy="no-referrer"
              />
            )}
            {data.siteName && <span>{data.siteName}</span>}
            {data.siteName && data.timestamp && <span>•</span>}
            {data.timestamp && (
              <span>
                {typeof data.timestamp === "number"
                  ? formatDateTime(data.timestamp)
                  : String(data.timestamp)}
              </span>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
