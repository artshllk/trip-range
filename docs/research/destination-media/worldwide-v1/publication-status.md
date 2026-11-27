# Paris / New York publication status

**Integrated locally; not committed or deployed.** Reviewer: `GoEksplo Owner`.
The owner explicitly approved the exact source photographs and shown hero/card
crops, then authorized the narrowly scoped explicit crop-metadata correction.

`owner-approval.json` preserves the original approval and packet/source pins.
Its `localIntegration` supplement records the current authorization, exact crop
rectangles, delivery hashes and modification notices. The original full-aspect
research WebPs and review packet remain unchanged as historical review evidence.
`publication-proposal.json` and `publication-validation.json` are the earlier,
pre-correction proposal/failure evidence; they are not the runtime authority.

Runtime authority is `content/media/approved.json`: four assets, eight locked
human-reviewed hero/card selections. Paris and New York now resolve through the
same store/components as Vienna/London. Istanbul and Crete remain unapproved.

| Subject | Original (preserved) | Explicit source crop | Local WebPs |
|---|---|---|---|
| Paris / commons:4213147 | 7203×2247, SHA-1 09ef91151dd7a54faa163be6c0ea5252a22fdeef | left 508, top 0, 5617×2247 | 640×256, 1200×480, 1920×768 |
| New York / commons:129513544 | 7580×2110, SHA-1 e542120490743c6f39c2159fc8f7526cc89d7017 | left 1567, top 0, 5275×2110 | 640×256, 1200×480, 1920×768 |

Both crops use the approved normalized focal points. The subsequent card crop
preserves the approved original composition within one original pixel of rounding.
Original source/identity/licence records remain intact. Credits disclose the crop,
WebP resizing and further card display crop, link the individual Commons source and
CC BY-SA licence, and retain applicable derivative share-alike requirements.

The former source-aspect blocker is resolved without increasing the aspect limit:
explicit, bounded panoramic crop metadata is pinned in each selection; the crop
must itself satisfy the unchanged suitability limits. Other images retain their
existing rules. No crop is selected automatically.

Checks: 110 targeted regressions; **1,468 full-suite tests passed**; media checks
including HEAD revision preservation; all 30 editorial reviews; Next.js 16.4.0
Turbopack production build. Browser verification passed 70 checks and 80 actual
responsive-image checks across desktop and 390/375/360/320 px, plus exact product
source/licence-link and modification-notice checks for both new cities. No live
flight, Redis or OpenAI requests were made.

See `integration-verification.json` and `product-attribution-verification.json`.
No remaining local media-publication blocker is known. Deployment remains a
separate owner approval. AI stays default OFF locally; search, pricing and
affiliate behavior and hosting/infrastructure were not changed by this correction.
