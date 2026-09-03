import { useState } from "react";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { BanCreateRequest, PurgeWindow, User } from "@/lib/protocol";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";

interface BanUserDialogProps {
  user: User;
  onConfirm(input: Omit<BanCreateRequest, "userId">): void;
  onClose(): void;
}

const PURGE_OPTIONS: { id: PurgeWindow; labelKey: TranslationKey }[] = [
  { id: "none", labelKey: "dialogs.kick.purgeNone" },
  { id: "1d", labelKey: "dialogs.kick.purge1d" },
  { id: "7d", labelKey: "dialogs.kick.purge7d" },
  { id: "30d", labelKey: "dialogs.kick.purge30d" },
  { id: "all", labelKey: "dialogs.kick.purgeAll" },
];

/** How long a ban lasts. Zero is permanent, which is the default. */
const DURATIONS: { seconds: number; labelKey: TranslationKey }[] = [
  { seconds: 0, labelKey: "dialogs.ban.durationPermanent" },
  { seconds: 3600, labelKey: "dialogs.ban.duration1h" },
  { seconds: 86400, labelKey: "dialogs.ban.duration1d" },
  { seconds: 7 * 86400, labelKey: "dialogs.ban.duration7d" },
  { seconds: 30 * 86400, labelKey: "dialogs.ban.duration30d" },
];

/**
 * Banning somebody.
 *
 * The two switches are the whole point of the dialog. A ban that names only an
 * account is one a guest walks straight back through, so both are on by
 * default; and an address is very often shared — a household, a university, one
 * phone network — so turning that one off has to be one click away for the
 * moderator who knows they are about to catch somebody else.
 */
export function BanUserDialog({ user, onConfirm, onClose }: BanUserDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [deleteMessages, setDeleteMessages] = useState<PurgeWindow>("none");
  const [duration, setDuration] = useState(0);
  const [matchIp, setMatchIp] = useState(true);
  const [matchDevice, setMatchDevice] = useState(true);

  return (
    <Modal
      title={t("dialogs.ban.title", { name: user.nickname })}
      subtitle={t("dialogs.ban.subtitle", { name: user.nickname })}
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
              onConfirm({
                reason: reason.trim(),
                duration,
                deleteMessages,
                matchIp,
                matchDevice,
              });
              onClose();
            }}
            autoFocus
          >
            {t("dialogs.ban.confirmButton")}
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
          <label htmlFor="ban-reason" className="field__label">
            {t("dialogs.ban.reasonLabel")}
          </label>
          <textarea
            id="ban-reason"
            className="input kick-dialog__textarea"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("dialogs.ban.reasonPlaceholder")}
          />
          <p className="field__hint">{t("dialogs.ban.reasonHint")}</p>
        </div>

        <div className="field">
          <label className="field__label">{t("dialogs.ban.durationLabel")}</label>
          <div className="chip-row">
            {DURATIONS.map((option) => (
              <button
                key={option.seconds}
                type="button"
                className={duration === option.seconds ? "chip chip--on" : "chip"}
                onClick={() => setDuration(option.seconds)}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field__label">{t("dialogs.ban.reachLabel")}</label>
          <p className="field__hint">{t("dialogs.ban.reachHint")}</p>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={matchIp}
              onChange={(event) => setMatchIp(event.target.checked)}
            />
            <span className="settings-toggle__body">
              <span className="settings-toggle__label">{t("dialogs.ban.matchIp")}</span>
              <span className="field__hint">{t("dialogs.ban.matchIpHint")}</span>
            </span>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={matchDevice}
              onChange={(event) => setMatchDevice(event.target.checked)}
            />
            <span className="settings-toggle__body">
              <span className="settings-toggle__label">{t("dialogs.ban.matchDevice")}</span>
              <span className="field__hint">{t("dialogs.ban.matchDeviceHint")}</span>
            </span>
          </label>
        </div>

        <div className="field">
          <label className="field__label">{t("dialogs.kick.purgeLabel")}</label>
          <div className="kick-purge__grid" role="radiogroup" aria-label={t("dialogs.kick.purgeLabel")}>
            {PURGE_OPTIONS.map((option) => {
              const selected = deleteMessages === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`kick-purge__btn ${selected ? "kick-purge__btn--active" : ""}`}
                  onClick={() => setDeleteMessages(option.id)}
                >
                  <span
                    className={`kick-purge__indicator ${selected ? "kick-purge__indicator--active" : ""}`}
                  />
                  <span className="kick-purge__label">{t(option.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
