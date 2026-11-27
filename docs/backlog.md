# Backlog

Work that is decided in principle but deliberately not started. Each item says when to pick it up.

## Static `/plan`: no per-request rendering

**When:** after the acquisition test. Owner, 26 November 2026: do not start it before then.

**What:** serve `/plan` from static files generated when the collector runs, and do the budget arithmetic in the browser.

**Why:** every visit to `/plan` currently renders on a Netlify function and reads the fare database, so it runs on the credit meter (web requests, compute) and on database availability. A static `/plan` would have no per-request rendering, no database read per visit and nothing on the credit meter beyond static file requests. It is the permanent fix for the hosting-cost class of problem in [hosting.md](hosting.md), and it would make every host, including the free tiers ruled out there, an option again.

**Notes for whoever starts it:**

- The collector already runs on a schedule (GitHub Actions). It would write the month data per origin, the same rows `monthDestinations` reads today, as versioned JSON next to the site, through a build or a storage upload. The choice decides whether a fare update needs a deploy, which costs credits on Netlify.
- Per-visit inputs (budget, food amount, room standard, month, origin) stay in the URL, and the arithmetic moves into the browser. The domain functions are already pure.
- The coverage gate, freshness rules ("no same-day departures", the 7-day sighting window) and the evidence records must be applied when the files are generated, and stamped with that time.

## Variable trip length: blast radius

**When:** after launch, once the owner's separate research (provider per-call behaviour, cache coverage at 3, 5 and 7 nights, which durations are worth supporting) is back. Do not start it, and do not change the collector, before then.

**Why it is big:** "two nights" is not one setting. It shapes the collector's queries, what the store keeps, the coverage gate, the budget arithmetic and the copy. Places that assume exactly two nights, found 26 November 2026 (line numbers as of `release/v1` that day):

**Collector and store**

- `scripts/fare-warm-run.ts:176`: builds each dated request with `returning = addDays(day, 2)`.
- `scripts/fare-warm-run.ts:215`: keeps only rows where the return is two days after departure.
- `src/domain/fare-refresh.ts:5`: the refresh endpoint is named `triprange/exact-two-night-refresh-v1`, so receipts and health are keyed to two nights.
- `src/server/fare-warm.ts:32`: the cross-month `return_at` handling assumes a two-night stay.
- Store: `fare_observations` already records `departure_date` and `return_date`, so other lengths fit without a schema change. Every reader filters to two nights, though (below).

**Readers and the coverage gate**

- `src/server/fare-store.ts:211`: `/plan`'s `monthFares` query requires `return_date = departure_date + 2`.
- `src/server/fare-refresh-store.ts:125`: the coverage-gate query requires the same.
- `src/domain/month-discovery.ts:64`: `monthDestinations` drops any fare whose return isn't exactly two days later. This drives `/plan`, the coverage gate (`scripts/check-warm-coverage.ts`) and yield checks (`scripts/check-sweep-yield.ts`). The gate's 10+ / 3+ thresholds were set for two-night coverage and would need restating per length.
- `content/fares/tirana-screen-2026-11-16.json`: the Tirana launch screen is a two-night snapshot.

**Budget arithmetic**

- `src/domain/budget-left.ts:24` (`NIGHTS = 2`) and `:26` (`FOOD_DAYS = 2`): city tax per night (`:425`), food days (`:497`) and the room-per-night figure (`:511`) all use them.
- `src/domain/budget-left.ts:445-446`: the city-tax line says "two nights" in its label.
- Room figures: published room averages are per room-night and scale; the old reviewed room panel (`src/domain/costs/room-panel.ts:172`) is defined on two-night stays.
- `src/domain/attractions.ts`: sights within the stay use the card's dates, so they follow automatically.

**Switched-off or non-live code with the same assumption** (only matters if revived): `src/domain/request.ts:32` and `src/domain/dates.ts:37,83` (custom planner and weekend presets), `src/components/discovery/DestinationGuide.tsx:20`, `src/domain/pricing.ts:23`, `src/domain/dynamic-destinations.ts:4`, `src/domain/types.ts:188`, `src/domain/costs/planning-parameters.ts:25`, `src/domain/costs/profiles.ts` (sightseeing reserves), `src/catalogue/flight-destinations.ts:3`, `scripts/research-markets.ts:434`, `scripts/research-cost-scope.ts:68`.

Note: `price_minor * 2` in the two fare queries means two travellers, not two nights.

## "Two-night" in the copy

Visitor-facing text that says two nights, as of 26 November 2026:

**Live pages**

- Home: `src/app/[locale]/page.tsx:73`, the headline "Where can two of you fly for two nights?"
- Page title and description: `src/i18n/en.json:181-182`.
- Footer, on every page: `src/components/layout/Footer.tsx:33`.
- `/plan`: `src/components/discovery/MonthPlanner.tsx:123` (h1 "Two-night trips from …"), `:133` (intro), `:269-270` (few or no results notices).
- `/plan` card: `src/components/discovery/MonthDestinationCard.tsx:57` ("Choose your two-night stay").
- Budget panel: `src/domain/budget-left.ts:445-446` ("City tax … two nights").
- Room figure: `src/components/travel/RoomEvidence.tsx:92` ("two nights").
- `/from/tirana`: `src/seo/registry.ts:222-246` (title, h1, description, intro, FAQ).
- Destination guides: `src/app/[locale]/destinations/page.tsx:64,69`; `src/components/discovery/DestinationGuide.tsx:35,97,156`; guide content `content/destinations/{vienna,london,istanbul,barcelona}.json` ("2 nights…" day plans).

**Not live** (switched-off landings and unpublished SEO candidates): `src/seo/registry.ts:126,150,173`, `src/seo/date-contract.ts:36,54`, `src/components/seo/SeoLanding.tsx:323`, `src/seo/candidates/registry.ts` (about 20 lines), `src/i18n/destination-content.ts:34`, and `content/archive/`.

## City-tax night caps (before seven-night city tax is shown)

**When:** with or after variable trip length. Owner decision, 27 November 2026: seven-night city tax shows "not known" until each city's cap is sourced.

**What:** for each of the 13 cities with a city-tax rate (Paris, Milan, Rome, Vienna, Prague, Barcelona, Amsterdam, Edinburgh, Brussels, Düsseldorf, Berlin, Geneva, Strasbourg), source whether the tax stops after a number of nights. Record it as a new field in `content/city-costs/city-tax.json`, with a verbatim quote and URL like every other value, or as a sourced "no cap". Some caps are known to exist; Edinburgh's levy, for example, applies to the first five nights only. They have not been checked against official sources for these records.

**Rule until sourced:** a stay longer than any night count the record covers shows city tax as "not known", never a multiplied figure. A wrong rate is worse than a missing one. Two and three nights are unaffected once it is confirmed that no record caps below three nights.
