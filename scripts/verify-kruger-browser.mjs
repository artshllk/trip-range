/** Local-only acceptance: real routes, SYNTHETIC fares, reviewed content and independent reloads. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3157";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const mode = process.env.KRUGER_MODE,
  chosen = process.env.KRUGER_ENTRY;
assert.ok(["normal", "restored", "empty", "failure"].includes(mode));
assert.ok(["SZK", "MQP", "HDS", "PHW"].includes(chosen));
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/phase5n/kruger";
mkdirSync(output, { recursive: true });
const file = join(output, `links-${chosen}.json`),
  links = mode === "normal" ? {} : JSON.parse(readFileSync(file, "utf8"));
const content = JSON.parse(
  readFileSync("content/destinations/place-Q24451.json", "utf8"),
);
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
  for (const locale of mode === "normal" ? ["en", "sq"] : ["en"])
    for (const width of mode === "normal" ? [1440, 390, 320] : [1440]) {
      const key = `${locale}-${width}`;
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
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
          styles: "",
          toPlace: JSON.stringify({
            id: "country:ZA",
            type: "country",
            name: "South Africa",
            countryCode: "ZA",
            countryName: { en: "South Africa", sq: "Afrika e Jugut" },
          }),
        });
        await page.goto(`${origin}/${locale}/plan/results?${q}`);
        const card = page
          .locator(".trip-card")
          .filter({ has: page.locator('a[href*="/trips/place%3AQ24451?"]') });
        await card.waitFor();
        assert.equal(await card.count(), 1);
        assert.equal(
          await page.locator('.trip-card a[href*="/trips/city%3A"]').count(),
          0,
        );
        links[key] = await card.locator("a.button").getAttribute("href");
        const link = new URL(links[key], origin);
        assert.equal(link.searchParams.get("arrival"), chosen);
        assert.equal(
          link.searchParams.get("arrivalFor"),
          content.destinationId,
        );
        await card.locator("a.button").click();
        await page.waitForURL(origin + links[key]);
      } else await page.goto(origin + links[key]);
      await page.locator(".trip-detail-page").waitFor();
      await page.reload();
      await page.locator(".trip-detail-page").waitFor();
      assert.equal(
        await page.locator("h1").innerText(),
        "Kruger National Park",
      );
      for (const disclosure of await page.locator(".trip-content-more").all()) {
        await disclosure.locator(":scope > summary").focus();
        await page.keyboard.press("Enter");
        assert.equal(await disclosure.getAttribute("open"), "");
      }
      const body = await page.locator("main").innerText();
      assert.ok(body.includes(content.overview.text[locale]));
      for (const a of content.attractions)
        assert.ok(body.includes(a.shortDescription[locale]));
      assert.deepEqual(
        await page.locator(".trip-place-row h3").allTextContents(),
        content.attractions.map((a) => a.name[locale]),
      );
      for (const a of content.areas) {
        assert.ok(body.includes(a.summary[locale]));
        for (const tradeoff of a.tradeoffs)
          assert.ok(body.includes(tradeoff[locale]));
      }
      for (const a of content.transport)
        assert.ok(body.includes(a.guidance[locale]));
      for (const a of content.practicalNotes)
        assert.ok(body.includes(a.text[locale]));
      assert.equal(
        await page.locator(".pilot-draft-banner,.trip-hero img").count(),
        0,
      );
      const gateway = chosen !== "SZK";
      assert.equal(
        await page.locator(".cost-rows .cost-gatewayTransfer").count(),
        0,
      );
      if (gateway) {
        assert.match(
          body,
          locale === "en"
            ? /onward|transfer|journey/i
            : /vijim|transfer|udhëtim/i,
        );
        assert.equal(
          await page
            .locator(".cost-rows .cost-buffer,.trip-budget .fit")
            .count(),
          0,
        );
      }
      assert.doesNotMatch(
        body,
        /no flights exist|Kruger National Park has no flights|Kruger National Park Airport|evidence-review|contentDigest|identityDigest|reviewer|DRAFT|NOT PUBLISHED/i,
      );
      assert.equal(
        await page.locator('meta[name="robots"]').getAttribute("content"),
        "noindex, follow",
      );
      const priced = ["normal", "restored"].includes(mode);
      assert.equal(
        await page.locator(".cost-rows .cost-transport").count(),
        priced ? 1 : 0,
      );
      assert.ok(
        (await page.locator(".flight-booking").innerText()).includes(chosen),
      );
      if (!priced)
        assert.equal(
          await page
            .locator(".cost-rows .cost-buffer,.trip-budget .fit")
            .count(),
          0,
        );
      assert.match(
        await page.locator(".trip-stay-price").innerText(),
        locale === "en" ? /estimate/i : /vlerësim/i,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      assert.equal(
        await page
          .locator(
            'a[href*="booking.com"],a[href*="agoda.com"],a[href*="trip.com"]',
          )
          .count(),
        0,
      );
      if (mode === "normal" && chosen === "MQP" && width === 1440) {
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
          path: join(output, `${chosen}-${key}-zoom.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.evaluate(() => {
          document.documentElement.style.zoom = "";
        });
      }
      await page.screenshot({
        path: join(output, `${mode}-${chosen}-${key}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.locator("#trip-sources > summary").focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator("#trip-sources").getAttribute("open"),
        "",
      );
      assert.deepEqual(
        await page
          .locator(".trip-content-source-list a")
          .evaluateAll((links) => links.map((a) => a.href)),
        content.sources.map((s) => s.url),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      if (mode === "normal" && chosen === "MQP" && width === 320)
        await page.screenshot({
          path: join(output, `${mode}-${chosen}-${key}-sources.png`),
          fullPage: true,
          animations: "disabled",
        });
      await page.locator(".flight-booking .affiliate-action button").click();
      await page.waitForURL("https://avs.io/**");
      assert.deepEqual(handoffs.at(-1), {
        originCode: "ZRH",
        destinationCode: chosen,
        departureDate: "2026-11-20",
        returnDate: "2026-11-22",
        party: { adults: 2, children: 0 },
      });
      console.log(
        `PASS ${mode} ${chosen} ${key}: canonical shell, real endpoint, reviewed content visible, truthful costs, no overflow`,
      );
    }
  if (mode === "normal")
    writeFileSync(file, JSON.stringify(links, null, 2) + "\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
} finally {
  await browser.close();
}
