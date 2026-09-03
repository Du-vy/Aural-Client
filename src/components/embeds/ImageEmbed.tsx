import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { ImageLightbox, getFilenameFromUrl } from "../attachments/ImageLightbox";
import { ImageIcon } from "../Icons";

interface ImageEmbedProps {
  url: string;
  onOpenLink(url: string): void;
}

export function ImageEmbed({ url, onOpenLink }: ImageEmbedProps) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [viewing, setViewing] = useState(false);

  if (error) {
    return null;
  }

  const filename = getFilenameFromUrl(url);

  return (
    <>
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
            title={t("attachments.openImage", { name: filename })}
            aria-label={t("attachments.openImage", { name: filename })}
            className={`msg-embed__image ${loaded ? "msg-embed__image--loaded" : ""}`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            referrerPolicy="no-referrer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewing(true);
            }}
            loading="lazy"
          />
        </div>
      </div>

      {viewing ? (
        <ImageLightbox
          url={url}
          filename={filename}
          onOpenExternal={() => onOpenLink(url)}
          onClose={() => setViewing(false)}
        />
      ) : null}
    </>
  );
}
