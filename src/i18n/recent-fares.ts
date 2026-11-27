import type { LocalizedCopy } from "./localized";

/**
 * Copy for stored fares, with receipt time kept distinct from fare age.
 * - heading/intro: these are real fares from our store for this origin, shown as proof.
 * - perTraveller: the figure is ONE traveller's return fare, not a whole-trip total.
 * - empty: we hold nothing recent for this origin; no examples are shown instead.
 */
export const recentFaresCopy = {
  en: {
    heading: "Stored fares from {origin}",
    intro:
      "Stored return fares received from Aviasales in the last 48 hours. For one traveller, flights only. The price may have changed.",
    perTraveller: "return, per traveller",
    dates: "{start} – {end}",
    empty: "We have no recent fare records from {origin}.",
    emptyOrigins: "Start from",
  },
} as const satisfies LocalizedCopy<unknown>;
