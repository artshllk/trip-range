/** Run only against the explicit local synthetic flight-reliability fixture. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3154";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/phase4c/browser";
mkdirSync(output, { recursive: true });
const mode = process.env.VERIFY_FLIGHT_MODE || "normal";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "setup";
const query = (month = "2026-11", additional = {}) =>
  new URLSearchParams({
    origin: "zurich",
    currency: "EUR",
    budget: "3000",
    adults: "2",
    children: "0",
    when: "custom",
    start: `${month}-20`,
    end: `${month}-22`,
    nights: "2",
    flex: "0",
    ...additional,
  });
try {
  const context = await browser.newContext();
  const errors = [],
    forbidden = [],
    handoffs = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/_vercel/"))
      return route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "/* local QA */",
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
  page.on("pageerror", (e) => errors.push(`${stage}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${stage}: ${m.text()}`);
  });
  const checkPage = async () => {
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
  const detail = async (id, locale, priced = true) => {
    await page.locator(".trip-detail-page").waitFor();
    const name =
      id === "place:Q34600"
        ? "Kyoto"
        : id === "city:ABC"
          ? "Synthetic City"
          : id === "paris"
            ? locale === "en"
              ? "Paris"
              : "Parisi"
            : locale === "en"
              ? "Crete"
              : "Kreta";
    assert.equal(await page.locator("h1").innerText(), name);
    const costs = page.locator(".cost-rows");
    assert.equal(
      await costs.locator(".cost-transport").count(),
      priced ? 1 : 0,
    );
    if (!priced) assert.equal(await costs.locator(".cost-buffer").count(), 0);
    if (["paris", "place:Q34600"].includes(id)) {
      const content = JSON.parse(
        readFileSync(
          `content/destinations/${id === "paris" ? "paris" : "place-Q34600"}.json`,
          "utf8",
        ),
      );
      assert.ok(
        (await page.locator("main").innerText()).includes(
          content.overview.text[locale],
        ),
      );
    }
    await checkPage();
  };
  const book = async (
    endpoint,
    day = "2026-11-20",
    returning = "2026-11-22",
    departure = "ZRH",
  ) => {
    await page.locator(".flight-booking .affiliate-action button").click();
    await page.waitForURL("https://avs.io/**");
    assert.deepEqual(handoffs.at(-1), {
      originCode: departure,
      destinationCode: endpoint,
      departureDate: day,
      returnDate: returning,
      party: { adults: 2, children: 0 },
    });
  };
  for (const locale of ["en", "sq"])
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      await page.emulateMedia({
        reducedMotion: width === 320 ? "reduce" : "no-preference",
      });
      if (mode !== "normal") {
        for (const id of ["paris", "place:Q34600", "city:ABC", "crete"]) {
          stage = `${mode}-${id}-${locale}-${width}`;
          await page.goto(
            `${origin}/${locale}/plan/trips/${encodeURIComponent(id)}?${query()}`,
          );
          await detail(id, locale, false);
          await page.reload();
          await detail(id, locale, false);
          if (id === "place:Q34600")
            assert.match(
              await page.locator(".flight-booking").innerText(),
              /Osaka|Osakës/,
            );
          await page.screenshot({
            path: join(output, `${stage.replaceAll(":", "-")}.png`),
            fullPage: true,
            animations: "disabled",
          });
          console.log(
            `PASS ${stage}: fresh-process identity, missing fare, reload, no overflow`,
          );
        }
        continue;
      }
      for (const id of ["paris", "place:Q34600", "city:ABC"]) {
        stage = `results-detail-${id}-${locale}-${width}`;
        const q = query(id === "city:ABC" ? "2026-12" : "2026-11");
        await page.goto(`${origin}/${locale}/plan/results?${q}`);
        const card = page.locator(".trip-card").filter({
          has: page.locator(`a[href*="/trips/${encodeURIComponent(id)}?"]`),
        });
        await card.waitFor();
        assert.equal(await card.getAttribute("data-pricing"), "complete");
        await checkPage();
        if (id === "paris")
          await page.screenshot({
            path: join(output, `results-${locale}-${width}.png`),
            fullPage: true,
            animations: "disabled",
          });
        const href = await card.locator("a.button").getAttribute("href");
        await card.locator("a.button").click();
        await page.waitForURL(`${origin}${href}`);
        await detail(id, locale);
        await page.reload();
        await detail(id, locale);
        if (id !== "city:ABC")
          await page.screenshot({
            path: join(
              output,
              `detail-${id.replaceAll(":", "-")}-${locale}-${width}.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
        await book(
          id === "paris" ? "CDG" : id === "place:Q34600" ? "KIX" : "ABC",
          q.get("start"),
          q.get("end"),
        );
        console.log(
          `PASS ${stage}: generated link, reload, actual airport/date affiliate handoff`,
        );
      }
      stage = `targeted-paris-${locale}-${width}`;
      // Broad February contains no Paris; a fresh detail request must target PAR.
      await page.goto(
        `${origin}/${locale}/plan/trips/paris?${query("2027-02")}`,
      );
      await detail("paris", locale);
      await book("CDG", "2027-02-20", "2027-02-22");
      stage = `explicit-destination-${locale}-${width}`;
      const destination = {
        id: "city:PAR",
        type: "city",
        cityCode: "PAR",
        name: "Paris",
        countryCode: "FR",
        countryName: { en: "France", sq: "Franca" },
      };
      await page.goto(
        `${origin}/${locale}/plan/results?${query("2027-02", { toPlace: JSON.stringify(destination) })}`,
      );
      await page.locator('.trip-card a[href*="/trips/paris?"]').waitFor();
      await checkPage();
      stage = `reference-${locale}-${width}`;
      await page.goto(
        `${origin}/${locale}/plan/trips/paris?${query("2027-01")}`,
      );
      await detail("paris", locale, false);
      assert.equal(await page.locator(".trip-reference").count(), 1);
      await book("PAR", "2027-01-20", "2027-01-22");
      stage = `flexible-${locale}-${width}`;
      await page.goto(
        `${origin}/${locale}/plan/trips/paris?${query("2027-03", { flexDays: "3" })}`,
      );
      await detail("paris", locale);
      await book("CDG", "2027-03-21", "2027-03-23");
      stage = `actual-origin-airport-${locale}-${width}`;
      const london = {
        id: "city:LON",
        type: "city",
        cityCode: "LON",
        name: "London",
        countryCode: "GB",
        countryName: { en: "United Kingdom", sq: "Mbretëria e Bashkuar" },
      };
      await page.goto(
        `${origin}/${locale}/plan/trips/paris?${query("2026-11", { originPlace: JSON.stringify(london) })}`,
      );
      await detail("paris", locale);
      assert.match(await page.locator(".trip-flight-route").innerText(), /LHR/);
      await book("CDG", "2026-11-20", "2026-11-22", "LHR");
      stage = `nearby-partial-${locale}-${width}`;
      await page.goto(
        `${origin}/${locale}/plan/results?${query("2026-11", { origin: "prishtina", airports: "1", styles: "city" })}`,
      );
      await page.locator(".trip-card").first().waitFor();
      assert.doesNotMatch(
        await page.locator("main").innerText(),
        /Provider unavailable|Ofruesi nuk/,
      );
      await checkPage();
      console.log(
        `PASS ${locale}-${width}: targeted Paris, explicit destination, reference isolation, flexible dates, optional-airport partial failure`,
      );
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  console.log(
    `PASS ${mode}: no client errors, unexpected 404, overflow, AI/media/research calls`,
  );
} catch (e) {
  console.error(`FAIL ${stage}: ${e.stack}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
