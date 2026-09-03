import { useState } from "react";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { User } from "@/lib/protocol";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";

interface KickUserDialogProps {
  user: User;
  onConfirm(reason: string, deleteMessages: "none" | "1d" | "7d" | "30d" | "all"): void;
  onClose(): void;
}

type PurgeTimeframe = "none" | "1d" | "7d" | "30d" | "all";

const PURGE_OPTIONS: { id: PurgeTimeframe; labelKey: TranslationKey }[] = [
  { id: "none", labelKey: "dialogs.kick.purgeNone" },
  { id: "1d", labelKey: "dialogs.kick.purge1d" },
  { id: "7d", labelKey: "dialogs.kick.purge7d" },
  { id: "30d", labelKey: "dialogs.kick.purge30d" },
  { id: "all", labelKey: "dialogs.kick.purgeAll" },
];

export function KickUserDialog({ user, onConfirm, onClose }: KickUserDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [deleteMessages, setDeleteMessages] = useState<PurgeTimeframe>("none");

  return (
    <Modal
      title={t("dialogs.kick.title", { name: user.nickname })}
      subtitle={t("dialogs.kick.subtitle", { name: user.nickname })}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="btn btn--danger"
            type="button"
            onClick={() => {
              onConfirm(reason.trim(), deleteMessages);
              onClose();
            }}
            autoFocus
          >
            {t("dialogs.kick.confirmButton")}
          </button>
        </>
      }
    >
      <div className="kick-dialog">
        <div className="kick-dialog__user-card">
          <Avatar user={user} size="md" />
          <div className="kick-dialog__user-info">
            <span className="kick-dialog__user-name">{user.nickname}</span>
            <span className="kick-dialog__user-meta">
              {user.username ? `@${user.username}` : t("common.guest")} •{" "}
              {user.online ? t("common.online") : t("common.offline")}
            </span>
          </div>
        </div>

        <div className="field">
          <div className="kick-dialog__field-header">
            <label htmlFor="kick-reason" className="field__label">
              {t("dialogs.kick.reasonLabel")}
            </label>
            {reason.length > 0 ? (
              <span className="kick-dialog__char-count">{500 - reason.length}</span>
            ) : null}
          </div>
          <textarea
            id="kick-reason"
            className="input kick-dialog__textarea"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("dialogs.kick.reasonPlaceholder")}
          />
        </div>

        <div className="field">
          <label className="field__label">{t("dialogs.kick.purgeLabel")}</label>
          <p className="field__hint" style={{ marginTop: -4, marginBottom: 8 }}>
            {t("dialogs.kick.purgeHint")}
          </p>
          <div className="kick-purge__grid" role="radiogroup" aria-label={t("dialogs.kick.purgeLabel")}>
            {PURGE_OPTIONS.map((opt) => {
              const isSelected = deleteMessages === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`kick-purge__btn ${isSelected ? "kick-purge__btn--active" : ""}`}
                  onClick={() => setDeleteMessages(opt.id)}
                >
                  <span className={`kick-purge__indicator ${isSelected ? "kick-purge__indicator--active" : ""}`} />
                  <span className="kick-purge__label">{t(opt.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
