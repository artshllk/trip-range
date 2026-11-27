import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAffiliate,
  formatAffiliateReport,
} from "../scripts/check-affiliate";
const env = {
  TRAVELPAYOUTS_API_TOKEN: "synthetic-secret-token",
  TRAVELPAYOUTS_PROJECT_ID: "987654321012",
  TRAVELPAYOUTS_MARKER: "987654321013",
};
const now = new Date("2026-10-06T12:00:00Z");
test("affiliate diagnostic uses one production conversion and prints only safe metadata and host", async () => {
  let calls = 0;
  const report = await checkAffiliate(
    env,
    async (url, options) => {
      calls++;
      assert.equal(url, "https://api.travelpayouts.com/links/v1/create");
      assert.ok(
        new Headers(options.headers).get("X-Access-Token") ===
          env.TRAVELPAYOUTS_API_TOKEN,
      );
      const body = JSON.parse(String(options.body));
      assert.ok(body.trs === Number(env.TRAVELPAYOUTS_PROJECT_ID));
      assert.ok(body.marker === Number(env.TRAVELPAYOUTS_MARKER));
      assert.deepEqual(body.links, [
        {
          url: "https://www.aviasales.com/search/PRN0511VIE08111",
          sub_id: "trip_flight",
        },
      ]);
      return Response.json({
        code: "success",
        status: 200,
        result: {
          links: [
            {
              url: body.links[0].url,
              code: "success",
              partner_url:
                "https://aviasales.tp.st/PrivateTrackingPath?erid=PrivateTrackingId",
            },
          ],
        },
      });
    },
    now,
  );
  assert.equal(calls, 1);
  assert.deepEqual(report, {
    configurationPresent: { token: "yes", project: "yes", marker: "yes" },
    destinationUrl: "https://www.aviasales.com/search/PRN0511VIE08111",
    httpStatus: 200,
    providerCode: "success",
    providerStatus: 200,
    linkCode: "success",
    adapterStatus: "available",
    failureReason: null,
    partnerLinkHost: "aviasales.tp.st",
    partnerPathShape: "/:short-code",
  });
  const output = formatAffiliateReport(report, env);
  for (const forbidden of [
    ...Object.values(env),
    "PrivateTrackingPath",
    "PrivateTrackingId",
    "X-Access-Token",
  ])
    assert.ok(!output.includes(forbidden));
});
test("missing configuration reports yes/no without an upstream call", async () => {
  const report = await checkAffiliate(
    { ...env, TRAVELPAYOUTS_MARKER: undefined },
    async () => {
      assert.fail("No request expected");
    },
    now,
  );
  assert.deepEqual(report.configurationPresent, {
    token: "yes",
    project: "yes",
    marker: "no",
  });
  assert.equal(report.failureReason, "configuration");
  assert.equal(report.httpStatus, null);
});
test("non-2xx diagnostics retain provider status but discard echoed secrets and raw messages", async () => {
  for (const [httpStatus, reason] of [
    [401, "authentication"],
    [429, "rate-limit"],
    [503, "provider"],
  ] as const) {
    const report = await checkAffiliate(
      env,
      async () =>
        Response.json(
          {
            code: "incorrect_request_body",
            status: httpStatus,
            error: Object.values(env).join(" "),
            result: {
              links: [
                {
                  code: "failed",
                  message: "https://avs.io/PrivateTrackingPath",
                },
              ],
            },
          },
          { status: httpStatus },
        ),
      now,
    );
    assert.equal(report.httpStatus, httpStatus);
    assert.equal(report.providerStatus, httpStatus);
    assert.equal(report.providerCode, "incorrect_request_body");
    assert.equal(report.linkCode, "failed");
    assert.equal(report.failureReason, reason);
    const output = formatAffiliateReport(report, env);
    for (const secret of [...Object.values(env), "PrivateTrackingPath"])
      assert.ok(!output.includes(secret));
  }
});
test("untrusted codes/statuses, malformed bodies, oversized responses and exceptions cannot leak", async () => {
  const reports = [];
  reports.push(
    await checkAffiliate(
      env,
      async () =>
        Response.json({
          code: env.TRAVELPAYOUTS_API_TOKEN,
          status: env.TRAVELPAYOUTS_PROJECT_ID,
          result: { links: [{ code: env.TRAVELPAYOUTS_MARKER }] },
        }),
      now,
    ),
  );
  assert.equal(reports[0].providerCode, "unrecognized");
  assert.equal(reports[0].providerStatus, null);
  assert.equal(reports[0].linkCode, "unrecognized");
  for (const body of [env.TRAVELPAYOUTS_API_TOKEN, "x".repeat(65537)])
    reports.push(
      await checkAffiliate(env, async () => new Response(body), now),
    );
  reports.push(
    await checkAffiliate(
      env,
      async () => {
        throw Error(Object.values(env).join(" "));
      },
      now,
    ),
  );
  for (const report of reports) {
    assert.ok(report.failureReason);
    for (const secret of Object.values(env))
      assert.ok(!formatAffiliateReport(report, env).includes(secret));
  }
});
test("timeouts stay bounded for both response headers and body and preserve known HTTP status", async () => {
  const slowHeaders = await checkAffiliate(
    env,
    async () => new Promise<Response>(() => {}),
    now,
    5,
  );
  assert.equal(slowHeaders.failureReason, "timeout");
  assert.equal(slowHeaders.httpStatus, null);
  const slowBody = await checkAffiliate(
    env,
    async () =>
      new Response(new ReadableStream({ start() {} }), { status: 429 }),
    now,
    5,
  );
  assert.equal(slowBody.failureReason, "timeout");
  assert.equal(slowBody.httpStatus, 429);
});
test("report formatting redacts even collisions with safe fields and JSON-escaped credentials", async () => {
  const report = await checkAffiliate(
    { ...env, TRAVELPAYOUTS_MARKER: undefined },
    async () => {
      throw Error();
    },
    now,
  );
  const output = formatAffiliateReport(report, {
    TRAVELPAYOUTS_API_TOKEN: "configuration",
    TRAVELPAYOUTS_PROJECT_ID: "PRN",
    TRAVELPAYOUTS_MARKER: "no",
  });
  for (const secret of ["configuration", "PRN", "no"])
    assert.ok(!output.includes(secret));
  const encoded = formatAffiliateReport(
    { ...report, failureReason: 'token"quoted' as typeof report.failureReason },
    { ...env, TRAVELPAYOUTS_API_TOKEN: 'token"quoted' },
  );
  assert.ok(!encoded.includes('token\\"quoted'));
});
