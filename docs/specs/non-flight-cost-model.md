# Proposal: the non-flight cost model

## Tirana measurement release · 16 November 2026

Tirana is the sole launch origin. The planner opens on this calendar month and the next and accepts departures on any day with a return two nights later. The €600 flight screen on 16 November found 21 destinations in December, 10 in January and two in February. Each month counts distinct destination markets with a provider timestamp within seven days. It uses twice the observed single-adult return and the usual reserve. A recorded fare does not establish two seats or a complete trip price. At fewer than three qualifying markets, show the actual count, keep the dated evidence accessible and offer the nearer months.

### Proposed December launch criterion

Use 16 November as the baseline. The first prospective five-day window is 17–21 November. Score the 09:00 Europe/Belgrade report for each calendar day using that day's independently reproduced December fares from Tirana, at €600 for two adults with the usual reserve and an exact two-night return. Count destination markets and distinct outbound dates within each market.

On each of five consecutive days require at least **10 destinations**, including **3 with at least two departure dates each**. The latest December refresh at the report cutoff must have completed successfully that day. A missing, incomplete or below-floor day breaks the streak. A rerun can supply that day's measurement before the cutoff. Each day contributes at most once. On day five, require the same 10 and 3 after discarding fare options whose provider observation predates the first report of the streak. This tests whether newly observed fares can support the shortlist as older evidence expires. A failed renewal check keeps the launch on hold. Apply the same rule to the next rolling five-day window.

The baseline had 14 destinations with one departure date, five with two, Vienna with four and Milan with eight. Ten destinations preserves roughly half of the observed breadth. Requiring three with date choice ensures that losing Milan still leaves at least two other markets with alternatives when the floor is met. These are proposed product thresholds. One day cannot establish how often the collector will meet them. Persistent misses keep broad discovery on hold. Report whether the shortfall is destination breadth, choice of dates or renewed observations. [16 November collector run](https://github.com/artshllk/goeksplo/actions/runs/43925431444)

### Measurement order

Milan and Berlin are released for measurement. Defer London pending another eligible date. Estimates are combined operator and independent reviewer hours once capture stages 2 and 3 are available.

| Order and base | December departure dates | Frame and airport transfer work | Setup | Each full round | First full basket |
|---|---:|---|---:|---:|---:|
| 1. Milan · Piazza del Duomo | 8 | New OSM frame, verify three-star status and direct bookings. Check MXP and BGY separately. Cheapest observed return was €64 for two, 5–7 Dec via MXP. | 2–3.5 h | 1.5–2.5 h | 3.5–6 h |
| 2. Berlin · Alexanderplatz | 2 | New OSM frame, independent three-star panel and BER transfer. Keep the annual all-class figure labelled as market context. | 2.5–4 h | 1.5–2.5 h | 4–6.5 h |
| 3. London (deferred) · Trafalgar Square | 1 (27–29 December) | Replay the OSM frame and verify class declarations. Check LTN, STN, LGW and SEN separately, using the airport on each fare. | 1–2 h | 2–3.5 h | 3–5.5 h |
| **Committed total · Milan and Berlin** | | | **4.5–7.5 h** | **3–5 h** | **7.5–12.5 h** |

Vienna keeps its frozen 17 November slot alongside Barcelona. Barcelona’s December 2025 benchmarks are published. Vienna’s class figures are derived from RevPAR divided by room occupancy, and the pooled benchmark uses estimated occupied room-nights. Vienna is outside the hours above.

For each new city, freeze and publish the dated OSM frame and selection recipe with ODbL attribution. Verify premises, eligibility and direct booking before pricing. Freeze up to eight eligible properties within 2 km, keep every missing slot and independently review the paired weekday and weekend stays. Record the observed room spread and compulsory charges. Complete the basket with three sampled meals, breakfast reconciliation, the actual arrival airport’s return transfer, local journeys and lodging tax. Record active capture and reviewer time by stage. [Room design](../research/room-observation-round-2026-11/README.md) · [Food and transport method](https://github.com/artshllk/goeksplo/blob/5dcb1789d7f6e8f4cf4cbb1b2119ae42fcc07cc9/docs/specs/food-and-transport-observations-v1.md)

London, Istanbul, Rome and Paris each had one eligible December departure in the collector. Keep them queued. Reconsider a city when a fresh screen finds at least two distinct departure dates in the same target month. Run that check before freezing its frame.

**Prishtina re-entry test.** Preselect four ordinary two-night weekends 3–8 weeks ahead. In two successive weekly checks, require at least three distinct destinations on at least three of the four weekends, each with an exact return, identified airport, provider timestamp within seven days, party price and working public booking handoff. To claim a €600 trip, also demonstrate at least one complete, supported basket within €600 on each qualifying weekend. Continue collecting Prishtina and Skopje fares for reassessment.

## Earlier model decisions

Status: **machinery built against synthetic fixtures; no data loaded.** Revision 8 (2026-11-04). Displayed room allowance and separate statutory-tax disclosure approved. The panel transform (`src/domain/costs/room-panel.ts`), price-level scaling (`eurostat.ts`, `stay-figures.ts`), the holdout harness (`holdout.ts`) and card wiring exist; `reviewed-stay-data.ts` is empty, so nothing new is shown live.

**Decisions of 4 November 2026** (they override the text below where it differs):

- **No HICP roll-forward.** An observed figure is used unchanged until the next quarterly round replaces it. The hotel index is not seasonally adjusted, so a month-to-month ratio reads seasonal swings (Austria's index moved about 4% between January and February 2026) as inflation; that error is larger than the staleness it corrects. Layer 3 is withdrawn. **Seasonality** is a separate future feature that requires seasonally adjusted data.
- **The budget-fit test uses the upper bound**: the high end of the stay range plus any possible lodging tax, with the reserve recomputed on that spend, exactly as "leaves for flights" does. If the central estimate fits but the upper bound does not, the card says the fit is unconfirmed (`fit-unconfirmed`); it never says the trip fits.
- **Anchor assignment.** The groups decided on 28 October stand. Every other covered country scales from the anchor whose price level (`A0111`, latest common year) is nearest, by the smallest |ln(destination ÷ anchor)|. This is computed from the approved snapshot, never hand-assigned, and does not depend on which anchors currently have a figure. France (116.0) goes to Vienna (116.8).
- **Fallbacks contribute** (non-refundable, breakfast-included), and each figure records how many stays used one. The card names the share; at half or more breakfast-included it calls the figure a breakfast-included figure.
- **Bands are by sample size** (see Statistic). London's ±35% stands.
- **Ranges are shown in whole €5**, rounded outward so the shown range never narrows the band.
- **Holdout on 18 November 2026**, the day after all five panels exist: `npm run holdout:room-panels`. It predicts each anchor from its nearest price-level neighbour, measures the error at full and reduced donor sample sizes, and its reviewed result replaces both the sample-size bands and the +25 scaled placeholder. A measured width over ±35% withdraws scaled figures (anchor-only). London has no price level and cannot take part, and Istanbul only if its round is sufficient, so the first run has at most four held-out anchors. Every band records its n. A band from fewer than three held-out errors is not a measurement: it keeps its value labelled "editorial placeholder" on the card and in the run's output, which states plainly which bands were replaced. No special case for London. A Tirana panel in the February 2027 round unlocks AL, MK, ME, RS and BA and adds a fifth holdout anchor. With flights unpriced for almost
every home-market search (`historical-fare-range.md`: 16 of 150 routes meet the range
minimums, Skopje 0), the card's only real numbers are stay, food, local transport, the
airport transfer and tourist tax. This model is now the product's critical path.

## Constraints

- **No hotel API.** Hotellook closed in October 2025 and Travelpayouts offers partners
  no replacement. Stay must be modelled from published sources and our own observations.
- **Every figure is a range with a basis and an as-of date**, shown as an estimate,
  never a price, with `planning_estimate` provenance and its sources.
- **No runtime scraping, no unlicensed datasets.** Numbeo-style crowd data is excluded.
  Inputs are Eurostat statistics, operator and municipal tariffs, and our own documented
  room observations.

## Coverage: Europe only

The model covers a destination only where observation or index data exist:

| Coverage                            | Where                                                                                                              | How                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Full**                            | EU-27; Iceland, Norway, Switzerland; Albania, Bosnia and Herzegovina, Montenegro, North Macedonia, Serbia, Türkiye | Eurostat price levels (scaling). No roll-forward (withdrawn 2026-11-04).                                                                                                                                                                                        |
| **Anchor only**                     | **Prishtina** (Kosovo)                                                                                             | No price-level row (verified: no `XK` values). Observed; never scaled from or to. Its HICP is no longer used (roll-forward withdrawn).                                                                                                                         |
| **Anchor only, not rolled forward** | **London**                                                                                                         | No Eurostat price level or HICP for the UK, and no ONS extension. London is observed each round and carries only what was observed: no scaling, no roll-forward between rounds, no seasonality between the observed seasons. Nothing else in the UK is covered. |
| **Outside**                         | The rest of the UK; everything outside Europe                                                                      | No scaling data. The last worldwide comparison (World Bank ICP) uses 2021 data.                                                                                                                                                                                 |

**What the product does outside coverage:** it does not estimate stay, food, local
transport or tourist tax there, and it never falls back to the generic per-currency
allowances (`planning-rates.ts`) for these destinations.

- **Results ("anywhere" searches):** outside-coverage destinations are left out of the
  results list. Without a non-flight estimate there is nothing to compare, and the card
  would have no figure at all.
- **Explicit destination search, trip page, guides:** the trip is shown with "We don't
  estimate costs for {city} yet", no budget rows, no "leaves for flights", and the
  Aviasales handoff. Copy placeholder for Codex.
- **SEO:** outside-coverage destinations are never published as budget pages.

## What exists today

| Layer                                              | Where                                                                                                   | Problem                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Flat allowances per currency                       | `src/domain/money/planning-rates.ts`                                                                    | Same EUR food, transport and stay for Tirana and Zürich: no country scaling.                                                  |
| One room baseline per catalogue city               | `src/catalogue/flight-destinations.ts` (`stayBaseline`, set 2026-10-06)                                 | No documented basis or range, no seasonality.                                                                                 |
| Reviewed partial baskets: Belfast, Milan, Brussels | `src/domain/costs/profiles.ts`; evidence in `docs/seo/evidence/costs/tier-a-baskets-2026-10-08-v2.json` | **Real but thin, from one research session on 2026-10-08** (phase 7B.3A.2), hence the shared expiry of 2026-12-07. See below. |

**What the three profiles actually are** (checked against their evidence file). They are
not fixtures: every amount traces to a dated public source. But they come from one
bounded research pass, not a method, and none of them meets the room-panel method below.

- **Belfast (GBP):**
  - stay £140 per room-night, rounded up from **three** Expedia results for 28–30 Nov,
    all non-refundable;
  - food £55 per person-day, from two menus;
  - transit £4 per person-day (mLink day ticket);
  - activities £10 per person-night.

  The evidence file itself says "small Belfast room sample, not market median".

- **Milan (EUR):** only a transit tariff (ATM three-day ticket, €15.50 per person-trip).
  The stay sample was rejected as insufficient.
- **Brussels (EUR):** only transit (STIB daily cap, €8.50) and activities (€7.50 per
  person-night). The stay sample was rejected.

The other 11 destinations in that pass were deferred with no amounts.

**Consequence:** none of the three is a usable anchor, so the anchor list does not change.

- Milan's and Brussels' transit tariffs are exactly what layer 4 needs. They move there,
  re-checked against the operator.
- Belfast is outside coverage (UK, not London), so its profile is retired.
- Until the model ships, all three expire on 2026-12-07 and fall back silently (see
  Staleness). That date should not be extended without a new observation.

## Model

Each component resolves to `{ low, central, high, unit, basis[], asOf, reviewAfter }`,
from the most specific layer available.

### 1. Anchor cities (observed)

Anchors are the ground truth. Each holds:

- **stay**: a room-rate panel observed by the method below;
- **food**: a fixed adult day basket priced from published menus (as Belfast does now);
- **localTransport, arrivalTransport**: exact tariffs (layer 4).
- **accommodation tax**: recorded as stated included, stated extra or silent; never added to the stay allowance.

The anchor list is below: **seven cities**.

### 2. Cross-country scaling: Eurostat price level indices

For a covered city without its own basket, scale the nearest anchor's stay and food by
the ratio of category price levels (country ÷ anchor country), using dataset
**`prc_ppp_ind_1`** (COICOP 2018; the older `prc_ppp_ind` is frozen):

| Component                                                       | Category                               | Code      |
| --------------------------------------------------------------- | -------------------------------------- | --------- |
| stay, food                                                      | Restaurants and accommodation services | `A0111`   |
| (transit tariffs are exact, layer 4; this is only the fallback) | Passenger transport services           | `A010703` |

Price levels (EU-27 = 100), restaurants and accommodation, from the API on 2026-10-28
(dataset updated 2026-07-09):

|      | AL   | MK   | ME   | RS   | TR   | EL   | ES   | IT    | DE    | FR    | AT    | CH    |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ----- | ----- | ----- | ----- | ----- |
| 2024 | 52.3 | 50.6 | 66.7 | 68.6 | 67.0 | 86.6 | 84.1 | 108.6 | 110.7 | 109.5 | 109.6 | 169.6 |
| 2025 | 53.3 | 48.3 | 66.6 | 65.5 | 78.3 | 86.1 | 85.4 | 110.8 | 108.4 | 116.0 | 116.8 | 163.1 |

- **Revisions:** results for year t are preliminary at t+6 months, revised at t+12 and
  t+24, and final at t+36. Releases come in March, June and December. A scaled figure
  records the release it used.
- **Year-on-year movement is real:** Türkiye moved +11.3 points and Austria +7.2 in one
  year. Ratios are refreshed with every release, not fixed.
- **City ≠ country:** capitals and resorts run above their national average. Scaled
  figures get a wider range than observed ones, and the label says "scaled from
  {anchor}". A scaled stay also inherits that anchor's embedded tax, not the destination's own tax: Barcelona scaled from Milan carries Milan's embedded treatment. Directly observed anchors have no such cross-city mismatch. The owner expects this to be small against the ±25% planning band; the error has not been measured and this does not replace holdout validation.
- **The scaled band is derived from the holdout test, not chosen.** **±25 % is a labelled
  placeholder** (`SCALED_BAND_PLACEHOLDER` in code, shown nowhere publicly) until the
  first leave-one-out run (see Validation):
  - predict each anchor from its nearest neighbour through layers 2–3;
  - record the signed error per component and per night type;
  - set the band from that distribution: the 80th percentile of absolute error, stored
    with the run date and the n it came from.

  It is the same reasoning as the freshness tiers: measured, then set. It is re-derived
  each yearly ratio round. With seven anchors the first run has at most 7 pairs per
  component, so the band is reported with its n and treated as provisional until a
  second year doubles it.

### 3. Staying current: monthly HICP (`prc_hicp_minr`) — WITHDRAWN 2026-11-04

Not built; see the decisions at the top. Kept for the record.

Roll each observed amount forward from its observation month:
`amount_now = amount_observed × HICP(latest) / HICP(observed month)`.

- **Dataset:** **`prc_hicp_minr`**, ECOICOP v2 (identical to COICOP 2018 down to 5
  digits) from January 2026 data, base **2025 = 100** (`I25`), released 15–18 days after
  the reference month. The old `prc_hicp_midx` is frozen at 2025. January 2026 may show
  series breaks from the reclassification.
- **Indices, with fallbacks verified per anchor country (Jan 2025–Sep 2026):**

| Component               | First choice                                | Fallback                             | Gaps found                                                    |
| ----------------------- | ------------------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| stay                    | `CP11201` hotels, motels, inns              | `CP112` accommodation services       | Kosovo has only `CP112`                                       |
| food                    | `CP1111` restaurants, cafés                 | `CP111`                              | none among anchors                                            |
| transit (fallback only) | `CP07312` rapid transit/tram, `CP07321` bus | `CP073` passenger transport services | DE, IT, AT, CH, MK, AL, XK lack `CP07312`; CH lacks `CP07321` |

- **Seasonality for stay:** the hotel index gives a per-country seasonal factor (month ÷
  12-month mean) for the requested travel month. It is large where it matters: Greece's
  2025 hotel index ran from 88.7 (December) to 118.7 (July), while Austria's stayed flat
  except December (106.3).

### 4. Exact tariffs per city

Fixed published prices, narrow range, no scaling:

- **arrivalTransport**: airport rail, bus or fixed taxi zone fare from the operator;
- **localTransport**: operator day or multi-day pass;
- **accommodation tax research**: plausibility and inclusion checks, property-dependent disclosure and future provider-quote reconciliation; no statutory add-on to the allowance;
- **departureTransfer** to a nearby airport (already modelled).

Each tariff records its source URL, its legal instrument where there is one, its
effective dates and its next known change. Reviewed every January, and on any announced
change.

## Room-rate observation method

Written before any observation is made. Two observations three months apart must be
comparable, so the method fixes everything except the date and the price.

**Approved target (3 November, displayed-stay-separate-tax-v2):** Use the displayed public two-night room price. Record stated_included, stated_extra or page_silent for lodging tax after checking checkout and published operator terms; all three are usable. Preserve the wording, location, terms URL, timestamp and any exact whole-stay tax amount. Silence is not proof of inclusion or exclusion. Never add tax to the room allowance. An explicitly extra tax is counted once in the trip total. A possible statutory charge appears beside the headline; compare budget with headline plus possible tax. If its amount is unbounded, do not claim a fit. Property-dependent fees and unknown non-tax mandatory charges retain their separate rules.

**The panel, fixed once per city:**

- **Area:** a pinned named central point and a radius of **2 km** for every first-round city. The named central landmark is pinned to a dated OpenStreetMap object state, including version, changeset and contributing geometry. Official property points remain valid; OSM property geography is allowed only when matched to the official address. OSM supplies no classification or price evidence. Store the full computed distance for every candidate, including exclusions; ambiguous or missing matches block selection. No radius expansion or airport-based centre is silently substituted.
- **Tiers, mapped to the app's stay levels** (only **standard** is observed every round;
  simple and comfort are measured once a year, see "Tier ratios"):
  - simple: officially classified 2★, or an unclassified guesthouse with guest rating ≥ 7.5/10;
  - standard: 3★;
  - comfort: 4★.

  Hostels, dorm beds, apartments and aparthotels are excluded, because cleaning fees
  and taxes make them non-comparable.

- **Sampling frame.** The [method record](../research/room-observation-round-2026-11/method.json) pins the official directory for Vienna, Barcelona and Milan. London uses the dated OpenStreetMap radius extract. Istanbul combines its dated extract with individually located and deduplicated ministry-licensed premises in the same 2 km radius. Its eight are fixed to the verified frame of 3 November 2026; later licence matches do not change them. The ministry register establishes their classification. Record the source, scope, date, version, complete set of objects and replay instructions.
- **Selection.** Rank the eight nearest eligible properties using the bounded 50 m tiebreak. At initial selection each must have the required classification, a verified premises, a Booking.com overall guest score of at least 7/10, and a publicly displayed rate directly bookable on its operator’s own site. Verify any external engine is the hotel's own sales channel. Contact-only and email-request properties fall outside the choices an online trip planner can offer. Record every nearer exclusion and any replacement, with date, reason, distance and rank. A duplicate, unverified licence or unexplained premises conflict excludes the candidate and the search continues. Record a missing stay if a retained hotel sells out for one of the two dates.
- **London size decision (3 November 2026, standard tier).** The complete fixed panel has six properties, requiring twelve stays. Only six of 246 geographic candidates met the published criteria, chiefly because UK operators rarely published an admissible star rating in this frame. Its estimate carries wider uncertainty than the eight-property panels; the additional width is unmeasured. All six are operator-declared three stars, not an independently assessed tier equivalent to Vienna’s or Milan’s. Preserve both limitations when comparing or using the estimate.
- **Published evidence.** Every city and every replacement uses publicly reproducible evidence for each required fact. Never contact an operator to obtain evidence or request a link. Exclude the property when admissible published evidence is missing, record the reason, and continue under the same ranking rule.
- **Selection limits.** The online booking criterion favours hotels with booking engines and reduces pension representation in Vienna. Consistent application makes rounds comparable within this target stock. The size of the bias may vary by city. Operator-declared street addresses in London and Istanbul carry the operator URL and check date.
- **Spatial stability:** preserve object type/ID/version/changeset, extraction time, geometry snapshot/hash, each candidate’s computed metres, tie group and tie key. For each rank, record the nearest remaining distance, the candidates up to 50 m farther away, and the winning ID. Recompute the window after removing that winner. Retain the frozen composition across rounds. Any later coordinate correction requires a before/after radius, rank and membership audit; no silent recomposition.
- **Composition:** each round and sample records a frozen composition ID. If a property closes or permanently stops being bookable, use the next-nearest property meeting the **original** criteria, with a dated replacement reason and evidence. Temporary unavailability is a missing observation, not a replacement. Never silently substitute. Officially classified 3-star pensions/guesthouses with conventional ensuite rooms qualify; apartments and aparthotels do not.
- **Known selection limitation:** guest scores correlate with price, so this filter can bias the panel upward. The owner accepts a consistent filter across cities and rounds; the bias magnitude is unmeasured.

**Classification provenance (jurisdictional rule):** require independent classification where a mandatory or widely adopted scheme exists, including Türkiye and Hotelstars jurisdictions. Where classification is voluntary and thinly adopted, including the UK, accept an operator's explicit three-star declaration on its own site as `operator_declared`, with URL and check date. Keep independent classification separately sourced or null. Never use aggregator-supplied stars. Carry the label on every property, sample and comparison: an operator-declared panel is weaker evidence and cannot silently be treated as equivalent to an independently assessed panel. Self-declared tiers have no verified common assessment criteria; Hotelstars tiers do. The owner expects the guest-score filter and estimate band to absorb some variation, but the effect is unmeasured and the ±25% scaled band remains provisional. Do not add feature-level checks to compensate.

**First round:** mid-range/standard only, for **Milan, Istanbul, Vienna, London and Barcelona**. Tirana and Prishtina are origins and require no destination panel in this round. This does not create missing anchor observations or authorize scaling without them. Preparation and the executable entry checks live in [the round packet](../research/room-observation-round-2026-11/).

**Each round:**

- **Lead time:** one **Tuesday** observation session per city, with Tuesday check-in **28 days** later and Friday check-in **31 days** later. Record the applicable lead explicitly on every sample. The asymmetry is fixed across rounds; changing either lead requires a new method version. Owner reasoning: we sample mixed stays, not a weekend-premium product; a reliably completed single session is preferable to two sessions that get skipped. The assertion that 28–31-day pricing curves are sufficiently flat is an owner assumption, not measured evidence.
- **Nights:** two stays per property per round. **Weekend:** Friday to Sunday (2
  nights). **Weekday:** Tuesday to Thursday (2 nights). Both fall in the same target
  week.
- **Occupancy and rate:** 2 adults, 1 room, double or twin, **the lowest displayed rate
  with free cancellation**. If none is available, the lowest rate is used and flagged.
- **Price recorded:** Use the displayed public two-night room price. Record stated_included, stated_extra or page_silent for lodging tax after checking checkout and published operator terms; all three are usable. Preserve the wording, location, terms URL, timestamp and any exact whole-stay tax amount. Silence is not proof of inclusion or exclusion. Never add tax to the room allowance. An explicitly extra tax is counted once in the trip total. A possible statutory charge appears beside the headline; compare budget with headline plus possible tax. If its amount is unbounded, do not claim a fit. Property-dependent fees and unknown non-tax mandatory charges retain their separate rules.
- **Rounds:** quarterly, targeting stays in **February, May, August and November**. The
  four seasons are observed directly. Months between are not bridged until seasonally adjusted data exist.
- **Events and holidays:** exclude national public holidays ±1 day, the fixed Christmas/New Year interval **21 December–6 January**, and events on a named per-city list decided before pricing and reviewed annually. A major event must plausibly affect citywide accommodation prices, considering hotel stock and attendees' need for overnight accommodation. Ordinary trade fairs are normal conditions and stay in the sample. Attendance totals alone do not establish room demand. Excluding all fairs would bias the series toward unusually quiet weeks.
- **Calendar shifts:** move the observation and both stays together in whole weeks, normally at most **+14 days**. If no eligible week exists inside that limit, a documented exception may extend the search, recording **every excluded week**, its blocker and organizer/authority source. Preserve Tuesday and the fixed 28/31-day leads. The approved Istanbul round-one exception is used only if the corrected named-event rule still requires it; if used, disclose the different stay period and return to the standard February cycle.

**Collection conditions.** Anything that can change a displayed rate is fixed and recorded,
otherwise the panel is not comparable:

- **Logged out**, in a **fresh private window** per city session: no account, no
  loyalty or member tier ("Genius", "member price", "secret deal"), no cookies or search
  history carried over. Disable personal, payment and password autofill (including extensions); verify each first search stayed anonymous. If personal details appear or the site recognises the observer, retain the stay as ineligible and do not repeat it. Evidence screenshots and PDFs must contain no personal data. A rate shown only to members or app users is not recorded; the
  public rate is.
- **Point of sale.** Use the operator’s own property-specific booking page in English, with Germany as the source market. A verified white-label checkout sells directly for the operator. Use Booking.com once for the initial guest score.
- **Browsing country.** The owner confirmed a Kosovo internet connection on 3 November 2026. Version 7 fixes Kosovo (`XK`) for all cities from the first round onward. The observer confirms the connection country and records it on the session and each stay. A change in any later round requires a new method version and baseline because visitor country can affect the displayed rate. Keep the series separate. Germany was the suggested connection default before the first round and continues to be the booking site’s market setting.
- **Observation currency.** Record the total the operator displays in EUR. If the engine cannot display EUR, mark the sample ineligible.
- **Device pinned:** desktop browser, no mobile-only or app-only rates.
- **Same source per property:** a property is always priced on the same site. If that
  site stops listing it, it is replaced like a closed property, and recorded.
- **Display settings:** total price including taxes and fees, for 2 adults and 1 room,
  with nothing pre-selected. No promo codes, coupons, packages or bundles. **Room only**
  (no breakfast) where offered; otherwise breakfast-included is recorded and flagged.
- **One search per property per stay:** a repeated search can move a displayed rate, so
  only the first displayed rate counts, with the time of day recorded.
- **Recorded on every sample:** site, country version, network country, currency,
  device, logged-out state, time, and anything that deviates from these conditions. A
  sample that breaks a condition is kept in the raw file but excluded from the figure.

**Tier ratios (yearly).** Once a year, in the November round, the simple and comfort
panels are priced under the same conditions. Each tier's ratio to standard (median ÷
median, per night type) is stored. Between yearly rounds:

- simple = standard × ratio(simple);
- comfort = standard × ratio(comfort);
- their ranges are widened by the spread seen in the yearly round.

The label says which tiers are derived.

**Statistic:** per tier and night type, the **median** price per night is the central
value, and the **p25–p75** is the range. The mean is recorded for review only, because a
single outlier would move it. Keep every frozen slot, including documented exclusions; do not cherry-pick or substitute. At least four eligible weekday and four eligible weekend stays, independently, are needed. A pooled count can hide an absent weekend; six per type leaves London no room for losses. Compute weekday and weekend medians separately; combine with equal stay-type weight for a mixed baseline. Record contributing counts by type, tax treatments and actual property count. Provisional planning band by sample size, the contributing stays of the thinner type: eight ±25%, seven ±30%, six ±35%, five ±40%, four ±45%. London's six per type is its complete panel; its ±35% reflects the smaller sample, not a degraded eight. These are conservative editorial bands, not calibrated confidence intervals. All inputs require human review; the research packet does not publish a baseline.

**Raw samples are stored**, never only the derived figure, at
`content/costs/room-observations/{city}/{YYYY-MM-DD}.json`, one record per property and
stay. The following is an illustrative schema, not a collected observation:

```json
{
  "method": "room-panel-v8-displayed-rate",
  "observer": "…",
  "conditions": {
    "site": "hotel website",
    "siteCountry": "DE",
    "networkCountry": "XK",
    "currency": "EUR",
    "device": "desktop",
    "loggedOut": true,
    "privateWindow": true,
    "searchedAt": "2026-11-03T10:14:00+01:00"
  },
  "observedAt": "2026-11-03",
  "leadDays": 31,
  "compositionId": "illustrative-not-a-panel",
  "propertyId": "panel-vie-std-03",
  "propertyName": "…",
  "class": "3★",
  "selectionGuestRating": { "value": 8.4, "source": "Booking.com", "checkedDate": "2026-11-02", "note": "Illustrative only; never re-filtered quarterly" },
  "distanceKm": 0.9,
  "checkIn": "2026-12-04",
  "checkOut": "2026-12-06",
  "nightType": "weekend",
  "occupancy": "2A",
  "room": "double",
  "cancellation": "free until 2026-12-02",
  "total": { "amount": 286.0, "currency": "EUR" },
  "lodging_tax_treatment": "stated_included",
  "mandatoryChargeCoverage": "confirmed-inclusive",
  "propertyDependentCharges": [],
  "eligibleForAllowance": true,
  "inclusionEvidence": "Source URL and captured itemization required; illustrative schema only",
  "shifted": null,
  "notes": ""
}
```

A script derives the figures, stamped with the method version. A review diff compares
each panel property with its previous round, so a change in the city figure can be
traced to properties, dates or replacements. Changing the method creates a new version,
and the two versions are never mixed in one figure.

**Source decision, 3 November 2026.** Prices come from the operator’s own publicly bookable channel from round one onwards. Its published price is authoritative and follows the project’s primary-source discipline. This decision resolves the third-party terms question for price collection. Switching channels between rounds would break comparison. The observer manually enters the first public quote and its evidence.

## Accommodation-tax research after the inclusive decision

Use the displayed public two-night room price. Record stated_included, stated_extra or page_silent for lodging tax after checking checkout and published operator terms; all three are usable. Preserve the wording, location, terms URL, timestamp and any exact whole-stay tax amount. Silence is not proof of inclusion or exclusion. Never add tax to the room allowance. An explicitly extra tax is counted once in the trip total. A possible statutory charge appears beside the headline; compare budget with headline plus possible tax. If its amount is unbounded, do not claim a fit. Property-dependent fees and unknown non-tax mandatory charges retain their separate rules.
The former separate tourist-tax row and net-base calculation proposal are superseded.
Use the sourced [tax basis registry](../research/city-costs-2026-11/tax-basis-registry.json)
for legal evidence; the earlier October source-lead table is not production data.

Research now serves four purposes:

- sanity-check whether observed inclusive prices and tax itemizations are plausible;
- identify the three property-dependent cases (Zurich, Manchester, Stuttgart), their
  scope and whether a chosen property actually adds the charge;
- explain what the allowance includes without presenting an estimated tax as an
  observed separate amount;
- support future actual provider-price reconciliation, retaining dated regimes and
  exact basis discriminants rather than guessing a net base.

Property-dependent charges stay outside the city allowance. Show a qualified total
before those extras and a clear notice that the chosen property may add a charge we
cannot predict; do not claim budget fit. Unresolved mandatory charges outside that
explicit exception require an incomplete total. A future exact provider quote must
identify inclusion and avoid duplicate charges. No tax transform is implemented here.

## Staleness: enforced at runtime

Builds are off, so a build gate never fires. Every parameter (anchor basket, tariff,
tourist-tax rule, PLI snapshot, HICP snapshot) carries `asOf` and `reviewAfter`. On every
request the page evaluates them against the server's reference date (`referenceToday`;
pages are dynamic, so nothing is frozen at build). What the page shows changes by
itself:

**Uncertainty grows with age, continuously, not in one step** (decided 2026-10-28). For a
parameter with observation date `asOf` and review interval `I` (`reviewAfter − asOf`),
each side of the range widens by

`widen(age) = 0.15 × age / I`, recomputed on every request.

So a quarterly parameter (I ≈ 90 days):

- halfway to review: +7.5 %;
- at its review date: +15 %;
- 45 days late: +22.5 %;
- after that it is withdrawn.

| State   | Condition                    | What the page shows                                                                                                                                                                                   |
| ------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ageing  | before `reviewAfter`         | Range widened by `widen(age)`; basis note as normal ("set {date}").                                                                                                                                   |
| Overdue | 0–45 days past `reviewAfter` | Still widening; note becomes "Older estimate, set {date}". "Leaves for flights" uses the widened high end.                                                                                            |
| Expired | more than 45 days past       | The component is **withdrawn**: the card shows "Stay not estimated" (today's `stay-unpriced` state), with no "leaves for flights" and no total. It is never replaced silently by a generic allowance. |

The 0.15 slope is also a placeholder. Like the scaled band, it is set from panel data
(how far a property's price moves per quarter beyond what HICP explains) after the first
two rounds.

- **HICP:** a snapshot older than 3 months stops rolling forward. Amounts are frozen at
  the snapshot and the entry moves to Overdue.
- **PLI:** a release older than 15 months moves scaled figures to Overdue.
- **London** has no index to roll forward, so its observed figures carry `reviewAfter` =
  the next scheduled round + 14 days. A missed round makes London Overdue, then Expired,
  like any other parameter.
- **Tax research** past its review date cannot substantiate a new exact-charge calculation or inclusion check. Expiry does not subtract tax from an inclusive allowance or create an extra tax row. The allowance retains its own observation/model freshness rules; unresolved required provider charges still withhold a complete total.
- **Precedents already live:** `activeCostProfile` drops a profile at `reviewAfter` but
  falls back **silently** to the generic allowance; that is what this rule replaces. FX
  shows the opposite behaviour, and it is correct: gateway transfer prices have been
  `unpriced: stale-fx` since the ECB snapshot passed its review date on 2026-10-20, so
  those trips show the transfer as not priced rather than at an old rate.

## Anchor list: seven cities (decided 2026-10-28)

**Prishtina, Tirana, Vienna, Milan, Istanbul, Barcelona, London.**

- **Standard tier every round, the other tiers yearly.**
- **Why these:**
  - Prishtina: mandatory, since it has no price level and can't be scaled.
  - Tirana: the Balkan scaling base (AL 53.3 scales MK 48.3, ME 66.6, RS 65.5, BA).
  - Vienna: the diaspora corridor (AT scales DE, CZ, HU, SK, SI).
  - Milan and Barcelona: the south (IT and ES scale FR south, PT, EL, HR).
  - Istanbul: Türkiye's fast-moving prices.
  - London: a route that matters commercially, observed rather than scaled.

**Hours.** A lookup (one property, one stay) takes about 2.8 minutes, from the
2.25-hour estimate for a full 48-lookup panel.

| Task                                                                                                    | Per city    | 7 cities / year |
| ------------------------------------------------------------------------------------------------------- | ----------- | --------------- |
| Quarterly round, standard only: 8 properties × 2 stays = 16 lookups (~0.75 h) plus food basket (~0.5 h) | ~1.25 h × 4 | **~35 h**       |
| Yearly ratio round: 8 simple + 8 comfort × 2 stays = 32 lookups                                         | ~1.5 h      | **~10.5 h**     |
| **Total observation**                                                                                   | ~6.5 h      | **~45–46 h**    |

- **Correction:** the "about 30 hours" I quoted for 6 cities left out the yearly ratio
  round. The honest 6-city figure is about **39 hours**.
- **London adds about 6.5 hours a year**, for **about 45–46 hours** in total.
- **Separately:** tariff upkeep for covered catalogue cities (transit, transfer, tourist
  tax), about 20 minutes per city per year, plus confirming each tourist-tax change.

**What seven loses compared with the 12-city list:**

- **Zürich and Geneva:** scaled from Vienna by 163.1 ÷ 116.8 = 1.40×, the largest and
  least reliable ratio. Swiss stays are probably the biggest error, and Zürich is a
  home-market origin.
- **Paris:** the capital premium over France's national level is large, so scaling will
  likely run low.
- **Skopje, Berlin, Athens:** scaled from close neighbours with similar levels. The loss
  is probably small, but leave-one-out validation must show it.

What standard-only costs:

- **Tier lag:** simple and comfort follow real changes with up to a year's delay.
- **Wider ranges:** derived-tier ranges are wider, so "leaves for flights" is more
  conservative for those stay levels.

## Reuse terms (checked 2026-10-28)

**Decided (2026-10-28):** proceed under Eurostat's general reuse rule with attribution
and a statement of changes. Written confirmation from Eurostat is not a blocker.
OECD-computed rows (UK, US, Japan) are never used.

From Eurostat's copyright notice (https://ec.europa.eu/eurostat/help/copyright-notice),
under Commission Decision 2011/833/EU:

- **General rule:** reuse of statistical data is authorised, **commercial or
  non-commercial**, provided the source is acknowledged. Changes must be indicated, a
  disclaimer of Eurostat's non-responsibility included, and modifications "stated
  clearly to the end user". Citation format: "Source: Eurostat, [dataset code / DOI],
  [access date]".
- **Exceptions that touch this model:**
  1. Data identified as belonging to sources other than Eurostat: **non-commercial
     only**. The PPP metadata (https://ec.europa.eu/eurostat/cache/metadata/en/prc_ppp_esms.htm)
     says the **UK, US and Japan** figures are "computed by the OECD". We must not use
     them, and the UK is outside coverage anyway.
  2. Data for countries outside the EU, EFTA and the candidate countries: **non-commercial
     only**. Our full-coverage countries are all EU, EFTA or candidates, so this is fine.
     **Kosovo** is published by Eurostat but is neither EFTA nor a candidate country.
     Whether its HICP counts as "Eurostat data" for commercial reuse must be confirmed,
     or we use ASK's own publication under ASK's terms.
- **Per dataset:**
  - **`prc_ppp_ind_1`:** no dataset-specific restriction in its metadata; general rule
    applies. Results are approved by participating countries before release, and below
    analytical-category level they are confidential (we use only published categories).
  - **`prc_hicp_minr`:** no dataset-specific restriction in its metadata (data sharing:
    "None"); general rule applies.
- **What this allows for SEO:** derived figures (our scaled, rolled-forward estimates)
  may be published commercially with attribution, a "modified by Trip Range" statement
  and the non-responsibility disclaimer on every page that shows them. Data or figures
  derived from UK, US or JP rows may not be published.
- **Still open:**
  - whether Eurostat's Kosovo HICP counts as "Eurostat data" for commercial reuse. If
    not, Prishtina is rolled forward from ASK's own publication under ASK's terms;
  - each municipality's tariff pages are cited, never bulk-copied.

## How it changes the card

- Stay and local costs become a **range** ("€340–€460 estimate"). The stay uses the displayed price; show statutory tax separately when extra or possibly extra. Property-dependent extras are excluded and disclosed beside a qualified total; budget fit remains unconfirmed for those cases.
- **"Leaves for flights" uses the high end**, so the room is never overstated, and
  Overdue entries widen it further.
- The basis note names the layer: "observed in Vienna, Nov 2026 (8 hotels)", "scaled
  from Vienna by EU price levels (2025)", or
  "older estimate, set …".

## Validation before shipping

1. **Leave-one-out:** predict each anchor from the next-nearest one through layers 2–3,
   and compare with its observed panel. The error distribution sets the scaled band
   (above). If the 80th-percentile stay error is too wide to be useful (proposal: over
   ±35 %), stay stays anchor-only and seven anchors are not enough.
   The first run with reviewed anchor and eligible neighbour panels also triggers replacement of both room-panel margins. Compare predictions against the same held-out observed rates at full and reduced donor coverage, preserving equal weekday and weekend weights. Derive the coverage-specific widths from the 80th percentile of absolute percentage errors. Record the run date, contributing counts, independent anchors and unsupported coverage levels. Keep the launch item open until the worksheet and result card use the measured widths. [Launch checklist](../launch-checklist.md#launch-blockers)
2. **Panel stability:** the round-to-round change per property should be explained by
   the HICP change and seasonality. If not, the panel or the method is wrong.
3. **Coverage report:** the share of PRN/TIA/SKP results destinations served by an
   anchor, by scaling, and outside coverage (now excluded from results).

## What maintaining it needs

| Item                                                      | Effort                                                               | Cadence                              |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| Room panels and food baskets (7 anchors, standard tier)   | ~45–46 h a year in total (table above)                               | Quarterly, plus a yearly ratio round |
| Transit, transfer, tourist tax (covered catalogue cities) | ~20 min per city                                                     | January, and on change               |
| ~~HICP snapshot~~ (withdrawn 2026-11-04)                  | None                                                                 | None                                 |
| PLI snapshot (`prc_ppp_ind_1`)                            | Automated; review the changed ratios                                 | March, June, December                |
| Copy for basis, range, tourist tax and outside coverage   | Codex                                                                | Once                                 |

People and decisions this needs:

- **an owner for the panels**: the one task that cannot be automated;
- **decided:**
  - seven anchors, standard tier;
  - London observed, no ONS;
  - Eurostat with attribution;
  - 45-day withdrawal with continuous widening;
  - network country Kosovo, version-pinned;
  - Belfast retired, Milan and Brussels transit salvaged;
- **set from data, not decided:** the scaled band (holdout test) and the ageing slope
  (panel data);
- **counsel:** the ASK terms for Kosovo.

## Sources

- Eurostat copyright notice: https://ec.europa.eu/eurostat/help/copyright-notice
- PPP metadata (coverage, OECD-computed rows, release stages): https://ec.europa.eu/eurostat/cache/metadata/en/prc_ppp_esms.htm
- PPP datasets (`prc_ppp_ind` / `prc_ppp_ind_1`): https://ec.europa.eu/eurostat/web/purchasing-power-parities/information-data
- HICP metadata (ECOICOP v2, release timing, Kosovo): https://ec.europa.eu/eurostat/cache/metadata/en/prc_hicp_esms.htm
- Eurostat API (values in this doc): `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_ppp_ind_1` and `…/prc_hicp_minr`, queried 2026-10-28
- World Bank ICP: https://www.worldbank.org/en/programs/icp/data
- Tourist-tax sources are listed in the table.
