import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePreviewArguments } from "./preview-destination-content.mjs";

test("local preview takes generic stable IDs and English without an approval option", () => {
  assert.deepEqual(
    parsePreviewArguments(["--destination", "region:future"], {}),
    { destination: "region:future", locale: "en", port: 4173, nights: 2 },
  );
  assert.deepEqual(
    parsePreviewArguments(
      ["--destination", "city:BCN", "--locale", "en", "--port", "4180"],
      {},
    ),
    { destination: "city:BCN", locale: "en", port: 4180, nights: 2 },
  );
  for (const args of [
    [],
    ["--destination", "../secret"],
    ["--destination", "x", "--host", "0.0.0.0"],
    ["--destination", "x", "--approve", "yes"],
    ["--destination", "x", "--pilot", "phase2"],
    ["--destination", "london", "--pilot", "other"],
    ["--destination", "x", "--locale", "de"],
    ["--destination", "x", "--nights", "30"],
    ["--destination", "x", "--port", "80"],
    ["--destination", "x", "--port", "99999"],
    ["--destination", "x", "--destination", "y"],
  ])
    assert.throws(() => parsePreviewArguments(args, {}));
});
test("preview refuses production environments", () => {
  for (const env of [{ NODE_ENV: "production" }, { VERCEL: "1" }])
    assert.throws(
      () => parsePreviewArguments(["--destination", "crete"], env),
      /local-only/,
    );
});

test("browser review sample is bounded and cannot select missing or approved records", async () => {
  const { selectPreviewRecords } =
    await import("./lib/content-preview-selection.mjs");
  const records = ["city:BCN", "crete", "prishtina", "place:Q123"].map(
    (destinationId) => ({ destinationId, reviewStatus: "draft" }),
  );
  assert.equal(
    selectPreviewRecords(records, "place:Q123")[0].destinationId,
    "place:Q123",
  );
  assert.equal(selectPreviewRecords(records, "").length, 3);
  for (const selection of [
    "unknown",
    "crete,crete",
    Array.from({ length: 9 }, (_, i) => `place:${i}`).join(","),
  ])
    assert.throws(() => selectPreviewRecords(records, selection));
  assert.throws(() =>
    selectPreviewRecords(
      [{ destinationId: "x", reviewStatus: "reviewed" }],
      "x",
    ),
  );
});

test("review media paths are an exact bounded allowlist and cannot read arbitrary files", async () => {
  const { previewMediaFile } = await import("./lib/content-preview-media.mjs");
  assert.match(
    previewMediaFile("/review-media/vienna-1200.webp"),
    /phase2\/vienna-1200.webp$/,
  );
  for (const path of [
    "/review-media/../.env",
    "/review-media/london-2000.webp",
    "/review-media/paris-640.webp",
    "/review-media/vienna-1200.webp?x=1",
  ])
    assert.equal(previewMediaFile(path), undefined);
  assert.equal(
    parsePreviewArguments(["--destination", "vienna", "--nights", "3"], {})
      .nights,
    3,
  );
});
