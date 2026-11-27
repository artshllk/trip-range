import {
  currencyMetadata,
  isCurrency,
  type MoneyAmount,
} from "./money/currency";
import { providerFoundAt } from "./fare-evidence";

/** A cached fare from a nearby airport. Fare side only: no ground-transfer cost or time. */
export type NearbyFare = {
  originCode: string;
  destinationCode: string;
  departureDate: string;
  returnDate: string;
  /** Per traveller, return. */
  price: MoneyAmount;
  foundAt: string | null;
  fetchedAt: string | null;
};

const iata = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Z]{3}$/.test(v);
const date = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

/**
 * v2/prices/nearest-places-matrix: rows sit at the top level under `prices`
 * (not `data`), price field `price`, no `actual`. Verified 2026-10-27.
 * Rows from the traveller's own origin are excluded: this panel is for alternatives.
 */
export function parseNearbyFares(
  body: unknown,
  currency: string,
  ownOrigin: string,
  fetchedAt: string | null,
  limit = 5,
): NearbyFare[] {
  if (!body || typeof body !== "object" || !isCurrency(currency)) return [];
  const rows = (body as { prices?: unknown }).prices;
  if (!Array.isArray(rows)) return [];
  const scale = 10 ** currencyMetadata[currency].minorUnits;
  const best = new Map<string, NearbyFare>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const departureDate = date(r.depart_date);
    const returnDate = date(r.return_date);
    if (
      !iata(r.origin) ||
      !iata(r.destination) ||
      r.origin === ownOrigin ||
      !departureDate ||
      !returnDate ||
      returnDate <= departureDate ||
      typeof r.price !== "number" ||
      !Number.isFinite(r.price) ||
      r.price <= 0
    )
      continue;
    const fare: NearbyFare = {
      originCode: r.origin,
      destinationCode: r.destination,
      departureDate,
      returnDate,
      price: { cents: Math.round(r.price * scale), currency },
      foundAt: providerFoundAt(r.found_at),
      fetchedAt,
    };
    const current = best.get(r.origin);
    // One row per nearby airport: its cheapest cached fare.
    if (!current || fare.price.cents < current.price.cents)
      best.set(r.origin, fare);
  }
  return [...best.values()]
    .sort((a, b) => a.price.cents - b.price.cents)
    .slice(0, limit);
}
