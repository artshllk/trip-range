import { candidateCostCoverage } from "./cost-coverage";
import { destinationCostProfiles } from "../../domain/costs/profiles";
import type { DestinationCostProfile } from "../../domain/costs/types";
import { addDays, isCalendarDate, nightsBetween } from "../../domain/dates";
import { resolveSeoDates } from "../date-contract";
import { readCandidateEvidence, type CandidateObservation } from "./evidence";
import type { SeoCandidateDefinition } from "./registry";
import { validateCandidate } from "./validation";

export type CandidateReadiness = {
  status: "not-ready" | "eligible-for-review";
  observationDays: string[];
  spanDays: number;
  exampleMonth: string;
  minimumComplete: number;
  minimumFits: number;
  minimumReviewedComplete: number;
  minimumReviewedFits: number;
  blockers: string[];
};
/** Eligibility is advice to a human reviewer, never authority to mutate live approval.
 * Review ALL snapshots on the latest seven observed days within fourteen calendar days,
 * for the current next-full-month. Every snapshot must pass, including later failures.
 */
export function evaluateCandidatePublicationReadiness(
  page: SeoCandidateDefinition,
  registry: readonly SeoCandidateDefinition[],
  evidence: unknown,
  today: string,
  profiles: readonly DestinationCostProfile[] = destinationCostProfiles,
): CandidateReadiness {
  if (!isCalendarDate(today)) throw new RangeError("Invalid reference date");
  const exampleMonth = resolveSeoDates(
    { kind: "month-weekends", monthPolicy: "next-full-month" },
    today,
  ).month!;
  const blockers = validateCandidate(page, registry);
  let observations: CandidateObservation[];
  try {
    observations = readCandidateEvidence(evidence).observations;
  } catch {
    observations = [];
    blockers.push("invalid evidence history");
  }
  const originHistory = observations.filter(
    (o) => o.origin === page.key.originId,
  );
  if (originHistory.some((o) => o.observedAt.slice(0, 10) > today))
    blockers.push("future evidence rejected");
  const relevant = originHistory.filter(
    (o) =>
      o.exampleMonth === exampleMonth &&
      o.observedAt.slice(0, 10) >= addDays(today, -13) &&
      o.observedAt.slice(0, 10) <= today,
  );
  const observationDays = [
    ...new Set(relevant.map((o) => o.observedAt.slice(0, 10))),
  ]
    .sort()
    .slice(-7);
  const reviewed = relevant.filter((o) =>
    observationDays.includes(o.observedAt.slice(0, 10)),
  );
  const spanDays = observationDays.length
    ? nightsBetween(
        observationDays[0],
        observationDays[observationDays.length - 1],
      )
    : 0;
  if (observationDays.length < 3)
    blockers.push("fewer than three distinct observation days");
  if (spanDays < 6) blockers.push("observation span below six days");
  if (
    !observationDays.length ||
    nightsBetween(observationDays[observationDays.length - 1], today) > 2
  )
    blockers.push("fresh observation required within two days");
  if (reviewed.some((o) => o.providerStatus !== "available"))
    blockers.push("provider or configuration blocker in reviewed evidence");
  const minimumComplete = reviewed.length
    ? Math.min(...reviewed.map((o) => o.completeProviderDestinations))
    : 0;
  const minimumFits = reviewed.length
    ? Math.min(...reviewed.map((o) => o.budgetFits))
    : 0;
  if (minimumComplete < 3)
    blockers.push(
      "repeated coverage below three complete provider destinations",
    );
  if (page.type === "budget" && minimumFits < 2)
    blockers.push("repeated budget coverage below two provider-supported fits");
  let minimumReviewedComplete = 0,
    minimumReviewedFits = 0;
  try {
    const coverage = reviewed.map((o) =>
      candidateCostCoverage(o, today, profiles),
    );
    if (!coverage.length || coverage.some((c) => !c.available))
      blockers.push("destination cost coverage unavailable in evidence");
    minimumReviewedComplete = coverage.length
      ? Math.min(...coverage.map((c) => c.complete))
      : 0;
    minimumReviewedFits = coverage.length
      ? Math.min(...coverage.map((c) => c.fits))
      : 0;
  } catch {
    blockers.push("invalid destination cost profiles");
  }
  if (minimumReviewedComplete < 3)
    blockers.push(
      "fewer than three repeatedly cost-reviewed provider destinations",
    );
  if (page.type === "budget" && minimumReviewedFits < 2)
    blockers.push("fewer than two repeatedly cost-reviewed provider fits");
  if (page.reviews.dateContract !== "reviewed")
    blockers.push("date contract review pending");
  if (page.reviews.costAssumptions !== "reviewed")
    blockers.push("cost assumption review pending");
  return {
    status: blockers.length ? "not-ready" : "eligible-for-review",
    observationDays,
    spanDays,
    exampleMonth,
    minimumComplete,
    minimumFits,
    minimumReviewedComplete,
    minimumReviewedFits,
    blockers: [...new Set(blockers)],
  };
}
