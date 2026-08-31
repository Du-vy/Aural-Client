import { useTranslation } from "@/lib/i18n";
import type { Attachment } from "@/lib/protocol";
import { extensionOf, formatBytes } from "@/lib/uploads";
import { CloseIcon, FileIcon } from "./Icons";

/** One file in the composer, with the state of its upload. */
export interface PendingFile {
  /** Local identity, which the file has before the server gives it one. */
  localId: string;
  file: File;
  /** Object URL of a local thumbnail, for images. */
  previewUrl: string | null;
  /** 0 to 1. */
  progress: number;
  /** Set once the server has accepted the file. */
  attachment: Attachment | null;
  /** Set when the file was refused, which leaves it in the tray to be removed. */
  error: string | null;
}

interface AttachmentTrayProps {
  items: readonly PendingFile[];
  onRemove(localId: string): void;
}

/**
 * The files queued above the message box.
 *
 * Each one shows its own progress, because uploads run independently: a large
 * video and a small screenshot picked together finish at very different times,
 * and one bar for both would say nothing useful about either.
 */
export function AttachmentTray({ items, onRemove }: AttachmentTrayProps) {
  const { t } = useTranslation();

  return (
    <ul className="tray" aria-label={t("attachments.pending")}>
      {items.map((item) => {
        const uploading = item.attachment === null && item.error === null;
        const percent = Math.round(item.progress * 100);

        return (
          <li
            key={item.localId}
            className={item.error ? "tray__item tray__item--failed" : "tray__item"}
          >
            <span className="tray__thumb" aria-hidden="true">
              {item.previewUrl ? (
                <img src={item.previewUrl} alt="" className="tray__thumb-img" />
              ) : (
                <span className="tray__thumb-ext">
                  {extensionOf(item.file.name) ? (
                    extensionOf(item.file.name).slice(0, 4).toUpperCase()
                  ) : (
                    <FileIcon size={18} />
                  )}
                </span>
              )}
            </span>

            <span className="tray__body">
              <span className="tray__name" title={item.file.name}>
                {item.file.name}
              </span>
              <span className={item.error ? "tray__meta tray__meta--error" : "tray__meta"}>
                {item.error ?? formatBytes(item.file.size)}
              </span>
            </span>

            {uploading ? (
              <span
                className="tray__progress"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("attachments.uploading", { name: item.file.name })}
              >
                <span className="tray__progress-bar" style={{ width: `${percent}%` }} />
              </span>
            ) : null}

            <button
              type="button"
              className="iconbtn tray__remove"
              onClick={() => onRemove(item.localId)}
              title={t("attachments.remove")}
              aria-label={t("attachments.removeNamed", { name: item.file.name })}
            >
              <CloseIcon size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
