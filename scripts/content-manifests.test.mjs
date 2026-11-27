import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readManifestRecords,
  manifestText,
  manifests,
  runManifests,
} from "./content-manifests.mjs";

test("checked static manifests match files without writes or network", () => {
  runManifests(true);
});
test("manifest generator uses deterministic file ordering and rejects duplicates/unsafe files", () => {
  const dir = mkdtempSync(join(tmpdir(), "place-manifest-"));
  try {
    writeFileSync(join(dir, "b.json"), JSON.stringify({ subject: "b" }));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ subject: "a" }));
    const entries = readManifestRecords(dir, "subject");
    assert.deepEqual(
      entries.map((e) => e.file),
      ["a.json", "b.json"],
    );
    assert.equal(
      manifestText(manifests[0], entries),
      manifestText(manifests[0], readManifestRecords(dir, "subject")),
    );
    writeFileSync(join(dir, "c.json"), JSON.stringify({ subject: "a" }));
    assert.throws(() => readManifestRecords(dir, "subject"));
    rmSync(join(dir, "c.json"));
    symlinkSync(join(dir, "a.json"), join(dir, "c.json"));
    assert.throws(() => readManifestRecords(dir, "subject"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
