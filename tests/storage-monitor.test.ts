import { test } from "node:test";
import assert from "node:assert/strict";
import { storageTriggerBytes, storageUsage } from "../scripts/check-storage";

const limit = 1024 ** 3;
const usage = (bytes: number, limitBytes = limit) =>
  storageUsage({
    used_bytes: String(bytes),
    limit_bytes: String(limitBytes),
  });

test("capacity review triggers strictly above 800 MiB under the 1 GiB limit", () => {
  assert.equal(storageTriggerBytes, 838_860_800);
  assert.equal(usage(0).triggerBytes, storageTriggerBytes);
  // Projected trip-length range (about 545 MB settled, 700 MB at month start) stays quiet.
  assert.equal(usage(700 * 1000 ** 2).status, "ok");
  // The old 600 MiB trigger no longer fires.
  assert.equal(usage(629_145_601).status, "ok");
  assert.equal(usage(storageTriggerBytes).status, "ok");
  assert.equal(usage(storageTriggerBytes + 1).status, "alert");
  assert.equal(usage(limit + 1).status, "alert");
  assert.equal(usage(64 * 1024 ** 2).percentUsed, 6.25);
});

test("under a lower limit the trigger scales to the same share (800/1024)", () => {
  const small = 512 * 1024 ** 2;
  assert.equal(usage(0, small).triggerBytes, 400 * 1024 ** 2);
  assert.equal(usage(400 * 1024 ** 2, small).status, "ok");
  assert.equal(usage(400 * 1024 ** 2 + 1, small).status, "alert");
  assert.equal(
    storageUsage({ used_bytes: "782", limit_bytes: "1000" }).status,
    "alert",
  );
  assert.equal(
    storageUsage({ used_bytes: "781", limit_bytes: "1000" }).status,
    "ok",
  );
});

test("unavailable or invalid measurements cannot report healthy capacity", () => {
  for (const value of [
    null,
    undefined,
    "",
    "NaN",
    "-1",
    "1.5",
    "9007199254740992",
  ]) {
    assert.throws(() =>
      storageUsage({ used_bytes: value, limit_bytes: String(limit) }),
    );
    assert.throws(() => storageUsage({ used_bytes: "64", limit_bytes: value }));
  }
  assert.throws(() => storageUsage({ used_bytes: "64", limit_bytes: "0" }));
});
