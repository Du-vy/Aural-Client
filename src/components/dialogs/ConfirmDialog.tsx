import { type ReactNode } from "react";
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
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = true,
  tip,
  children,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            {cancelText}
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
            {confirmText}
          </button>
        </>
      }
    >
      {children}
      {tip ? <div className="confirm-tip">{tip}</div> : null}
    </Modal>
  );
}
