# Barcelona — Phase 3C evidence

**DRAFT — NOT PUBLISHED. All English and Albanian text awaits user review.**

Identity: `city:BCN`, ES, city, Wikidata Q1492; 41°22′57″N 2°10′37″E. BCN is the existing product city/airport alias. Sagrada Família also has a confirmed external identity, Q48435. Other attraction entity IDs were omitted when not confidently established.

The editorial shortlist considered **8 candidates**, selecting **5**: Sagrada Família, Park Güell, Casa Batlló, Museu Picasso and Museu Nacional d’Art de Catalunya. Sant Pau, Palau Güell and Casa Vicens were left out to keep a short visit focused. This is a bounded editorial shortlist, not an exhaustive entity count or popularity ranking.

Relationship checks: official attraction/institution pages identify Barcelona; official tourism district pages establish the Eixample, Gràcia and historic-core context. The selected museums are distinct institutions, and the two area records are not repeated as attraction entities. Architecture/art template stops reference only selected IDs; its order is an editorial shortlist across the stay, not a verified walking route.

Source access limitations: one direct Wikidata page read timed out; the identity and coordinate evidence came from indexed Wikidata results. Direct Park Güell subpage and Casa Batlló page reads were unavailable. The official park homepage and tourism heritage evidence supplied the limited retained facts. A direct Picasso collection read returned 502; the indexed official collection page supplied the basic collection description. No retry burst followed. Temporary visit notices were not converted into lasting opening/closure claims.

Human review: verify the Picasso collection source directly before approval; check the architecture selection, both area tradeoffs and the loose template; review all EN/SQ copy and proper-name inflections. No visit durations, ticket prices, exact opening hours, entry guarantees or attraction photos are supplied.

Research accounting: **11 search queries + 7 open attempts + 1 find action = 19 requested web actions**, in 7 tool calls, all for this destination before moving to Crete. Four queries targeted Wikidata identity/entity evidence and one direct Wikidata webpage open failed. Application Wikidata API/SPARQL requests: **0**. Upstream search-service HTTP requests are not observable and are not claimed as a measured total.

## Evidence map

The JSON and offline review HTML contain the complete source references for every item. These links are references only; production never fetches them. Summaries are original editorial wording, not copied source paragraphs.

| Item | Evidence source IDs | Freshness |
| --- | --- | --- |
| overview | source:pilot:bcn:eixample, source:pilot:bcn:gothic, source:pilot:bcn:mnac | stable |
| highlight:city:BCN:old-centre | source:pilot:bcn:gothic | stable |
| highlight:city:BCN:architecture | source:pilot:bcn:eixample | stable |
| highlight:city:BCN:art | source:pilot:bcn:mnac, source:pilot:bcn:picasso | stable |
| attraction:city:BCN:sagrada-familia | source:pilot:bcn:sagrada, source:pilot:bcn:sagrada-identity | stable |
| attraction:city:BCN:park-guell | source:pilot:bcn:park, source:pilot:bcn:heritage | stable |
| attraction:city:BCN:casa-batllo | source:pilot:bcn:heritage, source:pilot:bcn:eixample | stable |
| attraction:city:BCN:museu-picasso | source:pilot:bcn:picasso | stable |
| attraction:city:BCN:museu-nacional | source:pilot:bcn:mnac | stable |
| area:city:BCN:eixample | source:pilot:bcn:eixample | periodically-reviewed |
| area:city:BCN:gothic-quarter | source:pilot:bcn:gothic | periodically-reviewed |
| transport:city:BCN:airport | source:pilot:bcn:airport, source:pilot:bcn:metro | periodically-reviewed |
| note:city:BCN:official-visit-check | source:pilot:bcn:sagrada, source:pilot:bcn:park | periodically-reviewed |
| day:city:BCN:architecture-and-art | source:pilot:bcn:eixample, source:pilot:bcn:sagrada, source:pilot:bcn:heritage, source:pilot:bcn:picasso | periodically-reviewed |

## Sources

- `source:pilot:bcn:identity` — [Barcelona (Q1492)](https://www.wikidata.org/wiki/Q1492); Wikidata; consulted 2026-10-10.
- `source:pilot:bcn:sagrada` — [Sagrada Família — official visitor website](https://sagradafamilia.org/en/); Fundació Junta Constructora del Temple Expiatori de la Sagrada Família; consulted 2026-10-10.
- `source:pilot:bcn:sagrada-identity` — [Basilica and Expiatory Church of the Holy Family (Q48435)](https://www.wikidata.org/wiki/Q48435); Wikidata; consulted 2026-10-10.
- `source:pilot:bcn:park` — [Park Güell — official website](https://parkguell.barcelona/en); Barcelona de Serveis Municipals; consulted 2026-10-10.
- `source:pilot:bcn:heritage` — [World Heritage Special](https://bid.barcelonaturisme.com/wv3/en/prods/9/especial-patrimoni-de-la-humanitat.html); Turisme de Barcelona; consulted 2026-10-10.
- `source:pilot:bcn:picasso` — [Collection — Museu Picasso de Barcelona](https://museupicassobcn.cat/en/collection/artworks); Museu Picasso de Barcelona; consulted 2026-10-10.
- `source:pilot:bcn:mnac` — [The museum — Museu Nacional d’Art de Catalunya](https://www.museunacional.cat/en/museum); Museu Nacional d’Art de Catalunya; consulted 2026-10-10.
- `source:pilot:bcn:eixample` — [Eixample](https://bid.barcelonaturisme.com/wv3/en/page/19/eixample.html); Turisme de Barcelona; consulted 2026-10-10.
- `source:pilot:bcn:gothic` — [Gothic Quarter](https://bid.barcelonaturisme.com/wv3/en/page/1052/gothic-quarter.html); Turisme de Barcelona; consulted 2026-10-10.
- `source:pilot:bcn:airport` — [Josep Tarradellas Barcelona-El Prat Airport](https://www.aena.es/en/josep-tarradellas-barcelona-el-prat.html); Aena; consulted 2026-10-10.
- `source:pilot:bcn:metro` — [From the airport by metro](https://static-web.tmb.cat/en/visit-barcelona/public-transport/metro-airport); Transports Metropolitans de Barcelona; consulted 2026-10-10.

## Review and freshness limits

Stable classifications cover identity, broad descriptions and geography, not an assertion of current access. Area advice, templates, transport and visit checks are periodic, due by January 10, 2027. There are no volatile observations. The current schema stores instants; midnight values represent day-granularity research/resolution records, not a measured time of day. Consultation dates can refer to search-indexed source text; they do not assert that the original server was fetched at that instant. Human approval and ongoing editorial ownership remain outstanding.
