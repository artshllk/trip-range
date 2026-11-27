import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { addDays } from "../src/domain/dates";
import {
  aviasalesSearchUrl,
  createAviasalesAffiliate,
  type AffiliateDiagnostic,
} from "../src/providers/server/aviasales-affiliate";
import type { AffiliateEnvironment } from "../src/providers/server/environment";
import type { ProviderFetch } from "../src/providers/server/http";

/** One conversion through the production adapter. Only this allowlisted report may be printed. */
export async function checkAffiliate(
  env: AffiliateEnvironment,
  fetcher: ProviderFetch = fetch,
  now = new Date(),
  timeoutMs = 3000,
) {
  const today = now.toISOString().slice(0, 10);
  const route = {
    originCode: "PRN",
    destinationCode: "VIE",
    departureDate: addDays(today, 30),
    returnDate: addDays(today, 33),
    party: { adults: 1, children: 0 },
  };
  const status: Omit<AffiliateDiagnostic, "httpStatus"> & {
    httpStatus: number | null;
  } = {
    httpStatus: null,
    providerCode: null,
    providerStatus: null,
    linkCode: null,
    validationReason: null,
    partnerLinkHost: null,
    partnerPathShape: null,
  };
  const observe = (event: AffiliateDiagnostic) => Object.assign(status, event);
  const result = await createAviasalesAffiliate(
    env,
    fetcher,
    () => today,
    timeoutMs,
    observe,
  ).createLink(route, "trip");
  return {
    configurationPresent: {
      token: env.TRAVELPAYOUTS_API_TOKEN?.trim() ? "yes" : "no",
      project: env.TRAVELPAYOUTS_PROJECT_ID?.trim() ? "yes" : "no",
      marker: env.TRAVELPAYOUTS_MARKER?.trim() ? "yes" : "no",
    },
    destinationUrl: aviasalesSearchUrl(route, today)!,
    httpStatus: status.httpStatus,
    providerCode: status.providerCode,
    providerStatus: status.providerStatus,
    linkCode: status.linkCode,
    adapterStatus: result.status,
    failureReason:
      result.status === "unavailable"
        ? (status.validationReason ?? result.reason)
        : null,
    partnerLinkHost: status.partnerLinkHost,
    partnerPathShape: status.partnerPathShape,
  };
}
export function formatAffiliateReport(
  report: Awaited<ReturnType<typeof checkAffiliate>>,
  env: AffiliateEnvironment,
) {
  let output = JSON.stringify(report, null, 2);
  // Defense in depth if a configured value happens to match an otherwise safe report field.
  for (const secret of Object.values(env)) {
    if (!secret) continue;
    for (const variant of new Set([
      secret,
      secret.trim(),
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
    ]))
      if (variant) output = output.split(variant).join("[redacted]");
  }
  return output;
}
export async function main() {
  let file: Record<string, string | undefined> = {};
  try {
    file = parseEnv(
      await readFile(resolve(process.cwd(), ".env.local"), "utf8"),
    );
  } catch {
    /* Missing file uses configured process values or the no-configuration report. */
  }
  const env: AffiliateEnvironment = {
    TRAVELPAYOUTS_API_TOKEN:
      process.env.TRAVELPAYOUTS_API_TOKEN ?? file.TRAVELPAYOUTS_API_TOKEN,
    TRAVELPAYOUTS_PROJECT_ID:
      process.env.TRAVELPAYOUTS_PROJECT_ID ?? file.TRAVELPAYOUTS_PROJECT_ID,
    TRAVELPAYOUTS_MARKER:
      process.env.TRAVELPAYOUTS_MARKER ?? file.TRAVELPAYOUTS_MARKER,
  };
  const report = await checkAffiliate(env);
  console.log(formatAffiliateReport(report, env));
  if (report.failureReason) process.exitCode = 1;
}
if (require.main === module)
  void main().catch(() => {
    // No exception, stack, headers or provider body can escape through the CLI.
    console.log(JSON.stringify({ failureReason: "diagnostic-unavailable" }));
    process.exitCode = 1;
  });
