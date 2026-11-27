/** Local acceptance only: SYNTHETIC provider evidence, real routes, Phase 5F reviewed editorial. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3157";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const mode = process.env.VERIFY_BATCH2_MODE || "normal";
assert.ok(["normal", "restored", "empty", "failure"].includes(mode));
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/phase5f/browser";
mkdirSync(output, { recursive: true });
const file = join(output, "generated-links.json");
const links = mode === "normal" ? {} : JSON.parse(readFileSync(file, "utf8"));
const batch = JSON.parse(
  readFileSync("content/operations/batches/phase5e-batch2-cities.json", "utf8"),
);
const codes = ["PRN", "MEX", "RIO", "BUE", "CPT", "RAK", "DXB", "IST", "SYD"];
const airports = [
  "PRN",
  "TLC",
  "SDU",
  "EZE",
  "CPT",
  "RAK",
  "DXB",
  "SAW",
  "SYD",
];
const countries = ["XK", "MX", "BR", "AR", "ZA", "MA", "AE", "TR", "AU"];
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
  for (const [i, entry] of batch.entries.entries()) {
    const content = JSON.parse(
      readFileSync(
        `content/destinations/${entry.destinationId.replaceAll(":", "-")}.json`,
        "utf8",
      ),
    );
    assert.equal(content.reviewStatus, "reviewed");
    for (const locale of mode === "normal" ? ["en", "sq"] : ["en"])
      for (const width of mode === "normal" ? [1440, 390, 320] : [1440]) {
        const key = `${entry.destinationId}-${locale}-${width}`;
        await page.setViewportSize({
          width,
          height: width === 1440 ? 1000 : 844,
        });
        if (mode === "normal") {
          const selected = new URLSearchParams(q);
          selected.set(
            "toPlace",
            JSON.stringify({
              id: `city:${codes[i]}`,
              type: "city",
              cityCode: codes[i],
              iataCodes: [codes[i]],
              name: entry.name,
              countryCode: countries[i],
              countryName: { en: countries[i], sq: countries[i] },
            }),
          );
          await page.goto(`${origin}/${locale}/plan/results?${selected}`);
          const card = page.locator(".trip-card").filter({
            has: page.locator(
              `a[href*="/trips/${encodeURIComponent(entry.destinationId)}?"]`,
            ),
          });
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
        assert.ok((await page.locator("h1").innerText()).trim().length > 0);
        assert.equal(body.includes(content.overview.text[locale]), true);
        assert.equal(
          await page.locator(".trip-place-row").count(),
          content.attractions.length,
        );
        for (const a of content.attractions)
          assert.equal(body.includes(a.shortDescription[locale]), true);
        assert.deepEqual(
          await page.locator(".trip-place-row h3").allTextContents(),
          content.attractions.map((a) => a.name[locale]),
        );
        for (const a of content.areas ?? [])
          assert.equal(body.includes(a.summary[locale]), true);
        for (const a of content.transport ?? [])
          assert.equal(body.includes(a.guidance[locale]), true);
        for (const a of content.practicalNotes ?? [])
          assert.equal(body.includes(a.text[locale]), true);
        assert.doesNotMatch(body, /DRAFT|NOT PUBLISHED|evidence-review/i);
        assert.equal(
          await page
            .locator(".pilot-draft-banner,.cost-gatewayTransfer,.trip-hero img")
            .count(),
          0,
        );
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
        assert.doesNotMatch(
          await page.content(),
          /contentDigest|identityDigest|evidenceDigest|warningsAcknowledged|selectionAndOrder|"reviewer"/,
        );
        assert.match(
          await page.locator(".trip-stay-price").innerText(),
          locale === "en" ? /estimate/i : /vlerësim/i,
        );
        const priced = ["normal", "restored"].includes(mode);
        assert.equal(
          await page.locator(".cost-rows .cost-transport").count(),
          priced ? 1 : 0,
        );
        if (priced)
          assert.ok(
            (await page.locator(".trip-flight-route").innerText()).includes(
              airports[i],
            ),
          );
        else
          assert.equal(
            await page
              .locator(".cost-rows .cost-buffer,.trip-budget .fit")
              .count(),
            0,
          );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
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
          // Reset immediately after keyboard/zoom checks; page-level smooth
          // scrolling must not leave the fixed header mid-scroll in captures.
          window.scrollTo({ top: 0, behavior: "instant" });
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
          destinationCode: priced ? airports[i] : codes[i],
          departureDate: "2026-11-20",
          returnDate: "2026-11-22",
          party: { adults: 2, children: 0 },
        });
        console.log(
          `PASS ${mode} ${key}: generated link, reload, airport/city handoff, reviewed content, keyboard sources, estimates, no overflow`,
        );
      }
  }
  if (mode === "normal")
    writeFileSync(file, JSON.stringify(links, null, 2) + "\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
} finally {
  await browser.close();
}
