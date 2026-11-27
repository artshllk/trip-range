import { test } from "node:test";
import assert from "node:assert/strict";
import { assessNextAdvisories, fetchNextAdvisories } from "./check-next-advisories.mjs";

const ids = ["pc58-hwjq-p385", "rhh4-g77r-r9qj", "vvgp-ww4w-46vf",
  "7qx7-33qx-rqx2", "mfr8-8qww-v76h", "vc7v-qv4w-wrv8", "f3mh-rxg3-f5g2"];
const feed = () => ids.map((id) => ({
  ghsa_id: "GHSA-" + id, published_at: "2026-11-03T18:39:48Z", severity: "medium",
  vulnerabilities: [{ package: { ecosystem: "npm", name: "next" },
    vulnerable_version_range: ">= 16.0.0, <= 16.4.4" }],
}));
test("reviewed patch passes, vulnerable baseline and incomplete feed fail", () => {
  assert.deepEqual(assessNextAdvisories("16.4.6", feed()), []);
  assert.throws(() => assessNextAdvisories("16.4.1", feed()), /baseline/);
  assert.throws(() => assessNextAdvisories("16.4.6", []), /Incomplete/);
});
test("a newly published matching advisory blocks even before npm indexes it", () => {
  const data = feed();
  data.push({ ...data[0], ghsa_id: "GHSA-new-notice",
    vulnerabilities: [{ ...data[0].vulnerabilities[0], vulnerable_version_range: ">= 16.4.0, < 16.4.7" }] });
  assert.deepEqual(assessNextAdvisories("16.4.6", data), ["GHSA-new-notice"]);
  data.at(-1).vulnerabilities[0].vulnerable_version_range = "unknown";
  assert.throws(() => assessNextAdvisories("16.4.6", data), /review required/);
});
test("lookup refusal, outage and malformed responses never pass", async () => {
  await assert.rejects(fetchNextAdvisories(async () => new Response("", { status: 429 })), /429/);
  await assert.rejects(fetchNextAdvisories(async () => { throw Error("offline"); }), /offline/);
  await assert.rejects(fetchNextAdvisories(async () => Response.json({ error: true })), /Malformed/);
});
test("all advisory pages are inspected", async () => {
  let calls = 0;
  const result = await fetchNextAdvisories(async () => Response.json(
    ++calls === 1 ? Array.from({ length: 100 }, () => feed()[0]) : feed(),
  ));
  assert.equal(calls, 2);
  assert.equal(result.length, 107);
});
