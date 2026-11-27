# Proposal: the result card when flights are not priced

Original result-card proposal. Copy resolved 4 November 2026 in
`src/i18n/flight-room.ts`; implementation decisions and numerical examples below
are retained as proposal context, not observed prices.

## Why this is the main card, not an exception

On 27 Oct, 13–14 of 18 result cards (PRN, SKP, ZRH × two December/November windows) had
no fare for the searched dates and showed a single reference fare from other dates.
`historical-fare-range.md` retires that reference figure. The range that replaces it
qualifies rarely: one warm pass gives a median of 3 fares per city route, and 0 of
SKP's city routes meet the minimums. So for Prishtina and Skopje, and for most Tirana
searches, the normal card will have **no flight figure at all**.

Today that card leads with a negative ("Trip total not yet known"), shows one
non-flight estimate, and hides the one useful derived number, the most flights can cost
for the trip to fit (`maxAffordableFlight`), inside collapsed "Price details". The
proposal makes that card a complete answer to the question we _can_ answer: **what does
everything except flights cost, and what does the budget leave for them?**

## What the card shows

```
┌───────────────────────────────────────────────────────────────┐
│ [photo]  Basel · Switzerland                                  │
│          12–15 Dec · 3 nights · 2 people                      │
│                                                               │
│  Your budget                                   €900           │
│  Stay and local costs              ≈ €496  estimate           │
│  Flights                           not priced                 │
│  ─────────────────────────────────────────────────────        │
│  Find return flights under €322                               │
│  for 2 people · up to €161 per person, return                 │
│                                                               │
│  ███████████████████░░░░░░░░░░░░░░░▒▒▒                        │
│  estimated costs (solid)  flight budget (outline)  set aside  │
│                                                               │
│  [ Check flights to Basel on Aviasales → ]                    │
│  Budget limit, not a fare. See prices on Aviasales.           │
│                                                     Details + │
└───────────────────────────────────────────────────────────────┘
```

**Rows, in this order:**

1. **Your budget**: the user's input (`user_input` provenance).
2. **Stay and local costs**: `knownNonFlightCosts`, labelled as an estimate with the
   basis note already shown for planning parameters (stay baseline, transfer allowance).
3. **Flights**: the words "not priced". No figure, no dash, no "from €".

**Below the rows:** a single instruction, "Find return flights under {amount}".
The amount is `maxAffordableFlight(budget, knownNonFlightCosts)`, the party
total, plus the same divided by travellers and **rounded down** to whole currency
units, because Aviasales quotes per passenger and that is the number users compare.
Provenance `derived` (inputs: budget, the estimate, the reserve policy).

**The bar** splits the budget into known costs (solid), the reserve (hatched, small)
and room for flights (outlined, empty). An empty outline is the visual for "not priced";
it is never filled with a colour that reads as a fare.

**Primary action**: the existing Aviasales handoff, promoted from the trip page to the
card, since this is the moment the user needs a price. Click recorded with handoff state
`unpriced`. The deep link carries the searched dates, as today.

## States

| State                           | Condition                                                  | Card                                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Room for flights** (dominant) | flight unpriced, ceiling > 0                               | As above.                                                                                                                                                               |
| **No room**                     | flight unpriced, no positive ceiling (`no-room-in-budget`) | Rows 1–3, then "The estimates, reserve and any possible tax leave no room for flights" in place of row 4; no handoff emphasis; ranked last. Budget €500 for the Basel case is this state.        |
| **Typical range qualifies**     | historical range meets its minimums                        | Row 3 becomes the range with its {n} and period; row 4 adds "likely fits / may not fit" against p75. Same layout, so the dominant card and this one read as one design. |
| **Stay or transfer unpriced**   | `stay-unpriced` / `required-transfer-unpriced`             | The unpriced row says so; no row 4, since a ceiling needs every non-flight cost. Existing copy.                                                                         |
| **Priced**                      | matching fare                                              | Today's complete card, unchanged.                                                                                                                                       |

## Never shown on this card

A trip total; a fit badge ("Comfortable fit", "fits"); "€X left" after flights; any
fare or "from €" figure; a reference fare from other dates; anything implying we
checked or will check prices.

## Ranking

Today unpriced cards only fill the slots priced fits leave (`curate`: `ideas` padded to
three, in departure order). When they are most of the results:

1. Priced fits first, as today.
2. Then cards with a qualifying typical range, by "likely fits" first, then p75.
3. Then the dominant card, ordered by **room for flights per person, highest first**: the
   destinations where the budget leaves the most for flights. This ranks on our own
   estimates and the user's budget, never on an invented fare, and is stated in the
   results header ("Sorted by flight budget limit per person, highest first").
4. No-room cards last, or folded behind "Over budget before flights (n)".

Three cards is too few when none is priced. Proposal: show up to 6 in this state, with
the header count stating how many have a fare (normally 0–1 for PRN and SKP).

**Decided (2026-10-28), revisit once ranges exist:** ranking unpriced trips by room
for flights per person makes the results page **deterministic and cheap-first**. The
same search always gives the same order, and destinations with low estimated stay and
local costs (Ohrid, Thessaloniki) rank above expensive ones (Basel), whatever flights
there cost. It ranks only on our own estimates, so it inherits their error. Once the
non-flight model gives ranges and the historical fare range qualifies for more routes,
ranking should weigh likely flight cost too.

## Results header

Results header: "We have no flight price for these dates. Where enough costs are
known, we show a flight budget limit." The missing flight price stays explicit
without promising a figure for trips whose other costs are also incomplete.

## Trip page parity

The trip page's budget block uses the same four rows and bar, from the same plan
(`sharedResultTemplate` already guarantees the same evidence), so the card and the page
say the same thing.

## Open questions

- Reserve: it is currently invisible on the card. Showing it as a hatched segment
  explains why the flight budget limit is less than budget − costs. The legend
  uses "Set aside"; the note says "Budget limit, not a fare. It accounts for the
  reserve and any higher stay costs or possible tax shown."
- Very large ceilings (budget €5,000): show as-is; it is the user's budget, not a claim.
- Should the per-person figure be hidden when children are in the party (children's
  fares differ)? Proposal: show "for 3 people" only, no per-person split, if children > 0.

## Measurement

Per origin and date window: share of cards in each state, handoff click-through by state
(`unpriced` vs `priced` vs `historical`), and how often the room-for-flights ranking
changes the top card versus today's departure order.
