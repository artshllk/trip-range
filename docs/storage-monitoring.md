# Storage monitoring and the capacity review trigger

**Pending change (variable trip length, owner decisions 27–28 November 2026):** collection grows to two and three nights for every origin, and seven nights for London and Warsaw. Three storage options ship with it:

- (A) normalized rows only for collected lengths;
- (B) normalized rows only for single tickets up to €1,200, whatever the party size (`MAX_TICKET_CENTS`). That drops 3.0% of rows; €800 would have dropped 8.4%, mostly long-haul. Raw replies are still stored in full.
- (C) fare rows kept 8 days instead of 10 (`db/migrations/0007_eight_day_fare_retention.sql`; not applied until the privacy-notice change ships with the trip-length deploy).

**Measured, 28 November 2026** (manual force sweep from `feat/trip-length`, run 46135849949, all eight origin-months complete, none failed):

|                                           | Two nights only (04:17 sweep the same day) | Trip-length collector     |
| ----------------------------------------- | ------------------------------------------ | ------------------------- |
| Provider calls                            | 2,101                                      | 4,929 (2.35×)             |
| Duration                                  | 16½ min                                    | 37¾ min                   |
| Fare rows stored (options A and B)        | 52,814 (8.7 MB)                            | 111,506 (18.4 MB)         |
| Raw replies (kept 2 days, stored in full) | 8.1 MB                                     | 23.7 MB                   |
| Cluster growth                            |                                            | +41.6 MiB (235 → 277 MiB) |

No stored row was over €1,200 per ticket or a length other than 2, 3 or 7 nights.

**Why 2.35× and not the 1.8× estimated:** London and Warsaw carry three lengths each and cost about 3× their two-night calls; Tirana and Barcelona, with two lengths, cost about 1.7–2×.

This was a month-end sweep (34 dates left across the two collected months); a month-start sweep has about 61, so it costs up to about 1.8× as much. Scaling by dates, four origins with all three options settle near **545 MB** and peak near **700 MB** at month start (±25%). Without option C, about 640 / 830 MB, so C still ships with the privacy-notice change. The cap is not what makes eight origins fit: every cap lands over 1 GB there, so step 4 needs a slimmer store. The figures below describe the two-night collection that runs until the trip-length deploy.

Owner decision, 23 November 2026 (PR #48), superseding the 5 November 50% trigger: fare retention is 10 days for fare observations, their fetch headers and per-page receipts, 2 days for raw fare replies, and 90 days for month-completion receipts ([0006](../db/migrations/0006_short_fare_retention.sql)). Collection is four origins (Tirana, London, Barcelona, Warsaw) at two sweeps a day.

Measured on 23 November 2026, one four-origin sweep adds about 24.5 MB (55,600 fare rows, 9 MB of raw replies, fetch headers and receipts). At two sweeps a day the cluster settles near **430 MB** on average and about **530 MB** in the first ten days of a month, when both collected months are full of dates. Estimates carry about ±25%. Deleted space is reused, not returned, so the cluster does not shrink below its earlier high-water mark.

The daily Fail-closed audit (QStash-triggered at 08:37 UTC, GitHub cron fallback) runs `npm run check:storage`. The check performs one read-only query, summing `pg_database_size` across all databases, including system databases, against `neon.max_cluster_size` (1 GiB on 23 November 2026). It reports bytes used, limit bytes, trigger bytes and percentage to the log and job summary. This measures the current cluster; it is not the Console's separately reported history storage or an account-wide total across projects.

The trigger is **more than 838,860,800 bytes (800 MiB)**, or the same share of the enforced limit (800/1024, 78.1%) if that is lower (owner decision, 28 November 2026, replacing 600 MiB of 23 November):

- 700 MiB would fire at every month start of the trip-length collection (about 700 MB), which trains us to ignore it. 800 MiB stays quiet there.
- Above it, about 224 MiB remains before the 1 GiB limit: about 1.5 days of month-start intake (about 150 MiB a day) if clean-up stopped completely.
- At the top of the ±25% band the month-start peak (about 875 MB, 835 MiB) could cross it; if it fires at a month start with clean-up running, the projection was low and capacity needs review anyway.
- Because an alert can arrive when nobody can act on it, the collector also stops itself at 900 MiB (see "Collection stop at 900 MiB" below).

The 600 MiB trigger of 23 November covered the two-night collection: it stayed quiet across 430–530 MB, left about nine days of intake before the limit, and fired when a fifth large origin was added.

Above the trigger, the audit fails and opens or updates **Database storage needs attention**, using the existing GitHub issue/email alert channel. An unavailable measurement or missing/invalid limit also fails visibly; neither becomes zero usage. The audit itself changes nothing; the collector measures for itself before each month (below). The audit's status line says whether the collection stop is in force.

The first delivered audit after crossing the threshold raises the alert; GitHub may delay or drop scheduled runs. A manual Fail-closed audit rerun is available. A resolved issue is closed manually after review; a later breached check can open a new issue. No capacity action follows automatically.

When the trigger occurs, review actual storage growth, delivered collection and the then-planned origin expansion before choosing any action. Until then, implementation effort goes to the first complete supported city basket.

## Collection stop at 900 MiB

Owner decision, 28 November 2026: **losing a sweep is recoverable; filling the database is not.** Built in `scripts/check-storage.ts` (`collectionGate`) and `scripts/fare-warm-run.ts`.

- **What it measures:** the same read-only query as the daily check (every database in the cluster against `neon.max_cluster_size`). It stops above 943,718,400 bytes (900 MiB), or above 900/1024 of the limit if the limit is smaller.
- **When:** before every origin-month the run would collect, and before the weekly PRN panel, not only at the start of a run. At most one month per origin is in progress when it trips; those finish. The worst overshoot is about 40 MiB at month start with four origins and about 75 MiB at eight, a peak near 975 MiB, under the 1,024 MiB limit. A check only at run start could let a whole sweep through (about 150 MiB at eight origins).
- **A stopped month:** no provider calls, nothing written, marked `stopped` in the run summary. Clean-up still runs at the end of the run: it is the only clean-up, and the only way storage comes back down.
- **Cannot measure** (query fails, limit setting missing or invalid): it stops, the same as a breach. This is the third fail-closed case in [abuse-controls.md](abuse-controls.md): failing open risks filling the database.
- **No override,** including `force` runs. Changing the figure takes a reviewed commit.
- **The run stays green** (owner, 28 November 2026). Stopping is the design working, and a failure email on every stopped run (up to about ten a day) is alert fatigue. The run summary says it stopped and why. The issue **Fare collection stopped to protect database storage** opens once; later stops edit its text, which sends no email. Close it after review; a later stop opens a new one. The 20-hour stall alert is what escalates, because no origin-month completes. Real failures in the same run (provider, admission, storage writes, clean-up) still fail it.
- **Resuming:** nothing is stored; each run measures again. Deleted space is reused, not returned, so deleting rows alone does not lower the measurement. The raw-reply table holds only 2 days (about 95–170 MB with trip lengths). With collection stopped it empties within 2 days, and routine vacuuming can then return its space, which probably brings storage back under 900 MiB on its own. If it does not, use the manual clean-up below. If the cause is not fixed, collection runs and stops every couple of days, and the database never fills.
- **Visitors meanwhile:** `/plan` reads 7 days of fares, so it keeps working with ageing prices for up to a week; the homepage recent-fares strip reads 48 hours and empties after 2 days.

**Why a green run hides no real failure** (checked 28 November 2026):

- Database unreachable or a wrong credential: the measurement fails, but so does the clean-up at the end of the run, so the run fails as it does today.
- Limit setting missing or unreadable while the database works: the run is green and stopped, but the daily storage check fails that morning on the same missing limit, and the stall alert follows within 20 hours. The issue says "could not be measured", not "above 900 MiB".
- A month failing for another reason in a run where other months stopped: the run fails.

## Manual clean-up of the raw-reply table

**When:** the issue "Fare collection stopped to protect database storage" is open and storage has not come back under 900 MiB within about two days, or the space is needed back sooner.

**Who and where:** the database owner role (`neondb_owner`), in the Neon Console SQL Editor for the production database. The collector's own role cannot do this: it has no delete, truncate or vacuum rights on these tables. Run each statement on its own. `VACUUM` refuses to run inside a transaction, and running several statements together can put them in one.

**What the table is:** `fare_payloads` holds the provider's raw replies, kept 2 days as evidence of what it sent. Nothing on the site and none of the checks reads it. Fare rows (`fare_observations`), fetch headers and receipts are separate tables, and no step below touches them. Most of its size is large replies stored out of line (TOAST): 50 of 62 MiB on 28 November 2026. Every step below covers that part too.

**Step 1. See where the space is** (read-only):

```sql
select c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) as total
from pg_class c
where c.relname in ('fare_observations', 'fare_payloads', 'fare_fetches', 'warm_attempts')
order by pg_total_relation_size(c.oid) desc;
```

```sql
select pg_size_pretty(sum(pg_database_size(oid))) as cluster,
  current_setting('neon.max_cluster_size', true) as cluster_limit
from pg_database;
```

Postgres prints sizes in 1,024-based units even though it labels them "MB" and "GB", the same units as the stop: "903 MB" is above 900 MiB, and a limit of "1GB" is 1,024 MiB.

If `fare_payloads` is small (tens of MiB) and `fare_observations` holds most of the space, these steps cannot fix it: see "If fare rows are the cause" below.

**Step 2. Run the routine clean-up now** (the same call that ends every collector run):

```sql
select prune_fare_store();
```

**Step 3. Return the raw-reply table's empty space:**

```sql
vacuum (verbose) fare_payloads;
```

Plain `VACUUM` returns space only from the end of a table. After about two days with collection stopped the table is empty, so that is nearly all of it. It needs no extra space and does not block the site.

**Step 4. Measure again** (the second query in step 1). At or under 900 MiB, you are done: the next collector run collects again (a catch-up within three hours), or dispatch **Fare warm** with mode `catch-up` now. Its summary should show no stopped months.

**Step 5. Still above 900 MiB, and the space is needed now: empty the raw-reply table.**

```sql
truncate fare_payloads;
```

- **Cost:** the raw replies of the last two days are gone for good. Nothing else changes: fare rows, the site and the checks do not use them.
- It returns the table's whole space at once, including the out-of-line part, and needs no extra space.
- It waits for any run that is writing to the table. Check Actions for a Fare warm run in progress first. If it waits more than a few seconds, cancel it in the editor and retry once that run has finished.
- Then measure again (step 4).

**Do not:**

- Run `VACUUM FULL` on `fare_observations`, or on the whole database. It rewrites the table, needs free space for a full copy, which does not exist near the limit, and locks the table the site reads for the whole time, so `/plan` stops showing fares.
- Delete fare rows by hand or shorten retention as an emergency step. Retention is stated in the privacy notice, so changing it is a decision shipped with the notice (the 0006 and 0007 pattern), not a clean-up.

**If fare rows are the cause:** with collection stopped, the fare-row table stops growing, and clean-up keeps removing expired rows, whose space later collection reuses. The table does not shrink, though, so usage stays near its high-water mark and collection keeps stopping until capacity changes: fewer origins or lengths, retention (migration 0007, with the notice), or the slimmer store planned for step 4. That is a capacity review, not an emergency procedure.
