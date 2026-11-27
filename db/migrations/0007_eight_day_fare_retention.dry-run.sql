-- Dry run for 0007 (owner decision, 27 November 2026: fare rows 8 days, not 10).
-- Read-only: prints what 0007 would delete. Run it before 0007, on the same
-- direct connection, and compare its table with 0007's printed plan.
--
--   psql "$OWNER_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/migrations/0007_eight_day_fare_retention.dry-run.sql
\set ON_ERROR_STOP on
\pset footer off
begin transaction isolation level repeatable read read only;

\echo '== 0007 DRY RUN: nothing is deleted. Boundaries: =='
select now() as measured_at,
       now() - interval '2 days' as raw_reply_cutoff,
       now() - interval '8 days' as fare_row_cutoff,
       now() - interval '90 days' as completion_receipt_cutoff;

\echo '== Rows to delete, by table =='
with r0007 as (
  select 'fare_payloads'::text as tbl, f.fetched_at as at, pg_column_size(p.raw_payload)::bigint as bytes
    from fare_payloads p join fare_fetches f on f.id = p.fetch_id
    where f.fetched_at < now() - interval '2 days'
  union all
  select 'fare_observations', o.fetched_at, pg_column_size(o.*)::bigint
    from fare_observations o where o.fetched_at < now() - interval '8 days'
  union all
  -- A header goes once its observations and raw reply are gone. A header older than
  -- eight days has a raw reply older than two days, so only observations can keep it.
  select 'fare_fetches', f.fetched_at, pg_column_size(f.*)::bigint
    from fare_fetches f
    where f.fetched_at < now() - interval '8 days'
      and not exists (select 1 from fare_observations o
                      where o.fetch_id = f.id and o.fetched_at >= now() - interval '8 days')
  union all
  select 'warm_attempts: page receipts', a.attempted_at, pg_column_size(a.*)::bigint
    from warm_attempts a
    where a.attempted_at < now() - interval '8 days'
      and a.endpoint <> 'triprange/exact-two-night-refresh-v1'
  union all
  select 'warm_attempts: completion receipts', a.attempted_at, pg_column_size(a.*)::bigint
    from warm_attempts a
    where a.attempted_at < now() - interval '90 days'
      and a.endpoint = 'triprange/exact-two-night-refresh-v1'
)
select tbl as "table", count(*) as rows_to_delete, min(at) as oldest, max(at) as newest,
       pg_size_pretty(sum(bytes)) as stored_size
  from r0007 group by tbl order by tbl;

\echo '== Rows to delete, by table and UTC day =='
with r0007 as (
  select 'fare_payloads'::text as tbl, f.fetched_at as at, pg_column_size(p.raw_payload)::bigint as bytes
    from fare_payloads p join fare_fetches f on f.id = p.fetch_id
    where f.fetched_at < now() - interval '2 days'
  union all
  select 'fare_observations', o.fetched_at, pg_column_size(o.*)::bigint
    from fare_observations o where o.fetched_at < now() - interval '8 days'
  union all
  -- A header goes once its observations and raw reply are gone. A header older than
  -- eight days has a raw reply older than two days, so only observations can keep it.
  select 'fare_fetches', f.fetched_at, pg_column_size(f.*)::bigint
    from fare_fetches f
    where f.fetched_at < now() - interval '8 days'
      and not exists (select 1 from fare_observations o
                      where o.fetch_id = f.id and o.fetched_at >= now() - interval '8 days')
  union all
  select 'warm_attempts: page receipts', a.attempted_at, pg_column_size(a.*)::bigint
    from warm_attempts a
    where a.attempted_at < now() - interval '8 days'
      and a.endpoint <> 'triprange/exact-two-night-refresh-v1'
  union all
  select 'warm_attempts: completion receipts', a.attempted_at, pg_column_size(a.*)::bigint
    from warm_attempts a
    where a.attempted_at < now() - interval '90 days'
      and a.endpoint = 'triprange/exact-two-night-refresh-v1'
)
select tbl as "table", (at at time zone 'UTC')::date as utc_day, count(*) as rows_to_delete
  from r0007 group by 1, 2 order by 1, 2;

\echo '== Rows in each table now =='
select 'fare_payloads'::text as tbl, count(*) as n from fare_payloads
union all select 'fare_observations', count(*) from fare_observations
union all select 'fare_fetches', count(*) from fare_fetches
union all select 'warm_attempts', count(*) from warm_attempts;

\echo '== Safety checks: the expected value is in each column name =='
with r0007 as (
  select 'fare_payloads'::text as tbl, f.fetched_at as at, pg_column_size(p.raw_payload)::bigint as bytes
    from fare_payloads p join fare_fetches f on f.id = p.fetch_id
    where f.fetched_at < now() - interval '2 days'
  union all
  select 'fare_observations', o.fetched_at, pg_column_size(o.*)::bigint
    from fare_observations o where o.fetched_at < now() - interval '8 days'
  union all
  -- A header goes once its observations and raw reply are gone. A header older than
  -- eight days has a raw reply older than two days, so only observations can keep it.
  select 'fare_fetches', f.fetched_at, pg_column_size(f.*)::bigint
    from fare_fetches f
    where f.fetched_at < now() - interval '8 days'
      and not exists (select 1 from fare_observations o
                      where o.fetch_id = f.id and o.fetched_at >= now() - interval '8 days')
  union all
  select 'warm_attempts: page receipts', a.attempted_at, pg_column_size(a.*)::bigint
    from warm_attempts a
    where a.attempted_at < now() - interval '8 days'
      and a.endpoint <> 'triprange/exact-two-night-refresh-v1'
  union all
  select 'warm_attempts: completion receipts', a.attempted_at, pg_column_size(a.*)::bigint
    from warm_attempts a
    where a.attempted_at < now() - interval '90 days'
      and a.endpoint = 'triprange/exact-two-night-refresh-v1'
)
select
  -- Observations owned by a stored collector page receipt: the rows the coverage and
  -- yield checks use: what 0007 removes that 0006 kept (fetched 8 to 10 days ago).
  (select count(*) from fare_observations o
     where o.fetched_at < now() - interval '8 days'
       and exists (select 1 from fare_fetches f join warm_attempts a
                     on f.fetched_at = a.attempted_at and f.origin = a.origin
                    and f.endpoint = a.endpoint and f.currency = a.currency
                    and f.destination is not distinct from a.destination
                   where f.id = o.fetch_id and a.outcome = 'stored'
                     and a.endpoint <> 'triprange/exact-two-night-refresh-v1'))
    as "collector_rows_deleted (0 before 26 Nov 17:58 UTC)",
  (select count(*) from r0007 where tbl = 'warm_attempts: completion receipts')
    as "completion_receipts_deleted (0 before 30 Jan 2027)",
  (select count(*) from r0007 where tbl = 'fare_observations' and at >= now() - interval '8 days')
    as "fare_rows_inside_10_days (always 0)";

rollback;
\echo '== 0007 DRY RUN finished: rolled back, nothing changed. =='
