import assert from "node:assert/strict";
import test from "node:test";
import {
  clientAddress,
  clientBucket,
  clientCode,
  clientLimits,
  createClientLimiter,
  refuseOverLimit,
} from "../src/server/client-limit";
import { validateEnvironment } from "../src/config/environment";

const redis = { url: "https://example-db.upstash.io", token: "test-token-123" };
const namespace = "goeksplo:v2:test";

/** An in-memory stand-in for the Upstash REST endpoint, counting commands. */
function fakeUpstash(options: { fail?: () => boolean; delayMs?: number } = {}) {
  const store = new Map<string, number>();
  const ttl = new Map<string, number>();
  const commands: string[][] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const command = JSON.parse(String(init.body)) as string[];
    commands.push(command);
    if (options.delayMs)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, options.delayMs);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    if (options.fail?.()) return new Response("{}", { status: 500 });
    let result: unknown = null;
    if (command[0] === "INCR") {
      result = (store.get(command[1]) ?? 0) + 1;
      store.set(command[1], result as number);
    } else if (command[0] === "PEXPIRE") {
      result = store.has(command[1]) ? 1 : 0;
      if (result) ttl.set(command[1], Number(command[2]));
    }
    return Response.json({ result });
  }) as unknown as typeof fetch;
  return { fetcher, commands, store, ttl };
}

test("the client is the last x-forwarded-for entry: IPv4 in full, IPv6 by /64", () => {
  assert.equal(clientAddress("198.51.100.4"), "198.51.100.4");
  // Earlier entries are whatever the client sent; only the last one counts.
  assert.equal(
    clientAddress("203.0.113.7, 2001:db8::1, 198.51.100.4"),
    "198.51.100.4",
  );
  assert.equal(clientAddress("203.0.113.7,198.51.100.4"), "198.51.100.4");
  assert.equal(
    clientAddress("203.0.113.7, 2a02:810d:4b40:3a00:1c2e:9f3:aa1:5"),
    "2a02:810d:4b40:3a00::/64",
  );
  // Different interface IDs in one /64 are one client; another /64 is not.
  assert.equal(
    clientAddress("2a02:810d:4b40:3a00::1"),
    clientAddress("2A02:810D:4B40:3A00:ffff:ffff:ffff:ffff"),
  );
  assert.notEqual(
    clientAddress("2a02:810d:4b40:3a00::1"),
    clientAddress("2a02:810d:4b40:3a01::1"),
  );
  assert.equal(clientAddress("::ffff:198.51.100.4"), "198.51.100.4");
  assert.equal(clientAddress("2001:db8::"), "2001:db8:0:0::/64");
  for (const bad of [
    null,
    "",
    "203.0.113.7,",
    "unknown",
    "256.1.1.1",
    "198.51.100.4:4444",
    "[2001:db8::1]:443",
    "2001:db8::1::2",
    "2001:db8:1:2:3:4:5:6:7",
    "fe80::1%eth0",
  ])
    assert.equal(clientAddress(bad), undefined, String(bad));
});

test("limits apply to /plan in any locale and to /api, with beacons counted apart", () => {
  assert.equal(clientBucket("/plan"), "plan");
  assert.equal(clientBucket("/plan/results"), "plan");
  assert.equal(clientBucket("/sq/plan"), "plan");
  assert.equal(clientBucket("/planner"), undefined);
  assert.equal(clientBucket("/"), undefined);
  assert.equal(clientBucket("/destinations/rome"), undefined);
  assert.equal(clientBucket("/api/locations"), "api");
  assert.equal(clientBucket("/api/affiliate/flights"), "api");
  assert.equal(clientBucket("/api/affiliate/event"), "beacon");
  assert.deepEqual(clientLimits, { plan: 60, api: 20, beacon: 60 });
});

test("client codes are short, stable within a UTC day and change the next day", async () => {
  const secret = "s".repeat(40);
  const day = new Date("2026-11-25T10:00:00Z");
  const a = await clientCode("198.51.100.4", secret, day);
  assert.match(a, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(
    a,
    await clientCode("198.51.100.4", secret, new Date("2026-11-25T23:59:59Z")),
  );
  assert.notEqual(a, await clientCode("198.51.100.5", secret, day));
  assert.notEqual(
    a,
    await clientCode("198.51.100.4", secret, new Date("2026-11-26T00:00:00Z")),
  );
  assert.notEqual(a, await clientCode("198.51.100.4", "t".repeat(40), day));
  assert.ok(!a.includes("198"));
});

test("about one Redis command per request; refused clients are refused from memory", async () => {
  const up = fakeUpstash();
  let t = 1_800_000_000_000; // a window boundary
  const limiter = createClientLimiter({
    redis,
    namespace,
    fetcher: up.fetcher,
    now: () => t,
    report: () => {},
  });
  for (let i = 1; i <= 20; i++)
    assert.deepEqual(
      await limiter.check("api", "client-a"),
      { allowed: true },
      `request ${i}`,
    );
  // 20 requests: 20 INCR and one PEXPIRE, set on the first increment only.
  assert.equal(up.commands.filter((c) => c[0] === "INCR").length, 20);
  assert.deepEqual(
    up.commands.filter((c) => c[0] === "PEXPIRE").map((c) => c[2]),
    ["60000"],
  );
  const key = up.commands[0][1];
  assert.equal(key, `${namespace}:client:api:${t / 60000}:client-a`);
  assert.equal(up.ttl.get(key), 60000);
  t += 15_000;
  const refused = await limiter.check("api", "client-a");
  assert.deepEqual(refused, { allowed: false, retryAfterSeconds: 45 });
  const sent = up.commands.length;
  for (let i = 0; i < 50; i++)
    assert.equal((await limiter.check("api", "client-a")).allowed, false);
  assert.equal(up.commands.length, sent, "no Redis calls once refused");
  // Other clients and other buckets are unaffected.
  assert.equal((await limiter.check("api", "client-b")).allowed, true);
  assert.equal((await limiter.check("plan", "client-a")).allowed, true);
  // The next window starts clean.
  t += 45_000;
  assert.equal((await limiter.check("api", "client-a")).allowed, true);
});

test("/plan allows 60 a minute and refuses the 61st", async () => {
  const up = fakeUpstash();
  const limiter = createClientLimiter({
    redis,
    namespace,
    fetcher: up.fetcher,
    now: () => 0,
    report: () => {},
  });
  for (let i = 1; i <= 60; i++)
    assert.equal((await limiter.check("plan", "c")).allowed, true);
  assert.equal((await limiter.check("plan", "c")).allowed, false);
});

test("Redis errors and timeouts let the request through", async () => {
  const notes: string[] = [];
  const failing = fakeUpstash({ fail: () => true });
  const limiter = createClientLimiter({
    redis,
    namespace,
    fetcher: failing.fetcher,
    now: () => 0,
    report: (n) => notes.push(n),
  });
  for (let i = 0; i < 30; i++)
    assert.equal((await limiter.check("api", "c")).allowed, true);
  assert.ok(notes.every((n) => n === "fail-open") && notes.length === 30);

  const slow = fakeUpstash({ delayMs: 400 });
  const timed = createClientLimiter({
    redis,
    namespace,
    fetcher: slow.fetcher,
    now: () => 0,
    timeoutMs: 150,
    report: () => {},
  });
  const start = Date.now();
  assert.equal((await timed.check("api", "c")).allowed, true);
  assert.ok(Date.now() - start < 350, "gave up at the timeout");
});

test("over its Redis budget an instance counts in memory for the rest of the minute", async () => {
  const up = fakeUpstash();
  const notes: string[] = [];
  let t = 0;
  const limiter = createClientLimiter({
    redis,
    namespace,
    fetcher: up.fetcher,
    now: () => t,
    redisCallsPerMinute: 10,
    report: (n) => notes.push(n),
  });
  for (let i = 0; i < 5; i++) await limiter.check("api", `c${i}`); // 5 INCR + 5 PEXPIRE
  const sent = up.commands.length;
  assert.equal(sent, 10);
  for (let i = 1; i <= 20; i++)
    assert.equal((await limiter.check("api", "x")).allowed, true);
  assert.equal((await limiter.check("api", "x")).allowed, false);
  assert.equal(up.commands.length, sent, "no Redis calls over budget");
  assert.ok(notes.includes("budget-exceeded"));
  t = 60_000;
  await limiter.check("api", "x");
  assert.equal(up.commands.length, sent + 2, "Redis again in the next minute");
});

test("a failed expiry is retried on the client's next request", async () => {
  let failExpire = true;
  const up = fakeUpstash();
  const base = up.fetcher;
  const fetcher = (async (url: string, init: RequestInit) => {
    const c = JSON.parse(String(init.body));
    if (c[0] === "PEXPIRE" && failExpire)
      return new Response("{}", { status: 500 });
    return base(url, init);
  }) as unknown as typeof fetch;
  const limiter = createClientLimiter({
    redis,
    namespace,
    fetcher,
    now: () => 0,
    report: () => {},
  });
  await limiter.check("api", "c");
  assert.equal(up.ttl.size, 0);
  failExpire = false;
  await limiter.check("api", "c");
  assert.equal(up.ttl.size, 1);
  await limiter.check("api", "c");
  assert.equal(up.commands.filter((c) => c[0] === "PEXPIRE").length, 1);
});

test("the proxy entry point: missing address or configuration fails open; refusals are 429", async () => {
  const env = { limiterNamespace: namespace };
  const reasons: string[] = [];
  const realWarn = console.warn;
  console.warn = (line: string) => reasons.push(JSON.parse(line).status);
  await refuseOverLimit("/api/health", new Headers(), env);
  console.warn = realWarn;
  assert.deepEqual(reasons, ["no-database"]);
  const h = (xff?: string) =>
    new Headers(xff ? { "x-forwarded-for": xff } : {});
  assert.equal(
    await refuseOverLimit("/plan", h("198.51.100.4"), env),
    undefined,
  );
  const configured = {
    limiterNamespace: namespace,
    clientLimit: {
      redis: { url: "https://refused.upstash.io", token: "x".repeat(12) },
      secret: "s".repeat(40),
    },
  };
  assert.equal(await refuseOverLimit("/plan", h(), configured), undefined);
  assert.equal(
    await refuseOverLimit("/plan", h("not-an-address"), configured),
    undefined,
  );
  assert.equal(
    await refuseOverLimit("/about", h("198.51.100.4"), configured),
    undefined,
  );

  const realFetch = globalThis.fetch;
  const up = fakeUpstash();
  globalThis.fetch = up.fetcher;
  try {
    let response: Response | undefined;
    for (let i = 0; i <= 20 && !response; i++)
      response = await refuseOverLimit(
        "/api/locations",
        h("203.0.113.9, 198.51.100.4"),
        configured,
      );
    assert.equal(response?.status, 429);
    assert.equal(response?.headers.get("cache-control"), "no-store");
    assert.match(response?.headers.get("retry-after") ?? "", /^\d+$/);
    assert.deepEqual(await response?.json(), { status: "rate-limited" });
    // A spoofed first entry does not move the client to a fresh counter.
    assert.equal(
      (
        await refuseOverLimit(
          "/api/locations",
          h("192.0.2.200, 198.51.100.4"),
          configured,
        )
      )?.status,
      429,
    );
    // No key or log line holds the address.
    assert.ok(up.commands.every((c) => !c.join(" ").includes("198.51.100")));
    let page: Response | undefined;
    for (let i = 0; i <= 60 && !page; i++)
      page = await refuseOverLimit("/plan", h("198.51.100.4"), configured);
    assert.equal(page?.status, 429);
    assert.match(page?.headers.get("content-type") ?? "", /^text\/plain/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the per-client limiter uses the limiter's database and needs only its secret", () => {
  const base = {
    GOEKSPLO_LOG_LEVEL: "off",
    RATE_LIMIT_REDIS_REST_URL: "https://limiter-db.upstash.io",
    RATE_LIMIT_REDIS_REST_TOKEN: "t".repeat(20),
  };
  assert.deepEqual(
    validateEnvironment({ ...base, CLIENT_LIMIT_SECRET: "s".repeat(40) })
      .clientLimit,
    {
      redis: { url: "https://limiter-db.upstash.io", token: "t".repeat(20) },
      secret: "s".repeat(40),
    },
  );
  // No secret, a short secret, or no limiter database: off, and requests are served.
  assert.equal(validateEnvironment(base).clientLimit, undefined);
  const short = validateEnvironment({
    ...base,
    CLIENT_LIMIT_SECRET: "short-secret-123",
  });
  assert.equal(short.clientLimit, undefined);
  assert.ok(short.invalid.includes("CLIENT_LIMIT_SECRET"));
  assert.equal(
    validateEnvironment({
      GOEKSPLO_LOG_LEVEL: "off",
      CLIENT_LIMIT_SECRET: "s".repeat(40),
    }).clientLimit,
    undefined,
  );
});
