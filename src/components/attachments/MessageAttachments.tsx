import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { saveUrl } from "@/lib/open";
import type { Attachment } from "@/lib/protocol";
import { attachmentKind, attachmentUrl, downloadUrl } from "@/lib/uploads";
import { useSession } from "@/store/session";
import { ContextMenu, type MenuEntry } from "../ContextMenu";
import { CopyIcon, DownloadIcon, ExternalLinkIcon } from "../Icons";
import { FileAttachment } from "./FileAttachment";
import { ImageAttachment } from "./ImageAttachment";
import { ImageLightbox } from "./ImageLightbox";
import { AudioAttachment, VideoAttachment } from "./MediaAttachment";
import { TextAttachment } from "./TextAttachment";

interface MessageAttachmentsProps {
  attachments: readonly Attachment[];
  /** Opens a link through the confirmation the client applies to any URL. */
  onOpenLink(url: string): void;
}

/**
 * The files a message carries.
 *
 * Each one is rendered by what it is: pictures and media play in place, text
 * and Markdown open into a preview, and anything else is a card with a download
 * button. Every one of them has the same right-click menu, because "save this"
 * is the thing somebody wants from a file often enough that hunting for a
 * button would be the wrong answer.
 */
export function MessageAttachments({ attachments, onOpenLink }: MessageAttachmentsProps) {
  const { t } = useTranslation();
  const address = useSession((state) => state.address);
  const [menu, setMenu] = useState<{ x: number; y: number; attachment: Attachment } | null>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  const entries: MenuEntry[] = useMemo(() => {
    if (!menu) return [];
    const target = menu.attachment;
    const direct = attachmentUrl(address, target);

    return [
      {
        id: "download",
        label: t("attachments.download"),
        icon: <DownloadIcon size={15} />,
        onClick: () => void saveUrl(downloadUrl(address, target), target.filename),
      },
      {
        id: "open",
        label: t("attachments.openExternally"),
        icon: <ExternalLinkIcon size={15} />,
        onClick: () => onOpenLink(direct),
      },
      { type: "separator" },
      {
        id: "copy-link",
        label: t("common.copyLink"),
        icon: <CopyIcon size={15} />,
        onClick: () => void navigator.clipboard.writeText(direct),
      },
      {
        id: "copy-name",
        label: t("attachments.copyName"),
        icon: <CopyIcon size={15} />,
        onClick: () => void navigator.clipboard.writeText(target.filename),
      },
    ];
  }, [menu, address, onOpenLink, t]);

  if (attachments.length === 0) return null;

  return (
    <div className="attachments">
      {attachments.map((attachment) => {
        const kind = attachmentKind(attachment);
        const url = attachmentUrl(address, attachment);
        const download = () => void saveUrl(downloadUrl(address, attachment), attachment.filename);

        return (
          <div
            key={attachment.id}
            className="attachments__item"
            onContextMenu={(event) => {
              event.preventDefault();
              // Stops the message's own menu from opening as well: a
              // right-click on a file is about the file.
              event.stopPropagation();
              setMenu({ x: event.clientX, y: event.clientY, attachment });
            }}
          >
            {kind === "image" ? (
              <ImageAttachment
                attachment={attachment}
                url={url}
                onOpen={() => setViewing(attachment)}
              />
            ) : null}
            {kind === "video" ? <VideoAttachment attachment={attachment} url={url} /> : null}
            {kind === "audio" ? <AudioAttachment attachment={attachment} url={url} /> : null}
            {kind === "text" ? (
              <TextAttachment
                attachment={attachment}
                url={url}
                onDownload={download}
                onOpenLink={onOpenLink}
              />
            ) : null}
            {kind === "pdf" || kind === "file" ? (
              <FileAttachment attachment={attachment} kind={kind} onDownload={download} />
            ) : null}
          </div>
        );
      })}

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={entries} onClose={() => setMenu(null)} />
      ) : null}

      {viewing ? (
        <ImageLightbox
          attachment={viewing}
          url={attachmentUrl(address, viewing)}
          onDownload={() => void saveUrl(downloadUrl(address, viewing), viewing.filename)}
          onOpenExternal={() => onOpenLink(attachmentUrl(address, viewing))}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
