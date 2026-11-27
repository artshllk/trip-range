/** Isolated synthetic evidence in real presentation components, never a production route. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const {
  renderAccommodationFixture,
  accommodationBrowserStates,
} = require("../.test-build/tests/render-accommodation-fixture.js");
const css = readdirSync(".next/static", { recursive: true })
  .filter((p) => typeof p === "string" && p.endsWith(".css"))
  .map((p) => readFileSync(resolve(".next/static", p), "utf8"))
  .join("\n");
assert.ok(css.length > 1000);
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/phase4d/browser/stay";
mkdirSync(output, { recursive: true });
const server = createServer((req, res) => {
  if (/^\/_next\/static\/media\/[a-zA-Z0-9._~-]+\.woff2$/.test(req.url || "")) {
    res.writeHead(200, { "Content-Type": "font/woff2" });
    return res.end(
      readFileSync(resolve(".next/static/media", req.url.split("/").at(-1))),
    );
  }
  const [, locale, state] = (req.url || "").split("/");
  if (
    !["en", "sq"].includes(locale) ||
    !accommodationBrowserStates.includes(state)
  ) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(renderAccommodationFixture(locale, state, css));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
let browser;
let stage = "setup";
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE
      ? { executablePath: process.env.CHROME_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1"
      ? r.continue()
      : r.abort(),
  );
  for (const locale of ["en", "sq"])
    for (const width of [1440, 390, 320])
      for (const state of accommodationBrowserStates) {
        stage = `${locale}-${width}-${state}`;
        await page.setViewportSize({
          width,
          height: width === 1440 ? 1000 : 844,
        });
        await page.goto(
          `http://127.0.0.1:${server.address().port}/${locale}/${state}`,
        );
        const panel = page.locator(".trip-budget");
        await panel.locator("details summary").click();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          stage + " overflow",
        );
        assert.equal(await page.locator("h1").count(), 1);
        const html = await panel.innerHTML();
        assert.doesNotMatch(html, /booking\.com|expedia\.com|DRAFT/);
        if (state === "unavailable") {
          assert.equal(await panel.locator(".cost-stay").count(), 0);
          assert.equal(await panel.locator(".cost-buffer").count(), 0);
        } else {
          assert.equal(
            await panel.getAttribute("data-completeness"),
            "complete",
          );
          assert.equal(await panel.locator(".cost-rows .cost-stay").count(), 1);
        }
        if (state === "kyoto")
          assert.equal(
            await panel.locator(".cost-rows .cost-gatewayTransfer").count(),
            1,
          );
        await page.screenshot({
          path: `${output}/${stage}.png`,
          fullPage: true,
          animations: "disabled",
        });
        console.log(`PASS ${stage}: evidence, costs, disclosure, no overflow`);
      }
  // Optional real interactive page against the existing local synthetic flight server.
  // No provider-backed inventory is injected into the production composition.
  const origin = process.env.VERIFY_ORIGIN;
  if (origin) {
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    for (const locale of ["en", "sq"])
      for (const width of [1440, 390, 320]) {
        stage = `interactive-${locale}-${width}`;
        await page.setViewportSize({
          width,
          height: width === 1440 ? 1000 : 844,
        });
        const query = new URLSearchParams({
          origin: "zurich",
          currency: "EUR",
          budget: "3000",
          adults: "2",
          children: "0",
          when: "custom",
          start: "2026-11-20",
          end: "2026-11-22",
          nights: "2",
          flex: "0",
        });
        const go = () =>
          page.goto(`${origin}/${locale}/plan/trips/paris?${query}`);
        await go();
        await page.locator(".trip-detail-page").waitFor();
        for (const [i, level, amount] of [
          [0, "simple", 154],
          [1, "standard", 220],
          [2, "comfort", 330],
        ]) {
          const button = page.locator(".stay-levels button").nth(i);
          await button.click();
          await page.waitForFunction(
            (tier) => new URL(location.href).searchParams.get("stay") === tier,
            level,
          );
          assert.equal(await button.getAttribute("aria-pressed"), "true");
          assert.match(
            await page.locator(".trip-stay-price").innerText(),
            new RegExp(String(amount)),
          );
          assert.equal(
            Number(
              (
                await page.locator(".trip-budget-summary .total").innerText()
              ).replace(/\D/g, ""),
            ),
            332 + amount,
          );
          assert.equal(
            await page
              .locator(".trip-stay-price")
              .getAttribute("data-stay-evidence"),
            "generic-estimate",
          );
        }
        await page.reload();
        assert.equal(
          await page
            .locator(".stay-levels button")
            .nth(2)
            .getAttribute("aria-pressed"),
          "true",
        );
        assert.match(await page.locator(".trip-stay-price").innerText(), /330/);
        query.set("children", "2");
        query.set("family", "1");
        await go();
        const familyPrice = await page.locator(".trip-stay-price").innerText();
        assert.match(familyPrice, /440/);
        assert.equal(
          Number(
            (
              await page.locator(".trip-budget-summary .total").innerText()
            ).replace(/\D/g, ""),
          ),
          1074,
        );
        assert.match(
          await page.locator(".trip-stay-estimate").innerText(),
          /2 (room\(s\)|dhomë\(a\)) × 2 (nights|net)/,
        );
        const sources = page.locator(".trip-sources > summary");
        await sources.click();
        assert.match(
          await page.locator(".stay-evidence").innerText(),
          locale === "en"
            ? /Child ages are not collected/
            : /Moshat e fëmijëve nuk mblidhen/,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          stage + " overflow",
        );
        assert.equal(
          await page
            .locator('a[href*="booking.com"], a[href*="expedia.com"]')
            .count(),
          0,
        );
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
          window.scrollTo({ top: 0, behavior: "instant" });
        });
        await page.screenshot({
          path: `${output}/${stage}.png`,
          fullPage: true,
          animations: "disabled",
        });
        query.set("family", "0");
        await go();
        assert.equal(
          await page.locator(".trip-stay-price").innerText(),
          familyPrice,
        );
        console.log(
          `PASS ${stage}: tier switching, reload, full family nights, sources, no overflow`,
        );
      }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
