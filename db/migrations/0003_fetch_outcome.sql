-- Recorded absence is data. A successful response with zero rows is an explicit
-- outcome ('empty'), queryable per route and endpoint, not merely missing rows.
-- Failed requests are never recorded here: absence means "asked, and the cache held
-- nothing", never "we could not ask". Apply after 0002, as the database owner.

alter table fare_fetches
  add column outcome text generated always as
    (case when row_count = 0 then 'empty' else 'rows' end) stored;

create index fare_fetches_route
  on fare_fetches (origin, destination, endpoint, fetched_at desc);

-- One row per origin × destination × endpoint (destination NULL = "anywhere").
create view route_coverage as
  select origin,
         destination,
         endpoint,
         count(*)::int as fetches,
         count(*) filter (where outcome = 'rows')::int as rows_fetches,
         count(*) filter (where outcome = 'empty')::int as empty_fetches,
         max(fetched_at) as last_fetched_at,
         max(fetched_at) filter (where outcome = 'rows') as last_rows_at
  from fare_fetches
  group by origin, destination, endpoint;

grant select on route_coverage to fare_app;
