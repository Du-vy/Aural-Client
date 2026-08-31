import { useState, type FormEvent } from "react";

import { Perm, has } from "@/lib/permissions";
import { describeError } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { Modal } from "../Modal";

type Tab = "identity" | "account" | "ownership";

/**
 * Everything about who you are on this server: the display name, claiming the
 * identity as an account, and redeeming the owner token.
 */
export function AccountDialog({ onClose }: { onClose(): void }) {
  const self = useSession((state) => state.self);
  const server = useSession((state) => state.server);
  const permissions = useMyPermissions();

  const [tab, setTab] = useState<Tab>("identity");

  if (!self || !server) return null;

  const canRegister = server.registrationEnabled && has(permissions, Perm.Register);

  return (
    <Modal
      title="Your identity"
      subtitle={`On ${server.name}`}
      onClose={onClose}
      tabs={
        <>
          <button
            className={tab === "identity" ? "tab tab--active" : "tab"}
            onClick={() => setTab("identity")}
          >
            Profile
          </button>
          <button
            className={tab === "account" ? "tab tab--active" : "tab"}
            onClick={() => setTab("account")}
          >
            Account
          </button>
          <button
            className={tab === "ownership" ? "tab tab--active" : "tab"}
            onClick={() => setTab("ownership")}
          >
            Ownership
          </button>
        </>
      }
    >
      {tab === "identity" ? <ProfileTab /> : null}
      {tab === "account" ? <AccountTab canRegister={canRegister} /> : null}
      {tab === "ownership" ? <OwnershipTab /> : null}
    </Modal>
  );
}

function ProfileTab() {
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
      {saved ? <p className="alert alert--info">Nickname updated.</p> : null}

      <div className="field">
        <label className="field__label" htmlFor="nickname-field">
          Nickname
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
            ? "How you appear to everyone on this server."
            : "This server does not let you change your nickname."}
        </span>
      </div>

      <button
        className="btn btn--primary"
        type="submit"
        disabled={busy || !allowed || value.trim() === self?.nickname || value.trim() === ""}
      >
        Save nickname
      </button>
    </form>
  );
}

function AccountTab({ canRegister }: { canRegister: boolean }) {
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
          This identity is claimed as <strong>@{self.username}</strong>.
        </p>
        <p className="field__hint">
          You can sign in with those credentials from any device, and you will come back as this
          same member with the same roles.
        </p>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
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
        You are connected as a guest. Right now this identity lives only in this client: clearing
        its data would lose it for good. Claiming it with a username and password keeps the same
        member, the same id and the same roles, and lets you sign back in from anywhere.
      </p>

      {!canRegister ? (
        <p className="alert">This server is not accepting new accounts.</p>
      ) : null}
      {error ? <p className="alert">{error}</p> : null}

      <div className="field">
        <label className="field__label" htmlFor="claim-username">
          Username
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
        <span className="field__hint">Letters, digits, dot, underscore and hyphen.</span>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="claim-password">
          Password
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
          Confirm password
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
        Claim this identity
      </button>
    </form>
  );
}

function OwnershipTab() {
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
    return <p className="alert alert--info">You are an administrator of this server.</p>;
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <p className="field__hint">
        A new server prints a one-time owner token in its console. Redeeming it here makes you the
        administrator. It works exactly once.
      </p>

      {error ? <p className="alert">{error}</p> : null}
      {done ? <p className="alert alert--info">You are now an administrator.</p> : null}

      <div className="field">
        <label className="field__label" htmlFor="owner-token">
          Owner token
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
        Redeem token
      </button>
    </form>
  );
}
