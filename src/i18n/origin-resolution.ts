import type { LocalizedCopy } from "./localized";

/**
 * Copy for an unidentified origin; no search has run.
 * - title/body: the link or URL did not name a departure city we can identify, so we
 *   did not search. We never substitute a default city.
 * - action: back to an empty search form to choose the city.
 */
export const originResolutionCopy = {
  en: {
    title: "We couldn't tell where you're leaving from",
    body: "This link doesn't name a departure city we recognise, so we haven't searched. Choose your city to see trips.",
    action: "Choose a departure city",
  },
} as const satisfies LocalizedCopy<unknown>;
