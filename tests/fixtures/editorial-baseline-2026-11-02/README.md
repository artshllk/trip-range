# Historical editorial test fixture

This is a frozen test corpus, not a destination publication source. It preserves the 30 pre-maintenance records (including the archived and parked destinations), identities, access records, research metadata, evidence and owner-review history used by the October regression scenarios. `manifest.json` identifies the source commit and hashes every data file. Do not regenerate it during quarterly content reviews.

The scenario clock is 26 October 2026 at 16:00 UTC; individual expiry tests inject their own date. The helper runs the real filesystem loader and receipt checks against this directory. Synthetic mutation tests still use temporary directories and the same production guards. Nothing here is imported by production or the maintenance scheduler.

Current-content integration tests use the real live files, the recorded approval instants and each item's own expiry boundary. They assert current pins against current reviews and preserve earlier approvals as history. They do not assert that the latest revision still equals a previous quarter's revision. The daily expiry audit and production runtime continue to use real time.

Add new synthetic behaviour tests or a separately named historical snapshot when needed. Never edit an old approval or move its timestamps to make a test pass.
