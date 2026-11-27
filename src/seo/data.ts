import "server-only";
import type { TripRequest } from "../domain/types";
import type { TripSearch } from "../services/travel";
import { getTripTemplates } from "../services/travel";
import {
  createTravelProviders,
  type ProviderEnvironment,
} from "../providers/server/composition";
import type { ProviderFetch } from "../providers/server/http";
import type { FlightHttpFactory } from "../providers/server/flight-http";
import type { SeoDataState } from "./policy";
export type SeoDataset = { search: TripSearch; state: SeoDataState };
export const SEO_DEADLINE_MS = 9000;
/** One fixed search, existing provider caps, and a total deadline. No AI/provider handoff imports. */
export async function loadSeoSearch(
  request: TripRequest,
  env: ProviderEnvironment,
  fetcher: ProviderFetch = fetch,
  allow: () => Promise<boolean> = async () => true,
  timeoutMs = SEO_DEADLINE_MS,
  cacheImages = false,
  flightHttp?: FlightHttpFactory,
): Promise<SeoDataset> {
  const empty = (state: SeoDataState): SeoDataset => ({
    state,
    search: { templates: [], issues: [] },
  });
  if (!env.TRAVELPAYOUTS_API_TOKEN) return empty("configuration");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<SeoDataset>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(empty("timeout"));
    }, timeoutMs);
  });
  const boundedFetch: ProviderFetch = (url, options) => {
    controller.signal.throwIfAborted();
    return fetcher(url, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal,
    });
  };
  try {
    return await Promise.race([
      deadline,
      (async () => {
        try {
          if (!(await allow())) return empty("rate-limit");
          controller.signal.throwIfAborted();
          const providers = await createTravelProviders(
            env,
            boundedFetch,
            cacheImages,
            request,
            flightHttp,
          );
          const search = await getTripTemplates(request, providers);
          return {
            search,
            state: search.issues.some(
              (i) =>
                i.category === "transport" && i.source.status !== "available",
            )
              ? "provider"
              : "ready",
          } as SeoDataset;
        } catch {
          return empty(controller.signal.aborted ? "timeout" : "provider");
        }
      })(),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
