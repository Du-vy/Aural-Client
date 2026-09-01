/**
 * Internationalization (i18n) type definitions for Aural.
 */

import type { TranslationSchema } from "./locales/en";

export type Language = "en" | "es" | "de" | "fr" | "it" | "pt" | "hi" | "zh";

export interface LanguageInfo {
  code: Language;
  name: string;
  nativeName: string;
}

export type Primitive = string | number | boolean | null | undefined;
export type InterpolationParams = Record<string, Primitive>;

// Path navigation helper for type-safe keys
type Leaves<T> = T extends object
  ? { [K in keyof T]: `${Exclude<K, symbol>}${Leaves<T[K]> extends never ? "" : `.${Leaves<T[K]>}`}` }[keyof T]
  : never;

export type TranslationKey = Leaves<TranslationSchema>;

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type { TranslationSchema };
