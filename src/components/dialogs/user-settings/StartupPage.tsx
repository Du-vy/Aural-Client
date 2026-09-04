import { useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import {
  readSystemSettings,
  restartApp,
  systemSettingsSupported,
  writeSystemSettings,
  type SystemSettings,
  type SystemSettingsReport,
} from "@/lib/systemSettings";
import { checkForUpdate, useUpdateState } from "@/lib/updater";

/**
 * The system settings page.
 *
 * Every switch here is held by the shell or by the operating system rather
 * than by the client, so the page is asynchronous in both directions: it has
 * nothing to draw until the shell has answered, and a change is only reflected
 * once the shell has said it happened. A registry write can be refused, and a
 * switch that moved anyway would be lying about the state of the machine.
 */
export function StartupPage() {
  const { t } = useTranslation();
  const updateState = useUpdateState();

  /** Null until the shell has answered, and in a browser for good. */
  const [state, setState] = useState<SystemSettingsReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** Set when the shell refused a change, cleared by the next one. */
  const [failed, setFailed] = useState(false);
  /**
   * Set once the GPU setting has been touched. The engine read that when it
   * started, so what is stored and what is running have diverged until a
   * restart, and the page has to say so rather than imply it took effect.
   */
  const [restartNeeded, setRestartNeeded] = useState(false);
  /**
   * Set once a check from this page has finished.
   *
   * Without it "Aural is up to date" would be sitting there the moment the
   * page opens, which is not something anything has checked: the state is
   * `idle` before the first look and after a look that found nothing, and only
   * the second of those is an answer.
   */
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let live = true;
    void readSystemSettings().then((report) => {
      if (!live) return;
      setState(report);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const update = (patch: Partial<SystemSettings>) => {
    setFailed(false);
    void writeSystemSettings(patch)
      .then((report) => {
        setState(report);
        if (patch.hardwareAcceleration !== undefined) setRestartNeeded(true);
      })
      .catch(() => {
        setFailed(true);
        // The switch has to end up showing the machine rather than the click,
        // so what is drawn comes from asking again, not from assuming the
        // change was undone.
        void readSystemSettings().then((report) => {
          if (report) setState(report);
        });
      });
  };

  if (!systemSettingsSupported() || (loaded && !state)) {
    return (
      <div className="settings-section">
        <Header />
        <p className="alert alert--info">{t("dialogs.userSettings.startup.desktopOnly")}</p>
      </div>
    );
  }

  // Nothing is drawn before the shell has answered: switches rendered from a
  // guess and corrected a moment later would flicker through a state that was
  // never true.
  if (!state) {
    return (
      <div className="settings-section">
        <Header />
      </div>
    );
  }

  return (
    <div className="settings-section">
      <Header />

      {failed ? (
        <p className="alert alert--danger">{t("dialogs.userSettings.startup.failed")}</p>
      ) : null}

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.launchOnStartup")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.launchOnStartupDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={state.launchOnStartup}
              onChange={(e) => update({ launchOnStartup: e.target.checked })}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div
          className="settings-row"
          style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}
        >
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.startMinimized")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.startMinimizedDesc")}
            </p>
            {!state.trayAvailable ? (
              <p className="field__error" style={{ marginTop: 6 }}>
                {t("dialogs.userSettings.startup.trayUnavailable")}
              </p>
            ) : null}
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={state.startMinimized}
              disabled={!state.trayAvailable}
              onChange={(e) => update({ startMinimized: e.target.checked })}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div
          className="settings-row"
          style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}
        >
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.minimizeToTray")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.minimizeToTrayDesc")}
            </p>
            {/* The same reason as above, said again rather than said once: this
                switch is disabled too, and a disabled switch with the
                explanation two rows away explains nothing. */}
            {!state.trayAvailable ? (
              <p className="field__error" style={{ marginTop: 6 }}>
                {t("dialogs.userSettings.startup.trayUnavailable")}
              </p>
            ) : null}
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={state.closeToTray}
              disabled={!state.trayAvailable}
              onChange={(e) => update({ closeToTray: e.target.checked })}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.hardwareAcceleration")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.hardwareAccelerationDesc")}
            </p>
            {!state.hardwareAccelerationSupported ? (
              <p className="field__error" style={{ marginTop: 6 }}>
                {t("dialogs.userSettings.startup.hardwareAccelerationUnavailable")}
              </p>
            ) : null}
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={state.hardwareAcceleration}
              disabled={!state.hardwareAccelerationSupported}
              onChange={(e) => update({ hardwareAcceleration: e.target.checked })}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        {restartNeeded ? (
          <div
            className="settings-row"
            style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}
          >
            <div className="settings-row__info">
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.startup.restartRequired")}
              </p>
            </div>
            <button type="button" className="btn btn--primary" onClick={() => void restartApp()}>
              {t("dialogs.userSettings.startup.restartNow")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.autoUpdate")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.autoUpdateDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={state.autoUpdate}
              onChange={(e) => update({ autoUpdate: e.target.checked })}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        {/* Offered whether the switch is on or off. Somebody who turned the
            startup check off has not given up on ever updating; they have said
            they would rather decide when to look. */}
        <div
          className="settings-row"
          style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}
        >
          <div className="settings-row__info">
            {/* Only the two outcomes a person standing at this button is owed.
                Everything else the check can be doing — found one, downloading
                it, ready to restart — is the banner's to say, and saying it
                twice would leave two things to click for one update. */}
            {checked && updateState.phase === "idle" ? (
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.startup.upToDate")}
              </p>
            ) : null}
            {updateState.phase === "failed" && updateState.where === "check" ? (
              <p className="field__error">{t("dialogs.userSettings.startup.checkFailed")}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn"
            disabled={updateState.phase === "checking"}
            onClick={() => void checkForUpdate(true).then(() => setChecked(true))}
          >
            {updateState.phase === "checking"
              ? t("dialogs.userSettings.startup.checking")
              : t("dialogs.userSettings.startup.checkNow")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Drawn by all three of the states above, including the two with no switches. */
function Header() {
  const { t } = useTranslation();
  return (
    <header className="settings-section__header">
      <h2 className="settings-section__title">{t("dialogs.userSettings.startup.title")}</h2>
      <p className="settings-section__desc">{t("dialogs.userSettings.startup.desc")}</p>
    </header>
  );
}
