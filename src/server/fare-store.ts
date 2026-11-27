import "server-only";
import { sharedReadCache } from "./shared-read-cache";
import { refreshReceipt } from "./fare-refresh-store";
import { originAirports } from "../domain/fare-refresh";
import { neon } from "@neondatabase/serverless";
import { serverEnvironment } from "../providers/server/environment";
import { reportDiagnostic } from "./observability";
import { parseFareFetch, type RecentObservation } from "../domain/fare-store";

/** A search never waits longer than this on the store; the write may still land. */
export const SEARCH_WRITE_TIMEOUT_MS = 1500;

function client(timeoutMs?: number) {
  const url = serverEnvironment().fareStore.databaseUrl;
  return url
    ? neon(
        url,
        timeoutMs
          ? { fetchOptions: { signal: AbortSignal.timeout(timeoutMs) } }
          : {},
      )
    : undefined;
}

let reportedMissing = false;
function missing() {
  if (reportedMissing) return;
  reportedMissing = true;
  reportDiagnostic({
    level: "warn",
    component: "store",
    operation: "fare-store-write",
    status: "disabled",
  });
}

/** Append one fetched provider response. Never throws: a store outage must not fail a search. */
export async function recordFareFetch(
  url: string,
  body: unknown,
  fetchedAt: string,
  httpDate: string | null,
  timeoutMs: number = SEARCH_WRITE_TIMEOUT_MS,
): Promise<void> {
  const parsed = parseFareFetch(url, body, fetchedAt, httpDate);
  if (!parsed) return;
  const sql = client();
  if (!sql) return missing();
  const { fetch: f, observations } = parsed;
  const write = (async () => {
    const [row] = await sql`
      insert into fare_fetches
        (fetched_at, http_date, endpoint, origin, destination,
         departure_month, return_month, currency, market, row_count)
      values (${f.fetchedAt}, ${f.httpDate}, ${f.endpoint}, ${f.origin},
              ${f.destination}, ${f.departureMonth}, ${f.returnMonth},
              ${f.currency}, ${f.market}, ${observations.length})
      returning id`;
    const fetchId = row.id as string;
    await sql.transaction([
      sql`insert into fare_payloads (fetch_id, raw_payload)
          values (${fetchId}, ${JSON.stringify(f.rawPayload)}::jsonb)`,
      ...observations.map(
        (o) => sql`
        insert into fare_observations
          (fetch_id, endpoint, fetched_at, fare_observed_at, actual,
           provider_link_search_date,
           origin, origin_airport, destination, destination_airport,
           departure_at, return_at, departure_date, return_date,
           cabin, travellers, price_minor, currency,
           transfers, return_transfers, airline, gate)
        values (${fetchId}, ${o.endpoint}, ${o.fetchedAt}, ${o.fareObservedAt},
                ${o.actual},
                ${o.providerLinkSearchDate}, ${o.origin}, ${o.originAirport},
                ${o.destination}, ${o.destinationAirport}, ${o.departureAt},
                ${o.returnAt}, ${o.departureDate}, ${o.returnDate}, ${o.cabin}, ${o.travellers}, ${o.priceMinor},
                ${o.currency}, ${o.transfers}, ${o.returnTransfers},
                ${o.airline}, ${o.gate})`,
      ),
    ]);
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      write,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    reportDiagnostic({
      level: "debug",
      component: "store",
      operation: "fare-store-write",
      status: "recorded",
      originCode: f.origin,
      count: observations.length,
    });
  } catch (error) {
    // Stopping waiting is not a failed write: the insert carries on and usually
    // lands. Only an error from the database itself is reported as failed.
    const timedOut = error instanceof Error && error.message === "timeout";
    reportDiagnostic({
      level: timedOut ? "warn" : "error",
      component: "store",
      operation: "fare-store-write",
      status: timedOut ? "timeout" : "failed",
      originCode: f.origin,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cheapest recent observation per destination for one origin, newest fetches only.
 * Returns [] when the store is unconfigured or unreachable: callers render the empty variant.
 */
export async function recentObservations(
  origin: string,
  currency: string,
  limit: number,
  maxAgeHours = 48,
): Promise<RecentObservation[]> {
  const sql = client();
  if (!sql || !/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(currency))
    return [];
  try {
    const rows = await sql`
      select distinct on (destination)
        destination, departure_date::text, return_date::text, price_minor, currency,
        fetched_at, fare_observed_at
      from fare_observations
      where origin = ${origin} and currency = ${currency}
        and fetched_at > now() - make_interval(hours => ${maxAgeHours})
        and departure_date > current_date
        and return_date is not null
        and actual is distinct from false
        and (fare_observed_at is null
             or fare_observed_at > now() - interval '7 days')
      -- Per destination: rows with a provider found_at first, then cheapest.
      order by destination, (fare_observed_at is null), price_minor asc,
               fetched_at desc`;
    return rows
      .map((r) => ({
        destination: String(r.destination),
        departureDate: String(r.departure_date),
        returnDate: String(r.return_date),
        priceMinor: Number(r.price_minor),
        currency: String(r.currency),
        fetchedAt: new Date(r.fetched_at).toISOString(),
        fareObservedAt: r.fare_observed_at
          ? new Date(r.fare_observed_at).toISOString()
          : null,
      }))
      .sort(
        (a, b) =>
          b.fetchedAt.localeCompare(a.fetchedAt) || a.priceMinor - b.priceMinor,
      )
      .slice(0, limit);
  } catch {
    reportDiagnostic({
      level: "error",
      component: "store",
      operation: "fare-store-read",
      status: "failed",
      originCode: origin,
    });
    return [];
  }
}

export async function pruneFareStore(): Promise<boolean> {
  const sql = client();
  if (!sql) return false;
  try {
    await sql`select prune_fare_store()`;
    return true;
  } catch {
    reportDiagnostic({
      level: "error",
      component: "store",
      operation: "fare-store-prune",
      status: "failed",
    });
    return false;
  }
}

/**
 * Match a detailed itinerary with an independently timestamped fare at the same unit
 * price, for one collected origin. An itinerary whose stated departure airport is
 * outside the origin's market (originAirports) is a conflicting origin and excluded.
 */
async function loadMonthFares(
  origin: string,
  start: string,
  endExclusive: string,
  nights: number,
): Promise<import("../domain/month-discovery").MonthFare[] | undefined> {
  const sql = client();
  if (!sql) return undefined;
  try {
    const rows = await sql.query(
      `
      with recent as (
        select destination, departure_date, return_date, price_minor, max(fare_observed_at) as observed
        from fare_observations
        where origin = $3 and currency = 'EUR' and actual is distinct from false
          and endpoint in ('aviasales/v3/get_latest_prices', 'v2/prices/nearest-places-matrix')
          and fetched_at >= now() - interval '7 days'
          and fare_observed_at between now() - interval '7 days' and now()
          and departure_date >= $1::date and departure_date < $2::date and return_date = departure_date + $5::int
          and (cabin is null or cabin = 'economy')
        group by destination, departure_date, return_date, price_minor
      )
      select distinct on (i.destination, i.departure_date) i.destination, i.destination_airport as airport,
        i.origin_airport, i.departure_date::text as departure, i.return_date::text as returning,
        i.price_minor * 2 as party_cents, r.observed
      from fare_observations i join recent r using (destination, departure_date, return_date, price_minor)
      where i.origin = $3 and i.currency = 'EUR' and i.endpoint = 'aviasales/v3/prices_for_dates'
        and i.fetched_at between now() - interval '7 days' and now()
        and i.actual is distinct from false and i.destination_airport is not null
        and i.destination <> $3
        and (i.origin_airport is null or i.origin_airport = any($4::text[]))
        and (i.cabin is null or i.cabin = 'economy')
      order by i.destination, i.departure_date, i.price_minor, r.observed desc, i.destination_airport
    `,
      [start, endExclusive, origin, originAirports(origin), nights],
      { fetchOptions: { signal: AbortSignal.timeout(4000) } },
    );
    return rows.map((r) => ({
      destination: r.destination,
      airport: r.airport,
      originAirport: r.origin_airport ?? null,
      departure: r.departure,
      returning: r.returning,
      partyCents: Number(r.party_cents),
      observedAt: new Date(r.observed).toISOString(),
    }));
  } catch {
    reportDiagnostic({
      level: "error",
      component: "store",
      operation: "fare-store-read",
      status: "failed",
      originCode: origin,
    });
    return undefined;
  }
}

async function loadMonthRefreshHealth(origin: string, months: string[]) {
  const sql = client(4000);
  type Health =
    | Awaited<ReturnType<typeof refreshReceipt>>["health"]
    | "unknown";
  const result: Record<string, Health> = {};
  let failed = !sql;
  await Promise.all(
    months.map(async (month) => {
      try {
        result[month] = sql
          ? (await refreshReceipt(sql, origin, month)).health
          : "unknown";
      } catch {
        failed = true;
        result[month] = "unknown";
      }
    }),
  );
  return { health: result, failed };
}

/**
 * Shared reads for /plan, cached for five minutes per origin and date window
 * (abuse controls, option A). Fares change twice a day and are up to seven days
 * old, so five minutes of staleness costs nothing, and database work stays
 * bounded by the number of origins and months, not by traffic.
 */
const PLAN_READ_TTL_MS = 5 * 60_000;
const fareReads = sharedReadCache<
  NonNullable<Awaited<ReturnType<typeof loadMonthFares>>>
>({ ttlMs: PLAN_READ_TTL_MS, maxEntries: 200 });
type MonthHealth = Awaited<ReturnType<typeof loadMonthRefreshHealth>>["health"];
const healthReads = sharedReadCache<MonthHealth>({
  ttlMs: PLAN_READ_TTL_MS,
  maxEntries: 200,
});

export function monthFares(
  origin: string,
  start: string,
  endExclusive: string,
  nights: number,
) {
  if (!Number.isInteger(nights) || nights < 1 || nights > 30)
    return Promise.resolve(undefined);
  // The length is part of the key: a three-night view must never get two-night rows.
  return fareReads(`${origin}|${start}|${endExclusive}|${nights}`, () =>
    loadMonthFares(origin, start, endExclusive, nights),
  );
}
export async function monthRefreshHealth(
  origin: string,
  months: string[],
): Promise<MonthHealth> {
  // A failed read is shown (every month "unknown") but never cached.
  let uncached: MonthHealth | undefined;
  const cached = await healthReads(
    `${origin}|${months.join(",")}`,
    async () => {
      const r = await loadMonthRefreshHealth(origin, months);
      uncached = r.health;
      return r.failed ? undefined : r.health;
    },
  );
  return (
    cached ??
    uncached ??
    Object.fromEntries(months.map((m) => [m, "unknown" as const]))
  );
}
