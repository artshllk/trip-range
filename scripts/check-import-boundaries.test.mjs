import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkImportBoundaries } from "./check-import-boundaries.mjs";
test("security scan follows transitive client imports but ignores erased type imports", () => {
  const files = new Map([
    [
      "src/components/Test.tsx",
      '"use client"; import { helper } from "../helpers";',
    ],
    [
      "src/helpers.ts",
      'export { validateEnvironment as helper } from "./config/environment";',
    ],
    [
      "src/config/environment.ts",
      "export const validateEnvironment = () => {};",
    ],
  ]);
  assert.equal(checkImportBoundaries(files).length, 1);
  files.set(
    "src/helpers.ts",
    'import type { Config } from "./config/environment"; export const helper = 1;',
  );
  assert.deepEqual(checkImportBoundaries(files), []);
  files.set(
    "src/helpers.ts",
    'export const helper = () => import("@/config/environment");',
  );
  assert.equal(checkImportBoundaries(files).length, 1);
});
test("production sources cannot import test fixture or diagnostic code", () => {
  for (const code of [
    'import "../scripts/fixtures/seo.mjs";',
    'const fixture = require("../tests/fixture");',
    'export { default } from "../scripts/check";',
  ]) {
    assert.equal(
      checkImportBoundaries(new Map([["src/test.ts", code]])).length,
      1,
    );
  }
});

test("rendering cannot reach media identity, candidate discovery or evaluation through indirect imports", () => {
  for (const target of [
    "src/places/adapters/wikidata.ts",
    "src/media/adapters/commons.ts",
    "src/media/operator/evaluate.ts",
    "src/media/operator/discover.ts",
    "src/providers/server/image-candidates.ts",
  ]) {
    const files = new Map([
      ["src/app/page.tsx", 'import { value } from "../helper";'],
      [
        "src/helper.ts",
        `export const value = () => import("@/${target.slice(4, -3)}");`,
      ],
      [target, "export const value = 1;"],
    ]);
    assert.ok(
      checkImportBoundaries(files).some(
        (e) => e.reason === "Runtime graph reaches operator-only media code",
      ),
    );
  }
});
test("rendering may consume approved store contracts and adapter without operator code", () => {
  const files = new Map([
    [
      "src/app/page.tsx",
      'import { store } from "../media/runtime/approved"; import type { MediaCandidate } from "../media/operator/evaluate";',
    ],
    [
      "src/media/runtime/approved.ts",
      'import { createStore } from "./store"; export const store = createStore();',
    ],
    [
      "src/media/runtime/store.ts",
      "export const createStore = () => ({ get() {} });",
    ],
  ]);
  assert.deepEqual(checkImportBoundaries(files), []);
});
test("calibration research data and metrics cannot enter page rendering", () => {
  for (const target of [
    "../../docs/research/destination-media/dataset.json",
    "../media/operator/calibration/metrics",
  ]) {
    assert.ok(
      checkImportBoundaries(
        new Map([["src/app/page.tsx", `import data from "${target}";`]]),
      ).some(
        (e) => e.reason === "Runtime graph reaches operator-only media code",
      ),
    );
  }
});

test("runtime cannot reach destination content research through imports, reexports, dynamic imports or require", () => {
  const researchTargets = [
    "src/content/operator/research.ts",
    "src/content/adapters/wikidata.ts",
    "src/content/adapters/osm.ts",
  ];
  for (const root of [
    "src/app/page.tsx",
    "src/components/Trip.tsx",
    "src/services/travel.ts",
    "src/seo/data.ts",
    "src/content/runtime/store.ts",
  ]) {
    for (const target of researchTargets) {
      const modulePath = "@/" + target.slice(4, -3);
      for (const edge of [
        `import { value } from "${modulePath}";`,
        `export * from "${modulePath}";`,
        `export { value } from "${modulePath}";`,
        `export const value = () => import("${modulePath}");`,
        `export const value = () => import(\`${modulePath}\`);`,
        `export const value = () => import("${modulePath}", { with: { type: "json" } });`,
        `const value = require("${modulePath}");`,
        `import value = require("${modulePath}");`,
      ]) {
        const files = new Map([
          [root, 'import { value } from "@/content-helper";'],
          ["src/content-helper.ts", 'export * from "./content-helper-next";'],
          ["src/content-helper-next.ts", edge],
          [target, "export const value = 1;"],
        ]);
        assert.ok(
          checkImportBoundaries(files).some(
            (e) =>
              e.path === root &&
              e.reason ===
                "Runtime graph reaches operator-only destination content code",
          ),
          `${root} must not reach ${target} through ${edge}`,
        );
      }
    }
  }
});

test("content runtime cannot reuse live media APIs or import candidate reports and operator scripts", () => {
  for (const [target, expectedReason] of [
    ["src/media/adapters/api.ts", "media"],
    ["src/places/adapters/wikidata.ts", "media"],
    ["src/places/operator/identity.ts", "media"],
    ["scripts/research-destination-content.ts", "destination content"],
    ["docs/research/destination-content/report.json", "destination content"],
  ]) {
    const files = new Map([
      [
        "src/content/runtime/approved.ts",
        'export * from "../../content-helper";',
      ],
      ["src/content-helper.ts", `import data from "../${target}";`],
      [target, "export const value = 1;"],
    ]);
    assert.ok(
      checkImportBoundaries(files).some(
        (e) =>
          e.path === "src/content/runtime/approved.ts" &&
          e.reason ===
            `Runtime graph reaches operator-only ${expectedReason} code`,
      ),
    );
  }
});

test("runtime may use pure content domain records and the reviewed store, with erased research types", () => {
  const files = new Map([
    [
      "src/app/page.tsx",
      'import { store } from "@/content/runtime/approved"; import type { Candidate } from "@/content/operator/research";',
    ],
    [
      "src/content/runtime/approved.ts",
      'import "server-only"; import { createStore } from "./store"; import records from "../../../content/destinations/index.json"; export const store = createStore(records);',
    ],
    [
      "src/content/runtime/store.ts",
      'import { validate } from "@/domain/destination-content/validation"; import { type Candidate } from "../operator/research"; export { type Fact } from "../adapters/wikidata"; export type { Entity } from "../adapters/osm"; export const createStore = (records) => validate(records);',
    ],
    [
      "src/domain/destination-content/validation.ts",
      'import type { DestinationContent } from "./types"; export const validate = (records) => records;',
    ],
    [
      "src/domain/destination-content/types.ts",
      "export interface DestinationContent {}",
    ],
    ["content/destinations/index.json", "[]"],
  ]);
  assert.deepEqual(checkImportBoundaries(files), []);
});

test("runtime guard resolves JavaScript import specifiers to TypeScript source and JavaScript barrel indexes", () => {
  for (const [specifier, helperPath] of [
    ["@/content-helper.js", "src/content-helper.ts"],
    ["@/content-helper.js", "src/content-helper.tsx"],
    ["@/content-helper.mjs", "src/content-helper.mts"],
    ["@/content-helper.cjs", "src/content-helper.cts"],
    ["@/content-helper", "src/content-helper/index.js"],
    ["@/content-helper", "src/content-helper/index.mjs"],
  ]) {
    const files = new Map([
      ["src/content/runtime/store.ts", `export * from "${specifier}";`],
      [helperPath, 'export * from "@/content/adapters/wikidata";'],
      ["src/content/adapters/wikidata.ts", "export const value = 1;"],
    ]);
    assert.ok(
      checkImportBoundaries(files).some(
        (e) =>
          e.path === "src/content/runtime/store.ts" &&
          e.reason ===
            "Runtime graph reaches operator-only destination content code",
      ),
      `${specifier} should resolve to ${helperPath}`,
    );
  }
});

test("reviewed-content manifests outside src cannot bridge runtime into research or diagnostic code", () => {
  const files = new Map([
    ["src/app/page.tsx", 'export * from "@/content/runtime/approved";'],
    [
      "src/content/runtime/approved.ts",
      'export * from "../../../content/destinations/records";',
    ],
    [
      "content/destinations/records.ts",
      'export * from "../../src/content/operator/research";',
    ],
    ["src/content/operator/research.ts", "export const records = [];"],
  ]);
  assert.ok(
    checkImportBoundaries(files).some(
      (e) =>
        e.path === "src/app/page.tsx" &&
        e.reason ===
          "Runtime graph reaches operator-only destination content code",
    ),
  );
  files.set(
    "content/destinations/records.ts",
    'export * from "../../scripts/check-destination-content";',
  );
  assert.ok(
    checkImportBoundaries(files).some(
      (e) =>
        e.path === "content/destinations/records.ts" &&
        e.reason === "Production import of test/diagnostic code forbidden",
    ),
  );
});

test("security command includes source-controlled content manifests in its actual source graph", () => {
  const dir = mkdtempSync(join(tmpdir(), "goeksplo-content-boundary-"));
  try {
    execFileSync("git", ["init", "--quiet", dir]);
    mkdirSync(join(dir, "src/content/runtime"), { recursive: true });
    mkdirSync(join(dir, "src/content/operator"), { recursive: true });
    mkdirSync(join(dir, "content/destinations"), { recursive: true });
    writeFileSync(join(dir, ".env.example"), "");
    writeFileSync(
      join(dir, "src/content/runtime/approved.ts"),
      'export * from "../../../content/destinations/records";',
    );
    writeFileSync(
      join(dir, "content/destinations/records.ts"),
      'export * from "../../src/content/operator/research";',
    );
    writeFileSync(
      join(dir, "src/content/operator/research.ts"),
      "export const records = [];",
    );
    const command = `import { checkSecurity } from ${JSON.stringify(new URL("./check-security.mjs", import.meta.url).href)}; console.log(JSON.stringify(checkSecurity()));`;
    const failures = JSON.parse(
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", command],
        {
          cwd: dir,
          encoding: "utf8",
        },
      ),
    );
    assert.ok(
      failures.some(
        (e) =>
          e.path === "src/content/runtime/approved.ts" &&
          e.reason ===
            "Runtime graph reaches operator-only destination content code",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime cannot reach research metadata, queue or neutral place discovery", () => {
  for (const target of [
    "content/research/destinations/records.ts",
    "content/operations/queue/records.ts",
    "src/places/adapters/wikidata.ts",
    "src/places/operator/identity.ts",
  ]) {
    const files = new Map([
      [
        "src/content/runtime/approved.ts",
        `import data from "../../../${target}";`,
      ],
      [target, "export const data = [];"],
    ]);
    assert.ok(checkImportBoundaries(files).length, target);
  }
});

test("client components cannot import canonical or operational records directly", () => {
  for (const target of [
    "content/places/records.ts",
    "content/places/example.json",
    "content/research/destinations/records.ts",
    "content/operations/queue/records.ts",
  ]) {
    const files = new Map([
      [
        "src/components/example.tsx",
        `'use client'; import data from "../../${target}";`,
      ],
      [target, "export const data = [];"],
    ]);
    assert.ok(
      checkImportBoundaries(files).some(
        (failure) =>
          failure.reason ===
          "Client graph reaches server-only configuration/code",
      ),
      target,
    );
  }
});

test("editorial approvals, maintenance and review metadata cannot enter runtime or client graphs", () => {
  for (const target of [
    "content/operations/reviews/synthetic.json",
    "content/archive/cost-scope-2026-11-02/destinations/synthetic.json",
    "content/operations/editorial-findings.json",
    "src/content/operator/editorial.ts",
    "scripts/lib/editorial-commands.ts",
    "scripts/lib/editorial-maintenance.ts",
  ]) {
    const path = "src/content/runtime/bridge.ts";
    const relative = target.startsWith("src/")
      ? "../../" + target.slice(4)
      : "../../../" + target;
    const files = new Map([
      ["src/app/page.tsx", 'import "@/content/runtime/bridge";'],
      [path, `import "${relative}";`],
      [target, "export const data = {};"],
    ]);
    assert.ok(checkImportBoundaries(files).length > 0, target);
  }
});
