import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import {
  readAccessibility,
  writeAccessibility,
  type AccessibilitySettings,
} from "@/lib/storage";
import { playChime } from "@/lib/audioCues";
import { VolumeIcon } from "@/components/Icons";

export function AccessibilityPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AccessibilitySettings>(readAccessibility);

  const updateSetting = (key: keyof AccessibilitySettings, value: boolean) => {
    const updated = writeAccessibility({ [key]: value });
    setSettings(updated);
  };

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.userSettings.accessibility.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.userSettings.accessibility.desc")}</p>
      </header>

      {/* Group 1: Voice & Channel Navigation */}
      <div className="settings-group">
        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.accessibility.doubleClickTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.accessibility.doubleClickDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.doubleClickToJoinVoice}
                onChange={(e) => updateSetting("doubleClickToJoinVoice", e.target.checked)}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>

        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.accessibility.confirmDisconnectTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.accessibility.confirmDisconnectDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.confirmVoiceDisconnect}
                onChange={(e) => updateSetting("confirmVoiceDisconnect", e.target.checked)}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>

        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 className="settings-card__title">
                  {t("dialogs.userSettings.accessibility.micAudioCuesTitle")}
                </h3>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ padding: "2px 8px", fontSize: 12, height: 26 }}
                  onClick={() => playChime(false)}
                  title={t("dialogs.userSettings.accessibility.testAudioCues")}
                >
                  <VolumeIcon size={13} />
                  {t("dialogs.userSettings.accessibility.testAudioCues")}
                </button>
              </div>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.accessibility.micAudioCuesDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.micAudioCues}
                onChange={(e) => updateSetting("micAudioCues", e.target.checked)}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>
      </div>

      {/* Group 2: Chat & Input Accessibility */}
      <div className="settings-group" style={{ marginTop: 20 }}>
        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.accessibility.sendWithCtrlEnterTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.accessibility.sendWithCtrlEnterDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.sendWithCtrlEnter}
                onChange={(e) => updateSetting("sendWithCtrlEnter", e.target.checked)}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>

        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.accessibility.alwaysUnderlineLinksTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.accessibility.alwaysUnderlineLinksDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.alwaysUnderlineLinks}
                onChange={(e) => updateSetting("alwaysUnderlineLinks", e.target.checked)}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>
      </div>

      {/* Group 3: Vision & Display */}
      <div className="settings-group" style={{ marginTop: 20 }}>
        <div className="settings-group__item">
          <div className="settings-row">
            <div className="settings-row__info">
              <h3 className="settings-card__title">
                {t("dialogs.userSettings.accessibility.reduceTransparencyTitle")}
              </h3>
              <p className="settings-card__subtitle">
                {t("dialogs.userSettings.accessibility.reduceTransparencyDesc")}
              </p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.reduceTransparency}
                onChange={(e) => updateSetting("reduceTransparency", e.target.checked)}
              />
              <span className="settings-switch__slider" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
