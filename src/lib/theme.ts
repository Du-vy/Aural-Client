/**
 * Client-side Theming Engine for Aural.
 *
 * Provides reactive theme state, predefined themes, custom theme management,
 * CSS variable injection into DOM, and file import/export (.auraltheme.json).
 * All data is kept in localStorage with zero server-side storage required.
 */

import { useEffect, useState } from "react";
import { saveTextFile } from "./open";

export interface ThemeColors {
  bgRail: string;
  bgSidebar: string;
  bgMain: string;
  bgRaised: string;
  bgOverlay: string;
  bgInput: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentHover: string;
  danger: string;
  border: string;
}

export interface ThemeBackground {
  imageUrl: string;
  blur: number; // 0 to 20 px
  opacity: number; // 0 to 100 %
  fitting: "cover" | "contain" | "tile";
}

export interface AuralTheme {
  id: string;
  name: string;
  isBuiltin?: boolean;
  colors: ThemeColors;
  background?: ThemeBackground;
  fontFamily?: string;
  fontSize?: number; // Base font size in px (e.g. 13 - 18)
}

export interface ThemeExportFile {
  version: 1;
  type: "aural-theme";
  theme: AuralTheme;
}

export interface FontOption {
  id: string;
  name: string;
  value: string;
  isMono?: boolean;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: "inter",
    name: "Inter (Predeterminado)",
    value: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: "outfit",
    name: "Outfit (Moderno)",
    value: '"Outfit", "Inter", sans-serif',
  },
  {
    id: "poppins",
    name: "Poppins (Geométrico)",
    value: '"Poppins", sans-serif',
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono (Código)",
    value: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
    isMono: true,
  },
  {
    id: "fira-code",
    name: "Fira Code (Monospace)",
    value: '"Fira Code", "JetBrains Mono", monospace',
    isMono: true,
  },
  {
    id: "system",
    name: "Sistema (Nativo)",
    value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
];

/* -------------------------------------------------------------------------- */
/* Predefined Built-in Themes (4 original names + Classic & OLED)             */
/* -------------------------------------------------------------------------- */

export const PREDEFINED_THEMES: AuralTheme[] = [
  {
    id: "vesper",
    name: "Vesper",
    isBuiltin: true,
    colors: {
      bgRail: "#101218",
      bgSidebar: "#151821",
      bgMain: "#1a1e2a",
      bgRaised: "#222736",
      bgOverlay: "#2a3042",
      bgInput: "#12141c",
      text: "#ecf0f8",
      textMuted: "#9aa5be",
      textDim: "#6a748c",
      accent: "#00d2b4",
      accentHover: "#1ce4c7",
      danger: "#fa5252",
      border: "rgba(255, 255, 255, 0.08)",
    },
    background: {
      imageUrl: "",
      blur: 0,
      opacity: 100,
      fitting: "cover",
    },
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 15,
  },
  {
    id: "kitsune",
    name: "Kitsune",
    isBuiltin: true,
    colors: {
      bgRail: "#170e15",
      bgSidebar: "#20131d",
      bgMain: "#271723",
      bgRaised: "#341f2f",
      bgOverlay: "#40263a",
      bgInput: "#140c12",
      text: "#fceef4",
      textMuted: "#c8a4b6",
      textDim: "#8c6b7e",
      accent: "#ff6b6b",
      accentHover: "#ff8787",
      danger: "#e03131",
      border: "rgba(255, 180, 200, 0.09)",
    },
    background: {
      imageUrl: "",
      blur: 0,
      opacity: 100,
      fitting: "cover",
    },
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 15,
  },
  {
    id: "glacier",
    name: "Glacier",
    isBuiltin: true,
    colors: {
      bgRail: "#0b1219",
      bgSidebar: "#111a24",
      bgMain: "#162230",
      bgRaised: "#1d2e40",
      bgOverlay: "#253a50",
      bgInput: "#0d1620",
      text: "#eaf4fc",
      textMuted: "#9fc1dc",
      textDim: "#688ca8",
      accent: "#38bdf8",
      accentHover: "#60a5fa",
      danger: "#f87171",
      border: "rgba(180, 220, 255, 0.09)",
    },
    background: {
      imageUrl: "",
      blur: 0,
      opacity: 100,
      fitting: "cover",
    },
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 15,
  },
  {
    id: "elysium",
    name: "Elysium",
    isBuiltin: true,
    colors: {
      bgRail: "#091310",
      bgSidebar: "#0f1c17",
      bgMain: "#14241e",
      bgRaised: "#1b3129",
      bgOverlay: "#223d33",
      bgInput: "#0b1612",
      text: "#e8f8f0",
      textMuted: "#9ccdbb",
      textDim: "#649583",
      accent: "#10b981",
      accentHover: "#34d399",
      danger: "#f43f5e",
      border: "rgba(160, 255, 200, 0.08)",
    },
    background: {
      imageUrl: "",
      blur: 0,
      opacity: 100,
      fitting: "cover",
    },
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 15,
  },
  {
    id: "classic",
    name: "Aural Classic",
    isBuiltin: true,
    colors: {
      bgRail: "#15161b",
      bgSidebar: "#1b1d23",
      bgMain: "#22242b",
      bgRaised: "#292c34",
      bgOverlay: "#2f323b",
      bgInput: "#16171c",
      text: "#e9ecf2",
      textMuted: "#a4abb9",
      textDim: "#737b8b",
      accent: "#12b8a0",
      accentHover: "#15cfb4",
      danger: "#e5534b",
      border: "rgba(255, 255, 255, 0.07)",
    },
    background: {
      imageUrl: "",
      blur: 0,
      opacity: 100,
      fitting: "cover",
    },
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    fontSize: 15,
  },
  {
    id: "oled",
    name: "Midnight OLED",
    isBuiltin: true,
    colors: {
      bgRail: "#000000",
      bgSidebar: "#050608",
      bgMain: "#090a0d",
      bgRaised: "#121419",
      bgOverlay: "#1a1d24",
      bgInput: "#040405",
      text: "#f0f2f7",
      textMuted: "#9ca3af",
      textDim: "#6b7280",
      accent: "#00e5bf",
      accentHover: "#2ef2cf",
      danger: "#ff4d4f",
      border: "rgba(255, 255, 255, 0.12)",
    },
    background: {
      imageUrl: "",
      blur: 0,
      opacity: 100,
      fitting: "cover",
    },
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    fontSize: 15,
  },
];

/* -------------------------------------------------------------------------- */
/* Local Storage Keys                                                         */
/* -------------------------------------------------------------------------- */

const ACTIVE_THEME_ID_KEY = "aural.active_theme_id.v1";
const CUSTOM_THEMES_KEY = "aural.custom_themes.v1";
const ACTIVE_BG_KEY = "aural.active_bg.v1";

/* -------------------------------------------------------------------------- */
/* Storage Helpers                                                            */
/* -------------------------------------------------------------------------- */

export function readActiveBackground(): ThemeBackground | null {
  try {
    const raw = localStorage.getItem(ACTIVE_BG_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeActiveBackground(bg: ThemeBackground | null): void {
  try {
    if (!bg || !bg.imageUrl) {
      localStorage.removeItem(ACTIVE_BG_KEY);
    } else {
      localStorage.setItem(ACTIVE_BG_KEY, JSON.stringify(bg));
    }
  } catch {
    // ignore
  }
}

export function readCustomThemes(): AuralTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTheme);
  } catch {
    return [];
  }
}

export function writeCustomThemes(themes: AuralTheme[]): void {
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
  } catch (err) {
    console.error("Failed to write custom themes to localStorage:", err);
  }
}

export function readActiveThemeId(): string {
  try {
    return localStorage.getItem(ACTIVE_THEME_ID_KEY) || "classic";
  } catch {
    return "classic";
  }
}

export function writeActiveThemeId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_THEME_ID_KEY, id);
  } catch {
    // ignore
  }
}

export function getAllThemes(): AuralTheme[] {
  const custom = readCustomThemes();
  return [...PREDEFINED_THEMES, ...custom];
}

export function getThemeById(id: string): AuralTheme {
  const all = getAllThemes();
  const found = all.find((t) => t.id === id);
  if (found) return found;
  return PREDEFINED_THEMES[4]!; // Classic fallback
}

export function getActiveTheme(): AuralTheme {
  const id = readActiveThemeId();
  return getThemeById(id);
}

/* -------------------------------------------------------------------------- */
/* DOM Application (CSS Variables Injection)                                  */
/* -------------------------------------------------------------------------- */

function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith("rgba") || hex.startsWith("rgb")) return hex;
  let clean = hex.replace("#", "");
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyThemeToDOM(theme: AuralTheme): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const { colors, background, fontFamily, fontSize } = theme;

  // Set colors
  root.style.setProperty("--bg-rail", colors.bgRail);
  root.style.setProperty("--bg-sidebar", colors.bgSidebar);
  root.style.setProperty("--bg-main", colors.bgMain);
  root.style.setProperty("--bg-raised", colors.bgRaised);
  root.style.setProperty("--bg-overlay", colors.bgOverlay);
  root.style.setProperty("--bg-input", colors.bgInput);

  root.style.setProperty("--text", colors.text);
  root.style.setProperty("--text-muted", colors.textMuted);
  root.style.setProperty("--text-dim", colors.textDim);

  root.style.setProperty("--accent", colors.accent);
  root.style.setProperty("--accent-hover", colors.accentHover);
  root.style.setProperty("--accent-active", colors.accentHover);
  root.style.setProperty("--accent-soft", hexToRgba(colors.accent, 0.15));

  root.style.setProperty("--danger", colors.danger);
  root.style.setProperty("--danger-hover", colors.danger);
  root.style.setProperty("--danger-soft", hexToRgba(colors.danger, 0.15));

  root.style.setProperty("--border", colors.border || "rgba(255, 255, 255, 0.08)");
  root.style.setProperty(
    "--border-strong",
    colors.border ? hexToRgba(colors.border, 0.25) : "rgba(255, 255, 255, 0.16)"
  );

  // Set typography
  if (fontFamily) {
    root.style.setProperty("--font", fontFamily);
  }
  const size = fontSize || 15;
  root.style.setProperty("--font-size-base", `${size}px`);
  root.style.setProperty("--font-scale", `${size / 15}`);
  root.style.setProperty("--font-size-msg", `${Math.round((size / 15) * 14 * 10) / 10}px`);
  root.style.setProperty("--font-size-title", `${Math.round((size / 15) * 15 * 10) / 10}px`);
  root.style.setProperty("--font-size-sub", `${Math.round((size / 15) * 13 * 10) / 10}px`);
  root.style.setProperty("--font-size-caption", `${Math.round((size / 15) * 11 * 10) / 10}px`);
  document.body.style.fontSize = `${size}px`;

  // Check theme background or saved active custom wallpaper
  const activeBg = background?.imageUrl ? background : readActiveBackground();

  // Set background image custom properties
  if (activeBg && activeBg.imageUrl) {
    root.style.setProperty("--app-bg-image", `url("${activeBg.imageUrl}")`);
    root.style.setProperty("--app-bg-blur", `${activeBg.blur ?? 0}px`);
    root.style.setProperty("--app-bg-opacity", `${(activeBg.opacity ?? 100) / 100}`);
    root.style.setProperty("--app-bg-repeat", activeBg.fitting === "tile" ? "repeat" : "no-repeat");
    root.style.setProperty(
      "--app-bg-size",
      activeBg.fitting === "contain"
        ? "contain"
        : activeBg.fitting === "tile"
        ? "auto"
        : "cover"
    );
    root.setAttribute("data-has-custom-bg", "true");
  } else {
    root.style.removeProperty("--app-bg-image");
    root.style.removeProperty("--app-bg-blur");
    root.style.removeProperty("--app-bg-opacity");
    root.style.removeProperty("--app-bg-repeat");
    root.style.removeProperty("--app-bg-size");
    root.removeAttribute("data-has-custom-bg");
  }
}

/** Initializer to call at app startup before render */
export function initTheme(): AuralTheme {
  const active = getActiveTheme();
  applyThemeToDOM(active);
  return active;
}

/* -------------------------------------------------------------------------- */
/* Custom Themes Management                                                   */
/* -------------------------------------------------------------------------- */

export function saveCustomTheme(theme: AuralTheme): void {
  const custom = readCustomThemes();
  const index = custom.findIndex((t) => t.id === theme.id);
  const toSave: AuralTheme = { ...theme, isBuiltin: false };

  if (index === -1) {
    custom.push(toSave);
  } else {
    custom[index] = toSave;
  }

  writeCustomThemes(custom);
  notifyThemeListeners();
}

export function createCustomTheme(name: string, baseThemeId?: string): AuralTheme {
  const base = getThemeById(baseThemeId || readActiveThemeId());
  const newTheme: AuralTheme = {
    id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: name.trim() || "Mi Tema",
    isBuiltin: false,
    colors: { ...base.colors },
    background: base.background ? { ...base.background } : undefined,
    fontFamily: base.fontFamily,
    fontSize: base.fontSize,
  };

  saveCustomTheme(newTheme);
  setActiveTheme(newTheme.id);
  return newTheme;
}

export function duplicateTheme(sourceThemeId: string, newName?: string): AuralTheme {
  const source = getThemeById(sourceThemeId);
  const name = newName || `${source.name} (Copia)`;
  return createCustomTheme(name, sourceThemeId);
}

export function renameCustomTheme(id: string, newName: string): boolean {
  const custom = readCustomThemes();
  const target = custom.find((t) => t.id === id);
  if (!target) return false;

  target.name = newName.trim();
  writeCustomThemes(custom);
  notifyThemeListeners();
  return true;
}

export function deleteCustomTheme(id: string): boolean {
  const custom = readCustomThemes();
  const filtered = custom.filter((t) => t.id !== id);
  if (filtered.length === custom.length) return false;

  writeCustomThemes(filtered);

  // If deleted theme was active, fallback to classic
  if (readActiveThemeId() === id) {
    setActiveTheme("classic");
  } else {
    notifyThemeListeners();
  }

  return true;
}

export function setActiveTheme(id: string): void {
  const theme = getThemeById(id);
  writeActiveThemeId(theme.id);
  applyThemeToDOM(theme);
  notifyThemeListeners();
}

export function resetToDefaultTheme(): void {
  setActiveTheme("classic");
}

/* -------------------------------------------------------------------------- */
/* Import & Export                                                            */
/* -------------------------------------------------------------------------- */

export async function exportThemeToFile(theme: AuralTheme): Promise<boolean> {
  const exportData: ThemeExportFile = {
    version: 1,
    type: "aural-theme",
    theme: {
      id: theme.id,
      name: theme.name,
      colors: theme.colors,
      background: theme.background,
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
    },
  };

  const json = JSON.stringify(exportData, null, 2);
  const filename = `${theme.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.auraltheme.json`;

  return await saveTextFile(filename, json, {
    mimeType: "application/json",
    filterName: "Aural Theme (*.auraltheme.json, *.json)",
    filterExtensions: ["json", "auraltheme"],
  });
}

export async function importThemeFromFile(file: File): Promise<AuralTheme> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        let candidate: unknown;

        if (parsed && typeof parsed === "object" && "type" in parsed && parsed.type === "aural-theme") {
          candidate = parsed.theme;
        } else {
          candidate = parsed;
        }

        if (!isValidTheme(candidate)) {
          throw new Error("themeImport.invalid");
        }

        const candTheme = withoutRemoteBackground(candidate as AuralTheme);
        // Assign a new custom id so it doesn't overwrite accidentally
        const importedTheme: AuralTheme = {
          ...candTheme,
          id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: candTheme.name || file.name.replace(/\.(auraltheme|json)$/i, ""),
          isBuiltin: false,
        };

        saveCustomTheme(importedTheme);
        setActiveTheme(importedTheme.id);
        resolve(importedTheme);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("themeImport.unreadable"));
      }
    };
    reader.onerror = () => reject(new Error("themeImport.unreadable"));
    reader.readAsText(file);
  });
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/** Every colour applyTheme sets. A theme missing one cannot be applied whole. */
const COLOR_KEYS: readonly (keyof ThemeColors)[] = [
  "bgRail", "bgSidebar", "bgMain", "bgRaised", "bgOverlay", "bgInput",
  "text", "textMuted", "textDim",
  "accent", "accentHover", "danger", "border",
];

/**
 * A CSS colour, as narrowly as is worth checking here.
 *
 * The point is not to reimplement the CSS parser: it is that a theme file
 * arrives from wherever the person who shared it got it, and every one of these
 * strings is written straight into a custom property. Something that is not a
 * colour reaches the page as `url(...)`, which would fetch it.
 */
const CSS_COLOR =
  /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9a-z%.,\/\s+-]*\)|[a-z]+)$/i;

function isColor(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && CSS_COLOR.test(value.trim());
}

/**
 * Whether a parsed file is a theme this client can apply.
 *
 * It checks every colour rather than a sample of three. A theme that passes
 * with nine of thirteen leaves applyTheme writing `undefined` into the rest,
 * which the CSS engine discards — so the missing half stays whatever the last
 * theme set, and the result is neither theme.
 */
function isValidTheme(value: unknown): value is AuralTheme {
  if (typeof value !== "object" || value === null) return false;
  const cand = value as Record<string, unknown>;
  if (typeof cand.id !== "string" || typeof cand.name !== "string") return false;
  if (!cand.colors || typeof cand.colors !== "object") return false;

  const colors = cand.colors as Record<string, unknown>;
  if (!COLOR_KEYS.every((key) => isColor(colors[key]))) return false;

  if (cand.fontSize !== undefined) {
    if (typeof cand.fontSize !== "number" || !Number.isFinite(cand.fontSize)) return false;
    if (cand.fontSize < 10 || cand.fontSize > 28) return false;
  }
  if (cand.fontFamily !== undefined) {
    if (typeof cand.fontFamily !== "string" || cand.fontFamily.length > 200) return false;
  }
  if (cand.background !== undefined) {
    if (typeof cand.background !== "object" || cand.background === null) return false;
    const bg = cand.background as Record<string, unknown>;
    if (typeof bg.imageUrl !== "string") return false;
  }
  return true;
}

/**
 * Strips the part of an imported theme that would reach outside this machine.
 *
 * A background is written into `url("...")`, so a remote one has every person
 * who applies the theme fetch it — a beacon for whoever wrote the file, dressed
 * as a wallpaper. Typing that URL in yourself is your own business; inheriting
 * it from a file somebody sent you is not, so an import keeps only a background
 * that is already embedded in the file.
 */
function withoutRemoteBackground(theme: AuralTheme): AuralTheme {
  const url = theme.background?.imageUrl ?? "";
  if (url === "" || url.startsWith("data:image/")) return theme;
  return { ...theme, background: { ...theme.background!, imageUrl: "" } };
}

/* -------------------------------------------------------------------------- */
/* Reactive Hook and Event Listener                                           */
/* -------------------------------------------------------------------------- */

type ThemeChangeListener = () => void;
const listeners = new Set<ThemeChangeListener>();

function notifyThemeListeners() {
  listeners.forEach((l) => l());
}

export function useTheme() {
  const [activeTheme, setActive] = useState<AuralTheme>(getActiveTheme);
  const [allThemes, setAllThemes] = useState<AuralTheme[]>(getAllThemes);

  useEffect(() => {
    const handler = () => {
      const current = getActiveTheme();
      setActive(current);
      setAllThemes(getAllThemes());
      applyThemeToDOM(current);
    };

    listeners.add(handler);
    // Initial sync
    handler();

    return () => {
      listeners.delete(handler);
    };
  }, []);

  const updateActiveColors = (colorsPatch: Partial<ThemeColors>) => {
    let themeToUpdate = activeTheme;
    if (activeTheme.isBuiltin) {
      // If editing a builtin theme, auto-fork into a custom theme
      themeToUpdate = createCustomTheme(`${activeTheme.name} (Personalizado)`, activeTheme.id);
    }
    const updated: AuralTheme = {
      ...themeToUpdate,
      colors: {
        ...themeToUpdate.colors,
        ...colorsPatch,
      },
    };
    saveCustomTheme(updated);
    setActiveTheme(updated.id);
  };

  const updateActiveBackground = (bgPatch: Partial<ThemeBackground>) => {
    let themeToUpdate = activeTheme;
    if (activeTheme.isBuiltin) {
      themeToUpdate = createCustomTheme(`${activeTheme.name} (Personalizado)`, activeTheme.id);
    }
    const currentBg = themeToUpdate.background || readActiveBackground() || {
      imageUrl: "",
      blur: 0,
      opacity: 100,
      fitting: "cover",
    };
    const updatedBg: ThemeBackground = {
      ...currentBg,
      ...bgPatch,
    };
    writeActiveBackground(updatedBg.imageUrl ? updatedBg : null);
    const updated: AuralTheme = {
      ...themeToUpdate,
      background: updatedBg,
    };
    saveCustomTheme(updated);
    setActiveTheme(updated.id);
  };

  const updateActiveFont = (fontFamily: string) => {
    let themeToUpdate = activeTheme;
    if (activeTheme.isBuiltin) {
      themeToUpdate = createCustomTheme(`${activeTheme.name} (Personalizado)`, activeTheme.id);
    }
    const updated: AuralTheme = {
      ...themeToUpdate,
      fontFamily,
    };
    saveCustomTheme(updated);
    setActiveTheme(updated.id);
  };

  const updateActiveFontSize = (fontSize: number) => {
    let themeToUpdate = activeTheme;
    if (activeTheme.isBuiltin) {
      themeToUpdate = createCustomTheme(`${activeTheme.name} (Personalizado)`, activeTheme.id);
    }
    const updated: AuralTheme = {
      ...themeToUpdate,
      fontSize,
    };
    saveCustomTheme(updated);
    setActiveTheme(updated.id);
  };

  return {
    activeTheme,
    allThemes,
    predefinedThemes: PREDEFINED_THEMES,
    customThemes: allThemes.filter((t) => !t.isBuiltin),
    setActiveTheme,
    saveCustomTheme,
    createCustomTheme,
    duplicateTheme,
    renameCustomTheme,
    deleteCustomTheme,
    resetToDefaultTheme,
    exportThemeToFile,
    importThemeFromFile,
    updateActiveColors,
    updateActiveBackground,
    updateActiveFont,
    updateActiveFontSize,
  };
}
