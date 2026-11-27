import { test } from "node:test";
import assert from "node:assert/strict";
import { storageTriggerBytes, storageUsage } from "../scripts/check-storage";

const limit = 1024 ** 3;
const usage = (bytes: number, limitBytes = limit) =>
  storageUsage({
    used_bytes: String(bytes),
    limit_bytes: String(limitBytes),
  });

test("capacity review triggers strictly above 600 MiB under the 1 GiB limit", () => {
  assert.equal(storageTriggerBytes, 629_145_600);
  assert.equal(usage(0).triggerBytes, storageTriggerBytes);
  // Expected four-origin range (about 430-530 MB) stays quiet.
  assert.equal(usage(530 * 1000 ** 2).status, "ok");
  assert.equal(usage(storageTriggerBytes).status, "ok");
  assert.equal(usage(storageTriggerBytes + 1).status, "alert");
  assert.equal(usage(limit + 1).status, "alert");
  assert.equal(usage(64 * 1024 ** 2).percentUsed, 6.25);
});

test("the trigger is never later than 60% of the enforced limit", () => {
  const small = 500 * 1000 ** 2;
  assert.equal(usage(0, small).triggerBytes, 300_000_000);
  assert.equal(usage(300_000_000, small).status, "ok");
  assert.equal(usage(300_000_001, small).status, "alert");
  assert.equal(
    storageUsage({ used_bytes: "601", limit_bytes: "1000" }).status,
    "alert",
  );
  assert.equal(
    storageUsage({ used_bytes: "600", limit_bytes: "1000" }).status,
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
