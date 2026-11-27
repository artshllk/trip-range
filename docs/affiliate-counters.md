# Affiliate counters

The five dimensions are the UTC date, origin airport, destination airport, outcome and fare-age band. Each row stores one positive integer count. Outcomes are `view`, `click_available` and `click_unavailable`. Fare-age bands are `fresh`, `aging`, `old` and `unknown`. The data can support a comparison of recorded clicks per recorded view by age. A difference between bands does not establish that the freshness label caused the difference. The counters contain no visitor or placement dimension, individual timestamp or return history.

## External reporting and production review

Affiliate counters are internal analytics. Keep exact counts in the restricted database by UTC day, airport pair, outcome and fare-age band. They are outside the public data catalogue and releases. Before any external publication, screenshot, export or share, pool any cell below five with neighbouring cells or suppress it. Use disjoint, clearly labelled groups: combine adjacent UTC dates first to preserve the fare-age comparison; if necessary combine adjacent known age bands. Keep unknown age separate unless explicitly reporting all ages. Suppress small cells that remain, including zero, and withhold totals, rates, overlapping windows or another cell if subtraction or comparison with an earlier report would reveal them. Apply the same rule to the counts underlying a rate. A threshold of five is a disclosure control, not a guarantee of anonymity.

Reassess after the first full reporting week with real production traffic, before sharing the first production report. Compare cells and singleton counts with and without fare age, and the share of events in cells below five. Exclude preview dates. Record the result and decide whether the reporting groups need widening. The 14 preview views give no estimate of production cell sizes.

## Preview linkage assessment, 7 November 2026

A read-only query against the retained table found 14 views, zero clicks and zero returns. Grouping by UTC day, airport pair and outcome produced seven cells of two. Adding fare age produced eight cells, six of two and two of one. Two of 14 views became individually distinguishable within their cell. All eight cells fall below the external reporting floor. On a quiet route a person with other information, such as a request log, could sometimes connect a count to a particular visit. Keep this qualification in the privacy notice.

## Applying and verifying migration 0005

**Production verification, 7 November 2026.** The owner-role preflight against the production branch of the Trip Range Neon project found 14 source rows. Migration 0005 ran as one atomic statement, with its transaction body inside a PostgreSQL `DO` block for the console. Its per-cell and grand-total checks passed before the raw table was dropped. A fresh owner query returned eight stored cells, 14 views, zero clicks and two singleton cells. The old relation is an empty view. A separate read-only check through the application's actual connection verified permission to increment and to insert through the compatibility view, with neither read nor update access to the counter table. Verification added no production observations.

Run [0005](../db/migrations/0005_affiliate_daily_counts.sql) as the owner on the database containing the 0002 table. It locks that table, groups views and clicks, checks every group and their grand total, then drops the table and commits. Unknown click outcomes abort the transaction. Returns are intentionally discarded. A failed or duplicate run cannot add the historical counts twice. Restored copies, log drains and previously captured diagnostics have separate lifecycles.

Deploy the new writer after the database change. It calls the increment function once per accepted measurement, with no automatic retry on an ambiguous result. Existing deployed SQL inserts still work through an insert-only compatibility view. It has no stored rows. Legacy return inserts are ignored. Concurrent increments use a unique key and an atomic upsert; the application role can increment counters without reading them or modifying the count directly.

Run this internal check as the owner after migration and again at the production review. For the production review restrict the source to full UTC days following the public launch. Keep counter cells inside the database.

```sql
with per_route as (
  select day_utc, origin_code, destination_code, outcome,
         sum(event_count) as n, count(*) as age_cells,
         count(*) filter (where event_count = 1) as age_singletons,
         sum(event_count) filter (where event_count < 5) as small_age_events
  from public.affiliate_daily_counts
  group by day_utc, origin_code, destination_code, outcome
)
select coalesce(sum(n), 0) as recorded_events,
       count(*) as cells_without_age,
       count(*) filter (where n = 1) as singletons_without_age,
       coalesce(sum(age_cells), 0) as cells_with_age,
       coalesce(sum(age_singletons), 0) as singletons_with_age,
       coalesce(sum(n) filter (where n < 5), 0) as events_in_small_cells_without_age,
       coalesce(sum(small_age_events), 0) as events_in_small_cells_with_age
from per_route;
```
