/** Offline by default. Explicit bounded live research, never imported by production. */
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import {
  researchMarkets,
  researchCurrency,
  researchOrigin,
  type ResearchMarket,
} from "./research/markets";
import { createTravelpayoutsDiscovery } from "../src/providers/server/travelpayouts";
import {
  uncachedFlightHttp,
  type FlightHttpFactory,
} from "../src/providers/server/flight-http";
import { createTravelProviders } from "../src/providers/server/composition";
import { record, type ProviderFetch } from "../src/providers/server/http";
import { defaultRequest } from "../src/domain/request";
import { addDays, isCalendarDate, weekendsInMonth } from "../src/domain/dates";
import {
  resolveFlightPricing,
  completePlan,
} from "../src/domain/flight-pricing";
import { pricePlan } from "../src/domain/pricing";
import { money } from "../src/domain/budget";
import { getTripTemplates } from "../src/services/travel";
import type { TripRequest, FlightDiscovery } from "../src/domain/types";

export const MAX_FARE_REQUESTS = 90;
export const MAX_METADATA_REQUESTS = 180;
export function sampleRequests(
  market: ResearchMarket,
  month: string,
): TripRequest[] {
  const weekends = weekendsInMonth(month);
  if (weekends.length < 2) throw Error("invalid-month");
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const nextMonth = date.toISOString().slice(0, 7);
  const currency = researchCurrency(market);
  const origin = researchOrigin(market);
  const base = {
    ...defaultRequest,
    origin,
    originId: origin.id,
    when: "custom" as const,
    budget: money(
      (currency.nativeReady ? market.budgetBands[1] : 1000) * 100,
      currency.currency,
    ),
  };
  return [
    { ...base, dates: weekends[0] },
    { ...base, dates: weekends[1] },
    {
      ...base,
      dates: {
        startDate: addDays(weekends[1].startDate, -1),
        endDate: addDays(weekends[1].endDate, -1),
        flexibleDays: 0,
      },
    },
    { ...base, dates: { ...weekends[0], mode: "weekends" as const, month } },
    { ...base, dates: weekendsInMonth(nextMonth)[0] },
  ];
}
export function safeRawMetrics(body: unknown) {
  const rows =
    record(body) && Array.isArray(body.data) ? body.data.slice(0, 100) : [];
  const codes = [
    ...new Set(
      rows.flatMap((row) =>
        record(row) &&
        typeof row.destination === "string" &&
        /^[A-Z]{3}$/.test(row.destination)
          ? [row.destination]
          : [],
      ),
    ),
  ].sort();
  return {
    providerSuccess: record(body) && body.success === true,
    rawFares: rows.length,
    destinationCodes: codes,
    currencyEchoPresent: record(body) && typeof body.currency === "string",
    rowsWithCurrencyEcho: rows.filter(
      (r) => record(r) && typeof r.currency === "string",
    ).length,
  };
}
export type ResearchNetwork = ReturnType<typeof createResearchNetwork>;
export function createResearchNetwork(
  fetcher: ProviderFetch,
  gapMs = 200,
  limits = { fares: MAX_FARE_REQUESTS, metadata: MAX_METADATA_REQUESTS },
) {
  if (
    !Number.isSafeInteger(limits.fares) ||
    limits.fares < 1 ||
    limits.fares > MAX_FARE_REQUESTS ||
    !Number.isSafeInteger(limits.metadata) ||
    limits.metadata < 1 ||
    limits.metadata > MAX_METADATA_REQUESTS
  )
    throw Error("invalid-research-limits");
  const cache = new Map<
    string,
    Promise<{ body: string; status: number; date: string | null }>
  >();
  const counts = {
    fares: 0,
    metadata: 0,
    cacheHits: 0,
    metadataLimitReached: false,
    metadataDenied: 0,
  };
  let stop: "authentication" | "rate-limit" | undefined;
  let queue = Promise.resolve();
  let scheduledFares = 0,
    scheduledMetadata = 0;
  const metrics = new Map<
    string,
    ReturnType<typeof safeRawMetrics> & { httpStatus: number }
  >();
  const boundedFetch: ProviderFetch = async (url, options) => {
    const u = new URL(url);
    const fares =
      u.origin === "https://api.travelpayouts.com" &&
      u.pathname === "/aviasales/v3/prices_for_dates";
    const metadata =
      u.origin === "https://autocomplete.travelpayouts.com" &&
      u.pathname === "/places2";
    if (!fares && !metadata) throw Error("research-network-not-allowed");
    if (u.username || u.password || u.searchParams.has("token"))
      throw Error("unsafe-request");
    let pending = cache.get(url);
    if (pending) counts.cacheHits++;
    else {
      if (stop)
        return new Response(null, {
          status: stop === "authentication" ? 401 : 429,
        });
      if (
        (fares && scheduledFares >= limits.fares) ||
        (metadata && scheduledMetadata >= limits.metadata)
      ) {
        if (metadata) {
          counts.metadataLimitReached = true;
          counts.metadataDenied++;
        }
        return new Response(null, { status: 503 });
      }
      if (fares) scheduledFares++;
      else scheduledMetadata++;
      const turn = queue;
      queue = queue.then(
        () => new Promise<void>((resolve) => setTimeout(resolve, gapMs)),
      );
      pending = (async () => {
        await turn;
        if (stop)
          return {
            body: "{}",
            status: stop === "authentication" ? 401 : 429,
            date: null,
          };
        if (fares) counts.fares++;
        else counts.metadata++;
        const response = await fetcher(url, options);
        if ([401, 403].includes(response.status)) stop = "authentication";
        if (response.status === 429) stop = "rate-limit";
        if (Number(response.headers.get("content-length")) > 2_000_000)
          throw Error("oversized-response");
        const reader = response.body?.getReader();
        if (!reader) throw Error("missing-body");
        const decoder = new TextDecoder();
        let body = "",
          size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2_000_000) {
            await reader.cancel();
            throw Error("oversized-response");
          }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
        if (fares) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = undefined;
          }
          metrics.set(url, {
            httpStatus: response.status,
            ...safeRawMetrics(parsed),
          });
        }
        return {
          body,
          status: response.status,
          date: response.headers.get("date"),
        };
      })();
      cache.set(url, pending);
    }
    const r = await pending;
    return new Response(r.body, {
      status: r.status,
      headers: {
        "content-type": "application/json",
        ...(r.date ? { date: r.date } : {}),
      },
    });
  };
  return { fetch: boundedFetch, counts, metrics, stopped: () => stop };
}

export async function sampleMarket(
  market: ResearchMarket,
  month: string,
  token: string,
  network: ResearchNetwork,
  clock = () => new Date(),
  flightHttp: FlightHttpFactory = uncachedFlightHttp,
) {
  const currency = researchCurrency(market);
  const rows = [];
  for (const [index, request] of sampleRequests(market, month).entries()) {
    if (network.stopped()) break;
    const metadataDeniedBefore = network.counts.metadataDenied;
    let requestUrl = "";
    const sampleFetch: ProviderFetch = (url, options) => {
      requestUrl = url;
      return network.fetch(url, options);
    };
    const discovery = await createTravelpayoutsDiscovery(
      token,
      sampleFetch,
      clock,
      undefined,
      undefined,
      flightHttp(token, sampleFetch),
    ).discover(request, request.origin!);
    const raw = network.metrics.get(requestUrl);
    const value: FlightDiscovery =
      discovery.status === "unavailable"
        ? { fares: [], diagnostics: [] }
        : discovery.value;
    const states = value.fares.map((f) => resolveFlightPricing(f, request));
    const providers = await createTravelProviders(
      { TRAVELPAYOUTS_API_TOKEN: token },
      network.fetch,
      false,
      request,
    );
    providers.discovery = {
      async discover() {
        return discovery;
      },
    };
    // Image enrichment is irrelevant to this coverage study; no image or affiliate/AI API calls.
    providers.images = {
      async forDestination() {
        throw Error("research-images-disabled");
      },
    };
    const search = await getTripTemplates(request, providers);
    const plans = search.templates.map((t) => pricePlan(t, request));
    const flightPlans = plans.filter((p) => p.transportMode === "flight");
    const priced = flightPlans.filter(completePlan);
    const bands = currency.nativeReady
      ? market.budgetBands.map((budget) => {
          const r = {
            ...request,
            budget: money(budget * 100, currency.currency),
          };
          const bandPlans = search.templates.map((t) => pricePlan(t, r));
          const complete = bandPlans.filter(completePlan);
          return {
            budget,
            currency: currency.currency,
            completeFlightFits: complete.filter(
              (p) => p.transportMode === "flight" && p.budget.fit !== "over",
            ).length,
            roadFits: complete.filter(
              (p) => p.transportMode === "road" && p.budget.fit !== "over",
            ).length,
          };
        })
      : [];
    rows.push({
      metadataLimited: network.counts.metadataDenied > metadataDeniedBefore,
      origin: market.id,
      originCode: market.code,
      nativeCurrency: market.nativeCurrency,
      queryCurrency: currency.currency,
      nativePlanningReady: currency.nativeReady,
      purpose: currency.nativeReady
        ? "native-planning"
        : "USD-route-probe-no-native-budget-evaluation",
      scenario: [
        "exact-sat-mon-a",
        "exact-sat-mon-b",
        "exact-fri-sun",
        "any-sat-mon",
        "next-month-exact-sat-mon",
      ][index],
      dates: request.dates,
      apiDatePrecision: "month",
      capturedAt: clock().toISOString(),
      httpStatus: raw?.httpStatus ?? null,
      providerSuccess: raw?.providerSuccess ?? false,
      rawFares: raw?.rawFares ?? 0,
      rawDestinationCodes: raw?.destinationCodes ?? [],
      currencyEchoPresent: raw?.currencyEchoPresent ?? false,
      rowsWithCurrencyEcho: raw?.rowsWithCurrencyEcho ?? 0,
      adapterStatus: discovery.status,
      failure: discovery.status === "unavailable" ? discovery.reason : null,
      normalizedFares: value.fares.length,
      matchingFares: states.filter((s) => s.kind === "priced").length,
      referenceFares: states.filter((s) => s.kind === "reference").length,
      unavailableFares: states.filter((s) => s.kind === "unavailable").length,
      resolvedDynamicDestinations: new Set(
        search.templates
          .filter(
            (t) =>
              t.destination.metadataSource === "travelpayouts-autocomplete",
          )
          .map((t) => t.id),
      ).size,
      evaluatedFlightDestinations: flightPlans.length,
      completeFlightCandidates: currency.nativeReady ? priced.length : null,
      unpricedFlightIdeas: currency.nativeReady
        ? flightPlans.length - priced.length
        : null,
      destinationCountries: [
        ...new Set(flightPlans.map((p) => p.destination.countryCode)),
      ].sort(),
      budgetBands: bands,
    });
  }
  return rows;
}
export function readResearchArgs(args: string[]) {
  if (
    args.some(
      (arg) =>
        arg !== "--live" &&
        !arg.startsWith("--origins=") &&
        !arg.startsWith("--month="),
    )
  )
    throw Error("invalid-option");
  const month =
    args.find((arg) => arg.startsWith("--month="))?.slice(8) ?? "2026-11";
  if (!/^\d{4}-\d{2}$/.test(month) || !isCalendarDate(month + "-01"))
    throw Error("invalid-month");
  const requested = args
    .find((arg) => arg.startsWith("--origins="))
    ?.slice(10)
    .split(",");
  if (
    requested &&
    (new Set(requested).size !== requested.length ||
      requested.some((id) => !researchMarkets.some((m) => m.id === id)))
  )
    throw Error("unreviewed-origin");
  return {
    live: args.includes("--live"),
    month,
    markets: requested
      ? researchMarkets.filter((m) => requested.includes(m.id))
      : researchMarkets,
  };
}
async function main() {
  process.env.GOEKSPLO_LOG_LEVEL = "off";
  const options = readResearchArgs(process.argv.slice(2));
  if (!options.live) {
    console.log(
      JSON.stringify({
        mode: "offline",
        month: options.month,
        origins: options.markets.map((m) => ({
          id: m.id,
          code: m.code,
          nativeCurrency: m.nativeCurrency,
          bands: m.budgetBands,
          ...researchCurrency(m),
        })),
        scenariosPerOrigin: 5,
        maximumFareRequests: Math.min(
          MAX_FARE_REQUESTS,
          options.markets.length * 3,
        ),
        maximumMetadataRequests: MAX_METADATA_REQUESTS,
        paidAiCalls: 0,
        publishesPages: false,
      }),
    );
    return;
  }
  let file: Record<string, string | undefined> = {};
  try {
    file = parseEnv(await readFile(".env.local", "utf8"));
  } catch {}
  const token = (
    process.env.TRAVELPAYOUTS_API_TOKEN ?? file.TRAVELPAYOUTS_API_TOKEN
  )?.trim();
  if (!token) {
    console.log(JSON.stringify({ status: "configuration-missing" }));
    process.exitCode = 1;
    return;
  }
  const emit = (value: unknown) => {
    let safe = JSON.stringify(value);
    for (const secret of [token, encodeURIComponent(token)])
      safe = safe.split(secret).join("[redacted]");
    console.log(safe);
  };
  const network = createResearchNetwork(fetch);
  emit({
    type: "manifest",
    capturedAt: new Date().toISOString(),
    month: options.month,
    originCount: options.markets.length,
    maximumFareRequests: MAX_FARE_REQUESTS,
    maximumMetadataRequests: MAX_METADATA_REQUESTS,
    providerMarket: "us",
    party: { adults: 2, children: 0 },
    nights: 2,
    paidAiCalls: 0,
    publishesPages: false,
  });
  for (const market of options.markets) {
    if (network.stopped()) break;
    for (const row of await sampleMarket(market, options.month, token, network))
      emit({ type: "sample", ...row });
  }
  emit({
    type: "summary",
    completedAt: new Date().toISOString(),
    ...network.counts,
    stopped: network.stopped() ?? null,
  });
}
if (require.main === module)
  void main().catch(() => {
    console.log(JSON.stringify({ status: "research-unavailable" }));
    process.exitCode = 1;
  });
