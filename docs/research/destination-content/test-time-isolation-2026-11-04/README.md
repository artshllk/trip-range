# Editorial test isolation — 4 November 2026

The owner approved both revised menu notes and separately authorized test-logic changes. The notes are applied with 18 November deadlines. [Exact menu application and scope checks](../expiry-review-2026-11-04/menu-revision-2/applied/verification.json).

## Diagnosis before changing tests

The earlier suite had 110 failures: 107 raised `invalid-or-orphan-editorial-review`; three asserted superseded versions, digests or expiry counts.

| Unchanged-test experiment | Passed | Failed | Meaning |
|---|---:|---:|---|
| New content and approvals, host clock set to 4 November at 09:00 UTC, before the new approvals | 0 | 107 | Turning the clock back alone cannot validate a later approval. Most scenarios explicitly inject an October date regardless of the host clock. |
| Same clock, same test and production code, five cities’ pre-approval content/research/review JSON restored from HEAD in an isolated temporary workspace | 107 | 0 | The tests pass with matching historical inputs. No functional regression was hidden by those 107 failures. |

[Exact selected tests, counts, baseline commit and 15 control files](diagnosis.json). The real workspace was never rolled back or backdated. An initial temporary-workspace attempt used a symlink for evidence and was rejected by the loader's filesystem guard; that invalid setup was corrected to ordinary copied files before the control result above was recorded.

Classification: **107 temporal fixture/data failures, zero demonstrated product regressions, three obsolete state assertions**. Calling all 107 purely “wall-clock-dependent” would be imprecise: the central problem was historical test clocks coupled to mutable current approvals. Merely changing a date would leave the underlying design broken.

## Design change

- Historical regression scenarios now use a frozen 30-destination corpus with its own content, receipts, identities, evidence, metadata and explicit clock. A hash manifest pins its data; quarterly reviews do not regenerate it. The real filesystem loader and publication checks still run against those files. Synthetic write/guard tests retain their temporary directories.
- Current-content integration checks read the actual live records. They compare current versions and digests with current approvals, retain historical approvals as history, and inject the recorded approval/publication instants. Item visibility is tested immediately before and exactly at each recorded expiry boundary, rather than asserting an old date or item count.
- The Phase 2 digest check now validates current pins and separately locates the Phase 4B approval in history. The Phase 4B expiry test follows each current note's deadline. The worldwide v3 regression is explicitly historical; current versions are covered by the generic current-corpus integrity tests.
- Six additional tests cover fixture integrity, past/future host clocks, actual current approval and expiry boundaries, and three synthetic quarterly revisions. Each synthetic revision rejects the previous receipt, requires new pins, and expires at its own deadline.
- Production runtime, scheduler, future-review rejection, expiry rules and human approval requirements are unchanged. Test dates never authorize publication.

## Verification

The complete suite has **1,622 tests: 1,621 passed, zero failed, one existing skip**. The skip is the real-Redis Lua integration test, which requires Redis or `GOEKSPLO_TEST_REDIS_SERVER`; it was not added or broadened here.

The exact 107 previously failing tests also pass **107/107 with the host clock in 2000 and 107/107 in 2100**. [Clock verification](clock-verification.json). This repeats the original failing selection against the fixed tests and current corpus; it does not substitute the old control dataset.

[Final check results](results.json) record the local commands and their exit codes. Security, lint (zero errors; two existing room-worksheet warnings), type checking, all source validators, and the full test suite pass. `npm run build -- --webpack` passes. The standard Turbopack build first encountered restricted font downloads, then—after the network retry—the documented host restriction on binding its internal PostCSS worker port. No bundler setting or application code was changed. Turbopack remains unverified on this host. The configured GitHub Verify workflow uses `npm run build` → `next build` without `--webpack`, so remote CI exercises Turbopack. At the time of this local verification, no remote CI run, commit, push or deployment had occurred.

Run the full suite with the repo's Node 24 version and `npm test`. Focused regression: after the test compile, `node --conditions=react-server --test .test-build/tests/editorial-time-isolation.test.js`. That test permanently exercises past/future clocks and later quarterly approvals as part of the normal suite.
