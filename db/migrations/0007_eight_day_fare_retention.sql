-- Owner decision, 27 November 2026 (storage option C, with variable trip length):
-- fare observations, their fetch headers and page receipts are kept 8 days instead
-- of 10. Nothing reads further back than 8 days: /plan uses sightings from the last
-- 7 days, and the coverage query bounds its scan to 8 days before the cutoff. The
-- consequence: a coverage day can no longer be recomputed long after the fact, so
-- the daily Warm coverage workflow's stored result (90-day artifact) is the record.
-- Unchanged: raw fare replies 2 days; month-completion receipts 90 days.
-- Measured reason: two- plus three-night collection (and seven nights for London
-- and Warsaw) roughly doubles fare rows; at 10 days the store would approach the
-- 1 GB cluster limit at month start (docs/storage-monitoring.md).
--
-- One transaction, like 0006: it replaces prune_fare_store(), runs the first clean-up,
-- checks the result and commits, or rolls back with -v rehearse=1. Any error stops
-- psql (ON_ERROR_STOP) before COMMIT, so nothing is ever half-applied.
-- Run as the database owner, on a direct (non-pooled) connection, after the dry run:
--   psql "$OWNER_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v rehearse=1 -f db/migrations/0007_eight_day_fare_retention.sql
--   psql "$OWNER_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/migrations/0007_eight_day_fare_retention.sql
-- Neon Free keeps 6 hours of history: a committed run can be undone only by a Neon
-- point-in-time restore to before the printed transaction time, within 6 hours.
\set ON_ERROR_STOP on
\pset footer off
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Holds collector and planner writes for the seconds this takes, so the counts are
-- exact. Site reads are not blocked. If a sweep is writing, this fails after 10 s.
lock table fare_fetches, fare_payloads, fare_observations, warm_attempts
  in share row exclusive mode;

select now() as transaction_time \gset
\echo '== 0007: one transaction started at' :transaction_time '=='
\echo '   Neon point-in-time restore target if this must be undone (6-hour window on Free): just before that time.'

create temp table r0007_plan on commit drop as
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
select tbl, count(*) as n, min(at) as oldest, max(at) as newest, sum(bytes) as bytes
  from r0007 group by tbl;
create temp table r0007_before on commit drop as
select 'fare_payloads'::text as tbl, count(*) as n from fare_payloads
union all select 'fare_observations', count(*) from fare_observations
union all select 'fare_fetches', count(*) from fare_fetches
union all select 'warm_attempts', count(*) from warm_attempts;

\echo '== Rows to delete, by table (must match the dry run) =='
select tbl as "table", n as rows_to_delete, oldest, newest, pg_size_pretty(bytes) as stored_size
  from r0007_plan order by tbl;

create or replace function prune_fare_store() returns void
language sql security definer set search_path = public as $$
  delete from fare_payloads p using fare_fetches f
    where p.fetch_id = f.id and f.fetched_at < now() - interval '2 days';
  delete from fare_observations where fetched_at < now() - interval '8 days';
  delete from fare_fetches f where f.fetched_at < now() - interval '8 days'
    and not exists (select 1 from fare_observations o where o.fetch_id = f.id)
    and not exists (select 1 from fare_payloads p where p.fetch_id = f.id);
  delete from warm_attempts where attempted_at < now() - interval '8 days'
    and endpoint <> 'triprange/exact-two-night-refresh-v1';
  delete from warm_attempts where attempted_at < now() - interval '90 days';
$$;

select prune_fare_store();

create temp table r0007_after on commit drop as
select 'fare_payloads'::text as tbl, count(*) as n from fare_payloads
union all select 'fare_observations', count(*) from fare_observations
union all select 'fare_fetches', count(*) from fare_fetches
union all select 'warm_attempts', count(*) from warm_attempts;

do $check$
declare mismatch text;
begin
  select string_agg(b.tbl || ': before ' || b.n || ', planned ' || coalesce(p.n, 0)
                    || ', after ' || a.n, '; ')
    into mismatch
    from r0007_before b
    join r0007_after a using (tbl)
    left join (select case when tbl like 'warm_attempts%' then 'warm_attempts' else tbl end as tbl,
                      sum(n) as n
                 from r0007_plan group by 1) p using (tbl)
   where a.n <> b.n - coalesce(p.n, 0);
  if mismatch is not null then
    raise exception '0007 STOP: deleted rows differ from the plan: %', mismatch;
  end if;
  if exists (select 1 from fare_payloads p join fare_fetches f on f.id = p.fetch_id
              where f.fetched_at < now() - interval '2 days') then
    raise exception '0007 STOP: raw replies older than 2 days remain';
  end if;
  if exists (select 1 from fare_observations where fetched_at < now() - interval '8 days') then
    raise exception '0007 STOP: fare rows older than 8 days remain';
  end if;
  if exists (select 1 from warm_attempts where attempted_at < now() - interval '8 days'
                and endpoint <> 'triprange/exact-two-night-refresh-v1') then
    raise exception '0007 STOP: page receipts older than 8 days remain';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.prune_fare_store()'::regprocedure) then
    raise exception '0007 STOP: prune_fare_store is no longer SECURITY DEFINER';
  end if;
  if not has_function_privilege('fare_app', 'public.prune_fare_store()', 'execute') then
    raise exception '0007 STOP: fare_app can no longer execute prune_fare_store';
  end if;
end
$check$;

\echo '== Rows in each table after the clean-up (before = after + deleted, checked) =='
select b.tbl as "table", b.n as before, a.n as after, b.n - a.n as deleted
  from r0007_before b join r0007_after a using (tbl) order by 1;

\if :{?rehearse}
rollback;
\echo '== 0007 REHEARSAL OK: everything above was rolled back. Nothing changed. =='
\else
commit;
\echo '== 0007 COMMITTED. =='
\endif
