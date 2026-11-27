-- First-party affiliate measurement. Client analytics only run on Vercel, so on
-- Netlify these rows are the record. Apply after 0001, as the database owner.
--
-- These are affiliate CLICKS and views, not bookings. Never report them as revenue.

create table affiliate_events (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default now(),
  event text not null check (event in ('cta_view', 'click', 'return')),
  placement text not null check (placement in ('results', 'trip')),
  origin_code char(3) not null,
  destination_code char(3) not null,
  -- Pricing state the traveller saw: priced / partial / no_fare.
  state text not null check (state in ('priced', 'partial', 'no_fare')),
  fare_age text not null check (fare_age in ('fresh', 'aging', 'old', 'unknown')),
  -- Click only: whether a partner link was produced (never the link itself).
  link_status text check (link_status in ('available', 'unavailable')),
  -- Return only: time away bucket.
  away text check (away in ('<2m', '2-15m', '>15m'))
);
create index affiliate_events_recorded on affiliate_events (recorded_at);

grant select, insert on affiliate_events to fare_app;
revoke update, delete, truncate on affiliate_events from fare_app;
