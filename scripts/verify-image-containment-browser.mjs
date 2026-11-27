/** Real ResultCard + image boundary in an isolated browser harness, plus production page checks. */
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
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3111";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const output =
  process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-destination-media-browser";
mkdirSync(output, { recursive: true });
const files = readdirSync(".next/static", { recursive: true }).filter(
  (p) => typeof p === "string",
);
const css = files
  .filter((p) => p.endsWith(".css"))
  .map((p) => readFileSync(resolve(".next/static", p), "utf8"))
  .join("\n");
assert.ok(css.length > 1000);
const bundle = await build({
  entryPoints: ["tests/fixtures/destination-images-browser.tsx"],
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
// Neutral raster fixture: never research evidence or a real destination photo.
const raster = await sharp({
  create: { width: 680, height: 440, channels: 3, background: "#c8dadd" },
})
  .png()
  .toBuffer();
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/fixture.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(bundle.outputFiles[0].contents);
    return;
  }
  if (path === "/destinations/qa-trusted.png") {
    response.setHeader("Content-Type", "image/png");
    response.end(raster);
    return;
  }
  if (path.startsWith("/_next/static/") && files.includes(path.slice(14))) {
    response.end(readFileSync(resolve(".next/static", path.slice(14))));
    return;
  }
  if (path === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
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
    unsafe = [];
  page.on("pageerror", (e) => errors.push(`${stage}: ${e.message}`));
  page.on("request", (r) => {
    if (
      /Pigeon_in_London|Flower_from_Crete|van-portrait|commons.wikimedia|api.pexels|\/api\/(ai|affiliate)\//.test(
        r.url(),
      )
    )
      unsafe.push(stage);
  });
  // Approved remote fixture file is synthetic and intercepted: no Commons image download.
  await page.route(
    "https://upload.wikimedia.org/wikipedia/commons/a/ab/Synthetic_London_skyline.jpg",
    (r) => r.fulfill({ status: 200, contentType: "image/png", body: raster }),
  );
  await page.route("**/_vercel/insights/script.js", (r) =>
    r.fulfill({ status: 200, body: "" }),
  );
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      stage,
    );
  const screenshot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `${output}/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
  };
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const scenario of [
      "trusted",
      "missing",
      "pigeon",
      "flower",
      "approved-store",
      "no-store",
      "rejected-store",
      "corrupt-store",
    ]) {
      stage = `${width}px ${scenario}`;
      await page.goto(
        `${harness}/?scenario=${scenario}&locale=${width === 320 ? "sq" : "en"}`,
      );
      const card = page.locator(".result-card");
      await card.waitFor();
      if (scenario === "trusted" || scenario === "approved-store") {
        await card.locator("img").evaluate((el) => el.decode());
        assert.equal(await card.locator(".destination-no-image").count(), 0);
        const credit = card.locator(".result-photo-credit button").first();
        await credit.focus();
        await page.keyboard.press("Enter");
        assert.match(
          await page.locator(":popover-open").innerText(),
          /Synthetic fixture photographer/,
        );
        assert.match(
          await page.locator(":popover-open").innerText(),
          scenario === "trusted"
            ? /Synthetic test licence/
            : /Wikimedia Commons/,
        );
        if (scenario === "approved-store") {
          assert.equal(
            await card.locator("img").getAttribute("alt"),
            width === 320
              ? "Pamje sintetike për testim, jo fotografi e destinacionit"
              : "Synthetic skyline fixture, not a destination photograph",
          );
          assert.equal(
            await card.locator("img").evaluate((el) => el.style.objectPosition),
            "40% 60%",
          );
        }
        await page.keyboard.press("Escape");
        assert.equal(
          await credit.evaluate((el) => el === document.activeElement),
          true,
        );
      } else {
        assert.equal(await card.locator("img").count(), 0);
        assert.equal(await card.locator(".destination-no-image").count(), 0);
        assert.ok(
          await card.evaluate((el) =>
            el.classList.contains("result-card-no-photo"),
          ),
        );
        assert.equal(await card.locator(".result-visual").count(), 0);
        assert.equal(await card.locator(".result-photo-credit").count(), 0);
      }
      await noOverflow();
      await screenshot(`${scenario}-${width}`);
      console.log(
        `PASS ${stage}: real ResultCard photo policy, attribution and layout`,
      );
    }
    stage = `${width}px image-host failure`;
    let failImage;
    const released = new Promise((resolve) => {
      failImage = resolve;
    });
    await page.route("**/destinations/qa-failed.png", async (r) => {
      await released;
      await r.fulfill({ status: 503, body: "" });
    });
    await page.goto(`${harness}/?scenario=failed`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".result-card img").waitFor();
    const before = await page.locator(".result-card").boundingBox();
    failImage();
    await page.locator(".result-card-no-photo").waitFor();
    const after = await page.locator(".result-card").boundingBox();
    assert.deepEqual(after, before, "file failure does not shift the card");
    assert.equal(
      await page.locator(".result-card img, .result-photo-credit").count(),
      0,
    );
    await noOverflow();
    await screenshot(`failure-${width}`);
    await page.unroute("**/destinations/qa-failed.png");
    console.log(
      `PASS ${stage}: same bounding box, no broken img or unrelated fallback`,
    );

    stage = `${width}px production homepage`;
    await page.goto(`${origin}/`);
    await page
      .locator(".header-control")
      .first()
      .waitFor({ state: "attached" });
    assert.equal(await page.locator(".hero img").count(), 1);
    assert.equal(await page.locator(".inspiration-card").count(), 3);
    assert.equal(
      await page.locator(".inspiration-card .destination-no-image").count(),
      3,
    );
    assert.equal(
      await page.locator(".inspiration-card img, .inspiration-credit").count(),
      0,
    );
    await noOverflow();
    await screenshot(`homepage-${width}`);
    stage = `${width}px production results`;
    await page.goto(
      `${origin}/plan/results?origin=zurich&budget=2000&currency=EUR&start=2026-11-20&end=2026-11-23&nights=3`,
    );
    await page.locator(".result-card").first().waitFor();
    assert.equal(
      await page.locator(".result-card .destination-no-image").count(),
      0,
    );
    assert.equal(
      await page.locator(".result-card img, .result-photo-credit").count(),
      0,
    );
    assert.equal(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      "noindex, follow",
    );
    await noOverflow();
    await screenshot(`results-${width}`);
    await page.locator(".result-card a.button").first().click();
    stage = `${width}px production trip detail`;
    await page.locator(".trip-hero .destination-no-image").waitFor();
    assert.equal(
      await page.locator(".trip-hero img, .trip-hero small").count(),
      0,
    );
    assert.equal(await page.locator(".flight-booking").count(), 1);
    await noOverflow();
    await screenshot(`trip-${width}`);
    console.log(
      `PASS ${width}px production homepage/results/trip: no photo or attribution, brand hero preserved`,
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unsafe, []);
  console.log(
    "PASS rejected source URLs never requested; no client exceptions or AI/affiliate calls",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
