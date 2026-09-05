import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import {
  DiscordChannelType,
  describeError,
  isDiscordThread,
  type RelayDirection,
  type RelayLink,
} from "@/lib/protocol";
import { formatDateTime } from "@/lib/time";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { ConfirmDialog } from "../ConfirmDialog";
import { AnimatedImage } from "../../AnimatedImage";
import { HashIcon, LinkIcon, PlusIcon, TrashIcon } from "../../Icons";

/**
 * The Discord relay.
 *
 * The screen is arranged around the order somebody actually does this in:
 * connect a bot first, then confirm it can see the right servers, then bridge
 * channels one at a time. The steps are on the page rather than in
 * documentation because the two ways this is misconfigured — a token that is
 * not a bot token, and the message content intent left switched off — both
 * happen in Discord's own interface, before anything is typed here, and both
 * produce a bridge that connects and carries nothing.
 *
 * Nothing on this page is shown to anybody without Manage Server. A link
 * carries a webhook URL, which is a standing permission to post into somebody
 * else's Discord channel.
 */
export function ServerRelayPage() {
  const { t } = useTranslation();
  const relay = useSession((state) => state.relay);
  const loadRelay = useSession((state) => state.loadRelay);
  const permissions = useMyPermissions();

  const allowed = has(permissions, Perm.ManageServer);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    loadRelay().catch((failure: unknown) => setError(describeError(failure)));
  }, [allowed, loadRelay]);

  if (!allowed) {
    return (
      <div className="settings-section">
        <header className="settings-section__header">
          <h2 className="settings-section__title">{t("dialogs.serverSettings.relay.title")}</h2>
          <p className="settings-section__desc">
            {t("dialogs.serverSettings.relay.noPermission")}
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.serverSettings.relay.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.serverSettings.relay.desc")}</p>
      </header>

      {error ? <p className="webhook-card__error">{error}</p> : null}

      <RelayConnectionCard />
      {relay?.configured ? <RelayLinksCard /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The bot                                                                    */
/* -------------------------------------------------------------------------- */

function RelayConnectionCard() {
  const { t } = useTranslation();
  const relay = useSession((state) => state.relay);
  const configureRelay = useSession((state) => state.configureRelay);

  // Write-only, exactly as the Klipy key is: the server says whether a token
  // is stored and never what it is, so the box starts empty and saving
  // replaces whatever is there.
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const configured = relay?.configured ?? false;
  const enabled = relay?.enabled ?? false;
  const connected = relay?.connected ?? false;

  async function apply(nextEnabled: boolean, nextToken?: string) {
    setBusy(true);
    setError(null);
    try {
      await configureRelay(nextEnabled, nextToken);
      setToken("");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function handleSave(event: FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    // Saving a token for the first time switches the relay on: nobody pastes a
    // bot token in order to leave it switched off.
    void apply(configured ? enabled : true, trimmed);
  }

  // Four states, and the screen has to tell them apart: no token yet, a token
  // but switched off, switched on and reaching, and reached. "Connecting" is
  // also what a relay that is failing to connect shows, which is why the
  // reason underneath it is not optional.
  const status = !configured
    ? { label: t("dialogs.serverSettings.relay.statusUnconfigured"), tone: "idle" }
    : !enabled
      ? { label: t("dialogs.serverSettings.relay.statusOff"), tone: "idle" }
      : connected
        ? {
            label: relay?.botName
              ? t("dialogs.serverSettings.relay.statusConnectedAs", { bot: relay.botName })
              : t("dialogs.serverSettings.relay.statusConnected"),
            tone: "good",
          }
        : { label: t("dialogs.serverSettings.relay.statusConnecting"), tone: "warn" };

  return (
    <div className="settings-card settings-card--integration">
      <div className="settings-card__header">
        <div className="settings-card__header-info">
          <div className="relay-card__service">
            <span className="settings-card__service-icon relay-card__icon">
              <LinkIcon size={20} />
            </span>
            <div>
              <h3 className="settings-card__title relay-card__heading">
                {t("dialogs.serverSettings.relay.botTitle")}
              </h3>
              <span className={`relay-status relay-status--${status.tone}`}>{status.label}</span>
            </div>
          </div>
          <p className="settings-card__subtitle relay-card__desc">
            {t("dialogs.serverSettings.relay.botDesc")}
          </p>
        </div>
      </div>

      {/* Whatever the last connection failed with, in the words it failed in.
          An intent that was never switched on says so here, which is the
          difference between a five-minute fix and an afternoon. */}
      {relay?.error && enabled ? <p className="relay-card__failure">{relay.error}</p> : null}

      <button
        type="button"
        className="relay-steps__toggle"
        onClick={() => setShowSteps((open) => !open)}
      >
        {showSteps
          ? t("dialogs.serverSettings.relay.hideSetup")
          : t("dialogs.serverSettings.relay.showSetup")}
      </button>

      {showSteps ? (
        <ol className="relay-steps">
          <li>{t("dialogs.serverSettings.relay.step1")}</li>
          <li>{t("dialogs.serverSettings.relay.step2")}</li>
          <li className="relay-steps__critical">{t("dialogs.serverSettings.relay.step3")}</li>
          <li>{t("dialogs.serverSettings.relay.step4")}</li>
          <li>{t("dialogs.serverSettings.relay.step5")}</li>
        </ol>
      ) : null}

      <form onSubmit={handleSave} className="relay-card__form">
        <div className="field">
          <label className="field__label" htmlFor="relay-bot-token">
            {t("dialogs.serverSettings.relay.tokenLabel")}
          </label>
          <input
            id="relay-bot-token"
            type="password"
            className="input relay-card__token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={
              configured
                ? t("dialogs.serverSettings.relay.tokenStored")
                : t("dialogs.serverSettings.relay.tokenPlaceholder")
            }
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="field__hint">{t("dialogs.serverSettings.relay.tokenHint")}</p>
        </div>

        {error ? <p className="webhook-card__error">{error}</p> : null}

        <div className="relay-card__actions">
          {configured ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void apply(!enabled)}
              disabled={busy}
            >
              {enabled
                ? t("dialogs.serverSettings.relay.turnOff")
                : t("dialogs.serverSettings.relay.turnOn")}
            </button>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={busy || !token.trim()}>
            {busy
              ? t("common.loading")
              : configured
                ? t("dialogs.serverSettings.relay.replaceToken")
                : t("dialogs.serverSettings.relay.saveToken")}
          </button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The links                                                                  */
/* -------------------------------------------------------------------------- */

function RelayLinksCard() {
  const { t } = useTranslation();
  const relay = useSession((state) => state.relay);
  const channels = useSession((state) => state.channels);
  const updateRelayLink = useSession((state) => state.updateRelayLink);
  const deleteRelayLink = useSession((state) => state.deleteRelayLink);

  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RelayLink | null>(null);

  const links = relay?.links ?? [];

  async function patch(link: RelayLink, changes: Partial<RelayLink>) {
    setBusy(true);
    setError(null);
    try {
      await updateRelayLink({ id: link.id, ...changes });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(link: RelayLink) {
    setPendingDelete(null);
    setBusy(true);
    setError(null);
    try {
      await deleteRelayLink(link.id);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-card settings-card--integration">
        <div className="settings-card__header relay-links__header">
          <div className="settings-card__header-info">
            <h3 className="settings-card__title relay-card__heading">
              {t("dialogs.serverSettings.relay.linksTitle")}
            </h3>
            <p className="settings-card__subtitle relay-card__desc">
              {t("dialogs.serverSettings.relay.linksDesc")}
            </p>
          </div>
          {!creating ? (
            <button
              type="button"
              className="btn btn--primary btn--sm relay-links__add"
              onClick={() => setCreating(true)}
              disabled={busy}
            >
              <PlusIcon size={14} />
              {t("dialogs.serverSettings.relay.addLink")}
            </button>
          ) : null}
        </div>

        {error ? <p className="webhook-card__error">{error}</p> : null}

        {links.length === 0 ? (
          <div className="relay-empty">
            <p className="settings-card__subtitle relay-empty__text">
              {t("dialogs.serverSettings.relay.noLinks")}
            </p>
          </div>
        ) : (
          <ul className="webhook-list">
            {links.map((link) => {
              const channel = channels.get(link.channelId);
              return (
                <li key={link.id} className="webhook relay-link">
                  <div className="webhook__row">
                    <span className="webhook__icon" aria-hidden="true">
                      <HashIcon size={16} />
                    </span>
                    <div className="webhook__info">
                      <span className="webhook__name">
                        {channel ? `#${channel.name}` : t("dialogs.serverSettings.relay.unknownChannel")}
                        <span className="relay-link__arrow">{arrowFor(link.direction)}</span>
                        {link.discordChannelName
                          ? `#${link.discordChannelName}`
                          : link.discordChannelId}
                      </span>
                      <span className="webhook__meta">
                        {link.discordGuildName ? `${link.discordGuildName} · ` : ""}
                        {link.lastRelayedAt > 0
                          ? t("dialogs.serverSettings.relay.lastRelayed", {
                              when: formatDateTime(link.lastRelayedAt),
                            })
                          : t("dialogs.serverSettings.relay.neverRelayed")}
                      </span>
                    </div>
                    <div className="webhook__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => void patch(link, { enabled: !link.enabled })}
                        disabled={busy}
                      >
                        {link.enabled
                          ? t("dialogs.serverSettings.relay.pauseLink")
                          : t("dialogs.serverSettings.relay.resumeLink")}
                      </button>
                      <button
                        type="button"
                        className="iconbtn iconbtn--danger"
                        title={t("dialogs.serverSettings.relay.removeLink")}
                        aria-label={t("dialogs.serverSettings.relay.removeLink")}
                        onClick={() => setPendingDelete(link)}
                        disabled={busy}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="relay-link__controls">
                    <label className="relay-link__select">
                      <span>{t("dialogs.serverSettings.relay.directionLabel")}</span>
                      <select
                        className="input"
                        value={link.direction}
                        onChange={(event) =>
                          void patch(link, { direction: event.target.value as RelayDirection })
                        }
                        disabled={busy}
                      >
                        <option value="both">{t("dialogs.serverSettings.relay.directionBoth")}</option>
                        <option value="to_aural">
                          {t("dialogs.serverSettings.relay.directionToAural")}
                        </option>
                        <option value="to_discord">
                          {t("dialogs.serverSettings.relay.directionToDiscord")}
                        </option>
                      </select>
                    </label>
                    <label className="relay-link__check">
                      <input
                        type="checkbox"
                        checked={link.attachments}
                        onChange={(event) =>
                          void patch(link, { attachments: event.target.checked })
                        }
                        disabled={busy}
                      />
                      <span>{t("dialogs.serverSettings.relay.attachmentsLabel")}</span>
                    </label>
                    <label className="relay-link__check">
                      <input
                        type="checkbox"
                        checked={link.edits}
                        onChange={(event) => void patch(link, { edits: event.target.checked })}
                        disabled={busy}
                      />
                      <span>{t("dialogs.serverSettings.relay.editsLabel")}</span>
                    </label>
                  </div>

                  {link.lastError ? (
                    <p className="relay-link__failure">{link.lastError}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {creating ? (
          <RelayLinkForm onDone={() => setCreating(false)} />
        ) : null}
      </div>

      <RelayGuildsCard />

      {pendingDelete ? (
        <ConfirmDialog
          title={t("dialogs.serverSettings.relay.removeLink")}
          subtitle={t("dialogs.serverSettings.relay.removeConfirm")}
          confirmText={t("common.delete")}
          danger
          onConfirm={() => void remove(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </>
  );
}

/** The arrow drawn between the two channel names. */
function arrowFor(direction: RelayDirection): string {
  switch (direction) {
    case "to_discord":
      return " → ";
    case "to_aural":
      return " ← ";
    default:
      return " ↔ ";
  }
}

/* -------------------------------------------------------------------------- */
/* Adding one                                                                 */
/* -------------------------------------------------------------------------- */

function RelayLinkForm({ onDone }: { onDone(): void }) {
  const { t } = useTranslation();
  const channels = useSession((state) => state.channels);
  const relay = useSession((state) => state.relay);
  const createRelayLink = useSession((state) => state.createRelayLink);

  // Only text channels, and only ones nothing is already bridged to: the
  // server refuses a second link on a channel, and offering one that will be
  // refused is a worse experience than not offering it.
  const taken = useMemo(
    () => new Set((relay?.links ?? []).map((link) => link.channelId)),
    [relay],
  );
  const targets = useMemo(
    () =>
      [...channels.values()].filter(
        (channel) => channel.type === "text" && !taken.has(channel.id),
      ),
    [channels, taken],
  );

  const [channelId, setChannelId] = useState<number | null>(targets[0]?.id ?? null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [direction, setDirection] = useState<RelayDirection>("both");
  const [attachments, setAttachments] = useState(true);
  const [edits, setEdits] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (channelId === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createRelayLink({
        channelId,
        webhookUrl: webhookUrl.trim(),
        direction,
        attachments,
        edits,
      });
      onDone();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (targets.length === 0) {
    return (
      <p className="webhook-card__empty">{t("dialogs.serverSettings.relay.noChannelsLeft")}</p>
    );
  }

  return (
    <form className="webhook-form" onSubmit={submit}>
      <div className="field">
        <label className="field__label" htmlFor="relay-channel">
          {t("dialogs.serverSettings.relay.channelLabel")}
        </label>
        <select
          id="relay-channel"
          className="input"
          value={channelId ?? ""}
          onChange={(event) => setChannelId(Number(event.target.value))}
          disabled={busy}
        >
          {targets.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="relay-webhook">
          {t("dialogs.serverSettings.relay.webhookLabel")}
        </label>
        <input
          id="relay-webhook"
          className="input webhook__url-input"
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
          placeholder="https://discord.com/api/webhooks/…"
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
        {/* The webhook names its own channel, so nothing here asks which one:
            pointing a link at a channel the webhook does not post into is a
            mistake that cannot be made rather than one to be warned about. */}
        <p className="field__hint">{t("dialogs.serverSettings.relay.webhookHint")}</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="relay-direction">
          {t("dialogs.serverSettings.relay.directionLabel")}
        </label>
        <select
          id="relay-direction"
          className="input"
          value={direction}
          onChange={(event) => setDirection(event.target.value as RelayDirection)}
          disabled={busy}
        >
          <option value="both">{t("dialogs.serverSettings.relay.directionBoth")}</option>
          <option value="to_aural">{t("dialogs.serverSettings.relay.directionToAural")}</option>
          <option value="to_discord">{t("dialogs.serverSettings.relay.directionToDiscord")}</option>
        </select>
      </div>

      <div className="relay-link__controls">
        <label className="relay-link__check">
          <input
            type="checkbox"
            checked={attachments}
            onChange={(event) => setAttachments(event.target.checked)}
            disabled={busy}
          />
          <span>{t("dialogs.serverSettings.relay.attachmentsLabel")}</span>
        </label>
        <label className="relay-link__check">
          <input
            type="checkbox"
            checked={edits}
            onChange={(event) => setEdits(event.target.checked)}
            disabled={busy}
          />
          <span>{t("dialogs.serverSettings.relay.editsLabel")}</span>
        </label>
      </div>

      {error ? <p className="webhook-card__error">{error}</p> : null}

      <div className="webhook-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onDone} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || !webhookUrl.trim() || channelId === null}
        >
          {busy ? t("common.loading") : t("dialogs.serverSettings.relay.createLink")}
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* What the bot can see                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The Discord servers the bot has been added to.
 *
 * This is diagnostic rather than interactive: a bridge that carries nothing is
 * usually a bot that was never invited, or invited to the wrong server, and
 * that is invisible from anywhere else. Nothing is clickable, because a link
 * is made from a webhook URL and not from a channel name.
 */
function RelayGuildsCard() {
  const { t } = useTranslation();
  const relay = useSession((state) => state.relay);

  if (!relay?.enabled) return null;

  const guilds = relay.guilds ?? [];

  return (
    <div className="settings-card settings-card--integration">
      <h3 className="settings-card__title relay-card__heading">
        {t("dialogs.serverSettings.relay.guildsTitle")}
      </h3>
      <p className="settings-card__subtitle relay-card__desc">
        {t("dialogs.serverSettings.relay.guildsDesc")}
      </p>

      {guilds.length === 0 ? (
        <div className="relay-empty">
          <p className="settings-card__subtitle relay-empty__text">
            {relay.connected
              ? t("dialogs.serverSettings.relay.noGuilds")
              : t("dialogs.serverSettings.relay.guildsWhileOffline")}
          </p>
        </div>
      ) : (
        <ul className="relay-guilds">
          {guilds.map((guild) => (
            <li key={guild.id} className="relay-guild">
              <span className="relay-guild__icon" aria-hidden="true">
                {guild.icon ? (
                  <AnimatedImage src={guild.icon} alt="" referrerPolicy="no-referrer" />
                ) : (
                  guild.name.slice(0, 1).toUpperCase()
                )}
              </span>
              <div className="relay-guild__info">
                <span className="relay-guild__name">{guild.name}</span>
                <span className="relay-guild__channels">
                  {guild.channels
                    .filter((channel) => channel.type !== DiscordChannelType.Category)
                    .map(
                      (channel) =>
                        `${isDiscordThread(channel.type) ? "🧵" : "#"}${channel.name}` +
                        (channel.linked ? " ✓" : ""),
                    )
                    .join("  ")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
