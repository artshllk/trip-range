# Shared fare endpoint admission

Implemented 19 November 2026. Collector, planner and the standalone fare diagnostic
use the same Redis database and endpoint keys. Visitor/search quotas remain separate.

| Endpoint | Provider limit | Shared application allowance |
| --- | ---: | ---: |
| get_latest_prices | 300/minute | 300 per rolling 65 seconds |
| prices_for_dates | 600/minute | 600 per rolling 65 seconds |
| nearest-places-matrix (existing nearby-airport fallback) | 60/minute | 60 per rolling 65 seconds |

The five-second margin covers the bounded admission-to-dispatch delay. Redis TIME
and one atomic Lua operation expire old events, count current events and reserve
the next attempt. The key does not vary by origin, process, token or deployment.
Collector pagination consumes one admission per actual HTTP request. Planner
cache hits consume none. The collector retains 500 ms pacing to reduce bursts;
pacing alone is not the quota protection.

Unknown endpoints/hosts, absent configuration, malformed responses, Redis refusal,
outage or timeout never dispatch to the provider. Redis has a 1.2-second deadline.
Late admission is discarded. No retry, refund or local fallback is allowed after
an ambiguous response. Provider 429s still fail the request; no automatic retry
amplifies an upstream incident.

On denial, planner HTTP reports rate-limit or admission-unavailable and retains
the existing stored-fare fallback. The collector stops the affected month's
collection, records a failed receipt and exits unsuccessfully. Partial writes
remain evidence, but do not masquerade as a successful refresh.

## Configuration and rollout

Both GitHub Actions and Netlify Functions must use the **same**
`RATE_LIMIT_REDIS_REST_URL` and `RATE_LIMIT_REDIS_REST_TOKEN`. A second database,
a preview-specific database or the old UPSTASH variable names will not establish
a shared limit.

The workflow now references those two repository secrets. They were absent on
19 November; secret transfer requires owner approval before merging this workflow
change, otherwise the next collection fails closed. Production configuration is
verified separately against the protected hosted release.

Keys use v2 to separate endpoint policies from the old combined 500/65s gate.
Do not mix old and new production code and claim shared protection. Before the
hosted switch, let any old collection finish; keep site protection; cease old
planner probes and wait at least 65 seconds before testing the new deployment.
Old deploy URLs must remain protected and must not serve planner traffic.

One Redis admission round trip is added to each collector provider attempt.
At 164 attempts/sweep and four sweeps/day this is approximately 656 extra REST
round trips/day (19,680 in 30 days), without increasing fare-provider calls.
This is not a claim about Upstash's billable command accounting or monthly headroom.

## Verification

The test suite uses a disposable real Redis process over a private Unix socket,
with persistence disabled. Mixed collector and three planner instances contend
concurrently: exactly 300 latest-price, 600 dated-price and 60 nearby requests
dispatch; 40 excess attempts per endpoint are refused. Additional tests cover
rolling-window boundaries and expiry, malformed/absent Redis, refusal, outages,
hung connections, late admission, cancellation, cache hits and diagnostic reuse.
CI installs Redis if necessary and refuses to skip these checks.

Provider policy:
https://support.travelpayouts.com/hc/en-us/articles/4402565416594-API-rate-limits
