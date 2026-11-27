import { collectCostCoverage } from "../src/seo/candidates/cost-coverage";
import { pricePlan } from "../src/domain/pricing";
/** Offline evidence review by default. This command has no publication mechanism. */
import { readFile, readdir, mkdir, writeFile, rename } from "node:fs/promises";
import { parseEnv } from "node:util";
import { seoCandidateRegistry } from "../src/seo/candidates/registry";
import { candidateMarkets } from "../src/seo/candidates/markets";
import {
  readCandidateEvidence,
  deriveResearchObservation,
  evidenceSources,
  type CandidateObservation,
} from "../src/seo/candidates/evidence";
import { evaluateCandidatePublicationReadiness } from "../src/seo/candidates/readiness";
import { validateCandidate } from "../src/seo/candidates/validation";
import { evaluateSeoTrips, seoRequest } from "../src/seo/summary";
import { referenceCalendarDate as referenceToday } from "../src/domain/dates";
import {
  createResearchNetwork,
  type ResearchNetwork,
} from "./research-markets";
import { createTravelpayoutsDiscovery } from "../src/providers/server/travelpayouts";
import {
  uncachedFlightHttp,
  type FlightHttpFactory,
} from "../src/providers/server/flight-http";
import { createTravelProviders } from "../src/providers/server/composition";
import { resolveFlightPricing } from "../src/domain/flight-pricing";
import { getTripTemplates } from "../src/services/travel";
import type { ProviderFetch } from "../src/providers/server/http";

const evidenceDirectory = "docs/seo/evidence/candidates";
export function candidateOptions(args: string[]) {
  if (
    new Set(args).size !== args.length ||
    args.some((a) => !["--live", "--import-phase7b2"].includes(a)) ||
    args.length > 1
  )
    throw Error("invalid candidate option");
  return {
    live: args.includes("--live"),
    importResearch: args.includes("--import-phase7b2"),
  };
}
export async function collectCandidateObservation(
  origin: (typeof candidateMarkets)[number]["slug"],
  token: string | undefined,
  network: ResearchNetwork,
  now: Date,
  timeoutMs = 10000,
  flightHttp: FlightHttpFactory = uncachedFlightHttp,
): Promise<CandidateObservation> {
  const page = seoCandidateRegistry.find(
    (p) => p.key.originId === origin && p.type === "budget",
  )!;
  if (!page) throw Error("unreviewed candidate origin");
  const request = seoRequest(page, referenceToday(now));
  const empty = (
    providerStatus: CandidateObservation["providerStatus"],
  ): CandidateObservation => ({
    origin,
    dateContract: "month-weekends",
    exampleMonth: request.dates.month!,
    observedAt: now.toISOString(),
    currency: request.budget.currency,
    budgetCents: request.budget.cents,
    providerStatus,
    destinationsEvaluated: 0,
    completeProviderDestinations: 0,
    matchingFareCount: 0,
    budgetFits: 0,
    referenceFareCount: 0,
    unpricedCount: 0,
    source: "candidate-live",
    sourceFile: null,
    destinationCoverage: null,
  });
  if (!token?.trim()) return empty("configuration");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<CandidateObservation>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(empty("timeout"));
    }, timeoutMs);
  });
  const boundedFetch: ProviderFetch = (url, options) => {
    controller.signal.throwIfAborted();
    return network.fetch(url, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal,
    });
  };
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const deniedBefore = network.counts.metadataDenied;
        const discovery = await createTravelpayoutsDiscovery(
          token,
          boundedFetch,
          () => now,
          undefined,
          undefined,
          flightHttp(token, boundedFetch),
        ).discover(request, page.origin);
        if (discovery.status !== "available")
          return empty(
            discovery.reason === "timeout"
              ? "timeout"
              : discovery.reason === "rate-limit"
                ? "rate-limit"
                : "provider",
          );
        controller.signal.throwIfAborted();
        const providers = await createTravelProviders(
          { TRAVELPAYOUTS_API_TOKEN: token },
          boundedFetch,
          false,
          request,
        );
        providers.discovery = {
          async discover() {
            return discovery;
          },
        };
        providers.images = {
          async forDestination() {
            throw Error("candidate imagery disabled");
          },
        };
        const search = await getTripTemplates(request, providers);
        const { summary } = evaluateSeoTrips(
          search,
          request,
          now.toISOString(),
        );
        const fares = discovery.value.fares.map((f) =>
          resolveFlightPricing(f, request),
        );
        const status =
          network.counts.metadataDenied > deniedBefore
            ? "metadata-limited"
            : search.issues.length || network.stopped()
              ? "provider"
              : "available";
        return {
          ...empty(status),
          destinationCoverage: collectCostCoverage(
            search.templates.map((t) =>
              pricePlan(t, request, "none", undefined, {
                today: referenceToday(now),
              }),
            ),
          ),
          destinationsEvaluated: summary.destinationsChecked,
          completeProviderDestinations: summary.providerSupportedCount,
          budgetFits: summary.providerSupportedFitsCount,
          matchingFareCount: fares.filter((f) => f.kind === "priced").length,
          referenceFareCount: fares.filter((f) => f.kind === "reference")
            .length,
          unpricedCount: summary.unpricedFlightCount,
        };
      })(),
    ]);
  } catch {
    return empty(controller.signal.aborted ? "timeout" : "provider");
  } finally {
    clearTimeout(timer!);
  }
}
async function history() {
  let files: string[];
  try {
    files = await readdir(evidenceDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return readCandidateEvidence({ version: 2, observations: [] });
    throw error;
  }
  const observations: CandidateObservation[] = [];
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file))
      throw Error("invalid evidence filename");
    const content = await readFile(`${evidenceDirectory}/${file}`, "utf8");
    if (content.length > 1_000_000) throw Error("evidence file too large");
    const data = readCandidateEvidence(JSON.parse(content));
    if (
      data.observations.some((o) => !file.startsWith(o.observedAt.slice(0, 10)))
    )
      throw Error("evidence date mismatch");
    observations.push(...data.observations);
  }
  return readCandidateEvidence({ version: 2, observations });
}
async function persist(newRows: CandidateObservation[]) {
  const previous = await history();
  const merged = readCandidateEvidence({
    version: 2,
    observations: [...previous.observations, ...newRows],
  });
  await mkdir(evidenceDirectory, { recursive: true });
  for (const day of new Set(newRows.map((o) => o.observedAt.slice(0, 10)))) {
    const path = `${evidenceDirectory}/${day}.json`;
    const data = {
      version: 2,
      observations: merged.observations.filter((o) =>
        o.observedAt.startsWith(day),
      ),
    };
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", {
      flag: "wx",
    });
    await rename(temporary, path);
  }
}
async function importResearch() {
  const rows: CandidateObservation[] = [];
  for (const source of evidenceSources) {
    const lines = (await readFile(`docs/seo/evidence/${source}`, "utf8"))
      .trim()
      .split("\n");
    for (const line of lines) {
      const raw = JSON.parse(line);
      if (
        raw.type === "sample" &&
        raw.scenario === "any-sat-mon" &&
        candidateMarkets.some((m) => m.slug === raw.origin)
      )
        rows.push(deriveResearchObservation(raw, source));
    }
  }
  if (rows.length !== 4 || new Set(rows.map((r) => r.origin)).size !== 4)
    throw Error("incomplete research import");
  await persist(rows);
}
async function main() {
  process.env.GOEKSPLO_LOG_LEVEL = "off";
  const options = candidateOptions(process.argv.slice(2));
  const now = new Date(); // The only clock boundary; all requests and evaluations receive it.
  if (options.importResearch) await importResearch();
  if (options.live) {
    let file: Record<string, string | undefined> = {};
    try {
      file = parseEnv(await readFile(".env.local", "utf8"));
    } catch {}
    const token = (
      process.env.TRAVELPAYOUTS_API_TOKEN ?? file.TRAVELPAYOUTS_API_TOKEN
    )?.trim();
    const network = createResearchNetwork(fetch, 200, {
      fares: 4,
      metadata: 40,
    });
    const rows = [];
    for (const market of candidateMarkets)
      rows.push(
        await collectCandidateObservation(market.slug, token, network, now),
      );
    await persist(rows);
    console.log(
      JSON.stringify({
        mode: "live",
        ...network.counts,
        stopped: network.stopped() ?? null,
        maximumFareRequests: 4,
        maximumMetadataRequests: 40,
      }),
    );
  }
  const evidence = await history();
  console.log(
    "Candidate readiness only; no pages published. Observation days use UTC; example month uses the product calendar.",
  );
  for (const page of seoCandidateRegistry) {
    const result = evaluateCandidatePublicationReadiness(
      page,
      seoCandidateRegistry,
      evidence,
      referenceToday(now),
    );
    console.log(JSON.stringify({ candidate: page.path, ...result }));
    if (validateCandidate(page, seoCandidateRegistry).length)
      process.exitCode = 1;
  }
}
if (require.main === module)
  void main().catch(() => {
    console.log(
      "Candidate validation failed: invalid options, evidence or local I/O. No provider details printed.",
    );
    process.exitCode = 1;
  });
