import { isEnglishLandingPath } from "../seo/paths";
import { localeFromPath, localePath } from "./routing";
export { defaultLocale, localePath, localeFromPath } from "./routing";
/** Served/indexed languages. Dormant dictionaries are retained for future localization. */
export const locales = ["en"] as const;
export type ActiveLocale = (typeof locales)[number];
/** Retained translation keys, not authorization to serve an inactive language. */
export type Locale = "en" | "sq";
export function isLocale(value: string): value is ActiveLocale {
  return locales.some((l) => l === value);
}
/** The same page's public path in another locale; English-only landings fall back to that locale's home. */
export function translatedPath(path: string, target: Locale): string {
  const { path: unprefixed } = localeFromPath(path);
  if (target !== "en" && isEnglishLandingPath(unprefixed))
    return localePath(target);
  return localePath(target, unprefixed);
}
export { formatMoney } from "../domain/money/currency";
