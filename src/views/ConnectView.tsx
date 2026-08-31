import { useEffect, useState, type FormEvent } from "react";

import { Avatar } from "@/components/Avatar";
import { AuralMark, TrashIcon } from "@/components/Icons";
import { DEFAULT_PORT, fetchServerInfo, parseAddress } from "@/lib/address";
import type { ServerInfo } from "@/lib/protocol";
import { useSession } from "@/store/session";

type Mode = "guest" | "signin";

/**
 * The connect screen. Servers are reached by address, so this is the closest
 * thing Aural has to a home page: pick a saved one, or type where to go.
 */
export function ConnectView() {
  const saved = useSession((state) => state.saved);
  const status = useSession((state) => state.status);
  const error = useSession((state) => state.error);
  const connect = useSession((state) => state.connect);
  const forget = useSession((state) => state.forget);

  const [address, setAddress] = useState("");
  const [nickname, setNickname] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("guest");
  const [preview, setPreview] = useState<ServerInfo | null>(null);

  const busy = status === "connecting" || status === "reconnecting";

  // The preview is a courtesy: it makes a typo visible before connecting, and
  // it reveals whether the server wants a password. A failure is not reported,
  // because a server that blocks the plain HTTP probe may still accept the
  // WebSocket.
  useEffect(() => {
    setPreview(null);
    let parsed;
    try {
      parsed = parseAddress(address);
    } catch {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchServerInfo(parsed, controller.signal)
        .then((info) => setPreview(info as ServerInfo))
        .catch(() => setPreview(null));
    }, 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [address]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    try {
      await connect({
        address,
        nickname: nickname.trim() || undefined,
        serverPassword: serverPassword || undefined,
        credentials: mode === "signin" ? { username: username.trim(), password } : undefined,
      });
      setPassword("");
      setServerPassword("");
    } catch {
      // The store records the failure and the screen renders it.
    }
  }

  async function connectSaved(id: string, rawAddress: string) {
    setAddress(rawAddress);
    try {
      await connect({ address: rawAddress });
    } catch {
      // Rendered from the store. The entry stays so it can be retried.
      void id;
    }
  }

  return (
    <div className="connect">
      <aside className="connect__list">
        <div className="connect__brand">
          <span style={{ color: "var(--accent)" }}>
            <AuralMark size={24} />
          </span>
          <span className="connect__wordmark">Aural</span>
        </div>

        <div className="connect__saved">
          {saved.length === 0 ? (
            <p className="connect__empty">
              No servers yet. Enter an address to connect to one.
            </p>
          ) : (
            saved.map((server) => (
              <div key={server.id} className="saved">
                <button
                  className="saved__main"
                  onClick={() => void connectSaved(server.id, server.address)}
                  disabled={busy}
                >
                  <span className="saved__badge">{server.name.slice(0, 2).toUpperCase()}</span>
                  <span className="saved__body">
                    <span className="saved__name">{server.name}</span>
                    <span className="saved__address">{server.id}</span>
                  </span>
                </button>
                <button
                  className="saved__forget"
                  onClick={() => forget(server.id)}
                  aria-label={`Forget ${server.name}`}
                  title="Forget this server"
                >
                  <TrashIcon size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="connect__panel">
        <form className="connect__form" onSubmit={(event) => void submit(event)}>
          <div>
            <h1 className="connect__title">Connect to a server</h1>
            <p className="connect__subtitle">
              Aural servers are self-hosted. Enter the address of one you have been given.
            </p>
          </div>

          {error ? <p className="alert">{error}</p> : null}

          <div className="field">
            <label className="field__label" htmlFor="address">
              Server address
            </label>
            <input
              id="address"
              className="input"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={`192.168.1.20:${DEFAULT_PORT}`}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              required
            />
            <span className="field__hint">
              Port {DEFAULT_PORT} is assumed when you leave it out.
            </span>
          </div>

          {preview ? <ServerPreview info={preview} /> : null}

          <div className="tabs" style={{ padding: 0 }}>
            <button
              type="button"
              className={mode === "guest" ? "tab tab--active" : "tab"}
              onClick={() => setMode("guest")}
            >
              Join as guest
            </button>
            <button
              type="button"
              className={mode === "signin" ? "tab tab--active" : "tab"}
              onClick={() => setMode("signin")}
            >
              Sign in
            </button>
          </div>

          {mode === "guest" ? (
            <div className="field">
              <label className="field__label" htmlFor="nickname">
                Nickname
              </label>
              <input
                id="nickname"
                className="input"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Guest"
                maxLength={32}
                autoComplete="nickname"
              />
              <span className="field__hint">
                You can claim this identity with a username and password once you are in.
              </span>
            </div>
          ) : (
            <>
              <div className="field">
                <label className="field__label" htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  className="input"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </>
          )}

          {preview?.passwordProtected ? (
            <div className="field">
              <label className="field__label" htmlFor="server-password">
                Server password
              </label>
              <input
                id="server-password"
                className="input"
                type="password"
                value={serverPassword}
                onChange={(event) => setServerPassword(event.target.value)}
                autoComplete="off"
                required
              />
              <span className="field__hint">This server is password protected.</span>
            </div>
          ) : null}

          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {busy ? "Connecting" : "Connect"}
          </button>
        </form>
      </main>
    </div>
  );
}

function ServerPreview({ info }: { info: ServerInfo }) {
  return (
    <div className="preview">
      <div className="preview__head">
        <div>
          <div className="preview__name">{info.name}</div>
          {info.description ? <div className="preview__desc">{info.description}</div> : null}
        </div>
        <Avatar user={{ id: info.name.length, nickname: info.name }} size="md" />
      </div>
      <div className="preview__facts">
        <span className="tag">
          {info.onlineUsers}/{info.maxUsers} online
        </span>
        <span className="tag">
          {info.voiceMode === "client_host" ? "User-hosted voice" : "Server-hosted voice"}
        </span>
        {info.passwordProtected ? <span className="tag">Password</span> : null}
        {!info.guestsAllowed ? <span className="tag">Accounts only</span> : null}
        {!info.registrationEnabled ? <span className="tag">Registration closed</span> : null}
        <span className="tag">v{info.softwareVersion}</span>
      </div>
    </div>
  );
}
