import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { describeError, type DMPrivacy } from "@/lib/protocol";
import { useSession } from "@/store/session";

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
