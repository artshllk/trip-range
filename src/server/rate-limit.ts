import "server-only";
import { serverEnvironment } from "../providers/server/environment";
import { validLimiterNamespace } from "../config/deployment";
import { reportOperation } from "./observability";
export type LimitOperation =
  | "locations"
  | "ai-intent"
  | "ai-explanations"
  | "affiliate"
  | "affiliate-view"
  | "editorial-images"
  | "search";
/** Shared spend quotas, not per-client protection. No identities or forwarded headers. */
export const limits: Record<LimitOperation, number> = {
  locations: 300,
  "ai-intent": 12,
  "ai-explanations": 12,
  affiliate: 40,
  // CTA-view beacons are statistics only; their own quota means they can never
  // use up the one that creates partner links (abuse controls, 25 November 2026).
  "affiliate-view": 300,
  "editorial-images": 30,
  search: 120,
};
/**
 * Refused rather than counted in memory when Redis cannot answer. The rule
 * (docs/abuse-controls.md, "Failure policy"): fail open when the only cost is
 * our own degraded service; fail closed when failing open spends money we
 * cannot cap, or risks a partner cutting us off. These are paid per OpenAI
 * call with this counter as their only spend control. Provider admission is
 * the other control that meets the second test. AI is off at launch.
 */
export const closedWithoutRedis: ReadonlySet<LimitOperation> = new Set([
  "ai-intent",
  "ai-explanations",
]);
export interface RequestLimiter {
  allow(operation: LimitOperation): Promise<boolean>;
}
export function localLimiter(now = Date.now): RequestLimiter {
  const buckets = new Map<LimitOperation, { until: number; count: number }>();
  return {
    async allow(operation) {
      if (!Object.prototype.hasOwnProperty.call(limits, operation))
        return false;
      const time = now();
      let b = buckets.get(operation);
      if (!b || b.until <= time) {
        b = { until: time + 60000, count: 0 };
        buckets.set(operation, b);
      }
      return ++b.count <= limits[operation];
    },
  };
}
export type RedisConfiguration = { url: string; token: string };
type RedisReply =
  | { ok: true; result: unknown }
  | {
      ok: false;
      reason: "configuration" | "timeout" | "unavailable" | "malformed";
    };
/** Shared bounded REST transport for the production counter and opt-in isolated diagnostic. */
export async function redisCommand(
  config: RedisConfiguration,
  command: readonly string[],
  fetcher: typeof fetch = fetch,
  timeoutMs = 1200,
): Promise<RedisReply> {
  if (
    !/^https:\/\/[a-z0-9-]+\.upstash\.io\/?$/.test(config.url) ||
    !/^[\x21-\x7e]{8,4096}$/.test(config.token)
  )
    return { ok: false, reason: "configuration" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const deadline = new Promise<RedisReply>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      deadline,
      (async (): Promise<RedisReply> => {
        try {
          const response = await fetcher(config.url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(command),
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          });
          if (!response.ok) return { ok: false, reason: "unavailable" };
          reader = response.body?.getReader();
          if (!reader) return { ok: false, reason: "malformed" };
          let raw = "",
            size = 0;
          const decoder = new TextDecoder();
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 1024) return { ok: false, reason: "malformed" };
            raw += decoder.decode(chunk.value, { stream: true });
          }
          const body: unknown = JSON.parse(raw + decoder.decode());
          if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            Object.keys(body).length !== 1 ||
            !("result" in body)
          )
            return { ok: false, reason: "malformed" };
          return { ok: true, result: body.result };
        } catch (error) {
          return {
            ok: false,
            reason: controller.signal.aborted
              ? "timeout"
              : error instanceof SyntaxError
                ? "malformed"
                : "unavailable",
          };
        }
      })(),
    ]);
  } finally {
    clearTimeout(timer!);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
// Atomic fixed-window count + TTL. No retry: an ambiguous response may already have incremented.
const script =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; if n<=tonumber(ARGV[2]) then return 1 else return 0 end";
/**
 * Shared spend quotas in Redis. When Redis cannot give an answer (error, timeout,
 * malformed reply, invalid namespace) the operation is counted in this instance's
 * memory with the same limits instead of being refused: a dependency being
 * unavailable must never stop a visitor using the site (owner decision,
 * 26 November 2026). Only a real "over quota" answer from Redis refuses.
 * Exceptions: the AI operations in closedWithoutRedis, and provider admission.
 */
export function redisLimiter(
  config: RedisConfiguration,
  fetcher: typeof fetch = fetch,
  timeoutMs = 1200,
  options = { namespace: "goeksplo:v2:local", windowMs: 60000 },
  fallback: RequestLimiter = localLimiter(),
): RequestLimiter {
  const valid =
    validLimiterNamespace(options.namespace) &&
    Number.isInteger(options.windowMs) &&
    options.windowMs >= 250 &&
    options.windowMs <= 60000;
  return {
    async allow(operation) {
      if (!Object.prototype.hasOwnProperty.call(limits, operation))
        return false;
      if (!valid) {
        reportOperation("limiter", "rate-limit", "configuration", 0);
        return closedWithoutRedis.has(operation)
          ? false
          : fallback.allow(operation);
      }
      const start = Date.now();
      const reply = await redisCommand(
        config,
        [
          "EVAL",
          script,
          "1",
          `${options.namespace}:limit:${operation}`,
          String(options.windowMs),
          String(limits[operation]),
        ],
        fetcher,
        timeoutMs,
      );
      const status = !reply.ok
        ? reply.reason
        : reply.result === 1
          ? "success"
          : reply.result === 0
            ? "rate-limit"
            : "malformed";
      reportOperation("limiter", "rate-limit", status, Date.now() - start);
      if (status === "success") return true;
      if (status === "rate-limit") return false;
      return closedWithoutRedis.has(operation)
        ? false
        : fallback.allow(operation);
    },
  };
}
/**
 * The central environment policy still reports its state (readiness lists
 * "distributed-rate-limit" when Redis is required but unusable), but requests
 * are never refused for it: without usable Redis every operation is counted in
 * this instance's memory, and each call is logged as a configuration problem.
 */
export function createRequestLimiter(
  env: ReturnType<typeof serverEnvironment>,
  fetcher: typeof fetch = fetch,
): RequestLimiter {
  if (env.limiter === "local") return localLimiter();
  if (env.limiter === "distributed" && env.redis)
    return redisLimiter(env.redis, fetcher, 1200, {
      namespace: env.limiterNamespace,
      windowMs: 60000,
    });
  const fallback = localLimiter();
  return {
    async allow(operation) {
      reportOperation("limiter", "rate-limit", "configuration", 0);
      return closedWithoutRedis.has(operation)
        ? false
        : fallback.allow(operation);
    },
  };
}
let cached: { identity: string; limiter: RequestLimiter } | undefined;
export async function allowOperation(operation: LimitOperation) {
  const env = serverEnvironment();
  // Private in-memory identity only. Never emit config or credentials in diagnostics.
  const identity = JSON.stringify([
    env.limiter,
    env.limiterNamespace,
    env.redis,
  ]);
  if (!cached || cached.identity !== identity)
    cached = { identity, limiter: createRequestLimiter(env) };
  return cached.limiter.allow(operation);
}
export const rateLimitHeaders = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "Retry-After": "60",
};
