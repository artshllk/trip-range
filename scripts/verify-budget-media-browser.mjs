/** Offline production-component QA. Synthetic money/media are never published or imported by the app. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { build } = require("esbuild");
const sharp = require("sharp");
const out = process.env.VERIFY_SCREENSHOTS || "/tmp/phase6b2b/browser";
mkdirSync(out, { recursive: true });
const files = readdirSync(".next/static", { recursive: true }).filter(
  (p) => typeof p === "string",
);
const css = files
  .filter((p) => p.endsWith(".css"))
  .map((p) => readFileSync(resolve(".next/static", p), "utf8"))
  .join("\n");
assert.ok(css.length > 1000);
const bundle = await build({
  entryPoints: ["tests/fixtures/budget-media-browser.tsx"],
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
// Neutral test raster: no acquired photography and no claim that this depicts Vienna.
const raster = await sharp({
  create: { width: 680, height: 440, channels: 3, background: "#c8dadd" },
})
  .png()
  .toBuffer();
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/fixture.js") {
    res.setHeader("Content-Type", "application/javascript");
    return res.end(bundle.outputFiles[0].contents);
  }
  if (path.startsWith("/destinations/")) {
    res.setHeader("Content-Type", "image/png");
    return res.end(raster);
  }
  if (path.startsWith("/_next/static/") && files.includes(path.slice(14)))
    return res.end(readFileSync(resolve(".next/static", path.slice(14))));
  if (path === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
let browser,
  stage = "setup",
  checks = 0;
const failures = [];
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE
      ? { executablePath: process.env.CHROME_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage();
  const errors = [],
    forbidden = [];
  page.on("pageerror", (e) => errors.push(`${stage}: ${e.message}`));
  await page.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== origin || u.pathname.startsWith("/api/")) {
      forbidden.push(u.hostname + u.pathname);
      return r.abort();
    }
    return r.continue();
  });
  const go = async (params) => {
    await page.goto(`${origin}/?${new URLSearchParams(params)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".result-card, .trip-budget").first().waitFor();
    // fonts.ready can wait for the intentionally held image/load cycle. Earlier
    // ordinary renders have already loaded fonts before late-failure scenarios.
    if (!["failed", "fallback", "both-failed"].includes(params.media))
      await page.evaluate(() => document.fonts.ready);
  };
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      stage,
    );
  const shot = async (name) =>
    page.screenshot({
      path: `${out}/${name}.png`,
      fullPage: false,
      animations: "disabled",
    });
  const money = (value, locale) => {
    const absolute = Math.abs(value.cents),
      symbol = { EUR: "€", GBP: "£", USD: "$", CHF: "CHF" }[value.currency];
    const n =
      String(Math.floor(absolute / 100)).replace(
        /\B(?=(\d{3})+(?!\d))/g,
        locale === "sq" ? "\u00a0" : ",",
      ) +
      (absolute % 100
        ? `${locale === "sq" ? "," : "."}${String(absolute % 100).padStart(2, "0")}`
        : "");
    return locale === "sq"
      ? `${n}\u00a0${symbol}`
      : `${symbol}${symbol === "CHF" ? " " : ""}${n}`;
  };
  const budget = async (locale) => {
    const model = JSON.parse(
      await page.locator("#root").getAttribute("data-budget"),
    );
    const req = JSON.parse(
      await page.locator("#root").getAttribute("data-request-budget"),
    );
    const price = page.locator(".result-price-complete").first();
    if (!model) {
      assert.equal(await price.count(), 0);
      const incomplete = page.locator(".trip-unpriced-summary").first();
      assert.match(
        await incomplete.innerText(),
        locale === "en" ? /Total incomplete/ : /Totali i paplotë/,
      );
      assert.equal(await incomplete.locator(".total").count(), 0);
      const ceiling = incomplete.locator(".flight-budget-disclosure");
      if (await ceiling.count()) {
        assert.equal(await ceiling.getAttribute("open"), null);
        assert.equal(await ceiling.locator("b").isVisible(), false);
        await ceiling.locator("summary").click();
        assert.equal(await ceiling.locator("b").isVisible(), true);
        assert.match(
          await ceiling.innerText(),
          locale === "en" ? /not a fare estimate/ : /jo vlerësim i tarifës/,
        );
        await ceiling.locator("summary").click();
      }
      assert.equal(
        await page
          .locator(
            ".result-budget-equation,.result-balance,.result-fits,.result-over,.fit",
          )
          .count(),
        0,
      );
      return;
    }
    assert.equal(
      await price.locator(".total strong").innerText(),
      money(model.estimatedSpend, locale),
    );
    const rows = price.locator(".result-budget-equation > div");
    assert.equal(await rows.count(), 3);
    const labels =
      locale === "en"
        ? ["Reserve kept aside", "Budget needed", "Your budget"]
        : ["Rezervë e lënë mënjanë", "Buxheti i nevojshëm", "Buxheti yt"];
    for (const [i, amount] of [
      model.safetyBuffer,
      model.budgetNeeded,
      req,
    ].entries()) {
      assert.equal(await rows.nth(i).locator("dt").innerText(), labels[i]);
      assert.equal(
        await rows.nth(i).locator("dd").innerText(),
        money(amount, locale),
      );
      const label = await rows.nth(i).locator("dt").boundingBox(),
        number = await rows.nth(i).locator("dd").boundingBox();
      assert.ok(label.x + label.width <= number.x, stage + " money collision");
    }
    assert.equal(
      await price.locator(".result-balance b").innerText(),
      money(
        model.fit === "over" ? model.overBudget : model.remainingAfterReserve,
        locale,
      ),
    );
  };
  for (const locale of ["en", "sq"])
    for (const [width, height] of [
      [1440, 1000],
      [390, 844],
      [375, 812],
      [360, 780],
      [320, 844],
      [320, 568],
    ]) {
      await page.setViewportSize({ width, height });
      for (const state of [
        "affordable",
        "exact",
        "close",
        "reserve-over",
        "slightly-over",
        "unaffordable",
        "reference",
        "unpriced",
        "transfer",
        "stay",
        "provider-failure",
      ]) {
        stage = `${locale}-${width}x${height}-${state}`;
        await go({ locale, state });
        await budget(locale);
        await noOverflow();
        const card = page.locator(".result-card");
        assert.equal(
          await card
            .locator(
              ".result-visual,img,.destination-no-image,.result-photo-credit",
            )
            .count(),
          0,
        );
        assert.ok(
          await card.evaluate((e) =>
            e.classList.contains("result-card-no-photo"),
          ),
        );
        if (width >= 760)
          assert.equal(
            (
              await card.evaluate(
                (e) => getComputedStyle(e).gridTemplateColumns,
              )
            ).split(" ").length,
            2,
          );
        const link = card.locator(".result-actions a.button");
        await link.scrollIntoViewIfNeeded();
        const box = await link.boundingBox();
        assert.ok(
          box.height >= 44 && box.y >= 0 && box.y + box.height <= height + 1,
          stage + " reachable CTA",
        );
        await card.locator(".result-details > summary").focus();
        await page.keyboard.press("Enter");
        assert.equal(
          await card.locator(".result-details").getAttribute("open"),
          "",
        );
        await noOverflow();
        await page.keyboard.press("Enter");
        if (state === "reserve-over" && [1440, 390, 320].includes(width)) {
          await page.evaluate(() => scrollTo(0, 0));
          await shot(stage);
        }
        checks++;
      }
      for (const media of ["approved", "unverified", "missing"]) {
        stage = `${locale}-${width}x${height}-${media}-long`;
        await go({
          locale,
          media,
          long: "1",
          state: "reserve-over",
          currency: "CHF",
        });
        await noOverflow();
        await budget(locale);
        const card = page.locator(".result-card");
        if (media === "approved") {
          await card.locator("img").evaluate((e) => e.decode());
          assert.equal(
            await card.locator("img").getAttribute("loading"),
            "eager",
          );
          const credit = card.locator(".result-photo-credit button").first();
          await credit.focus();
          await page.keyboard.press("Enter");
          assert.match(
            await page.locator(":popover-open").innerText(),
            /Synthetic fixture photographer.*Synthetic test licence/,
          );
          await page.keyboard.press("Escape");
          assert.equal(
            await credit.evaluate((e) => e === document.activeElement),
            true,
          );
        } else
          assert.equal(
            await card
              .locator("img,.result-photo-credit,.result-visual")
              .count(),
            0,
          );
        if ((width === 320 && height === 568) || width === 1440)
          await shot(stage);
        checks++;
      }
      // Actual FullTrip, its own production pricing call, and the same top-level summary.
      for (const state of ["reserve-over", "reference", "transfer", "stay"]) {
        stage = `detail-${locale}-${width}x${height}-${state}`;
        await go({ locale, state, detail: "1" });
        await budget(locale);
        if (state === "reserve-over") {
          const model = JSON.parse(
            await page.locator("#root").getAttribute("data-budget"),
          );
          const entered = JSON.parse(
            await page.locator("#root").getAttribute("data-request-budget"),
          );
          assert.equal(model.fit, "over", stage);
          assert.ok(
            model.estimatedSpend.cents < entered.cents,
            stage + " spending alone fits",
          );
          assert.ok(
            entered.cents < model.budgetNeeded.cents,
            stage + " reserve causes excess",
          );
          assert.equal(
            model.budgetNeeded.cents,
            model.estimatedSpend.cents + model.safetyBuffer.cents,
          );
          assert.equal(
            model.overBudget.cents,
            model.budgetNeeded.cents - entered.cents,
          );
          assert.equal(await page.locator(".result-over").count(), 1);
          assert.match(
            await page.locator(".result-over").innerText(),
            locale === "en" ? /Over budget/ : /Mbi buxhet/,
          );
        }
        await noOverflow();
        if (state === "reserve-over" && [1440, 390, 320].includes(width))
          await shot(stage);
        checks++;
      }
      console.log(
        `PASS ${locale} ${width}x${height}: complete/incomplete budgets, long names, images, detail, CTA and disclosures`,
      );
    }
  for (const width of [1440, 390, 320])
    for (const media of ["failed", "fallback", "both-failed"]) {
      stage = `${width}-${media}`;
      console.log(`CHECK ${stage}`);
      await page.setViewportSize({ width, height: 844 });
      let release;
      const held = new Promise((r) => (release = r));
      const calls = [];
      await page.route("**/destinations/qa-failed*.png", async (r) => {
        calls.push(new URL(r.request().url()).pathname);
        await held;
        return r.fulfill({
          status: 200,
          contentType: "image/png",
          body: "invalid synthetic raster",
        });
      });
      await go({ media });
      const card = page.locator(".result-card");
      const before = await card.boundingBox(),
        ctaBefore = await card
          .locator(".result-actions a.button")
          .boundingBox();
      const arithmetic = await card.locator(".result-price").innerText();
      release();
      if (media === "fallback") {
        await card
          .locator('img[src="/destinations/qa-alternate.png"]')
          .waitFor();
        await card.locator("img").evaluate((e) => e.decode());
        assert.equal(await card.locator(".result-visual").count(), 1);
        assert.match(await card.innerHTML(), /Synthetic fallback photographer/);
      } else {
        await page.locator(".result-card-no-photo").waitFor();
        assert.equal(
          await card
            .locator(
              "img,.result-visual,.result-photo-credit,.destination-no-image",
            )
            .count(),
          0,
        );
      }
      const after = await card.boundingBox(),
        ctaAfter = await card.locator(".result-actions a.button").boundingBox();
      assert.equal(
        after.height,
        before.height,
        "late failure preserves visible card footprint",
      );
      assert.ok(
        Math.abs(ctaAfter.y - ctaBefore.y) <= 2,
        stage + " stable visible CTA",
      );
      assert.equal(await card.locator(".result-price").innerText(), arithmetic);
      assert.deepEqual(
        calls,
        media === "both-failed"
          ? [
              "/destinations/qa-failed.png",
              "/destinations/qa-failed-alternate.png",
            ]
          : ["/destinations/qa-failed.png"],
      );
      if (media !== "fallback") {
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        await page.waitForFunction(
          () => !document.querySelector(".result-media-reserve"),
        );
        await page.evaluate(() => scrollTo(0, 0));
        assert.equal(
          await card.evaluate((e) => getComputedStyle(e).minHeight),
          width < 760 ? "0px" : "220px",
        );
      }
      failures.push({
        width,
        media,
        beforeHeight: before.height,
        afterHeight: after.height,
        compactHeight: (await card.boundingBox()).height,
        ctaMovement: ctaAfter.y - ctaBefore.y,
        calls,
      });
      await shot(stage);
      await noOverflow();
      await page.unroute("**/destinations/qa-failed*.png");
      checks++;
    }
  const lifecycle = [];
  // Compare transitions with this same real card's compact baseline. A 2px
  // tolerance allows subpixel rounding, not a retained photo or disclosure row.
  for (const [locale, width, long] of [
    ["en", 390, false],
    ["sq", 320, true],
    ["en", 1440, false],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({
      reducedMotion: locale === "sq" ? "reduce" : "no-preference",
    });
    const params = { locale, lifecycle: "1", ...(long ? { long: "1" } : {}) };
    const card = page.locator("[data-qa-primary] .result-card");
    const metrics = () =>
      card.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const cta = el
          .querySelector(".result-actions a.button")
          .getBoundingClientRect();
        return { height: rect.height, ctaOffset: cta.top - rect.top };
      });
    const act = (action) =>
      page.evaluate(
        (detail) =>
          window.dispatchEvent(new CustomEvent("budget-media-qa", { detail })),
        action,
      );
    await go(params);
    const compact = await metrics();
    const assertCompact = async () => {
      await page.waitForFunction(
        () =>
          !document.querySelector("[data-qa-primary] .result-media-reserve"),
      );
      const actual = await metrics();
      assert.ok(
        Math.abs(actual.height - compact.height) <= 2,
        `${stage}: collapsed height ${actual.height}, expected ${compact.height}`,
      );
      assert.ok(
        Math.abs(actual.ctaOffset - compact.ctaOffset) <= 2,
        `${stage}: CTA ${actual.ctaOffset}, expected ${compact.ctaOffset}`,
      );
      assert.equal(
        await card.getAttribute("style"),
        null,
        "no whole-card height lock",
      );
      await noOverflow();
      return actual;
    };
    for (const sequence of [
      "open-before-failure",
      "open-after-failure",
      "replacement-removal",
      "reorder",
      "hide-show",
      "remount",
    ]) {
      stage = `${locale}-${width}-${sequence}`;
      let release;
      const held = new Promise((r) => (release = r));
      const calls = [];
      const imageRequests = [];
      const recordImage = (request) => {
        if (request.resourceType() === "image")
          imageRequests.push(new URL(request.url()).pathname);
      };
      page.on("request", recordImage);
      await page.route("**/destinations/qa-failed.png", async (route) => {
        calls.push(route.request().url());
        await held;
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          body: "invalid synthetic raster",
        });
      });
      await go({ ...params, media: "failed" });
      await page.waitForFunction(
        () => document.querySelector("#root").dataset.ready === "true",
      );
      const summary = card.locator(".result-details > summary");
      if (sequence === "open-before-failure") await summary.click();
      const before = await metrics();
      release();
      await card.locator("img").waitFor({ state: "detached" });
      const failed = await metrics();
      assert.ok(
        Math.abs(failed.height - before.height) <= 2,
        stage + " failure footprint",
      );
      assert.ok(
        Math.abs(failed.ctaOffset - before.ctaOffset) <= 2,
        stage + " failure CTA",
      );
      assert.equal(await card.locator(".result-photo-credit").count(), 0);
      if (sequence === "open-before-failure") await summary.click();
      if (sequence === "open-after-failure") {
        await summary.click();
        await summary.click();
      }
      if (sequence === "replacement-removal") {
        await act("replace");
        await card
          .locator('img[src$="/destinations/qa-replacement.png"]')
          .evaluate((img) => img.decode());
        assert.equal(await card.locator(".result-media-reserve").count(), 0);
        assert.match(
          await card.innerHTML(),
          /Synthetic replacement photographer/,
        );
        const replaced = await metrics();
        assert.ok(
          Math.abs(replaced.height - before.height) <= 2,
          stage + " replacement photo layout",
        );
        await act("remove");
        await card.locator("img").waitFor({ state: "detached" });
      }
      if (sequence === "remount") await act("remount");
      if (sequence === "reorder") {
        await act("reorder");
        await page.waitForFunction(() =>
          document
            .querySelector(".result-list")
            .lastElementChild.hasAttribute("data-qa-primary"),
        );
        const reordered = await metrics();
        assert.ok(
          reordered.height <= before.height + 2,
          stage + " reorder cannot expand the card",
        );
        assert.equal(
          await card.locator("img").count(),
          0,
          stage + " reorder retains failed-asset state",
        );
        await summary.click();
        await summary.click();
      }
      if (sequence === "hide-show") {
        await act("hide");
        await page.waitForFunction(
          () =>
            !document.querySelector("[data-qa-primary] .result-media-reserve"),
        );
        await act("show");
        await card.waitFor({ state: "visible" });
      }
      const after = await assertCompact();
      assert.equal(calls.length, 1, stage + " no retries after transitions");
      assert.equal(
        imageRequests.filter((path) => path.endsWith("/qa-failed.png")).length,
        1,
      );
      if (sequence === "replacement-removal")
        assert.equal(
          imageRequests.filter((path) => path.endsWith("/qa-replacement.png"))
            .length,
          1,
          stage + " replacement requested once",
        );
      lifecycle.push({
        locale,
        width,
        sequence,
        compact,
        before,
        failed,
        after,
      });
      if (sequence === "open-before-failure") {
        await card.scrollIntoViewIfNeeded();
        await shot(`corrected-${locale}-${width}-disclosure-failure`);
      }
      await page.unroute("**/destinations/qa-failed.png");
      page.off("request", recordImage);
      checks++;
    }
  }
  // Browser zoom proxy: 200% content at a 320 CSS-pixel layout, with long SQ text.
  await page.setViewportSize({ width: 640, height: 1136 });
  await go({ locale: "sq", long: "1", state: "reserve-over" });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  await noOverflow();
  await page.locator(".result-actions a.button").scrollIntoViewIfNeeded();
  await shot("sq-200-percent-content-zoom");
  checks++;
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  writeFileSync(
    `${out}/report.json`,
    JSON.stringify({ checks, failures, lifecycle, errors, forbidden }, null, 2),
  );
  console.log(
    `PASS ${checks} component/browser scenarios; no JS exceptions or external requests`,
  );
  console.log(JSON.stringify(failures));
} catch (e) {
  console.error(`FAIL ${stage}`);
  throw e;
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
