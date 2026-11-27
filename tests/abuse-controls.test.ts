import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sharedReadCache } from "../src/server/shared-read-cache";
import { limits } from "../src/server/rate-limit";

test("shared reads are cached for their TTL, shared by concurrent misses, and failures are not cached", async () => {
  let t = 0;
  let loads = 0;
  const read = sharedReadCache<number>({
    ttlMs: 300_000,
    maxEntries: 2,
    now: () => t,
  });
  const load = async () => ++loads;
  assert.equal(await read("WAW|2026-12", load), 1);
  assert.equal(await read("WAW|2026-12", load), 1);
  t = 299_999;
  assert.equal(await read("WAW|2026-12", load), 1);
  t = 300_001;
  assert.equal(await read("WAW|2026-12", load), 2);
  const [a, b] = await Promise.all([
    read("LON|2026-12", load),
    read("LON|2026-12", load),
  ]);
  assert.equal(a, b);
  assert.equal(loads, 3);
  let fail = true;
  const flaky = async () => (fail ? undefined : 7);
  assert.equal(await read("BCN|2026-12", flaky), undefined);
  fail = false;
  assert.equal(await read("BCN|2026-12", flaky), 7);
  await read("TIA|2026-12", load);
  const before = loads;
  await read("WAW|2026-12", load);
  assert.equal(loads, before + 1);
});

test("CTA-view beacons have their own quota, so they cannot use up partner-link creation", () => {
  assert.ok(limits["affiliate-view"] > 0);
  assert.equal(limits.affiliate, 40);
  assert.match(
    readFileSync("src/app/api/affiliate/event/route.ts", "utf8"),
    /allowOperation\("affiliate-view"\)/,
  );
  assert.match(
    readFileSync("src/app/api/affiliate/flights/route.ts", "utf8"),
    /allowOperation\("affiliate"\)/,
  );
});
