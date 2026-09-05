import { useEffect, useState } from "react";
import { onNativeActivityState, readNativeActivityState } from "@/lib/activity";
import { useTranslation } from "@/lib/i18n";
import { nativeActivitySupported } from "@/lib/nativeActivity";
import { describeError, type DMPrivacy } from "@/lib/protocol";
import { useSession } from "@/store/session";
import {
  AUTO_AWAY_MINUTES,
  readActivity,
  readPresence,
  writeActivity,
  writePresence,
} from "@/lib/storage";

export function PrivacyPage() {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const server = useSession((state) => state.server);
  const setDMPrivacy = useSession((state) => state.setDMPrivacy);

  const privacy: DMPrivacy = self?.dmPrivacy ?? "everyone";
  const allowed = privacy !== "none";
  // Which door to reopen when the switch goes back on. Somebody who narrowed
  // it to registered members and then turned it off meant the narrowing, not
  // "everyone from now on".
  const [lastScope, setLastScope] = useState<Exclude<DMPrivacy, "none">>(
    privacy === "registered" ? "registered" : "everyone",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A server can carry no private conversations at all. The setting still
  // means something the moment somebody connects to one that does, so it is
  // shown and disabled rather than hidden.
  const supported = server?.directMessages ?? false;

  const [telemetry, setTelemetry] = useState(false);
  const [embeds, setEmbeds] = useState(true);
  const [presence, setPresence] = useState(readPresence);
  const [activity, setActivity] = useState(readActivity);

  // What the shell says this machine can actually do. It changes underneath
  // the page — the games socket frees up when Discord is closed, and is taken
  // again when it starts — so it is subscribed to rather than read once.
  const [machine, setMachine] = useState(readNativeActivityState);
  useEffect(() => onNativeActivityState(setMachine), []);

  const shellPresent = nativeActivitySupported();
  const mediaSupported = machine?.mediaSupported ?? false;
  const rpc = machine?.rpc.state ?? "off";

  /**
   * What to say about the games socket, and how loudly.
   *
   * The conflict is the case worth interrupting for: it is the one where
   * everything is configured correctly and nothing will ever arrive, because
   * another application on this computer is receiving it instead. Silence
   * there would be indistinguishable from a bug in Aural.
   */
  const socketNotice =
    !activity.share || !activity.games
      ? null
      : rpc === "conflict"
        ? { tone: "alert alert--warning", text: t("dialogs.userSettings.privacy.activityConflict") }
        : rpc === "unsupported"
          ? { tone: "settings-card__subtitle", text: t("dialogs.userSettings.privacy.activityUnsupported") }
          : rpc === "error"
            ? { tone: "alert alert--danger", text: t("dialogs.userSettings.privacy.activityError") }
            : rpc === "listening"
              ? { tone: "settings-card__subtitle", text: t("dialogs.userSettings.privacy.activityListening") }
              : null;

  function choose(next: DMPrivacy) {
    if (next === privacy) return;
    if (next !== "none") setLastScope(next);
    setBusy(true);
    setError(null);
    void setDMPrivacy(next)
      .catch((caught) => setError(describeError(caught)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.privacy.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.privacy.desc")}
        </p>
      </header>

      {error ? <div className="alert alert--danger">{error}</div> : null}

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.privacy.dmTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {supported
                ? t("dialogs.userSettings.privacy.dmDesc")
                : t("dialogs.userSettings.privacy.dmUnsupported")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={allowed}
              disabled={busy || !self}
              onChange={(e) => choose(e.target.checked ? lastScope : "none")}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title">
          {t("dialogs.userSettings.privacy.dmScopeTitle")}
        </h3>
        <p className="settings-card__subtitle">
          {t("dialogs.userSettings.privacy.dmScopeDesc")}
        </p>
        <div className="settings-radio-group" style={{ marginTop: 12 }}>
          {(
            [
              ["everyone", "dmEveryone", "dmEveryoneDesc"],
              ["registered", "dmRegistered", "dmRegisteredDesc"],
            ] as const
          ).map(([scope, label, hint]) => (
            <label
              key={scope}
              className={
                privacy === scope
                  ? "settings-radio-card settings-radio-card--active"
                  : "settings-radio-card"
              }
            >
              <input
                type="radio"
                name="dm-scope"
                checked={privacy === scope}
                disabled={busy || !allowed || !self}
                onChange={() => choose(scope)}
              />
              <span className="settings-radio-card__body">
                <span className="settings-radio-card__title">
                  {t(`dialogs.userSettings.privacy.${label}`)}
                </span>
                <span className="settings-card__subtitle">
                  {t(`dialogs.userSettings.privacy.${hint}`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.privacy.autoAwayTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.privacy.autoAwayDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={presence.autoAway}
              onChange={(e) => setPresence(writePresence({ autoAway: e.target.checked }))}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        {presence.autoAway ? (
          <div className="settings-row" style={{ marginTop: 16 }}>
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.privacy.autoAwayAfter")}
              </h3>
            </div>
            <select
              className="input"
              style={{ width: 160 }}
              value={presence.autoAwayMinutes}
              onChange={(e) =>
                setPresence(writePresence({ autoAwayMinutes: Number(e.target.value) }))
              }
            >
              {AUTO_AWAY_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t("dialogs.userSettings.privacy.autoAwayMinutes", { minutes })}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.privacy.activityTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {shellPresent
                ? t("dialogs.userSettings.privacy.activityDesc")
                : t("dialogs.userSettings.privacy.activityBrowser")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={activity.share}
              disabled={!shellPresent}
              onChange={(e) => setActivity(writeActivity({ share: e.target.checked }))}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        {/* The three below only mean anything once the one above is on, so
            they are hidden rather than shown disabled: a switch that does
            nothing is a worse answer than no switch. */}
        {shellPresent && activity.share ? (
          <>
            <div
              className="settings-row"
              style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}
            >
              <div className="settings-row__info">
                <h3 className="settings-card__title">
                  {t("dialogs.userSettings.privacy.activityMediaTitle")}
                </h3>
                <p className="settings-card__subtitle">
                  {mediaSupported
                    ? t("dialogs.userSettings.privacy.activityMediaDesc")
                    : t("dialogs.userSettings.privacy.activityMediaUnsupported")}
                </p>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={activity.media && mediaSupported}
                  disabled={!mediaSupported}
                  onChange={(e) => setActivity(writeActivity({ media: e.target.checked }))}
                />
                <span className="settings-switch__slider" />
              </label>
            </div>

            <div className="settings-row" style={{ marginTop: 16 }}>
              <div className="settings-row__info">
                <h3 className="settings-card__title">
                  {t("dialogs.userSettings.privacy.activityGamesTitle")}
                </h3>
                <p className="settings-card__subtitle">
                  {t("dialogs.userSettings.privacy.activityGamesDesc")}
                </p>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={activity.games}
                  onChange={(e) => setActivity(writeActivity({ games: e.target.checked }))}
                />
                <span className="settings-switch__slider" />
              </label>
            </div>

            {socketNotice ? (
              <div style={{ marginTop: 12 }}>
                <span className="settings-card__label">
                  {t("dialogs.userSettings.privacy.activityStatus")}
                </span>
                <div className={socketNotice.tone} style={{ marginTop: 6 }}>
                  {socketNotice.text}
                </div>
              </div>
            ) : null}

            <div className="settings-row" style={{ marginTop: 16 }}>
              <div className="settings-row__info">
                <h3 className="settings-card__title">
                  {t("dialogs.userSettings.privacy.activityArtworkTitle")}
                </h3>
                <p className="settings-card__subtitle">
                  {t("dialogs.userSettings.privacy.activityArtworkDesc")}
                </p>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={activity.artwork}
                  onChange={(e) => setActivity(writeActivity({ artwork: e.target.checked }))}
                />
                <span className="settings-switch__slider" />
              </label>
            </div>
          </>
        ) : null}
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.privacy.embedsTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.privacy.embedsDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={embeds}
              onChange={(e) => setEmbeds(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.privacy.dataTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.privacy.dataDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={telemetry}
              onChange={(e) => setTelemetry(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>
    </div>
  );
}
