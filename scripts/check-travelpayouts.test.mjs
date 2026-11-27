import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  checkOrigin as protectedCheckOrigin,
  diagnosticAdmission,
} from "./check-travelpayouts.mjs";
// Existing response-contract fixtures explicitly admit synthetic requests.
const checkOrigin = (
  token,
  origin,
  fetcher,
  now,
  timeout = 4000,
  mode = "exact",
) =>
  protectedCheckOrigin(
    token,
    origin,
    fetcher,
    now,
    timeout,
    mode,
    async () => "allowed",
  );
const secret = "private-diagnostic-token";
const now = new Date("2026-10-06T12:00:00Z");
test("diagnostic requests PRN and ZRH once each and emits only safe normalized fields", async () => {
  const origins = [];
  const fetcher = async (url, options) => {
    origins.push(url.searchParams.get("origin"));
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.get("departure_at"), "2026-11-05");
    assert.equal(url.searchParams.get("return_at"), "2026-11-08");
    assert.equal(options.headers["X-Access-Token"], secret);
    assert.equal(options.redirect, "error");
    assert.ok(!url.toString().includes(secret));
    return Response.json({
      success: true,
      private: secret,
      data: [
        {
          destination: "VIE",
          departure_at: "2026-11-05T10:00:00",
          return_at: "2026-11-08T12:00:00",
          private: secret,
        },
        { destination: secret, departure_at: secret },
      ],
    });
  };
  for (const origin of ["PRN", "ZRH"]) {
    const report = await checkOrigin(secret, origin, fetcher, now);
    assert.equal(report.authentication, "OK");
    assert.equal(report.httpStatus, 200);
    assert.equal(report.faresReturned, 2);
    assert.deepEqual(report.destinationAirports, ["VIE"]);
    assert.deepEqual(report.fareDates[0], {
      departure: "2026-11-05",
      return: "2026-11-08",
    });
    assert.ok(!JSON.stringify(report).includes(secret));
  }
  assert.deepEqual(origins, ["PRN", "ZRH"]);
});
test("diagnostic safely handles authentication, rate limits, rejection, malformed and oversized responses", async () => {
  for (const [response, reason, auth] of [
    [new Response(secret, { status: 401 }), "authentication-failed", "failed"],
    [new Response(secret, { status: 429 }), "rate-limit", "not confirmed"],
    [
      Response.json({ success: false, error: secret }),
      "provider-rejected-request",
      "not confirmed",
    ],
    [new Response(secret), "malformed-response", "not confirmed"],
    [new Response("x".repeat(128001)), "response-too-large", "not confirmed"],
  ]) {
    const report = await checkOrigin(secret, "PRN", async () => response, now);
    assert.equal(report.failureReason, reason);
    assert.equal(report.authentication, auth);
    assert.ok(!JSON.stringify(report).includes(secret));
  }
});
test("diagnostic timeout and network exceptions never expose error text", async () => {
  const timeout = await checkOrigin(
    secret,
    "PRN",
    async (_url, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error(secret))),
      ),
    now,
    5,
  );
  assert.equal(timeout.failureReason, "timeout");
  const failure = await checkOrigin(
    secret,
    "ZRH",
    async () => {
      throw new Error(secret);
    },
    now,
  );
  assert.equal(failure.failureReason, "network-error");
  assert.ok(!JSON.stringify([timeout, failure]).includes(secret));
});

test("diagnostic supports separate safe exact and month reports", async () => {
  const queries = [];
  for (const mode of ["exact", "month"]) {
    const report = await checkOrigin(
      secret,
      "PRN",
      async (url) => {
        queries.push([
          url.searchParams.get("departure_at"),
          url.searchParams.get("return_at"),
        ]);
        return Response.json({ success: true, data: [] });
      },
      now,
      4000,
      mode,
    );
    assert.equal(report.mode, mode);
    assert.equal(report.authentication, "OK");
    assert.equal(report.failureReason, null);
  }
  assert.deepEqual(queries, [
    ["2026-11-05", "2026-11-08"],
    ["2026-11", "2026-11"],
  ]);
});

test("standalone default diagnostic denies missing Redis without a provider request", () => {
  const result = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { checkOrigin } from ${JSON.stringify(new URL("./check-travelpayouts.mjs", import.meta.url).href)};
    let requests = 0;
    const report = await checkOrigin("synthetic-only", "PRN", async () => {
      requests++; return Response.json({ success: true, data: [] });
    });
    console.log(JSON.stringify({ report, requests }));
  `,
    ],
    { env: {}, encoding: "utf8" },
  );
  const { report, requests } = JSON.parse(result);
  assert.equal(requests, 0);
  assert.equal(report.failureReason, "provider-admission-unavailable");
  assert.equal(report.authentication, "not confirmed");
  assert.equal(report.httpStatus, null);
});

test("diagnostic uses the actual shared Redis guard for allow, quota and failure outcomes", async () => {
  const redis = {
    url: "https://synthetic.upstash.io",
    token: "synthetic-redis-only",
  };
  // npm test compiles this exact production implementation before these tests.
  const loadShared = () =>
    import("../.test-build/src/server/provider-admission.js");
  const { providerAdmissionScript, PROVIDER_ENDPOINTS } =
    await loadShared();
  for (const [reply, expected] of [
    [1, null],
    [0, "rate-limit"],
    [2, "provider-admission-unavailable"],
    ["failure", "provider-admission-unavailable"],
    ["malformed", "provider-admission-unavailable"],
  ]) {
    let redisCalls = 0,
      providerCalls = 0;
    const admission = diagnosticAdmission(
      redis,
      async (_url, init) => {
        redisCalls++;
        const command = JSON.parse(init.body);
        assert.deepEqual(command.slice(0, 6), [
          "EVAL",
          providerAdmissionScript,
          "1",
          PROVIDER_ENDPOINTS["/aviasales/v3/prices_for_dates"].key,
          "65000",
          "600",
        ]);
        if (reply === "failure") throw Error(secret);
        return reply === "malformed"
          ? new Response(secret)
          : Response.json({ result: reply });
      },
      loadShared,
    );
    const report = await protectedCheckOrigin(
      secret,
      "PRN",
      async () => {
        providerCalls++;
        return Response.json({ success: true, data: [] });
      },
      now,
      4000,
      "exact",
      admission,
    );
    assert.equal(redisCalls, 1);
    assert.equal(providerCalls, reply === 1 ? 1 : 0);
    assert.equal(report.failureReason, expected);
    assert.equal(report.authentication, reply === 1 ? "OK" : "not confirmed");
    assert.ok(!JSON.stringify(report).includes(secret));
    assert.ok(!JSON.stringify(report).includes(redis.token));
  }
});

test("missing guard output and late admission never fall back to an unguarded diagnostic fetch", async () => {
  let providerCalls = 0;
  const fetcher = async () => {
    providerCalls++;
    return Response.json({ success: true, data: [] });
  };
  const missingBuild = diagnosticAdmission(
    { url: "https://synthetic.upstash.io", token: "synthetic-only" },
    async () => {
      throw Error("Unexpected Redis request");
    },
    async () => {
      throw Error(secret);
    },
  );
  const blocked = await protectedCheckOrigin(
    secret,
    "PRN",
    fetcher,
    now,
    100,
    "exact",
    missingBuild,
  );
  assert.equal(blocked.failureReason, "provider-admission-unavailable");
  const late = await protectedCheckOrigin(
    secret,
    "PRN",
    fetcher,
    now,
    5,
    "exact",
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "allowed";
    },
  );
  assert.equal(late.failureReason, "timeout");
  assert.equal(providerCalls, 0);
  assert.ok(!JSON.stringify([blocked, late]).includes(secret));
});
