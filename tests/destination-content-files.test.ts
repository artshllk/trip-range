import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDestinationContentFiles } from "../scripts/lib/destination-content-files";

function withDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "goeksplo-content-test-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
test("content manifest and one-file-per-destination records must match exactly", () => {
  withDirectory((directory) => {
    assert.deepEqual(checkDestinationContentFiles(directory, []), {
      ok: true,
      files: 0,
    });
    const record = { destinationId: "synthetic", overview: "test only" };
    writeFileSync(join(directory, "synthetic.json"), JSON.stringify(record));
    assert.deepEqual(checkDestinationContentFiles(directory, [record]), {
      ok: true,
      files: 1,
    });
    assert.equal(checkDestinationContentFiles(directory, []).ok, false);
    assert.equal(
      checkDestinationContentFiles(directory, [
        { ...record, overview: "changed" },
      ]).ok,
      false,
    );
    assert.equal(
      checkDestinationContentFiles(directory, [record, record]).ok,
      false,
    );
  });
});
test("content audit rejects malformed, oversized, unsafe or symlink record files", () => {
  for (const kind of [
    "malformed",
    "oversized",
    "unsafe-name",
    "symlink",
  ] as const) {
    withDirectory((directory) => {
      const file = join(
        directory,
        kind === "unsafe-name" ? "unsafe name.json" : "synthetic.json",
      );
      if (kind === "symlink") symlinkSync("/does-not-exist", file);
      else
        writeFileSync(
          file,
          kind === "malformed"
            ? "{"
            : kind === "oversized"
              ? "x".repeat(256_001)
              : "{}",
        );
      assert.equal(
        checkDestinationContentFiles(directory, [{}]).ok,
        false,
        kind,
      );
    });
  }
});
