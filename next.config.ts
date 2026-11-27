import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import {
  securityHeaders,
  deploymentIndexingHeaders,
} from "./src/config/security";
import {
  startupConfigurationErrors,
  validateEnvironment,
} from "./src/config/environment";
import { netlifyBuildContext } from "./src/config/deployment";
const buildContext = netlifyBuildContext(process.env);
const environment = validateEnvironment(process.env, buildContext);
if (environment.invalid.includes("TEST_FIXTURE_CONFIGURATION"))
  throw Error("Local fixtures are forbidden on deployed environments");
// A misnamed variable stops a deployed build; locally it is printed, not fatal.
for (const message of startupConfigurationErrors(environment)) {
  if (environment.deployed) throw Error(message);
  console.error(`\n⚠ ${message}\n`);
}
const production = environment.production;
const evidenceMode = process.env.TRIP_RANGE_EVIDENCE_MODE ?? "off";
if (!["off", "candidate", "release", "accepted"].includes(evidenceMode))
  throw Error("Unknown evidence mode");
if (evidenceMode !== "off") {
  const releaseIndex = ".evidence-build/delivery.json";
  if (!existsSync(releaseIndex))
    throw Error(
      "Prepare the immutable evidence bundle before enabling its routes.",
    );
  // Verify the four approved pages and the exact two inventories. Reject
  // an older mixed bundle (including extra, unlisted files) in every mode.
  execFileSync("python3", ["scripts/public-evidence/verify-delivery.py", ".evidence-build"], { stdio: "inherit" });
  const published = Boolean(
    JSON.parse(readFileSync(releaseIndex, "utf8")).publishedAt,
  );
  if (
    published !== (evidenceMode !== "candidate") ||
    (evidenceMode === "candidate" && environment.deployed)
  ) {
    throw Error(
      "Unpublished evidence is supported only on a local verification build.",
    );
  }
  if (evidenceMode === "accepted") {
    const report = JSON.parse(
      readFileSync(".evidence-checks/public.json", "utf8"),
    );
    const index = JSON.parse(readFileSync(releaseIndex, "utf8"));
    const manifests = index.files.filter((r: { path: string }) =>
      r.path.endsWith("/manifest.json"),
    );
    if (
      report.passed !== true ||
      report.scope !== "anonymous public host" ||
      manifests.length !== 2 ||
      !manifests.every(
        (r: { path: string; sha256: string }) =>
          report.manifestHashes[r.path.replace(/manifest\.json$/, "")] ===
          r.sha256,
      )
    ) {
      throw Error(
        "The public acceptance record must match both immutable manifests.",
      );
    }
  }
}
const nextConfig: NextConfig = {
  // Next replaces this exact process.env access in the server bundle. Only the
  // nonsecret context is embedded; never add credentials to next.config.env.
  env: {
    GOEKSPLO_NETLIFY_BUILD_CONTEXT: buildContext,
    TRIP_RANGE_EVIDENCE_MODE: evidenceMode,
  },
  outputFileTracingIncludes:
    evidenceMode === "off"
      ? {}
      : {
          "/data/\\[\\[...parts\\]\\]": ["./.evidence-build/**/*"],
          "/methodology": ["./.evidence-build/**/*"],
        },
  poweredByHeader: false,
  experimental: { globalNotFound: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders(production),
          ...deploymentIndexingHeaders(environment.mode),
        ],
      },
      ...(production
        ? [
            {
              source: "/:path*",
              has: [
                {
                  type: "header" as const,
                  key: "x-forwarded-proto",
                  value: "https",
                },
              ],
              headers: [
                { key: "Strict-Transport-Security", value: "max-age=31536000" },
              ],
            },
          ]
        : []),
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
        port: "",
        pathname: "/wikipedia/commons/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "images.pexels.com",
        port: "",
        pathname: "/photos/**",
        search: "",
      },
    ],
    maximumRedirects: 0,
    // AVIF first (about 20% smaller), WebP for browsers without AVIF. Each
    // format is cached separately; the first AVIF request encodes more slowly.
    formats: ["image/avif", "image/webp"],
  },
  async redirects() {
    // English prefix redirects live in src/proxy.ts: Netlify evaluates these
    // rules after the proxy's internal /en rewrite, unlike standalone Next.js.
    return [
      {
        source: "/sq/nga/prishtina/fundjava/nen-300",
        destination: "/plan?origin=prishtina&when=weekend&budget=300",
        permanent: true,
      },
      // 307 until Albanian launches: browsers cache permanent redirects, and
      // these paths are expected to serve Albanian pages later.
      { source: "/sq", destination: "/", permanent: false },
      { source: "/sq/:path*", destination: "/:path*", permanent: false },
    ];
  },
};
export default nextConfig;
