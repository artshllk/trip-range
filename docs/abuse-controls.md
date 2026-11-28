# Abuse controls

Owner decisions, 25 November 2026. Exhausting Netlify credits pauses every project on the account until the next billing cycle, so a flood of dynamic requests could take the site down for the rest of the month (see [launch checklist](launch-checklist.md#launch-risk-netlify-credits)).

## In place

| Control               | Where                                                         | What it does                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared-read cache     | `src/server/shared-read-cache.ts`, `src/server/fare-store.ts` | The two `/plan` fare-store reads are cached in-process for 5 minutes per origin and date window. Concurrent misses share one read, failures are never cached, and at most 200 entries are kept. Database work no longer grows with traffic. |
| Split affiliate quota | `src/server/rate-limit.ts`                                    | CTA-view beacons (`affiliate-view`, 300 a minute) no longer share the partner-link quota (`affiliate`, 40 a minute).                                                                                                                        |
| Global quotas         | `src/server/rate-limit.ts`                                    | Shared per-operation spend quotas in Upstash, with no identity.                                                                                                                                                                             |

## Option A on a deploy preview: dropped

These were checked on PR #56's preview on 25 November 2026 at 15:40 UTC, from a logged-in browser console.

- **CDN caching of `/plan` does not apply.**
  - Two identical requests both returned `Cache-Status: "Netlify Durable"; fwd=bypass, "Netlify Edge"; fwd=miss`.
  - Netlify's Next.js runtime replaced our `Netlify-Vary` with its own (`query=__nextDataReq|_rsc, …`) and kept `Cache-Control: private, no-store`.
  - That key ignores `/plan`'s own query parameters. Forcing CDN caching of `/plan` through headers is therefore unsafe on this runtime: one URL's page could be served for another.
- **The per-IP edge rules never fired.** 66 requests to `/plan` in 44 seconds and 26 to `/api/health` in 5 seconds all returned 200. The reason (preview, team login, or routing) is unknown, so they cannot be verified before launch.
- **No 5xx responses** came through either edge function.

The CDN headers and both edge functions were removed. The owner chose option B instead.

## Option B: our own per-client limiter (built; awaiting its database and preview checks)

The limiter runs in `src/proxy.ts`, which Netlify runs at its edge, before any page renders. It keys each client on a keyed hash of the client IP, using a secret that rotates daily, and counts requests in a 60-second window. Thresholds: 60 a minute on `/plan`, 20 on `/api/*`, and 60 on the card-view beacon `/api/affiliate/event`, which has its own counter (see below). The privacy notice changes first, with the owner-approved wording:

> To stop excessive requests, we turn your IP address into a short code using a secret key that changes every day. We count requests against that code for 60 seconds and then discard it. We do not store your IP address.

**Approved design (owner, 25 November 2026).** The limiter must never take down what it protects:

1. **One Upstash database, shared with the existing limiter. Settled; do not revisit** (owner decision, 26 November 2026). Per-client counters use their own key prefix (`…:client:…`). See "Why one database" below.
2. **Local deny cache:** once Redis reports a client over the limit, the instance refuses that client from memory until the window ends, without calling Redis.
3. **Per-instance Redis budget:** above about 1,000 limiter calls a minute, an instance counts in memory only for the rest of that minute. This bounds spend under a flood from many addresses.
4. **Fail open:** if Redis errors, times out (150 ms) or is out of budget, requests go through. A defence that takes the site down is worse than none.
5. **About one Redis command per request:** a per-window counter key, incremented once, with the expiry set only on its first increment.

**Why one database (owner decision, 26 November 2026; settled).** A separate limiter database was approved on 25 November so that a flood on the limiter could not use up the shared database and stop fare collection. That reasoning was wrong, because Netlify runs out first. On the Free plan the month's credits run out first. A flood takes the whole site offline through Netlify credit exhaustion long before Redis spend matters, so the shared-fate risk cannot realistically bite first. A second database adds configuration and a second budget, and protects nothing. PR #63, which restored it, was closed unmerged. Revisit only if the hosting changes so that requests stop being the binding cost, for example a paid Netlify plan or Cloudflare.

**Remaining exposure.** Failing open means a sustained flood is still served, and every response, including a 429, counts as a Netlify web request. Netlify credits therefore remain the exposure under a sustained flood. The fix for that is a paid Netlify plan or moving to Cloudflare, not this work.

**Client address: verified on PR #60's deploy preview (25 November 2026).**

- `x-nf-client-connection-ip` does not reach the proxy. Only `x-forwarded-for` carries an address.
- Netlify appends the connecting address as the **last** `x-forwarded-for` entry; everything before it is whatever the client sent. With 0, 1, 2, 3 and 10 spoofed entries (IPv4 and IPv6, a trailing comma, a value with a port), each sent twice, the real address was last every time and the count was always spoofs + 1.
- Not yet observed: an IPv4 client (the owner's connection is IPv6), and that the last entry is the visitor's own address rather than a shared Netlify hop. Check 5 of the preview script closes both: a phone on mobile data must still load `/plan` while the laptop is refused.

**How it keys a client** (`src/server/client-limit.ts`):

- The last `x-forwarded-for` entry only. IPv4 in full (not /24, so carrier and office users behind neighbouring addresses are not grouped). IPv6 by its /64 prefix, since one household or device usually holds a whole /64. IPv4-mapped IPv6 counts as the IPv4 address.
- The key is an HMAC of that value with a key derived each UTC day from `CLIENT_LIMIT_SECRET`, truncated to 16 characters. Neither the address nor the code is logged.
- A missing or unparseable last entry: the request is served, and the instance logs `no-client-address` (at most once a minute, with the previous minute's count; no identifier).

**Redis commands.** Upstash bills `EVAL` as one command plus one per Redis call inside the script, so the existing limiter's script costs two to three. This limiter sends a plain `INCR` on a per-window key, plus `PEXPIRE 60000` only on a client's first increment in the window: about one command per request. If the expiry call fails, the instance retries it on that client's next request. A key whose expiry is never set holds only a day-scoped code that cannot be linked to an address once the day's key is gone, but it would not be discarded after 60 seconds as the notice says. Check for such keys (`TTL` of -1) after the preview run.

**Card-view beacons get their own counter (owner-approved, 25 November 2026).** A results page fires up to six `cta_view` beacons, and location search sends a request per pause in typing. A visitor running three searches in a minute would pass 20 and then be refused on `/api/affiliate/flights`, the booking link. Beacons therefore count separately, at 60 a minute. All other API routes keep 20. The beacon route is still behind its shared quota (`affiliate-view`, 300 a minute).

**Configuration.** `CLIENT_LIMIT_SECRET` (at least 32 characters, e.g. `openssl rand -base64 48`), plus the existing `RATE_LIMIT_REDIS_REST_URL` and `RATE_LIMIT_REDIS_REST_TOKEN`. Without a valid secret or a limiter database, the per-client limiter is off and requests are served. A malformed secret is reported as `CLIENT_LIMIT_SECRET` in the environment check. When off, each instance logs why once a minute: `no-secret` (missing or invalid `CLIENT_LIMIT_SECRET`) or `no-database` (no `RATE_LIMIT_REDIS_REST_*` in that deploy context; on 26 November 2026 deploy previews had none until the owner added them).

**Responses.** A refused `/plan` request gets a plain-text 429; an API request gets `{"status":"rate-limited"}`. Both carry `Cache-Control: no-store` and `Retry-After` with the seconds left in the window.

## Failure policy: what happens when a dependency is unavailable

Owner decision, 26 November 2026: **a dependency being unavailable must never stop a visitor using the site.** "Unavailable" means Redis errors, times out, returns something malformed, is unreachable, or the deployment's limiter configuration is missing or invalid (including a missing runtime `GOEKSPLO_NETLIFY_CONTEXT`). A real "over quota" answer from Redis still refuses.

**The rule (owner, 26 November 2026).** One test decides every control:

- **Fail open when the only cost is our own degraded service.**
- **Fail closed when failing open spends money we cannot cap, risks a partner cutting us off, or risks filling the database.** (Third case added by the owner, 28 November 2026.)

Provider admission (a partner cut-off risk: Travelpayouts can block the token), the AI calls (uncapped spend: OpenAI charges per call) and the collector's storage stop (filling the database: once Neon's limit is reached, writes fail, and losing a sweep is recoverable where a full database is not) are the only three controls that meet the second test today. They are applications of this rule, not one-offs. Any future exception must meet the same test, and its row in the table below must say which half of it applies.

| Control                                                                                                    | Guards                                                          | When the dependency is unavailable                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-client limiter (`src/proxy.ts`)                                                                        | `/plan`, `/api/*`                                               | Fails open: the request is served.                                                                                                                                                                                                                                                                                                                                                                   |
| Shared quotas (`allowOperation`): `locations`, `affiliate`, `affiliate-view`, `search`, `editorial-images` | City search, booking link, view beacons, search and SEO lookups | Fails open to memory: counted per server instance with the same limits, and logged as `configuration` or the Redis failure reason. `/api/ready` still lists `distributed-rate-limit`.                                                                                                                                                                                                                |
| Shared quotas: `ai-intent`, `ai-explanations`                                                              | OpenAI calls                                                    | **Fails closed: uncapped spend.** Paid per OpenAI call, and this counter is the only spend control. AI is off at launch, so no visitor is affected.                                                                                                                                                                                                                                                  |
| Provider admission (`src/server/provider-admission.ts`)                                                    | Every Travelpayouts call, planner and collector                 | **Fails closed: partner cut-off risk.** It is the one counter that keeps all instances and the collector inside Travelpayouts' per-minute limits, and per-instance counts cannot coordinate that. Exceeding them risks the token being blocked, which would stop everything. The visitor still gets a working site: `/plan` runs on stored fares, and only live lookups on results pages go missing. |
| Collection storage stop (`collectionGate`, `scripts/check-storage.ts`)                                     | Fare collector writes, before each origin-month                 | **Fails closed: risks filling the database.** If storage or its limit cannot be measured, the collector starts no new month in that run, as if storage were above 900 MiB. Clean-up still runs and the next run measures again. Visitors are unaffected: `/plan` runs on stored fares.                                                                                                               |
| Startup guard (`next.config.ts`)                                                                           | Misnamed Redis variables                                        | Stops a _deployed build_, never a visitor request.                                                                                                                                                                                                                                                                                                                                                   |

The live Redis diagnostic (`npm run check:rate-limit -- --live`) never falls back to memory, so a broken Redis cannot pass it.

**Why the deploy previews refused before 26 November.** Deploy previews had no runtime `GOEKSPLO_NETLIFY_CONTEXT`, so the app saw an invalid deployment and every shared quota refused. The owner added the value for Deploy Previews on 26 November. Under this policy, the same mistake now degrades to per-instance counts instead of refusing visitors.
