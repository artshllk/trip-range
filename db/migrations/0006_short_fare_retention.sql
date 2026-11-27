-- Owner decision, 23 November 2026 (PR #48, retention Policy A). Nothing reads a raw
-- fare reply, and no reader looks further back than ten days at fare rows: planner 48 h,
-- site discovery 7 d, coverage/yield checks 7 d before their cutoff (plus up to three
-- days for a late re-run), SEO hub review 10 d. Keep:
--   raw fare replies (fare_payloads)                        2 days
--   fare observations, their fetch headers, page receipts  10 days
--   month-completion receipts (catch-up/health history)    90 days, unchanged
-- Fetch headers stay as long as their observations: the coverage store joins page
-- receipts to fetch headers to observations.
--
-- This file replaces prune_fare_store() AND runs the first, large clean-up itself, in
-- ONE transaction, so the big deletion happens here under supervision rather than
-- unattended at the end of the next collector run. Steps:
--   1. lock the four fare tables against writes (reads continue; 10 s lock timeout)
--   2. print the rows it is about to delete (same table as the dry run)
--   3. replace the function and call it once
--   4. check: exactly the planned rows went, nothing older than the windows remains,
--      the function is still SECURITY DEFINER and executable by fare_app
--   5. COMMIT, or ROLLBACK when run with -v rehearse=1
-- Any error stops psql (ON_ERROR_STOP) before COMMIT; PostgreSQL then rolls back the
-- whole transaction, including the function change. Nothing is ever half-applied.
--
-- Run as the database owner, on a direct (non-pooled) connection, after the dry run:
--   psql "$OWNER_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v rehearse=1 -f db/migrations/0006_short_fare_retention.sql
--   psql "$OWNER_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/migrations/0006_short_fare_retention.sql
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
\echo '== 0006: one transaction started at' :transaction_time '=='
\echo '   Neon point-in-time restore target if this must be undone (6-hour window on Free): just before that time.'

create temp table r0006_plan on commit drop as
with r0006 as (
  select 'fare_payloads'::text as tbl, f.fetched_at as at, pg_column_size(p.raw_payload)::bigint as bytes
    from fare_payloads p join fare_fetches f on f.id = p.fetch_id
    where f.fetched_at < now() - interval '2 days'
  union all
  select 'fare_observations', o.fetched_at, pg_column_size(o.*)::bigint
    from fare_observations o where o.fetched_at < now() - interval '10 days'
  union all
  -- A header goes once its observations and raw reply are gone. A header older than
  -- ten days has a raw reply older than two days, so only observations can keep it.
  select 'fare_fetches', f.fetched_at, pg_column_size(f.*)::bigint
    from fare_fetches f
    where f.fetched_at < now() - interval '10 days'
      and not exists (select 1 from fare_observations o
                      where o.fetch_id = f.id and o.fetched_at >= now() - interval '10 days')
  union all
  select 'warm_attempts: page receipts', a.attempted_at, pg_column_size(a.*)::bigint
    from warm_attempts a
    where a.attempted_at < now() - interval '10 days'
      and a.endpoint <> 'triprange/exact-two-night-refresh-v1'
  union all
  select 'warm_attempts: completion receipts', a.attempted_at, pg_column_size(a.*)::bigint
    from warm_attempts a
    where a.attempted_at < now() - interval '90 days'
      and a.endpoint = 'triprange/exact-two-night-refresh-v1'
)
select tbl, count(*) as n, min(at) as oldest, max(at) as newest, sum(bytes) as bytes
  from r0006 group by tbl;
create temp table r0006_before on commit drop as
select 'fare_payloads'::text as tbl, count(*) as n from fare_payloads
union all select 'fare_observations', count(*) from fare_observations
union all select 'fare_fetches', count(*) from fare_fetches
union all select 'warm_attempts', count(*) from warm_attempts;

\echo '== Rows to delete, by table (must match the dry run) =='
select tbl as "table", n as rows_to_delete, oldest, newest, pg_size_pretty(bytes) as stored_size
  from r0006_plan order by tbl;

create or replace function prune_fare_store() returns void
language sql security definer set search_path = public as $$
  delete from fare_payloads p using fare_fetches f
    where p.fetch_id = f.id and f.fetched_at < now() - interval '2 days';
  delete from fare_observations where fetched_at < now() - interval '10 days';
  delete from fare_fetches f where f.fetched_at < now() - interval '10 days'
    and not exists (select 1 from fare_observations o where o.fetch_id = f.id)
    and not exists (select 1 from fare_payloads p where p.fetch_id = f.id);
  delete from warm_attempts where attempted_at < now() - interval '10 days'
    and endpoint <> 'triprange/exact-two-night-refresh-v1';
  delete from warm_attempts where attempted_at < now() - interval '90 days';
$$;

select prune_fare_store();

create temp table r0006_after on commit drop as
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
    from r0006_before b
    join r0006_after a using (tbl)
    left join (select case when tbl like 'warm_attempts%' then 'warm_attempts' else tbl end as tbl,
                      sum(n) as n
                 from r0006_plan group by 1) p using (tbl)
   where a.n <> b.n - coalesce(p.n, 0);
  if mismatch is not null then
    raise exception '0006 STOP: deleted rows differ from the plan: %', mismatch;
  end if;
  if exists (select 1 from fare_payloads p join fare_fetches f on f.id = p.fetch_id
              where f.fetched_at < now() - interval '2 days') then
    raise exception '0006 STOP: raw replies older than 2 days remain';
  end if;
  if exists (select 1 from fare_observations where fetched_at < now() - interval '10 days') then
    raise exception '0006 STOP: fare rows older than 10 days remain';
  end if;
  if exists (select 1 from warm_attempts where attempted_at < now() - interval '10 days'
                and endpoint <> 'triprange/exact-two-night-refresh-v1') then
    raise exception '0006 STOP: page receipts older than 10 days remain';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.prune_fare_store()'::regprocedure) then
    raise exception '0006 STOP: prune_fare_store is no longer SECURITY DEFINER';
  end if;
  if not has_function_privilege('fare_app', 'public.prune_fare_store()', 'execute') then
    raise exception '0006 STOP: fare_app can no longer execute prune_fare_store';
  end if;
end
$check$;

\echo '== Rows in each table after the clean-up (before = after + deleted, checked) =='
select b.tbl as "table", b.n as before, a.n as after, b.n - a.n as deleted
  from r0006_before b join r0006_after a using (tbl) order by 1;

\if :{?rehearse}
rollback;
\echo '== 0006 REHEARSAL OK: everything above was rolled back. Nothing changed. =='
\else
commit;
\echo '== 0006 COMMITTED. =='
\endif
