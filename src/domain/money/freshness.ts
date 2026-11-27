import type { Money } from "./provenance";

const HOUR = 3600_000;

export type FreshnessTier = "fresh" | "aging" | "old";
export type FareFreshness = {
  /**
   * "fare-observed": the provider's own observation time (the fare's age).
   * "fetched": only our fetch time is known. The wording must say "last checked",
   * never imply the fare's age: the provider cache keeps fares 2–7 days.
   */
  basis: "fare-observed" | "fetched";
  at: string;
  ageMs: number;
  tier: FreshnessTier;
  fareObservedAt: string | null;
  fetchedAt: string | null;
  source: string;
};

/**
 * PROVISIONAL tiers: green under 12 h, grey 12–72 h, amber over 72 h. Live found_at
 * ages measured 10–157 h (2026-10-27), so a 48 h amber line flagged nearly every fare
 * and meant nothing. Replace these with tiers derived from the observed age
 * distribution in the fare store (scripts/report-fare-ages.mjs) after a week of warm runs.
 * Undefined: nothing truthful to show.
 */
export const FRESH_UNDER_MS = 12 * HOUR;
export const OLD_OVER_MS = 72 * HOUR;
export function fareFreshness(
  money: Money,
  now: number,
): FareFreshness | undefined {
  const p = money.provenance;
  if (p.kind !== "observed_fare") return;
  const basis = p.fareObservedAt ? "fare-observed" : "fetched";
  const at = p.fareObservedAt ?? p.fetchedAt;
  if (!at) return;
  const time = Date.parse(at);
  if (!Number.isFinite(time) || time > now + 5 * 60_000) return;
  const ageMs = Math.max(0, now - time);
  return {
    basis,
    at,
    ageMs,
    tier:
      ageMs < FRESH_UNDER_MS ? "fresh" : ageMs <= OLD_OVER_MS ? "aging" : "old",
    fareObservedAt: p.fareObservedAt,
    fetchedAt: p.fetchedAt,
    source: p.source,
  };
}

/** Whole units only: "45 min", "3 h", "2 days". */
export function ageParts(ageMs: number): {
  value: number;
  unit: "min" | "h" | "day";
} {
  if (ageMs < HOUR)
    return { value: Math.max(1, Math.floor(ageMs / 60_000)), unit: "min" };
  if (ageMs < 48 * HOUR) return { value: Math.floor(ageMs / HOUR), unit: "h" };
  return { value: Math.floor(ageMs / (24 * HOUR)), unit: "day" };
}
