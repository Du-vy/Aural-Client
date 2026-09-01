/**
 * Aural Internationalization (i18n) Engine.
 *
 * Lightweight, zero-dependency, strictly typed translation subsystem.
 */

import { useSyncExternalStore } from "react";
import { readLanguage, writeLanguage } from "@/lib/storage";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { de } from "./locales/de";
import { fr } from "./locales/fr";
import { it } from "./locales/it";
import { pt } from "./locales/pt";
import { hi } from "./locales/hi";
import { zh } from "./locales/zh";
import type {
  DeepPartial,
  InterpolationParams,
  Language,
  LanguageInfo,
  TranslationKey,
  TranslationSchema,
} from "./types";

export const SUPPORTED_LANGUAGES: readonly LanguageInfo[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "简体中文" },
] as const;

export const DEFAULT_LANGUAGE: Language = "en";

const dictionaries: Record<Language, DeepPartial<TranslationSchema>> = {
  en,
  es,
  de,
  fr,
  it,
  pt,
  hi,
  zh,
};

function matchNavigatorLanguage(): Language {
  if (typeof navigator === "undefined" || !navigator.language) {
    return DEFAULT_LANGUAGE;
  }
  const tag = navigator.language.toLowerCase();
  for (const lang of SUPPORTED_LANGUAGES) {
    if (tag === lang.code || tag.startsWith(`${lang.code}-`)) {
      return lang.code;
    }
  }
  return DEFAULT_LANGUAGE;
}

let activeLanguage: Language = (() => {
  const stored = readLanguage();
  if (stored && stored in dictionaries) {
    return stored as Language;
  }
  return matchNavigatorLanguage();
})();

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

/** Returns the currently active language code. */
export function getLanguage(): Language {
  return activeLanguage;
}

/** Sets and persists the active language. */
export function setLanguage(lang: Language): void {
  if (lang === activeLanguage || !(lang in dictionaries)) return;
  activeLanguage = lang;
  writeLanguage(lang);
  notify();
}

/** Returns language metadata for a given code. */
export function getLanguageInfo(code: Language = activeLanguage): LanguageInfo {
  return (
    SUPPORTED_LANGUAGES.find((item) => item.code === code) ??
    SUPPORTED_LANGUAGES[0]!
  );
}

function resolvePath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: any = obj;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

function interpolate(template: string, params?: InterpolationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value !== undefined && value !== null ? String(value) : match;
  });
}

/**
 * Translates a key using the active language with fallback to English.
 */
export function t(key: TranslationKey, params?: InterpolationParams): string {
  const dict = dictionaries[activeLanguage];
  let raw = resolvePath(dict, key);

  // Fallback to English if missing or empty
  if (typeof raw !== "string") {
    raw = resolvePath(dictionaries.en, key);
  }

  if (typeof raw !== "string") {
    return key;
  }

  return interpolate(raw, params);
}

/**
 * React hook to access translation function and active language reactively.
 */
export function useTranslation() {
  const lang = useSyncExternalStore(subscribe, getLanguage, () => DEFAULT_LANGUAGE);
  return {
    t,
    language: lang,
    setLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES,
    currentLanguageInfo: getLanguageInfo(lang),
  };
}

export * from "./types";
