import { originNights } from "./fare-refresh";

/**
 * Trip length on /plan (owner decisions, 27 November 2026): two and three nights
 * from every origin, seven from London and Warsaw; three by default. Five and six
 * nights are not collected and never shown (the evidence rule needs an exact-date
 * itinerary for the length).
 */
export const DEFAULT_NIGHTS = 3;

const words = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** "three-night", for "three-night trips". */
export function nightsAdjective(n: number) {
  return `${words[n] ?? String(n)}-night`;
}

/**
 * The length a /plan view shows. A missing or malformed value is the default; a
 * valid length this origin does not collect (a shared link asking for seven nights
 * from Tirana) is reported as `notCollected` so the page can say so.
 */
export function planNights(
  origin: string,
  raw: unknown,
): { nights: number; offered: number[]; notCollected?: number } {
  const offered = originNights(origin);
  const fallback = offered.includes(DEFAULT_NIGHTS)
    ? DEFAULT_NIGHTS
    : offered[0];
  if (typeof raw !== "string" || !/^\d{1,2}$/.test(raw))
    return { nights: fallback, offered };
  const n = Number(raw);
  if (offered.includes(n)) return { nights: n, offered };
  return n >= 1 && n <= 30
    ? { nights: fallback, offered, notCollected: n }
    : { nights: fallback, offered };
}
