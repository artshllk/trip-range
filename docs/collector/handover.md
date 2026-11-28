# Collector handover — 23 November 2026

The collector is already repository source, not a workspace-only program. The running main revision audited today is `2bcee81078c7edaca778e201264c7929383e6ff5`. This PR preserves it unchanged. `source-manifest.json` identifies the exact source and hashes. Do not replace it with the separate global research screen.

## Source and commands

- `scripts/fare-warm-run.ts`: actual collector; `npm run warm:fares` (writes production evidence; do not run concurrently with Actions).
- `scripts/check-warm-coverage.ts`: actual daily store reader; `npm run check:warm-coverage -- --on 2026-11-23`.
- Renewal: append `--renewed-since 2026-11-18T08:00:00Z`.
- `scripts/check-sweep-yield.ts`: `npm run check:sweep-yield -- --from 2026-11-22`.
- `src/server/fare-refresh-store.ts`: atomic storage, same-run itinerary/timestamp joins and as-of-cutoff reconstruction.
- `src/server/collector-http.ts`, `provider-admission.ts`: shared endpoint admission and failure handling.
- `src/domain/month-discovery.ts`, `fare-refresh.ts`, `sweep-yield.ts`: screen, health and yield rules.
- `.github/workflows/fare-warm.yml`, `src/config/fare-warm.json`: active schedule and origin settings.

Use Node 24 and `npm ci`; no new dependencies are needed. Compile through the npm commands. Supply credentials through the process environment or a local ignored env file; npm does not automatically load `.env.local`. For example compile with `node node_modules/typescript/bin/tsc -p tsconfig.content.json`, then use `node --env-file=.env.local --conditions=react-server .content-build/scripts/check-warm-coverage.js --on YYYY-MM-DD`. Run from repository root. Never commit an env file or print its values.

## Credentials: names and purposes only

- `TRAVELPAYOUTS_API_TOKEN`: Aviasales cache API authentication, sent in X-Access-Token.
- `DATABASE_URL`: Neon/Postgres fare store. Collector writes; diagnostics read. Existing schema/migrations are in the repository; do not recreate or clear the production database.
- `RATE_LIMIT_REDIS_REST_URL`, `RATE_LIMIT_REDIS_REST_TOKEN`: shared Upstash REST endpoint and credential. Collector and planner must use the same database and endpoint keys.
- Scheduler credentials live outside GitHub secrets; see "External scheduler" below.
- GitHub's workflow `GITHUB_TOKEN` (exposed as `GH_TOKEN` in the alert step): Actions issue alerts; not fare authentication. Human read-only workflow inspection uses an authorized GitHub login.

The four application credentials are already configured as Actions secrets. Local credentials are not part of this handover. No OpenAI key is required. Read-only coverage/yield checks need only DATABASE_URL.

## Eligibility and clocks

Current and next month for each configured origin (Tirana, London, Barcelona and Warsaw since PR #48; Tirana only before). Each origin is measured separately; separate weekly Prishtina reassessment never contributes to Tirana's gate. Return date must equal departure date plus exactly two calendar days, including cross-month returns. Two adults means twice the cached single-traveller economy return price, not verified two-seat availability. EUR fare plus max(€20, 10% rounded upward to cents) must be at most €600. This excludes rooms, food, transit and tax: never call this complete-trip affordability or live bookability.

Use provider observation time, never fetch time, for seven-day freshness. Future observation timestamps fail. Exclude actual=false, known non-economy, non-EUR, non-single-traveller input, wrong duration, past departure dates, missing destination airport on exact itineraries and conflicting origin airport. Null cabin/actual are permitted by the existing rule. An exact-date prices_for_dates row must match a get_latest_prices row in the SAME collector run on destination, outbound date, return date and identical per-person price. Unmatched itineraries are not eligible. Preserve current code rather than silently broadening these rules.

Daily measurement is 09:00 Europe/Belgrade (08:00 UTC in November), regardless of cron delivery. `--on` obtains that timezone-aware cutoff from Postgres. Both fetch and observation ingestion must precede cutoff. Across-run union is allowed only after each pair has matched within its own run. Cheapest eligible option per destination/date wins. Count destination cities, not airports; multi-date means at least two distinct departure dates. A later recovery must never be counted as morning coverage. Unknown/unreadable is not zero and not a pass. Renewal filters provider timestamps BEFORE cheapest-per-date selection.

**Stay lengths (variable trip length, owner decision 27 November 2026):** each origin collects the lengths listed under `nights` in `src/config/fare-warm.json`: 2 and 3 for every origin, and 7 for London and Warsaw. For every departure day the sweep makes one exact-date `prices_for_dates` query _per length_. The `get_latest_prices` calls that date each fare are shared: one monthly call per destination serves every length, matched on destination, dates, length and price. A day-level call follows only for dates still undated. Before storage, rows are cut to collected lengths and to tickets up to €1,200 whatever the party size (`storableRow`, `MAX_TICKET_CENTS`, options A and B); the raw reply is still stored in full. The completion receipt stays one per origin-month, under its historical name `triprange/exact-two-night-refresh-v1`, kept for continuity of health and catch-up history. Each run's report adds `lengths` and `byNights`; its top-level `destinations` and `multiple` remain the two-night figures. The coverage check measures each origin and length with `--nights ALL`.

Atomic storage inserts fetch header, raw payload, normalized observations and page receipt together. A failed run may have valid atomically stored pages, which the store snapshot can use. Run completion is separate; success is never inferred merely from page count. Do not weaken write-integrity checks or discard partial-run provenance. Retention since PR #48 ([0006](../../db/migrations/0006_short_fare_retention.sql)): raw replies 2 days; observations, fetch headers and page receipts 10 days; month-completion receipts 90 days. A coverage or yield re-run more than about three days after its cutoff can no longer be reconstructed from the store; the committed evidence files remain the record. Provider rows stating another origin are dropped before parsing (raw reply kept) and counted as `wrongOrigin`; more than 10 in one origin-month sweep fails that month.

## Scheduling and shared admission

Regular sweeps 04:17 and 16:17 UTC (two a day since PR #48; previously six-hourly), catch-up check hourly at :47 UTC. Since 23 November 2026 these are triggered by QStash (see "External scheduler"); the same `17 4,16 * * *` and `47 * * * *` GitHub crons remain as a fallback. A sweep skips any origin-month that succeeded within 10 hours (refreshHours − graceHours), so a duplicate or late trigger makes no provider calls. Config: refreshHours=12, graceHours=2. Catch-up skips each current/next month of each origin unless its last successful completion is absent or over fourteen hours old. Workflow concurrency group fare-warm queues rather than cancels. Check active jobs before any authorized manual recovery. Keep the existing collector running until a replacement is verified.

Collector pages pause 500 ms locally and use shared Redis rolling 65-second admission: latest-prices 300, prices-for-dates 600, nearby matrix 60. Admission timeout is 1,200 ms; request timeout 15 seconds. Refusal/ambiguous admission/outage stops before provider dispatch. Never retry or refund the same admission, bypass Redis, or replace it with the obsolete generic 500/65-second gate. Failure records the month as failed and the workflow alerts/fails; later regular or due catch-up runs can recover. Re-fetching identical cache data does not renew its provider timestamp.

On 20 November the global audit competed with collection for the same endpoint budget. December stopped at 15:34 UTC on a shared quota refusal after 39 actual calls (November had used 52). It was not a provider HTTP 429. Catch-up restored December at 18:53 UTC. Research jobs must yield to the collector; local pacing alone does not reserve shared capacity.

Latest completed sweeps: 22 November catch-up 158 calls (43 November + 115 December), regular 158; 23 November regular 162 (44 + 118). Weekly PRN used 2 more. Total since the previous morning: 478 TIA + 2 PRN = 480. Calls vary with remaining dates, routes and pagination. Use workflow `providerCalls` and actual completion/trigger/cron-expression fields; stored page counts undercount failed HTTP/storage attempts. Cron expression is not proof of a nominal scheduled timestamp. Do not invent slots for delayed jobs.

Budget six Redis command executions per admitted call, plus failed admissions and planner/other clients. Plan: pay-as-you-go since 23 November 2026 (owner decision; the Free 500,000 commands/month could not hold four origins at about 2,400 calls per sweep, about 870,000 commands a month). The owner sets a monthly budget on the database: when it is reached Upstash rate-limits the database, admission fails closed and every origin stops, so an exhausted budget looks like `admission-unavailable` or `rate-limit` failures on all origins at once. Nothing in the code assumes a monthly command limit. No separate monthly fare-API cap was established. Fail closed when shared admission is unavailable.

**Cost with trip lengths (measured 28 November 2026):** the trip-length collector made 4,929 calls in a month-end sweep and about 8,000–9,000 at month start, so about 1.8M commands a month at month-end volumes and 2.5–3M at month-start volumes: about **$4–6 a month**, not the $2–3 estimated before the sweep. It rises again at eight origins. **Batched admission** (admitting provider calls in batches of about ten per script, which would cut collector commands roughly tenfold) was deferred on 27 November because it changes the control that protects the Travelpayouts token. Owner, 28 November 2026: it is part of launch-scope step 4 (eight origins), not an open-ended later item. It keeps the same limits and still fails closed when admission is unavailable.

## Gate, reports and continuation

**Homepage promise (owner decision, 24 November 2026).** The homepage headline is the flights-only version, "Where can two of you fly for two nights?", with the title "Two-night return flights for two, within your budget". It says return flights are counted and rooms, food and local transport are not. Rewrite it to the "tell us your budget, we'll find the trip" version only once whole-trip costs exist for the cities shown. Until then it must not imply rooms, food or transport are included.

**Custom trip planner: off (owner decision, 24 November 2026).** `customPlannerEnabled = false` in `src/config/features.ts`, pinned by `tests/custom-planner-off.test.ts`. The planner presented estimated whole-trip totals built from partial city profiles and general allowances, with no supported whole-trip cost evidence behind them. The code is kept but unreachable:

| Entry point                                                         | What happens now                                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/plan` with planner parameters (e.g. `?mode=custom`, `?origin=…`)  | the month view (three nights by default), with "Planning with your own dates and travellers isn't available yet" |
| `/plan/results`, `/plan/trips/*`                                    | 307 redirect to `/plan`                                                                                          |
| `/` with planner parameters                                         | the four-origin homepage hero                                                                                    |
| `/from/prishtina`, `/from/skopje`, `/from/zurich` and its sub-pages | 404                                                                                                              |
| `/api/locations`, `/api/ai/intent`                                  | 404                                                                                                              |
| Guide pages and `/destinations`                                     | buttons say "See flights" and link to `/plan`                                                                    |

`/from/tirana` is the month planner and stays. **Keep the planner off until real whole-trip cost evidence exists.** Then rebuild its copy from scratch rather than patching it, together with the About and Methodology pages that describe it.

**Dormant copy that must change before it is ever enabled.** `src/components/travel/Discovery.tsx` (no importer; unreachable on 24 November 2026) renders `discoverSub`: "Ideas priced as complete trips, leaving from Tirana". Nothing prices a complete trip for those ideas. Rewrite the string, and check the surrounding claims, before wiring that component into any page.

**Default origin review, due 28 November 2026 (owner decision, 23 November 2026).** `/plan` lets the traveller choose Tirana, London, Barcelona or Warsaw (`/plan?depart=london`), and defaults to Tirana (`defaultPlanOrigin` in `src/domain/plan-origins.ts`). The new origins' first 09:00 Belgrade snapshot is 24 November, so 28 November is the first day any of them can complete the same gate: five consecutive daily snapshots at December 10 destinations / 3 multi-date cities, plus the day-five renewal check. Use the Warm coverage artifacts (`--origin ALL`) for 24–28 November.

- **If London, Barcelona and Warsaw pass**, make the default the strongest origin, not the home one. Strongest means most December destinations at the €600 default, then most multi-date destinations.
- **If they don't pass**, record which origin failed and why, and keep Tirana.

Either way, record the decision here. `/from/tirana` is pinned to Tirana and does not move with the default.

December 10 destinations / 3 multi-date cities for five consecutive fixed morning snapshots, plus the same floor using observations renewed since day-one cutoff on day five. Passed 18–22 November: 22/8, 25/9, 25/11, 27/11, 27/9; renewal 18/6. On 23 November: 29/10, renewal 21/8. Whole-trip readiness and owner opening approval remain separate. A subsequent floor failure starts a new sequence; an unknown snapshot cannot extend a proven streak.

Daily and sweep-yield JSON evidence is under docs/research. Compare date identities separately from changed prices/timestamps. Report newer provider timestamps, identical still-fresh quotes, older rediscovered dates and removed dates. `incrementalToStore` removes the current run at the same freshness clock, preventing rediscovery being called new inventory.

Cadence experiment is inconclusive: 19 November included a manual run; 20 a failed sweep/recovery; 21 and 22 missing regular sweeps/catch-up. Obtain three complete four-regular-sweep days before testing whether late sweeps add no destinations AND no dates. Only then replay retained 06:17/18:17 sweeps against coverage and renewal. A proposed reduction must change refreshHours to 12 and retain graceHours=2 (14-hour catch-up), subject to owner approval. This PR makes no such change.

The fixed-cutoff measurement is the Warm coverage workflow (08:23 UTC, `check:warm-coverage --origin ALL`, JSONL artifact kept 90 days); the earlier Codex desktop REPORT automation is retired. Collection is GitHub Actions triggered by QStash and survives loss of any desktop workspace. Written daily reports, if wanted, read those artifacts. Save generatedAt and measuredAt separately. Inspect remote main before each report, never trust a stale worktree branch name. Do not dispatch collection merely to make a report green.

The global screen is research, not collector output: different retrieval breadth and city-airport normalization. Do not substitute its counts for stored morning snapshots. It did not authorize multi-origin collection. No new origin, schedule, deployment or merge is authorized by this handover.

The full portable reporting brief is `daily-report-instructions.txt`. Historical sweep-yield files do not include a standalone 20 November file; the 21 November report contains that day's run comparisons. Do not manufacture a missing report. The checked-in source manifest proves the collector and readers are already present in this PR's complete tree even though unchanged source does not appear in its diff.

## External scheduler (since 23 November 2026)

GitHub's own scheduler delivered 1–7 of the collector's 28 daily triggers in November 2026, often 6–9 hours late; on 23 November nothing ran from 08:18 to 16:42 UTC and nobody noticed. Every scheduled workflow is now started by **Upstash QStash** calling GitHub's `workflow_dispatch` API, with the GitHub cron kept as a fallback. Definitions and tooling: [`scripts/qstash-schedules.mjs`](../../scripts/qstash-schedules.mjs) (`plan`, `token`, `apply`, `list`, `test <workflow.yml>`, `prune`; run with `node --env-file=.env.local …`). A test keeps each QStash schedule identical to its workflow's fallback cron.

| QStash schedule id            | UTC                                                     | Workflow (inputs)                 |
| ----------------------------- | ------------------------------------------------------- | --------------------------------- |
| `goeksplo-fare-warm-sweep`    | 04:17, 16:17                                            | `fare-warm.yml` (`mode=sweep`)    |
| `goeksplo-fare-warm-catch-up` | every hour at :47                                       | `fare-warm.yml` (`mode=catch-up`) |
| `goeksplo-warm-coverage`      | 08:23                                                   | `warm-coverage.yml`               |
| `goeksplo-expiry-audit`       | 08:37 (after the 09:00 Belgrade cutoff in both seasons) | `expiry-audit.yml`                |
| `goeksplo-fx-refresh`         | 16:30 Mon–Fri                                           | `fx-refresh.yml`                  |
| `goeksplo-ine-rooms`          | 10:20 on the 24th and 28th                              | `ine-rooms.yml`                   |
| `goeksplo-collector-watchdog` | every hour at :07                                       | `collector-watchdog.yml`          |

Duplicates are safe. Each workflow runs one job at a time and queues the next. A collector sweep skips months that succeeded within 10 hours, and catch-up only collects after 14 hours. Coverage is read-only, the FX and room imports commit nothing when unchanged, and a duplicate audit at most repeats an issue comment. `force` mode, available only by manual dispatch, collects everything.

QStash retries a failed delivery 3 times (about 12 s, 2½ min and 30 min later), then puts it in the dead-letter queue (kept 7 days on pay-as-you-go). No failure callback is configured; failed deliveries are visible only in QStash's logs and dead-letter queue, and indirectly through the watchdog.

### Credentials

- **`GITHUB_TOKEN` (scheduler PAT).** A fine-grained personal access token. Resource owner: `artshllk`. Repository access: only `artshllk/goeksplo`. Repository permission: **Actions: Read and write**; GitHub adds **Metadata: Read-only** automatically. No other permissions.
  - It lives only in `.env.local` and inside the QStash schedules, forwarded as `Authorization` and **redacted**: QStash's dashboard, API and logs show `REDACTED:<sha256>`.
  - Never `export` it in a shell. The `gh` CLI would pick it up and lose your normal login's permissions.
  - If it leaked, someone could dispatch, cancel or re-run workflows and read logs. They could not read secrets.
- **`QSTASH_TOKEN`** (and `QSTASH_URL` if not the EU default). Needed only to change schedules. It lives in `.env.local`.

### Token expiry

**The scheduler token expires on 22 November 2027 at 23:00 UTC (midnight 23 November 2027, Europe/Belgrade).** Verified on 23 November 2026 from GitHub's `github-authentication-token-expiration` response header. Renew it by **15 November 2027**. Record the exact date reported by `node --env-file=.env.local scripts/qstash-schedules.mjs token` whenever the token changes.

What breaks when it expires:

- Every QStash delivery gets HTTP 401 from GitHub, and after the retries it lands in the dead-letter queue.
- Only GitHub's unreliable fallback cron is left, so collection becomes sporadic and the morning sweep can miss the 09:00 cutoff.
- The watchdog is dispatched by the same token, so it stops too. It then runs only when GitHub's fallback cron delivers it, which may be hours late. Expect the stall issue late, or not at all on a bad day. **Renew the token before it expires; the alert is not a safety net for this case.**
- Nothing else is affected: fares, the site and the database credentials don't use this token.

To replace it (about 10 minutes; do it a week before expiry):

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens. Open the scheduler token and choose **Regenerate token**, which keeps the same scopes, or create a new one with exactly the scopes above.
2. Put the new value in `.env.local` as `GITHUB_TOKEN`.
3. `node --env-file=.env.local scripts/qstash-schedules.mjs apply` checks the token and then re-saves every schedule with it. Redacted schedules must be re-saved with the real value, and `apply` does that.
4. `… list`: every row should show `auth=redacted` and `active`.
5. `… test warm-coverage.yml`: a "Warm coverage" run should appear within a minute (`gh run list --workflow warm-coverage.yml --limit 1`).
6. Update the expiry date in this section, then revoke the old token if you created a new one.

### 20-hour alert

The **Collector watchdog** workflow (`collector-watchdog.yml`, `npm run check:collector-health`) runs hourly at :07, triggered by QStash with GitHub cron as a fallback.

- **What it reads.** It reads the fare store directly and never looks at the collector's runs, so it notices a collector that never starts.
- **What "stale" means.** Every configured origin's current and next month must have a successful completion within 20 hours. The oldest of those is the last fully successful sweep, so one origin failing repeatedly also counts. A month that has never been collected, such as the new "next month" on the 1st, is measured from the start of the current month.
- **When stale:**
  - It opens one issue titled **"Fare collection stalled: no successful sweep for 20+ hours"**, which lists every origin-month's last success and age.
  - While the stall lasts, it updates that issue's body every hour. It never opens a duplicate.
  - The run fails only when it first opens the issue, so GitHub emails once per stall, not hourly.
- **On recovery**, it comments on the issue and closes it.
- **If the store can't be read**, the run fails (email) and no issue is opened: unknown is never reported as healthy.

**The gap compared with an external dead-man's switch (accepted, 23 November 2026).** This alert runs on the same platforms it watches.

1. **GitHub Actions down or not starting jobs:** the watchdog doesn't run either. No issue and no email until Actions recovers.
2. **QStash not delivering, or an expired or revoked token:** the watchdog depends on the same trigger. It falls back to GitHub's unreliable cron, so the alert may arrive many hours late or not at all.
3. **Neon or the `DATABASE_URL` secret broken:** you get failed-run emails ("health unknown") rather than the stall issue.
4. **Notifications:** delivery relies on GitHub notifications reaching the owner (issue creation and failed-run emails to the account that triggered the run). Check notification settings if alerts seem silent.

An external switch alerts on silence itself. This watchdog can only alert if something runs it. Practical mitigations: renew the token early, and glance at the Actions tab or the latest Warm coverage artifact once a day.

When it fires, check in this order:

1. **QStash delivery log and dead-letter queue.**
   - Run `node --env-file=.env.local scripts/qstash-schedules.mjs list`: each schedule's `last`, `next`, `lastStates`, and whether any is `PAUSED`.
   - In the Upstash console, open QStash → Logs (filter by `goeksplo-fare-warm-sweep` and `goeksplo-fare-warm-catch-up`) and the DLQ tab.
   - Reading the result:
     - GitHub **401/403**: the token (step 2).
     - **404**: a workflow file was renamed or the repository moved.
     - **422**: `ref` or inputs rejected, for example a renamed `mode` option.
     - **5xx**: a GitHub outage (step 3).
     - **No deliveries at all**: a paused or deleted schedule, an Upstash outage, or billing. Re-create with `apply`.
2. **Token validity.** `… qstash-schedules.mjs token` should print HTTP 200 and an expiry date in the future. If not, follow "To replace it" above.
3. **GitHub Actions status.**
   - Check https://www.githubstatus.com (Actions).
   - `gh workflow list --all` should show `fare-warm.yml` as `active`. GitHub disables workflows after inactivity or by hand.
   - `gh run list --workflow fare-warm.yml --limit 10`: look for runs stuck `queued`. Run names show the mode and the trigger (dispatch or cron fallback).
4. **The run logs.** Use `gh run view <id> --log`, or open the run and the "Fare warm job failing" issue.
   - Look for `fare-warm:` lines and `"status":"failed"` reasons:
     - `Provider rate-limit` or `admission-unavailable` on every origin at once: the Upstash database. Check its budget, plan and REST credentials.
     - `Wrong-origin rows N exceed 10`: provider mislabelling for that origin.
     - Database errors: Neon. Check storage against its limit and the `DATABASE_URL` secret.

After fixing, run `gh workflow run fare-warm.yml -f mode=sweep` and confirm the run succeeds. Then run `gh workflow run collector-watchdog.yml`; it closes the stall issue once every origin-month is fresh. Use `sweep`, not `force`: if the store is already fresh it makes no calls.
