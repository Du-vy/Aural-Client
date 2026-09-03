import { useEffect, useState, type FormEvent } from "react";

import { Avatar } from "@/components/Avatar";
import { AuralMark, TrashIcon } from "@/components/Icons";
import { LanguageSelector } from "@/components/LanguageSelector";
import { DEFAULT_PORT, fetchServerInfo, parseAddress } from "@/lib/address";
import { useTranslation } from "@/lib/i18n";
import type { ServerInfo } from "@/lib/protocol";
import type { SavedServer } from "@/lib/storage";
import { resolveServerIconUrl } from "@/lib/uploads";
import { useServerRegistry, useServers } from "@/store/servers";

type Mode = "guest" | "signin";

/**
 * The connect screen. Servers are reached by address, so this is the closest
 * thing Aural has to a home page: pick a saved one, or type where to go.
 *
 * It reads the registry rather than any one connection, because it is the one
 * screen that is about all of them: which are open, which is being dialled,
 * and what went wrong with the last attempt.
 */
export function ConnectView() {
  const { t } = useTranslation();
  const saved = useServerRegistry((state) => state.saved);
  const openConnections = useServerRegistry((state) => state.connections);
  const dialing = useServerRegistry((state) => state.dialing);
  const error = useServerRegistry((state) => state.error);
  const notice = useServerRegistry((state) => state.notice);
  const connect = useServers.getState().connect;
  const forget = useServers.getState().forget;

  const [address, setAddress] = useState("");
  const [nickname, setNickname] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("guest");
  const [preview, setPreview] = useState<ServerInfo | null>(null);

  const busy = dialing.length > 0;

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
              {t("connect.savedEmpty")}
            </p>
          ) : (
            saved.map((server) => (
              <div key={server.id} className="saved">
                <button
                  className="saved__main"
                  onClick={() => void connectSaved(server.id, server.address)}
                  disabled={dialing.includes(server.id)}
                >
                  <SavedServerBadge server={server} />
                  <span className="saved__body">
                    <span className="saved__name" title={server.name}>{server.name}</span>
                    <span className="saved__address" title={server.address || server.id}>{server.address || server.id}</span>
                  </span>
                  {/* A server already open is one click from being looked at,
                      not one handshake: clicking it brings it to the front. */}
                  {dialing.includes(server.id) ? (
                    <span className="spinner" />
                  ) : openConnections.has(server.id) ? (
                    <span className="saved__open">{t("connect.openHere")}</span>
                  ) : null}
                </button>
                <button
                  className="saved__forget"
                  onClick={() => forget(server.id)}
                  aria-label={`${t("common.delete")} ${server.name}`}
                  title={t("connect.removeSaved")}
                >
                  <TrashIcon size={15} />
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", justifyContent: "center" }}>
          <LanguageSelector compact={false} />
        </div>
      </aside>

      <main className="connect__panel">
        <form className="connect__form" onSubmit={(event) => void submit(event)}>
          <div>
            <h1 className="connect__title">{t("connect.title")}</h1>
            <p className="connect__subtitle">
              {t("connect.subtitle")}
            </p>
          </div>

          {error ?? notice ? <p className="alert">{error ?? notice}</p> : null}

          <div className="field">
            <label className="field__label" htmlFor="address">
              {t("connect.addressLabel")}
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

          {preview ? <ServerPreview info={preview} address={address} /> : null}

          <div className="tabs" style={{ padding: 0 }}>
            <button
              type="button"
              className={mode === "guest" ? "tab tab--active" : "tab"}
              onClick={() => setMode("guest")}
            >
              {t("connect.joinAsGuest")}
            </button>
            <button
              type="button"
              className={mode === "signin" ? "tab tab--active" : "tab"}
              onClick={() => setMode("signin")}
            >
              {t("connect.signIn")}
            </button>
          </div>

          {mode === "guest" ? (
            <div className="field">
              <label className="field__label" htmlFor="nickname">
                {t("connect.nicknameLabel")}
              </label>
              <input
                id="nickname"
                className="input"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder={t("common.guest")}
                maxLength={32}
                autoComplete="nickname"
              />
              <span className="field__hint">
                {t("dialogs.account.guestNoticeDesc")}
              </span>
            </div>
          ) : (
            <>
              <div className="field">
                <label className="field__label" htmlFor="username">
                  {t("connect.usernameLabel")}
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
                  {t("connect.passwordLabel")}
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
                {t("connect.serverPasswordLabel")}
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
              <span className="field__hint">{t("connect.serverPasswordPlaceholder")}</span>
            </div>
          ) : null}

          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {busy ? t("connect.connecting") : t("connect.connectButton")}
          </button>
        </form>
      </main>
    </div>
  );
}

function SavedServerBadge({ server }: { server: SavedServer }) {
  const [error, setError] = useState(false);
  const iconUrl = server.icon ? resolveServerIconUrl(server.icon, server.address) : null;

  return (
    <span className="saved__badge">
      {iconUrl && !error ? (
        <img
          className="saved__badge-img"
          src={iconUrl}
          alt={server.name}
          onError={() => setError(true)}
        />
      ) : (
        server.name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

function ServerPreview({ info, address }: { info: ServerInfo; address?: string }) {
  const { t } = useTranslation();
  const iconUrl = info.icon ? resolveServerIconUrl(info.icon, address) : null;
  return (
    <div className="preview">
      <div className="preview__head">
        <div>
          <div className="preview__name">{info.name}</div>
          {info.description ? <div className="preview__desc">{info.description}</div> : null}
        </div>
        <Avatar user={{ id: info.name.length, nickname: info.name, avatar: iconUrl }} size="md" />
      </div>
      <div className="preview__facts">
        <span className="tag">
          {t("connect.onlineCount", { online: info.onlineUsers, max: info.maxUsers })}
        </span>
        <span className="tag">
          {info.voiceMode === "client_host" ? t("connect.voiceModeClient") : t("connect.voiceModeServer")}
        </span>
        {info.passwordProtected ? <span className="tag">{t("connect.serverPasswordLabel")}</span> : null}
        {!info.guestsAllowed ? <span className="tag">{t("errors.guests_disabled")}</span> : null}
        {!info.registrationEnabled ? <span className="tag">{t("errors.registration_closed")}</span> : null}
        <span className="tag">{t("connect.version", { version: info.softwareVersion })}</span>
      </div>
    </div>
  );
}

