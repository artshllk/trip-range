/**
 * Read-only report over the fare store, for deriving freshness tiers from data instead
 * of hand-picked thresholds. Run after at least a week of warm-job runs:
 *   DATABASE_URL=… npm run report:fare-ages            (default window: 7 days)
 *   DATABASE_URL=… npm run report:fare-ages -- 14
 * Age = when we fetched it minus the provider's found_at. Each distinct observation
 * (route, dates, price, found_at) counts once, however many times it was fetched.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const days = Number(process.argv[2] ?? 7);
if (!Number.isInteger(days) || days < 1 || days > 400) {
  console.error("window must be 1–400 days");
  process.exit(1);
}
const sql = neon(url);

const ages = await sql`
  with distinct_obs as (
    select origin, destination, departure_date, return_date, price_minor,
           fare_observed_at, min(fetched_at) as first_fetched
    from fare_observations
    where fare_observed_at is not null
      and fetched_at > now() - make_interval(days => ${days})
    group by 1, 2, 3, 4, 5, 6
  )
  select origin,
         count(*)::int as observations,
         round(extract(epoch from percentile_cont(0.10) within group (order by first_fetched - fare_observed_at)) / 3600, 1) as p10_h,
         round(extract(epoch from percentile_cont(0.25) within group (order by first_fetched - fare_observed_at)) / 3600, 1) as p25_h,
         round(extract(epoch from percentile_cont(0.50) within group (order by first_fetched - fare_observed_at)) / 3600, 1) as p50_h,
         round(extract(epoch from percentile_cont(0.75) within group (order by first_fetched - fare_observed_at)) / 3600, 1) as p75_h,
         round(extract(epoch from percentile_cont(0.90) within group (order by first_fetched - fare_observed_at)) / 3600, 1) as p90_h
  from distinct_obs
  group by rollup (origin)
  order by origin nulls first`;

const histogram = await sql`
  with distinct_obs as (
    select distinct origin, destination, departure_date, return_date, price_minor,
           fare_observed_at,
           extract(epoch from (fetched_at - fare_observed_at)) / 3600 as age_h
    from fare_observations
    where fare_observed_at is not null
      and fetched_at > now() - make_interval(days => ${days})
  )
  select case
           when age_h < 12 then '0–12h' when age_h < 24 then '12–24h'
           when age_h < 48 then '24–48h' when age_h < 72 then '48–72h'
           when age_h < 120 then '72–120h' when age_h < 168 then '120–168h'
           else '≥168h' end as bucket,
         count(*)::int as observations
  from distinct_obs group by 1 order by min(age_h)`;

const actual = await sql`
  select actual, count(*)::int as rows
  from fare_observations
  where endpoint = 'aviasales/v3/get_latest_prices'
    and fetched_at > now() - make_interval(days => ${days})
  group by 1 order by 1`;

// Re-reading the same cache every warm cycle re-observes the same fares. Only rows
// with a found_at count, and each identity counts once whatever endpoint or fetch it
// came through: observation = route, currency, dates, price, found_at; fare = the same
// without found_at (one price for one itinerary, however often it was re-found).
const samples = await sql`
  with obs as (
    select origin, destination, currency, departure_date, return_date,
           price_minor, fare_observed_at
    from fare_observations
    where fare_observed_at is not null
      and travellers = 1 and coalesce(cabin, 'economy') = 'economy'
      and actual is distinct from false
      and fetched_at > now() - make_interval(days => ${days})
  )
  select origin, destination, currency,
         count(*)::int as raw_rows,
         count(distinct (departure_date, return_date, price_minor, fare_observed_at))::int as unique_observations,
         count(distinct (departure_date, return_date, price_minor))::int as unique_fares,
         count(distinct departure_date)::int as departure_dates,
         count(distinct fare_observed_at::date)::int as found_at_days,
         min(fare_observed_at)::date as first_found_at,
         max(fare_observed_at)::date as last_found_at,
         round(count(*)::numeric / nullif(count(distinct (departure_date, return_date, price_minor, fare_observed_at)), 0), 1) as rows_per_observation,
         (count(distinct (departure_date, return_date, price_minor)) >= 8
           and count(distinct fare_observed_at::date) >= 3
           and count(distinct departure_date) >= 4
           and max(fare_observed_at) > now() - interval '14 days') as meets_minimums
  from obs
  group by origin, destination, currency
  order by unique_observations desc`;

const coverage = await sql`
  select * from route_coverage
  where last_fetched_at > now() - make_interval(days => ${days})
  order by origin, destination nulls first`;

console.log(`\nFare store report: last ${days} days\n`);
console.log("Observation age at fetch (hours), distinct observations:");
console.table(ages.map((r) => ({ origin: r.origin ?? "ALL", ...r })));
console.log("Age histogram:");
console.table(histogram);
console.log(
  "`actual` values on get_latest_prices rows (false never observed = unproven signal):",
);
console.table(actual);
const empty = coverage.filter((r) => r.rows_fetches === 0);
console.log(
  `Routes fetched: ${coverage.length}; always empty: ${empty.length}; ` +
    `with rows at least once: ${coverage.length - empty.length}`,
);
console.table(coverage.slice(0, 60));
const sum = (k) => samples.reduce((n, r) => n + r[k], 0);
console.log(
  `\nSample per route (found_at rows only, deduplicated): ${sum("raw_rows")} raw rows = ` +
    `${sum("unique_observations")} unique observations = ${sum("unique_fares")} unique fares ` +
    `across ${samples.length} routes; ${samples.filter((r) => r.meets_minimums).length} meet the ` +
    `historical-range minimums at route level (before the ±21-day / ±2-night window).`,
);
console.table(samples.slice(0, 80));
const all = ages.find((r) => r.origin === null);
if (all?.observations)
  console.log(
    `\nCandidate tiers from data (proposal, not applied): green ≤ p25 = ${all.p25_h} h, ` +
      `amber > p75 = ${all.p75_h} h. Current provisional: green < 12 h, amber > 72 h.`,
  );
