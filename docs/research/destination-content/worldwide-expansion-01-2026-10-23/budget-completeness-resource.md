# Before you book: is your short-trip budget complete?

**Original resource draft — internal editorial review only. No public route, calculator, download service or analytics has been implemented.**

A flight price is one part of a trip. Before deciding that a destination fits your budget, check what remains outside that price—and whether each amount covers your whole party and the right dates.

## A worksheet for your actual trip

Write down your dates, currency, adults and children first. For each row, record the amount, who it covers, what is excluded, the source and when you checked it. Mark an unconfirmed amount **unknown**, not zero.

| Item | What to check | Evidence to keep |
|---|---|---|
| Flights | Correct airports, outbound/return dates, party and baggage; a reference fare is not a current booking offer | Provider search or quote, fare dates, currency and genuine observation information if supplied |
| Accommodation | All nights, occupancy and room count; taxes, mandatory fees, meals and cancellation terms | Exact property/stay quotation; a district recommendation is not room availability |
| Airport and required ground legs | Both directions, every traveller, and any separate gateway-city connection | The airport/operator route and your actual fare or quote |
| Local travel | Journeys you intend to make; ticket validity, airport exclusions and whether a cap is conditional | Official ticket terms and the assumed travel pattern |
| Food | Your intended meals for everyone; say what you are assuming | Dated menu examples or your chosen allowance, labelled as an assumption |
| Activities | Only the interiors, tours or performances you choose; child rules and separate sections | Official ticket products and your intended visits |
| Reserve | Extra room for changes, separate from expected spending | A stated reserve rule; it cannot replace an unknown required cost |

Do not count a separate airport fare twice if your chosen ticket genuinely includes it. Equally, do not assume that a city ticket includes the airport simply because both journeys use public transport.

## Three airport checks that can change the answer

- **Barcelona:** airport metro gates accept particular products; some ordinary tickets are excluded. Check the [TMB airport-ticket rules](https://www.tmb.cat/en/visit-barcelona/public-transport/metro-airport) against the ticket you intend to buy.
- **Sydney:** the SYD airport-station access fee is additional to the train fare and outside ordinary daily/weekly travel caps. Use [Transport for NSW's airport guidance](https://transportnsw.info/travel-info/using-public-transport/getting-to-airport). These instructions do not describe WSI.
- **Kyoto:** KIX and ITM are gateways outside Kyoto. The journey into the city is a separate planning item, not a flight arriving at a Kyoto airport. Compare the [official Kyoto arrival options](https://kyoto.travel/en/getting-to).

These are product/route distinctions, not quoted fares or claims that services will operate on your date. Recheck the linked operator information.

## What could remain for flights?

Only use this calculation once you have accounted for all required non-flight costs. Keep estimates labelled as estimates. If a required amount is unknown, the calculation cannot establish that the trip fits.

Let **B** be the whole-party trip budget, **K** the accounted non-flight spending and **F** the total party airfare. GoEksplo's current reserve rule is the larger of the currency-specific minimum and 10% of planned spending, rounded up to the smallest currency unit:

`reserve = max(minimum reserve, ceil((K + F) / 10))`

The flight spending ceiling is:

`F = min(B − minimum reserve, floor(10 × B / 11)) − K`

Calculate in integer minor units and in one supported currency. A nonpositive result leaves no positive flight ceiling. A positive result is **budget headroom, not an offered fare or confirmation of affordability**.

**Fictional arithmetic example, not city-price evidence:** a €600 budget and €240 of fully accounted non-flight spending leave at most €305.45 for all flights under the current €20 minimum/10% reserve policy. Planned spending would be €545.45 and the rounded reserve €54.55. These invented inputs demonstrate arithmetic only; they are not suggested hotel, food or destination allowances. Replace them with your own evidence. If the €240 omitted a required transfer, this would not be a complete budget.

A whole-trip estimate still needs the provider's current prices and terms before purchase. Missing prices are a reason to check, not evidence that flights, rooms or transfers are unavailable.

## Editorial method and publication proposal

- Source implementation: [budget and inverse-ceiling logic](https://github.com/artshllk/goeksplo/blob/71ed6609f2c61676392f73c005c6206df7b9aa67/src/domain/budget.ts), [currency-specific minimum reserves](https://github.com/artshllk/goeksplo/blob/71ed6609f2c61676392f73c005c6206df7b9aa67/src/domain/money/planning-rates.ts). Source links identify the internal review basis; public copy should explain the policy without requiring private-repository access.
- Proposed search intent: “total trip budget checklist”, “what does a trip budget include”, “flight budget after hotel and transfers”. These are hypotheses, not measured search volumes.
- Proposed future path: `/en/resources/check-your-trip-budget`; title: **Is your trip budget complete? A short-stay checklist**. No route or indexing change is authorized here.
- Original value: a reusable completeness worksheet, explicit evidence fields and three documented airport pitfalls, tied to GoEksplo's actual reserve policy. It does not compare destinations using invented average costs.
- Potential citation use: student-travel resources, independent trip-planning guides and airport-arrival explainers could refer to the checklist to explain excluded costs. No backlink, ranking or endorsement is claimed. No outreach is sent or approved.
- Maintenance estimate: 1–2 hours per quarterly review, plus a review whenever the reserve policy changes. Recheck operator examples before first publication and after a known rule change. Remove a stale example if it cannot be confirmed.
- Success measures after an approved public release: relevant Search Console impressions/clicks, independent referring domains, and resource-to-planner use/completed searches if compliant measurement is separately available. Establish a baseline first; no new tracking is installed.
- Required owner approval: exact copy, arithmetic explanation, evidence limitations, title/path and publication scope. Public publication remains separate from this draft preparation.
