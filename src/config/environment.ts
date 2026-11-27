import {
  deploymentMode,
  limiterPolicy,
  limiterNamespace,
  vercelAnalyticsEnabled,
} from "./deployment";
import { readLogLevel } from "../server/observability/log-level";
/** Pure validation; values stay behind the server-only environment boundary in application code. */
export function validateEnvironment(
  env: Record<string, string | undefined>,
  buildContext?: string,
) {
  const invalid: string[] = [];
  // Explicit opt-in only. Missing or malformed values fail closed without changing other services.
  const aiFlag = env.GOEKSPLO_AI_ENABLED?.trim();
  const aiEnabled = aiFlag === "true";
  if (aiFlag && !["true", "false"].includes(aiFlag))
    invalid.push("GOEKSPLO_AI_ENABLED");
  const read = (key: string, pattern = /^[\x21-\x7e]{8,4096}$/) => {
    const value = env[key]?.trim();
    if (!value) return undefined;
    if (!pattern.test(value)) {
      invalid.push(key);
      return undefined;
    }
    return value;
  };
  const token = read("TRAVELPAYOUTS_API_TOKEN");
  const project = read("TRAVELPAYOUTS_PROJECT_ID", /^[1-9]\d{0,14}$/);
  const marker = read("TRAVELPAYOUTS_MARKER", /^[1-9]\d{0,14}$/);
  // Gateway-injected credentials are not direct OpenAI credentials. The
  // application's fixed OpenAI endpoint must never consume those credentials.
  const gateway =
    (env.NETLIFY !== undefined ||
      env.SITE_ID !== undefined ||
      env.GOEKSPLO_NETLIFY_CONTEXT !== undefined) &&
    !!env.OPENAI_BASE_URL?.trim();
  const openai = gateway ? undefined : read("OPENAI_API_KEY"),
    pexels = read("PEXELS_API_KEY");
  const model =
    read("OPENAI_MODEL", /^[a-z0-9][a-z0-9._:-]{0,79}$/) ?? "gpt-6-luna";
  // Fare observation store (Neon Postgres) and the shared secret for its warm job.
  const databaseUrl = read(
    "DATABASE_URL",
    /^postgres(?:ql)?:\/\/[\x21-\x7e]{8,4000}$/,
  );
  const fareWarmSecret = read("FARE_WARM_SECRET", /^[A-Za-z0-9_-]{32,256}$/);
  const redisToken = read("RATE_LIMIT_REDIS_REST_TOKEN");
  const redisUrl = read(
    "RATE_LIMIT_REDIS_REST_URL",
    /^https:\/\/[a-z0-9-]+\.upstash\.io\/?$/,
  );
  const redis =
    redisUrl && redisToken ? { url: redisUrl, token: redisToken } : undefined;
  // Upstash's console hands out UPSTASH_REDIS_REST_*; this app reads only
  // RATE_LIMIT_REDIS_REST_*. Never accept both: report the exact rename instead,
  // because the result of the wrong name is a silent fail-closed in production.
  const misnamed = (
    [
      ["UPSTASH_REDIS_REST_URL", "RATE_LIMIT_REDIS_REST_URL"],
      ["UPSTASH_REDIS_REST_TOKEN", "RATE_LIMIT_REDIS_REST_TOKEN"],
    ] as const
  )
    .filter(
      ([found, expected]) => !!env[found]?.trim() && !env[expected]?.trim(),
    )
    .map(([found, expected]) => ({ found, expected }));
  for (const { found } of misnamed) invalid.push(found);
  if (
    !!redisToken !== !!redisUrl &&
    !invalid.some((k) => k.startsWith("RATE_LIMIT_"))
  )
    invalid.push("RATE_LIMIT_CONFIGURATION");
  const mode = deploymentMode(env, buildContext);
  if (mode === "invalid") invalid.push("DEPLOYMENT_CONFIGURATION");
  if (
    env.GOEKSPLO_LOG_LEVEL?.trim() &&
    !["debug", "info", "warn", "error", "off"].includes(env.GOEKSPLO_LOG_LEVEL)
  )
    invalid.push("GOEKSPLO_LOG_LEVEL");
  const forbiddenFixtures =
    ["production", "preview", "invalid"].includes(mode) &&
    Object.entries(env).some(
      ([key, value]) => /^GOEKSPLO_.*_FIXTURE$/.test(key) && !!value,
    );
  if (forbiddenFixtures) invalid.push("TEST_FIXTURE_CONFIGURATION");
  const limiter = limiterPolicy(
    mode,
    !!redis,
    forbiddenFixtures || invalid.some((key) => key.startsWith("RATE_LIMIT_")),
    ["TRAVELPAYOUTS_API_TOKEN", "OPENAI_API_KEY", "PEXELS_API_KEY"].some(
      (key) => !!env[key]?.trim(),
    ),
  );
  const capabilities = {
    flights: !forbiddenFixtures && !!token,
    affiliate: !forbiddenFixtures && !!(token && project && marker),
    ai:
      aiEnabled &&
      !forbiddenFixtures &&
      !!openai &&
      !invalid.includes("OPENAI_MODEL"),
    wikimedia: !forbiddenFixtures,
    pexels: !forbiddenFixtures && !!pexels,
    accommodationInventory: false,
    fareStore: !forbiddenFixtures && !!databaseUrl,
  };
  return {
    logLevel: readLogLevel(env.GOEKSPLO_LOG_LEVEL),
    travelpayouts: {
      TRAVELPAYOUTS_API_TOKEN: forbiddenFixtures ? undefined : token,
      TRAVELPAYOUTS_PROJECT_ID: forbiddenFixtures ? undefined : project,
      TRAVELPAYOUTS_MARKER: forbiddenFixtures ? undefined : marker,
    },
    ai: {
      enabled: aiEnabled,
      apiKey: capabilities.ai ? openai : undefined,
      model,
    },
    pexelsKey: forbiddenFixtures ? undefined : pexels,
    fareStore: {
      databaseUrl: forbiddenFixtures ? undefined : databaseUrl,
      warmSecret: forbiddenFixtures ? undefined : fareWarmSecret,
    },
    redis,
    capabilities,
    vercelAnalytics: vercelAnalyticsEnabled(env, buildContext),
    invalid,
    misnamed,
    mode,
    limiter,
    limiterNamespace: limiterNamespace(mode),
    production:
      env.NODE_ENV === "production" ||
      mode === "production" ||
      mode === "preview" ||
      mode === "invalid",
    deployed: mode === "production" || mode === "preview" || mode === "invalid",
  };
}
/** Messages that must stop a deployed build and be printed loudly anywhere else. */
export function startupConfigurationErrors(
  env: ReturnType<typeof validateEnvironment>,
) {
  return env.misnamed.map(
    (m) =>
      `Environment variable ${m.found} is set but ${m.expected} is not. This app reads only ${m.expected}; rename the variable. Without it the rate limiter fails closed and production cannot price anything.`,
  );
}
export function configurationReport(
  env: ReturnType<typeof validateEnvironment>,
) {
  return {
    capabilities: env.capabilities,
    invalid: env.invalid,
    rateLimiting: env.limiter,
    mode: env.mode,
    blockers: [
      ...env.misnamed.map(
        (m) =>
          `Found ${m.found}, expected ${m.expected}: rename it (Upstash's default name is not read)`,
      ),
      ...env.invalid
        .filter((k) => !env.misnamed.some((m) => m.found === k))
        .map((k) => `Malformed configuration: ${k}`),
      ...(!env.capabilities.flights
        ? ["Configure flight discovery for public launch"]
        : []),
      ...(!env.capabilities.affiliate
        ? ["Configure affiliate handoff for public launch"]
        : []),
      ...(!env.redis
        ? ["Configure distributed rate limiting before public launch"]
        : []),
    ],
  };
}
