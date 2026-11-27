-- Run as the table owner with psql -X -v ON_ERROR_STOP=1 -f <this file>.
-- One transaction: a lock timeout, unexpected old shape or mismatch keeps 0002 intact.
begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog, pg_temp;

lock table public.affiliate_events in access exclusive mode;

create table public.affiliate_daily_counts (
  day_utc date not null,
  origin_code text not null check (origin_code ~ '^[A-Z]{3}$'),
  destination_code text not null check (destination_code ~ '^[A-Z]{3}$'),
  outcome text not null check (outcome in ('view', 'click_available', 'click_unavailable')),
  fare_age text not null check (fare_age in ('fresh', 'aging', 'old', 'unknown')),
  event_count bigint not null check (event_count > 0),
  primary key (day_utc, origin_code, destination_code, outcome, fare_age)
);

-- A historical click without a known link outcome must fail, not be reclassified.
create temporary table affiliate_expected on commit drop as
select (recorded_at at time zone 'UTC')::date as day_utc,
       origin_code::text, destination_code::text,
       case when event = 'cta_view' then 'view'
            when event = 'click' then 'click_' || link_status end as outcome,
       fare_age, count(*) as event_count
from public.affiliate_events
where event <> 'return'
group by 1, 2, 3, 4, 5;

insert into public.affiliate_daily_counts
select * from pg_temp.affiliate_expected;

do $$
begin
  if (select count(*) from public.affiliate_events where event <> 'return')
      <> (select coalesce(sum(event_count), 0) from public.affiliate_daily_counts)
    or exists (
      select from pg_temp.affiliate_expected e full join public.affiliate_daily_counts c
        using (day_utc, origin_code, destination_code, outcome, fare_age)
      where e.event_count is distinct from c.event_count
    ) then
    raise exception 'Affiliate backfill mismatch. Original rows retained.';
  end if;
end $$;

create function public.increment_affiliate_count(
  p_origin text, p_destination text, p_outcome text, p_fare_age text
) returns void
language sql security definer set search_path = pg_catalog, pg_temp as $$
  insert into public.affiliate_daily_counts as c
    (day_utc, origin_code, destination_code, outcome, fare_age, event_count)
  values ((statement_timestamp() at time zone 'UTC')::date,
          p_origin, p_destination, p_outcome, p_fare_age, 1)
  on conflict (day_utc, origin_code, destination_code, outcome, fare_age)
  do update set event_count = c.event_count + 1;
$$;

revoke all on public.affiliate_daily_counts from public, fare_app;
revoke all on function public.increment_affiliate_count(text,text,text,text) from public;
grant execute on function public.increment_affiliate_count(text,text,text,text) to fare_app;
comment on table public.affiliate_daily_counts is
  'Restricted internal counts. For external sharing pool cells below 5 or suppress them, including inferable complements. Exclude from public releases.';

drop table public.affiliate_events;

-- Older deployments can continue inserting using the 0002 column list. This
-- view has no backing event rows, and silently discards legacy return beacons.
create view public.affiliate_events as
select null::text as event, null::text as placement,
       null::char(3) as origin_code, null::char(3) as destination_code,
       null::text as state, null::text as fare_age,
       null::text as link_status, null::text as away
where false;

create function public.count_legacy_affiliate_insert() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  outcome text;
begin
  if new.event = 'return' then return null; end if;
  outcome := case when new.event = 'cta_view' then 'view'
                  when new.event = 'click' then 'click_' || new.link_status end;
  perform public.increment_affiliate_count(
    new.origin_code::text, new.destination_code::text, outcome, new.fare_age
  );
  return new;
end $$;
revoke all on function public.count_legacy_affiliate_insert() from public;
create trigger affiliate_count_legacy_inserts instead of insert on public.affiliate_events
for each row execute function public.count_legacy_affiliate_insert();
revoke all on public.affiliate_events from public, fare_app;
grant insert on public.affiliate_events to fare_app;
comment on view public.affiliate_events is 'Write compatibility only. No individual events are retained here.';

commit;
