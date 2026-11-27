/** Real FullTrip and reviewed-content slots. Synthetic isolated harness; no app fixture route. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { build } = require(process.env.ESBUILD_MODULE || "esbuild");
const sharp = require("sharp");
const en = JSON.parse(readFileSync("src/i18n/en.json", "utf8"));
const sq = JSON.parse(readFileSync("src/i18n/sq.json", "utf8"));
const output =
  process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-trip-detail-browser";
mkdirSync(output, { recursive: true });
const files = readdirSync(".next/static", { recursive: true }).filter(
  (path) => typeof path === "string",
);
const css = files
  .filter((path) => path.endsWith(".css"))
  .map((path) => readFileSync(resolve(".next/static", path), "utf8"))
  .join("\n");
assert.ok(
  css.length > 1000,
  "Build production CSS before browser verification",
);
const bundle = await build({
  entryPoints: ["tests/fixtures/trip-detail-browser.tsx"],
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: {
    "process.env": "{}",
    "process.env.NODE_ENV": '"production"',
    "process.env.__NEXT_IMAGE_OPTS": JSON.stringify({
      deviceSizes: [640, 1080],
      imageSizes: [32, 64],
      path: "/_next/image",
      loader: "default",
      unoptimized: true,
      remotePatterns: [],
    }),
  },
});
const raster = await sharp({
  create: {
    width: 1000,
    height: 600,
    channels: 3,
    background: "#c8dadd",
  },
})
  .png()
  .toBuffer();
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/fixture.js") {
    response.setHeader("Content-Type", "application/javascript");
    return response.end(bundle.outputFiles[0].contents);
  }
  if (path === "/destinations/qa-trusted.png") {
    response.setHeader("Content-Type", "image/png");
    return response.end(raster);
  }
  if (path === "/destinations/qa-failed.png") {
    response.writeHead(503);
    return response.end();
  }
  if (path.startsWith("/_next/static/") && files.includes(path.slice(14)))
    return response.end(readFileSync(resolve(".next/static", path.slice(14))));
  if (path === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }
  response.setHeader("Content-Type", "text/html");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const harness = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "setup";
try {
  const page = await browser.newPage();
  const errors = [],
    forbidden = [],
    affiliate = [];
  let manualAffiliateClick = false;
  page.on("pageerror", (error) => errors.push(`${stage}: ${error.message}`));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/affiliate/flights") {
      affiliate.push(request.postDataJSON());
      if (!manualAffiliateClick)
        forbidden.push(`${stage}: automatic affiliate request`);
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"status":"unavailable"}',
      });
    }
    if (url.pathname.startsWith("/_vercel/"))
      return route.fulfill({ status: 204, body: "" });
    if (
      url.origin !== harness ||
      /\/api\/(?:ai|content|media)/.test(url.pathname)
    ) {
      forbidden.push(`${stage}: ${url.hostname}`);
      return route.abort();
    }
    return route.continue();
  });
  const screenshots = [];
  let baselineSpend;
  const scenarios = [
    "rich",
    "none",
    "partial",
    "expired",
    "withdrawn",
    "unpriced",
    "reference",
    "road",
    "provider-unavailable",
    "hero",
    "failed-image",
    "long",
  ];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const scenario of scenarios) {
      const locale = scenario === "long" ? "sq" : "en";
      const t = locale === "sq" ? sq : en;
      stage = `${scenario}-${locale}-${width}`;
      await page.goto(`${harness}/?scenario=${scenario}&locale=${locale}`);
      await page.locator(".trip-detail-page").waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator("h1").count(), 1, stage);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        `No horizontal overflow: ${stage}`,
      );
      const headings = await page
        .locator("h1,h2,h3,h4,h5,h6")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            level: Number(node.tagName.slice(1)),
            text: node.textContent.trim(),
          })),
        );
      assert.ok(
        headings.every((heading) => heading.text),
        `No empty headings: ${stage}`,
      );
      for (let index = 1; index < headings.length; index++)
        assert.ok(
          headings[index].level <= headings[index - 1].level + 1,
          `Logical heading order: ${stage} ${headings[index].text}`,
        );
      const budget = page.locator(".trip-budget");
      await budget.waitFor();
      assert.ok(
        (await budget.boundingBox()).y < (width === 1440 ? 600 : 900),
        `Budget appears early: ${stage}`,
      );
      const budgetText = await budget.innerText();
      const unpriced = [
        "unpriced",
        "reference",
        "provider-unavailable",
      ].includes(scenario);
      if (unpriced) {
        assert.equal(
          await page.locator("#root").getAttribute("data-estimated-spend"),
          "",
        );
        assert.equal(await budget.locator(".fit").count(), 0);
        assert.match(budgetText, /estimated non-flight costs/);
        assert.ok(
          !budgetText.includes(t.left),
          `No invented remainder: ${stage}`,
        );
        assert.ok(
          !budgetText.includes(t.estimatedSpend),
          `No fake trip total: ${stage}`,
        );
        assert.equal(
          await budget.locator("#price-details .result-flight-limit").count(),
          1,
        );
      } else {
        assert.ok(
          Number(
            await page.locator("#root").getAttribute("data-estimated-spend"),
          ) > 0,
        );
        assert.ok(
          (await page.locator("#price-details").textContent()).includes(
            t.safetyBuffer,
          ),
          `Reserve preserved: ${stage}`,
        );
        if (scenario !== "road") {
          const spend = await page
            .locator("#root")
            .getAttribute("data-estimated-spend");
          baselineSpend ??= spend;
          assert.equal(
            spend,
            baselineSpend,
            `Editorial content never changes total: ${stage}`,
          );
        }
      }
      if (scenario === "none" || scenario === "withdrawn") {
        assert.equal(
          await page.locator("#root").getAttribute("data-content"),
          "none",
        );
        assert.equal(
          await page.locator("#worth-seeing, #getting-around").count(),
          0,
        );
        assert.match(await page.locator("#days").innerText(), /Trip outline/);
        assert.match(
          await page.locator("#days").innerText(),
          /generic|general/i,
        );
      } else {
        assert.equal(
          await page.locator("#root").getAttribute("data-content"),
          "reviewed",
        );
        assert.equal(await page.locator("#worth-seeing").count(), 1);
        if (scenario === "partial") {
          assert.equal(await page.locator("#getting-around").count(), 0);
          assert.match(await page.locator("#days").innerText(), /Trip outline/);
        } else {
          assert.equal(await page.locator("#getting-around").count(), 1);
          assert.ok((await page.locator("#worth-seeing h3").count()) >= 5);
        }
      }
      assert.equal(
        await page.locator("#worth-seeing img").count(),
        0,
        `Attractions remain text first: ${stage}`,
      );
      if (scenario === "expired") {
        const text = await page.locator("main").innerText();
        assert.ok(!text.includes("Seasonal Glasshouse"));
        assert.ok(!text.includes("Synthetic current closure note"));
        assert.ok(!text.includes("Synthetic transit observation"));
        assert.equal(
          await page.locator(".trip-content-observation").count(),
          0,
        );
        assert.equal(await page.locator("#worth-seeing h3").count(), 5);
      }
      if (scenario === "rich") {
        const observation = page.locator(".trip-content-observation");
        assert.match(await observation.innerText(), /4\.5 EUR/);
        assert.match(await observation.innerText(), /9 Oct 2026/);
        assert.match(
          await observation.innerText(),
          /does not change your trip budget/,
        );
        const sourceLink = observation.locator(
          'a[href^="#destination-source-"]',
        );
        const target = await sourceLink.getAttribute("href");
        await sourceLink.click();
        assert.equal(
          await page.locator(`[id="${target.slice(1)}"]`).isVisible(),
          true,
          "Observed price source link reveals its actual source",
        );
      }
      if (scenario === "hero") {
        await page
          .locator(".trip-overview img")
          .evaluate((image) => image.decode());
        assert.equal(
          await page.locator(".trip-overview .destination-no-image").count(),
          0,
        );
        const photoCredit = page.locator(".trip-photo-credit > summary");
        await photoCredit.focus();
        await page.keyboard.press("Enter");
        assert.equal(
          await photoCredit.evaluate((element) => element.parentElement.open),
          true,
        );
        assert.match(
          await page.locator(".trip-photo-credit").innerText(),
          /Synthetic fixture photographer/,
        );
        assert.match(
          await page.locator(".trip-photo-credit").innerText(),
          /Synthetic test licence/,
        );
        await page.keyboard.press("Enter");
        assert.equal(
          await photoCredit.evaluate((element) => element.parentElement.open),
          false,
        );
      } else {
        if (scenario === "failed-image")
          await page.locator(".trip-overview .destination-no-image").waitFor();
        else
          assert.equal(
            await page.locator(".trip-overview-no-photo").count(),
            1,
          );
        assert.equal(await page.locator(".trip-overview img").count(), 0);
      }
      await page.locator("#trip-sources").evaluate((element) => {
        element.open = false;
      });
      assert.equal(
        await page.locator("#price-details[open], #trip-sources[open]").count(),
        0,
      );
      assert.equal(
        await page.locator(".trip-document-note, .trip-content-card").count(),
        0,
      );
      const disclosure = page.locator("#trip-sources > summary").first();
      await disclosure.focus();
      assert.ok(
        await disclosure.evaluate((element) =>
          getComputedStyle(element, "::after").content.includes("+"),
        ),
        "Closed native source disclosure has a visible affordance",
      );
      await page.keyboard.press("Enter");
      assert.equal(
        await disclosure.evaluate((element) => element.parentElement.open),
        true,
      );
      assert.ok(
        await disclosure.evaluate((element) =>
          getComputedStyle(element, "::after").content.includes("−"),
        ),
        "Open native source disclosure has a visible affordance",
      );
      await page.keyboard.press("Enter");
      assert.equal(
        await disclosure.evaluate((element) => element.parentElement.open),
        false,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      const screenshot = `${output}/${stage}.png`;
      await page.screenshot({
        path: screenshot,
        fullPage: true,
        animations: "disabled",
      });
      screenshots.push(screenshot);
      if (
        ["rich", "none", "unpriced", "reference", "hero", "long"].includes(
          scenario,
        )
      )
        await page.screenshot({
          path: `${output}/${stage}-first-screen.png`,
          fullPage: false,
          animations: "disabled",
        });
      console.log(
        `PASS ${stage}: pricing, reviewed sections, source disclosure, image safety, layout`,
      );
    }
    stage = `edit-search-${width}`;
    await page.goto(`${harness}/?scenario=none`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: en.editSearch, exact: true })
      .click();
    await page.locator("dialog[open]").waitFor();
    await page.locator("dialog .search-field").nth(2).click();
    assert.equal(await page.locator("dialog[open]").count(), 1);
    assert.equal(await page.locator("dialog .search-inline-editor").count(), 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    console.log(
      `PASS ${stage}: one editable sheet and reduced-motion dismissal`,
    );
  }
  stage = "reference handoff actual dates";
  await page.goto(`${harness}/?scenario=reference`);
  const bookingBox = await page
    .locator(".affiliate-action button")
    .boundingBox();
  assert.ok(
    bookingBox.y + bookingBox.height <= 844,
    "Reference-fare flight action remains fully visible on the first 320px screen",
  );
  const reference = page.locator(".trip-budget");
  await reference.waitFor();
  assert.equal(
    await reference.locator('time[datetime="2026-11-12"]').count(),
    1,
  );
  assert.equal(
    await reference.locator('time[datetime="2026-11-14"]').count(),
    1,
  );
  assert.ok((await page.locator(".trip-overview").innerText()).includes("7"));
  assert.equal(
    affiliate.length,
    0,
    "Rendering never requests affiliate conversion",
  );
  manualAffiliateClick = true;
  await page.locator(".affiliate-action button").click();
  await page
    .getByRole("status")
    .filter({ hasText: en.flightLinkUnavailable })
    .waitFor();
  assert.equal(affiliate.length, 1);
  assert.deepEqual(affiliate[0].route, {
    originCode: "PRN",
    destinationCode: "VIE",
    departureDate: "2026-11-07",
    returnDate: "2026-11-09",
    party: { adults: 2, children: 0 },
  });
  assert.equal(affiliate[0].placement, "trip");
  assert.equal(
    await page.locator(".trip-detail-page").count(),
    1,
    "Affiliate failure preserves trip",
  );
  console.log(
    "PASS manual affiliate retry: actual trip dates, no automatic request, trip retained on failure",
  );
  stage = "200 percent zoom long SQ";
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${harness}/?scenario=long&locale=sq`);
  await page.locator(".trip-detail-page").waitFor();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll("main *")].some(
        (element) => element.getBoundingClientRect().right > innerWidth + 1,
      ),
    ),
    false,
    "200% zoom: no content extends beyond the viewport",
  );
  await page.screenshot({
    path: `${output}/long-sq-200-percent-zoom.png`,
    fullPage: true,
    animations: "disabled",
  });
  console.log(
    "PASS 200% zoom: Albanian, long names, responsive layout, no horizontal overflow",
  );
  assert.deepEqual(
    forbidden,
    [],
    "No content/media research, AI, external source retrieval, or automatic affiliate calls",
  );
  assert.deepEqual(errors, [], "No client errors");
  console.log(
    `PASS trip detail: ${screenshots.length} screenshots; EN/SQ; 1440/390/320; zero research/AI calls`,
  );
} finally {
  await browser.close();
  server.close();
}
