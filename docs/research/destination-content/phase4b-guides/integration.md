# Phase 4B owner approval and local integration

**PASS — locally integrated, not deployed.** The explicit owner message approved the pinned English Vienna v2, London v4, Paris v3 and New York v3 wording, official sources, presentation and documented freshness requirements. This is the human approval basis; test results are verification only.

| Guide | Version | Reviewer | Local publication receipt timestamp (UTC) |
|---|---:|---|---|
| Vienna | 2 | GoEksplo Owner | 2026-10-22T21:46:54.369Z |
| London | 4 | GoEksplo Owner | 2026-10-22T21:46:55.979Z |
| Paris | 3 | GoEksplo Owner | 2026-10-22T21:46:57.507Z |
| New York | 3 | GoEksplo Owner | 2026-10-22T21:46:59.043Z |

## Integration

The existing set-destination-review commands reset the stale associations, recorded the five explicit English checks, acknowledged the retained source/presentation findings, and approved each exact content/identity revision. Each approve-destination-content dry-run passed before its explicit apply. Prior decisions and full review history remain intact. Every root/item uses the single publication timestamp required by the unchanged receipt gate.

[Exact dry-runs, applies and operational pins](publication-integration.json) · [Original owner approval proposal](approval-proposal.json)

Candidate JSON and the pre-approval review packets remain unchanged as an audit trail. The earlier published records are retained in `prior-published/`. Only the four runtime destination files, their four review files and four research metadata files were integrated. Static manifest imports already refer to those filenames and did not change.

The approved proposal used a report path that the operator registry does not accept. The existing workflow requires one flat Markdown filename. A byte-identical copy of the accepted cost-assumptions review is registered as `phase4b-guide-cost-assumptions.md`, with each city's complete cited-source count. The operational evidence pins therefore include the supported metadata and the existing persisted editorial findings. The approved content and identity digests are unchanged; no source text or freshness date was altered, and the original proposal remains intact.

## Verification

- Editorial content: passed for 30 destinations and 124 attractions; zero external or AI calls.
- Editorial decisions/receipts: passed for all 30 records; no stale association or missing approval.
- Static manifests: passed, no generated changes.
- Full regression suite: **1,495 passed, zero failures, zero skipped**. Real Redis Lua tests used only a disposable local Unix-socket server, never production Redis.
- New integration regressions verify the exact approved runtime copy, reviewer/checks, reconstructable prior review history, supported evidence registration, independent menu/transport expiry and rejection of unapproved subsequent edits.
- Older publication tests had a fixed noon snapshot before these new approvals. Their clocks now use 23 October 2026 00:00 UTC, still before expiry. Exact-version checks for Vienna/London/Paris/New York were updated while retaining assertions for the historical approvals. Production timestamp validation was not changed.
- Lint passed for all 18 adjusted test files. Diff whitespace checks passed.
- Fresh keyless Node 24 / Next.js 16.4 production build (`npm run build -- --webpack`) passed, including manifest, editorial and media prebuild gates. No build settings changed. The only build network dependency was the existing Google Fonts download.
- The previously verified desktop/390/320 guide layout uses identical factual copy and the same components; there was no new layout change or need to repeat the owner visual review. Runtime integration was checked through the real pinned store.

[Machine-readable verification](integration-verification.json) · [Production build log](integration-production-build.log)

## Preserved boundaries

Application code, cost profiles, currencies, reserves, deterministic calculations, airports/access records, existing itinerary/attraction text, image/licence records, provider-admission implementation and AI OFF were unchanged from the pre-integration snapshot. The wider uncommitted Phase 4A work was preserved. No provider, OpenAI or production Redis calls were made.

No commit, push, deployment, infrastructure, billing, DNS, credential or public-access change occurred.

## Remaining blockers and maintenance

No remaining blocker for these four local guide revisions. They are eligible in the current local runtime only. The deployed private site is unchanged.

Menu/example notes retain expiry **5 November 2026 00:00 UTC**; transport notes retain expiry **21 November 2026 00:00 UTC**. Recheck before those dates and before publication if later. The unchanged runtime omits expired notes rather than extending their validity or treating them as cost allowances. No numerical profile activation is authorized or performed.
