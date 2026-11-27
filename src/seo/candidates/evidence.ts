import { isCalendarDate } from "../../domain/dates";
import type { CurrencyCode } from "../../domain/money/currency";
import { candidateMarkets, type CandidateOrigin } from "./markets";

export const evidenceSources = [
  "provider-pilot-2026-10-08.jsonl",
  "provider-europe-2026-10-08.jsonl",
  "provider-americas-2026-10-08.jsonl",
] as const;
export type DestinationCoverage = {
  completeDestinationIds: string[];
  fitDestinationIds: string[];
  reviewedCosts: {
    destinationId: string;
    profileId: string;
    revision: string;
  }[];
};
export type CandidateObservation = {
  destinationCoverage: DestinationCoverage | null;
  origin: CandidateOrigin;
  dateContract: "month-weekends";
  exampleMonth: string;
  observedAt: string;
  currency: CurrencyCode;
  budgetCents: number;
  providerStatus:
    | "available"
    | "configuration"
    | "provider"
    | "timeout"
    | "rate-limit"
    | "metadata-limited";
  destinationsEvaluated: number;
  completeProviderDestinations: number;
  matchingFareCount: number;
  budgetFits: number;
  referenceFareCount: number;
  unpricedCount: number;
  source: "phase7b2-research" | "candidate-live";
  sourceFile: (typeof evidenceSources)[number] | null;
};
export type CandidateEvidence = {
  version: 2;
  observations: CandidateObservation[];
};
const fields: readonly (keyof CandidateObservation)[] = [
  "origin",
  "dateContract",
  "exampleMonth",
  "observedAt",
  "currency",
  "budgetCents",
  "providerStatus",
  "destinationsEvaluated",
  "completeProviderDestinations",
  "matchingFareCount",
  "budgetFits",
  "referenceFareCount",
  "unpricedCount",
  "source",
  "sourceFile",
];
const counts: readonly (keyof CandidateObservation)[] = [
  "destinationsEvaluated",
  "completeProviderDestinations",
  "matchingFareCount",
  "budgetFits",
  "referenceFareCount",
  "unpricedCount",
];
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function invalid(): never {
  throw new Error("invalid candidate evidence");
}
function readDestinationCoverage(
  value: unknown,
  complete: number,
  fits: number,
): DestinationCoverage | null {
  if (value === null) return null;
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !==
      "completeDestinationIds,fitDestinationIds,reviewedCosts"
  )
    return invalid();
  const validIds = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.length <= 100 &&
    v.every((id) => typeof id === "string" && /^city:[A-Z]{3}$/.test(id)) &&
    new Set(v).size === v.length;
  if (
    !validIds(value.completeDestinationIds) ||
    !validIds(value.fitDestinationIds) ||
    value.completeDestinationIds.length !== complete ||
    value.fitDestinationIds.length !== fits ||
    value.fitDestinationIds.some(
      (id) => !(value.completeDestinationIds as string[]).includes(id),
    ) ||
    !Array.isArray(value.reviewedCosts)
  )
    return invalid();
  const ids = value.completeDestinationIds;
  const reviewedCosts = value.reviewedCosts.map((v) => {
    if (
      !record(v) ||
      Object.keys(v).sort().join(",") !== "destinationId,profileId,revision" ||
      typeof v.destinationId !== "string" ||
      !ids.includes(v.destinationId) ||
      typeof v.profileId !== "string" ||
      !/^[a-z0-9-]{1,80}$/.test(v.profileId) ||
      !isCalendarDate(v.revision)
    )
      return invalid();
    return {
      destinationId: v.destinationId,
      profileId: v.profileId,
      revision: v.revision,
    };
  });
  if (
    new Set(reviewedCosts.map((r) => r.destinationId)).size !==
    reviewedCosts.length
  )
    return invalid();
  return {
    completeDestinationIds: [...ids].sort(),
    fitDestinationIds: [...value.fitDestinationIds].sort(),
    reviewedCosts: reviewedCosts.sort((a, b) =>
      a.destinationId.localeCompare(b.destinationId),
    ),
  };
}
/** Strict allowlist boundary: unknown fields, raw provider data and free-text reasons are rejected. */
export function readCandidateEvidence(value: unknown): CandidateEvidence {
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !== "observations,version" ||
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.observations) ||
    value.observations.length > 1000
  )
    return invalid();
  const observations = value.observations.map((raw): CandidateObservation => {
    if (
      !record(raw) ||
      Object.keys(raw).sort().join(",") !==
        [...fields, ...(value.version === 2 ? ["destinationCoverage"] : [])]
          .sort()
          .join(",")
    )
      return invalid();
    const market = candidateMarkets.find((m) => m.slug === raw.origin);
    if (
      !market ||
      raw.currency !== market.budget.currency ||
      raw.budgetCents !== market.budget.cents ||
      raw.dateContract !== "month-weekends" ||
      typeof raw.exampleMonth !== "string" ||
      !/^\d{4}-\d{2}$/.test(raw.exampleMonth) ||
      !isCalendarDate(raw.exampleMonth + "-01") ||
      typeof raw.observedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.observedAt) ||
      !Number.isFinite(Date.parse(raw.observedAt)) ||
      new Date(raw.observedAt).toISOString() !== raw.observedAt ||
      ![
        "available",
        "configuration",
        "provider",
        "timeout",
        "rate-limit",
        "metadata-limited",
      ].includes(String(raw.providerStatus)) ||
      counts.some(
        (key) =>
          !Number.isSafeInteger(raw[key]) ||
          Number(raw[key]) < 0 ||
          Number(raw[key]) > 10000,
      ) ||
      Number(raw.completeProviderDestinations) >
        Number(raw.destinationsEvaluated) ||
      Number(raw.completeProviderDestinations) >
        Number(raw.matchingFareCount) ||
      Number(raw.budgetFits) > Number(raw.completeProviderDestinations) ||
      Number(raw.unpricedCount) + Number(raw.completeProviderDestinations) !==
        Number(raw.destinationsEvaluated)
    )
      return invalid();
    if (raw.source === "phase7b2-research") {
      const expectedFile =
        market.slug === "manchester"
          ? evidenceSources[1]
          : market.slug === "chicago"
            ? evidenceSources[2]
            : evidenceSources[0];
      if (
        raw.sourceFile !== expectedFile ||
        !raw.observedAt.startsWith("2026-10-08T") ||
        raw.exampleMonth !== "2026-11"
      )
        return invalid();
    } else if (raw.source !== "candidate-live" || raw.sourceFile !== null)
      return invalid();
    // Reconstruct in stable field order before duplicate comparison or storage.
    const destinationCoverage =
      value.version === 1
        ? null
        : readDestinationCoverage(
            raw.destinationCoverage,
            Number(raw.completeProviderDestinations),
            Number(raw.budgetFits),
          );
    if (raw.source === "phase7b2-research" && destinationCoverage !== null)
      return invalid();
    return {
      ...Object.fromEntries(fields.map((key) => [key, raw[key]])),
      destinationCoverage,
    } as CandidateObservation;
  });
  const unique = new Map<string, CandidateObservation>();
  for (const observation of observations) {
    const key = `${observation.origin}:${observation.observedAt}`;
    const previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(observation))
      return invalid();
    unique.set(key, observation);
  }
  return {
    version: 2,
    observations: [...unique.values()].sort(
      (a, b) =>
        a.observedAt.localeCompare(b.observedAt) ||
        a.origin.localeCompare(b.origin),
    ),
  };
}

/** Convert the original bounded research, preserving its timestamp and raw-fare count semantics. */
export function deriveResearchObservation(
  raw: unknown,
  sourceFile: (typeof evidenceSources)[number],
): CandidateObservation {
  if (
    !record(raw) ||
    !record(raw.dates) ||
    raw.type !== "sample" ||
    raw.scenario !== "any-sat-mon" ||
    raw.dates.mode !== "weekends" ||
    raw.dates.month !== "2026-11" ||
    raw.dates.startDate !== "2026-11-07" ||
    raw.dates.endDate !== "2026-11-09" ||
    raw.dates.flexibleDays !== 0 ||
    raw.nativePlanningReady !== true ||
    raw.purpose !== "native-planning" ||
    raw.metadataLimited !== false ||
    raw.httpStatus !== 200 ||
    raw.providerSuccess !== true ||
    raw.adapterStatus !== "available" ||
    raw.failure !== null ||
    !Array.isArray(raw.budgetBands)
  )
    return invalid();
  const market = candidateMarkets.find((m) => m.slug === raw.origin);
  if (
    !market ||
    raw.originCode !== market.origin.cityCode ||
    raw.nativeCurrency !== market.budget.currency ||
    raw.queryCurrency !== market.budget.currency
  )
    return invalid();
  const band = raw.budgetBands.find(
    (b: unknown) =>
      record(b) &&
      b.budget === market.budget.cents / 100 &&
      b.currency === market.budget.currency,
  );
  if (!record(band) || band.roadFits !== 0) return invalid();
  return readCandidateEvidence({
    version: 1,
    observations: [
      {
        origin: market.slug,
        dateContract: "month-weekends",
        exampleMonth: raw.dates.month,
        observedAt: raw.capturedAt,
        currency: market.budget.currency,
        budgetCents: market.budget.cents,
        providerStatus: "available",
        destinationsEvaluated: raw.evaluatedFlightDestinations,
        completeProviderDestinations: raw.completeFlightCandidates,
        matchingFareCount: raw.matchingFares,
        budgetFits: band.completeFlightFits,
        referenceFareCount: raw.referenceFares,
        unpricedCount: raw.unpricedFlightIdeas,
        source: "phase7b2-research",
        sourceFile,
      },
    ],
  }).observations[0];
}
