# Proposal: pricing from our own fare history when no current fare exists

Status: **proposal, not built.** Thresholds below are starting points to be validated
against a week of warm-job data, not settled numbers.

## Why

We read the Aviasales cache and cannot fill it. On 2026-10-27, PRN→IST held 6 cached
return fares (all departing 27 Oct–4 Nov) and PRN→VIE held 1; December was empty for
both. Most searches from Prishtina, Tirana and Skopje will have no current fare for the
requested dates indefinitely. Our own store keeps every observation for 13 months, so
it can say what this route _usually_ costs, honestly labelled, where the cache is silent.

## When it is used

Only when the trip has **no current observed fare** for the searched dates. A current
fare always wins. The range replaces today's single reference fare (see "Folding in
today's single reference fare"). Below the thresholds, the trip stays
in today's no-fare state (plus nearby-airport fares). The range is never used for SEO
pages, "trips we can price" counts, or ranking against priced trips.

## What counts as a sample

**The warm job re-reads the same cache.** A route whose cache holds 6 fares, warmed every
22 h for 60 days, yields about 65 fetches of the same 6 fares: 6 fares seen many times,
not 390 observations. Rows are never the sample. Two deduplicated counts are:

- **Observation** = route, currency, departure date, return date, price, `found_at`. One
  provider sighting. The same row fetched again, or through another endpoint or query (a
  city and one of its airports, a month and a year query), is the same observation.
- **Fare** = the same identity without `found_at`: one price for one itinerary. The
  same price re-found on a later day is a new observation of the same fare.

Route means origin plus the **row's** destination code, as stored (`MIL` for both the MIL
and the BGY query). `get_latest_prices` rows carry no airport, so a range is city-level:
Milan mixes MXP, BGY and LIN. Its label must say so (the city, never an airport).

**Percentiles are computed over fares, each once,** so a fare re-found five times does not
weigh five times. **Minimums are checked on fares**, the stricter count. The label's {n} is
the number of fares, with the observation count and the `found_at` span in the receipt.

The sample is the fares matching all of:

- same origin airport or city and destination, same currency, economy (`trip_class` 0),
  return, priced per traveller;
- departure within **±21 days** of the requested departure (same season);
- nights within **±2** of the requested nights;
- `found_at` within the last **60 days**; observations without a `found_at` are excluded
  (their age is unknown);
- not marked `actual = false`.

## Minimum before we show anything

| Requirement              | Proposed          | Why                                                                        |
| ------------------------ | ----------------- | -------------------------------------------------------------------------- |
| Distinct fares           | **≥ 8**           | Below this an interquartile range is one or two fares, not a distribution. |
| Distinct `found_at` days | **≥ 3**           | One search burst on one day is not history.                                |
| Distinct departure dates | **≥ 4**           | One itinerary repeated is not a route price.                               |
| Newest `found_at`        | **≤ 14 days old** | Older evidence describes a different market.                               |

If any fails: no range, no number.

**What one warm pass gives today** (live cache, 27 Oct, the 150 warm routes, keyed and
deduplicated as above): 501 rows → 456 unique observations = 456 fares on 76 city
routes; the other routes had nothing. Per city route with data: median 3, p75 7, p90
12, max 67 (TIA→MIL). Every `found_at` fell within the last 7 days: the cache keeps no
deeper history, so anything older must come from our own accumulated passes. 16 city
routes meet the route-level minimums (TIA 13, PRN 3, SKP 0), before the ±21-day / ±2-night
window, which removes most of a route's fares for any one search. How many new fares
each later pass adds (cache churn) is unknown until the store has data;
`npm run report:fare-ages` reports raw rows, unique observations, unique fares,
`found_at` days and span, and rows-per-observation per route, so inflation is visible.
The count logic was checked against PGlite with migrations 0001–0003 and seeded
duplicates (one fare re-read 20× plus 20 `prices_for_dates` copies → 1 observation).

## What we compute

- Per-traveller **p25–p75** (interquartile range) of the sample; p50 kept for the receipt.
- Trip total shown as a **range**: other estimated costs + party × p25, to + party × p75.
- Budget fit uses the **high end (p75)**. Wording is "likely fits" / "may not fit". Never
  "Comfortable fit", never a single trip total, never "€X left".
- The flight-budget ceiling stays available as today: the most flights can cost to fit.

## How it is labelled

- New provenance kind `historical_range` (derived from `observed_fare`), so the type
  system keeps it apart from a fare.
- Label: "Recorded fare range · {n} distinct return fares, {first}–{last}".
  Supporting copy: "One traveller, flights only. Covers the city route, not a
  specific airport. Not a fare for your dates." The dates are the provider
  observation period. No individual-fare age label or dot: this is not one fare.
  Copy resolved 4 November 2026; the proposed feature remains unbuilt.
- Receipt: number of fares, date window of `found_at`, p25 / p50 / p75, newest
  `found_at`, matching rules (±21 days, ±2 nights), and that the partner shows today's
  actual price.
- Handoff CTA unchanged ("Check flights on Aviasales"); the click is recorded with state
  `historical` so its conversion is measured separately.

## How it differs on screen from an observed fare

|                  | Observed fare                                           | Historical range                                          |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Figure           | One amount: "€138"                                      | A range: "€120–€165"                                      |
| Label            | "Provider saw this fare 2 days ago" (or receipt time, fare age unknown) with age dot | "Recorded fare range · 12 distinct return fares, Sep–Oct" with no dot |
| Visual           | Solid figure, solid dot                                 | Outlined range bar (hatched fill), no dot                 |
| Trip total       | Single total, fit badge, money left                     | Range total, "likely fits / may not fit", no money left   |
| Cost-row tag     | "Stored fare"                                           | "Recorded range"                                           |
| Ranking / counts | Counts as priced                                        | Never counts as priced                                    |

## Folding in today's single reference fare

**What exists.** When no fare matches the searched dates, `resolveFlightPricing`
(src/domain/flight-pricing.ts) returns `kind: "reference"`: the single best-ranked
cached fare for the same route in the searched month(s), whatever its dates. Cards
label it "Fare from other dates"; the trip page says "Recent fare near your dates". It
never prices the trip or affects budget fit, but it sits where a price sits. Added
6 Oct (853764c / df64762) and typed as `kind: "reference"` on 8 Oct (b807f4c).

**Scale (live sweep, 27 Oct, PRN / SKP / ZRH × 20–23 Nov and 12–15 Dec):** 13–14 of 18
result cards carried a reference fare, against 4–5 that were priced. For the home
markets this is the normal state of a card, not an edge case. Examples: Basel €50 for
25–31 Dec (6 nights, Christmas week) shown against a 12–15 Dec search (3 nights);
Ankara €172 for 1–8 Dec against 12–15 Dec.

**Why it goes.** One fare from a different week is not evidence about the week
searched: different trip length, different demand, one sample. A range over many
observations, with its sample size and period stated, is evidence. They answer the
same question ("what does this route cost around my dates?"), so they become one
feature with one rule, not two.

**One feature, two outcomes, decided by the sample rules above:**

| Sample for the searched route and dates                                       | Card and trip page show                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qualifies (≥ 8 observations, ≥ 3 days, ≥ 4 departure dates, newest ≤ 14 days) | Historical range, as specified above                                                                                                                                                                                                         |
| Does not qualify                                                              | **No figure.** The no-fare state, plus "Fares were seen for 25–31 Dec" as a date suggestion that re-runs the search for those dates, where the fare is an observed fare for the trip actually searched. Plus nearby-airport fares, as today. |

- The single reference row stops being displayed. It becomes one observation in the
  sample (it is already recorded by the warm job or search), so nothing is thrown away.
- A suggested date is shown only when re-searching it would price the trip exactly (the
  same row, `exact` match), so the suggestion never leads to another "different dates".
- `referenceFareCount` in SEO summaries and the "monthly reference fare for different
  dates" line go. Ranges never enter SEO, as above.
- The handoff state `reference` is split into `historical` (range shown) and
  `other-dates` (date suggestion clicked), so each converts measurably.
- Card/page identity carries over: the range is computed from a sample bounded by an
  as-of time fixed per search hour (observations fetched before `date_trunc('hour',
now())`), so a card and its trip page opened in the same hour compute the same range.
  This matches the 30-minute flight cache that now gives cards and trip pages the same
  provider rows.

**Until the range is built,** the reference fare stays in place. The card and trip
page both use "Fare from other dates" (copy resolved 4 November 2026). A fare two
weeks away is not described as being near the requested dates.

## Validation before building

After a week of warm runs:

1. Run `scripts/report-fare-ages.mjs` and a qualification query: for each home-market
   route and each of the next 6 months, does the sample meet the minimum?
2. Report the share of PRN/TIA/SKP searches that would move from "no fare" or
   "reference fare" to "historical range" (the rest lose their figure), and how wide the ranges are (p75/p25). If ranges are routinely
   wider than ±40 %, the range is not useful and the thresholds or windows change.
3. Back-test: for fares that later appear as current observations, how often does the
   current price fall inside the range we would have shown?

Thresholds change only from these results, not by hand.
