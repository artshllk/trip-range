/** Keyless, localhost-only browser acceptance; all non-local browser requests abort. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://localhost:3217";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const analytics = [],
    errors = [];
  page.on("request", (r) => {
    if (/_vercel\/insights|vercel-insights|vercel-scripts/.test(r.url()))
      analytics.push(r.url());
  });
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("console", (m) => {
    if (/content security policy|violates.*directive/i.test(m.text()))
      errors.push("csp");
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const locale of ["en", "sq"]) {
      const results = `/${locale}/plan/results?scope=domestic&budget=300`;
      for (const path of [
        `/${locale}`,
        results,
        `/${locale}/plan/trips/prizren?scope=domestic&budget=300`,
      ]) {
        await page.goto(origin + path);
        await page.locator("main").waitFor();
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
      }
      await page.goto(origin + results);
      await page.locator(".trip-card").first().waitFor();
      const normal = await page.locator(".trip-card").allTextContents();
      await page.goto(origin + results + "&ai=1");
      await page.locator(".trip-card").first().waitFor();
      assert.deepEqual(
        await page.locator(".trip-card").allTextContents(),
        normal,
        "missing AI preserves deterministic cards and prices",
      );
    }
  }
  await page.goto(origin + "/");
  await page.locator(".ai-trigger").click();
  await page.locator("textarea").fill("A weekend trip");
  await page.locator(".ai-search-panel button.button").click();
  await page.locator('.ai-search-panel [role="alert"]').waitFor();
  assert.match(
    await page.locator('.ai-search-panel [role="alert"]').innerText(),
    /normal search/,
  );
  const destination = encodeURIComponent(
    JSON.stringify({
      id: "city:VIE",
      type: "city",
      name: "Vienna",
      cityCode: "VIE",
      countryCode: "AT",
      countryName: { en: "Austria", sq: "Austria" },
    }),
  );
  await page.goto(
    `${origin}/plan/trips/city%3AVIE?origin=zurich&budget=2000&toPlace=${destination}`,
  );
  await page
    .getByRole("button", { name: /Check (?:current )?flights on Aviasales/ })
    .click();
  await page.getByRole("button", { name: /Retry flight search/ }).waitFor();
  assert.ok((await page.locator("main").innerText()).length > 100);
  assert.deepEqual(
    analytics,
    [],
    "Netlify must not request any Vercel analytics endpoint, including after AI/affiliate events",
  );
  assert.deepEqual(errors, [], "no browser errors or CSP violations");
  console.log(
    "PASS Netlify Chromium 1440/390/320 EN/SQ, SSR hydration, stable prices/cards with AI unavailable, AI fallback, actual keyless affiliate failure, zero Vercel analytics requests, no overflow/errors/CSP violations.",
  );
} finally {
  await browser.close();
}
