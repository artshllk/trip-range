# Proposed image batch — owner review only

Current status (owner approval after this preparation): Paris/New York source photographs and crops are approved by `GoEksplo Owner` and integrated locally through explicit reviewed crop metadata; not committed or deployed. See [publication status](worldwide-v1/publication-status.md). Earlier unapproved/blocker labels below describe the historical preparation stage; the linked publication status is current. Istanbul/Crete remain unapproved.

22 October 2026. No image approval, public-file integration, product-code change, provider search, commit or deployment was performed for this review.

## First batch: fill existing homepage gaps

The homepage collection is explicitly Vienna, London, Paris and New York. Vienna/London already have approved photos. Paris/New York therefore have direct visibility evidence and are the first priority; New York is an existing published guide backed by reviewed access, not one of the 30 catalogue seeds.

Review both exact candidates together in [the owner crop/credit sheet](worldwide-v1/owner-review.html). The shown 2.5:1 hero and 4:3 card crops use the pinned original image/derivative checksums and proposed focal points in [candidates.json](worldwide-v1/candidates.json).

| Destination / exact subject | Source | Credit / selected licence | Responsive WebP widths |
|---|---|---|---|
| Paris / `paris` — Eiffel Tower panorama from Arc de Triomphe, 2008 | [Individual Commons file](https://commons.wikimedia.org/wiki/File:Panorama_of_Paris_from_top_of_Arc_de_Triomphe.jpg) | MarcusObal; CC BY-SA 3.0 | 640, 1200, 1920 |
| New York / `place:Q60` — Lower Manhattan, 2016 | [Individual Commons file](https://commons.wikimedia.org/wiki/File:New_York_City_Skyline_2016.jpg) | Aaron Harris / Forestikai; CC BY-SA 4.0 | 640, 1200, 1920 |

All derivatives preserve original aspect ratio. Display crops are explicit in the review sheet. Credits link the source and licence, identify resizing/WebP/cropping, and retain the applicable share-alike terms for derivatives. Historical photos do not establish current conditions. Existing no-photo layouts remain active.

## Small follow-up: two catalogue destinations

There is no reliable result-impression/frequency dataset in this review. Do not call these popular, trending or frequently surfaced. Istanbul and Crete are a **conditional readiness-based follow-up**, chosen from the existing catalogue because current reviewed identity/content exists and existing trip/result regression fixtures cover them. If prioritization must be strictly frequency-based, defer this follow-up until owner observations or actual sanitized impression evidence identify the next destinations; do not instrument analytics solely for this task.

| Priority / destination | Exact candidate and identity | Credit / licence | Prepared sizes |
|---|---|---|---|
| 2 / Istanbul, `istanbul` | [Panorama Istanbul](https://commons.wikimedia.org/wiki/File:Panorama_Istanbul.jpg), view from Galata Tower, 2014; Commons description/coordinates and visual inspection match Istanbul | Tolga Tüfekçi; CC BY-SA 4.0 | WebP 640/1200/1920 |
| 2 / Crete, `crete` | [Chania harbour, Venetian shipyards and lighthouse](https://commons.wikimedia.org/wiki/File:Harbor,_Venetian_shipyards_and_Lighthouse_in_Chania._Crete,_Greece.jpg), 2019; source explicitly identifies Chania on Crete | Ввласенко; CC BY-SA 3.0 | WebP 640/1200/1920 |

Crete must be captioned as **Chania old harbour on Crete**. It is not an island-wide view, a beach promise, an airport image or proof of proximity to HER/CHQ. No airport or transfer assumptions change. The card crop does not include every landmark visible in the full panorama.

[Follow-up crop/credit sheet](worldwide-followup/review.html) · [metadata, dimensions, hashes and unapproved state](worldwide-followup/candidates.json). Each original SHA-1 was checked against Commons imageinfo; prepared WebP sizes preserve original aspect ratio and have recorded SHA-256. No runtime image search is introduced.

## AI and shared sections

AI remains server opt-in: absent/false disables it. The already-passed 1,463-test suite and fresh production build cover AI OFF/ON, ordinary search, quota guards, affiliate invariants and deterministic pricing. This media-review task made no further application changes. Search parameters, provider fan-out, affiliate handoff, budget/reserve arithmetic, hosting and credentials are unchanged. The currently hosted private release is not altered by these local changes.

`DestinationGuide` uses the shared `renderTripContentSections` with an empty fallback itinerary. Reviewed attractions/transport/itineraries render where available; missing sections are omitted. The prior offline check rendered all 30 reviewed content records successfully without network requests. Existing request-specific generic planning outlines remain distinct from evergreen reviewed itineraries; none were generated or expanded here.

## Exact approval boundary

Owner may approve Paris and/or New York explicitly, for example:

> I approve the Paris and New York photographs, the shown hero/card crops, destination identity, credits and CC BY-SA 3.0/4.0 derivative requirements in the pinned owner review sheet. Record reviewer GoEksplo Owner and integrate these two assets locally through the existing gated editorial/media workflow. Do not commit, push or deploy.

Istanbul and Crete remain separate proposals requiring their own explicit visual/identity/crop/licence approval. No selection is approved merely because its licence was verified. All other destinations retain the intentional no-photo layout until their own media approval passes. No content expansion is included.

## Preparation verification

Paris/New York retain the prior 40 decoded/hash-verified responsive-response checks. The new Istanbul/Crete candidates passed 40 further local image-response checks across desktop and 390/375/360/320 px, DPR 1/2: actual WebP body bytes/dimensions/SHA-256 match the recorded variants, no originals downloaded by the browser, and no horizontal overflow. See `worldwide-followup/responsive-verification.json`. The crop/credit sheets were captured for owner review. No product/provider tests were repeated; the already-passed code suite/build evidence was reused because no application source changed in this task.
