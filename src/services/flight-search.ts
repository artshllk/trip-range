import type { DepartureAirportCandidate } from "../domain/airports";
import type { FlightQueryPlan } from "../domain/flight-query";
import type { FlightDiscovery, TripRequest } from "../domain/types";
import type {
  FlightDiscoveryProvider,
  ProviderResult,
} from "../providers/contracts";

export const FLIGHT_SEARCH_CONCURRENCY = 3;
export const FLIGHT_SEARCH_BUDGET_MS = 4500;
/** Selected departure's targets first. One shared deadline prevents N × timeout waterfalls. */
export async function searchFlightPlan(
  provider: FlightDiscoveryProvider,
  request: TripRequest,
  departures: DepartureAirportCandidate[],
  plan: FlightQueryPlan,
  budgetMs = FLIGHT_SEARCH_BUDGET_MS,
) {
  const tasks = departures
    .slice(0, 3)
    .flatMap((departure) =>
      plan.targets
        .slice(0, 3)
        .map((destination) => ({ departure, destination })),
    );
  const results: {
    departure: DepartureAirportCandidate;
    result: ProviderResult<FlightDiscovery>;
  }[] = [];
  const deadline = Date.now() + budgetMs;
  const timeoutResult: ProviderResult<FlightDiscovery> = {
    status: "unavailable",
    reason: "timeout",
  };
  if (!tasks.length || budgetMs <= 0)
    return tasks.map(({ departure }) => ({ departure, result: timeoutResult }));
  let expired = false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProviderResult<FlightDiscovery>>((resolve) => {
    timer = setTimeout(
      () => {
        // Timer expiry is final even if Date.now() still reports time remaining.
        expired = true;
        controller.abort();
        resolve(timeoutResult);
      },
      Math.max(0, deadline - Date.now()),
    );
  });
  let cursor = 0;
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(FLIGHT_SEARCH_CONCURRENCY, tasks.length) },
        async () => {
          while (cursor < tasks.length) {
            const index = cursor++;
            const { departure, destination } = tasks[index];
            const remaining = deadline - Date.now();
            let result: ProviderResult<FlightDiscovery> = timeoutResult;
            try {
              if (!expired && remaining > 0)
                result = await Promise.race([
                  provider.discover(
                    { ...request, destination },
                    { ...departure.airport, iataCodes: [departure.code] },
                    { timeoutMs: remaining, signal: controller.signal },
                  ),
                  timeout,
                ]);
            } catch {
              result = { status: "unavailable", reason: "provider-error" };
            }
            results[index] = { departure, result };
          }
        },
      ),
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return results;
}
