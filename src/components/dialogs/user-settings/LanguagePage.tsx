import { useTranslation } from "@/lib/i18n";
import { CheckIcon } from "@/components/Icons";

export function LanguagePage() {
  const { t, language, setLanguage, supportedLanguages } = useTranslation();

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.account.languageSetting")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.account.languageDesc")}
        </p>
      </header>

      <div className="settings-lang-grid">
        {supportedLanguages.map((lang) => {
          const isSelected = lang.code === language;
          return (
            <button
              key={lang.code}
              type="button"
              className={`lang-card ${isSelected ? "lang-card--selected" : ""}`}
              onClick={() => setLanguage(lang.code)}
            >
              <div className="lang-card__info">
                <span className="lang-card__native">{lang.nativeName}</span>
                {lang.name !== lang.nativeName ? (
                  <span className="lang-card__name">{lang.name}</span>
                ) : null}
              </div>
              {isSelected ? (
                <span className="lang-card__check">
                  <CheckIcon size={18} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
