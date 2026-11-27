# Replaying and checking the fare study

## Coverage methods

The fixed evidence cutoff is 2026-11-05T14:55:28.867230Z. Bind the three positional values in each parameters.json in order: the UTC cutoff, the destination alias object and high-water IDs (observations 84881, fetches 1353, attempts 540). With access to the retained private rows, execute each SQL query through a parameterised PostgreSQL client in a read-only, repeatable-read transaction. The high-water IDs exclude later inserts but cannot recover pruned rows. The schema describes the inputs without supplying those records.

Use Aviasales get_latest_prices return fares for one economy traveller in EUR, non-self routes from TIA, PRN and SKP, with no conflicting departure airport or requested market. Require a positive price within the query limit, a fetch no later than cutoff, a provider observation within the preceding seven days and an actual flag other than false. Never substitute fetch time for observation time. Count future local departures after 5 November in six separate departure months, November 2026 through April 2027. A return may cross months. Count exact stays of 1–14 nights and overlapping 2–4, 6–8 and 1–14 night groups separately. Adding these cells double-counts records.

Deduplicate on origin, provider destination code, currency, local departure and return dates and price. A distinct provider sighting adds the provider timestamp to that identity. For destination counts, merge known aliases and retain unmapped codes as separate groups. The historical gate and retrospective snapshots describe this study and are not current publication criteria.

## Price methods

For the November and December 2–4-night and exactly-two-night groups, apply the same filter and record identity. Count destinations and departure dates, group EUR fares into the five disjoint bands and sort by price. Compute the continuous 25th, 50th and 75th percentiles by linear interpolation between adjacent ranks. Divide the minor-unit results by 100 and round to euro cents at the end. The independent historical check uses middle ranks and interpolation separately.

## Weighting methods

For each exactly-two-night cohort compute the median of distinct fare prices in each mapped destination group, then the median of those group medians, giving each destination one vote. Do not round between stages. Compare with the median over all distinct fare records. The percentage difference uses the latter as denominator. The coverage reduction is 100 times (2–4-night destination count minus two-night count) divided by the 2–4-night count. Round half up for whole percentages.

## Offline verification

Download the entire file tree, preserving subdirectories. From the files directory run `python3 verify-aggregates.py`. Expected output:

```text
PASS: 306 coverage cells, 12 price cohorts, 6 weighting cohorts and 6 reductions. This check does not recompute medians from original fares.
```

Run `sha256sum -c SHA256SUMS` (or `shasum -a 256 -c SHA256SUMS` on macOS) to check file identity. The public files let you inspect the method and check the published summaries. Recalculating the medians or rerunning the selection requires the private retained fare records, which are not included.
