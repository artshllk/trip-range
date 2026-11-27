import "next/dist/server/node-environment-baseline";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  redisProviderAdmission,
  providerAdmissionScript,
  PROVIDER_ENDPOINTS,
  providerEndpointPolicy,
  PROVIDER_WINDOW_MS,
} from "../src/server/provider-admission";
import { createFlightHttp } from "../src/providers/server/flight-http";
import { collectorHttp } from "../src/server/collector-http";
import { ProviderRequestError } from "../src/providers/server/http";
import type { ProviderAdmissionResult } from "../src/server/provider-admission";
import { localRedis } from "./local-redis-fixture";
import { searchFlightPlan } from "../src/services/flight-search";
import { createTravelpayoutsDiscovery } from "../src/providers/server/travelpayouts";
import { defaultRequest } from "../src/domain/request";
import { selectedDeparture } from "../src/domain/airports";
import { locations } from "../src/catalogue/locations";
import * as environment from "../src/providers/server/environment";
import { validateEnvironment } from "../src/config/environment";
import { createTravelProviders } from "../src/providers/server/composition";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import { curate } from "../src/domain/ranking";
import { resultsState } from "../src/components/travel/results-state";
import { resultsCopy } from "../src/i18n/results";

const config = {
  url: "https://synthetic.upstash.io",
  token: "synthetic-redis-token",
};
const url =
  "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=PRN";
const { key: PROVIDER_ADMISSION_KEY, attempts: PROVIDER_ATTEMPTS } =
  PROVIDER_ENDPOINTS["/aviasales/v3/prices_for_dates"];
const noCache = <T>(load: () => Promise<T>) => load;

test("endpoint policy cannot be bypassed with a different host, path or missing URL", () => {
  for (const target of [
    "",
    "not-a-url",
    "https://api.travelpayouts.com/unknown",
    "https://api.travelpayouts.com.evil.test/aviasales/v3/get_latest_prices",
    "http://api.travelpayouts.com/aviasales/v3/get_latest_prices",
    "https://user:password@api.travelpayouts.com/aviasales/v3/get_latest_prices",
  ])
    assert.equal(providerEndpointPolicy(target), undefined);
  assert.equal(providerEndpointPolicy(url)?.attempts, 600);
  assert.equal(
    providerEndpointPolicy(
      "https://api.travelpayouts.com/v2/prices/nearest-places-matrix",
    )?.attempts,
    60,
  );
});

test("real Redis: collector and planner compete for independent 300/600 endpoint budgets", async (t) => {
  const redis = await localRedis();
  if (!redis) {
    t.skip("Install Redis for concurrent endpoint coverage");
    return;
  }
  try {
    const dispatched = new Map<string, number>();
    const fetcher = async (target: string) => {
      const path = new URL(target).pathname;
      dispatched.set(path, (dispatched.get(path) ?? 0) + 1);
      return Response.json({ success: true, data: [] });
    };
    // Independent instances, as on GitHub and multiple hosted Functions.
    const collector = collectorHttp(
      "collector-token",
      fetcher,
      redisProviderAdmission(config, redis.fetcher),
    );
    const planners = Array.from({ length: 3 }, () =>
      createFlightHttp(
        "planner-token",
        fetcher,
        redisProviderAdmission(config, redis.fetcher),
        noCache,
      ),
    );
    const attempts = [];
    for (const [path, policy] of Object.entries(PROVIDER_ENDPOINTS)) {
      for (let n = 0; n < policy.attempts + 40; n++) {
        const target = new URL(
          "https://api.travelpayouts.com" + path + "?page=" + n,
        );
        attempts.push(
          n % 2
            ? planners[n % 3](target.toString(), 4000)
            : collector(target).then(
                () => ({ ok: true as const }),
                (error) => {
                  assert.ok(error instanceof ProviderRequestError);
                  return { ok: false as const, reason: error.reason };
                },
              ),
        );
      }
    }
    const results = await Promise.all(attempts);
    assert.equal(results.filter((r) => r.ok).length, 960);
    assert.equal(
      results.filter((r) => !r.ok && r.reason === "rate-limit").length,
      120,
    );
    for (const [path, policy] of Object.entries(PROVIDER_ENDPOINTS)) {
      assert.equal(dispatched.get(path), policy.attempts);
      assert.equal(await redis.command(["ZCARD", policy.key]), policy.attempts);
    }
  } finally {
    await redis.close();
  }
});

test("collector refusal, unavailable Redis, late response and cancellation never send a provider request", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({});
  };
  for (const [decision, reason] of [
    ["quota", "rate-limit"],
    ["unavailable", "admission-unavailable"],
    ["timeout", "timeout"],
  ] as const) {
    await assert.rejects(
      collectorHttp("test", fetcher, async () => decision)(new URL(url)),
      (error: unknown) =>
        error instanceof ProviderRequestError && error.reason === reason,
    );
  }
  const delayed = redisProviderAdmission(config, async () => {
    await sleep(25);
    return Response.json({ result: 1 });
  });
  await assert.rejects(
    collectorHttp(
      "test",
      fetcher,
      delayed,
    )(new URL(url), AbortSignal.timeout(5)),
    (error: unknown) =>
      error instanceof ProviderRequestError && error.reason === "timeout",
  );
  for (const admission of [
    redisProviderAdmission(),
    redisProviderAdmission(config, async () => {
      throw Error("offline");
    }),
    redisProviderAdmission(
      config,
      async () => new Response("", { status: 503 }),
    ),
    redisProviderAdmission(config, async () => Response.json({ result: "1" })),
  ])
    await assert.rejects(
      collectorHttp("test", fetcher, admission)(new URL(url)),
    );
  assert.equal(calls, 0);
});

test("collector hung Redis has a hard admission timeout and no dispatch", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000 });
  let calls = 0;
  const collect = collectorHttp(
    "test",
    async () => {
      calls++;
      return Response.json({});
    },
    redisProviderAdmission(config, async () => new Promise<Response>(() => {})),
  );
  const pending = collect(new URL(url));
  const check = assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof ProviderRequestError && error.reason === "timeout",
  );
  t.mock.timers.tick(1200);
  await check;
  assert.equal(calls, 0);
});

test("production default admission cannot bypass missing Redis", async (t) => {
  t.mock.method(environment, "serverEnvironment", () =>
    validateEnvironment({ NODE_ENV: "test" }),
  );
  let dispatched = false;
  const http = createFlightHttp(
    "synthetic-provider-token",
    async () => {
      dispatched = true;
      return Response.json({});
    },
    undefined,
    noCache,
  );
  assert.deepEqual(await http(url, 100), {
    ok: false,
    reason: "admission-unavailable",
  });
  assert.equal(dispatched, false);
});

test("real search orchestration cancels pending admissions at its shared deadline without starting later tasks", async () => {
  let admitted = 0,
    dispatched = 0;
  const pending: ((decision: ProviderAdmissionResult) => void)[] = [];
  const fetcher = async () => {
    dispatched++;
    return Response.json({});
  };
  const http = createFlightHttp(
    "synthetic",
    fetcher,
    () => {
      admitted++;
      return new Promise((resolve) => pending.push(resolve));
    },
    noCache,
  );
  const provider = createTravelpayoutsDiscovery(
    "synthetic",
    fetcher,
    undefined,
    undefined,
    undefined,
    http,
  );
  const origin = locations.find((l) => l.id === "zurich")!;
  const departure = selectedDeparture(origin)!;
  const results = await searchFlightPlan(
    provider,
    { ...defaultRequest, origin },
    [departure, departure, departure],
    { kind: "targeted", targets: [origin, origin, origin] },
    15,
  );
  // Two requests per discovery since 2026-10-27: itineraries (prices_for_dates) and
  // observations (get_latest_prices), each admitted separately.
  assert.equal(admitted, 6);
  assert.equal(results.length, 9);
  assert.ok(
    results.every(
      (r) => r.result.status === "unavailable" && r.result.reason === "timeout",
    ),
  );
  for (const resolve of pending) resolve("allowed");
  await sleep(10);
  assert.equal(dispatched, 0);
});

test("real Redis: one atomic rolling budget across instances, no minute-boundary reset and bounded TTL", async (t) => {
  const redis = await localRedis();
  if (!redis) {
    t.skip(
      "Install Redis or set GOEKSPLO_TEST_REDIS_SERVER for real Lua coverage",
    );
    return;
  }
  try {
    const signal = new AbortController().signal;
    const instances = Array.from({ length: 5 }, () =>
      redisProviderAdmission(config, redis.fetcher),
    );
    const results = await Promise.all(
      Array.from({ length: 620 }, (_, n) => instances[n % 5](signal, url)),
    );
    assert.equal(
      results.filter((r) => r === "allowed").length,
      PROVIDER_ATTEMPTS,
    );
    assert.equal(results.filter((r) => r === "quota").length, 20);
    assert.equal(await redis.command(["ZCARD", PROVIDER_ADMISSION_KEY]), 600);
    const ttl = Number(await redis.command(["PTTL", PROVIDER_ADMISSION_KEY]));
    assert.ok(ttl > 0 && ttl <= PROVIDER_WINDOW_MS);
    // Clean, separate key for each boundary. Seed and run the actual production
    // Lua atomically so scheduling pauses cannot age the fixtures across expiry.
    const boundaryKey = "goeksplo:test:provider-window-boundary";
    const boundary = (ageMs: number) =>
      redis.command([
        "EVAL",
        `
redis.call('DEL', KEYS[1])
local seedTime = redis.call('TIME')
local score = tonumber(seedTime[1])*1000 + math.floor(tonumber(seedTime[2])/1000) - tonumber(ARGV[4])
for i=1,tonumber(ARGV[2]) do redis.call('ZADD', KEYS[1], score, 'seed-'..i) end
${providerAdmissionScript}`,
        "1",
        boundaryKey,
        String(PROVIDER_WINDOW_MS),
        String(PROVIDER_ATTEMPTS),
        "boundary-attempt",
        String(ageMs),
      ]);
    assert.equal(await boundary(60_500), 0);
    assert.equal(await redis.command(["ZCARD", boundaryKey]), 600);
    assert.equal(await boundary(64_500), 0);
    assert.equal(await redis.command(["ZCARD", boundaryKey]), 600);
    assert.equal(await boundary(65_001), 1);
    assert.equal(await redis.command(["ZCARD", boundaryKey]), 1);
    // Production Lua, accelerated test policy only: allowance, denial, expiry.
    const key = "goeksplo:test:provider-window";
    const evalAt = (id: string) =>
      redis.command([
        "EVAL",
        providerAdmissionScript,
        "1",
        key,
        "100",
        "2",
        id,
      ]);
    assert.deepEqual(
      await Promise.all([evalAt("a"), evalAt("b"), evalAt("c")]),
      [1, 1, 0],
    );
    assert.ok(Number(await redis.command(["PTTL", key])) > 0);
    await sleep(130);
    assert.equal(await evalAt("d"), 1);
    const reset = Number(await redis.command(["PTTL", key]));
    assert.ok(reset > 0 && reset <= 100);
    // Retain a recent event while expiring an old one: not a fixed-window reset.
    const time = Number(
      await redis.command([
        "EVAL",
        "local t=redis.call('TIME'); return tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)",
        "0",
      ]),
    );
    await redis.command(["DEL", key]);
    await redis.command([
      "ZADD",
      key,
      String(time - 66_000),
      "expired",
      String(time - 1000),
      "recent",
    ]);
    const roll = (id: string) =>
      redis.command([
        "EVAL",
        providerAdmissionScript,
        "1",
        key,
        "65000",
        "2",
        id,
      ]);
    assert.equal(await roll("new"), 1);
    assert.equal(await roll("too-many"), 0);
    assert.equal(await redis.command(["ZCARD", key]), 2);
  } finally {
    await redis.close();
  }
});

test("missing, malformed, failed and timed-out Redis fail closed without provider dispatch", async () => {
  let network = 0;
  const cases = [
    redisProviderAdmission(),
    redisProviderAdmission({ ...config, url: "http://invalid" }),
    redisProviderAdmission(config, async () => {
      throw Error("offline");
    }),
    redisProviderAdmission(config, async () => new Response("bad JSON")),
    redisProviderAdmission(config, async () => Response.json({ result: 2 })),
    redisProviderAdmission(
      config,
      async () => new Response("unauthorized", { status: 401 }),
    ),
  ];
  for (const admission of cases) {
    const http = createFlightHttp(
      "synthetic-provider-token",
      async () => {
        network++;
        return Response.json({});
      },
      admission,
      noCache,
    );
    assert.deepEqual(await http(url, 100), {
      ok: false,
      reason: "admission-unavailable",
    });
  }
  const delayed = redisProviderAdmission(config, async () => {
    await sleep(35);
    return Response.json({ result: 1 });
  });
  const http = createFlightHttp(
    "synthetic",
    async () => {
      network++;
      return Response.json({});
    },
    delayed,
    noCache,
  );
  assert.deepEqual(await http(url, 5), { ok: false, reason: "timeout" });
  await sleep(45);
  assert.equal(network, 0);
});

test("quota is distinct from upstream outage; each admitted attempt dispatches once, without retries", async () => {
  for (const [decision, status, expected] of [
    ["quota", 200, "rate-limit"],
    ["allowed", 503, "unavailable"],
    ["allowed", 429, "rate-limit"],
    ["unavailable", 200, "admission-unavailable"],
  ] as const) {
    let dispatches = 0,
      admissions = 0;
    const http = createFlightHttp(
      "synthetic",
      async (_url, options) => {
        dispatches++;
        assert.equal(options.cache, "no-store");
        assert.equal(options.next, undefined);
        return Response.json({}, { status });
      },
      async () => {
        admissions++;
        return decision;
      },
      noCache,
    );
    assert.deepEqual(await http(url, 100), { ok: false, reason: expected });
    assert.equal(admissions, 1);
    assert.equal(dispatches, decision === "allowed" ? 1 : 0);
  }
});

test("quota denial reaches truthful incomplete-price results without implying no flights exist", async () => {
  let dispatches = 0;
  const fetcher = async () => {
    dispatches++;
    throw Error("Unexpected provider dispatch");
  };
  const origin = locations.find((l) => l.id === "zurich")!;
  const request = {
    ...defaultRequest,
    origin,
    originId: origin.id,
    dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
    nights: 2,
  };
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "synthetic-only" },
    fetcher,
    false,
    request,
    (token, fetch) =>
      createFlightHttp(token, fetch, async () => "quota", noCache),
  );
  const search = await getTripTemplates(request, providers);
  const plans = search.templates.map((t) => pricePlan(t, request));
  const ranked = curate(plans, request);
  assert.equal(dispatches, 0);
  assert.equal(resultsState(ranked), "empty");
  assert.ok(
    search.issues.some(
      (i) =>
        i.source.status !== "available" && i.source.reason === "rate-limit",
    ),
  );
  assert.equal(ranked.cheapest, undefined);
  assert.ok(
    plans
      .filter((p) => p.transportMode === "flight")
      .every(
        (p) => p.pricingCompleteness !== "complete" && p.budget === undefined,
      ),
  );
  assert.match(
    resultsCopy.en.providerUnavailableNote,
    /no usable flight data, so trips needing flights have incomplete totals/,
  );
  assert.doesNotMatch(
    resultsCopy.en.providerUnavailableNote,
    /no flights|unavailable flights/i,
  );
});

test("hung Redis reaches its hard timeout and a shorter shared search deadline without dispatch", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000 });
  let dispatches = 0;
  const fetcher = async () => {
    dispatches++;
    return Response.json({});
  };
  const admission = redisProviderAdmission(
    config,
    async () => new Promise<Response>(() => {}),
  );
  const http = createFlightHttp("synthetic", fetcher, admission, noCache);
  const pending = http(url, 2000);
  t.mock.timers.tick(1200);
  assert.deepEqual(await pending, { ok: false, reason: "timeout" });
  assert.equal(dispatches, 0);

  const provider = createTravelpayoutsDiscovery(
    "synthetic",
    fetcher,
    undefined,
    undefined,
    undefined,
    http,
  );
  const origin = locations.find((l) => l.id === "zurich")!;
  const departure = selectedDeparture(origin)!;
  const search = searchFlightPlan(
    provider,
    { ...defaultRequest, origin },
    [departure, departure, departure],
    { kind: "targeted", targets: [origin, origin, origin] },
    50,
  );
  t.mock.timers.tick(50);
  const results = await search;
  assert.equal(results.length, 9);
  assert.ok(
    results.every(
      (r) => r.result.status === "unavailable" && r.result.reason === "timeout",
    ),
  );
  t.mock.timers.tick(1200);
  // Let delayed transport completions propagate through the real HTTP guard.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(dispatches, 0);
});

test("late admission, caller cancellation and expired cache work never dispatch after deadline", async () => {
  let dispatches = 0;
  let release: (result: ProviderAdmissionResult) => void = () => {};
  const controller = new AbortController();
  const http = createFlightHttp(
    "synthetic",
    async () => {
      dispatches++;
      return Response.json({});
    },
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    noCache,
  );
  const pending = http(url, 10, controller.signal);
  controller.abort();
  release("allowed");
  assert.deepEqual(await pending, { ok: false, reason: "timeout" });
  const delayedCache = createFlightHttp(
    "synthetic",
    async () => {
      dispatches++;
      return Response.json({});
    },
    async () => "allowed",
    (load) => async () => {
      await sleep(20);
      return load();
    },
  );
  assert.deepEqual(await delayedCache(url, 5), {
    ok: false,
    reason: "timeout",
  });
  await sleep(30);
  assert.equal(dispatches, 0);
});

test("installed Next cache: fresh hits use zero Redis admissions; generations, currencies and credentials partition entries", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000 });
  const host = globalThis as typeof globalThis & {
    __incrementalCache?: unknown;
  };
  const original = host.__incrementalCache;
  const entries = new Map<string, { value: unknown; written: number }>();
  const keys: string[] = [];
  host.__incrementalCache = {
    generateSimpleCacheKey: async (key: string) => {
      keys.push(key);
      return createHash("sha256").update(key).digest("hex");
    },
    get: async (key: string) => {
      const entry = entries.get(key);
      return entry ? { value: entry.value, isStale: false } : null;
    },
    set: async (key: string, value: unknown) => {
      entries.set(key, { value, written: Date.now() });
    },
  };
  let admissions = 0,
    dispatches = 0;
  const fetcher = async () => {
    dispatches++;
    return Response.json({ success: true, data: [] });
  };
  const admission = async (): Promise<"allowed"> => {
    admissions++;
    return "allowed";
  };
  try {
    const http = createFlightHttp(
      "private-synthetic-token",
      fetcher,
      admission,
    );
    assert.equal((await http(url, 100)).ok, true);
    assert.equal((await http(url, 100)).ok, true);
    assert.equal(admissions, 1);
    assert.equal(dispatches, 1);
    // A new Function instance shares the Data Cache entry.
    await createFlightHttp(
      "private-synthetic-token",
      fetcher,
      admission,
    )(url, 100);
    assert.equal(admissions, 1);
    await http(url + "&currency=usd", 100);
    await createFlightHttp("other-private-token", fetcher, admission)(url, 100);
    assert.equal(admissions, 3);
    assert.equal(dispatches, 3);
    t.mock.timers.setTime(3_600_000);
    await http(url, 100);
    assert.equal(admissions, 4);
    assert.equal(dispatches, 4);
    assert.ok(
      keys.every(
        (key) =>
          !key.includes("private-synthetic-token") &&
          !key.includes("other-private-token"),
      ),
    );
    assert.ok(
      !JSON.stringify([...entries.values()]).includes(
        "private-synthetic-token",
      ),
    );
  } finally {
    host.__incrementalCache = original;
  }
});
