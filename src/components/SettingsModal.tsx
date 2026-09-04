import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./Icons";
import { useTranslation } from "@/lib/i18n";
import { useMouseBack } from "@/store/navigation";

export interface SettingsNavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: string;
  badgeType?: "soon" | "beta" | "pro";
  danger?: boolean;
}

export interface SettingsNavCategory {
  title?: string;
  items: SettingsNavItem[];
}

export interface SettingsModalProps {
  headerElement?: ReactNode;
  categories: SettingsNavCategory[];
  activeTab: string;
  onSelectTab(tabId: string): void;
  onClose(): void;
  children: ReactNode;
  sidebarFooter?: ReactNode;
  unsaved?: boolean;
  onSave?(): void;
  onReset?(): void;
  saveBusy?: boolean;
  className?: string;
}

export function SettingsModal({
  headerElement,
  categories,
  activeTab,
  onSelectTab,
  onClose,
  children,
  sidebarFooter,
  unsaved = false,
  onSave,
  onReset,
  saveBusy = false,
  className,
}: SettingsModalProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The mouse's Back button closes it too, the way Escape does.
  useMouseBack(true, onClose);

  // When switching tabs, scroll the content panel back to top
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  return (
    <div
      className="settings-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className={`settings-shell ${className ?? ""}`.trim()}>
        {/* Left Sidebar */}
        <aside className="settings-sidebar">
          {headerElement ? (
            <div className="settings-sidebar__header">{headerElement}</div>
          ) : null}

          <nav className="settings-sidebar__nav">
            {categories.map((category, catIdx) => (
              <div key={catIdx} className="settings-sidebar__group">
                {category.title ? (
                  <h3 className="settings-sidebar__heading">{category.title}</h3>
                ) : null}
                {category.items.map((item) => {
                  const isActive = activeTab === item.id;
                  const itemClass = [
                    "settings-nav-item",
                    isActive ? "settings-nav-item--active" : "",
                    item.danger ? "settings-nav-item--danger" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <button
                      key={item.id}
                      className={itemClass}
                      onClick={() => onSelectTab(item.id)}
                      type="button"
                    >
                      {item.icon ? (
                        <span className="settings-nav-item__icon">{item.icon}</span>
                      ) : null}
                      <span className="settings-nav-item__label">{item.label}</span>
                      {item.badge ? (
                        <span
                          className={`settings-nav-item__badge settings-nav-item__badge--${item.badgeType ?? "soon"}`}
                        >
                          {item.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {sidebarFooter ? (
            <div className="settings-sidebar__footer">{sidebarFooter}</div>
          ) : (
            <div className="settings-sidebar__footer">
              <span className="settings-sidebar__version">Aural Client v0.8.1</span>
            </div>
          )}
        </aside>

        {/* Right Main Content */}
        <main className="settings-content" ref={contentRef}>
          <div className="settings-content__inner">
            {children}
            <div className="settings-content__spacer" aria-hidden="true" />
          </div>

          {/* Floating Discord-style Unsaved Changes Notice */}
          {unsaved ? (
            <div className="settings-unsaved-bar">
              <span className="settings-unsaved-bar__text">
                {t("dialogs.userSettings.unsavedAlert")}
              </span>
              <div className="settings-unsaved-bar__actions">
                {onReset ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={onReset}
                    disabled={saveBusy}
                  >
                    {t("dialogs.userSettings.reset")}
                  </button>
                ) : null}
                {onSave ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={onSave}
                    disabled={saveBusy}
                  >
                    {saveBusy ? t("common.loading") : t("dialogs.userSettings.save")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </main>

        {/* Discord-style Top Right Close Button with ESC label */}
        <div className="settings-close-wrap">
          <button
            type="button"
            className="settings-close-btn"
            onClick={onClose}
            title={`${t("common.close")} (ESC)`}
            aria-label={`${t("common.close")} (ESC)`}
          >
            <CloseIcon size={18} />
          </button>
          <span className="settings-close-badge">ESC</span>
        </div>
      </div>
    </div>
  );
}
