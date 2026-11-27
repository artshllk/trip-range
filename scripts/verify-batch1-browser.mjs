/** Local acceptance only: synthetic provider evidence, real routes and Phase 5D reviewed editorial. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3156";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const mode = process.env.VERIFY_BATCH1_MODE || "normal",
  output = process.env.VERIFY_SCREENSHOTS || "/tmp/phase5d/browser";
assert.ok(["normal", "restored", "empty", "failure"].includes(mode));
mkdirSync(output, { recursive: true });
const file = join(output, "generated-links.json"),
  links = mode === "normal" ? {} : JSON.parse(readFileSync(file, "utf8"));
const batch = JSON.parse(
  readFileSync("content/operations/batches/phase5c-batch1.json", "utf8"),
);
const files = [
  "barcelona",
  "london",
  "place-Q334",
  "place-Q1861",
  "place-Q24639",
];
const airports = ["BCN", "STN", "SIN", "DMK", "YVR"],
  codes = ["BCN", "LON", "SIN", "BKK", "YVR"];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
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
        body: "/* QA */",
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
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
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
  for (const [i, entry] of batch.entries.entries())
    for (const locale of mode === "normal" ? ["en", "sq"] : ["en"])
      for (const width of mode === "normal" ? [1440, 390, 320] : [1440]) {
        const key = `${entry.destinationId}-${locale}-${width}`,
          slug = encodeURIComponent(entry.destinationId),
          content = JSON.parse(
            readFileSync(`content/destinations/${files[i]}.json`, "utf8"),
          );
        await page.setViewportSize({
          width,
          height: width === 1440 ? 1000 : 844,
        });
        if (mode === "normal") {
          // The normal product intentionally shows only three top results.
          // Select each verified city through the existing search state to exercise all five.
          const selected = new URLSearchParams(q);
          const countryCode = ["ES", "GB", "SG", "TH", "CA"][i];
          selected.set(
            "toPlace",
            JSON.stringify({
              id: `city:${codes[i]}`,
              type: "city",
              cityCode: codes[i],
              iataCodes: [codes[i]],
              name: entry.name,
              countryCode,
              countryName: { en: countryCode, sq: countryCode },
            }),
          );
          await page.goto(`${origin}/${locale}/plan/results?${selected}`);
          const card = page
            .locator(".trip-card")
            .filter({ has: page.locator(`a[href*="/trips/${slug}?"]`) });
          await card.waitFor();
          assert.equal(await card.count(), 1);
          assert.equal(await card.getAttribute("data-pricing"), "complete");
          links[key] = await card.locator("a.button").getAttribute("href");
          await card.locator("a.button").click();
          await page.waitForURL(origin + links[key]);
        } else await page.goto(origin + links[key]);
        await page.locator(".trip-detail-page").waitFor();
        await page.reload();
        await page.locator(".trip-detail-page").waitFor();
        const body = await page.locator("main").innerText();
        assert.equal(await page.locator("h1").count(), 1);
        assert.ok(
          body.includes(entry.name) ||
            (entry.name === "London" && body.includes("Londra")),
        );
        assert.equal(content.reviewStatus, "reviewed");
        assert.ok(body.includes(content.overview.text[locale]));
        assert.equal(
          await page.locator(".trip-place-row").count(),
          content.attractions.length,
        );
        for (const a of content.attractions)
          assert.ok(
            body.includes(a.name[locale]),
            `${key}: reviewed attraction visible`,
          );
        assert.deepEqual(
          await page.locator(".trip-place-row h3").allTextContents(),
          content.attractions.map((a) => a.name[locale]),
        );
        for (const area of content.areas ?? [])
          assert.ok(body.includes(area.summary[locale]));
        for (const guide of content.transport ?? [])
          assert.ok(body.includes(guide.guidance[locale]));
        for (const note of content.practicalNotes ?? [])
          assert.ok(body.includes(note.text[locale]));
        assert.doesNotMatch(body, /DRAFT|NOT PUBLISHED|evidence-review/i);
        assert.equal(await page.locator(".pilot-draft-banner").count(), 0);
        assert.equal(await page.locator(".cost-gatewayTransfer").count(), 0);
        assert.equal(await page.locator(".trip-hero img").count(), 0);
        assert.equal(
          await page
            .locator(
              'a[href*="booking.com"],a[href*="agoda.com"],a[href*="trip.com"]',
            )
            .count(),
          0,
        );
        assert.equal(
          await page.locator('meta[name="robots"]').getAttribute("content"),
          "noindex, follow",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        assert.doesNotMatch(
          await page.content(),
          /contentDigest|identityDigest|evidenceDigest|warningsAcknowledged|selectionAndOrder|"reviewer"/,
        );
        assert.match(
          await page.locator(".trip-stay-price").innerText(),
          locale === "en" ? /estimate/i : /vlerësim/i,
        );
        assert.equal(
          await page.locator(".cost-rows .cost-transport").count(),
          ["normal", "restored"].includes(mode) ? 1 : 0,
        );
        if (["normal", "restored"].includes(mode))
          assert.ok(
            (await page.locator(".trip-flight-route").innerText()).includes(
              airports[i],
            ),
          );
        else
          assert.equal(
            await page.locator(".cost-rows .cost-buffer").count(),
            0,
          );
        const disclosure = page.locator("#trip-sources");
        await disclosure.locator(":scope > summary").focus();
        await page.keyboard.press("Enter");
        assert.equal(await disclosure.getAttribute("open"), "");
        assert.equal(
          await disclosure.locator(".trip-content-source-list li").count(),
          content.sources.length,
        );
        for (const source of content.sources) {
          const link = disclosure.locator(`a[href="${source.url}"]`);
          assert.ok(await link.isVisible());
          assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
        }
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        if (width === 320)
          await page.screenshot({
            path: join(
              output,
              `${mode}-${key.replaceAll(":", "-")}-sources.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
        await disclosure.locator(":scope > summary").focus();
        await page.keyboard.press("Enter");
        assert.equal(await disclosure.getAttribute("open"), null);
        if (mode === "normal" && width === 1440) {
          await page.evaluate(() => {
            document.documentElement.style.zoom = "2";
          });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
          );
          await page.screenshot({
            path: join(output, `${mode}-${key.replaceAll(":", "-")}-zoom.png`),
            fullPage: true,
            animations: "disabled",
          });
          await page.evaluate(() => {
            document.documentElement.style.zoom = "";
          });
        }
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
          window.scrollTo(0, 0);
        });
        await page.screenshot({
          path: join(output, `${mode}-${key.replaceAll(":", "-")}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.locator(".flight-booking .affiliate-action button").click();
        await page.waitForURL("https://avs.io/**");
        assert.deepEqual(handoffs.at(-1), {
          originCode: "ZRH",
          destinationCode: ["normal", "restored"].includes(mode)
            ? airports[i]
            : codes[i],
          departureDate: "2026-11-20",
          returnDate: "2026-11-22",
          party: { adults: 2, children: 0 },
        });
        console.log(
          `PASS ${mode} ${key}: generated link, reload, actual airport/city handoff, reviewed content, keyboard sources, estimates, no overflow`,
        );
      }
  if (mode === "normal")
    writeFileSync(file, JSON.stringify(links, null, 2) + "\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
} finally {
  await browser.close();
}
