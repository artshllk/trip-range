# Eight destination-content reviews — 4 November 2026

Source review complete. Publication pending exact-revision owner approval. These candidate files are not imported by the application.

**Owner response, 4 November:** keep the revisions as drafts while reviewing the [eight-row claim and source comparison](claim-review-table.md). No approval has been recorded.

All 14 requested official source URLs were opened. Park Güell’s official FAQ supplies the added booking detail, and the Picasso canonical route was cross-checked. No item remains unverifiable. Every factual sentence below maps to dated sources in [source-checks.json](source-checks.json). Editorial suggestions are identified by their advice wording.

The two restaurant-basket totals were removed for clarity, not because the arithmetic failed. Both remain reproducible in the archived evidence. No price, popularity, rating, availability or automated price-checking promise is introduced.

The eight proposed review deadlines are **18 November 2026, 00:00 UTC**. Other item deadlines, facts, identity, selection and order remain unchanged. Full candidate records are all-draft and carry no publication receipt.

## Exact changes

### Vienna — note:phase4b:vienna:examples:1

Café Prückel lists breakfast dishes and coffee separately; include drinks when budgeting a meal. For Belvedere, choose Upper or Lower Belvedere before buying admission.

[Candidate record](vienna.json) · [Full review](vienna-review.html)

Sources checked **4 November 2026**:
- [Café Prückel](https://www.prueckel.at/wp-content/uploads/2026/05/Prueckel_Karte_105x260_2026_online_DE.pdf) — PDF page 2 breakfast and coffee; page 3 toast and goulash; page 4 soda.
- [Belvedere](https://www.belvedere.at/en/visit) — Venues of the Belvedere; opening hours and entry.

### London — note:phase4b:london:examples:1

Dishoom Covent Garden has separate breakfast and all-day menus. Its service charge is optional and can be removed on request. Budget for your chosen dishes and drinks, not a citywide daily allowance.

[Candidate record](london.json) · [Full review](london-review.html)

Sources checked **4 November 2026**:
- [Dishoom](https://www.dishoom.com/menu/breakfast-covent-garden/) — Breakfast heading and service-charge paragraph.
- [Dishoom](https://www.dishoom.com/menu/covent-garden-all-day/) — All Day heading and service-charge paragraph.
- [Dishoom](https://cdn.sanity.io/files/daku84np/production/ddd9a3df5c185e38227ec34cfd3b0e606ece0ef5.pdf) — PDF page 2, service paragraph, porridge and house chai.
- [Dishoom](https://cdn.sanity.io/files/daku84np/production/828436b12fba73190f349fb540d46f4c0a6c21bc.pdf) — PDF pages 1–2, paneer roomali roll, chole puri halwa, fresh nimbu soda and service paragraph.

### London — note:phase4b:london:examples:2

Westminster Abbey recommends booking sightseeing tickets ahead. Sundays are for services, so choose another day for sightseeing and check the Abbey’s calendar before planning your visit.

[Candidate record](london.json) · [Full review](london-review.html)

Sources checked **4 November 2026**:
- [Westminster Abbey](https://www.westminster-abbey.org/visit-us) — Ticket information; opening times; admission information.

### Paris — note:phase4b:paris:examples:1

Bouillon Chartier’s sample menu is indicative and changes daily with deliveries. Use it to understand the dishes, not to set a daily Paris food budget.

[Candidate record](paris.json) · [Full review](paris-review.html)

Sources checked **4 November 2026**:
- [Bouillon Chartier](https://www.bouillon-chartier.com/chartier_medias/2025/10/Francais.pdf) — PDF page 1, footer.

### Paris — note:phase4b:paris:examples:2

Book the Louvre and Eiffel Tower separately. The Louvre recommends a time slot, including for free admission. For the tower, choose the second floor or summit and stairs or lift before budgeting.

[Candidate record](paris.json) · [Full review](paris-review.html)

Sources checked **4 November 2026**:
- [Musée du Louvre](https://www.louvre.fr/en/visit/hours-admission/tickets-and-prices) — Ticket; visitors eligible for free admission.
- [Société d’Exploitation de la Tour Eiffel](https://www.toureiffel.paris/en/rates-opening-times) — Ticket types: second floor / summit; elevator / stairs / stairs plus elevator.

### Barcelona — attraction:city:BCN:park-guell

Plan a dated, timed visit to Park Güell’s Gaudí-designed spaces and gardens. The operator recommends booking online ahead. Read its access notices before setting off.

[Candidate record](barcelona.json) · [Full review](barcelona-review.html)

Sources checked **4 November 2026**:
- [Barcelona City Council](https://parkguell.barcelona/en) — Heritage and architecture; nature; park incidents.
- [Park Güell / Barcelona City Council](https://parkguell.barcelona/en/planning-your-visit/faqs) — Preparing for your visit — Do I have to reserve tickets?.

### Barcelona — note:city:BCN:batch1-museum-days

Museu Picasso closes on Mondays. MNAC also closes on Mondays except public holidays. Check each museum’s calendar before choosing your museum day.

[Candidate record](barcelona.json) · [Full review](barcelona-review.html)

Sources checked **4 November 2026**:
- [Museu Picasso Barcelona](https://museupicassobcn.cat/index.php/en/plan-your-visit/buy-tickets-and-opening-hours) — Hours: closed.
- [Museu Nacional d’Art de Catalunya](https://www.museunacional.cat/es/horarios-y-precios) — Horario del museo.

### Istanbul — note:istanbul:batch1-palace-day

Topkapı Palace lists Tuesday as its weekly closing day. Put the palace on another day and consult National Palaces’ holiday schedule before arranging your visit.

[Candidate record](istanbul.json) · [Full review](istanbul-review.html)

Sources checked **4 November 2026**:
- [National Palaces](https://www.millisaraylar.gov.tr/Lokasyon/2/Topkapi-Sarayi?culture=en) — Visiting information; open and closed days on public and religious holidays.

## Publication boundary

The repository’s [editorial workflow](../../../destination-editorial-review.md#exact-content-pinning) says that changed copy, sources or freshness invalidate the prior exact-revision approval. This packet leaves all five published records and their historical owner decisions untouched. The old eight deadlines remain active until these replacements are approved and applied.

[changes.json](changes.json) contains before/after text. [approval-proposal.json](approval-proposal.json) pins the five candidate revisions and the unchanged source-controlled inputs. Source checks do not impersonate the owner’s editorial approval.

On approval, use the existing single-destination workflow to apply these candidates, reset the old reviews while preserving their history, record the actual owner decision, and dry-run publication before applying it. No commit, push or deployment is included. Reassess freshness if publication is delayed past the proposed deadline.

## Verification

All five candidate records passed the existing content schema and claims-policy functions. A structural comparison confirmed exactly eight item changes, their scoped source metadata, version increments and draft lifecycle metadata; other content and deadlines are unchanged. Every new note is within the existing 240-character preview limit.

`npm test` passed on Node 24.21.0: **1,615 passed, one skipped, zero failed**. The suite checks the unchanged published records; the separate candidate checks cover the proposed replacements. `git diff --check` passed. [Verification results](verification.json).
