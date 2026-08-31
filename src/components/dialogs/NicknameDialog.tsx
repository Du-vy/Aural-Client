import { useState, type FormEvent } from "react";

import { useTranslation } from "@/lib/i18n";
import { describeError } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { Modal } from "../Modal";

interface NicknameDialogProps {
  userId: number;
  onClose(): void;
}

export function NicknameDialog({ userId, onClose }: NicknameDialogProps) {
  const { t } = useTranslation();
  const users = useSession((state) => state.users);
  const self = useSession((state) => state.self);
  const setNickname = useSession((state) => state.setNickname);

  const target = users.get(userId) ?? (self?.id === userId ? self : null);
  const [nickname, setNicknameValue] = useState(target?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!target) return null;

  const isSelf = self?.id === userId;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setNickname(nickname.trim(), isSelf ? undefined : userId);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isSelf ? t("dialogs.nickname.title") : `${t("dialogs.nickname.title")} — ${target.nickname}`}
      subtitle={t("dialogs.nickname.subtitle")}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="btn btn--primary"
            type="submit"
            form="change-nickname"
            disabled={busy}
          >
            {t("common.save")}
          </button>
        </>
      }
    >
      <form
        id="change-nickname"
        onSubmit={(event) => void submit(event)}
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {error ? <p className="alert">{error}</p> : null}

        <div className="field">
          <label className="field__label" htmlFor="nickname-input">
            {t("dialogs.nickname.nicknameLabel")}
          </label>
          <input
            id="nickname-input"
            className="input"
            value={nickname}
            onChange={(event) => setNicknameValue(event.target.value)}
            maxLength={32}
            placeholder={target.username ?? target.nickname}
            autoFocus
          />
          <span className="field__hint">{t("dialogs.nickname.subtitle")}</span>
        </div>
      </form>
    </Modal>
  );
}

