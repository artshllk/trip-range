# Dependency security gate

Reviewed 19 November 2026. Next.js and eslint-config-next are pinned to **16.4.6**.
Node remains 24; React remains 19.2.7. Compatible lint dependency fixes remove
the minimatch and Zod advisories found by the first full dependency audit.

CI runs `npm run check:dependencies` after `npm ci`, separately from the existing
secret/import-boundary scan. It checks **production and development dependencies**
with npm audit and fails at moderate severity or above. It also reads the public
Next.js repository advisory feed, including every page, because npm had not yet
indexed all seven 3 November vendor notices (including the SVG bypass).

The vendor supplement requires the reviewed 16.4.6 baseline, all seven known
November notices, and evaluates every notice published since 1 November 2026.
Earlier vendor notices were reviewed for this baseline; npm audit checks the full
dependency history. Unknown ranges, missing data, failed lookups and rate limits
fail CI rather than claiming a clean audit. GitHub's read-only workflow token is
used only for public advisory lookup. No provider or environment secrets are used.
There is no automatic suppression or `audit fix --force`.

If CI fails, distinguish an affected locked version from a registry/network
failure. Review the advisory, apply the smallest compatible patch, rerun the
gate and application checks, and record any deliberate exception explicitly.
An unavailable advisory service requires a successful rerun, not skipping the gate.

## Applicability reviewed before patching

The two npm-indexed notices, CVE-2026-119790 and CVE-2026-119351, require
`use cache` combinations absent from the current application. The vendor SVG
notice, CVE-2026-119347, concerns the Next.js image optimizer; the application
uses next/image. Netlify documents delegation to Image CDN, but the actual
protected production deployment still needs routing verification. Do not claim
an exemption based on framework documentation alone.

All seven November notices are fixed by 16.4.5; the approved release is 16.4.6.
The patch is required regardless of the narrower current trigger analysis.

Sources:

- https://github.com/vercel/next.js/releases/tag/v16.4.6
- https://github.com/vercel/next.js/security/advisories
- https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
