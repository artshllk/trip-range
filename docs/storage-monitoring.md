# Storage monitoring and the capacity review trigger

**Pending change (variable trip length, owner decisions 27–28 November 2026):** collection grows to two and three nights for every origin, and seven nights for London and Warsaw. Three storage options ship with it:

- (A) normalized rows only for collected lengths;
- (B) normalized rows only for single tickets up to €1,200, whatever the party size (`MAX_TICKET_CENTS`). That drops 3.0% of rows; €800 would have dropped 8.4%, mostly long-haul. Raw replies are still stored in full.
- (C) fare rows kept 8 days instead of 10 (`db/migrations/0007_eight_day_fare_retention.sql`; not applied until the privacy-notice change ships with the trip-length deploy).

**Measured, 28 November 2026** (manual force sweep from `feat/trip-length`, run 46135849949, all eight origin-months complete, none failed):

| | Two nights only (04:17 sweep the same day) | Trip-length collector |
|---|---|---|
| Provider calls | 2,101 | 4,929 (2.35×) |
| Duration | 16½ min | 37¾ min |
| Fare rows stored (options A and B) | 52,814 (8.7 MB) | 111,506 (18.4 MB) |
| Raw replies (kept 2 days, stored in full) | 8.1 MB | 23.7 MB |
| Cluster growth | | +41.6 MiB (235 → 277 MiB) |

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
- Because an alert can arrive when nobody can act on it, a collector hard stop at 900 MiB is proposed (owner request, 28 November 2026; not built yet).

The 600 MiB trigger of 23 November covered the two-night collection: it stayed quiet across 430–530 MB, left about nine days of intake before the limit, and fired when a fifth large origin was added.

Above the trigger, the audit fails and opens or updates **Database storage needs attention**, using the existing GitHub issue/email alert channel. An unavailable measurement or missing/invalid limit also fails visibly; neither becomes zero usage. It does not stop the separate fare collection workflow or change its behavior.

The first delivered audit after crossing the threshold raises the alert; GitHub may delay or drop scheduled runs. A manual Fail-closed audit rerun is available. A resolved issue is closed manually after review; a later breached check can open a new issue. No capacity action follows automatically.

When the trigger occurs, review actual storage growth, delivered collection and the then-planned origin expansion before choosing any action. Until then, implementation effort goes to the first complete supported city basket.
