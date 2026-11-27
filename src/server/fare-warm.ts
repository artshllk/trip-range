import {
  parseFareFetch,
  warmPairs,
  warmRouteSlice,
  warmRoutes,
  warmSlice,
  type FareWarmConfig,
  type FareWarmPair,
  type FareWarmRoute,
} from "../domain/fare-store";
import {
  latestPricesUrl,
  pricesForDatesUrl,
} from "../providers/server/travelpayouts";
import type { ProviderAdmission } from "./provider-admission";

const HOUR_MS = 3_600_000;

/** The hourly slots a run covers: the `hours`-long window, aligned to a multiple of
 * `hours` since the epoch, that contains `now`. A late scheduled run still covers its
 * own window; a skipped run's slots come round again with the rotation. */
export function warmHours(now: Date, hours = 1): Date[] {
  const hour = Math.floor(now.valueOf() / HOUR_MS);
  const start = hour - (hour % hours);
  return Array.from(
    { length: hours },
    (_, i) => new Date((start + i) * HOUR_MS),
  );
}

/** Provider calls for the given pairs and routes. Per origin-month: itineraries (no
 * return_at, so trips returning next month survive) and the found_at-bearing latest
 * prices. Per route: one year-period latest-prices call, empty or not. Every
 * successful response is recorded by the flight cache loader; an empty one becomes
 * outcome 'empty'. */
export function requestsFor(pairs: FareWarmPair[], routes: FareWarmRoute[]) {
  const urls = [
    ...pairs.flatMap((p) => [
      pricesForDatesUrl({
        origin: p.origin,
        departureMonth: p.month,
        currency: p.currency,
      }),
      latestPricesUrl({
        origin: p.origin,
        month: p.month,
        currency: p.currency,
      }),
    ]),
    ...routes.map((r) =>
      latestPricesUrl({
        origin: r.origin,
        destination: r.destination,
        currency: r.currency,
      }),
    ),
  ].map((url) => url.toString());
  return { pairs, routes, urls: [...new Set(urls)] };
}

/** Clock rotation for the given hourly slots (the site's warm route). The GitHub
 * Actions runner uses stalenessPlan instead: dropped scheduled runs would leave whole
 * slots uncovered under a clock rotation (49 of 150 routes for 48 h, 2026-11-01). */
export function warmRequests(config: FareWarmConfig, slots: Date[]) {
  return requestsFor(
    slots.flatMap((slot) => warmSlice(config, slot)),
    slots.flatMap((slot) => warmRouteSlice(config, slot)),
  );
}

/** Staleness key shared by selection and attempt records: route or origin-month. */
export const routeKey = (r: { origin: string; destination: string }) =>
  `${r.origin.trim()}|${r.destination.trim()}|`;
export const pairKey = (p: { origin: string; month: string }) =>
  `${p.origin.trim()}||${p.month}`;

/** The `n` items seen least recently (never-seen first); ties keep list order. */
export function selectStalest<T>(
  items: T[],
  keyOf: (item: T) => string,
  lastSeen: Map<string, number>,
  n: number,
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      at: lastSeen.get(keyOf(item)) ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .slice(0, Math.max(0, n))
    .map((x) => x.item);
}

/**
 * The runner's plan: the stalest routes and origin-month pairs, by last attempt or
 * fetch, whichever windows GitHub happened to run. A failed attempt counts as seen,
 * so an item that always errors moves to the back instead of taking every run.
 */
export function stalenessPlan(
  config: FareWarmConfig,
  now: Date,
  lastSeen: Map<string, number>,
  hours: number,
) {
  return requestsFor(
    selectStalest(
      warmPairs(config, now),
      pairKey,
      lastSeen,
      config.pairsPerRun * hours,
    ),
    selectStalest(
      warmRoutes(config),
      routeKey,
      lastSeen,
      config.routesPerRun * hours,
    ),
  );
}

/** Legacy in-memory run cap for offline planning tests only. Live collection uses
 * collectorHttp and the shared endpoint admission; this cap cannot replace it. */
export function runnerAdmission(cap: number): ProviderAdmission {
  let used = 0;
  return async (signal) => {
    if (signal.aborted) return "timeout";
    if (used >= cap) return "quota";
    used++;
    return "allowed";
  };
}

/** Identity of one stored fetch: what was asked, not what came back. */
export type FetchIdentity = {
  endpoint: string;
  origin: string;
  destination: string | null;
  departure_month: string | null;
  currency: string;
};
/** A header is not a receipt: its payload and normalized rows commit later. */
export type StoredFetch = FetchIdentity & {
  id: string;
  row_count: number;
  stored_rows: number;
  payload_present: boolean;
};

export function isCompleteFetch(fetch: StoredFetch): boolean {
  return (
    fetch.payload_present === true &&
    Number.isSafeInteger(fetch.row_count) &&
    fetch.row_count >= 0 &&
    fetch.stored_rows === fetch.row_count
  );
}

/** Partial receipts must fail even if a complete duplicate covers their identity. */
export function warmWriteStatus(
  planned: number,
  missing: number,
  incomplete: number,
  recovered: number,
  pruned: boolean,
): string {
  if (missing || incomplete)
    return `failed: ${missing} of ${planned} planned call(s) lack complete storage; ${incomplete} incomplete fetch(es)`;
  if (!pruned) return "failed: fare-store pruning failed";
  return recovered
    ? `ok: all ${planned} planned calls completely stored (${recovered} late response(s) recovered)`
    : `ok: all ${planned} planned calls completely stored`;
}

const identityKey = (f: FetchIdentity) =>
  [
    f.endpoint,
    f.origin.trim(),
    f.destination?.trim() ?? "",
    f.departure_month ?? "",
    f.currency.trim().toUpperCase(),
  ].join("|");

/** The identity a planned URL's stored fetch must have, derived from the URL alone. */
export function plannedIdentity(url: string): FetchIdentity | undefined {
  const parsed = parseFareFetch(
    url,
    { data: [] },
    new Date(0).toISOString(),
    null,
  );
  if (!parsed) return;
  const f = parsed.fetch;
  return {
    endpoint: f.endpoint,
    origin: f.origin,
    destination: f.destination,
    departure_month: f.departureMonth,
    currency: f.currency,
  };
}

/**
 * Planned calls with no complete fetch of their own. Totals can hide a loss (one missing
 * write plus one unplanned extra nets to zero), so every planned call is matched by
 * identity. A planned call with no row is a loss whatever the cause: provider failure,
 * unparseable response or store write.
 */
export function missingPlanned(
  urls: string[],
  stored: StoredFetch[],
): string[] {
  const have = new Set(stored.filter(isCompleteFetch).map(identityKey));
  return urls.filter((url) => {
    const id = plannedIdentity(url);
    return !id || !have.has(identityKey(id));
  });
}
