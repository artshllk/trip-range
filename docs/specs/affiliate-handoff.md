# Affiliate handoff — shipped behaviour

For the design agent: the behaviour a canvas board for the handoff must match.
Copy shown here is placeholder (owned by Codex, `src/i18n/handoff.ts`).

## Where it appears

- **Trip page** (`#flight-handoff` section, primary CTA) and **result cards** (secondary text button).
- Only for flight trips with a valid route (IATA origin/destination, 1–14 nights, ≤ 9 travellers). Otherwise the trip page says the route is unsupported and no button renders.

## Before the click (always visible, no interaction needed)

Order, top to bottom, directly above the button:

1. **Leaving line** (trip page only): the traveller continues on Aviasales *in this tab*; Aviasales shows today’s price and availability, Trip Range does not.
2. **Affiliate disclosure** (both placements): affiliate relationship via Travelpayouts, commission possible, price unchanged, plus a link to `/affiliate-disclosure`. Body text size and full ink colour — not small grey, not behind a toggle, not footer-only. Standard applied: FTC “clear and conspicuous” (stricter than Travelpayouts’ own published rules, which specify no on-page wording).
3. **Button**: “Check flights on Aviasales →” when a matching cached fare exists, “Check current flights on Aviasales →” when none does.

## Click

- Button switches to its pending label and disables (no double submit).
- Server creates the partner link (Travelpayouts link API, marker validated against configuration).
- **Same tab** (`location.assign`). Reasons: the link is created by an async request, so a new tab opened afterwards is popup-blocked by browsers; and Back returns to the trip URL, which encodes the whole search, so the traveller lands on their trip/results, not a blank search.

## Failure states

| Situation | What the traveller sees | What happens behind |
|---|---|---|
| Partner link API fails / times out (7 s) | Button becomes “Retry flight search”; status line says the link is unavailable | `warn` log with reason |
| Marker missing or malformed, or affiliate not configured | Same as above | `error` log (`affiliateReason: configuration`/`malformed`). Never falls back to an unattributed partner URL |
| Route unsupported by partner | “Route unsupported” line, button removed | `warn` log |
| Popup blocked | Not applicable: same-tab navigation | — |
| Traveller returns with Back (bfcache) | Button is reset to its normal state (no stuck “Preparing…”) | Only the button state is restored |

## Measurement on Netlify

The page sends a view when it offers a flight button. The link endpoint counts each accepted click according to whether it produced a link. Each increment uses the database’s UTC day, the two airports, the outcome and the fare-age band. The button holds its view’s age band in page memory for the click. Partner link creation still takes the itinerary and placement for referral attribution. Placement, travel dates and passenger counts are absent from the counters.

Fare age uses the provider’s observation time if available, otherwise the time we last checked. Fresh is under 12 hours, ageing is 12 to 72 hours inclusive, and old is over 72 hours. Unknown covers the absence of a usable timestamp or fare. Pressing Back restores the button without recording a return. Failures can generate operational diagnostics with a reason. Clicks do not establish a booking or revenue.

Keep exact counters internal. Before external sharing, pool counts below five across adjacent dates or age bands, or suppress them and any totals that would reveal them. Affiliate counters are outside the public fare releases.
