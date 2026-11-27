-- Fare observation store: an append-only record of every Aviasales Data API
-- response we fetch. Apply once as the database owner:
--   psql "$OWNER_DATABASE_URL" -f db/migrations/0001_fare_store.sql
-- The application connects as fare_app, which can INSERT and SELECT only.

-- Two timestamps, never merged:
--   fetched_at        when WE called the API (our clock, inside the cache loader).
--   fare_observed_at  the provider's found_at ("when the ticket was found").
--                     get_latest_prices and nearest-places-matrix send it;
--                     prices_for_dates does not, so its rows stay NULL. Never
--                     backfill it from fetched_at: the cache retains fares 2–7 days.
-- Each observation records the endpoint it came from.

create table fare_fetches (
  id bigint generated always as identity primary key,
  fetched_at timestamptz not null,
  http_date timestamptz,            -- provider response Date header, if sent
  endpoint text not null,           -- prices_for_dates | get_latest_prices | nearest-places-matrix
  origin char(3) not null,
  destination char(3),              -- NULL: an "anywhere" query
  departure_month text,             -- query parameter as sent (YYYY-MM)
  return_month text,
  currency char(3) not null,
  market text,
  row_count integer not null check (row_count >= 0)
);

-- Raw payloads live apart so retention can drop them without touching
-- the normalized observations.
create table fare_payloads (
  fetch_id bigint primary key references fare_fetches (id),
  raw_payload jsonb not null
);

create table fare_observations (
  id bigint generated always as identity primary key,
  fetch_id bigint not null references fare_fetches (id),
  endpoint text not null,
  fetched_at timestamptz not null,
  fare_observed_at timestamptz,
  actual boolean,                   -- provider `actual` flag; NULL when not sent
  -- Undocumented search_date parameter (DDMMYYYY) inside the provider deep
  -- link. Stored for analysis only; no label may derive from it.
  provider_link_search_date date,
  origin char(3) not null,
  origin_airport char(3),
  destination char(3) not null,
  destination_airport char(3),
  departure_at timestamptz not null,
  return_at timestamptz,
  departure_date date not null,     -- local calendar date as sent (UTC can shift it)
  return_date date,
  cabin text check (cabin in ('economy', 'business', 'first')), -- from trip_class; NULL if not sent
  travellers smallint not null check (travellers = 1), -- prices are per traveller
  price_minor bigint not null check (price_minor > 0),
  currency char(3) not null,
  transfers smallint,
  return_transfers smallint,
  airline text,
  gate text
);

create index fare_observations_origin_recent
  on fare_observations (origin, fetched_at desc);
create index fare_observations_route_recent
  on fare_observations (origin, destination, fetched_at desc);
create index fare_fetches_fetched_at on fare_fetches (fetched_at);

-- Retention runs with the owner's rights; the app can call it but cannot
-- DELETE directly. Raw payloads: 30 days. Observations: 13 months (one full
-- seasonal cycle for typical-fare ranges).
create function prune_fare_store() returns void
language sql security definer set search_path = public as $$
  delete from fare_payloads p using fare_fetches f
    where p.fetch_id = f.id and f.fetched_at < now() - interval '30 days';
  delete from fare_observations where fetched_at < now() - interval '13 months';
  delete from fare_fetches f where f.fetched_at < now() - interval '13 months'
    and not exists (select 1 from fare_observations o where o.fetch_id = f.id)
    and not exists (select 1 from fare_payloads p where p.fetch_id = f.id);
$$;

-- Append-only application role. Create the login separately:
--   create role fare_app_login login password '...' in role fare_app;
create role fare_app nologin;
grant select, insert on fare_fetches, fare_payloads, fare_observations to fare_app;
revoke update, delete, truncate on fare_fetches, fare_payloads, fare_observations from fare_app;
revoke all on function prune_fare_store() from public;
grant execute on function prune_fare_store() to fare_app;
