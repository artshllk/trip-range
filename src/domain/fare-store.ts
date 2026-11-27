import { currencyMetadata, isCurrency } from "./money/currency";
import { providerFoundAt } from "./fare-evidence";

export const FARE_ENDPOINTS = {
  pricesForDates: "aviasales/v3/prices_for_dates",
  latestPrices: "aviasales/v3/get_latest_prices",
  nearestPlaces: "v2/prices/nearest-places-matrix",
} as const;
export type FareEndpoint = (typeof FARE_ENDPOINTS)[keyof typeof FARE_ENDPOINTS];

/** One provider response, as fetched. `fetchedAt` is our clock at fetch time, never parse time. */
export type FareFetchRecord = {
  fetchedAt: string;
  httpDate: string | null;
  endpoint: FareEndpoint;
  origin: string;
  destination: string | null;
  departureMonth: string | null;
  returnMonth: string | null;
  currency: string;
  market: string | null;
  rawPayload: unknown;
};
export type FareObservationRecord = {
  /** Which endpoint this row came from: prices are compared per source. */
  endpoint: FareEndpoint;
  fetchedAt: string;
  /** Provider found_at. prices_for_dates never sends one, so its rows stay null. */
  fareObservedAt: string | null;
  /** Provider `actual` flag (latest prices only). */
  actual: boolean | null;
  providerLinkSearchDate: string | null;
  origin: string;
  originAirport: string | null;
  destination: string;
  destinationAirport: string | null;
  departureAt: string;
  returnAt: string | null;
  /** Local calendar dates as the provider sent them; UTC normalization can shift the day. */
  departureDate: string;
  returnDate: string | null;
  /** From trip_class (0 economy, 1 business, 2 first); null when not reported. */
  cabin: "economy" | "business" | "first" | null;
  travellers: 1;
  priceMinor: number;
  currency: string;
  transfers: number | null;
  returnTransfers: number | null;
  airline: string | null;
  gate: string | null;
};

const iata = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Z]{3}$/.test(v);
const isoTime = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const month = (v: string | null) =>
  v && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null;
const smallInt = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 100 ? v : null;
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
const cabin = (v: unknown) =>
  v === 0 ? "economy" : v === 1 ? "business" : v === 2 ? "first" : null;

/** `search_date=DDMMYYYY` in the deep link. Undocumented: stored, never used for labels. */
export function linkSearchDate(link: unknown): string | null {
  if (typeof link !== "string") return null;
  const m = /[?&]search_date=(\d{2})(\d{2})(\d{4})(?:&|$)/.exec(link);
  if (!m) return null;
  const date = `${m[3]}-${m[2]}-${m[1]}`;
  return Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().startsWith(date)
    ? date
    : null;
}

function endpointOf(path: string): FareEndpoint | undefined {
  return Object.values(FARE_ENDPOINTS).find((e) => path.endsWith(`/${e}`));
}

/** Normalizes a stored-endpoint response. Rows that fail validation are dropped, never repaired. */
export function parseFareFetch(
  url: string,
  body: unknown,
  fetchedAt: string,
  httpDate: string | null,
):
  | { fetch: FareFetchRecord; observations: FareObservationRecord[] }
  | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  const endpoint = endpointOf(parsed.pathname);
  const q = parsed.searchParams;
  const origin = q.get("origin");
  if (!endpoint || !iata(origin) || !body || typeof body !== "object") return;
  const b = body as Record<string, unknown>;
  // nearest-places-matrix puts its rows at the top level, the others under data.
  const rows = endpoint === FARE_ENDPOINTS.nearestPlaces ? b.prices : b.data;
  // An empty response states currency "" (live get_latest_prices, 2026-10-28). With no
  // rows there is nothing to price, so the requested currency identifies it and the
  // absence is recorded. Rows with an empty currency are still rejected.
  const stated =
    b.currency === "" && Array.isArray(rows) && rows.length === 0
      ? undefined
      : b.currency;
  const currency = String(stated ?? q.get("currency") ?? "").toUpperCase();
  if (!Array.isArray(rows) || !isCurrency(currency)) return;
  const scale = 10 ** currencyMetadata[currency].minorUnits;
  const observations: FareObservationRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const departure =
      endpoint === FARE_ENDPOINTS.pricesForDates
        ? r.departure_at
        : r.depart_date;
    const ret =
      endpoint === FARE_ENDPOINTS.pricesForDates ? r.return_at : r.return_date;
    const price = endpoint === FARE_ENDPOINTS.latestPrices ? r.value : r.price;
    const rowOrigin =
      endpoint === FARE_ENDPOINTS.nearestPlaces ? r.origin : origin;
    if (
      !iata(rowOrigin) ||
      !iata(r.destination) ||
      !isoTime(departure) ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0
    )
      continue;
    observations.push({
      endpoint,
      fetchedAt,
      fareObservedAt:
        endpoint === FARE_ENDPOINTS.pricesForDates
          ? null
          : providerFoundAt(r.found_at),
      actual: typeof r.actual === "boolean" ? r.actual : null,
      providerLinkSearchDate: linkSearchDate(r.link),
      origin: rowOrigin,
      originAirport: iata(r.origin_airport) ? r.origin_airport : null,
      destination: r.destination,
      destinationAirport: iata(r.destination_airport)
        ? r.destination_airport
        : null,
      departureAt: new Date(departure).toISOString(),
      returnAt: isoTime(ret) ? new Date(ret).toISOString() : null,
      departureDate: departure.slice(0, 10),
      returnDate: isoTime(ret) ? ret.slice(0, 10) : null,
      cabin: cabin(r.trip_class),
      travellers: 1,
      priceMinor: Math.round(price * scale),
      currency,
      transfers: smallInt(r.transfers ?? r.number_of_changes),
      returnTransfers: smallInt(r.return_transfers),
      airline: text(r.airline ?? r.main_airline, 3),
      gate: text(r.gate, 80),
    });
  }
  const destination = q.get("destination");
  return {
    fetch: {
      fetchedAt,
      httpDate,
      endpoint,
      origin,
      destination: iata(destination) ? destination : null,
      departureMonth: month(
        q.get("departure_at") ??
          q.get("beginning_of_period") ??
          q.get("depart_date"),
      ),
      returnMonth: month(q.get("return_at") ?? q.get("return_date")),
      currency,
      market: text(q.get("market"), 8),
      rawPayload: body,
    },
    observations,
  };
}

export type FareWarmConfig = {
  monthsAhead: number;
  /** Origin × month pairs per run; each pair is two calls (itineraries + latest). */
  pairsPerRun: number;
  /** Route calls per run; each route is one year-period latest-prices call. */
  routesPerRun: number;
  origins: { code: string; currency: string }[];
  routes?: { origins: string[]; destinations: string[]; currency: string };
};
export type FareWarmPair = { origin: string; currency: string; month: string };
export type FareWarmRoute = {
  origin: string;
  destination: string;
  currency: string;
};

/**
 * Deterministic rotation by hours since epoch: no stored cursor, and every item is
 * covered within ceil(items / perRun) hours even when that exceeds a day.
 */
function rotate<T>(items: T[], perRun: number, now: Date): T[] {
  if (!items.length || perRun < 1) return [];
  const runs = Math.ceil(items.length / perRun);
  const slot = Math.floor(now.valueOf() / 3_600_000) % runs;
  return items.slice(slot * perRun, (slot + 1) * perRun);
}

/** Every origin × month from `now`'s month for `monthsAhead` months. */
export function warmPairs(config: FareWarmConfig, now: Date): FareWarmPair[] {
  const months = Array.from({ length: config.monthsAhead }, (_, i) => {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1),
    );
    return d.toISOString().slice(0, 7);
  });
  return config.origins
    .filter((o) => iata(o.code) && isCurrency(o.currency))
    .flatMap((o) =>
      months.map((m) => ({ origin: o.code, currency: o.currency, month: m })),
    );
}

export function warmSlice(config: FareWarmConfig, now: Date): FareWarmPair[] {
  return rotate(warmPairs(config, now), config.pairsPerRun, now);
}

/** Every origin × destination, including routes that return nothing today. */
export function warmRoutes(config: FareWarmConfig): FareWarmRoute[] {
  const r = config.routes;
  if (!r || !isCurrency(r.currency)) return [];
  return r.origins
    .filter(iata)
    .flatMap((origin) =>
      r.destinations
        .filter((d) => iata(d) && d !== origin)
        .map((destination) => ({ origin, destination, currency: r.currency })),
    );
}

export function warmRouteSlice(
  config: FareWarmConfig,
  now: Date,
): FareWarmRoute[] {
  return rotate(warmRoutes(config), config.routesPerRun, now);
}

/** Up to `limit` recent observations, one per destination, cheapest per destination. */
export type RecentObservation = {
  destination: string;
  departureDate: string;
  returnDate: string;
  priceMinor: number;
  currency: string;
  fetchedAt: string;
  fareObservedAt: string | null;
};
