import { useState } from "react";

import { useTranslation } from "@/lib/i18n";
import type { Attachment } from "@/lib/protocol";
import { ImageIcon } from "../Icons";
import { AnimatedImage } from "../AnimatedImage";

interface ImageAttachmentProps {
  attachment: Attachment;
  url: string;
  onOpen(): void;
}

/** How tall an attached image is allowed to be before it is scaled down. */
const MAX_HEIGHT = 340;
const MAX_WIDTH = 480;

/**
 * Fits an image inside the bounds a message gives it, keeping its proportions.
 *
 * The size is computed from what the server measured rather than left to the
 * browser, so the space is reserved before the picture arrives and the
 * conversation does not jump as images load.
 */
function fit(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function ImageAttachment({ attachment, url, onOpen }: ImageAttachmentProps) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const measured =
    attachment.width && attachment.height ? fit(attachment.width, attachment.height) : null;

  if (failed) {
    return (
      <div className="attachment attachment--broken">
        <ImageIcon size={16} />
        <span>{t("attachments.unavailable", { name: attachment.filename })}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="attachment attachment--image"
      style={measured ? { width: measured.width } : undefined}
      onClick={onOpen}
      title={attachment.filename}
      aria-label={t("attachments.openImage", { name: attachment.filename })}
    >
      {!loaded ? (
        <span
          className="attachment__skeleton"
          style={measured ? { height: measured.height } : undefined}
          aria-hidden="true"
        >
          <ImageIcon size={22} />
        </span>
      ) : null}
      <AnimatedImage
        src={url}
        alt={attachment.filename}
        className={loaded ? "attachment__img attachment__img--loaded" : "attachment__img"}
        style={measured ? { width: measured.width, height: measured.height } : undefined}
        width={attachment.width}
        height={attachment.height}
        loading="lazy"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </button>
  );
}
