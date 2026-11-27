import type { LocalizedCopy } from "./localized";

/**
 * Copy for a different departure airport. Meanings:
 * - heading: we have no fare from the traveller's airport, but we hold cached fares
 *   from these nearby airports.
 * - perTraveller: one traveller's return fare, flights only.
 * - noTransfer: getting to that airport is NOT included and we have no cost or
 *   time for it. Never state a transfer price or duration here.
 * - planFrom: re-plan the trip departing from that airport.
 */
export const nearbyFaresCopy = {
  en: {
    heading: "Stored fares from nearby airports",
    perTraveller: "return, per traveller",
    noTransfer:
      "These fares leave from other airports. Travel to those airports is not included; we have no cost or journey time for it.",
    planFrom: "Plan from {airport}",
  },
} as const satisfies LocalizedCopy<unknown>;
