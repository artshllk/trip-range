# Storage monitoring and the capacity review trigger

**Pending change (variable trip length, owner decisions 27–28 November 2026):** collection grows to two and three nights for every origin, and seven nights for London and Warsaw. Three storage options ship with it:

- (A) normalized rows only for collected lengths;
- (B) normalized rows only for single tickets up to €1,200, whatever the party size (`MAX_TICKET_CENTS`). That drops 3.0% of rows; €800 would have dropped 8.4%, mostly long-haul. Raw replies are still stored in full.
- (C) fare rows kept 8 days instead of 10 (`db/migrations/0007_eight_day_fare_retention.sql`; not applied until the privacy-notice change ships with the trip-length deploy).

Projection with all three, four origins: about 590 MB settled and 730 MB at month start (±25%), to be measured by the manual sweep. The cap is not what makes eight origins fit: every cap lands over 1 GB there, so step 4 needs a slimmer store. The figures below describe the current two-night collection.

Owner decision, 23 November 2026 (PR #48), superseding the 5 November 50% trigger: fare retention is 10 days for fare observations, their fetch headers and per-page receipts, 2 days for raw fare replies, and 90 days for month-completion receipts ([0006](../db/migrations/0006_short_fare_retention.sql)). Collection is four origins (Tirana, London, Barcelona, Warsaw) at two sweeps a day.

Measured on 23 November 2026, one four-origin sweep adds about 24.5 MB (55,600 fare rows, 9 MB of raw replies, fetch headers and receipts). At two sweeps a day the cluster settles near **430 MB** on average and about **530 MB** in the first ten days of a month, when both collected months are full of dates. Estimates carry about ±25%. Deleted space is reused, not returned, so the cluster does not shrink below its earlier high-water mark.

The daily Fail-closed audit (QStash-triggered at 08:37 UTC, GitHub cron fallback) runs `npm run check:storage`. The check performs one read-only query, summing `pg_database_size` across all databases, including system databases, against `neon.max_cluster_size` (1 GiB on 23 November 2026). It reports bytes used, limit bytes, trigger bytes and percentage to the log and job summary. This measures the current cluster; it is not the Console's separately reported history storage or an account-wide total across projects.

The trigger is **more than 629,145,600 bytes (600 MiB)**, or 60% of the enforced limit if that is lower (owner decision, 23 November 2026, replacing 250 MiB):

- It stays quiet across the expected four-origin range (about 430–530 MB).
- Above it, about 445 MB remains before the 1 GiB limit: roughly nine days of intake if clean-up stopped completely. Cleanup stopping entirely would cross the trigger in about four days.
- Each additional large origin adds about 125 MB settled (about 160 MB at the month-start peak). A fifth origin trips the trigger at month-start peaks (about 690 MB); a sixth trips it all the time. About three additional origins reach the enforced 1 GiB limit at the month-start peak.

Above the trigger, the audit fails and opens or updates **Database storage needs attention**, using the existing GitHub issue/email alert channel. An unavailable measurement or missing/invalid limit also fails visibly; neither becomes zero usage. It does not stop the separate fare collection workflow or change its behavior.

The first delivered audit after crossing the threshold raises the alert; GitHub may delay or drop scheduled runs. A manual Fail-closed audit rerun is available. A resolved issue is closed manually after review; a later breached check can open a new issue. No capacity action follows automatically.

When the trigger occurs, review actual storage growth, delivered collection and the then-planned origin expansion before choosing any action. Until then, implementation effort goes to the first complete supported city basket.
