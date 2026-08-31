import { useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import type { Attachment } from "@/lib/protocol";
import { extensionOf, formatBytes, isMarkdown, parseBytes } from "@/lib/uploads";
import { ChevronIcon, DownloadIcon, FileTextIcon } from "../Icons";
import { Markdown } from "./Markdown";

interface TextAttachmentProps {
  attachment: Attachment;
  url: string;
  onDownload(): void;
  onOpenLink(url: string): void;
}

/**
 * How much of a text file is pulled in for the preview. A README is a few
 * kilobytes; a log file is not, and nobody wants the whole of one pasted into
 * a conversation.
 */
const PREVIEW_BYTES = 64 * 1024;

type Preview =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; text: string; truncated: boolean }
  | { state: "failed" };

/**
 * A text or Markdown file, previewed inside a collapsible card.
 *
 * It is closed until it is asked for. A preview costs a request, unlike an
 * image the browser would fetch anyway, and a channel where people trade log
 * files should not fetch every one of them on scroll.
 */
export function TextAttachment({ attachment, url, onDownload, onOpenLink }: TextAttachmentProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview>({ state: "idle" });

  const size = parseBytes(attachment.size);
  const markdown = isMarkdown(attachment);

  // Keyed on what is actually being fetched, and deliberately not on the state
  // it sets: an effect that depends on its own result tears down the request it
  // just started, and the preview never arrives.
  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setPreview({ state: "loading" });

    void (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          // Only the head of the file is asked for, so a very large one costs
          // the same as a small one.
          headers: { Range: `bytes=0-${PREVIEW_BYTES - 1}` },
        });
        if (!response.ok && response.status !== 206) {
          setPreview({ state: "failed" });
          return;
        }
        const text = await response.text();
        setPreview({
          state: "ready",
          text,
          // A 206 that came back full-length, or a 200 the server answered
          // whole, both mean there is more of the file than is shown.
          truncated: size > text.length,
        });
      } catch {
        // An abort is this component closing or going away, not a failure.
        if (controller.signal.aborted) return;
        setPreview({ state: "failed" });
      }
    })();

    return () => controller.abort();
  }, [open, url, size]);

  return (
    <div className={open ? "attachment attachment--text attachment--open" : "attachment attachment--text"}>
      <div className="attachment__text-head">
        <button
          type="button"
          className="attachment__text-toggle"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
        >
          <span className="attachment__file-icon" aria-hidden="true">
            <FileTextIcon size={18} />
          </span>
          <span className="attachment__file-body">
            <span className="attachment__file-name" title={attachment.filename}>
              {attachment.filename}
            </span>
            <span className="attachment__file-meta">
              {formatBytes(size)}
              {` · ${(extensionOf(attachment.filename) || "txt").toUpperCase()}`}
            </span>
          </span>
          <span
            className={open ? "attachment__chevron attachment__chevron--open" : "attachment__chevron"}
            aria-hidden="true"
          >
            <ChevronIcon size={16} />
          </span>
        </button>

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

      {open ? (
        <div className="attachment__text-body">
          {preview.state === "loading" ? (
            <p className="attachment__note">{t("common.loading")}</p>
          ) : null}
          {preview.state === "failed" ? (
            <p className="attachment__note">{t("attachments.previewFailed")}</p>
          ) : null}
          {preview.state === "ready" ? (
            <>
              {markdown ? (
                <Markdown source={preview.text} onOpenLink={onOpenLink} />
              ) : (
                <pre className="attachment__code">
                  <code>{preview.text}</code>
                </pre>
              )}
              {preview.truncated ? (
                <p className="attachment__note">{t("attachments.previewTruncated")}</p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
