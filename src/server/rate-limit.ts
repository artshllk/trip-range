import "server-only";
import { serverEnvironment } from "../providers/server/environment";
import { validLimiterNamespace } from "../config/deployment";
import { reportOperation } from "./observability";
export type LimitOperation =
  | "locations"
  | "ai-intent"
  | "ai-explanations"
  | "affiliate"
  | "editorial-images"
  | "search";
/** Shared spend quotas, not per-client protection. No identities or forwarded headers. */
export const limits: Record<LimitOperation, number> = {
  locations: 300,
  "ai-intent": 12,
  "ai-explanations": 12,
  affiliate: 40,
  "editorial-images": 30,
  search: 120,
};
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
export function redisLimiter(
  config: RedisConfiguration,
  fetcher: typeof fetch = fetch,
  timeoutMs = 1200,
  options = { namespace: "goeksplo:v2:local", windowMs: 60000 },
): RequestLimiter {
  const valid =
    validLimiterNamespace(options.namespace) &&
    Number.isInteger(options.windowMs) &&
    options.windowMs >= 250 &&
    options.windowMs <= 60000;
  return {
    async allow(operation) {
      if (!valid || !Object.prototype.hasOwnProperty.call(limits, operation))
        return false;
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
      const allowed = reply.ok && reply.result === 1;
      const status = !reply.ok
        ? reply.reason
        : reply.result === 1
          ? "success"
          : reply.result === 0
            ? "rate-limit"
            : "malformed";
      reportOperation("limiter", "rate-limit", status, Date.now() - start);
      return allowed;
    },
  };
}
/** The central environment policy is authoritative. Configured outages never choose local fallback. */
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
  return {
    async allow() {
      reportOperation("limiter", "rate-limit", "configuration", 0);
      return false;
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
