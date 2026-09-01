import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { ImageIcon } from "../Icons";

interface ImageEmbedProps {
  url: string;
  onOpenLink(url: string): void;
}

export function ImageEmbed({ url, onOpenLink }: ImageEmbedProps) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return null;
  }

  return (
    <div className="msg-embed msg-embed--image">
      <div className="msg-embed__image-container">
        {!loaded && (
          <div className="msg-embed__skeleton" aria-hidden="true">
            <ImageIcon size={24} className="msg-embed__skeleton-icon" />
          </div>
        )}
        <img
          src={url}
          alt={t("embeds.imageAttachment")}
          className={`msg-embed__image ${loaded ? "msg-embed__image--loaded" : ""}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          referrerPolicy="no-referrer"
          onClick={(e) => {
            e.preventDefault();
            onOpenLink(url);
          }}
          loading="lazy"
        />
      </div>
    </div>
  );
}
