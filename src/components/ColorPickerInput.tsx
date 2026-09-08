import { useRef, useState, useEffect, type ChangeEvent } from "react";
import { PaletteIcon } from "./Icons";
import { useTranslation } from "@/lib/i18n";

export const DEFAULT_COLOR_PRESETS = [
  "#12b8a0", // Teal
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#f59e0b", // Amber
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f43f5e", // Rose
  "#64748b", // Slate
  "#e11d48", // Crimson
  "#06b6d4", // Cyan
];

interface ColorPickerInputProps {
  value?: string;
  onChange(color: string): void;
  onReset?(): void;
  presets?: string[];
  showPresets?: boolean;
  className?: string;
}

export function ColorPickerInput({
  value = "",
  onChange,
  onReset,
  presets = DEFAULT_COLOR_PRESETS,
  showPresets = true,
  className = "",
}: ColorPickerInputProps) {
  const { t } = useTranslation();
  const inputColorRef = useRef<HTMLInputElement>(null);
  const [hexInput, setHexInput] = useState(value || "");

  useEffect(() => {
    setHexInput(value || "");
  }, [value]);

  function handleHexChange(e: ChangeEvent<HTMLInputElement>) {
    let raw = e.target.value.trim();
    if (!raw.startsWith("#") && raw.length > 0) {
      raw = `#${raw}`;
    }
    setHexInput(raw);
    // Validate 6-digit hex code
    if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
      onChange(raw);
    }
  }

  function handleHexBlur() {
    if (/^#[0-9A-Fa-f]{6}$/.test(hexInput)) {
      onChange(hexInput);
    } else if (hexInput.trim() === "") {
      onChange("");
    } else {
      // Revert to current valid value
      setHexInput(value || "");
    }
  }

  function handleNativeColorChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setHexInput(val);
    onChange(val);
  }

  return (
    <div className={`color-picker-control ${className}`}>
      {showPresets && presets.length > 0 ? (
        <div className="color-picker-presets">
          {presets.map((color) => {
            const isSelected = value.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                className={`color-picker-swatch ${isSelected ? "color-picker-swatch--active" : ""}`}
                style={{ backgroundColor: color }}
                onClick={() => onChange(color)}
                title={color}
              />
            );
          })}
        </div>
      ) : null}

      <div className="color-picker-custom-row">
        <div
          className="color-picker-native-trigger"
          title={t("profile.customColor")}
          onClick={() => inputColorRef.current?.click()}
        >
          <span
            className="color-picker-preview-dot"
            style={{ backgroundColor: value || "#12b8a0" }}
          />
          <PaletteIcon size={14} className="color-picker-palette-icon" />
          <input
            ref={inputColorRef}
            type="color"
            className="color-picker-native-input"
            value={value || "#12b8a0"}
            onChange={handleNativeColorChange}
            tabIndex={-1}
            aria-label={t("profile.customColor")}
          />
        </div>

        <div className="color-picker-hex-wrap">
          <input
            type="text"
            className="input input--sm color-picker-hex-field"
            value={hexInput}
            onChange={handleHexChange}
            onBlur={handleHexBlur}
            placeholder="#12B8A0"
            maxLength={7}
            aria-label={t("profile.hexCode")}
          />
        </div>

        {value && onReset ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm color-picker-reset-btn"
            onClick={onReset}
            title={t("dialogs.userSettings.reset")}
          >
            {t("dialogs.userSettings.reset")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
