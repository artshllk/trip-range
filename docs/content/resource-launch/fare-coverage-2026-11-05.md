# Two-night trips show 31% to 76% fewer destinations in cached flight data

**Fixing the stay at two nights removed roughly a third to three-quarters of recorded destination choices across six comparisons.** Relative to two-to-four-night stays, the reductions ranged from **31% to 76%** for Tirana, Prishtina and Skopje departures in November and December 2026.

The practical lesson is to choose your dates before judging your options. A broad impression that an airport offers flights everywhere does not establish what you can take for a particular weekend. Every comparison narrowed even before choosing an exact departure date.

**Evidence cutoff: 5 November 2026, 14:55:28 UTC. Version 1. Analysis: Trip Range. Source: cached Aviasales Data API fares.**

## Why the choice narrows

Cached fare data records results of earlier searches. It is not a complete timetable or a check of every date combination. Aviasales describes its [Data API](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API) as drawing on users' search history. A destination appearing for a four-night trip need not have a recorded two-night alternative.

That distinction matters when using any broad cached-fare view to plan a specific trip. **The 31%–76% range describes these six comparisons**, not an expected reduction for every airport or search service. The comparison covers all eligible departure days in the month; it does not test one particular weekend.

The full comparison shows a reduction in every airport/month group:

| Departure month | Origin | Destinations for 2–4 nights | Destinations for exactly 2 nights | Reduction |
| --- | --- | ---: | ---: | ---: |
| November 2026 | Tirana TIA | 38 | 19 | 50% |
| November 2026 | Prishtina PRN | 8 | 3 | 63% |
| November 2026 | Skopje SKP | 17 | 4 | 76% |
| December 2026 | Tirana TIA | 32 | 22 | 31% |
| December 2026 | Prishtina PRN | 8 | 4 | 50% |
| December 2026 | Skopje SKP | 8 | 5 | 38% |

Reductions use the two-to-four-night count as the denominator and are rounded to the nearest whole percentage point. Before whole-point rounding, the range is 31.25% to approximately 76.47%.

These are destination groups in the sample. Known airport aliases are grouped using the published mapping; unresolved provider codes remain separate entries. Missing evidence does not mean that a route or flight does not exist.

## €95 across Tirana's two-night destinations

**€95 was the median destination fare for Tirana's recorded two-night choices in November.** We took each of the 19 destination groups' median fare, then the median of those 19 values: each destination counts once.

Tirana is the worked example: fixing the stay at two nights reduces its recorded choices from 38 destinations to 19, supported by 35 distinct fares. Known airport aliases share a destination group.

The November price comparison uses return fares in EUR for one economy traveller. Departures are after 5 November, and each contributing provider observation was no more than seven days old at the cutoff. Baggage, seat selection and live availability were not checked.

| Origin | Median of destination medians | Sample and interpretation |
| --- | ---: | --- |
| Tirana | **€95** | 19 destination groups, 35 distinct fares; each destination counts once. |
| Prishtina | €167 | Three destinations, three fares: one per destination. The two weighting methods match only for that reason; this describes three records, not an airport benchmark. |
| Skopje | €139 | Four destinations, four fares: one per destination. The two weighting methods match only for that reason; this describes four records, not an airport benchmark. |

These figures describe the recorded destination choices. Equal destination weighting does not fill gaps in routes, dates or fares, or establish prices paid. The supporting export also reports the same calculation for December.

### Why the middle recorded fare was lower

**€54 was the middle recorded fare for Tirana, using record weighting.** Each of the 35 distinct date-and-price combinations counts once, so destinations with more combinations contribute more values.

The gap between €95 and €54 exists because some destinations contribute many more recorded date-and-price combinations than others. Giving each destination one vote raises the median by €41, about 76%. This reports the effect of unequal record counts; it does not explain why those counts differ.

The supporting record-weighted comparison is:

| Origin | Stay | Distinct fare records | Middle recorded fare (record-weighted) | Recorded minimum–maximum | Small-sample interpretation |
| --- | --- | ---: | ---: | ---: | --- |
| Tirana | 2–4 nights | 91 | €92 | €31–€718 | — |
| Tirana | Exactly 2 nights | 35 | €54 | €32–€164 | — |
| Prishtina | 2–4 nights | 20 | €130 | €85–€206 | — |
| Prishtina | Exactly 2 nights | 3 | €167 | €85–€203 | Three records, one per destination; matching medians are automatic, not an airport benchmark. |
| Skopje | 2–4 nights | 24 | €173 | €71–€417 | — |
| Skopje | Exactly 2 nights | 4 | €139 | €101–€180 | Four records, one per destination; matching medians are automatic, not an airport benchmark. |

Tirana's two-night recorded fares were distributed as follows: **15 below €50, seven from €50 to below €100, and 13 from €100 to below €200**. The middle half lay between €41 and €110. No recorded fare in that subset reached €200. These are record-weighted summaries, not equal-destination summaries.

Shortening the stay did not necessarily make flights cheaper. The duration filter changes the destinations and dates being compared: in the fare-record comparison, Tirana's median fell while Prishtina's rose. These are different samples, not a controlled comparison of the same routes. The range describes recorded values, not a promise of fares still available. The downloadable price table also includes December, quartiles and fixed price bands.

## What we count

| Unit | Definition |
| --- | --- |
| Stored row | A retained record, including duplicates produced by repeated fetches. |
| Distinct fare record | Origin, provider destination code, currency, departure date, return date and price. Re-fetching that combination does not add a record. |
| Provider sighting | The same fare identity plus its provider observation timestamp. A new timestamp can add a sighting without adding a distinct fare. |
| Destination group | A declared mapped destination choice, or an unresolved provider code where no mapping exists. Several mapped airport codes do not become several destination choices. |
| Departure date | The itinerary's stored local departure date, counted once within the stated group. |

For example, December's two-to-four-night Skopje group has **13 sightings but 12 distinct fares**. Counting all 13 as separate fares would inflate the sample. None of these counts measures seats sold or available.

## Method and evidence

We analysed the cached fare source, admitting positive economy return fares with matching currency and passenger basis, valid trip dates and a known provider observation time. Explicitly invalid records were excluded. Re-fetching an old fare did not renew its age. Tightening the age limit from seven days to 72 hours reduced November's broader destination counts to 22 for Tirana, five for Prishtina and seven for Skopje.

Collection covered selected requests, not every provider market or itinerary. A separate date-search source contained 3,969 rows without provider observation times; those rows could not enter this dated comparison. The sample is therefore a measure of qualifying recorded evidence, not all flights an airline or another search service could offer.

The coverage export spans November 2026 to April 2027, with 306 origin/month/duration cells including zeros. Its duration views overlap. The price addendum covers the 12 November/December groups used here; the weighting check covers all six exact-two-night groups. Medians and quartiles interpolate between ordered values where needed. An independent calculation reproduced the price summaries, and their coverage counts matched the original export.

| Evidence | Files |
| --- | --- |
| Prices, sample sizes, quartiles and price bands | [Price CSV](/data/fare-coverage/2026-11-05-v1/files/prices/price-summary.csv) and [JSON](/data/fare-coverage/2026-11-05-v1/files/prices/price-summary.json) |
| Equal destination weighting and percentage reductions | [Weighting CSV](/data/fare-coverage/2026-11-05-v1/files/weighting/destination-weighting.csv) and [methods and checks](/data/fare-coverage/2026-11-05-v1#weighting-methods) |
| Full coverage, including zero cells | [Cohort CSV](/data/fare-coverage/2026-11-05-v1/files/coverage/cohort-results.csv) |
| Destination counts and alias definitions | [Destination CSV](/data/fare-coverage/2026-11-05-v1/files/coverage/destination-results.csv) and [mapping](/data/fare-coverage/2026-11-05-v1/files/coverage/parameters.json) |
| Definitions, queries and verification | [Coverage methods](/data/fare-coverage/2026-11-05-v1#coverage-methods) and [price methods](/data/fare-coverage/2026-11-05-v1#price-methods) |

The calculations ran against a fixed historical cutoff in read-only transactions. The files expose aggregate findings and methods. Independently recalculating the €95 and €54 medians or rerunning the selection requires the private retained fare records, which are not published.

## Citation and next trip

Suggested citation:

> Trip Range. Two-night trips show 31% to 76% fewer destinations in cached flight data. Version 1. Evidence cutoff 5 November 2026, 14:55:28 UTC. Source: Aviasales Data API. [Study URL](https://www.trip-range.com/data/fare-coverage/2026-11-05-v1).

Trip Range calculated the statistics from Aviasales data; the provider has not endorsed the analysis. This historical study does not refresh offers or establish total trip costs. See the [methodology](/methodology) for the evidence rules and the [data catalogue](/data) for later releases and corrections.

**[Check your own departure point and dates in the Trip Range planner](/plan).** Compare the trip you can actually take, then check the current booking price.
