/** Permanent normal-search → canonical-detail regression. Use the explicit gateway fixture server. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3144";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/phase4b/browser";
mkdirSync(output, { recursive: true });
const content = JSON.parse(
  readFileSync("content/destinations/place-Q34600.json", "utf8"),
);
assert.equal(
  content.publication.contentDigest,
  "c91333fdec9eb60da8a0eadc279a74c76c29ae1b86ce6fa61462686001eb5d82",
);
const query = new URLSearchParams({
  origin: "zurich",
  currency: "EUR",
  budget: "2000",
  adults: "2",
  children: "0",
  when: "custom",
  start: "2026-11-20",
  end: "2026-11-22",
  nights: "2",
  flex: "0",
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "setup";
try {
  const context = await browser.newContext(),
    errors = [],
    forbidden = [],
    handoffs = [];
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/_vercel/"))
      return route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "/* local analytics stub */",
      });
    if (u.hostname === "avs.io")
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Verified flight handoff</h1>",
      });
    if (u.origin !== origin || /\/api\/(ai|content|media)/.test(u.pathname)) {
      forbidden.push(u.hostname + u.pathname);
      return route.abort();
    }
    if (u.pathname === "/api/affiliate/flights")
      handoffs.push(JSON.parse(route.request().postData()).route);
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${stage}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${stage}: ${m.text()}`);
  });
  page.setDefaultTimeout(20000);
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      stage,
    );
  async function detail(
    locale,
    endpoint = "KIX",
    pricing = endpoint === "OSA" ? "required-transfer-unpriced" : "complete",
  ) {
    await page.locator(".trip-detail-page").waitFor();
    assert.equal(await page.locator("h1").innerText(), "Kyoto");
    const main = await page.locator("main").innerText();
    assert.ok(main.includes(content.overview.text[locale]));
    for (const a of content.attractions)
      assert.equal(
        await page.locator(`[id="trip-attraction-${a.id}"] h3`).innerText(),
        a.name[locale],
      );
    assert.doesNotMatch(
      main,
      /DRAFT|contentDigest|identityDigest|evidence-review/,
    );
    assert.equal(await page.locator(".trip-detail-media img").count(), 0);
    const booking = await page.locator(".flight-booking").innerText();
    assert.match(
      booking,
      endpoint === "OSA" ? /Osaka|Osakës/ : new RegExp(endpoint),
    );
    assert.match(
      booking,
      locale === "en"
        ? /onward transfer to Kyoto required/
        : /transfer drejt Kyoto/,
    );
    const costs = page.locator(".trip-detail-page .cost-rows");
    const summary = await page.locator(".trip-budget-summary").innerText();
    if (pricing === "complete") {
      assert.ok(await costs.locator(".cost-gatewayTransfer").count());
      assert.ok(await costs.locator(".cost-buffer").count());
      assert.doesNotMatch(
        summary,
        /Onward transfer needs checking|Whole-trip total and budget fit are not yet known/,
      );
    } else if (pricing === "required-transfer-unpriced") {
      assert.equal(await costs.locator(".cost-gatewayTransfer").count(), 0);
      assert.doesNotMatch(
        summary,
        /Estimated whole trip|left after safety|Fits your budget|≤/,
      );
    } else {
      assert.ok(await costs.locator(".cost-gatewayTransfer").count());
      assert.equal(await costs.locator(".cost-buffer").count(), 0);
    }
    assert.equal(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      "noindex, follow",
    );
    await noOverflow();
  }
  if (process.env.VERIFY_GATEWAY_RESTORE === "1") {
    for (const locale of ["en", "sq"]) {
      stage = `fresh-process ${locale}`;
      await page.goto(`${origin}/${locale}/plan/trips/place%3AQ34600?${query}`);
      await detail(locale, "OSA");
      assert.doesNotMatch(
        await page.locator(".flight-booking").innerText(),
        /€400/,
      );
      assert.match(
        await page.locator(".trip-budget-summary").innerText(),
        locale === "en"
          ? /Flight and onward transfer need checking/
          : /Fluturimi dhe transferi/,
      );
      console.log(
        `PASS ${stage}: no prior search, no fare, reviewed content and truthful incomplete state`,
      );
    }
  } else {
    for (const locale of ["en", "sq"])
      for (const width of [1440, 390, 320]) {
        stage = `${locale}-${width}`;
        await page.setViewportSize({
          width,
          height: width === 1440 ? 1000 : 844,
        });
        await page.emulateMedia({
          reducedMotion: width === 320 ? "reduce" : "no-preference",
        });
        await page.goto(`${origin}/${locale}/plan?${query}`);
        await page.locator(".search-submit").click();
        await page.waitForURL(`**/${locale}/plan/results?**`);
        const card = page.locator(".trip-card").filter({
          has: page.getByRole("heading", { name: "Kyoto", exact: true }),
        });
        await card.waitFor();
        assert.equal(await card.getAttribute("data-pricing"), "complete");
        assert.match(await card.innerText(), /KIX/);
        assert.equal(await card.locator(".result-price-complete").count(), 1);
        assert.equal(await card.locator(".flight-affordability").count(), 0);
        await noOverflow();
        await page.screenshot({
          path: join(output, `results-${stage}.png`),
          fullPage: true,
          animations: "disabled",
        });
        const link = card.locator("a.button");
        const href = await link.getAttribute("href");
        assert.ok(href.startsWith(`/${locale}/plan/trips/place%3AQ34600?`));
        await link.click();
        await page.waitForURL(`${origin}${href}`);
        await detail(locale);
        await page.screenshot({
          path: join(output, `detail-${stage}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.reload();
        await detail(locale);
        // Keyboard operates the ordinary source control without an operator preview layer.
        const source = page.locator("#trip-sources > summary");
        await source.focus();
        await page.keyboard.press("Enter");
        assert.equal(
          await page.locator("#trip-sources").getAttribute("open"),
          "",
        );
        assert.ok(
          await page.locator("#trip-sources .trip-content-sources a").count(),
        );
        await page.locator(".flight-booking .affiliate-action button").click();
        await page.waitForURL("https://avs.io/**");
        assert.equal(handoffs.at(-1).destinationCode, "KIX");
        assert.equal(handoffs.at(-1).departureDate, "2026-11-20");
        console.log(
          `PASS ${stage}: search submit, generated canonical result link, reviewed content, reload, KIX affiliate and no overflow`,
        );
      }
    for (const locale of ["en", "sq"])
      for (const width of [1440, 390, 320])
        for (const [month, endpoint, day, pricing] of [
          ["2026-12", "ITM", 20, "complete"],
          ["2027-01", "OSA", 20, "required-transfer-unpriced"],
          ["2026-11", "KIX", 25, "flight-unpriced"],
        ]) {
          stage = `${endpoint}-${pricing}-${locale}-${width}`;
          await page.setViewportSize({
            width,
            height: width === 1440 ? 1000 : 844,
          });
          const q = new URLSearchParams(query);
          q.set("start", `${month}-${day}`);
          q.set("end", `${month}-${day + 2}`);
          await page.goto(`${origin}/${locale}/plan/trips/place%3AQ34600?${q}`);
          await detail(locale, endpoint, pricing);
          if (pricing === "flight-unpriced") {
            assert.ok(await page.locator(".trip-reference").count());
            assert.doesNotMatch(
              await page.locator(".flight-booking").innerText(),
              /€400/,
            );
          }
          await page.locator("#price-details > summary").click();
          if (pricing !== "required-transfer-unpriced") {
            await page.locator("#trip-sources > summary").click();
            const assumptions = page.locator(".cost-provenance details");
            await assumptions.locator("summary").click();
            assert.match(
              await assumptions.innerText(),
              locale === "en"
                ? /no child discounts assumed/
                : /pa ulje për fëmijë/,
            );
            assert.match(await assumptions.innerText(), /2026-10-13/);
          }
          await noOverflow();
          await page.screenshot({
            path: join(output, `${stage}.png`),
            fullPage: true,
            animations: "disabled",
          });
          await page
            .locator(".flight-booking .affiliate-action button")
            .click();
          await page.waitForURL("https://avs.io/**");
          assert.equal(handoffs.at(-1).destinationCode, endpoint);
          assert.equal(handoffs.at(-1).departureDate, `${month}-${day}`);
          console.log(
            `PASS ${stage}: truthful costs, original endpoint/dates, reviewed content, no overflow`,
          );
        }
  }
  assert.deepEqual(errors, [], "client errors");
  assert.deepEqual(forbidden, [], "forbidden calls");
  console.log("PASS no client errors, no AI/content/media network calls");
} catch (e) {
  console.error(`FAIL ${stage}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
