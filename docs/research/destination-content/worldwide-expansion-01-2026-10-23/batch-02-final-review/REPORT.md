# Worldwide Batch 2 — editorial, media and planning acceptance

**Packet:** `worldwide-batch2-final-review-v1`. Four English **v4** candidates. **Unpublished; exact owner approval pending.** [Owner gallery](gallery.html) · [Approval wording](owner-approval-wording.txt).

Batch 1 remains owner-accepted for the observed private experience. Its deployment checks have not been reopened.

| Draft | Editorial result | Arrival identity preserved | Exact corrections in this packet |
|---|---|---|---|
| Tokyo | **PASS for proposed source-backed copy** | `place:Q1490`; TYO search group; HND/NRT remain operating-airport choices | Operator-supported opening/entry caution and conditional Skytree/riverside alternative. No museum opening schedule invented. |
| Kyoto | **PASS for proposed source-backed copy** | `place:Q34600`; OSA is a provider group, KIX/ITM are external gateways | Two-night outline now groups Kiyomizu-dera and Hokan-ji together, with the optional Maruyama Park break on departure day. Added respectful exterior/public-street alternatives. |
| Bangkok | **PASS for proposed source-backed copy** | `place:Q1861`; BKK group retains BKK/DMK distinction | Added palace calendar and conditional Wat Pho/Wat Arun alternatives. The official calendar lists the palace closed on 23 October 2026 while Wat Phra Kaew is listed separately; this is not encoded as a standing closure rule. |
| Marrakesh | **PASS for proposed source-backed copy** | `place:Q101625`; RAK | Uses the official English garden source. Excludes Villa Oasis and museums from the proposed visit; adds medina/Koutoubia exterior alternative if garden entry is unavailable. |

PASS means the narrowly worded candidate has supporting editorial evidence and sensible geography. It is **not owner sign-off**, live transport/service verification, an opening-calendar guarantee, hotel availability or permission to publish.

## Editorial and source correspondence

The [original pinned v3 packet](../batch-02-review/gallery.html) remains byte-for-byte unchanged. The revisions have separate v4 content/identity/evidence hashes in [the unsigned proposal](approval-proposal.json). Exact candidate JSON and per-claim evidence are in [drafts](drafts/); individual workflow reports are linked from the gallery.

- **Tokyo:** GO TOKYO's Asakusa, Meiji Jingu, airport/base guidance and Sumida map support the named areas and attraction grouping. The [shrine operator](https://www.meijijingu.or.jp/en/opening/) supports variable opening periods and closure near sunset. [Skytree](https://www.tokyo-skytree.jp/) is a separately ticketed choice; [Sumida River Walk](https://www.gotokyo.org/en/spot/1795/index.html) is a conditional alternative, not guaranteed open access. The photograph depicts Hōzōmon, explicitly not Kaminarimon. Some tourism pages were available only through indexed primary text after direct-fetch failures; no current timetable, access or accessibility guarantee is inferred.
- **Kyoto:** The temple's [own visitor information](https://www.kiyomizudera.or.jp/en/visit/), [official Gion/Kiyomizu area guide](https://kyoto.travel/en/areas/gion-kiyomizu/), [eastern walk](https://kyoto.travel/en/itineraries/higashiyama-at-dawn/), [Fushimi Inari guidance](https://www.japan.travel/en/spot/1128/) and [Gion manners](https://kyoto.travel/en/responsible-travel/gion-manner-message-from-southern-gionmachi/) support the limited place/history/access claims. The [arrival guide](https://kyoto.travel/en/getting-to) distinguishes Kansai and Itami ground journeys. The draft makes no invented promise of a full mountain circuit, building interior, blossom display or universally accessible route.
- **Bangkok:** TAT's [Old City/Yaowarat guidance](https://www.tatnews.org/2024/06/exploring-bangkoks-old-city-and-yaowarat-is-super-easy-with-mrt-blue-line/) supports the temple/river/station geography; the [official palace calendar](https://www.royalgrandpalace.th/en/schedules) and [visitor rules](https://www.royalgrandpalace.th/en/visit/practical-information) support the access caution. Wat Pho's own page could not be freshly fetched; its current admission rules are left to its operator. The palace source contains unrelated template wording about Trianon, which is not used. AOT's DMK mode article is older; it supports general options, not present operating status. No September disruption statement is represented as current.
- **Marrakesh:** Moroccan tourism's [city page](https://www.visitmorocco.com/en/travel/marrakesh) and [medina page](https://www.visitmorocco.com/en/travel/marrakech/medina) support the named sights, history and base districts; [ONDA](https://www.onda.ma/en/Our-Airports/Marrakech-M%C3%A9nara-Airport/Services/Taxi-Bus) supports general airport options. These were cross-checked as indexed official text where direct access was blocked. [The garden operator](https://www.jardinmajorelle.com/en/) provides online-only ticket guidance and distinguishes the garden from Villa Oasis/museums. No stale brochure hours or 2023 taxi-ordering process is copied as current.

No museum admission is required by these outlines, so no fictional Monday/Sunday closure rule is added. Temple and garden alternatives are conditional on their own current access. Base suitability and itinerary pacing are editorial judgments, not official endorsements or operator-tested schedules. Arrival/departure stops remain optional; two nights cover three calendar days and three nights cover four.

**Currency and costs:** candidates contain no new observed prices, exchange rates, per-day allowances, ticket amounts or numerical cost profiles. Source figures are not implicitly converted to EUR. Existing accommodation/FX/transfer evidence, currencies, reserves, occupancy and missing-cost protections are unchanged. A useful guide does not prove a complete or affordable trip total.

**Freshness:** general review-by 21 January 2027; operational notes/templates by 6 November 2026, with current operator checks before publication. Indexed source timestamps are not observations of service availability. Keep those limitations during owner review.

## Confirmed planning defect and local correction

`loadDestinationGuide` previously supported city-code targets only; the URL location decoder rejected canonical place IDs. Tokyo's direct-entry profile and Kyoto's gateway profile therefore had no valid destination-prefilled guide action.

The correction uses the existing `toPlace` URL shape with a canonical place ID and no invented city/airport code. The server resolves the snapshot against the reviewed access registry. Unknown, expired or unavailable access cannot produce an invented provider-city destination or broad search.

Changed product files:

- `src/services/destination-guides.ts`: shared target resolver preserves existing direct-city behavior and supports reviewed direct-entry/gateway/mixed canonical places.
- `src/domain/locations.ts`: structurally accepts a canonical place snapshot only without city/airport/IATA aliases. It grants no provider identity authority.
- `src/providers/server/composition.ts`: rehydrates canonical targets from reviewed server access; never fabricates a generic city for an unrecognized place.
- `tests/batch2-planning.test.ts`: four regression tests cover Tokyo/Kyoto, retained inputs and reload, alias-smuggling rejection, exact bounded synthetic provider groups, empty-fare planning preservation and unknown/unavailable access denial.

Tokyo prefill stays `place:Q1490`; its existing request plan queries TYO once for one departure. Kyoto stays `place:Q34600`, never Osaka; its existing request plan queries the OSA provider group once and retains the separate KIX/ITM gateway-transfer rules. These are synthetic dispatch checks, not live fare coverage claims. Explicit traveller filters remain effective and are not silently discarded.

The four guides are still outside the runtime allowlist. This is preparation and a shared navigation fix; it has not published v4 content or created SEO routes.

## Four photo candidates — no selections or approval

| Destination / asset | Subject and photographer | Licence | Responsive widths |
|---|---|---|---|
| Tokyo `commons:80694116` | Hōzōmon, Asakusa; Basile Morin; 7 June 2019 | CC BY-SA 4.0 | 640 / 1200 / 1920 |
| Kyoto `commons:53593907` | Kiyomizu-dera main hall; Martin Falbisoner; 16 November 2016 | CC BY-SA 4.0 | 640 / 1200 / 1920 |
| Bangkok `commons:82660408` | Wat Arun from the river; Trip.with.taste; 24 December 2018 | CC BY-SA 4.0 | 640 / 1200 / 1920 |
| Marrakesh `commons:72262779` | Koutoubia exterior; Philippe Salgarolo; 19 January 2018 | CC BY-SA 4.0 | 640 / 1200 / 1920 |

Each individual source page, revision, photographer, description, licence and camera/subject evidence is pinned in [Commons metadata](evidence/commons-metadata.json) and [the media proposal](media/approval-proposal.json). Original SHA1 matches Commons; original SHA256 and derivative dimensions/bytes/hashes are recorded. All 12 responsive files pass the existing media/file validator. Originals remain unchanged; only resizing/WebP conversion and the proposed CSS display crop are used. API tracking query parameters were removed from canonical asset URLs, not from the source evidence. No upscaling, recolouring, retouching or generative changes.

The [gallery](gallery.html) shows actual hero/card crop ratios and exact focal points, with visible credits, source/licence links and historical-image cautions. [Shared-component previews](previews/cards.html) use the actual product components. CSS changes the desktop 2.5:1 hero/4:3 card to the existing mobile 1.5:1 hero/1.6:1 card. Preserve the CC BY-SA notice for derivatives and credit/source/licence/change notice on publication. No endorsement is implied.

All four media selection results remain `none` through the runtime media store, and all four draft content publication results remain blocked. No candidate files were placed in `public/`. Existing approvals, images and no-photo fallbacks remain unchanged.

## Verification

- Targeted search/guide/access regressions: **97 passed**; final stronger four-test planning check also passed.
- Full suite: **1,504 passed, 0 failed, 1 optional local Redis test skipped** (1,505 total). No live Redis/provider/OpenAI tests were run.
- Production build: **Next.js 16.4.1, Node 24, webpack passed**. No build or hosting configuration changed.
- Focused lint: passed. Source/client secret-boundary checks: passed.
- Shared previews: **20 guide viewport checks**, plus **6 gallery/card checks**, at desktop and 390/375/360/320 px as applicable. Planning navigation/reload/Back passed in all 20 guide cases using a local production-built homepage isolated from environment files and service credentials.
- Mobile guide heroes decoded the **640px** WebP; desktop used **1200px**. 1920px files validated and retained. Zero overflow, browser errors, API requests or external requests during browser checks. Existing native Read more controls expose full conditional guidance.

This is local acceptance evidence, not Netlify hosted verification. No Batch 1 probe or deployment test was repeated.

## Remaining gates

1. Owner explicitly approves the exact four English v4 candidates and the exact four images/crops/credits/licences in this packet; use [the proposed wording](owner-approval-wording.txt), or approve a narrower subset.
2. Then integrate only the approved subset through existing registered evidence, five-check editorial review/publication receipts and media approval workflow; retain the required freshness and source limitations. No signatures have been invented.
3. Commit/private release remains a separate authorization. No code has been committed or pushed, and no deployment/infrastructure action occurred.
