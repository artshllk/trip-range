import { getTripTemplates } from "../services/travel";
import { demoProviders } from "../providers/demo";
import type { TripRequest } from "../domain/types";

/** A fixed demo discovery edition; not part of the production provider contract. */
export async function getDemoDiscoveryTemplates(request: TripRequest) {
  return (
    await getTripTemplates({ ...request, originId: "zurich" }, demoProviders)
  ).templates;
}
