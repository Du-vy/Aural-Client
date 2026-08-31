import { useEffect, useState } from "react";
import { getLinkMetadata, type OgData } from "@/lib/opengraph";

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

  if (!data || (!data.title && !data.description && !data.image)) {
    return null;
  }

  const borderStyle = data.color ? { borderLeftColor: data.color } : undefined;

  return (
    <div className="msg-embed msg-embed--og" style={borderStyle}>
      <div className="msg-embed__og-inner">
        <div className="msg-embed__og-content">
          {data.siteName && (
            <div className="msg-embed__og-provider">
              {data.favicon && (
                <img
                  src={data.favicon}
                  alt=""
                  className="msg-embed__og-favicon"
                  aria-hidden="true"
                />
              )}
              <span className="msg-embed__og-sitename">{data.siteName}</span>
            </div>
          )}

          {data.title && (
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

          {data.description && (
            <p className="msg-embed__og-description">{data.description}</p>
          )}
        </div>

        {data.image && (
          <div className="msg-embed__og-image-wrap">
            <img
              src={data.image}
              alt={data.title || "Preview"}
              className="msg-embed__og-image"
              loading="lazy"
              onClick={(e) => {
                e.preventDefault();
                onOpenLink(url);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
