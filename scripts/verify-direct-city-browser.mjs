/** Local synthetic adapter proof: generated canonical URL, fresh-process restoration and reviewed New York publication. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3155";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const mode = process.env.VERIFY_DIRECT_CITY_MODE || "normal";
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/phase5b/browser";
mkdirSync(output, { recursive: true });
const linkFile = join(output, "generated-links.json");
const links =
  mode === "normal" ? {} : JSON.parse(readFileSync(linkFile, "utf8"));
const content = JSON.parse(
  readFileSync("content/destinations/place-Q60.json", "utf8"),
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "setup";
try {
  const context = await browser.newContext();
  const errors = [],
    forbidden = [],
    handoffs = [];
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/_vercel/"))
      return route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "/* local QA */",
      });
    if (u.hostname === "avs.io")
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Synthetic handoff</h1>",
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
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(`${stage}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${stage}: ${m.text()}`);
  });
  const check = async () => {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      stage + " overflow",
    );
    assert.equal(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      "noindex, follow",
    );
  };
  const resetScreenshotPosition = () =>
    page.evaluate(async () => {
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
  for (const locale of ["en", "sq"])
    for (const width of [1440, 390, 320]) {
      stage = `${mode}-${locale}-${width}`;
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      await page.emulateMedia({
        reducedMotion: width === 320 ? "reduce" : "no-preference",
      });
      const key = `${locale}-${width}`;
      if (mode === "normal") {
        const q = new URLSearchParams({
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
          styles: "city",
        });
        await page.goto(`${origin}/${locale}/plan/results?${q}`);
        const card = page
          .locator(".trip-card")
          .filter({ has: page.locator('a[href*="/trips/place%3AQ60?"]') });
        await card.waitFor();
        assert.equal(await card.count(), 1);
        assert.equal(await card.getAttribute("data-pricing"), "complete");
        assert.equal(
          await page.locator('a[href*="/trips/city%3ANYC?"]').count(),
          0,
        );
        await check();
        await page.screenshot({
          path: join(output, `results-${key}.png`),
          fullPage: true,
          animations: "disabled",
        });
        links[key] = await card.locator("a.button").getAttribute("href");
        assert.ok(links[key].startsWith(`/${locale}/plan/trips/place%3AQ60?`));
        await card.locator("a.button").click();
        await page.waitForURL(`${origin}${links[key]}`);
      } else {
        // Persisted actual card href from the normal process, never a manually constructed detail URL.
        assert.ok(links[key]);
        await page.goto(origin + links[key]);
      }
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        await page.locator(".trip-detail-page").waitFor();
        assert.equal(await page.locator("h1").innerText(), "New York City");
        const body = await page.locator("main").innerText();
        assert.ok(
          body.includes(content.overview.text[locale]),
          "reviewed overview visible",
        );
        assert.equal(await page.locator(".trip-place-row").count(), 4);
        for (const attraction of content.attractions)
          assert.ok(
            body.includes(attraction.name[locale]),
            "reviewed attraction visible",
          );
        for (const value of [
          content.areas[0].summary[locale],
          content.transport[0].guidance[locale],
          content.practicalNotes[0].text[locale],
        ])
          assert.ok(body.includes(value), "reviewed guidance visible");
        assert.ok(body.includes("Upper East Side"));
        assert.doesNotMatch(
          body,
          /DRAFT|NOT PUBLISHED|evidence-review|no flights exist|nuk ka fluturime/i,
        );
        assert.doesNotMatch(
          await page.content(),
          /contentDigest|identityDigest|evidenceDigest|warningsAcknowledged|selectionAndOrder/,
        );
        assert.equal(
          await page
            .locator(
              'a[href*="booking.com"], a[href*="agoda.com"], a[href*="trip.com"]',
            )
            .count(),
          0,
        );
        assert.equal(await page.locator(".trip-hero img").count(), 0);
        assert.equal(await page.locator(".pilot-draft-banner").count(), 0);
        assert.equal(await page.locator(".cost-gatewayTransfer").count(), 0);
        assert.equal(
          await page.locator(".cost-rows .cost-transport").count(),
          mode === "normal" || mode === "restored" ? 1 : 0,
        );
        const stay = await page.locator(".trip-stay-price").innerText();
        assert.equal(
          await page
            .locator(".trip-stay-price")
            .getAttribute("data-stay-evidence"),
          "generic-estimate",
        );
        assert.match(stay, locale === "en" ? /estimate/i : /vlerësim/i);
        assert.doesNotMatch(stay, /Recent|I fundit/);
        if (mode === "normal" || mode === "restored")
          assert.match(
            await page.locator(".trip-flight-route").innerText(),
            /EWR/,
          );
        else
          assert.equal(
            await page.locator(".cost-rows .cost-buffer").count(),
            0,
          );
        await check();
      }
      const disclosure = page.locator("#trip-sources");
      await disclosure.locator(":scope > summary").focus();
      await page.keyboard.press("Enter");
      assert.equal(await disclosure.getAttribute("open"), "");
      assert.equal(
        await disclosure.locator(".trip-content-source-list li").count(),
        5,
      );
      for (const source of content.sources) {
        const link = disclosure.locator(`a[href="${source.url}"]`);
        assert.ok(await link.isVisible());
        assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
      }
      await check();
      await disclosure.locator(":scope > summary").focus();
      await page.keyboard.press("Enter");
      assert.equal(await disclosure.getAttribute("open"), null);
      if (width === 1440) {
        // Chromium CSS zoom reflows at 200%; this does not emulate OS magnification.
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
        });
        await check();
        await resetScreenshotPosition();
        await page.screenshot({
          path: join(output, `zoom-${stage}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.evaluate(() => {
          document.documentElement.style.zoom = "";
        });
      }
      await resetScreenshotPosition();
      await page.screenshot({
        path: join(output, `detail-${stage}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.locator(".flight-booking .affiliate-action button").click();
      await page.waitForURL("https://avs.io/**");
      assert.deepEqual(handoffs.at(-1), {
        originCode: "ZRH",
        destinationCode:
          mode === "normal" || mode === "restored" ? "EWR" : "NYC",
        departureDate: "2026-11-20",
        returnDate: "2026-11-22",
        party: { adults: 2, children: 0 },
      });
      console.log(
        `PASS ${stage}: canonical generated link, reload, airport/date handoff, estimate label, reviewed content, keyboard sources, no overflow`,
      );
    }
  if (mode === "normal") {
    writeFileSync(linkFile, JSON.stringify(links, null, 2));
    for (const locale of ["en", "sq"]) {
      await page.goto(
        origin + links[`${locale}-1440`].replace("place%3AQ60", "city%3ANYC"),
      );
      await page.waitForURL(`**/${locale}/plan/trips/place%3AQ60?**`);
      assert.equal(await page.locator("h1").innerText(), "New York City");
    }
    console.log(
      "PASS legacy provider-city links redirect to the reviewed canonical destination",
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  console.log(
    `PASS ${mode}: no client errors, AI/media/editorial calls or operator metadata leakage`,
  );
} catch (e) {
  console.error(`FAIL ${stage}: ${e.stack}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
