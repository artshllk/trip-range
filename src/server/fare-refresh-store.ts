import "server-only";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { parseFareFetch } from "../domain/fare-store";
import {
  originAirports,
  refreshEndpoint,
  refreshHealth,
  type RefreshReceipt,
} from "../domain/fare-refresh";
import type { MonthFare } from "../domain/month-discovery";
type Sql = NeonQueryFunction<false, false>;
type Parsed = NonNullable<ReturnType<typeof parseFareFetch>>;

// Keep payload, normalized rows and the run's receipt atomic. The fetch and receipt
// share the database's transaction timestamp, endpoint, origin, destination and currency.
export async function storeRefreshPage(sql: Sql, parsed: Parsed, run: string) {
  const f = parsed.fetch;
  const observations = parsed.observations.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()),
        value,
      ]),
    ),
  );
  await sql`
    with header as (
      insert into fare_fetches(fetched_at,http_date,endpoint,origin,destination,departure_month,return_month,currency,market,row_count)
      values (now(),${f.httpDate},${f.endpoint},${f.origin},${f.destination},${f.departureMonth},${f.returnMonth},${f.currency},${f.market},${observations.length}) returning id
    ), payload as (
      insert into fare_payloads(fetch_id,raw_payload) select id,${JSON.stringify(f.rawPayload)}::jsonb from header
    ), observations as (
      insert into fare_observations(fetch_id,endpoint,fetched_at,fare_observed_at,actual,provider_link_search_date,origin,origin_airport,destination,destination_airport,departure_at,return_at,departure_date,return_date,cabin,travellers,price_minor,currency,transfers,return_transfers,airline,gate)
      select header.id,r.endpoint,now(),r.fare_observed_at,r.actual,r.provider_link_search_date,r.origin,r.origin_airport,r.destination,r.destination_airport,r.departure_at,r.return_at,r.departure_date,r.return_date,r.cabin,r.travellers,r.price_minor,r.currency,r.transfers,r.return_transfers,r.airline,r.gate
      from header cross join jsonb_populate_recordset(null::fare_observations,${JSON.stringify(observations)}::jsonb) r
    )
    insert into warm_attempts(attempted_at,run_id,endpoint,origin,destination,departure_month,currency,outcome)
    select now(),${run},${f.endpoint},${f.origin},${f.destination},${f.departureMonth},${f.currency},'stored' from header`;
}

export async function finishRefresh(
  sql: Sql,
  run: string,
  origin: string,
  month: string,
  failure?: string,
) {
  await sql`insert into warm_attempts(run_id,endpoint,origin,departure_month,currency,outcome,reason)
    values(${run},${refreshEndpoint},${origin},${month},'EUR',${failure ? "failed" : "stored"},${failure ?? null})`;
}

export async function refreshReceipt(
  sql: Sql,
  origin: string,
  month: string,
  day?: string,
) {
  const rows = await sql`select run_id,outcome,attempted_at,
    max(attempted_at) filter(where outcome='stored') over() as last_success
    from warm_attempts where endpoint=${refreshEndpoint} and origin=${origin} and departure_month=${month}
    and (${day ?? null}::date is null or (attempted_at at time zone 'Europe/Belgrade')::date=${day ?? null}::date)
    order by run_id desc, id desc limit 1`;
  const latest = rows[0] as
    | (RefreshReceipt & { last_success: string | null })
    | undefined;
  return {
    latest,
    health: refreshHealth(
      latest,
      latest?.last_success ?? undefined,
      day && latest ? new Date(latest.attempted_at).getTime() : Date.now(),
    ),
  };
}

// Run diagnostics and store coverage share eligibility rules. A store snapshot
// unions all atomically stored matched pairs, including usable pages of a partial
// run. It never joins an itinerary to a timestamp from a different run.
export function reproducedFares(
  sql: Sql,
  run: string,
  origin: string,
  month: string,
  at: string,
) {
  return matchedFares(sql, run, origin, month, at);
}

export function storedCoverageFares(
  sql: Sql,
  origin: string,
  month: string,
  at: string,
  observedSince?: string,
  excludedRun?: string,
) {
  return matchedFares(sql, null, origin, month, at, observedSince, excludedRun);
}

async function matchedFares(
  sql: Sql,
  run: string | null,
  origin: string,
  month: string,
  at: string,
  observedSince?: string,
  excludedRun?: string,
): Promise<MonthFare[]> {
  const airports = originAirports(origin);
  const rows = await sql`with owned as materialized (
    select f.id,a.run_id from warm_attempts a join fare_fetches f on
      f.fetched_at=a.attempted_at and f.origin=a.origin and f.endpoint=a.endpoint and f.currency=a.currency and f.destination is not distinct from a.destination
    where (${run}::text is null or a.run_id=${run}) and a.origin=${origin} and a.outcome='stored' and a.endpoint<>${refreshEndpoint}
      and (${excludedRun ?? null}::text is null or a.run_id<>${excludedRun ?? null})
      and a.attempted_at<=${at}::timestamptz and f.fetched_at<=${at}::timestamptz
      -- Lower bound (26 November 2026): a sighting counts only if observed in the 7
      -- days before the cutoff, and a fare is fetched after it is observed, so any
      -- matching run started within those 7 days. 8 days leaves a day of margin for a
      -- long run. Without it the scan grows with all history and timed out (>300 s).
      and a.attempted_at>${at}::timestamptz - interval '8 days' and f.fetched_at>${at}::timestamptz - interval '8 days'
  ), obs as materialized (
    select o.*,owned.run_id from owned join fare_observations o on o.fetch_id=owned.id
    where o.origin=${origin} and o.currency='EUR' and o.travellers=1 and o.actual is distinct from false and (o.cabin is null or o.cabin='economy')
      and o.fetched_at<=${at}::timestamptz
      and o.departure_date >= (${month}||'-01')::date and o.departure_date < (${month}||'-01')::date + interval '1 month' and o.return_date=o.departure_date+2
  ), matched as (
    -- One pass instead of a self-join (26 November 2026). A group is one run's
    -- fare for a destination, dates and price; it counts when it holds a dated
    -- price with a known airport and a sighting in the 7 days before the cutoff.
    -- Within a group the price is fixed, so the former order "cheapest, then most
    -- recently seen, then first airport" picks the group's latest sighting and its
    -- first airport. The self-join was planned as a nested loop over every
    -- observation pair and did not finish in 300 s for London.
    select run_id,destination,departure_date,return_date,price_minor,
      min(destination_airport) filter (where endpoint='aviasales/v3/prices_for_dates' and destination_airport is not null
        and (origin_airport is null or origin_airport=any(${airports}::text[]))) as airport,
      max(fare_observed_at) filter (where endpoint='aviasales/v3/get_latest_prices'
        and fare_observed_at between ${at}::timestamptz - interval '7 days' and ${at}::timestamptz
        and (${observedSince ?? null}::timestamptz is null or fare_observed_at>=${observedSince ?? null}::timestamptz)) as seen
    from obs group by run_id,destination,departure_date,return_date,price_minor
  )
  select distinct on (destination,departure_date) destination,airport,departure_date::text as departure,return_date::text as returning,
    price_minor*2 as party_cents,seen
  from matched where airport is not null and seen is not null
  order by destination,departure_date,price_minor,seen desc,airport`;
  return rows.map((r) => ({
    destination: r.destination,
    airport: r.airport,
    departure: r.departure,
    returning: r.returning,
    partyCents: Number(r.party_cents),
    observedAt: new Date(r.seen).toISOString(),
  }));
}

export async function coverageCutoff(sql: Sql, day: string) {
  const [row] =
    await sql`select (${day}::date + time '09:00') at time zone 'Europe/Belgrade' as cutoff`;
  return new Date(row.cutoff).toISOString();
}
