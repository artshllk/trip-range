import type { LocalizedCopy } from "./localized";

/**
 * Fare timing copy. These two meanings must never be merged:
 *  - fareSeen (the normal case): age from the provider's found_at, "when the
 *    ticket was found". Shown when the fare joined to a get_latest_prices row
 *    (verified 2026-10-27: every live fare probed joined). Solid dot.
 *  - lastChecked (fallback only): no found_at exists for this fare, so the age is
 *    time since Trip Range fetched it. It is NOT the fare's age. Hollow ring.
 */
export const freshnessCopy = {
  en: {
    lastChecked: "We received this fare {age}. We don't know how old the price is.",
    fareSeen: "Provider saw this fare {age}",
    ago: { min: "{n} min ago", h: "{n} h ago", day: "{n} days ago" },
    checkPartner: "Check today’s price with the partner",
    fetchedRow: "When we received this fare",
    observedRow: "Provider recorded the fare",
    observedUnknown: "Not supplied by the provider",
    sourceRow: "Source",
    sourceValue:
      "{source} fare records from other travellers’ searches. Stored prices, not live offers.",
    note: "Changing your search uses the fare records we hold. The receipt time is not the age of the fare. Check price and availability on the partner’s site before booking.",
  },
} as const satisfies LocalizedCopy<unknown>;
