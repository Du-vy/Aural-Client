import { useState, type FormEvent } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";

import { describeError } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { Modal } from "../Modal";

type Tab = "identity" | "account" | "ownership" | "preferences";

/**
 * Everything about who you are on this server: the display name, claiming the
 * identity as an account, redeeming the owner token, and user preferences.
 */
export function AccountDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const server = useSession((state) => state.server);
  const permissions = useMyPermissions();

  const [tab, setTab] = useState<Tab>("identity");

  if (!self || !server) return null;

  const canRegister = server.registrationEnabled && has(permissions, Perm.Register);

  return (
    <Modal
      title={t("dialogs.account.title")}
      subtitle={`On ${server.name}`}
      onClose={onClose}
      tabs={
        <>
          <button
            className={tab === "identity" ? "tab tab--active" : "tab"}
            onClick={() => setTab("identity")}
          >
            {t("contextMenu.profile")}
          </button>
          <button
            className={tab === "account" ? "tab tab--active" : "tab"}
            onClick={() => setTab("account")}
          >
            {t("dialogs.account.title")}
          </button>
          <button
            className={tab === "ownership" ? "tab tab--active" : "tab"}
            onClick={() => setTab("ownership")}
          >
            {t("server.claimAdmin")}
          </button>
          <button
            className={tab === "preferences" ? "tab tab--active" : "tab"}
            onClick={() => setTab("preferences")}
          >
            {t("common.language")}
          </button>
        </>
      }
    >
      {tab === "identity" ? <ProfileTab /> : null}
      {tab === "account" ? <AccountTab canRegister={canRegister} /> : null}
      {tab === "ownership" ? <OwnershipTab /> : null}
      {tab === "preferences" ? <PreferencesTab /> : null}
    </Modal>
  );
}

function PreferencesTab() {
  const { t, language, setLanguage, supportedLanguages } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="field">
        <label className="field__label">{t("dialogs.account.languageSetting")}</label>
        <span className="field__hint">{t("dialogs.account.languageDesc")}</span>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: "8px",
            marginTop: "8px",
          }}
        >
          {supportedLanguages.map((lang) => {
            const isSelected = lang.code === language;
            return (
              <button
                key={lang.code}
                type="button"
                className="lang-card"
                onClick={() => setLanguage(lang.code)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-sm)",
                  background: isSelected ? "var(--accent-soft)" : "var(--bg-raised)",
                  border: isSelected ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                  color: isSelected ? "var(--accent)" : "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all var(--speed) ease",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "14px" }}>{lang.nativeName}</div>
                  {lang.name !== lang.nativeName ? (
                    <div
                      style={{
                        fontSize: "12px",
                        color: isSelected ? "var(--accent)" : "var(--text-dim)",
                        opacity: 0.8,
                      }}
                    >
                      {lang.name}
                    </div>
                  ) : null}
                </div>
                {isSelected ? (
                  <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--accent)" }}>✓</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}


function ProfileTab() {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const setNickname = useSession((state) => state.setNickname);
  const permissions = useMyPermissions();

  const [value, setValue] = useState(self?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const allowed = has(permissions, Perm.ChangeNickname);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await setNickname(value.trim());
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {error ? <p className="alert">{error}</p> : null}
      {saved ? <p className="alert alert--info">{t("common.saved")}</p> : null}

      <div className="field">
        <label className="field__label" htmlFor="nickname-field">
          {t("connect.nicknameLabel")}
        </label>
        <input
          id="nickname-field"
          className="input"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          maxLength={32}
          disabled={!allowed}
        />
        <span className="field__hint">
          {allowed
            ? t("dialogs.nickname.subtitle")
            : t("errors.forbidden")}
        </span>
      </div>

      <button
        className="btn btn--primary"
        type="submit"
        disabled={busy || !allowed || value.trim() === self?.nickname || value.trim() === ""}
      >
        {t("common.save")}
      </button>
    </form>
  );
}

function AccountTab({ canRegister }: { canRegister: boolean }) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const register = useSession((state) => state.register);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (self?.registered) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="alert alert--info">
          {t("dialogs.account.registeredTitle")}: <strong>@{self.username}</strong>
        </p>
        <p className="field__hint">
          {t("dialogs.account.registeredDesc", { username: self.username })}
        </p>
      </div>
    );
  }

  async function submit(event: FormEvent) {
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
    <form
      onSubmit={(event) => void submit(event)}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <p className="field__hint">
        {t("dialogs.account.guestNoticeDesc")}
      </p>

      {!canRegister ? (
        <p className="alert">{t("errors.registration_closed")}</p>
      ) : null}
      {error ? <p className="alert">{error}</p> : null}

      <div className="field">
        <label className="field__label" htmlFor="claim-username">
          {t("connect.usernameLabel")}
        </label>
        <input
          id="claim-username"
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          disabled={!canRegister}
          required
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="claim-password">
          {t("connect.passwordLabel")}
        </label>
        <input
          id="claim-password"
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          disabled={!canRegister}
          required
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="claim-confirm">
          {t("dialogs.account.confirmPassword")}
        </label>
        <input
          id="claim-confirm"
          className="input"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          disabled={!canRegister}
          required
        />
      </div>

      <button className="btn btn--primary" type="submit" disabled={busy || !canRegister}>
        {t("dialogs.account.registerButton")}
      </button>
    </form>
  );
}

function OwnershipTab() {
  const { t } = useTranslation();
  const claimAdmin = useSession((state) => state.claimAdmin);
  const permissions = useMyPermissions();

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const alreadyAdmin = has(permissions, Perm.Administrator);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await claimAdmin(token.trim());
      setDone(true);
      setToken("");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (alreadyAdmin) {
    return <p className="alert alert--info">{t("server.claimAdminSuccess")}</p>;
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <p className="field__hint">
        {t("server.claimAdminPrompt")}
      </p>

      {error ? <p className="alert">{error}</p> : null}
      {done ? <p className="alert alert--info">{t("server.claimAdminSuccess")}</p> : null}

      <div className="field">
        <label className="field__label" htmlFor="owner-token">
          {t("server.claimAdmin")}
        </label>
        <input
          id="owner-token"
          className="input"
          style={{ fontFamily: "var(--font-mono)" }}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="xxxxx-xxxxx-xxxxx-xxxx"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>

      <button className="btn btn--primary" type="submit" disabled={busy || token.trim() === ""}>
        {t("server.claimAdminButton")}
      </button>
    </form>
  );
}

