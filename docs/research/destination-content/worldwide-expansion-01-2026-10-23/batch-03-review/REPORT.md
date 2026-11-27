# Worldwide Batch 3 — owner review

Packet: **worldwide-batch3-review-v1**. English v4 candidates; assessed 24 October 2026, Europe/Belgrade. **Nothing in this packet is approved or published.** Earlier Batch 2 integration is preserved.

[Open the owner gallery](gallery.html) for exact desktop/mobile hero and card crops, individual source/licence links, credits, complete shared-guide previews and the proposed two-/three-night itineraries. [Exact approval wording](owner-approval-wording.txt) is a proposed response only.

## Editorial decision and corrections

| Destination | Decision on revised draft | Corrections and remaining limits |
| --- | --- | --- |
| Cape Town v4 | PASS for owner review | Treat the explicit MyCiTi airport-service suspension as authoritative over its old A01 timetable. Use the museum's own conditional island-tour guidance. Mountain and garden outings remain separate, weather-dependent or optional. Recheck airport service before publication. |
| Rio de Janeiro v4 | PASS for owner review | Replace unsupported port-history wording; use current Motiva VLT references. Preserve the Parque Lage mansion-restoration exclusion. GIG, SDU and RRJ remain distinct: **RRJ ground transport is explicitly unverified and unpriced**. No through-ticket or direct GIG metro is promised. |
| Sydney v4 | PASS for owner review, operational recheck due | Explain the separate SYD station access fee, ordinary-cap exclusions and separate weekly access-fee cap. WSI does not inherit SYD instructions or a direct-metro claim. Remove an imminently stale opening-date assertion; **recheck WSI opening/services by 26 October and before publication**. Use the substantive First Nations source. |
| Dubai v4 | PASS for owner review | Limit DXB metro guidance to Terminal 1/3; distinguish DWC bus/taxi connections without prescribing conflicting interchange examples. Use the official Al Shindagha map only for stable setting/ticket-scope information. A single-pavilion notice is not a recurring whole-museum closure. |

The narrowed drafts have useful, geographically sensible sights, relevant history, two accommodation-area considerations and conditional arrival/departure-day outlines. Neither source availability nor an itinerary implies current admission, a safe-route rating, a hotel offer or guaranteed service. [Editorial assessment](editorial-review.md), [correction list](editorial-corrections.json) and each draft's evidence file distinguish official facts from editorial planning judgments and inaccessible source details.

Operational source reviews generally expire 6 November 2026; stable background reviews 21 January 2027. Sydney's WSI check is earlier. These are review deadlines, not guaranteed periods of unchanged service. No researched fare, food basket, hotel rate, transfer allowance or native-currency numerical profile is activated.

## Photograph candidates

| City and exact candidate | Photographer / licence | Depiction and caveat |
| --- | --- | --- |
| Cape Town — `commons:126494271` | Sumit Surai / CC BY-SA 4.0 | Camps Bay/Atlantic coast from Table Mountain, July 2018; not a City Bowl or airport view. |
| Rio — `commons:133796307` | Wilfredor / CC0 | Urca waterfront and Botafogo Bay, June 2023; not Copacabana, Sugarloaf or Christ the Redeemer. Courtesy credit retained. |
| Sydney — `commons:73107560` | peter abery (Poidabro) / CC BY-SA 4.0 | Opera House and Harbour Bridge at night, March 2018. Crop keeps both subjects; not evidence of an event or current lighting. |
| Dubai — `commons:68665373` | Vedaant Jamaiyar / CC BY-SA 4.0 | Dubai Creek boats and boarding waterfront, April 2018; no current route, fare or operator claim. |

All four individual file pages and Commons metadata were checked. Source originals remain unchanged; original dimensions/checksums, file-page revisions, derivative SHA-256 hashes, author/source/licence links and modification notices are pinned in [media/approval-proposal.json](media/approval-proposal.json). Twelve WebPs use widths 640/1200/1920 without upscaling; display crops use explicit focal points. Applicable BY-SA derivative obligations remain; CC0 has no share-alike requirement. No endorsement or blanket third-party-rights clearance is asserted.

The candidate registry contains **zero selections** and all reviewer/approval fields remain pending. No images were copied to public delivery. Rejected watermarked, hazy, architecture-rights-flagged and file-history-flagged alternatives are documented in [media/excluded-candidates.json](media/excluded-candidates.json); they are not proposed for approval.

## Functional and visual acceptance

- Existing shared guide/card components render all four candidates; no destination-specific layout or production component was added.
- Planning targets remain canonical city groups CPT, RIO, SYD and DXB. Operational airport lists remain CPT; SDU/GIG/RRJ; WSI/SYD; DWC/DXB respectively. No airport access record changed.
- Planning preserves Zurich origin, CHF budget, dates/flexibility, adults/children and preferences, and clears only a previous destination's airport hint. Reload and browser Back retain context.
- Synthetic server-composition tests resolve each canonical subject with one bounded provider-group discovery request and an unavailable-fare state for empty data. No live provider, Redis or OpenAI requests were made.
- **20 guide viewport checks passed** at desktop 1440 and mobile 390/375/360/320, plus six gallery/card viewport checks. No horizontal overflow, AI control, browser exception or external/API request was observed. The actual downloaded hero variant was 640px on mobile and 1200px at desktop DPR 1. All 1920px files were separately validated for dimensions/bytes/hash; no hosted delivery claim is made.
- Local screenshots were visually inspected, including [actual hero crops](screenshots/hero-contact-sheet.jpg) and the shared cards. The exact three-night template appears in a labelled review-only panel; it is not a new product section.

Browser scope: unpublished static previews rendered with production CSS/shared React components, with planning links opening the isolated, keyless production-built homepage. It does **not** prove hosted Netlify behaviour or publish candidate routes. See [browser-verification.json](browser-verification.json).

## SEO and publication

Each revised guide has enough distinctive content to merit an evergreen indexable page **after** exact owner approval, due operational checks and explicit guide integration. Proposed English titles/descriptions, intent hypotheses, www canonical paths and contextual links are in [batch.json](batch.json). No search-volume or ranking evidence is claimed. Related links target already integrated guides; none implies a direct flight.

The four guide routes remain outside the publication allowlist. Preview/gallery pages are noindex. Existing English-only routing, `/sq` redirects, search/trip noindex, approved content/media receipts and SEO behaviour are unchanged.

## Verification and files

- Targeted regression run: **15 passed, 0 failed**.
- Full suite: **1,510 tests; 1,509 passed, 0 failed, 1 optional local-Redis test skipped**.
- TypeScript and lint of the new regression file passed; `git diff --check` passed.
- Fresh **Next.js 16.4.1 production build passed** using the established local webpack verification command. No dependency/build-setting changes.
- Candidate content/media validation passed, including all twelve responsive file hashes; unsigned publication gates remain closed.
- All **1,880 pre-existing baseline files** remain byte-for-byte unchanged. This task adds this review packet and `tests/batch3-planning.test.ts` only. Earlier uncommitted Batch 2 work remains intact.

Exact packet files/checksums are recorded in `packet-files.sha256.json`; final machine-readable checks are in [verification.json](verification.json).

**Remaining action:** owner review of the pinned v4 wording and exact four photograph/crop candidates. Recheck WSI before integration/publication and any other source whose review has become due. Rio's RRJ limitation must remain explicit unless separately researched. No remaining application-code defect was found in this scope. AI stays OFF; pricing, reserves, provider admission/fan-out and affiliate behaviour are unchanged. No commit, push, deployment, credential or infrastructure change occurred.
