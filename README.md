# GoEksplo

Budget-first B2C travel discovery, built with Next.js 16.2.4, React 19 and Tailwind 4. Phase 2 adds optional recent flight discovery and destination imagery, with a complete demo fallback. No LLM, accounts or reservations.

## Run

Use Node 22.13+ LTS or Node 24+ (the installed ESLint toolchain does not support Node 23).

```sh
npm ci
npm run dev
```

Open `/en` or `/sq`. `/` temporarily redirects to English. All money calculations use integer euro cents, including the protected safety reserve.

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run start
```

## Demo journeys

- `/en` → editable sentence → `/en/plan` → `/en/plan/results` → `/en/plan/trips/rugova`
- No fit: `/en/plan/results?budget=200&styles=beach`
- Slightly over: `/en/plan/results?budget=200` (the €217 demo appears only after reveal)
- Price change: `/en/plan/trips/rugova?budget=300&scenario=price-change`
- Provider failure: `/en/plan/trips/crete?budget=1000&scenario=unavailable`
- Editorial template: `/en/from/prishtina/weekend-trips/under-300`
- Albanian equivalent: `/sq/nga/prishtina/fundjava/nen-300`

All planner choices are shareable query parameters. Price-change snapshots last only in component memory. Copied links contain the current configuration, not persistent saves. Local design-reference photos are illustrative. Provider photos carry source/credit metadata and remain unverified for exact destination.

## Structure

- `src/domain`: request validation, types, pure money/ranking and explicit demo rate policy.
- `src/providers`: normalized provider contracts and local fixtures.
- `src/services`: provider composition and SEO registry.
- `src/i18n`: typed locales, URL mappings and server-loaded dictionaries.
- `src/components/travel`: reusable React design components and interaction islands.
- `src/app/[locale]`: server routes, locale root layout, translated metadata.

Read [the pivot architecture](docs/pivot-architecture.md) for the full audit, migration rules, intentional exclusions and Phase 2 work. The frozen source ZIP is in `docs/design-reference`. Do not use its generated HTML as application code.

## Optional Phase 2 providers

Copy `.env.example` to `.env.local` and configure either server-only key:

- `TRAVELPAYOUTS_API_TOKEN`: Aviasales cached/recent return-flight discovery. Without it all prices remain demo. Fares are never described as live or bookable; accommodation and other trip costs remain estimates.
- `PEXELS_API_KEY`: destination photo searches, credited to Pexels and the photographer. Exact location remains unverified. Without it Commons is used, then local illustrative photos if Commons has no suitable result.

Restart after changing environment values. Never use `NEXT_PUBLIC` for these credentials. One bounded origin flight request (ten candidate destinations), six image lookups maximum, three images concurrently; persistent Next fetch caching is 30 minutes for flights and 24 hours for imagery. Provider failures preserve usable fallbacks and show incomplete-search status. Dates in new planner links use explicit `start`/`end`; old `when` links still work. Nearby-airport and ±3-day flight expansion are not implemented.

Run `node scripts/verify-routes.mjs` against the production server after building. Provider tests use mocked HTTP with no credentials or internet. See [Phase 2 architecture](docs/pivot-architecture.md#phase-2--recent-flight-discovery-and-destination-imagery) for quote units, coverage, caching and limitations.

## Wikimedia destination photos

Wikimedia Commons is the primary external image source and needs **no API key**. The priority is verified local image → Commons → Pexels when configured → local illustration. Commons photos carry artist credit, file-page and license links, and remain marked as unverified for exact location. Only the supported CC BY, CC BY-SA and CC0 metadata pairs are accepted; unsuitable or missing licensing falls back safely.

Selected images/fallbacks are cached for 24 hours, and Commons metadata for seven days. Searches are destination-specific, bounded and timed out; optional destination coordinates enable one geographic fallback. Pexels remains optional. See the architecture and verification documents for exact bounds and limitations.

### Monthly flight discovery

Flight discovery searches the requested departure and return months, ranks exact dates before allowed ±3-day dates, and keeps other dates as reference fares. Reference fares never price the requested flight: those trips use an explicitly labeled €220/person return planning allowance. Flexible candidates display their actual dates and carry those dates into the detail URL. When affordable, the three-card shortlist preserves two cheapest options and includes a discovered international option instead of only domestic fixtures. Successful empty discovery is not a provider outage; domestic road searches still skip flight discovery.

`npm run check:travelpayouts -- --both` prints safe exact-date and monthly diagnostic reports for PRN and ZRH. Use `--month` for monthly reports only, or no flag for the existing exact-date check. Each mode makes one request per origin with a five-row limit, reads `.env.local`, and never prints credentials or private response/error text.


### Tirana collection and launch coverage

The Fare warm workflow sweeps exact two-night Tirana returns for the current and next month every six hours. Hourly catch-up triggers query successful completion receipts per month; only a missing or more-than-eight-hour-old success causes a catch-up sweep. Failed attempts do not reset that clock. Manual dispatch forces a sweep. Workflow concurrency serializes these triggers. Prishtina keeps its separate weekly reassessment allocation.

`npm run check:warm-coverage -- --on YYYY-MM-DD` measures the store at **09:00 Europe/Belgrade**, even when invoked later. Both the matched itinerary and provider-timestamp fetch must already exist at that cutoff. Eligible matched pairs from all collector runs contribute; there is no requirement for a successful run that day. Provider observations must remain within seven days. Output includes all date options and collection health separately. The €600 screen covers two adults' return fares plus the existing reserve, not the full holiday basket.

The coverage gate starts **18 November 2026**: at least **10 December destinations**, including **3 with at least two distinct departure dates**, at five consecutive daily cutoffs. On day five, rerun with `--renewed-since 2026-11-18T08:00:00Z` (or the first cutoff of a restarted streak). The same 10/3 floors must hold using only provider observations since that cutoff; filtering precedes cheapest-per-date selection. A collector delay alone does not fail the gate. Unknown snapshots cannot pass. No earlier run-only reports are retroactively counted. The earliest decision is **22 November**, with site opening still an owner decision.

The 18 November 09:00 reconstruction had 22 December destinations, 8 multi-date cities and 38 city/date options. Six-hour collection uses four sweeps/day; the measured 18 November sweep used 164 provider calls (656/day at that workload, before catch-up and weekly reassessment). Calls are serial with 500 ms minimum spacing, at most 120 starts/minute across endpoints; other token users share provider quota. A successful catch-up costs another month sweep; healthy hourly checks make no Tirana provider calls. All schedules still depend on GitHub delivering triggers.

Read-only database integration for cutoff, renewal and evidence provenance: compile with `npx tsc -p tsconfig.test.json`, then run `node --conditions=react-server --test .test-build/tests/stored-fare-coverage.test.js` with `DATABASE_URL` supplied securely. Ordinary CI skips this test without credentials.


`npm run check:sweep-yield -- --from YYYY-MM-DD` reports each completed or failed TIA month sweep against its immediately preceding sweep. Destination/date identities ignore price and timestamp changes; renewals and identical quotes are separate. A second comparison removes the current run from the store at the same clock to distinguish additions to fresh stored coverage from rediscovery of an already-stored option. Missing/failed sweeps are not evidence of zero yield. Workflow logs record actual calls per month, event, schedule and GitHub run ID; recorded database pages are only a lower bound when a request or storage fails.

The cadence experiment starts with complete days 19–21 November 2026, reviewed on 22 November. Report every sweep's additions, removals, timestamp renewal and call cost. Retain four sweeps until the extra sweeps have three complete days with no added destinations or departure dates, and replay of two retained sweeps still clears the 09:00 10/3 coverage gate. Incomplete days are inconclusive. If reduced to two evenly spaced sweeps (06:17 and 18:17 UTC), change refreshHours to 12 while retaining two hours' grace: leaving the catch-up threshold at eight hours would quietly undo the reduction. The five-day coverage/renewal launch gate remains separate.
