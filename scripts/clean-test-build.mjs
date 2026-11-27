import { rmSync } from "node:fs";

// This directory contains only generated test output. Never reuse deleted/renamed tests.
rmSync(new URL("../.test-build/", import.meta.url), {
  recursive: true,
  force: true,
});
