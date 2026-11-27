# Crete — Phase 3C evidence

**DRAFT — NOT PUBLISHED. All English and Albanian text awaits user review.**

Identity: `crete`, GR, **island**, Wikidata Q34374; 35°18′35″N 24°53′36″E. HER and CHQ are airport aliases, with **no cityCode** on the island. The HCAA commercial-airports table corroborates both airport codes and their Crete relationship. The GNTO website happens to use `/mainland/Crete` in its URL; its content identifies Crete as an island. URL naming is not entity classification.

The editorial shortlist considered **8 candidates**, selecting **5**: Knossos, Heraklion Archaeological Museum, Koules Fortress, Chania Old Venetian Harbour and Fortezza of Rethymno. Phaistos was deferred to keep the initial set small. Samaria was omitted because access/conditions require separate current review. Spinalonga is a separate offshore island and was not treated as an attraction physically on the main island.

Relationship checks: Hellenic Heritage places Knossos near Heraklion; the museum’s own exhibition page identifies its Cretan collections and Heraklion location. GNTO Heraklion/Chania/Rethymno pages identify the fortress/harbour locations in those towns on Crete. No arbitrary radius was used to admit an attraction. Heraklion and Chania are useful **town bases** in the existing generic area model; neither pretends to be a city neighbourhood or an equivalent airport transfer.

The current day-template model selects by number of nights only. It has no base/region suitability predicate, arrival airport or journey-distance model. **No Crete day template is supplied**, because a Heraklion cluster cannot safely stand for a short stay based near Chania. The current Wikidata research adapter handles P131/P276 relationships but not physical-feature P706 relationships: automatic island research coverage can be incomplete. Official-source manual relationship verification was sufficient for this small draft; no resolver/schema changes or destination-specific branch were needed.

Human review: confirm town-base framing, geographic distribution and airport wording; approve EN/SQ transliteration and selection. Decide separately whether a generic region/base-aware template model is warranted in a later phase. No island-wide itinerary, transfer duration, schedule, fare, admission price or opening guarantee is asserted.

Research accounting: **7 search queries + 3 open attempts = 10 requested web actions**, in 6 tool calls. The last airport-identity query was completed October 12; other evidence was consulted October 10. One indexed Wikidata query, **0** direct Wikidata API/SPARQL requests. No throttling or Retry-After response was observed. Upstream HTTP counts are not observable.

## Evidence map

The JSON and offline review HTML contain the complete source references for every item. These links are references only; production never fetches them. Summaries are original editorial wording, not copied source paragraphs.

| Item | Evidence source IDs | Freshness |
| --- | --- | --- |
| overview | source:pilot:crete:island, source:pilot:crete:heraklion, source:pilot:crete:chania | stable |
| highlight:crete:minoans | source:pilot:crete:heraklion, source:pilot:crete:museum | stable |
| highlight:crete:harbours | source:pilot:crete:chania, source:pilot:crete:rethymno | stable |
| highlight:crete:towns | source:pilot:crete:island | stable |
| attraction:crete:knossos | source:pilot:crete:knossos, source:pilot:crete:heraklion | stable |
| attraction:crete:archaeological-museum | source:pilot:crete:museum | stable |
| attraction:crete:koules | source:pilot:crete:heraklion | stable |
| attraction:crete:chania-harbour | source:pilot:crete:chania | stable |
| attraction:crete:fortezza | source:pilot:crete:rethymno | stable |
| area:crete:heraklion | source:pilot:crete:heraklion, source:pilot:crete:museum | periodically-reviewed |
| area:crete:chania | source:pilot:crete:chania, source:pilot:crete:heraklion | periodically-reviewed |
| transport:crete:airport-and-base | source:pilot:crete:airports, source:pilot:crete:airport-bus, source:pilot:crete:island | periodically-reviewed |
| note:crete:site-information | source:pilot:crete:knossos, source:pilot:crete:museum | periodically-reviewed |

## Sources

- `source:pilot:crete:identity` — [Crete (Q34374)](https://www.wikidata.org/wiki/Q34374); Wikidata; consulted 2026-10-10.
- `source:pilot:crete:island` — [Crete](https://www.visitgreece.gr/en/mainland/Crete); Greek National Tourism Organisation; consulted 2026-10-10.
- `source:pilot:crete:heraklion` — [Heraklion](https://www.visitgreece.gr/en/mainland/Crete/irakleio); Greek National Tourism Organisation; consulted 2026-10-10.
- `source:pilot:crete:chania` — [Chania](https://www.visitgreece.gr/en/mainland/Crete/chania); Greek National Tourism Organisation; consulted 2026-10-10.
- `source:pilot:crete:rethymno` — [Rethymno](https://www.visitgreece.gr/en/mainland/Crete/rethymno); Greek National Tourism Organisation; consulted 2026-10-10.
- `source:pilot:crete:knossos` — [Knossos — archaeological site](https://www.hh.gr/en/destinations/knossos/); Hellenic Heritage; consulted 2026-10-10.
- `source:pilot:crete:museum` — [Exhibition — Heraklion Archaeological Museum](https://heraklionmuseum.gr/en/exhibition/); Heraklion Archaeological Museum; consulted 2026-10-10.
- `source:pilot:crete:airport-bus` — [By Public Bus — Chania Airport](https://www.chq-airport.gr/en/category-detailed/ctg_id-69/nd_id-450); Fraport Greece; consulted 2026-10-10.
- `source:pilot:crete:airports` — [Greece aviation action plan — commercial airports table](https://hcaa.gov.gr/sites/default/files/documents/2024-greeceactionplan.pdf); Hellenic Civil Aviation Authority; consulted 2026-10-12.

## Review and freshness limits

Stable classifications cover identity, broad descriptions and geography, not an assertion of current access. Area advice, templates, transport and visit checks are periodic, due by January 10, 2027. There are no volatile observations. The current schema stores instants; midnight values represent day-granularity research/resolution records, not a measured time of day. Consultation dates can refer to search-indexed source text; they do not assert that the original server was fetched at that instant. Human approval and ongoing editorial ownership remain outstanding.
