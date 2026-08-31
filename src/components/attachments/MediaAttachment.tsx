import { useTranslation } from "@/lib/i18n";
import type { Attachment } from "@/lib/protocol";
import { formatBytes, parseBytes } from "@/lib/uploads";
import { MusicIcon } from "../Icons";

interface MediaAttachmentProps {
  attachment: Attachment;
  url: string;
}

/**
 * An attached video, played in place.
 *
 * The server answers range requests, so seeking works and the whole file is
 * never pulled down just to watch the start of it. `preload="metadata"` is what
 * keeps a channel full of clips from downloading all of them at once.
 */
export function VideoAttachment({ attachment, url }: MediaAttachmentProps) {
  const aspect =
    attachment.width && attachment.height ? attachment.width / attachment.height : undefined;

  return (
    <div className="attachment attachment--video">
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        className="attachment__video"
        style={aspect ? { aspectRatio: String(aspect) } : undefined}
      />
      <p className="attachment__caption" title={attachment.filename}>
        {attachment.filename}
      </p>
    </div>
  );
}

/** An attached audio file, played in place with its name above the controls. */
export function AudioAttachment({ attachment, url }: MediaAttachmentProps) {
  const { t } = useTranslation();

  return (
    <div className="attachment attachment--audio">
      <div className="attachment__audio-head">
        <span className="attachment__audio-icon" aria-hidden="true">
          <MusicIcon size={16} />
        </span>
        <span className="attachment__audio-title" title={attachment.filename}>
          {attachment.filename || t("attachments.audio")}
        </span>
        <span className="attachment__size">{formatBytes(parseBytes(attachment.size))}</span>
      </div>
      <audio src={url} controls preload="metadata" className="attachment__audio-player" />
    </div>
  );
}
