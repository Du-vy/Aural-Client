import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getDomain } from "@/lib/links";
import { addTrustedDomain } from "@/lib/storage";
import { AlertTriangleIcon, ExternalLinkIcon } from "../Icons";
import { Modal } from "../Modal";

interface ExternalLinkDialogProps {
  url: string;
  onConfirm(): void;
  onClose(): void;
}

export function ExternalLinkDialog({ url, onConfirm, onClose }: ExternalLinkDialogProps) {
  const { t } = useTranslation();
  const domain = getDomain(url);
  const [trustDomain, setTrustDomain] = useState(false);

  function handleOpen() {
    if (trustDomain && domain) {
      addTrustedDomain(domain);
    }
    onConfirm();
    onClose();
  }

  return (
    <Modal
      title={t("dialogs.externalLink.title")}
      subtitle={t("dialogs.externalLink.subtitle")}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn--primary" type="button" onClick={handleOpen} autoFocus>
            {t("dialogs.externalLink.openButton")}
          </button>
        </>
      }
    >
      <div className="ext-link-dialog">
        <div className="ext-link-dialog__url-box">
          <span className="ext-link-dialog__url-icon">
            <ExternalLinkIcon size={16} />
          </span>
          <span className="ext-link-dialog__url-text" title={url}>
            {url}
          </span>
        </div>

        <div className="alert">
          <div className="ext-link-dialog__warning">
            <span className="ext-link-dialog__warning-icon">
              <AlertTriangleIcon size={18} />
            </span>
            <span>{t("dialogs.externalLink.warning")}</span>
          </div>
        </div>

        <label className="ext-link-dialog__trust">
          <input
            type="checkbox"
            className="ext-link-dialog__checkbox"
            checked={trustDomain}
            onChange={(e) => setTrustDomain(e.target.checked)}
          />
          <span className="ext-link-dialog__trust-label">
            {t("dialogs.externalLink.trustDomain", { domain })}
          </span>
        </label>
      </div>
    </Modal>
  );
}
