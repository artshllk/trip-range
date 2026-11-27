# Batch 01 — approved subset integrated locally

**PASS — local integration only. No commit, push or deployment.**

Owner approval recorded as **GoEksplo Owner** at `2026-10-22T11:50:36.378Z`. The exact final-v2 review packet remains pinned and unchanged; its pending labels describe its state before approval. [owner-approval.json](owner-approval.json) records this subsequent explicit authorization, identity acceptance and both role deliveries.

## Integrated subset

crete, istanbul, prishtina, prizren, skopje, thessaloniki, ulcinj, zurich.

- Eight new assets, sixteen hero/card selections and twenty-four exact approved responsive files. The registry now has twelve assets/twenty-four selections, with thirty-six public WebPs.
- Five new owner-reviewed identity registrations: Prizren, Skopje, Thessaloniki, Ulcinj and Zurich. Existing Crete, Istanbul and Prishtina identity records are preserved byte-for-field so content-review digests remain valid; their acceptance is pinned separately in the owner record.
- Prishtina uses only the approved May 2024 National Library city view by Planeti, CC0. Its old street photograph is not selected. CC0 source/licence links now render through the same local Commons credit branch, without inventing share-alike obligations.
- Crete and Istanbul retain their exact approved panoramic source crop rectangles and derivative hashes. Prior Vienna/London/Paris/New York media and selections remain unchanged.

## Withheld

Brezovica, Mavrovo, Mirusha Waterfalls and Rugova Valley remain unregistered/unapproved/unpublished. Their research evidence is preserved outside runtime imports and `public/`. Separate identity review and explicit photo approval are still required.

## Verification

- Targeted media/editorial regression selection: 56 passed.
- Full suite: **1,472 passed, zero failures**.
- Production build: **Next.js 16.4.0 / Turbopack passed**, including all thirty editorial records and media/history/file checks. Build ran in a temporary keyless copy with local failure fixture blocking application providers. A temporary symlink/cache restriction was corrected in that copy; no application/build configuration was changed.
- Browser: **40 actual trip-page checks**, all eight approved destinations at desktop 1440 and mobile 390/375/360/320. Exact derivative SHA-256, source/author/licence/crop notices, AI-off UI, no overflow and no browser errors passed. Mobile requests selected 640px files. No external browser requests or live provider calls.
- ESLint, secret-boundary and whitespace checks passed.
- [Structured verification](integration-verification.json) · [Product browser evidence](product-browser-verification.json).

## Files changed by this integration

- `content/media/approved.json`
- `content/places/{prizren,skopje,thessaloniki,ulcinj,zurich}.json` and generated `content/places/records.ts`
- Twenty-four `public/destinations/` WebPs, exactly copied from the approved packet
- `src/components/travel/Provenance.tsx`: CC0 licence recognition for existing local credit links only
- `tests/catalogue-media-batch01.test.ts`, `tests/fixtures/approved-media.ts` and expected approved-subject/variant assertions in five existing media/editorial/identity test files
- This publication status and new owner/verification records under the final review packet

AI remains default OFF. Pricing, affiliate behavior, provider limits, editorial content, SEO and infrastructure are unchanged. No remaining blocker is known for this approved local subset. Releasing it to private hosting requires separate commit/push/deployment approval.
