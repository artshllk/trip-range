/** Offline public-launch assessment. Success in non-strict mode means inspection completed, not ready. */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { validateEnvironment } from "../.seo-build/src/config/environment.js";
import {
  launchReadiness,
  legalPlaceholderReport,
  productionVerificationExitCode,
} from "../.seo-build/src/config/readiness.js";
import { checkSecurity } from "./check-security.mjs";
export function productionReport(env, { buildPresent, securityPassed }) {
  const report = launchReadiness(validateEnvironment(env));
  const configuration = [
    ...report.configuration,
    ...(!buildPresent ? ["production-build-missing"] : []),
    ...(!securityPassed ? ["current-tree-security"] : []),
  ];
  return {
    ...report,
    ready: report.ready && configuration.length === 0,
    configuration,
    buildPresent,
    security: securityPassed ? "passed" : "failed",
    legal: legalPlaceholderReport(),
    externalChecks: "not-run",
    historyAudit: "separate-offline-command-required",
  };
}
if (process.argv[1]?.endsWith("verify-production.mjs")) {
  try {
    if (process.argv.slice(2).some((a) => a !== "--strict"))
      throw Error("Unsupported option");
    let local = {};
    try {
      local = parseEnv(readFileSync(".env.local", "utf8"));
    } catch {}
    let buildPresent = false;
    try {
      buildPresent = !!readFileSync(".next/BUILD_ID", "utf8").trim();
    } catch {}
    const report = productionReport(
      { ...local, ...process.env },
      {
        buildPresent,
        securityPassed: checkSecurity({ bundles: true }).length === 0,
      },
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = productionVerificationExitCode(
      report,
      process.argv.includes("--strict"),
    );
  } catch {
    console.log(
      JSON.stringify({
        ready: false,
        configuration: ["verification-unavailable"],
        manual: ["launch-review-required"],
      }),
    );
    process.exitCode = 1;
  }
}
