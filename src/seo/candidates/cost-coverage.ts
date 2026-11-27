import { completePlan, matchingFlight } from "../../domain/flight-pricing";
import { chooseDeparturePlans } from "../../domain/airport-comparison";
import { destinationCostId } from "../../domain/costs/identity";
import {
  activeCostProfile,
  completeCostProfile,
  validateCostProfiles,
} from "../../domain/costs/policy";
import { destinationCostProfiles } from "../../domain/costs/profiles";
import type { DestinationCostProfile } from "../../domain/costs/types";
import type { TripPlan } from "../../domain/types";
import type { CandidateObservation, DestinationCoverage } from "./evidence";

/** Record identities and the actual cost revisions used for each complete calculation, never fares or tracked links. */
export function collectCostCoverage(
  plans: TripPlan[],
): DestinationCoverage | null {
  const complete = chooseDeparturePlans(plans)
    .filter(completePlan)
    .filter((p) => !!matchingFlight(p));
  const completeDestinationIds = complete.map((p) =>
    destinationCostId(p.destination),
  );
  if (
    completeDestinationIds.some((id) => !id) ||
    new Set(completeDestinationIds).size !== complete.length
  )
    return null;
  return {
    completeDestinationIds: completeDestinationIds as string[],
    fitDestinationIds: complete
      .filter((p) => p.budget.fit !== "over")
      .map((p) => destinationCostId(p.destination)!),
    reviewedCosts: complete.flatMap((p) =>
      p.costIntegrity?.status === "reviewed" &&
      p.costIntegrity.profile &&
      p.costIntegrity.reviewedComponents.length === 5
        ? [
            {
              destinationId: destinationCostId(p.destination)!,
              profileId: p.costIntegrity.profile.id,
              revision: p.costIntegrity.profile.revision,
            },
          ]
        : [],
    ),
  };
}
/** A profile added after an observation cannot reprice a generic historical fit retrospectively. */
export function candidateCostCoverage(
  observation: CandidateObservation,
  today: string,
  profiles: readonly DestinationCostProfile[] = destinationCostProfiles,
) {
  validateCostProfiles(profiles);
  const evidence = observation.destinationCoverage;
  if (!evidence)
    return { available: false, complete: 0, fits: 0, missing: [] as string[] };
  const qualifying = evidence.reviewedCosts
    .filter((record) => {
      const current = activeCostProfile(
        record.destinationId,
        observation.currency,
        today,
        profiles,
      );
      const atObservation = activeCostProfile(
        record.destinationId,
        observation.currency,
        observation.observedAt.slice(0, 10),
        profiles,
      );
      return (
        !!current &&
        !!atObservation &&
        completeCostProfile(current) &&
        current.maxNights >= 2 &&
        current.id === record.profileId &&
        current.revision === record.revision
      );
    })
    .map((r) => r.destinationId);
  return {
    available: true,
    complete: qualifying.length,
    fits: evidence.fitDestinationIds.filter((id) => qualifying.includes(id))
      .length,
    missing: evidence.completeDestinationIds.filter(
      (id) => !qualifying.includes(id),
    ),
  };
}
