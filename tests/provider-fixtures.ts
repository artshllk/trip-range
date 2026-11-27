import {
  createTravelProviders,
  type ProviderEnvironment,
} from "../src/providers/server/composition";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import type { ProviderFetch } from "../src/providers/server/http";

// Fixture observations are October 6. Keep freshness independent of the CI wall clock.
export const fixtureClock = () => new Date("2026-10-06T09:00:00Z");
export async function createFixtureTravelProviders(
  env: ProviderEnvironment,
  fetcher: ProviderFetch,
) {
  const providers = await createTravelProviders(env, fetcher);
  if (env.TRAVELPAYOUTS_API_TOKEN)
    providers.discovery = createTravelpayoutsDiscovery(
      env.TRAVELPAYOUTS_API_TOKEN,
      fetcher,
      fixtureClock,
    );
  return providers;
}
