/** UX 2.1. Run against the local pricing fixture; never uses live credentials. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3111";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-results-visual";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage();
  const errors = [],
    forbidden = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (/\/api\/(ai|affiliate)\//.test(r.url()))
      forbidden.push("unexpected request");
  });
  await page.route("**/_vercel/insights/script.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "/* local analytics */",
    }),
  );
  const url = (locale = "en", extra = {}) =>
    `${origin}/${locale}/plan/results?${new URLSearchParams({ origin: "zurich", currency: "EUR", budget: "2000", adults: "2", children: "0", when: "custom", start: "2026-11-20", end: "2026-11-23", nights: "3", flex: "0", ...extra })}`;
  const overflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "no horizontal overflow",
    );
  const capture = async (name, fullPage = true) => {
    await page
      .locator(".header-control")
      .first()
      .waitFor({ state: "attached" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    await page.screenshot({
      path: `${output}/${name}.png`,
      fullPage,
      animations: "disabled",
    });
  };
  for (const [width, locale] of [
    [1440, "en"],
    [390, "en"],
    [320, "en"],
    [320, "sq"],
  ]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.emulateMedia({
      reducedMotion: width < 400 ? "reduce" : "no-preference",
    });
    await page.goto(url(locale));
    const cards = page.locator(".result-card");
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      "noindex, follow",
    );
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
      "rgb(255, 255, 255)",
    );
    assert.equal(
      await cards
        .first()
        .locator(".button.ember")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(201, 68, 26)",
    );
    assert.equal(
      await page.locator(".result-booking .result-reference").count(),
      0,
    );
    assert.equal(
      await page.locator(".result-destination .result-reference").count(),
      1,
    );
    assert.match(
      await cards.first().locator(".result-date-line").innerText(),
      locale === "en" ? /20–23 Nov/ : /20–23 nën/,
    );
    assert.equal(
      await cards
        .first()
        .locator('.result-date-line time[datetime="2026-11-20"]')
        .count(),
      1,
    );
    if (width === 1440) {
      const cardBox = await cards.first().boundingBox();
      assert.ok(
        cardBox.width >= 1190 && cardBox.height >= 220 && cardBox.height < 300,
        "wide, compact, auto-sized desktop card",
      );
      const destinationBox = await cards
        .first()
        .locator(".result-destination")
        .boundingBox();
      const priceBox = await cards
        .first()
        .locator(".result-booking")
        .boundingBox();
      assert.ok(
        priceBox.x >= destinationBox.x + destinationBox.width - 1,
        "price column stays on the right",
      );
      const imageBox = await cards
        .first()
        .locator(".result-visual")
        .boundingBox();
      assert.ok(
        Math.abs(imageBox.height - cardBox.height) < 3,
        "closed card image fills its column",
      );
      assert.equal(
        await cards.first().evaluate((el) => getComputedStyle(el).maxHeight),
        "none",
      );
    }
    await overflow();
    await capture(`mixed-${locale}-${width}`);

    // Current stored catalogue has no approved destination photos; no empty credit controls.
    assert.equal(await cards.locator("img").count(), 0);
    assert.equal(await cards.locator(".destination-no-image").count(), 3);
    assert.equal(await cards.locator(".result-photo-credit").count(), 0);

    // One filter sheet reuses normal search and preserves route/date/currency state.
    const filters = page.locator(".results-more-filters");
    await filters.click();
    assert.equal(await page.locator("dialog[open]").count(), 1);
    assert.equal(await page.locator("dialog .search-field:visible").count(), 0);
    await overflow();
    if (width === 320 && locale === "sq")
      await capture("filters-sq-320", false);
    await page
      .locator("dialog .refinement-select select")
      .selectOption("simple");
    await page.locator("dialog .search-submit").click();
    await page.waitForURL((u) => u.searchParams.get("stay") === "simple");
    for (const [key, value] of Object.entries({
      origin: "zurich",
      currency: "EUR",
      budget: "2000",
      start: "2026-11-20",
      end: "2026-11-23",
      adults: "2",
      nights: "3",
    }))
      assert.equal(new URL(page.url()).searchParams.get(key), value);
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await filters.click();
    await page.keyboard.press("Escape");
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(
      await filters.evaluate((el) => el === document.activeElement),
      true,
    );
    if (width === 320 && locale === "en") {
      await page.goto(url(locale, { styles: "city", airports: "1" }));
      await page.locator(".result-card").first().waitFor();
      assert.match(await filters.innerText(), /Filters · 2/);
      assert.equal(await page.locator(".result-taste:visible").count(), 1);
      await page.locator(".result-taste.mobile-active").click();
      await page.waitForURL((u) => !u.searchParams.get("styles"));
      assert.equal(new URL(page.url()).searchParams.get("airports"), "1");
      await overflow();
    }
    console.log(
      `PASS ${width}px ${locale}: palette, hierarchy, dates, no misleading photos/credits, one filter sheet, no overflow`,
    );
  }
  // Wrapping is permitted; no truncation or fixed height at 200% layout zoom.
  await page.setViewportSize({ width: 1440, height: 900 });
  const longName =
    "A very long destination name for multilingual accessibility verification";
  await page.goto(
    url("sq", {
      origin: "prishtina",
      toPlace: JSON.stringify({
        id: "city:WAW",
        type: "city",
        name: longName,
        cityCode: "WAW",
        iataCodes: ["WAW"],
        countryCode: "PL",
        countryName: { en: "Poland", sq: "Poloni" },
      }),
    }),
  );
  await page.locator(".result-card").waitFor();
  assert.equal(
    await page.locator(".result-destination h3").innerText(),
    longName,
  );
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await overflow();
  for (const selector of [
    ".results-search-summary h1",
    ".result-destination h3",
    ".result-booking",
    ".result-reference",
  ]) {
    for (const element of await page.locator(selector).all())
      assert.equal(
        await element.evaluate(
          (el) =>
            el.scrollWidth > el.clientWidth + 1 ||
            el.scrollHeight > el.clientHeight + 1,
        ),
        false,
        `${selector} never clips`,
      );
  }
  await capture("long-name-sq-200-percent");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  // A 1440px viewport at browser zoom 200% also requires a 720 CSS-pixel reflow.
  await page.setViewportSize({ width: 720, height: 450 });
  await page.reload();
  await page.locator(".result-card").waitFor();
  await overflow();
  await capture("long-name-sq-720-reflow");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url("en", { start: "2026-12-18", end: "2026-12-21" }));
  await page.locator(".result-card").first().waitFor();
  assert.equal(await page.locator(".result-price-complete").count(), 3);
  await capture("priced-en-1440");
  for (const [width, locale] of [
    [390, "en"],
    [320, "sq"],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(
      url(locale, {
        origin: "prishtina",
        budget: "500",
        start: "2026-11-24",
        end: "2026-11-26",
        nights: "2",
        toPlace: JSON.stringify({
          id: "city:VIE",
          type: "city",
          name: "Vienna",
          cityCode: "VIE",
          countryCode: "AT",
          countryName: { en: "Austria", sq: "Austria" },
        }),
      }),
    );
    await page.locator(".result-card").waitFor();
    await capture(`vienna-unpriced-${locale}-${width}`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  console.log(
    "PASS long names at 200% layout zoom; no browser errors or automatic AI/affiliate requests",
  );
} finally {
  await browser.close();
}
