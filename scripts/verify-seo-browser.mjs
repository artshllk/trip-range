/** Local browser QA; use the opt-in SEO fixture server for deterministic trip cards. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3111";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const paths = [
  "/from/zurich",
  "/from/zurich/weekend-trips",
  "/from/zurich/weekend-trips-under-500",
];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "initialization";
try {
  const page = await browser.newPage();
  // Vercel injects this resource on deployment; next start does not serve it.
  // Stub only this known platform endpoint. All application errors still fail QA.
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "/* local platform analytics stub */",
    }),
  );
  page.setDefaultTimeout(20000);
  const errors = [];
  const forbidden = [];
  page.on("pageerror", (error) =>
    errors.push({
      kind: "pageerror",
      stage,
      message: error.message.replace(/https?:\/\/\S+/g, "[URL]").slice(0, 180),
    }),
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push({
        kind: "console-error",
        stage,
        message: m
          .text()
          .replace(/https?:\/\/\S+/g, "[URL]")
          .slice(0, 180),
      });
  });
  page.on("request", (r) => {
    if (/\/api\/ai\/|api.openai.com|\/api\/affiliate\//.test(r.url()))
      forbidden.push("unexpected-provider-call");
  });
  const overflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "horizontal overflow",
    );
  const metrics = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.emulateMedia({
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    for (const [i, path] of paths.entries()) {
      stage = `${width}px ${path}`;
      await page.goto(origin + path);
      await page.locator(".trip-card").first().waitFor();
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.locator(".trip-card h2").count(), 0);
      assert.equal(await page.locator(".trip-card h3").count(), 3);
      assert.equal(
        await page.locator('link[rel="canonical"]').getAttribute("href"),
        "https://www.trip-range.com" + path,
      );
      assert.equal(
        await page.locator('meta[name="robots"]').getAttribute("content"),
        "index, follow",
      );
      assert.ok(
        (await page.locator(".search-field").first().innerText()).includes(
          "Zurich",
        ),
        "prefilled origin",
      );
      assert.ok(
        (await page.locator(".search-field").nth(4).innerText()).includes(
          i === 2 ? "€500" : "€700",
        ),
      );
      await overflow();
      const schema = JSON.parse(
        await page.locator('script[type="application/ld+json"]').innerText(),
      );
      assert.deepEqual(
        schema.itemListElement.map((e) => e.name),
        await page.locator(".seo-breadcrumb li").allTextContents(),
      );
      await page.screenshot({
        path: `/tmp/goeksplo-seo-${i}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      if (i === 2 && width === 390)
        await page.screenshot({
          path: "/tmp/goeksplo-seo-mobile-viewport.png",
          animations: "disabled",
        });
      const timing = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return {
          ttfbMs: Math.round(n.responseStart),
          domLoadedMs: Math.round(n.domContentLoadedEventEnd),
        };
      });
      metrics.push({ width, path, ...timing });
      await page.locator(".trip-card summary").first().click();
      assert.ok(
        (await page
          .locator(".trip-card details")
          .first()
          .getAttribute("open")) !== null,
      );
      await overflow();
      await page.locator("#methodology").scrollIntoViewIfNeeded();
      assert.ok(
        (await page.locator("#methodology").innerText()).includes(
          "not expected spending",
        ),
      );
      await overflow();
      // The existing field editor remains a single accessible layer on SEO entry pages.
      await page.locator(".search-field").nth(4).click();
      assert.equal(await page.locator("dialog[open]").count(), 1);
      await overflow();
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
      await page.locator(".seo-main-cta").click();
      await page.waitForURL("**/plan/results?**");
      const q = new URL(page.url()).searchParams;
      assert.equal(q.get("origin"), "zurich");
      assert.equal(q.get("budget"), i === 2 ? "500" : "700");
      assert.equal(q.get("adults"), "2");
      assert.equal(
        await page.locator('meta[name="robots"]').getAttribute("content"),
        "noindex, follow",
      );
    }
    stage = `${width}px card and breadcrumb navigation`;
    await page.goto(origin + paths[2]);
    await page.locator(".trip-card a.button").first().click();
    await page.waitForURL("**/plan/trips/**");
    assert.equal(new URL(page.url()).searchParams.get("origin"), "zurich");
    assert.equal(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      "noindex, follow",
    );
    await page.goto(origin + paths[2]);
    await page
      .locator(".seo-breadcrumb")
      .getByRole("link", { name: "Weekend trips", exact: true })
      .click();
    await page.waitForURL(origin + paths[1]);
    await page
      .locator(".seo-link-list")
      .last()
      .getByRole("link", { name: /under €500/ })
      .click();
    await page.waitForURL(origin + paths[2]);
    // App Router may briefly retain the previous route tree during a transition.
    if (await page.locator(".mobile-menu-trigger:visible").count())
      await page.locator(".mobile-menu-trigger:visible").click();
    else await page.getByRole("button", { name: "Language: EN" }).click();
    await page.getByRole("link", { name: "Shqip", exact: true }).click();
    await page.waitForURL(origin + "/sq");
    assert.equal(await page.locator("html").getAttribute("lang"), "sq");
    // Submit the shared search controls, as well as the link CTA above.
    await page.goto(origin + paths[2]);
    await page.locator(".search-submit").click();
    await page.waitForURL("**/plan/results?**");
    assert.equal(new URL(page.url()).searchParams.get("budget"), "500");
  }
  if (errors.length) console.log(JSON.stringify({ browserErrors: errors }));
  assert.deepEqual(errors, [], "client errors");
  assert.deepEqual(forbidden, [], "no automatic AI/affiliate requests");
  console.log(JSON.stringify({ localWarmCacheMetrics: metrics }));
  console.log(
    "PASS 1440px/390px: three landings, cards, CTA/search, breadcrumbs, related links, SQ fallback, schema, metadata, methodology, one sheet, reduced motion, no overflow or client errors",
  );
} catch (error) {
  console.error(
    `FAIL ${stage}: ${String(error?.message ?? "browser failure")
      .split("\n")[0]
      .slice(0, 180)}`,
  );
  console.error(
    String(error?.stack ?? "")
      .split("\n")
      .find((line) => line.includes("verify-seo-browser.mjs")) ?? "",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
