# Cost-model copy inventory

Copy resolved on 4 November 2026. The engineering-placeholder backlog is closed;
the wording is in the files below. This is a copy change, not a change to the
model, its data or the status of proposed features.

| Where | Wording and distinction retained |
| --- | --- |
| `src/i18n/stay-basis.ts` | Observed hotel count, weekday/weekend counts and sampled stay month; source city and EU price-level year when scaled. "Editorial placeholder" stays explicit. Measured bands retain `n`, identified as cities tested. No observed figure means "We haven’t observed hotel prices for {city} yet." |
| `src/i18n/stay-basis.ts` | Breakfast and non-refundable fallbacks retain their contributing counts. Exactly half is not called "mostly." Budget-fit reasons name higher stay costs, possible tax, or both. |
| `src/components/travel/AccommodationChargeNotice.tsx` | Existing text literals only: known extra counted once; possible extra kept separate and allowed for in the budget check; an unknown upper limit prevents a budget-fit claim. |
| `src/i18n/results.ts` | Unknown mandatory charges mean an incomplete total. Charges that depend on the chosen accommodation remain outside the estimate, with budget fit unconfirmed. |
| `src/i18n/freshness.ts` | "Provider saw this fare {age}" is the provider observation time. "We received this fare {age}. We don’t know how old the price is." separates our receipt time from the unknown fare age. Neither promises a price still available to book. |
| `src/i18n/planning-parameters.ts` | "We chose this amount" identifies a hand-set allowance. Preserve the set date, standard private-room basis and return-transfer scope. |
| `src/i18n/handoff.ts` | "{partner} shows today’s price and availability; Trip Range doesn’t" explains why the traveller leaves. The affiliate disclosure stays beside the link. |
| `src/i18n/recent-fares.ts` | Stored return fares for one traveller, flights only. The 48-hour window describes receipt of records, not the age or availability of their prices. |
| `src/i18n/nearby-fares.ts` | A different departure airport; getting there is excluded and its cost and journey time are unknown. |
| `src/i18n/provenance-labels.ts` | "Stored fare", "Planning estimate", "Your budget", "Calculated", "Demo figure" keep the kinds distinct. |
| `src/i18n/flight-room.ts` | "Find return flights under {amount}" is one continuous instruction below the cost rows, followed by party size. "Budget limit, not a fare" stays visible. The owner authorized this presentation change on 4 November; the amount and budget calculation are unchanged. |
| `src/i18n/origin-resolution.ts` | Existing wording retained: the departure city is unidentified, so no search ran. |
| `src/i18n/en.json`, `src/i18n/sq.json` | "Fare from other dates" replaces the misleading claim that those dates are near the requested ones. All seven user-facing GoEksplo mentions in `sq.json` now use Trip Range. The remaining internal dictionary key is `tripRangeEstimate` in both languages and its component reference; no old-brand text remains in `sq.json`. |
| `docs/specs/historical-fare-range.md` | "Recorded fare range · {n} distinct return fares, {first}–{last}" plus per-traveller, city-route and date limitations. Copy only; the proposed feature remains unbuilt. |
| `docs/specs/partial-data-result-card.md` | Copy examples aligned with `flight-room.ts`; numerical examples remain illustrative proposal context. |

Do not replace "editorial placeholder" with a more confident label. Do not turn a
missing observation, unknown charge or stored fare into an available booking price.
The range labels describe uncertainty; they do not guarantee a price falls within it.
