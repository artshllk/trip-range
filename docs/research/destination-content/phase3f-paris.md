# Paris — Phase 3F evidence

Status: source-backed draft; EN/SQ human review pending. Initial Phase 3F research inspected 2026-10-12T16:14:20Z. Paris-only Phase 3G.1 recheck completed 2026-10-12T20:29:27Z; current content version 2, six sources. No editorial decision or publication approval.

## Identity

`paris` → `Q90`, FR, city; coordinates 48.8566666667, 2.3522222222. The French capital and city entity is corroborated by Paris je t’aime; the existing product ID is retained, distinct from the wider region.

## Sources

- [Paris (Q90)](https://www.wikidata.org/wiki/Q90) — Wikidata.
- [Paris essentials](https://parisjetaime.com/eng/article/the-essentials-a264) — Paris je t’aime — Tourist Office.
- [Access to the Eiffel Tower](https://www.toureiffel.paris/en/access-map) — Société d’Exploitation de la Tour Eiffel.
- [Visit the Louvre](https://www.louvre.fr/en/visit) — Musée du Louvre.
- [The Musée du Louvre at a glance](https://presse.louvre.fr/le-musee-du-louvre-en-bref-1063000220316/?lang=en) — Musée du Louvre; added in Phase 3G.1.
- [Access and Transportation — Notre-Dame de Paris](https://www.notredamedeparis.fr/en/visit/practical-information/access/) — Notre-Dame de Paris; added in Phase 3G.1. Official indexed text inspected; direct fetch returned 403 (see limitations below).

## Selection and ordering

Eiffel Tower, Louvre, Notre-Dame and Montmartre provide distinct landmark, art, religious and neighbourhood choices. Montmartre is a separate area, not a claimed adjacent stop. Tower access and museum planning come from the operators.

Attractions, areas, transport and notes retain the deliberate order in the draft. Attraction relationships are supported by the named official destination/site pages; no guessed external attraction IDs or coordinates were added.

## Omissions and review

No cross-city day sequence: the selected places are dispersed. Airport codes were not added. EN/SQ wording and proper names need human review. No prices, opening hours, visit durations, live availability, media selections or travel eligibility claims were imported. Operational guidance has a periodic review date; stable descriptions are not promises of access.

## Phase 3G.1 source correspondence and cleanup

The original Phase 3F research-action ledger is historical and unchanged. The [separate Paris recheck ledger](../../../content/operations/phase3g1-paris-research-actions.json) records this revision's manual actions, including unsuccessful retrievals. Source `retrievedAt` values record this inspection, not a claim that the source was updated or any attraction is currently accessible. The canonical place identity is unchanged; Wikidata was used only to recheck Paris/Q90, not attraction descriptions.

| Item / claim | Current evidence | Decision in this draft |
| --- | --- | --- |
| Overview, Montmartre highlight, attraction and area | Paris tourism's **The essentials** identifies riverfront landmarks, art and the Montmartre hill/view. Its separate journey to Montmartre supports treating the area separately; the tradeoff is editorial planning advice, not a timed route. | Retain concise coverage and order; smooth SQ hill/area wording. No itinerary imported. |
| Eiffel Tower location | Official **Access to the Eiffel Tower**, “How to get to the Eiffel Tower”, places it on the Champ de Mars in the seventh arrondissement. | Retain location; remove the unnecessary material claim. SQ name is **Kulla Eiffel**. |
| Eiffel transport | The same operator page lists Métro and RER approaches and walking routes, alongside changing service notices. | Keep generic station/walking-route advice, without copying line closures, durations or promising service. Use **Kullën Eiffel** / **Kullës Eiffel** naturally in SQ. |
| Louvre art highlight and former royal palace | Official **The Musée du Louvre at a glance**, July 2026, describes the former royal residence and its conversion to an arts museum. | Associate both items with `source:worldwide:paris:louvre-history`; retain short EN description and smooth SQ wording. The visit page is no longer the palace citation. |
| Louvre booking note | Official **Visit**, “Ticket prices” and FAQ, recommends time-slot bookings. | Use the requested concise EN/SQ recommendation; cite `source:worldwide:paris:louvre`. Keep `periodically-reviewed`, with the existing 2027-01-10 review deadline (about 90 days). No hours, fees or availability imported. |
| Notre-Dame cathedral and location | Official **Access and Transportation**, “Address and access” and “Access and transportation”, identifies the cathedral and Île de la Cité in central Paris. | Cite `source:worldwide:paris:notre-dame` directly. Limit EN/SQ description to that stable location; omit the extra Seine clause and all access guidance. |

### Retrieval limitation

The Notre-Dame history open returned an internal retrieval error; the access-page open returned HTTP 403. A narrow search restricted to the official domain returned the access page's substantive indexed text, including both the cathedral identification and Île de la Cité location (tool reported a crawl two days earlier). This is official-source evidence, **not a successful fresh direct fetch**. No bypass or repeated direct retry was attempted. The reviewer should open the official source during the source check; this limitation remains in Paris's unacknowledged operator finding. No third-party travel source was used. Louvre, Eiffel, Paris tourism and Wikidata pages were directly readable through the research tool.

### Pending human decision

Four attractions, one Montmartre area, two highlights, one transport guide and one practical note remain. `dayTemplates` remains empty. No attraction, image, airport mapping, detailed history, ticket price, hours, duration or access guarantee was added. Champ de Mars, Métro, RER, Musée du Louvre, Notre-Dame de Paris and Montmartre keep their names. Root and every item remain draft with `reviewedAt: null`; all six checks (identity, sources, English, Albanian, selection/order, freshness) need explicit human decisions. The revised advisory is not a resolution or approval.
