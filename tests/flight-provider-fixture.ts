import { createTravelpayoutsDiscovery as createProvider } from "../src/providers/server/travelpayouts";
import { createFlightHttp } from "../src/providers/server/flight-http";
import type { FlightHttpFactory } from "../src/providers/server/flight-http";
import type { ProviderFetch } from "../src/providers/server/http";
import { createTravelProviders as compose } from "../src/providers/server/composition";
import { loadSeoSearch as loadSeo } from "../src/seo/data";
import { sampleMarket as sample } from "../scripts/research-markets";
import { collectCandidateObservation as collect } from "../scripts/validate-seo-candidates";
export type { ProviderEnvironment } from "../src/providers/server/composition";

/**
 * The real API split, verified 2026-10-27 (see aviasales-contract.test.ts):
 * prices_for_dates rows never carry found_at; found_at and actual come from
 * get_latest_prices. Fixture rows may still declare found_at for convenience: this
 * wrapper strips it from prices_for_dates and serves it from get_latest_prices, so
 * the adapter sees the real shape. The test's fetcher is called once per query.
 */
export function apiSplitFetcher(fetcher: ProviderFetch): ProviderFetch {
  const slots = new Map<
    string,
    { rows: Promise<unknown[]>; resolve: (rows: unknown[]) => void }
  >();
  const slot = (key: string) => {
    let entry = slots.get(key);
    if (!entry) {
      let resolve!: (rows: unknown[]) => void;
      const rows = new Promise<unknown[]>((r) => (resolve = r));
      entry = { rows, resolve };
      slots.set(key, entry);
    }
    return entry;
  };
  const keyOf = (q: URLSearchParams, monthParam: string) =>
    [
      q.get("origin"),
      q.get("destination") ?? "",
      (q.get(monthParam) ?? "").slice(0, 7),
    ].join("|");
  return async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/get_latest_prices")) {
      const rows = await Promise.race([
        slot(keyOf(url.searchParams, "beginning_of_period")).rows,
        new Promise<unknown[]>((r) => setTimeout(() => r([]), 3000).unref?.()),
      ]);
      const data = rows.flatMap((row) => {
        const r = row as Record<string, unknown>;
        return r && typeof r === "object" && "found_at" in r
          ? [
              {
                origin: r.origin,
                destination: r.destination,
                depart_date: r.departure_at,
                return_date: r.return_at,
                value: r.price,
                found_at: r.found_at,
                actual: true,
                trip_class: 0,
              },
            ]
          : [];
      });
      return Response.json({
        success: true,
        currency: url.searchParams.get("currency"),
        data,
      });
    }
    if (!url.pathname.endsWith("/prices_for_dates"))
      return fetcher(input, options);
    const key = keyOf(url.searchParams, "departure_at");
    let response: Response;
    try {
      response = await fetcher(input, options);
    } catch (error) {
      slot(key).resolve([]);
      throw error;
    }
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      slot(key).resolve([]);
      return response;
    }
    const data =
      body &&
      typeof body === "object" &&
      Array.isArray((body as { data?: unknown }).data)
        ? (body as { data: unknown[] }).data
        : undefined;
    slot(key).resolve(data ?? []);
    if (!data) return response;
    const stripped = data.map((row) => {
      if (!row || typeof row !== "object") return row;
      const {
        found_at: _f,
        observed_at: _o,
        ...rest
      } = row as Record<string, unknown>;
      void _f;
      void _o;
      return rest;
    });
    return new Response(
      JSON.stringify({ ...(body as object), data: stripped }),
      {
        status: response.status,
        headers: response.headers,
      },
    );
  };
}
export const offlineFlightHttp: FlightHttpFactory = (token, fetcher) =>
  createFlightHttp(
    token,
    apiSplitFetcher(fetcher),
    async () => "allowed",
    (load) => load,
  );
export function createTravelProviders(...args: Parameters<typeof compose>) {
  const [env, fetcher, cacheImages, request] = args;
  return compose(env, fetcher, cacheImages, request, offlineFlightHttp);
}
export function loadSeoSearch(...args: Parameters<typeof loadSeo>) {
  const [request, env, fetcher, allow, timeout, cacheImages] = args;
  return loadSeo(
    request,
    env,
    fetcher,
    allow,
    timeout,
    cacheImages,
    offlineFlightHttp,
  );
}
export function sampleMarket(...args: Parameters<typeof sample>) {
  const [market, month, token, network, clock] = args;
  return sample(market, month, token, network, clock, offlineFlightHttp);
}
export function collectCandidateObservation(
  ...args: Parameters<typeof collect>
) {
  const [origin, token, network, now, timeout] = args;
  return collect(origin, token, network, now, timeout, offlineFlightHttp);
}
// Fare-normalization fixtures explicitly supply offline I/O. Admission/cache
// semantics are tested separately against the production HTTP/cache boundary.
export function createTravelpayoutsDiscovery(
  ...args: Parameters<typeof createProvider>
) {
  const [token, fetcher, clock, timeout, sink] = args;
  return createProvider(
    token,
    fetcher,
    clock,
    timeout,
    sink,
    createFlightHttp(
      token,
      apiSplitFetcher(fetcher!),
      async () => "allowed",
      (load) => load,
      // Fetch time is stamped at fetch; tests pin it to the injected clock.
      clock,
    ),
  );
}
export {
  FLIGHT_CACHE_SECONDS,
  FLIGHT_RESPONSE_LIMIT,
} from "../src/providers/server/travelpayouts";
