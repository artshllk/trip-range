import "server-only";
import type en from "./en.json";
import type { Locale } from "./config";
export type Dictionary = typeof en;
const dictionaries = {
  en: () => import("./en.json").then((m) => m.default),
  sq: () => import("./sq.json").then((m) => m.default),
} satisfies Record<Locale, () => Promise<Dictionary>>;
export function getDictionary(locale: Locale) {
  return dictionaries[locale]();
}
