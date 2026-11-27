/** Local-only Phase 5H acceptance: SYNTHETIC fares, real routes and reviewed content. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3157";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const mode = process.env.VERIFY_NON_CITY_MODE || "normal";
assert.ok(["normal", "restored", "empty", "failure"].includes(mode));
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/phase5h/noncity";
mkdirSync(output, { recursive: true });
const file = join(output, "generated-links.json");
const links = mode === "normal" ? {} : JSON.parse(readFileSync(file, "utf8"));
const proofs = [
  { id: "crete", country: "GR", airport: "CHQ", fallback: "HER" },
  { id: "place:Q1490", country: "JP", airport: "NRT", fallback: "NRT" },
  { id: "place:Q1273", country: "IT", airport: "PSA", fallback: "PSA" },
  {
    id: "place:Q180402",
    country: "US",
    airport: "FAT",
    fallback: "FAT",
    gateway: true,
  },
];
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
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/_vercel/"))
      return route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "/* QA */",
      });
    if (url.hostname === "avs.io")
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Synthetic handoff</h1>",
      });
    if (
      url.origin !== origin ||
      /\/api\/(ai|content|media)/.test(url.pathname)
    ) {
      forbidden.push(url.hostname + url.pathname);
      return route.abort();
    }
    if (url.pathname === "/api/affiliate/flights")
      handoffs.push(JSON.parse(route.request().postData()).route);
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const proof of proofs) {
    const content = JSON.parse(
      readFileSync(
        `content/destinations/${proof.id.replaceAll(":", "-")}.json`,
        "utf8",
      ),
    );
    assert.equal(content.reviewStatus, "reviewed");
    for (const locale of mode === "normal" ? ["en", "sq"] : ["en"])
      for (const width of mode === "normal" ? [1440, 390, 320] : [1440]) {
        const key = `${proof.id}-${locale}-${width}`;
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
          });
          // A normal country search allows canonical region/park discovery without inventing
          // a city-shaped location snapshot for a non-city identity.
          q.set(
            "toPlace",
            JSON.stringify({
              id: `country:${proof.country}`,
              type: "country",
              name: proof.country,
              countryCode: proof.country,
              countryName: { en: proof.country, sq: proof.country },
            }),
          );
          await page.goto(`${origin}/${locale}/plan/results?${q}`);
          const card = page.locator(".trip-card").filter({
            has: page.locator(
              `a[href*="/trips/${encodeURIComponent(proof.id)}?"]`,
            ),
          });
          await card.waitFor();
          assert.equal(await card.count(), 1);
          assert.equal(
            await card.getAttribute("data-pricing"),
            proof.gateway ? "required-transfer-unpriced" : "complete",
          );
          links[key] = await card.locator("a.button").getAttribute("href");
          await card.locator("a.button").click();
          await page.waitForURL(origin + links[key]);
        } else await page.goto(origin + links[key]);
        await page.locator(".trip-detail-page").waitFor();
        await page.reload();
        await page.locator(".trip-detail-page").waitFor();
        // Concise previews retain longer authorized copy in keyboard-accessible disclosures.
        for (const disclosure of await page
          .locator(".trip-content-more")
          .all()) {
          await disclosure.locator(":scope > summary").focus();
          await page.keyboard.press("Enter");
          assert.equal(await disclosure.getAttribute("open"), "");
        }
        const body = await page.locator("main").innerText();
        assert.equal(await page.locator("h1").count(), 1);
        assert.equal(body.includes(content.overview.text[locale]), true);
        assert.deepEqual(
          await page.locator(".trip-place-row h3").allTextContents(),
          content.attractions.map((a) => a.name[locale]),
        );
        for (const a of content.attractions)
          assert.equal(body.includes(a.shortDescription[locale]), true);
        for (const a of content.areas ?? [])
          assert.equal(body.includes(a.summary[locale]), true);
        for (const a of content.transport ?? [])
          assert.equal(body.includes(a.guidance[locale]), true);
        for (const a of content.practicalNotes ?? [])
          assert.equal(body.includes(a.text[locale]), true);
        assert.equal(
          await page.locator(".pilot-draft-banner,.trip-hero img").count(),
          0,
        );
        assert.doesNotMatch(
          body,
          /DRAFT|NOT PUBLISHED|evidence-review|no flights exist|Tuscany Airport|Yosemite Airport/i,
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
              proof.airport,
            ),
          );
        if (!priced || proof.gateway)
          assert.equal(
            await page
              .locator(".cost-rows .cost-buffer,.trip-budget .fit")
              .count(),
            0,
          );
        if (proof.gateway)
          assert.match(
            await page.locator(".flight-booking .gateway-summary").innerText(),
            locale === "en" ? /onward transfer.*required/ : /kërkohet transfer/,
          );
        else
          assert.equal(await page.locator(".cost-gatewayTransfer").count(), 0);
        if (proof.id === "place:Q1273")
          assert.match(
            await page.locator(".flight-booking .gateway-summary").innerText(),
            /Pisa|Piza/,
          );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        const sources = page.locator("#trip-sources");
        await sources.locator(":scope > summary").focus();
        await page.keyboard.press("Enter");
        assert.equal(await sources.getAttribute("open"), "");
        const items = [
          content,
          content.overview,
          ...content.highlights,
          ...content.attractions,
          ...content.areas,
          ...content.transport,
          ...content.practicalNotes,
          ...content.dayTemplates,
        ];
        const used = new Set(items.flatMap((item) => item?.sourceIds ?? []));
        const publicSources = content.sources.filter((source) =>
          used.has(source.id),
        );
        assert.equal(
          await sources.locator(".trip-content-source-list li").count(),
          publicSources.length,
        );
        for (const source of publicSources) {
          const link = sources.locator(`a[href="${source.url}"]`);
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
        await sources.locator(":scope > summary").focus();
        await page.keyboard.press("Enter");
        assert.equal(await sources.getAttribute("open"), null);
        for (const disclosure of await page
          .locator(".trip-content-more[open]")
          .all()) {
          await disclosure.locator(":scope > summary").focus();
          await page.keyboard.press("Enter");
          assert.equal(await disclosure.getAttribute("open"), null);
        }
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
          document.activeElement?.blur();
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
          destinationCode: priced ? proof.airport : proof.fallback,
          departureDate: "2026-11-20",
          returnDate: "2026-11-22",
          party: { adults: 2, children: 0 },
        });
        console.log(
          `PASS ${mode} ${key}: canonical route, reload, reviewed content, keyboard sources, exact handoff, truthful costs, no overflow`,
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
