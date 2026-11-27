import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import semver from "semver";

// All earlier vendor notices were reviewed when choosing 16.4.6. npm audit
// covers the full dependency history; this supplemental feed closes the lag
// between Next.js publishing a notice and npm indexing it.
export const REVIEWED_BEFORE = "2026-11-01T00:00:00Z";
const MINIMUM_NEXT = "16.4.6";
const required = [
  "GHSA-pc58-hwjq-p385", "GHSA-rhh4-g77r-r9qj", "GHSA-vvgp-ww4w-46vf",
  "GHSA-7qx7-33qx-rqx2", "GHSA-mfr8-8qww-v76h", "GHSA-vc7v-qv4w-wrv8",
  "GHSA-f3mh-rxg3-f5g2",
];

export function assessNextAdvisories(version, advisories) {
  if (!semver.valid(version) || semver.lt(version, MINIMUM_NEXT))
    throw Error("Next.js must be at least the reviewed 16.4.6 security baseline");
  if (!Array.isArray(advisories) ||
      required.some((id) => !advisories.some((a) => a?.ghsa_id === id)))
    throw Error("Incomplete Next.js advisory feed");
  const affected = [];
  for (const advisory of advisories) {
    if (!advisory || !Number.isFinite(Date.parse(advisory.published_at)))
      throw Error("Malformed Next.js advisory");
    if (advisory.published_at < REVIEWED_BEFORE) continue;
    if (!["low", "medium", "high", "critical"].includes(advisory.severity) ||
        !Array.isArray(advisory.vulnerabilities))
      throw Error("Malformed Next.js advisory");
    for (const vulnerability of advisory.vulnerabilities) {
      if (vulnerability.package?.ecosystem !== "npm" ||
          vulnerability.package?.name !== "next") continue;
      // GitHub's comma-separated comparator intersections are not npm syntax.
      const range = vulnerability.vulnerable_version_range?.replaceAll(",", " ");
      if (!range || !semver.validRange(range))
        throw Error(`Unrecognized version range in ${advisory.ghsa_id}; review required`);
      if (advisory.severity !== "low" && semver.satisfies(version, range))
        affected.push(advisory.ghsa_id);
    }
  }
  return [...new Set(affected)];
}

export async function fetchNextAdvisories(fetcher = fetch) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const response = await fetcher(
      `https://api.github.com/repos/vercel/next.js/security-advisories?per_page=100&page=${page}`,
      { headers: { Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
        signal: AbortSignal.timeout(15000), redirect: "error" },
    );
    if (!response.ok) throw Error(`Next.js advisory lookup failed (HTTP ${response.status})`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw Error("Malformed Next.js advisory feed");
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  throw Error("Next.js advisory pagination exceeded safety limit");
}

async function main() {
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url)));
  const version = lock.packages?.["node_modules/next"]?.version;
  const advisories = await fetchNextAdvisories();
  const affected = assessNextAdvisories(version, advisories);
  if (affected.length) throw Error(`Next.js ${version} has unpatched advisories: ${affected.join(", ")}`);
  console.log(`Next.js ${version}: vendor advisories checked; no moderate-or-higher findings.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
