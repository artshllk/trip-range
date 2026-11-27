/** Normal production routes, never draft preview. Run against an isolated local server. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3133";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/paris-publication";
mkdirSync(output, { recursive: true });
const paris = JSON.parse(
  readFileSync("content/destinations/paris.json", "utf8"),
);
assert.equal(paris.reviewStatus, "reviewed");
assert.equal(paris.contentVersion, 2);
assert.equal(
  paris.publication.contentDigest,
  "06630ba7dfa8b915e5ce54288b979dd6fb67325ba110fc23d171646901471c09",
);
const query = new URLSearchParams({
  origin: "zurich",
  currency: "EUR",
  budget: "2000",
  adults: "2",
  children: "0",
  when: "custom",
  start: "2026-11-20",
  end: "2026-11-23",
  nights: "3",
  toPlace: JSON.stringify({
    id: "city:PAR",
    type: "city",
    name: "Paris",
    cityCode: "PAR",
    countryCode: "FR",
    countryName: { en: "France", sq: "France" },
  }),
});
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
    forbidden = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/_vercel/"))
      return route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "/* local analytics stub */",
      });
    if (
      url.origin !== origin ||
      /\/api\/(?:ai|content|media|affiliate)/.test(url.pathname)
    ) {
      forbidden.push(`${stage}: ${url.hostname}${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${stage}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${stage}: ${message.text()}`);
  });
  page.setDefaultTimeout(15000);
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `No horizontal overflow: ${stage}`,
    );
  for (const locale of ["en", "sq"]) {
    for (const width of [1440, 390, 320]) {
      stage = `${locale}-${width}`;
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      await page.emulateMedia({
        reducedMotion: width === 320 ? "reduce" : "no-preference",
      });
      await page.goto(`${origin}/${locale}/plan/results?${query}`);
      const tripLink = page
        .locator(`a[href^="/${locale}/plan/trips/paris?"]`)
        .first();
      const href = await tripLink.getAttribute("href");
      assert.ok(href, "Paris comes from the normal results page");
      await tripLink.click();
      await page.waitForURL(`${origin}${href}`);
      await page.locator(".trip-detail-page").waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(
        await page.locator('meta[name="robots"]').getAttribute("content"),
        "noindex, follow",
      );
      const html = await page.content();
      assert.ok(
        html.includes(paris.overview.text[locale]),
        `${stage}: reviewed overview`,
      );
      assert.doesNotMatch(
        html,
        /DRAFT — NOT PUBLISHED|evidence-review|contentDigest|identityDigest|"reviewer"/,
      );
      for (const item of paris.attractions) {
        assert.equal(
          await page
            .locator(`[id="trip-attraction-${item.id}"] h3`)
            .textContent(),
          item.name[locale],
        );
      }
      assert.ok(
        (await page.locator(".trip-area-list").innerText()).includes(
          paris.areas[0].tradeoffs[0][locale],
        ),
      );
      assert.ok(
        (await page.locator("#getting-around").innerText()).includes(
          paris.transport[0].guidance[locale],
        ),
      );
      assert.ok(html.includes(paris.practicalNotes[0].text[locale]));
      assert.equal(await page.locator(".trip-detail-media img").count(), 0);
      assert.equal(
        await page.locator(".trip-detail-media .destination-no-image").count(),
        1,
      );
      await noOverflow();
      const budgetBefore = await page.locator(".trip-budget").innerText();
      await page.screenshot({
        path: join(output, `paris-${locale}-${width}.png`),
        fullPage: true,
      });
      const sources = page.locator("#trip-sources > summary");
      await sources.focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator("#trip-sources").getAttribute("open"),
        "",
      );
      for (const source of paris.sources) {
        const link = page.locator(`[id="destination-source-${source.id}"] > a`);
        assert.equal(await link.getAttribute("href"), source.url);
        assert.equal(await link.getAttribute("target"), "_blank");
        assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
        assert.ok(await link.isVisible());
        await link.focus();
        assert.equal(
          await link.evaluate((element) => element === document.activeElement),
          true,
        );
      }
      await noOverflow();
      assert.equal(
        await page.locator(".trip-budget").innerText(),
        budgetBefore,
      );
      if (locale === "sq" && width === 320) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: join(output, "paris-sq-320-sources.png"),
          fullPage: true,
        });
      }
      // The RSC response is also a public surface, not just the visible DOM.
      const rsc = await fetch(origin + href, { headers: { RSC: "1" } });
      assert.equal(rsc.status, 200);
      const payload = await rsc.text();
      assert.ok(payload.includes(paris.overview.text[locale]));
      assert.doesNotMatch(
        payload,
        /DRAFT — NOT PUBLISHED|evidence-review|contentDigest|identityDigest|"reviewer"/,
      );
      await page.locator(".stay-level").first().click();
      assert.notEqual(
        await page.locator(".trip-budget").innerText(),
        budgetBefore,
      );
      assert.equal(
        await page.locator(".stay-level").first().getAttribute("aria-pressed"),
        "true",
      );
      assert.ok((await page.content()).includes(paris.overview.text[locale]));
      for (const item of paris.attractions)
        assert.equal(
          await page
            .locator(`[id="trip-attraction-${item.id}"] h3`)
            .textContent(),
          item.name[locale],
        );
      console.log(
        `PASS reviewed Paris ${stage}: normal results → trip, copy, sources, no-photo, noindex, no overflow`,
      );
    }
  }
  for (const id of ["place:Q60", "place:Q4648", "crete", "london"]) {
    const record = JSON.parse(
      readFileSync(`content/destinations/${id.replace(":", "-")}.json`, "utf8"),
    );
    assert.equal(record.reviewStatus, "draft");
    const params = new URLSearchParams(query);
    params.delete("toPlace");
    if (id === "crete")
      params.set(
        "toPlace",
        JSON.stringify({
          id: "city:HER",
          type: "city",
          name: "Heraklion",
          cityCode: "HER",
          countryCode: "GR",
          countryName: { en: "Greece", sq: "Greqia" },
        }),
      );
    params.set("draft", "1");
    params.set("previewDraft", "1");
    params.set("preview", "1");
    params.set("reviewStatus", "reviewed");
    for (const locale of ["en", "sq"]) {
      for (const headers of [{}, { RSC: "1" }]) {
        const response = await fetch(
          `${origin}/${locale}/plan/trips/${encodeURIComponent(id)}?${params}`,
          { headers },
        );
        // Unavailable routes may stream a 200 response; neither surface may leak drafts.
        assert.ok([200, 404].includes(response.status));
        const body = await response.text();
        assert.ok(
          !body.includes(record.overview.text[locale]),
          `${id}: draft overview hidden`,
        );
        for (const item of record.attractions)
          assert.ok(
            !body.includes(`trip-attraction-${item.id}`),
            `${id}: draft attraction hidden`,
          );
      }
    }
    console.log(
      `PASS draft containment ${id}: EN/SQ HTML + RSC, forged preview flags ignored`,
    );
  }
  assert.deepEqual(errors, [], "No browser errors");
  assert.deepEqual(
    forbidden,
    [],
    "No browser research, image discovery, AI, affiliate or external request",
  );
  console.log(
    "PASS Paris production browser verification; 6 viewport/locale combinations",
  );
} finally {
  await browser.close();
}
