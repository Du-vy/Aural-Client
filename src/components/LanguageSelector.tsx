import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation, type Language } from "@/lib/i18n";
import { ChevronIcon, GlobeIcon } from "./Icons";

interface LanguageSelectorProps {
  compact?: boolean;
  className?: string;
}

export function LanguageSelector({ compact = false, className = "" }: LanguageSelectorProps) {
  const { language, setLanguage, supportedLanguages, currentLanguageInfo, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number }>({ top: 0, right: 0 });

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const margin = 6;
    const estimatedHeight = supportedLanguages.length * 36 + 10;
    const spaceBelow = window.innerHeight - rect.bottom;

    let top = rect.bottom + margin;
    // If not enough space below, open above
    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
      top = rect.top - estimatedHeight - margin;
    }

    setCoords({
      top: Math.max(margin, top),
      right: Math.max(margin, window.innerWidth - rect.right),
    });
  }, [open, supportedLanguages.length]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    function onScrollOrResize() {
      setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return (
    <div className={`lang-selector ${className}`} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--secondary"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t("common.language")}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: compact ? "6px 10px" : "8px 12px",
          fontSize: "13px",
          background: "var(--bg-raised)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
        }}
      >
        <GlobeIcon size={16} />
        <span>{compact ? currentLanguageInfo.code.toUpperCase() : currentLanguageInfo.nativeName}</span>
        <ChevronIcon
          size={14}
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform var(--speed) ease",
          }}
        />
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("common.language")}
          style={{
            position: "fixed",
            top: `${coords.top}px`,
            right: `${coords.right}px`,
            zIndex: 9999,
            background: "var(--bg-overlay)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-overlay)",
            padding: "4px",
            minWidth: "170px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            animation: "menu-appear 80ms ease-out",
          }}
        >
          {supportedLanguages.map((lang) => {
            const isSelected = lang.code === language;
            return (
              <button
                key={lang.code}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  setLanguage(lang.code as Language);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "7px 10px",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  background: isSelected ? "var(--accent-soft)" : "transparent",
                  color: isSelected ? "var(--accent)" : "var(--text)",
                  fontWeight: isSelected ? 600 : 400,
                  fontSize: "13px",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background var(--speed) ease, color var(--speed) ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLElement).style.background = "var(--hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }
                }}
              >
                <span>{lang.nativeName}</span>
                {lang.name !== lang.nativeName ? (
                  <span style={{ fontSize: "11px", color: "var(--text-dim)", marginLeft: "8px" }}>
                    {lang.name}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

