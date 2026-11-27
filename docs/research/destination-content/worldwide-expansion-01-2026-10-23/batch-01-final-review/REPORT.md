# Worldwide destination batch 1 — final local preparation

**PASS for the requested planning and attribution corrections. Editorial/media owner approval remains pending. Nothing newly published.**

Branch: `experiment/netlify-free`. Starting HEAD remains `71ed6609f2c61676392f73c005c6206df7b9aa67`; no commit, push or deployment was made.

Open [the final owner gallery](gallery.html). The original `worldwide-batch1-review-v1` packet remains untouched. This presentation revision is `worldwide-batch1-final-review-v1`; it references the exact same four English v3 content/identity/evidence pins and three photo/crop/derivative proposals.

## Corrections

**Barcelona:** the guide loader previously looked only at access profiles and the legacy flight catalogue, omitting Barcelona's already validated neutral identity. It now uses that identity's city code only after those sources, for a city without an applicable access object. Barcelona prefills `city:BCN`, rather than inventing an operating airport. Existing direct-city precedence is unchanged; gateway/mixed access objects suppress this fallback. Old destination-specific arrival hints are still cleared, while origin, dates, flexibility, budget, currency, travellers and preferences are preserved.

**Mexico City:** the proposed `commons:139259979` image now receives visible photographer/source/licence/modification credit in the shared guide hero, discovery card, result card and trip-detail hero. Result/trip views reuse the existing `photo-caption` styling. The rule is keyed to this exact Commons asset, not a guessed city or photographer string. Other photographs keep their previous credit controls. The real image boundary still removes the credit when the photo is missing, rejected, belongs to another destination or fails to load; the presentation rule never grants media approval.

No metadata, original image, derivative, focal point, licensing record, identity, reviewed prose or publication gate was altered. There are no new numeric cost profiles or pricing changes.

## Changed application/test files

| File | Purpose |
|---|---|
| `src/services/destination-guides.ts` | Validated canonical-city fallback, preserving access precedence. |
| `src/components/travel/Provenance.tsx` | One shared credit-placement rule for the exact photograph, with existing controls as fallback. |
| `src/components/discovery/DestinationGuide.tsx` | Apply visible credit to the guide hero. |
| `src/components/discovery/DestinationCards.tsx` | Apply visible credit to discovery cards. |
| `src/components/travel/ResultCard.tsx` | Prevent the same required credit from being hidden in a result popover. |
| `src/components/travel/FullTrip.tsx` | Prevent the same required credit from being hidden in the trip hero disclosure. |
| `tests/destination-discovery.test.ts` | Real-loader navigation and direct/gateway/mixed precedence regressions; actual-component credit tests, including rejected images and unchanged normal credits. |

Only the new `batch-01-final-review/` research directory was added alongside these seven tracked-file modifications. It contains the gallery, unchanged-pin references, local previews/fonts/screenshots, verification records and exact approval wording. Its file manifest records the complete artifact list. Existing unrelated untracked research was not edited or staged.

## Verification

- Targeted discovery/image/access/mixed-access/crop tests: **89 passed, zero failed**. After completing the result/trip credit reuse correction, focused discovery/budget/media-layout tests: **57 passed, zero failed**.
- Final full suite: **1,497 passed, zero failed, one skipped** out of 1,498. The skipped rolling-window test requires a local Redis server; no live Redis diagnostic or provider request was run.
- Lint: **zero errors**, two existing unused-import warnings in `tests/accommodation.test.ts` and `tests/destination-content-pilot.test.ts`. Neither unrelated file was changed.
- Production build: **passed with `npm run build -- --webpack` on Node 24 / Next.js 16.4.0**. The default Turbopack build could not bind its CSS-worker port in this execution environment, so that local bundler path remains unverified. Existing font downloads needed network access. Stale generated `.next/dev/types` containing obsolete route references were preserved in a temporary backup outside `.next`; no source, TypeScript or hosting configuration was changed. Next's security notice also interrupted the build once before its normal continuation completed.
- The final browser record covers actual shared guide/card components and navigation to the locally served production-built Next homepage at desktop, **390/375/360/320px**, including destination prefill, reload and browser Back. Additional result/trip photo-reuse previews use explicit synthetic, unpriced test inputs only. All API, search-results, affiliate and external requests are blocked during these checks. These are local checks, not a claim of hosted Netlify verification; see [browser-verification.json](browser-verification.json) and screenshots for exact outcomes.
- Draft schema, source pins, real publication rejection and physical media integrity pass. The original review packet's **76 pinned files** remain byte-identical. All three new images still have no approved selections; all four new guide routes remain outside the publication allowlist. Istanbul's existing locked media remains unchanged.
- AI stays OFF by default. English-only routing, SEO/noindex rules, deterministic pricing/reserves, current airport identities, affiliate behavior, provider admission and request bounds remain unchanged. No infrastructure or environment settings changed.

## Separate dependency advisory observed during the build

The installed **Next.js 16.4.0** is version-flagged by npm's production-dependency audit. The maintainer lists **16.4.1** as patched for these advisories:

- [Image Optimization RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw).
- [Server Actions denial of service](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r).
- [Cache Components typed-array RCE](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr).

This is an existing dependency finding, not a demonstrated exploit introduced by this patch. Installed Sharp is **0.35.5**, satisfying the image advisory's documented workaround. A source scan found no `use server`, `use cache` or Cache Components configuration in the application; that is a limited exposure check, not a proof covering every deployed execution path. Recommend a separately approved Next.js security patch before public release. **No dependency or lockfile was changed, and this task does not authorize that upgrade.** See [the sanitized advisory record](dependency-advisories.json).

## Remaining owner decisions

1. Approve the four exact English v3 drafts and the three exact photo/crop/licence proposals in this final gallery. No reviewer signature or approval date has been entered.
2. Decide separately on the Next.js security patch before a release. Editorial/photo approval does not authorize that dependency work, a commit or a deployment.

Time-sensitive visitor information retains its original recheck deadline: **6 November 2026**, and before publication; other periodic guidance: **21 January 2027**. Recheck and repin if approval is delayed beyond those requirements.

Use [owner-approval-wording.txt](owner-approval-wording.txt) after reviewing the gallery. Until that explicit approval arrives, content, images, routes and sitemap entries remain unpublished.
