import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { defaultRequestFor } from "../src/domain/request";
import { resolveFlightPricing } from "../src/domain/flight-pricing";
import { pricePlan } from "../src/domain/pricing";
import { locations } from "../src/catalogue/locations";
import type { TravelLocation, TripRequest } from "../src/domain/types";
import { createTravelpayoutsDiscovery } from "../src/providers/server/travelpayouts";
import { createTravelProviders } from "../src/providers/server/composition";
import { getTripTemplates } from "../src/services/travel";
import type { ProviderFetch } from "../src/providers/server/http";
import {
  uncachedFlightHttp,
  type FlightHttp,
} from "../src/providers/server/flight-http";

// Fixed, public test inputs. This diagnostic never accepts free-text URLs or credentials as arguments.
export const pricingDiagnosticRequest: TripRequest = {
  ...defaultRequestFor("2026-10-07"),
  originId: "prishtina",
  origin: locations.find((l) => l.id === "prishtina")!,
  destination: {
    id: "city:WAW",
    type: "city",
    name: "Warsaw",
    cityCode: "WAW",
    iataCodes: ["WAW"],
    countryCode: "PL",
    countryName: { en: "Poland", sq: "Poloni" },
  } satisfies TravelLocation,
  when: "custom",
  nights: 3,
  party: { adults: 2, children: 0 },
  dates: { startDate: "2026-11-20", endDate: "2026-11-23", flexibleDays: 0 },
};
export async function checkPricing(
  token?: string,
  fetcher: ProviderFetch = fetch,
  http: FlightHttp = uncachedFlightHttp(token ?? "", fetcher),
) {
  const request = pricingDiagnosticRequest;
  const discovery = token
    ? await createTravelpayoutsDiscovery(
        token,
        fetcher,
        undefined,
        undefined,
        undefined,
        http,
      ).discover(request, request.origin!)
    : { status: "available" as const, value: { fares: [], diagnostics: [] } };
  const fares =
    discovery.status === "unavailable"
      ? []
      : discovery.value.fares.filter(
          (f) => f.destinationCode === "WAW" || f.destinationAirport === "WAW",
        );
  const states = fares.map((f) => resolveFlightPricing(f, request));
  // Metadata, imagery and AI are not contacted by this diagnostic.
  const providers = await createTravelProviders(
    {},
    async () => Response.json([]),
    false,
    request,
  );
  providers.discovery = {
    async discover() {
      return discovery;
    },
  };
  const search = await getTripTemplates(request, providers);
  const plan = search.templates[0]
    ? pricePlan(search.templates[0], request)
    : undefined;
  return {
    origin: "PRN",
    destination: "WAW",
    departure: request.dates.startDate,
    return: request.dates.endDate,
    state:
      plan?.flightPricing?.kind === "priced"
        ? "matching"
        : plan?.flightPricing?.kind === "reference"
          ? "reference"
          : "unavailable",
    matchingFareCount: states.filter((s) => s.kind === "priced").length,
    referenceFareCount: states.filter((s) => s.kind === "reference").length,
    completeTripPricing:
      plan?.pricingCompleteness === "complete" ? "yes" : "no",
    flightAffordability: plan?.flightAffordability?.status ?? "not-applicable",
    providerStatus: token
      ? discovery.status === "unavailable"
        ? "unavailable"
        : "success"
      : "offline",
  };
}
async function main() {
  process.env.GOEKSPLO_LOG_LEVEL = "off";
  const live = process.argv.slice(2).includes("--live");
  if (process.argv.slice(2).some((arg) => arg !== "--live"))
    throw Error("invalid option");
  let token: string | undefined;
  if (live) {
    let file: Record<string, string | undefined> = {};
    try {
      file = parseEnv(await readFile(".env.local", "utf8"));
    } catch {}
    token = process.env.TRAVELPAYOUTS_API_TOKEN ?? file.TRAVELPAYOUTS_API_TOKEN;
    if (!token?.trim()) {
      console.log(JSON.stringify({ providerStatus: "configuration-missing" }));
      process.exitCode = 1;
      return;
    }
  }
  const report = await checkPricing(token);
  // Defense in depth: even a credential accidentally equal to a safe field is redacted.
  let output = JSON.stringify(report, null, 2);
  if (token)
    for (const variant of new Set([
      token,
      token.trim(),
      encodeURIComponent(token),
      JSON.stringify(token).slice(1, -1),
    ]))
      if (variant) output = output.split(variant).join("[redacted]");
  console.log(output);
}
if (require.main === module)
  void main().catch(() => {
    console.log(JSON.stringify({ providerStatus: "diagnostic-unavailable" }));
    process.exitCode = 1;
  });
