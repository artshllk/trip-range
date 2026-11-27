import type { SeoLandingKey } from "./identity";
/** Reviewed publication identities only. Searchability and market candidacy do not add entries here. */
export const approvedLandingKeys: readonly SeoLandingKey[] = [
  { locale: "en", originId: "zurich", intent: "origin" },
  { locale: "en", originId: "zurich", intent: "weekend" },
  {
    locale: "en",
    originId: "zurich",
    intent: "budget",
    budget: { cents: 50000, currency: "EUR" },
  },
  { locale: "en", originId: "tirana", intent: "origin" },
];
