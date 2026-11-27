/** Offline review-surface QA; synthetic image intercepted locally, no media-provider calls. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const {
  reviewHtml,
} = require("../.test-build/src/media/operator/calibration/report.js");
const {
  evaluateCandidate,
} = require("../.test-build/src/media/operator/evaluate.js");
const dataset = JSON.parse(
  readFileSync("docs/research/destination-media/dataset.json", "utf8"),
);
const report = JSON.parse(
  readFileSync(
    "docs/research/destination-media/runs/calibration-2026-10-10-first10.json",
    "utf8",
  ),
);
const approved = JSON.parse(
  readFileSync("tests/fixtures/media/approved.synthetic.json", "utf8"),
);
const synthetic = structuredClone(report),
  row = synthetic.rows[0];
row.identity = {
  ...row.identity,
  external: { authority: "wikidata", id: "Q84" },
  resolutionMethod: "transport-code",
  confidence: "high",
  resolvedAt: report.finishedAt,
  unresolvedReason: null,
};
row.status = "complete";
row.failures = [];
row.failureCategories = [];
synthetic.stopReason = "complete";
row.candidates = [
  {
    candidate: evaluateCandidate(
      row.identity,
      "destination.card",
      approved.assets[0],
      "T1",
      {
        entity: row.identity.external,
        exactEntityImage: true,
        exactDepicts: false,
        depictionTags: ["cityscape"],
        articleUsage: false,
        recognizedQuality: false,
        withinBounds: false,
      },
    ),
    sourceProperties: ["P18"],
    review: {
      imageRelevant: "uncertain",
      roleFit: "uncertain",
      method: "pending",
      reviewedAt: null,
      reviewerNotes:
        "Synthetic browser fixture only. Human visual review pending.",
    },
  },
];
const output =
  process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-calibration-review";
mkdirSync(output, { recursive: true });
const raster = await require("sharp")({
  create: { width: 330, height: 220, channels: 3, background: "#c8dadd" },
})
  .png()
  .toBuffer();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://upload.wikimedia.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: raster }),
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, data] of [
      ["live-stopped", report],
      ["synthetic-review", synthetic],
    ]) {
      await page.setContent(reviewHtml(data, dataset));
      if (name === "synthetic-review")
        await page.locator("h1").evaluate((el) => {
          el.textContent =
            "Synthetic browser fixture — not live calibration evidence";
        });
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.locator("script").count(), 0);
      assert.match(
        await page.locator("body").innerText(),
        /Automatic approval and ingestion OFF/,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      if (name === "synthetic-review") {
        await page.locator("img").evaluate((e) => e.decode());
        assert.equal(await page.locator("article").count(), 1);
        assert.match(
          await page.locator("article").innerText(),
          /Synthetic fixture photographer/,
        );
        assert.match(
          await page.locator("article").innerText(),
          /relevant: uncertain/,
        );
        assert.equal(
          await page
            .getByRole("link", { name: "Commons source and licence" })
            .getAttribute("href"),
          approved.assets[0].sourcePage,
        );
      } else {
        assert.equal(await page.locator("img").count(), 0);
        assert.match(await page.locator("body").innerText(), /rate-limit/);
      }
      await page.screenshot({
        path: `${output}/${name}-${width}.png`,
        fullPage: true,
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS local research report at 1440/390/320: stopped-run evidence, synthetic pending candidate, source/licence, no script/overflow/client errors or live provider requests",
  );
} finally {
  await browser.close();
}
