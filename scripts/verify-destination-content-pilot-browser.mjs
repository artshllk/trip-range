/** Offline, loopback-only review of completed real draft files through the Phase 3B UI. */
import { selectPreviewRecords } from "./lib/content-preview-selection.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { previewMediaFile } from "./lib/content-preview-media.mjs";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { build } = require(process.env.ESBUILD_MODULE || "esbuild");
const output =
  process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-destination-content-pilot";
const phase2 = process.env.VERIFY_PILOT === "phase2";
const records = phase2
  ? ["vienna", "london"].map((id) =>
      JSON.parse(
        readFileSync(
          `docs/research/destination-content/phase2/${id}.json`,
          "utf8",
        ),
      ),
    )
  : selectPreviewRecords(
      readdirSync("content/destinations")
        .filter((path) => path.endsWith(".json"))
        .map((path) =>
          JSON.parse(
            readFileSync(resolve("content/destinations", path), "utf8"),
          ),
        )
        .filter((record) => record.reviewStatus === "draft"),
    );
assert.ok(
  records.length > 0,
  "No completed draft records: do not claim a preview pass",
);
const originals = JSON.stringify(records);
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
  entryPoints: ["tests/fixtures/destination-content-pilot-browser.tsx"],
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
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.setHeader("Cache-Control", "no-store");
  const media = previewMediaFile(path);
  if (media) {
    response.setHeader("Content-Type", "image/webp");
    return response.end(readFileSync(media));
  }
  if (path === "/fixture.js") {
    response.setHeader("Content-Type", "application/javascript");
    return response.end(bundle.outputFiles[0].contents);
  }
  if (path.startsWith("/_next/static/") && files.includes(path.slice(14)))
    return response.end(readFileSync(resolve(".next/static", path.slice(14))));
  if (path === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }
  if (path !== "/") {
    response.writeHead(404);
    return response.end();
  }
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DRAFT — NOT PUBLISHED · GoEksplo content review</title><style>${css}
    .pilot-draft-banner { margin: 0; padding: 16px max(20px, calc((100vw - 1120px) / 2)); background: #fff3d6; color: #593700; border-bottom: 2px solid #bc8100; }
    .pilot-draft-banner strong { display: block; font-size: 14px; letter-spacing: .04em; }
    .pilot-draft-banner p { margin: 6px 0 0; max-width: 80ch; font-size: 13px; line-height: 1.5; }
  </style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
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
  let page;
  const mediaCandidates = JSON.parse(
    readFileSync(
      "docs/research/destination-media/phase2/candidates.json",
      "utf8",
    ),
  ).candidates;
  const errors = [],
    forbidden = [],
    screenshots = [],
    metrics = [];
  const freshPage = async () => {
    const nextPage = await browser.newPage({ deviceScaleFactor: 1 });
    nextPage.on("pageerror", (error) =>
      errors.push(`${stage}: ${error.message}`),
    );
    await nextPage.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin !== harness ||
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/_vercel/")
      ) {
        forbidden.push(`${stage}: ${url.hostname}${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    return nextPage;
  };
  for (const record of records) {
    for (const locale of ["en"]) {
      for (const nights of phase2 ? [2, 3] : [2]) {
        for (const width of [1440, 390, 375, 360, 320]) {
          stage = `${record.destinationId.replace(/[^a-z0-9-]+/gi, "-")}-${locale}-${nights}n-${width}`;
          if (page) await page.close();
          page = await freshPage();
          const downloadedImages = [];
          let delivery = null;
          page.on("response", (response) => {
            if (response.request().resourceType() === "image")
              downloadedImages.push(response);
          });
          await page.setViewportSize({
            width,
            height: width === 1440 ? 900 : 844,
          });
          const response = await page.goto(
            `${harness}/?destination=${encodeURIComponent(record.destinationId)}&locale=${locale}&nights=${nights}${phase2 ? "&pilot=phase2" : ""}`,
          );
          assert.match(response.headers()["x-robots-tag"], /noindex/);
          await page.locator(".trip-detail-page").waitFor();
          await page.evaluate(() => document.fonts.ready);
          assert.match(
            await page.locator(".pilot-draft-banner").innerText(),
            /DRAFT — NOT PUBLISHED/,
          );
          assert.equal(await page.locator("html").getAttribute("lang"), locale);
          assert.equal(await page.locator("h1").count(), 1);
          assert.equal(
            await page.locator("img").count(),
            phase2 ? 1 : 0,
            `Only the explicit local candidate may appear: ${stage}`,
          );
          assert.equal(
            await page.locator(".trip-hero .destination-no-image").count(),
            phase2 ? 0 : 1,
          );
          assert.equal(
            await page.locator("#root").getAttribute("data-estimated-spend"),
            "",
          );
          assert.equal(
            await page.locator(".trip-budget .fit").count(),
            0,
            "No invented live trip or fare",
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
            stage,
          );
          if (phase2) {
            assert.equal(
              await page
                .locator(".trip-section-nav")
                .evaluate((node) => getComputedStyle(node).display),
              "flex",
              "Current navigation CSS is applied",
            );
            assert.equal(
              await page
                .locator(".trip-calendar-days")
                .evaluate((node) => getComputedStyle(node).display),
              "grid",
              "Current day-plan CSS is applied",
            );
            const mediaBox = await page
              .locator(".trip-detail-media")
              .boundingBox();
            assert.ok(
              mediaBox.width > Math.min(width * 0.75, 800),
              `Destination-led panorama: ${stage}`,
            );
            assert.ok(mediaBox.height >= 220, `Reserved hero height: ${stage}`);
            const photo = page.locator(".trip-detail-media img");
            await photo.evaluate((img) => img.decode());
            assert.match(
              await photo.getAttribute("srcset"),
              /640w.*1200w.*1920w/,
            );
            const current = await photo.evaluate((img) => img.currentSrc);
            const expectedWidth = width === 1440 ? 1200 : 640;
            const expectedPath = `/review-media/${record.destinationId}-${expectedWidth}.webp`;
            assert.equal(new URL(current).pathname, expectedPath, stage);
            assert.equal(
              downloadedImages.length,
              1,
              `One image, no fixed fallback preload: ${stage}`,
            );
            const downloaded = downloadedImages[0];
            assert.equal(new URL(downloaded.url()).pathname, expectedPath);
            assert.equal(downloaded.status(), 200);
            const bytes = (await downloaded.body()).byteLength;
            const expectedFile = mediaCandidates
              .find(
                (candidate) => candidate.destinationId === record.destinationId,
              )
              .variants.find((variant) => variant.width === expectedWidth);
            assert.equal(
              bytes,
              expectedFile.bytes,
              `Real response bytes: ${stage}`,
            );
            delivery = {
              width: expectedWidth,
              bytes,
              path: expectedPath,
              imageRequests: downloadedImages.length,
            };
            assert.equal(
              await page.locator(".trip-calendar-days > li").count(),
              nights + 1,
            );
            const expected = record.dayTemplates.find((template) =>
              template.suitableNights.includes(nights),
            );
            assert.equal(
              await page.locator("#days a[href^='#trip-attraction-']").count(),
              expected.stops.length,
            );
            for (const stop of expected.stops)
              assert.ok(
                (await page.locator("#days").textContent()).includes(
                  stop.notes[locale],
                ),
              );
            await page.locator(".trip-photo-credit summary").click();
            assert.match(
              await page.locator(".trip-photo-credit").textContent(),
              /CC BY-SA/,
            );
            assert.ok(
              await page
                .locator(
                  '.trip-photo-credit a[href^="https://creativecommons.org/licenses/by-sa/"]',
                )
                .count(),
            );
            await page.locator(".trip-photo-credit summary").click();
          } else
            assert.equal(
              await page
                .locator(".trip-detail-media .destination-no-image")
                .evaluate(
                  (element) => element.scrollHeight <= element.clientHeight + 1,
                ),
              true,
              `Translated no-photo label does not clip: ${stage}`,
            );
          const headings = await page
            .locator("h1,h2,h3,h4")
            .evaluateAll((nodes) =>
              nodes.map((node) => Number(node.tagName.slice(1))),
            );
          for (let index = 1; index < headings.length; index++)
            assert.ok(
              headings[index] <= headings[index - 1] + 1,
              `Heading hierarchy: ${stage}`,
            );
          const attractionCount = Number(
            await page.locator("#root").getAttribute("data-attractions"),
          );
          assert.equal(
            await page.locator("#worth-seeing h3").count(),
            attractionCount,
          );
          for (const attraction of record.attractions ?? []) {
            const card = page.locator(
              `[id="trip-attraction-${attraction.id}"]`,
            );
            if (!(await card.count())) continue; // A genuinely expired item is omitted by the real store.
            assert.equal(
              await card.locator("h3").innerText(),
              attraction.name[locale],
            );
            assert.ok(
              (await card.textContent()).includes(
                attraction.shortDescription[locale],
              ),
            );
          }
          const areaCount = Number(
            await page.locator("#root").getAttribute("data-areas"),
          );
          assert.equal(
            await page.locator("#where-to-stay .trip-area-list > li").count(),
            areaCount,
          );
          for (const area of record.areas ?? []) {
            const cards = page.locator("#where-to-stay .trip-area-list > li");
            const card = cards.filter({
              has: page.getByRole("heading", {
                name: area.name[locale],
                exact: true,
              }),
            });
            if (!(await card.count())) continue;
            assert.ok(
              (await card.textContent()).includes(area.summary[locale]),
            );
          }
          assert.equal(
            await page
              .locator("#before-you-go .trip-content-notes > li")
              .count(),
            Number(await page.locator("#root").getAttribute("data-practical")),
            "Omitted practical notes leave no empty cards",
          );
          assert.equal(
            await page.locator("#getting-around").count(),
            Number(await page.locator("#root").getAttribute("data-transport"))
              ? 1
              : 0,
          );
          const sourceLinks = page.locator(".trip-content-source-list a");
          assert.equal(
            await page.locator(".trip-content-source-list > li").count(),
            Number(await page.locator("#root").getAttribute("data-sources")),
          );
          assert.ok(
            (await sourceLinks.count()) > 0,
            `Real sources visible: ${stage}`,
          );
          for (const link of await sourceLinks.all()) {
            const href = await link.getAttribute("href");
            assert.equal(new URL(href).protocol, "https:");
            assert.equal(await link.getAttribute("target"), "_blank");
            assert.match(await link.getAttribute("rel"), /noopener/);
            assert.match(await link.getAttribute("rel"), /noreferrer/);
          }
          for (const source of record.sources) {
            const item = page.locator(`[id="destination-source-${source.id}"]`);
            if (!(await item.count())) continue;
            assert.ok((await item.textContent()).includes(source.title));
            assert.ok((await item.textContent()).includes(source.publisher));
          }
          const stops = page.locator("#days a[href^='#trip-attraction-']");
          if (await stops.count()) {
            const target = (await stops.first().getAttribute("href")).slice(1);
            await stops.first().click();
            assert.equal(
              await page.locator(`[id="${target}"]`).isVisible(),
              true,
            );
          }
          assert.equal(
            await page
              .locator("#price-details[open], #trip-sources[open]")
              .count(),
            0,
          );
          assert.equal(
            await page
              .locator(
                ".trip-document-note, .trip-content-card, #worth-seeing img",
              )
              .count(),
            0,
          );
          assert.equal(await page.locator(".trip-unpriced-status").count(), 1);
          metrics.push({
            stage,
            delivery,
            ...(await page.evaluate(() => ({
              height: document.documentElement.scrollHeight,
              visibleWords: document
                .querySelector("main")
                .innerText.split(/\s+/).length,
              attractionTop:
                document.querySelector("#worth-seeing").getBoundingClientRect()
                  .top + scrollY,
              borderedContentCards:
                document.querySelectorAll(".trip-content-card").length,
            }))),
          });
          await page.evaluate(() => scrollTo(0, 0));
          const screenshot = `${output}/${stage}.png`;
          await page.screenshot({
            path: screenshot,
            fullPage: true,
            animations: "disabled",
          });
          await page.screenshot({
            path: `${output}/${stage}-first-screen.png`,
            fullPage: false,
            animations: "disabled",
          });
          screenshots.push(screenshot);
          console.log(
            `PASS ${stage}: actual draft content, sources, bounded local media, no overflow`,
          );
        }
      }
    }
  }
  writeFileSync(`${output}/metrics.json`, JSON.stringify(metrics, null, 2));
  assert.deepEqual(errors, [], "No client errors");
  assert.deepEqual(
    forbidden,
    [],
    "Zero runtime research, AI, affiliate, media or external source fetches",
  );
  assert.equal(
    JSON.stringify(records),
    originals,
    "Preview never mutates original records",
  );
  console.log(
    `PASS draft content preview: ${records.length} completed destinations; ${screenshots.length} screenshots; English; 1440/390/375/360/320; zero external calls`,
  );
} finally {
  await browser.close();
  server.close();
}
