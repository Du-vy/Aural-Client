import { useState } from "react";
import { useTranslation } from "@/lib/i18n";

export function PrivacyPage() {
  const { t } = useTranslation();
  const [allowDMs, setAllowDMs] = useState(true);
  const [telemetry, setTelemetry] = useState(false);
  const [embeds, setEmbeds] = useState(true);
  const [friendScope, setFriendScope] = useState<"everyone" | "mutual">("everyone");

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

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__info">
            <h3 className="settings-card__title">
              {t("dialogs.userSettings.privacy.dmTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.userSettings.privacy.dmDesc")}
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={allowDMs}
              onChange={(e) => setAllowDMs(e.target.checked)}
            />
            <span className="settings-switch__slider" />
          </label>
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title">
          {t("dialogs.userSettings.privacy.friendRequestsTitle")}
        </h3>
        <div className="settings-radio-group" style={{ marginTop: 12 }}>
          <label className={`settings-radio-card ${friendScope === "everyone" ? "settings-radio-card--active" : ""}`}>
            <input
              type="radio"
              name="friend-scope"
              checked={friendScope === "everyone"}
              onChange={() => setFriendScope("everyone")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.privacy.friendEveryone")}
              </span>
            </span>
          </label>

          <label className={`settings-radio-card ${friendScope === "mutual" ? "settings-radio-card--active" : ""}`}>
            <input
              type="radio"
              name="friend-scope"
              checked={friendScope === "mutual"}
              onChange={() => setFriendScope("mutual")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.privacy.friendMutual")}
              </span>
            </span>
          </label>
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
