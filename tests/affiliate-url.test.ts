import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePartnerUrl,
  equivalentAviasalesSearch,
} from "../src/providers/server/affiliate-url";
import { createAviasalesAffiliate } from "../src/providers/server/aviasales-affiliate";
import {
  checkAffiliate,
  formatAffiliateReport,
} from "../scripts/check-affiliate";

const env = {
  TRAVELPAYOUTS_API_TOKEN: "synthetic-secret-token",
  TRAVELPAYOUTS_PROJECT_ID: "987654321012",
  TRAVELPAYOUTS_MARKER: "987654321013",
};
const destination = "https://www.aviasales.com/search/PRN0511VIE08111";
const now = new Date("2026-10-06T12:00:00Z");
function redirect(changes: Record<string, string | null | undefined> = {}) {
  const url = new URL("https://tp.media/r");
  const values = {
    marker: `${env.TRAVELPAYOUTS_MARKER}.trip_flight`,
    trs: env.TRAVELPAYOUTS_PROJECT_ID,
    p: "4114",
    campaign_id: "100",
    u: destination,
    ...changes,
  };
  for (const [key, value] of Object.entries(values))
    if (value != null) url.searchParams.set(key, value);
  return url.href;
}
function response(partner: string, original = destination) {
  return Response.json({
    code: "success",
    status: 200,
    result: {
      links: [{ code: "success", url: original, partner_url: partner }],
    },
  });
}

test("known short hosts accept opaque tracking identifiers without confusing them with the API token", () => {
  for (const host of ["avs.io", "aviasales.tp.st", "aviasales.tpo.lu"]) {
    for (const code of [
      "ExampleLink",
      env.TRAVELPAYOUTS_MARKER,
      env.TRAVELPAYOUTS_PROJECT_ID,
    ]) {
      const result = validatePartnerUrl(
        `https://${host}/${code}?erid=ExampleAdId`,
        env,
      );
      assert.equal(result.reason, null);
      assert.equal(result.partnerPathShape, "/:short-code");
    }
  }
});
test("tp.media accepts documented Aviasales redirects, configured tracking IDs and fixed placement SubIDs", () => {
  for (const value of [
    redirect(),
    redirect({ campaign_id: null }),
    redirect({ trs: null, marker: env.TRAVELPAYOUTS_MARKER }),
    redirect({ u: destination.replace("www.", "") + "/" }),
  ]) {
    const result = validatePartnerUrl(value, env, destination, "trip");
    assert.equal(result.reason, null);
    assert.equal(result.partnerLinkHost, "tp.media");
    assert.equal(result.partnerPathShape, "/r");
  }
  assert.equal(
    validatePartnerUrl(
      redirect({ marker: `${env.TRAVELPAYOUTS_MARKER}.results_flight` }),
      env,
      destination,
      "results",
    ).reason,
    null,
  );
  assert.equal(
    validatePartnerUrl(redirect(), env, destination, "results").reason,
    "unexpected query value",
  );
  assert.equal(
    validatePartnerUrl(redirect(), env).reason,
    "destination mismatch",
  );
});
test("tp.media rejects unknown/duplicate parameters, wrong attribution/program values and unknown paths", () => {
  for (const value of [
    redirect({ redirect: "https://evil.example" }),
    redirect({ url: destination }),
    redirect({ token: "ignored" }),
  ])
    assert.equal(
      validatePartnerUrl(value, env, destination).reason,
      "unexpected query key",
    );
  for (const change of [
    { p: "9999" },
    { campaign_id: "200" },
    { marker: "999" },
    { marker: `${env.TRAVELPAYOUTS_MARKER}.private-text` },
    { trs: "999" },
    { marker: null },
    { p: null },
    { erid: "" },
  ])
    assert.equal(
      validatePartnerUrl(redirect(change), env, destination).reason,
      "unexpected query value",
    );
  for (const suffix of [
    "&u=" + encodeURIComponent(destination),
    "&marker=" + env.TRAVELPAYOUTS_MARKER,
    "&%75=https://evil.example",
  ])
    assert.equal(
      validatePartnerUrl(redirect() + suffix, env, destination).reason,
      "unexpected query value",
    );
  assert.equal(
    validatePartnerUrl(
      redirect().replace("/r?", "/redirect?"),
      env,
      destination,
    ).reason,
    "unexpected path",
  );
});
test("tp.media cannot redirect to other domains, non-search pages or different trip dates/party", () => {
  for (const u of [
    "https://evil.example/search/PRN0511VIE08111",
    "https://www.aviasales.com.evil.example/search/PRN0511VIE08111",
    "https://www.aviasales.com@evil.example/search/PRN0511VIE08111",
    "https://sub.aviasales.com/search/PRN0511VIE08111",
    "http://www.aviasales.com/search/PRN0511VIE08111",
    "//www.aviasales.com/search/PRN0511VIE08111",
    "https://www.aviasales.com",
    "https://www.aviasales.com/redirect?url=https://evil.example",
    destination + "?redirect=https://evil.example",
    destination + "#fragment",
    destination.replace("0511", "0611"),
    destination + "2",
    destination.replace("/search/", "/other/../search/"),
    destination.replace("/search/", "/other/%2e%2e/search/"),
    encodeURIComponent(destination),
    destination.replace("/search/", "/search%2f"),
    destination.replace("PRN", "%2550RN"),
    destination.replace("www.aviasales.com", "www.aviasales.com:8443"),
    destination.replace("www.aviasales.com", "user@www.aviasales.com"),
  ])
    assert.equal(
      validatePartnerUrl(redirect({ u }), env, destination).reason,
      "destination mismatch",
      u,
    );
});
test("original URL comparison accepts bounded canonicalization but preserves search semantics", () => {
  for (const equivalent of [
    destination,
    destination.replace("www.", ""),
    destination + "/",
    destination.replace(
      "https://www.aviasales.com",
      "HTTPS://WWW.AVIASALES.COM:443",
    ),
    destination.replace("PRN", "%50RN"),
  ])
    assert.equal(
      equivalentAviasalesSearch(equivalent, destination),
      true,
      equivalent,
    );
  for (const mismatch of [
    destination + "?ignored=1",
    destination + "#ignored",
    destination.replace("PRN", "ZRH"),
    destination.replace("0511", "0611"),
    destination + "1",
    "https://evil.example",
    undefined,
  ])
    assert.equal(equivalentAviasalesSearch(mismatch, destination), false);
});
test("partner validation rejects lookalikes, unsafe URLs, alternate tpo.lu hosts and short-link redirect parameters", () => {
  for (const host of [
    "evil.example",
    "avs.io.evil.example",
    "tp.media.evil.example",
    "nested.aviasales.tp.st",
    "other.tpo.lu",
    "aviasales.tpo.lu.evil.example",
  ])
    assert.equal(
      validatePartnerUrl(`https://${host}/Example`, env, destination).reason,
      "unsupported partner host",
    );
  for (const value of [
    "http://avs.io/Example",
    "https://user@avs.io/Example",
    "https://avs.io:444/Example",
    "https://avs.io/Example#fragment",
    "https://avs.io/Example\n",
    "https://avs.io/\\Example",
    "https://avs.io/%ZZ",
  ])
    assert.equal(validatePartnerUrl(value, env).reason, "unsafe partner URL");
  assert.equal(
    validatePartnerUrl("https://avs.io/Example?u=https://evil.example", env)
      .reason,
    "unexpected query key",
  );
  assert.equal(
    validatePartnerUrl("https://avs.io/Example?erid=a&erid=b", env).reason,
    "unexpected query value",
  );
});
test("API token is rejected raw, encoded, nested, and in normalized host names without diagnostic leakage", async () => {
  const encoded = env.TRAVELPAYOUTS_API_TOKEN.split("")
    .map((c) => "%" + c.charCodeAt(0).toString(16))
    .join("");
  for (const partner of [
    `https://avs.io/${env.TRAVELPAYOUTS_API_TOKEN}`,
    `https://avs.io/${encoded}`,
    `https://avs.io/Example?erid=${encodeURIComponent(encoded)}`,
    `https://${env.TRAVELPAYOUTS_API_TOKEN.toUpperCase()}.tp.st/Example`,
    redirect({ u: destination + "?token=" + env.TRAVELPAYOUTS_API_TOKEN }),
  ]) {
    const result = validatePartnerUrl(partner, env, destination);
    assert.equal(result.reason, "API token in partner URL");
    assert.equal(result.partnerLinkHost, null);
    const report = await checkAffiliate(
      env,
      async () => response(partner),
      now,
    );
    assert.equal(report.adapterStatus, "unavailable");
    assert.ok(
      !formatAffiliateReport(report, env).includes(env.TRAVELPAYOUTS_API_TOKEN),
    );
  }
});
test("production adapter accepts canonical original URLs and tp.media tracking URLs; diagnostics omit tracking", async () => {
  const partner = redirect();
  const report = await checkAffiliate(
    env,
    async () => response(partner, destination.replace("www.", "") + "/"),
    now,
  );
  assert.equal(report.adapterStatus, "available");
  assert.equal(report.partnerLinkHost, "tp.media");
  const output = formatAffiliateReport(report, env);
  for (const forbidden of [
    ...Object.values(env),
    partner,
    "trip_flight",
    "X-Access-Token",
  ])
    assert.ok(!output.includes(forbidden));
  const result = await createAviasalesAffiliate(
    env,
    async () => response(partner),
    () => "2026-10-06",
  ).createLink(
    {
      originCode: "PRN",
      destinationCode: "VIE",
      departureDate: "2026-11-05",
      returnDate: "2026-11-08",
      party: { adults: 1, children: 0 },
    },
    "trip",
  );
  assert.equal(result.status, "available");
  if (result.status === "available") assert.equal(result.link.url, partner);
});
test("diagnostic gives safe specific validation failures without printing full links or raw values", async () => {
  for (const [partner, original, reason] of [
    [
      "https://evil.example/PrivateTrackingPath",
      destination,
      "unsupported partner host",
    ],
    [
      "https://avs.io/PrivateTrackingPath/extra",
      destination,
      "unexpected path",
    ],
    [
      "https://avs.io/PrivateTrackingPath?PrivateKey=PrivateValue",
      destination,
      "unexpected query key",
    ],
    [redirect({ u: destination + "2" }), destination, "destination mismatch"],
    [
      "https://avs.io/PrivateTrackingPath",
      destination + "2",
      "original URL normalization mismatch",
    ],
  ]) {
    const report = await checkAffiliate(
      env,
      async () => response(partner, original),
      now,
    );
    assert.equal(report.httpStatus, 200);
    assert.equal(report.providerCode, "success");
    assert.equal(report.linkCode, "success");
    assert.equal(report.failureReason, reason);
    const output = formatAffiliateReport(report, env);
    for (const privateValue of [
      "PrivateTrackingPath",
      "PrivateKey",
      "PrivateValue",
      ...Object.values(env),
    ])
      assert.ok(!output.includes(privateValue));
  }
});
