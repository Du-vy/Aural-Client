import { useState } from "react";

import { VolumeIcon } from "@/components/Icons";
import { useTranslation } from "@/lib/i18n";
import {
  desktopNotificationsSupported,
  requestNotificationPermission,
  resetNotificationPermission,
} from "@/lib/notifications";
import {
  NOTIFICATION_SOUNDS,
  playNotificationSound,
  type NotificationSoundId,
} from "@/lib/notificationSounds";
import {
  readNotifications,
  writeNotifications,
  type NotificationScope,
  type NotificationSettings,
} from "@/lib/storage";

/** The three answers to "what is worth interrupting me for", in that order. */
const SCOPES: readonly NotificationScope[] = ["all", "mentions", "none"];

export function NotificationsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<NotificationSettings>(readNotifications);
  /**
   * Set when the operating system has refused. It is worth saying out loud:
   * every switch on this page can be on and nothing will appear, and the only
   * place that can be fixed is outside the client.
   */
  const [blocked, setBlocked] = useState(false);

  const update = (patch: Partial<NotificationSettings>) => {
    setSettings(writeNotifications(patch));
  };

  /**
   * Turning toasts on is the moment to ask for them: it is a click, which is
   * the only thing a browser will accept a permission prompt from, and it is
   * also the only moment somebody is expecting to be asked.
   */
  const setDesktop = (enabled: boolean) => {
    update({ desktop: enabled });
    if (!enabled) {
      setBlocked(false);
      return;
    }
    resetNotificationPermission();
    void requestNotificationPermission().then((granted) => setBlocked(!granted));
  };

  /** Selecting a sound plays it, because that is the question being asked. */
  const chooseSound = (sound: NotificationSoundId) => {
    update({ sound });
    void playNotificationSound(sound, settings.soundVolume);
  };

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.notifications.title")}
        </h2>
        <p className="settings-section__desc">{t("dialogs.userSettings.notifications.desc")}</p>
      </header>

      {/* What leaves the window */}
      <div className="settings-group">
        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.notifications.desktopTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.notifications.desktopDesc")}
              </p>
              {blocked || !desktopNotificationsSupported() ? (
                <p className="field__error" style={{ marginTop: 6 }}>
                  {t("dialogs.userSettings.notifications.blocked")}
                </p>
              ) : null}
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.desktop}
                onChange={(e) => setDesktop(e.target.checked)}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>

        <div className="settings-group__item">
          <h3 className="settings-card__title">
            {t("dialogs.userSettings.notifications.scopeTitle")}
          </h3>
          <p className="settings-card__subtitle">
            {t("dialogs.userSettings.notifications.scopeDesc")}
          </p>
          <div className="settings-radio-group" style={{ marginTop: 12 }}>
            {SCOPES.map((scope) => (
              <label
                key={scope}
                className={`settings-radio-card ${
                  settings.scope === scope ? "settings-radio-card--active" : ""
                }`}
              >
                <input
                  type="radio"
                  name="notification-scope"
                  checked={settings.scope === scope}
                  onChange={() => update({ scope })}
                />
                <span className="settings-radio-card__body">
                  <span className="settings-radio-card__title">
                    {t(`dialogs.userSettings.notifications.scope_${scope}`)}
                  </span>
                  <span className="settings-card__subtitle">
                    {t(`dialogs.userSettings.notifications.scope_${scope}Desc`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.notifications.directTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.notifications.directDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.directMessages}
                onChange={(e) => update({ directMessages: e.target.checked })}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>

        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.notifications.previewTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.notifications.previewDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.preview}
                onChange={(e) => update({ preview: e.target.checked })}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>
      </div>

      {/* Sound */}
      <div className="settings-group" style={{ marginTop: 20 }}>
        <div className="settings-group__item">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.notifications.soundTitle")}
            </h3>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ padding: "2px 8px", fontSize: 12, height: 26 }}
              onClick={() => void playNotificationSound(settings.sound, settings.soundVolume)}
            >
              <VolumeIcon size={13} />
              {t("dialogs.userSettings.notifications.test")}
            </button>
          </div>
          <p className="settings-card__subtitle">
            {t("dialogs.userSettings.notifications.soundDesc")}
          </p>

          <div className="settings-radio-group" style={{ marginTop: 12 }}>
            {NOTIFICATION_SOUNDS.map((sound) => (
              <label
                key={sound.id}
                className={`settings-radio-card ${
                  settings.sound === sound.id ? "settings-radio-card--active" : ""
                }`}
              >
                <input
                  type="radio"
                  name="notification-sound"
                  checked={settings.sound === sound.id}
                  onChange={() => chooseSound(sound.id)}
                />
                <span className="settings-radio-card__body">
                  <span className="settings-radio-card__title">
                    {t(`dialogs.userSettings.notifications.sound_${sound.id}`)}
                  </span>
                  <span className="settings-card__subtitle">
                    {t(`dialogs.userSettings.notifications.sound_${sound.id}Desc`)}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="theme-slider-box" style={{ marginTop: 16 }}>
            <div className="theme-slider-header">
              <span className="field__label">
                {t("dialogs.userSettings.notifications.volume")}
              </span>
              <span className="field__hint">{Math.round(settings.soundVolume * 100)}%</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={100}
              value={Math.round(settings.soundVolume * 100)}
              disabled={settings.sound === "none"}
              onChange={(e) => update({ soundVolume: Number(e.target.value) / 100 })}
              // The fader is the one control worth hearing while it moves, so
              // the sound plays when it is let go rather than on every step.
              onPointerUp={() => void playNotificationSound(settings.sound, settings.soundVolume)}
            />
          </div>
        </div>
      </div>

      {/* The icon in the taskbar */}
      <div className="settings-group" style={{ marginTop: 20 }}>
        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.notifications.badgeTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.notifications.badgeDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.taskbarBadge}
                onChange={(e) => update({ taskbarBadge: e.target.checked })}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>

        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.notifications.flashTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.notifications.flashDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.flashOnMention}
                onChange={(e) => update({ flashOnMention: e.target.checked })}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
