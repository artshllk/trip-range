# City tax and airport transfer records

Owner decision, 24 November 2026. The planner shows what is left of a two-adult,
two-night budget after the costs we can prove:

> budget − flights for two − airfare reserve − city tax − airport transfer
> = left for room and food → minus the traveller's own food amount → room figure per night

It never shows a trip total. A cost without a valid, current record is shown as
**not known**, never as zero. Code: `src/domain/budget-left.ts`; display:
`src/components/discovery/BudgetLeftPanel.tsx`.

## Files

- `content/city-costs/city-tax.json`: one record per destination city code (as in fares: `PAR`, `MIL`, `LON`…).
- `content/city-costs/airport-transfers.json`: one record per arrival airport (IATA).

## City tax record

| Field                             | Meaning                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `city`, `name`                    | Fare city code and display name                                                                                                                                                                                                                                                           |
| `status`                          | `levied`, or `none`, which is a sourced statement that no city tax applies. A missing record is **unknown**, not none.                                                                                                                                                                    |
| `basis`                           | `per-person-night`, `per-room-night` or `percent-of-room`                                                                                                                                                                                                                                 |
| `currency`                        | ISO code of the source amount (ECB-converted for display; a currency without a current ECB rate stays unknown)                                                                                                                                                                            |
| `value`                           | Minor units for fixed bases (EUR 2.50 = `250`); a percentage (e.g. `12.5`) for `percent-of-room`                                                                                                                                                                                          |
| `byClass`                         | Instead of `value`, when the rate depends on hotel star class: `{"3": 170, "4": 330}`                                                                                                                                                                                                     |
| `percentOf`, `vatPercent`         | Percentage taxes: whether the percentage is of the price including or excluding VAT, and that VAT rate. If a before-VAT tax's source does not state the VAT rate, leave `vatPercent` out: the tax is then counted on the full price, which slightly overstates it, and the panel says so. |
| `capPerPersonNight`               | Percentage taxes: a per-person, per-night ceiling, if the source states one                                                                                                                                                                                                               |
| `scope`                           | Who and what it applies to, as the source states it                                                                                                                                                                                                                                       |
| `effectiveFrom`, `effectiveTo`    | Period the rate applies to; a rate published for one year ends on 31 December                                                                                                                                                                                                             |
| `reviewBy`                        | After this date the record is not used until re-read                                                                                                                                                                                                                                      |
| `supportingSources`, `derivation` | When no single source states the figure, for example a base rate plus statutory surcharges, or a tax plus the VAT charged on it: every further source the value depends on, each quoted verbatim, and the arithmetic in words. They always come together.                                 |
| `source`                          | `publisher`, `title`, `url` (official, HTTPS), `retrievedAt`, `quote` (the rate **verbatim**, in the source language), `language`                                                                                                                                                         |

A city may have several records with consecutive periods (Paris 2026 and Paris 2027). Periods must not overlap; a stay outside every period is unknown.

Percentage taxes are not subtracted: the room figure is solved for them (`n·R·(1 + p) = money left for the room`).

## Airport transfer record

`airport`, `city`, `route` (the route counted, named for the traveller), `currency`, `oneWayAdult` (minor units), `effectiveFrom`, `reviewBy`, `source` as above. The planner counts it **both ways for two**. Owner decision, 24 November 2026: no further transfer records are being researched. An airport without a record shows the transfer as **not counted**, alongside city travel, rather than as an unknown cost. v1 is the airport transfer only: the lowest-fare public route from the arrival airport to the city centre, with the route named. City travel is not counted and is shown as such.

## Official sight prices

`content/city-costs/attractions.json` holds official sight prices (Rome only, owner decision of 25 November 2026; not to be extended to other cities yet). Each record has the official fact that justifies listing it (`selection`, e.g. ministry visitor figures), the full adult `ticket` price, and `opening` data: last entry, closed dates, free first Sunday. The card shows these prices for two as optional, never subtracted, with any closure or free day that falls inside the chosen stay. Code: `src/domain/attractions.ts`.

A transfer record may carry `supportingSources` (for example the airport operator's route page) and a `note` shown beside the fare. Rome's Fiumicino fare is the lowest any operator publishes (FL1, €8); the note says Cotral's unpublished daytime bus fare may be lower. A source that blocks automated reads carries a dated `manualCheck`, as Ciampino's ATAC page does.

## Rules for adding a record

1. **Official sources only:** the municipality, the tax authority or regional law for city tax; the transport operator for fares. No blogs, no booking sites, no aggregators.
2. **Quote the rate verbatim** from the source. If the source is ambiguous (conflicting rates, unclear basis, unclear unit or period), do not add a record. Absence stays unknown.
3. **No guessing:** a wrong number is worse than a missing one, because the traveller would act on it.
4. A `none` record needs a source that states no tax applies.
5. Run `node scripts/check-city-cost-sources.mjs`. It fetches every source and supporting source, and checks that each quote appears there verbatim (whitespace and case folded). HTML is decoded with its declared charset, JSON is compared compactly, and XML is compared raw, including inside the DGFiP `.zip`. PDFs are read with macOS PDFKit; on other systems they are reported as MANUAL. A record whose quote cannot be found is removed. The exception is a source that refuses automated reads after its quote was verified by hand: give that source a dated `manualCheck` (`checkedOn`, `note`). The checker then reports it as **UNVERIFIABLE**, never as ok, and fails once the manual check is more than 60 days old. Remove the `manualCheck` as soon as the source reads again, which the checker points out.
6. Re-read every record by its `reviewBy` date. City taxes usually change on 1 January, and transport fares at least yearly.

The route counted is the lowest single fare a visitor can buy on arrival from a ticket machine, a counter or on board, without first buying a travel card or pass or installing an app. App-only discounts are not counted, which can only overstate the fare. If a cheaper public route may exist and its fare is not verified, the airport stays unknown. A premium express route is never counted in place of an unverified cheaper one.

## Coverage, 24 November 2026 (final pass)

Scope: the 40 destination cities with the most options on the 20 November screen (four origins, €600). They hold 885 of 1,264 options. Research stops here, and more records can be added under the rules above.

| City tax                | Cities | Options | Share of top 40 | Share of all |
| ----------------------- | ------ | ------- | --------------- | ------------ |
| Stays in December 2026  | 16     | 421     | 47.6%           | 33.3%        |
| Stays from January 2027 | 15     | 401     | 45.3%           | 31.7%        |

**Known for December and January:**

- **Paris:** 2026 from DGFiP open data; 2027 from the DGFiP 2027 catalogue plus the ministry's surcharge rates.
- **Milan:** to 31 March 2026, then from resolution 144; 2027 from resolution 1481, re-read in January.
- **Rome.**
- **Vienna:** 5% before VAT.
- **Prague:** 50 Kč.
- **Barcelona:** to 31 March 2027, including the VAT charged on the tax.
- **Edinburgh:** 5% before VAT.
- **Brussels:** €5 per room.
- **London:** none.
- **Alicante:** none, since the Valencian tax was repealed in 2023.
- **Düsseldorf.**
- **Berlin:** 7.5% before VAT.
- **Geneva:** CHF 4.25.
- **Strasbourg.**

**December only:**

- **Amsterdam:** 12.5% before VAT. The 16% rate for 2027 was approved on 12 November 2026, but no amending ordinance is in the Gemeenteblad yet.
- **Kraków:** none. A 5 zł fee for 2027 is still a draft, with consultation from 6 to 27 November 2026.

**January only:**

- **Nice:** DGFiP's 2025 open data lists it both with and without the 34% surcharge.

**Airport transfer:** Athens, Dublin and Prague (59 options, 4.7% of all). No further transfer records are being researched. Elsewhere the transfer is shown as not counted.

**City tax unknown, and why:**

- **Budapest, Bratislava:** set per district, and the traveller's district is not known. Budapest District II charges 800 HUF and District XVI 400 HUF; Bratislava charges €3.50 in Staré Mesto and €3.00 elsewhere.
- **Venice:** the rate depends on the area (historic centre, Lido, mainland) and the season.
- **Istanbul, Antalya:** the national accommodation tax was cut to 1% from 1 May to 31 December 2026 (decision 11263), but the official gazette refuses the connection.
- **Belgrade, Tirana, Yerevan, Chișinău:** the tax is set in RSD, ALL, AMD or MDL, which have no ECB reference rate.
- **Lisbon:** every official page returns 403. The only readable official document, the 2025 fees table PDF, cannot tie the dormida value to its row. No 2026 table was found, and secondary sources disagree (€3 or €4).
- **Malta:** the MTA page contradicts itself. It gives €1.50 a night with a €22.50 cap, but also says only nights beyond 15 are chargeable.
- **Athens:** the climate resilience fee varies by category and season; no official 2026 table was found.
- **Palermo:** the official regulation link no longer serves the document. No official 2026 tariff table was found, and secondary sources conflict.
- **Sofia:** the municipal ordinance with the rate was not found.
- **Zürich:** no official municipal or cantonal source states the rate.
- **Frankfurt:** only a 2023 city statistics report states €2; the current statute was not found.
- **Dublin, Stockholm, Copenhagen, Warsaw, Málaga, Larnaca:** none of these is known to charge a tax, but no explicit official statement that none applies was found. In Stockholm and Copenhagen, parliamentary proposals to allow a tax only imply its absence. In Málaga there are council motions asking for one. In Warsaw no Rada resolution was found either way.
