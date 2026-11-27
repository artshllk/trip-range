# Fare study data dictionary

The public unit is a group at a historical cutoff, never a purchasable itinerary. There are three origins, six local departure months and 17 overlapping duration definitions. A positive count is evidence in that sample. Zero is a measured empty cell. Null or an empty CSV field is undefined or inapplicable, including a missing qualifying span. It must not become zero.

| Column or key | Meaning |
|---|---|
| origin, travel_month, duration | Departure airport, local departure month (YYYY-MM) and stay in local calendar nights. exact-N is one stay length. short-2-4, week-6-8 and broad-1-14 include both endpoints. |
| destinations | Distinct destination groups after applying the parameter alias map. Unresolved codes remain separate. Destination counts CSV contains only these counts and the three group keys. |
| raw_rows, distinct_fares, distinct_sightings | Stored rows including repeat fetches, distinct date/price identities, and those identities distinguished additionally by provider observation time. See the identity in methods.md. |
| departure_dates, distinct_departure_dates | Count of distinct local departure dates, separate from the UTC evidence cutoff. |
| destinations_3_fares_3_dates, destinations_2_fares_2_dates | Destination groups meeting both the specified distinct fare and departure-date minima. |
| destinations_within_72h, destinations_2_dates_within_72h | Groups with a provider observation within 72 hours, or with at least two qualifying dates in that window. |
| reconstructed_snapshots, qualifying_snapshots, qualifying_span_days, numerical_gate_pass | Number of reconstructed historical evaluations, number satisfying the numerical gate, elapsed days between qualifying snapshots, and historical gate result. These are not a current launch rule. |
| min_eur, p25_eur, median_eur, p75_eur, max_eur | Minimum, interpolated quartiles and maximum in euros. SQL input price_minor is an integer in hundredths of a euro. Output amounts are euros, not cents. |
| under_50, from_50_under_100, from_100_under_200, from_200_under_400, at_least_400 | Counts of distinct fare records in disjoint EUR intervals. The lower bound is included except for the first open-ended interval. |
| singleton_destinations, min_fares_per_destination, max_fares_per_destination | Groups with one record and the smallest/largest group sizes in the cohort. |
| fare_record_median_eur, destination_median_eur | Median of distinct fares and median of the destination-group medians respectively. |
| difference_eur, difference_percent | Destination median minus record median, in euros and as a percentage of the record median. |
| destinations_2_to_4_nights, destinations_exactly_2_nights, destinations_removed, reduction_percent, reduction_percent_display | Broad and narrow group counts, absolute reduction, percentage with six decimal places and whole-point half-up display. |

## JSON files

- Coverage gate export is a database driver-result array with one object containing audit. The public audit contains method metadata and current_gate, the 306 aggregate cells. The retained export additionally contained destination-level rows, snapshot series and individual examples. Those are outside this projection.
- Inventory is a driver-result array containing inventory: counts by origin and endpoint for observations, fetches and attempts, date ranges, market coverage, recorded outcomes, null-time counts and transaction metadata. These describe the store before filtering. SQL defines each field.
- Independent coverage results give origin, month, destinations, distinct fares and qualifying destinations for short breaks. Empty groups omitted by the independent query correspond to zero.
- Each parameters array is ordered: UTC evaluation time, alias map, high-water observation/fetch/attempt IDs. These bound replay while rows exist.
- Price and weighting summaries contain metadata and cohorts. Columns have the CSV definitions above. Transaction metadata identifies source, units, population, timing, isolation and high-water IDs. Numeric strings in historical checks have the same units as their numeric table columns.
- Independent price and weighting checks contain rows, check time and comparison counts. Coverage reductions contains cells, formula and rounding. Historical verification files keep the original check results and original input hashes; omitted internal files are explicitly identified.
- The package verification record maps source and delivered bytes and reports offline checks. The manifest describes released files and provenance. SHA256SUMS covers uncompressed files including the manifest, excluding itself.
