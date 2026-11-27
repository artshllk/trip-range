import "server-only";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { redisCommand, type RedisConfiguration } from "./rate-limit";
import { serverEnvironment } from "../providers/server/environment";
import { reportOperation } from "./observability";

export const PROVIDER_WINDOW_MS = 65_000;
export const PROVIDER_ADMISSION_TIMEOUT_MS = 1200;
// Shared across collector, planner, credentials and environments on this database.
// 65 seconds is conservative against the provider's rolling 60-second limits:
// the extra five seconds cover the bounded delay between admission and dispatch.
export const PROVIDER_ENDPOINTS = {
  "/aviasales/v3/get_latest_prices": {
    key: "goeksplo:provider:get-latest-prices:v2",
    attempts: 300,
  },
  "/aviasales/v3/prices_for_dates": {
    key: "goeksplo:provider:prices-for-dates:v2",
    attempts: 600,
  },
  "/v2/prices/nearest-places-matrix": {
    key: "goeksplo:provider:nearest-places-matrix:v2",
    attempts: 60,
  },
} as const;

export function providerEndpointPolicy(target: string) {
  try {
    const url = new URL(target);
    if (
      url.origin !== "https://api.travelpayouts.com" ||
      url.username ||
      url.password ||
      url.hash
    )
      return undefined;
    return Object.prototype.hasOwnProperty.call(
      PROVIDER_ENDPOINTS,
      url.pathname,
    )
      ? PROVIDER_ENDPOINTS[url.pathname as keyof typeof PROVIDER_ENDPOINTS]
      : undefined;
  } catch {
    return undefined;
  }
}
export const providerAdmissionScript = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[1]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
local inserted = redis.call('ZADD', KEYS[1], 'NX', now, ARGV[3])
if inserted ~= 1 then return -1 end
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1`;

export type ProviderAdmissionResult =
  | "allowed"
  | "quota"
  | "unavailable"
  | "timeout";
export type ProviderAdmission = (
  signal: AbortSignal,
  target: string,
) => Promise<ProviderAdmissionResult>;

export function redisProviderAdmission(
  config?: RedisConfiguration,
  fetcher: typeof fetch = fetch,
): ProviderAdmission {
  return async (signal, target) => {
    if (signal.aborted) return "timeout";
    const policy = providerEndpointPolicy(target);
    if (!config || !policy) return "unavailable";
    const start = performance.now();
    const reply = await redisCommand(
      config,
      [
        "EVAL",
        providerAdmissionScript,
        "1",
        policy.key,
        String(PROVIDER_WINDOW_MS),
        String(policy.attempts),
        randomUUID(),
      ],
      fetcher,
      PROVIDER_ADMISSION_TIMEOUT_MS,
    );
    // Never spend a delayed/ambiguous admission. No retry or refund: Redis may
    // already have recorded it. A short lease leaves >3 seconds of the 65s margin.
    const result: ProviderAdmissionResult =
      signal.aborted ||
      performance.now() - start >= PROVIDER_ADMISSION_TIMEOUT_MS
        ? "timeout"
        : !reply.ok && reply.reason === "timeout"
          ? "timeout"
          : reply.ok && reply.result === 1
            ? "allowed"
            : reply.ok && reply.result === 0
              ? "quota"
              : "unavailable";
    reportOperation(
      "limiter",
      "provider-admission",
      result === "allowed"
        ? "success"
        : result === "quota"
          ? "rate-limit"
          : result,
      performance.now() - start,
    );
    return result;
  };
}

export const admitProviderAttempt: ProviderAdmission = (signal, target) =>
  redisProviderAdmission(serverEnvironment().redis)(signal, target);
