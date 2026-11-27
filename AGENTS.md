<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Branch lifecycle

Owner decision, 25 November 2026 (replaces the 4 November workflow):

- **One integration branch, `release/v1`.** Branch each piece of work from `release/v1`, not `main`, and target `release/v1` in the PR. Merges into `release/v1` follow the user's authorization for the task.
- **Nothing merges to `main` until the owner says we are launching.** Every merge to `main` is a Netlify production deploy (15 credits each; the Free plan has 300 a month).
- **No production deploys before launch; deploy previews stay on.** Under Netlify's credit pricing a production deploy costs 15 credits and deploy previews cost none (verified against the account's deploy history, 25 November 2026). Verify locally first: production build (`next build` + `next start`), Playwright, Lighthouse, mobile widths and security headers. Use a PR's deploy preview only for what cannot run locally (Netlify rate-limit rules, CDN caching, live headers), and record those checks in `docs/launch-checklist.md`.
- **Credit exhaustion takes the site down.** On the Free plan, using up the month's credits pauses every project ("Site not available") until the next billing cycle; extra credits cannot be bought.
- **Scheduled data still lands on `main`.** Scheduled workflows (for example the ECB rates update) run from and commit to the default branch with `[skip ci]`, so they do not build. Merge `main` into `release/v1` when needed, never the other way.
- Keep unrelated changes out of a PR, and keep commits on `release/v1` reviewable.
- This workflow does not grant standing permission for recurring commits, pushes or merges. Apply the user's authorization for the current task.

After launch (owner decision, 26 November 2026):

- **Netlify Free, off production.** Everything still lands on `release/v1` and is verified on its branch deploy (free). Launch day is one production deploy.
- **Batch fixes.** No merge to `main` for a single small change. Unless something is broken for visitors, changes wait and go out together. Each production deploy costs 15 credits; a rollback to an earlier production deploy costs none.
- **Upgrade only with a reason.** If several fix deploys are genuinely needed, the owner upgrades then.
