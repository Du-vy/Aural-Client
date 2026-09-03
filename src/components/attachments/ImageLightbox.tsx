import { useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { openExternalUrl, saveUrl } from "@/lib/open";
import type { Attachment } from "@/lib/protocol";
import { formatBytes, parseBytes } from "@/lib/uploads";
import { CloseIcon, DownloadIcon, ExternalLinkIcon, ImageIcon } from "../Icons";

export interface ImageLightboxProps {
  url: string;
  attachment?: Attachment;
  filename?: string;
  size?: number | string;
  width?: number;
  height?: number;
  onDownload?(): void;
  onOpenExternal?(): void;
  onClose(): void;
}

/**
 * Extracts a readable filename from an image URL.
 */
export function getFilenameFromUrl(url: string, defaultName = "image"): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.pop();
    if (last) {
      return decodeURIComponent(last);
    }
    return parsed.hostname || defaultName;
  } catch {
    return defaultName;
  }
}

/** An attached or linked image shown full size, over the conversation. */
export function ImageLightbox({
  attachment,
  url,
  filename,
  size,
  width,
  height,
  onDownload,
  onOpenExternal,
  onClose,
}: ImageLightboxProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const displayName = filename || attachment?.filename || getFilenameFromUrl(url);

  const rawBytes =
    size !== undefined
      ? typeof size === "number"
        ? size
        : parseBytes(size)
      : attachment
        ? parseBytes(attachment.size)
        : 0;
  const sizeText = rawBytes > 0 ? formatBytes(rawBytes) : "";

  const finalWidth = width ?? attachment?.width ?? naturalDimensions?.width;
  const finalHeight = height ?? attachment?.height ?? naturalDimensions?.height;
  const dimensionsText = finalWidth && finalHeight ? `${finalWidth}×${finalHeight}` : "";

  const metaText =
    sizeText && dimensionsText
      ? `${sizeText} · ${dimensionsText}`
      : sizeText || dimensionsText;

  const handleDownload = () => {
    if (onDownload) {
      onDownload();
    } else {
      void saveUrl(url, displayName);
    }
  };

  const handleOpenExternal = () => {
    if (onOpenExternal) {
      onOpenExternal();
    } else {
      void openExternalUrl(url);
    }
  };

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={displayName}
      // Clicking the backdrop closes; clicking the picture does not, which is
      // what lets somebody drag or right-click it without losing the view.
      onClick={onClose}
    >
      <div className="lightbox__bar" onClick={(event) => event.stopPropagation()}>
        <span className="lightbox__name" title={displayName}>
          {displayName}
        </span>
        {metaText ? <span className="lightbox__meta">{metaText}</span> : null}
        <button
          type="button"
          className="iconbtn"
          onClick={handleDownload}
          title={t("attachments.download")}
          aria-label={t("attachments.download")}
        >
          <DownloadIcon size={17} />
        </button>
        <button
          type="button"
          className="iconbtn"
          onClick={handleOpenExternal}
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

      {failed ? (
        <div className="lightbox__broken" onClick={(event) => event.stopPropagation()}>
          <ImageIcon size={32} />
          <span>{t("attachments.unavailable", { name: displayName })}</span>
        </div>
      ) : (
        <img
          src={url}
          alt={displayName}
          className="lightbox__image"
          onClick={(event) => event.stopPropagation()}
          onLoad={(event) => {
            setNaturalDimensions({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
          }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
