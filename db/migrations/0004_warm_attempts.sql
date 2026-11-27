-- Every warm-job call, stored or not, so selection can pick the stalest routes and
-- origin-month pairs. fare_fetches records only answers ("asked, and the cache held
-- this"); a failed call must still count as an attempt, or an item that always errors
-- would stay stalest and take every run. Apply after 0003, as the database owner:
--   psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0004_warm_attempts.sql

create table warm_attempts (
  id bigint generated always as identity primary key,
  attempted_at timestamptz not null default now(),
  run_id text,                        -- GitHub Actions run id, for tracing
  endpoint text not null,
  origin char(3) not null,
  destination char(3),                -- route calls; NULL for origin-month calls
  departure_month text,               -- origin-month calls; NULL for route calls
  currency char(3) not null,
  outcome text not null check (outcome in ('stored', 'failed')),
  reason text                         -- provider reason when failed, e.g. timeout
);
create index warm_attempts_item
  on warm_attempts (origin, destination, departure_month, attempted_at desc);

grant select, insert on warm_attempts to fare_app;
revoke update, delete, truncate on warm_attempts from fare_app;

-- Attempts are operational, not evidence: keep 90 days. Same owner-rights function
-- as 0001, extended; the app can call it but cannot delete directly.
create or replace function prune_fare_store() returns void
language sql security definer set search_path = public as $$
  delete from fare_payloads p using fare_fetches f
    where p.fetch_id = f.id and f.fetched_at < now() - interval '30 days';
  delete from fare_observations where fetched_at < now() - interval '13 months';
  delete from fare_fetches f where f.fetched_at < now() - interval '13 months'
    and not exists (select 1 from fare_observations o where o.fetch_id = f.id)
    and not exists (select 1 from fare_payloads p where p.fetch_id = f.id);
  delete from warm_attempts where attempted_at < now() - interval '90 days';
$$;
