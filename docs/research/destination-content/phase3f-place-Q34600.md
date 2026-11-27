# Kyoto — Phase 3F evidence

Status: source-backed draft; EN/SQ human review pending. Research inspected 2026-10-12T16:14:20Z.

## Identity

`place:Q34600` → `Q34600`, JP, city; coordinates 35.0116111111, 135.7681111111. Q34600 is Kyoto city in Kyoto Prefecture, not the prefecture. The official city tourism guide locates the selected places in eastern Kyoto.

## Sources

- [Kyoto (Q34600)](https://www.wikidata.org/wiki/Q34600) — Wikidata.
- [Gion and Kiyomizu](https://kyoto.travel/en/areas/gion-kiyomizu/) — Kyoto City Tourism Association.
- [Learn about Kiyomizu-dera](https://www.kiyomizudera.or.jp/en/learn/) — Kiyomizu-dera Temple.
- [Getting around Kyoto](https://kyoto.travel/en/getting-around/) — Kyoto City Tourism Association.
- [Kyoto itineraries](https://kyoto.travel/en/itineraries) — Kyoto City Tourism Association.

## Selection and ordering

The shortlist stays in the Gion/Kiyomizu area. Kiyomizu-dera leads; Yasaka, Hokan-ji and Maruyama follow. The two-stop sequence is supported by the official eastern-area itinerary, without durations.

Attractions, areas, transport and notes retain the deliberate order in the draft. Attraction relationships are supported by the named official destination/site pages; no guessed external attraction IDs or coordinates were added.

## Omissions and review

Western and northern temples omitted to avoid implying an all-city short sequence. No attraction external IDs guessed. EN/SQ wording and proper names need human review. No prices, opening hours, visit durations, live availability, media selections or travel eligibility claims were imported. Operational guidance has a periodic review date; stable descriptions are not promises of access.

## Phase 3G.3 recheck — 2026-10-13T12:21:53Z

The sections above retain the original Phase 3F record. This separate operator recheck prepares version 2 for human review; it is not an approval. The original Phase 3F research ledger and Kyoto place identity remain unchanged. Tool-level research actions, including the failed direct fetch, are recorded in `content/operations/phase3g3-kyoto-research-actions.json`.

### Source correspondence

| Retained claim | Current evidence and decision |
| --- | --- |
| Kyoto city identity | [Wikidata Q34600](https://www.wikidata.org/wiki/Q34600) identifies the city in Kyoto Prefecture. Retain `place:Q34600`; identity only, no attraction IDs inferred. |
| Kiyomizu-dera | [Official temple guide](https://www.kiyomizudera.or.jp/en/learn/) identifies its Buddhist tradition, main hall on the hillside and projecting wooden stage. Keep this short description; no dimensions, access, timing or seasonal claims. |
| Yasaka-jinja and Gion | [Kyoto's Gion/Kiyomizu guide](https://kyoto.travel/en/areas/gion-kiyomizu/) locates Gion's development near the shrine gate. Copy now specifies that relationship. [JNTO](https://www.japan.travel/en/spot/78/) explicitly identifies Yasaka-jinja as a Shinto shrine; add that source for the EN/SQ religious terminology. |
| Hokan-ji / Yasaka Pagoda | [Specific official tourism entry](https://kyoto.travel/en/destinations/hokanji-templeyasaka-pagoda/) supports both names and its position between Kiyomizu-dera and Yasaka-jinja. Associate the attraction with this more direct citation. No new access claims. |
| Maruyama Park | The Gion/Kiyomizu area guide directly lists the park in eastern Kyoto. Retain a simple location description without seasonal claims. |
| Combined area | The same area guide supports temples and historic streets; use “area”, not an administrative district. Good-for/tradeoff text is a modest editorial planning suggestion, not a transport duration or walking guarantee. |
| Transport | [Current city visitor guidance](https://kyoto.travel/en/getting-around/) recommends trains and buses and offers destination-specific guidance for Kiyomizu-dera and Yasaka-jinja. Attribute the recommendation and direct users to those routes; do not imply every journey needs both modes. |
| Photography/access | [Southern Gionmachi's message on the official tourism site](https://kyoto.travel/en/responsible-travel/gion-manner-message-from-southern-gionmachi/) distinguishes photography restrictions and entry into restricted/private property. Replace vague “private streets” with permission-based property/access guidance explicitly limited to southern Gion. The page's displayed publication date is January 9, 2024; today's retrieval does not imply a new rule or recent page update. |
| Two-stop sequence | Replace the generic itinerary index with [Higashiyama at Dawn](https://kyoto.travel/en/itineraries/higashiyama-at-dawn/), whose sequence starts at Kiyomizu-dera and reaches Yasaka-jinja through the eastern streets. Retain just those two stops and the existing 2/3-night editorial fit. This is a partial shortlist, not the source's complete itinerary or a full-day promise. Remove generic “check access” filler. Do not import morning timing, intermediate businesses, durations or access promises. |

### Language, freshness and limitations

EN and SQ distinguish a Buddhist temple from a Shinto shrine. SQ uses natural city/area references, “Gion dhe Kiyomizu”, “Parku Maruyama” and “Hokan-ji (Pagoda Yasaka)”; Japanese proper names are retained. All Kyoto bilingual fields were inspected; human language and selection review is still pending.

Sources increase from 5 to 8: three specific official sources added, the itinerary URL replaced, retained sources rechecked. The retrieval timestamp records this inspection, not live availability. The existing periodic `reviewBy` date remains **2027-01-10T00:00:00Z** for the area, transport, practical note and sequence; it was not extended. Stable facts remain stable.

The direct English Yasaka-jinja site returned HTTP 503. There was no bypass/repeated direct retry. A focused site query returned indexed text, but the revision does not rely on it: city tourism supports the Gion relationship, and directly retrieved JNTO text supports Shinto terminology. Nonofficial search results were ignored. This limitation remains visible in the operator finding.

No factual/source blocker found. One evidence-review advisory remains for human judgement: eastern-only scope, proper names/EN/SQ/source correspondence, the alternate official shrine evidence and periodic guidance. Six checks and the overall decision remain pending; no advisory acknowledgement, review decision file or publication receipt is created. Kyoto stays draft and unavailable from the normal runtime store.
