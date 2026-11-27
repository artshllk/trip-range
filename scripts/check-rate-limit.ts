/** Offline by default. --live touches only a unique, short-lived diagnostic counter. */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { validateEnvironment } from "../src/config/environment";
import { limiterNamespace } from "../src/config/deployment";
import {
  createRequestLimiter,
  localLimiter,
  redisLimiter,
  redisCommand,
  limits,
} from "../src/server/rate-limit";
export async function offlineRateLimitCheck() {
  const secret = "synthetic-diagnostic-credential";
  const inputs = [
    [{ NODE_ENV: "development" }, "local"],
    [{ NODE_ENV: "production" }, "local"],
    [{ NODE_ENV: "test" }, "local"],
    [{ VERCEL: "1", VERCEL_ENV: "production" }, "required-but-unavailable"],
    [{ VERCEL: "1", VERCEL_ENV: "preview" }, "local"],
    [
      { VERCEL: "1", VERCEL_ENV: "preview", OPENAI_API_KEY: secret },
      "required-but-unavailable",
    ],
    [
      {
        VERCEL: "1",
        VERCEL_ENV: "production",
        RATE_LIMIT_REDIS_REST_URL: "https://synthetic.upstash.io",
        RATE_LIMIT_REDIS_REST_TOKEN: secret,
      },
      "distributed",
    ],
  ] as const;
  const policy = inputs.every(
    ([env, expected]) => validateEnvironment(env).limiter === expected,
  );
  let externalCalls = 0;
  const blocked = createRequestLimiter(
    validateEnvironment({ VERCEL: "1", VERCEL_ENV: "production" }),
    async () => {
      externalCalls++;
      throw Error("Unexpected fetch");
    },
  );
  // Without Redis, production counts in memory instead of refusing, and never fetches.
  const fallsBack = await blocked.allow("search");
  let time = 0;
  const local = localLimiter(() => time);
  const first = await Promise.all(
    Array.from({ length: limits["ai-intent"] }, () => local.allow("ai-intent")),
  );
  const over = await local.allow("ai-intent");
  time += 60000;
  const reset = await local.allow("ai-intent");
  const checks = {
    environmentPolicy: policy,
    productionFallsBackWithoutFetch: fallsBack && externalCalls === 0,
    firstNAllowed: first.every(Boolean),
    nextDenied: !over,
    nextWindowAllowed: reset,
    namespacesSeparated:
      limiterNamespace("production") !== limiterNamespace("preview"),
  };
  return {
    mode: "offline",
    status: Object.values(checks).every(Boolean) ? "passed" : "failed",
    externalCalls,
    checks,
  };
}
export async function liveRateLimitCheck(
  env: ReturnType<typeof validateEnvironment>,
  fetcher: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let requests = 0;
  const blocked = (reason: string) => ({
    mode: "live",
    status: "blocked",
    distributedLimiterConfigured: !!env.redis,
    requests,
    reason,
  });
  if (!env.redis || env.limiter !== "distributed")
    return blocked("distributed-limiter-not-configured");
  const namespace = limiterNamespace(env.mode, randomBytes(16).toString("hex"));
  const key = `${namespace}:limit:ai-intent`;
  const boundedFetch: typeof fetch = (input, init) => {
    if (++requests > 16) throw Error("Diagnostic request bound");
    return fetcher(input, init);
  };
  // This diagnostic tests Redis itself, so it must not fall back to memory.
  const limiter = redisLimiter(
    env.redis,
    boundedFetch,
    1200,
    { namespace, windowMs: 3000 },
    { allow: async () => false },
  );
  const first = await Promise.all(
    Array.from({ length: limits["ai-intent"] }, () =>
      limiter.allow("ai-intent"),
    ),
  );
  if (!first.every(Boolean)) return blocked("isolated-counter-unavailable");
  if (await limiter.allow("ai-intent"))
    return blocked("atomic-quota-or-window-check-failed");
  const ttl = await redisCommand(env.redis, ["PTTL", key], boundedFetch);
  if (
    !ttl.ok ||
    typeof ttl.result !== "number" ||
    !Number.isInteger(ttl.result) ||
    ttl.result <= 0 ||
    ttl.result > 3000
  )
    return blocked("isolated-ttl-check-failed");
  await pause(ttl.result + 50);
  if (!(await limiter.allow("ai-intent")))
    return blocked("isolated-window-reset-failed");
  const nextTtl = await redisCommand(env.redis, ["PTTL", key], boundedFetch);
  if (
    !nextTtl.ok ||
    typeof nextTtl.result !== "number" ||
    !Number.isInteger(nextTtl.result) ||
    nextTtl.result <= 0 ||
    nextTtl.result > 3000
  )
    return blocked("isolated-reset-ttl-check-failed");
  return {
    mode: "live",
    status: "passed",
    distributedLimiterConfigured: true,
    requests,
    checks: {
      firstNAllowed: true,
      nextDenied: true,
      positiveBoundedTtl: true,
      nextWindowAllowed: true,
      resetTtl: true,
    },
    normalQuotaKeysTouched: false,
  };
}
if (require.main === module)
  void (async () => {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--live"))
      throw Error("Unsupported arguments");
    // Reports only; no per-command operational log noise in this diagnostic process.
    process.env.GOEKSPLO_LOG_LEVEL = "off";
    let local = {};
    if (args.includes("--live")) {
      try {
        local = parseEnv(readFileSync(".env.local", "utf8"));
      } catch {}
    }
    const report = args.includes("--live")
      ? await liveRateLimitCheck(
          validateEnvironment({ ...local, ...process.env }),
        )
      : await offlineRateLimitCheck();
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "passed") process.exitCode = 1;
  })().catch(() => {
    console.log(
      JSON.stringify({
        status: "blocked",
        reason: "rate-limit-diagnostic-unavailable",
      }),
    );
    process.exitCode = 1;
  });
