import { useTranslation } from "@/lib/i18n";
import type { Attachment } from "@/lib/protocol";
import { extensionOf, formatBytes, parseBytes, type AttachmentKind } from "@/lib/uploads";
import { ArchiveIcon, DownloadIcon, FileIcon, FileTextIcon, FilmIcon, ImageIcon, MusicIcon } from "../Icons";

interface FileAttachmentProps {
  attachment: Attachment;
  kind: AttachmentKind;
  onDownload(): void;
}

const ARCHIVE_EXTENSIONS = new Set(["zip", "gz", "tar", "7z", "rar", "xz", "zst"]);

/** The icon that says the most about a file at a glance. */
function iconFor(attachment: Attachment, kind: AttachmentKind) {
  switch (kind) {
    case "image":
      return ImageIcon;
    case "video":
      return FilmIcon;
    case "audio":
      return MusicIcon;
    case "text":
    case "pdf":
      return FileTextIcon;
    default:
      return ARCHIVE_EXTENSIONS.has(extensionOf(attachment.filename)) ? ArchiveIcon : FileIcon;
  }
}

/**
 * A file that has no player of its own: a card naming it, its size and its
 * type, with a download button.
 *
 * The whole card is not a download link. A click that starts a file transfer
 * should be a deliberate one, so it is the button that downloads and the card
 * that merely sits there.
 */
export function FileAttachment({ attachment, kind, onDownload }: FileAttachmentProps) {
  const { t } = useTranslation();
  const Icon = iconFor(attachment, kind);
  const extension = extensionOf(attachment.filename);

  return (
    <div className="attachment attachment--file">
      <span className="attachment__file-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <span className="attachment__file-body">
        <span className="attachment__file-name" title={attachment.filename}>
          {attachment.filename}
        </span>
        <span className="attachment__file-meta">
          {formatBytes(parseBytes(attachment.size))}
          {extension ? ` · ${extension.toUpperCase()}` : ""}
        </span>
      </span>
      <button
        type="button"
        className="iconbtn attachment__download"
        onClick={onDownload}
        title={t("attachments.download")}
        aria-label={t("attachments.downloadNamed", { name: attachment.filename })}
      >
        <DownloadIcon size={16} />
      </button>
    </div>
  );
}
