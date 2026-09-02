import { useState } from "react";
import { useTranslation } from "@/lib/i18n";

export function StartupPage() {
  const { t } = useTranslation();
  const [startup, setStartup] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [hwAccel, setHwAccel] = useState(true);

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.startup.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.startup.desc")}
        </p>
      </header>

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
              checked={startup}
              onChange={(e) => setStartup(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.startMinimized")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.startMinimizedDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={minimized}
              onChange={(e) => setMinimized(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.minimizeToTray")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.minimizeToTrayDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={closeToTray}
              onChange={(e) => setCloseToTray(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.notifications")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.notificationsDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={notifications}
              onChange={(e) => setNotifications(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>

        <div className="settings-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.startup.hardwareAcceleration")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.startup.hardwareAccelerationDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={hwAccel}
              onChange={(e) => setHwAccel(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>
    </div>
  );
}
