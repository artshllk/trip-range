import type { Locale } from "./config";

/**
 * Only English ships. New copy needs an `en` entry; any other locale is optional
 * and falls back to English until that language is actually served.
 */
export type LocalizedCopy<T> = { en: T } & {
  [L in Exclude<Locale, "en">]?: T;
};
export function localized<T>(copy: LocalizedCopy<T>, locale: Locale): T {
  return copy[locale as Exclude<Locale, "en">] ?? copy.en;
}
