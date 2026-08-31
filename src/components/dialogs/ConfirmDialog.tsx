import { type ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";
import { Modal } from "../Modal";

interface ConfirmDialogProps {
  title: string;
  subtitle?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  tip?: ReactNode;
  children?: ReactNode;
  onConfirm(): void;
  onClose(): void;
}

export function ConfirmDialog({
  title,
  subtitle,
  confirmText,
  cancelText,
  danger = true,
  tip,
  children,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const finalConfirmText = confirmText ?? t("common.continue");
  const finalCancelText = cancelText ?? t("common.cancel");

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            {finalCancelText}
          </button>
          <button
            className={danger ? "btn btn--danger" : "btn btn--primary"}
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            autoFocus
          >
            {finalConfirmText}
          </button>

        </>
      }
    >
      {children}
      {tip ? <div className="confirm-tip">{tip}</div> : null}
    </Modal>
  );
}
