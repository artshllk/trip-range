# Cloudflare Workers migration: findings (on hold)

Status: **on hold (2026-10-28). Do not start.** Moving to Workers means Workers Paid ($5/month)
because of the CPU limit below, which makes it a launch decision. Fare collection does
not wait for it: it runs from GitHub Actions (`.github/workflows/fare-warm.yml`).

## ⚠ Requirement: a shared cache (R2), or the card/trip-page fare match breaks

The flight provider cache (`src/providers/server/flight-http.ts`, `unstable_cache`, 30
minutes) is what makes a trip page show **the same fare as the card that linked to it**
(`sharedResultTemplate` reuses the results search, and the identical provider URLs are
served from this cache). It also saves provider quota: 18 trip pages made 0 provider
calls in the 2026-10-27 sweep.

On Workers, `unstable_cache` is only shared across requests if OpenNext is given an
**incremental cache**. Without it, each isolate has its own cache, so:

- a trip page can refetch and select a different fare than its card (the Basel and
  Düsseldorf mismatches return);
- provider calls multiply.

**Required configuration:**

- an **R2** incremental cache (binding `NEXT_INC_CACHE_R2_BUCKET`), with the Durable
  Object queue;
- a tag cache (D1 or Durable Object) only if `revalidateTag` or `revalidatePath` are
  introduced (they are not used today);
- **not KV:** OpenNext advises against it because it is eventually consistent and can
  keep stale entries indefinitely;
- a test that a results page and its trip page, served by different isolates, return the
  same fare.

## Measured and verified

| Question            | Finding                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bundle size         | Built `main` (`7019900`) with `@opennextjs/cloudflare` 1.20.13 (supports `next >= 16.4.1`; we run 16.4.1), no code changes. `wrangler deploy --dry-run`: **9.4 MiB uncompressed, 2.0 MiB gzip**. The limit is now **64 MiB uncompressed on Free and Paid**: Cloudflare removed the 3 MB / 10 MB compressed limits on 2026-09-04. Static assets (24 MB) are served separately. **Not a blocker.** |
| CPU time            | **Free: 10 ms per HTTP request and per Cron run.** Paid: 30 s per request (up to 5 min), and 15 min for Cron intervals of an hour or more. A results page (pricing, ranking, six cards, React render) will not fit in 10 ms. **This forces Workers Paid.** Not measured per request yet.                                                                                                         |
| Other Free limits   | 5 Cron Triggers, 50 subrequests per request, 6 simultaneous outgoing connections, 100,000 requests per day, 128 MB memory, 1 s startup.                                                                                                                                                                                                                                                          |
| Neon                | No change. The code uses `neon()` over HTTP plus `sql.transaction([...])`, Neon's recommended path on Workers without Hyperdrive. Hyperdrive would need a TCP driver (node-postgres or postgres.js) for pooling we do not need at this volume.                                                                                                                                                   |
| Warm job            | Not needed on Workers now (GitHub Actions). If it moves later: OpenNext's generated worker only exports `fetch`, so a custom worker entry adds `scheduled()` with `triggers.crons`, calling the route internally (not over the public network, so Access does not block it). Needs Paid for CPU.                                                                                                 |
| Password protection | **Cloudflare Access** on the Worker protects its custom domain, `workers.dev` hostname and preview URLs. Use one-time PIN login **restricted to an email list** (an unrestricted PIN rule lets anyone with an email in). Validate `Cf-Access-Jwt-Assertion` if Access is configured from the Worker. Free seat limit not confirmed.                                                              |
| Images              | `next/image` optimisation needs a Cloudflare Images binding or `unoptimized`. Cloudflare Images pricing not checked.                                                                                                                                                                                                                                                                             |

## Netlify-specific items to replace

1. `netlify.toml`: build command, Node version, and `GOEKSPLO_NETLIFY_CONTEXT` per context.
   Replaced by `wrangler.jsonc` and `open-next.config.ts`.
2. `netlify/functions/fare-warm.mts` and its use of Netlify's `URL`. Superseded by
   GitHub Actions; remove when Netlify is disconnected.
3. `src/config/deployment.ts` (`deploymentMode`, `netlifyBuildContext`),
   `src/config/environment.ts`, `src/providers/server/environment.ts`. Only Netlify and
   Vercel are recognised. On Workers the app would treat itself as `local`, which
   changes rate limiting and production checks. Needs an explicit Cloudflare context
   variable per environment.
4. `next.config.ts`: `netlifyBuildContext` and `GOEKSPLO_NETLIFY_BUILD_CONTEXT`.
5. Shared cache: see the requirement above.
6. Images: see the table.
7. `tests/netlify.test.ts` and `scripts/verify-netlify-{browser,local,package}.mjs`.
8. `.netlify` ignore entries in `.gitignore`, `eslint.config.mjs` and `tsconfig.json`.
9. Comments only: `src/services/affiliate-handoff.ts`, `FlightAffiliateCTA.tsx`, the
   fare-warm route, migration `0002`, `docs/phase7c3-netlify-free-poc.md`.
10. Outside the repo:
    - the Netlify password, replaced by Access;
    - deploy previews, replaced by Worker preview URLs;
    - Netlify env vars, replaced by Worker secrets (unlike Netlify, those apply to the
      next deploy without a rebuild);
    - the `www.trip-range.com` CNAME, which points to Netlify.

**Moves unchanged:** headers and redirects (`next.config.ts`), Upstash Redis (HTTP), and
the Neon driver.

Keep Netlify connected until Cloudflare serves the site correctly.

## Sources

- Workers limits: https://developers.cloudflare.com/workers/platform/limits/ (updated 2026-10-12)
- Size limit change: https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/
- OpenNext caching: https://opennext.js.org/cloudflare/caching
- OpenNext custom worker: https://opennext.js.org/cloudflare/howtos/custom-worker
- Neon on Workers: https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/
- Access on Workers: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
