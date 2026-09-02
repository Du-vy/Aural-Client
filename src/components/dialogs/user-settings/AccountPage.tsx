import { useState, type FormEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { CheckIcon, LockIcon } from "@/components/Icons";

export function AccountPage() {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const server = useSession((state) => state.server);
  const permissions = useMyPermissions();
  const register = useSession((state) => state.register);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canRegister = (server?.registrationEnabled ?? false) && has(permissions, Perm.Register);

  async function submitRegister(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError(t("errors.invalid_credentials"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(username.trim(), password);
      setPassword("");
      setConfirm("");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.account.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.account.desc")}
        </p>
      </header>

      {self?.registered ? (
        <div className="settings-card settings-card--highlight">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="settings-card__icon-badge" style={{ background: "rgba(59, 165, 93, 0.15)", color: "var(--online)" }}>
              <CheckIcon size={20} />
            </span>
            <div>
              <h3 className="settings-card__title">
                {t("dialogs.account.registeredTitle")}: @{self.username}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.account.registeredDesc", { username: self.username })}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-card settings-card--highlight">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span className="settings-card__icon-badge" style={{ background: "rgba(224, 160, 48, 0.15)", color: "var(--warning)" }}>
              <LockIcon size={20} />
            </span>
            <div>
              <h3 className="settings-card__title">{t("dialogs.account.guestNoticeTitle")}</h3>
              <p className="settings-card__subtitle" style={{ marginTop: 4 }}>
                {t("dialogs.account.guestNoticeDesc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {!self?.registered ? (
        <div className="settings-card" style={{ marginTop: 16 }}>
          <h3 className="settings-card__title">{t("dialogs.account.registerTitle")}</h3>
          <p className="settings-card__subtitle">{t("dialogs.account.registerDesc")}</p>

          {!canRegister ? (
            <p className="alert alert--danger" style={{ marginTop: 12 }}>
              {t("errors.registration_closed")}
            </p>
          ) : null}

          {error ? (
            <p className="alert alert--danger" style={{ marginTop: 12 }}>
              {error}
            </p>
          ) : null}

          <form onSubmit={(e) => void submitRegister(e)} className="settings-form" style={{ marginTop: 16 }}>
            <div className="field">
              <label className="field__label" htmlFor="claim-username">
                {t("dialogs.account.username")}
              </label>
              <input
                id="claim-username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={!canRegister || busy}
                required
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="claim-password">
                {t("dialogs.account.password")}
              </label>
              <input
                id="claim-password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={!canRegister || busy}
                required
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="claim-confirm">
                {t("dialogs.account.confirmPassword")}
              </label>
              <input
                id="claim-confirm"
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={!canRegister || busy}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !canRegister || !username.trim() || !password}
            >
              {busy ? t("common.loading") : t("dialogs.account.registerButton")}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
