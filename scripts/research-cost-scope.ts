/** Explicit cost-research selection against legacy/generic baselines only.
 * Intentionally calls pricePlan without a cost context to preserve that comparison basis.
 * Does not write candidate longitudinal history, reviewed fits or post-change counts. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { candidateMarkets } from "../src/seo/candidates/markets";
import { seoCandidateRegistry } from "../src/seo/candidates/registry";
import { seoRequest } from "../src/seo/summary";
import { referenceCalendarDate } from "../src/domain/dates";
import { pricePlan } from "../src/domain/pricing";
import { chooseDeparturePlans } from "../src/domain/airport-comparison";
import { completePlan, matchingFlight } from "../src/domain/flight-pricing";
import { loadSeoSearch } from "../src/seo/data";
import { createResearchNetwork } from "./research-markets";
async function main() {
  process.env.GOEKSPLO_LOG_LEVEL = "off";
  if (process.argv.slice(2).join(" ") !== "--live") {
    console.log(
      "Cost research only. Use --live for four bounded origin lookups; no longitudinal history or publication changes.",
    );
    return;
  }
  const file = parseEnv(await readFile(".env.local", "utf8").catch(() => ""));
  const token = (
    process.env.TRAVELPAYOUTS_API_TOKEN ?? file.TRAVELPAYOUTS_API_TOKEN
  )?.trim();
  if (!token) throw Error("configuration");
  const now = new Date(),
    today = referenceCalendarDate(now);
  const network = createResearchNetwork(fetch, 200, { fares: 4, metadata: 40 });
  const origins = [];
  for (const market of candidateMarkets) {
    const page = seoCandidateRegistry.find(
      (p) => p.key.originId === market.slug && p.type === "budget",
    )!;
    const request = seoRequest(page, today);
    const data = await loadSeoSearch(
      request,
      { TRAVELPAYOUTS_API_TOKEN: token },
      network.fetch,
    );
    const plans = chooseDeparturePlans(
      data.search.templates.map((t) => pricePlan(t, request)),
    )
      .filter(completePlan)
      .filter((p) => !!matchingFlight(p));
    origins.push({
      origin: market.slug,
      currency: market.budget.currency,
      month: request.dates.month,
      providerState: data.state,
      destinations: plans.map((p) => ({
        id: p.destination.id,
        name: p.destination.name.en,
        country: p.destination.countryCode,
        codes: p.destination.iataCodes,
        fits: p.budget.fit !== "over",
        startDate: p.request.dates.startDate,
        endDate: p.request.dates.endDate,
      })),
    });
  }
  const result = {
    version: 1,
    purpose: "cost-research-selection-not-longitudinal-observation",
    checkedAt: now.toISOString(),
    party: { adults: 2, children: 0 },
    nights: 2,
    maximumFareRequests: 4,
    maximumMetadataRequests: 40,
    requests: network.counts,
    origins,
  };
  await mkdir("docs/seo/evidence/costs", { recursive: true });
  await writeFile(
    `docs/seo/evidence/costs/selection-${today}.json`,
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(result));
}
if (require.main === module)
  void main().catch(() => {
    console.log(
      "Cost research selection unavailable; no private details printed.",
    );
    process.exitCode = 1;
  });
