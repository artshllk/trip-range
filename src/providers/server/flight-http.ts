import "server-only";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { unstable_cache } from "next/cache";
import {
  recordFareFetch,
  SEARCH_WRITE_TIMEOUT_MS,
} from "../../server/fare-store";
import {
  admitProviderAttempt,
  type ProviderAdmission,
} from "../../server/provider-admission";
import {
  providerJson,
  ProviderRequestError,
  type HttpResult,
  type ProviderFetch,
} from "./http";

export const FLIGHT_CACHE_SECONDS = 1800;
type Success = Extract<HttpResult, { ok: true }>;
export type FlightCache = (
  load: () => Promise<Success>,
  key: string[],
  ttl: number,
) => () => Promise<Success>;
const nextFlightCache: FlightCache = (load, key, ttl) =>
  unstable_cache(load, key, { revalidate: ttl });
export type FlightHttp = (
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<HttpResult>;
export type FlightHttpFactory = (
  token: string,
  fetcher: ProviderFetch,
) => FlightHttp;

/** Admission runs inside the cached callback, immediately before an uncached fetch.
 * Fixed 30-minute cache generations avoid stale-while-revalidate dispatch after
 * the search has returned. Each generation expires before its entry's TTL.
 * No token, request deadline or raw response headers enter cache keys/values.
 */
export function createFlightHttp(
  token: string,
  fetcher: ProviderFetch = fetch,
  admission: ProviderAdmission = admitProviderAttempt,
  cache: FlightCache = nextFlightCache,
  clock: () => Date = () => new Date(),
  /** How long a store write may hold the response. Searches keep it short. */
  writeTimeoutMs: number = SEARCH_WRITE_TIMEOUT_MS,
): FlightHttp {
  const identity = createHash("sha256").update(token).digest("hex");
  return async (url, timeoutMs, signal) => {
    timeoutMs = Math.min(timeoutMs, 4000);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      return { ok: false, reason: "timeout" };
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    const monotonicDeadline = performance.now() + timeoutMs;
    const combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    if (combined.aborted || timeoutMs <= 0)
      return { ok: false, reason: "timeout" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<HttpResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ok: false, reason: "timeout" });
      }, timeoutMs);
    });
    try {
      const generation = Math.floor(Date.now() / (FLIGHT_CACHE_SECONDS * 1000));
      const load = cache(
        async () => {
          if (
            combined.aborted ||
            Date.now() >= deadline ||
            performance.now() >= monotonicDeadline
          )
            throw new ProviderRequestError("timeout");
          const result = await providerJson(
            url,
            { "X-Access-Token": token },
            FLIGHT_CACHE_SECONDS,
            async (target, options) => {
              const attemptSignal = AbortSignal.any([
                combined,
                options.signal!,
              ]);
              const decision = await admission(attemptSignal, target);
              if (
                attemptSignal.aborted ||
                Date.now() >= deadline ||
                performance.now() >= monotonicDeadline ||
                decision === "timeout"
              )
                throw new ProviderRequestError("timeout");
              else if (decision !== "allowed")
                throw new ProviderRequestError(
                  decision === "quota" ? "rate-limit" : "admission-unavailable",
                );
              return fetcher(target, { ...options, signal: attemptSignal });
            },
            Math.max(1, deadline - Date.now()),
            false,
          );
          if (!result.ok) throw new ProviderRequestError(result.reason);
          // Runs once per real provider call; cache hits reuse this value and its fetch time.
          const fetchedAt = clock().toISOString();
          await recordFareFetch(
            url,
            result.body,
            fetchedAt,
            result.responseDate,
            writeTimeoutMs,
          );
          return { ...result, fetchedAt };
        },
        ["flight-http-v1", identity, url, String(generation)],
        FLIGHT_CACHE_SECONDS,
      );
      return await Promise.race([load(), timeout]);
    } catch (error) {
      return error instanceof ProviderRequestError
        ? { ok: false, reason: error.reason }
        : { ok: false, reason: "unavailable" };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

/** CLI diagnostics have no Next cache context; admission is still mandatory. */
export const uncachedFlightHttp: FlightHttpFactory = (token, fetcher) =>
  createFlightHttp(token, fetcher, admitProviderAttempt, (load) => load);
