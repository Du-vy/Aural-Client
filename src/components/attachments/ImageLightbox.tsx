import { useEffect } from "react";

import { useTranslation } from "@/lib/i18n";
import type { Attachment } from "@/lib/protocol";
import { formatBytes, parseBytes } from "@/lib/uploads";
import { CloseIcon, DownloadIcon, ExternalLinkIcon } from "../Icons";

interface ImageLightboxProps {
  attachment: Attachment;
  url: string;
  onDownload(): void;
  onOpenExternal(): void;
  onClose(): void;
}

/** An attached image shown full size, over the conversation. */
export function ImageLightbox({
  attachment,
  url,
  onDownload,
  onOpenExternal,
  onClose,
}: ImageLightboxProps) {
  const { t } = useTranslation();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      // Clicking the backdrop closes; clicking the picture does not, which is
      // what lets somebody drag or right-click it without losing the view.
      onClick={onClose}
    >
      <div className="lightbox__bar" onClick={(event) => event.stopPropagation()}>
        <span className="lightbox__name" title={attachment.filename}>
          {attachment.filename}
        </span>
        <span className="lightbox__meta">
          {formatBytes(parseBytes(attachment.size))}
          {attachment.width && attachment.height ? ` · ${attachment.width}×${attachment.height}` : ""}
        </span>
        <button
          type="button"
          className="iconbtn"
          onClick={onDownload}
          title={t("attachments.download")}
          aria-label={t("attachments.download")}
        >
          <DownloadIcon size={17} />
        </button>
        <button
          type="button"
          className="iconbtn"
          onClick={onOpenExternal}
          title={t("attachments.openExternally")}
          aria-label={t("attachments.openExternally")}
        >
          <ExternalLinkIcon size={17} />
        </button>
        <button
          type="button"
          className="iconbtn"
          onClick={onClose}
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <CloseIcon size={17} />
        </button>
      </div>

      <img
        src={url}
        alt={attachment.filename}
        className="lightbox__image"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
