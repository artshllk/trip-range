/** Local production image-containment acceptance; all providers are synthetic. */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3116";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
assert.ok(
  process.env.EDITORIAL_FIXTURE_LOG,
  "synthetic operation log required",
);
const events = () =>
  readFileSync(process.env.EDITORIAL_FIXTURE_LOG, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).operation);
const forbidden = [
  "search",
  "locations",
  "ai-intent",
  "ai-explanations",
  "affiliate",
  "unexpected-provider",
  "editorial-images",
  "commons",
  "pexels",
];
const assertNoUserQuota = () =>
  assert.deepEqual(
    events().filter((op) => forbidden.includes(op)),
    [],
    "pageviews never consume user-operation quota or call flight/AI/affiliate providers",
  );
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
const screenshotDir =
  process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-editorial-containment";
mkdirSync(screenshotDir, { recursive: true });
try {
  for (const locale of ["en", "sq"]) {
    const response = await fetch(`${origin}/${locale}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal((html.match(/class="inspiration-card"/g) || []).length, 3);
    assertNoUserQuota();
  }
  const warm = events();
  assert.ok(warm.filter((op) => op === "editorial-images").length === 0);
  assert.ok(warm.filter((op) => op === "commons").length === 0);
  assert.ok(warm.filter((op) => op === "pexels").length === 0);
  for (const width of [1440, 390, 320])
    for (const locale of ["en", "sq"]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 1440 ? 900 : 844 },
        reducedMotion: "reduce",
      });
      const failures = [];
      page.on("pageerror", () => failures.push("client error"));
      page.on("request", (r) => {
        if (/\/api\/(ai|affiliate|locations)/.test(r.url()))
          failures.push("unexpected client fetch");
      });
      await page.route("**/_vercel/insights/script.js", (r) =>
        r.fulfill({ status: 200, body: "" }),
      );
      await page.goto(`${origin}/${locale}`);
      await page.locator(".home .search-submit").waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator(".inspiration-card").count(), 3);
      assert.equal(await page.locator(".inspiration-card img").count(), 0);
      assert.equal(
        await page.locator(".inspiration-card .destination-no-image").count(),
        3,
      );
      assert.equal(await page.locator(".inspiration-credit").count(), 0);
      assert.equal(
        await page.locator(".hero img").count(),
        1,
        "brand hero remains intentional imagery",
      );
      assert.match(
        await page.locator(".inspiration-card").last().innerText(),
        locale === "en"
          ? /Flight price needs checking/
          : /Çmimi i fluturimit duhet kontrolluar/,
      );
      for (const img of await page.locator("main img").all()) {
        await img.scrollIntoViewIfNeeded();
        await img.evaluate((el) => el.decode());
        assert.equal(
          await img.evaluate((el) => el.naturalWidth > 0),
          true,
          "no broken images",
        );
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      const height = Math.round(
        (await page.locator(".hero").boundingBox()).height,
      );
      assert.equal(
        height,
        width === 1440
          ? 648
          : width === 390
            ? locale === "en"
              ? 563
              : 602
            : locale === "en"
              ? 552
              : 586,
        "UX Phase 1 hero unchanged",
      );
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: `${screenshotDir}/${locale}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      assert.deepEqual(failures, []);
      assertNoUserQuota();
      assert.deepEqual(
        events(),
        warm,
        "EN/SQ editorial renders never search for images or consume quota",
      );
      console.log(
        `PASS ${locale} ${width}px: unchanged layout, three intact cards, no overflow, no protected quota or extra image calls`,
      );
      await page.close();
    }
  // A normal product search still goes through the real search gate; AI is not involved.
  await fetch(
    `${origin}/plan/results?origin=prishtina&scope=domestic&budget=500`,
  );
  assert.ok(events().includes("search"));
  assert.equal(events().includes("ai-intent"), false);
  assert.equal(events().includes("ai-explanations"), false);
  const beforeIntent = events().filter((op) => op === "ai-intent").length;
  const aiPage = await browser.newPage();
  await aiPage.route("**/_vercel/insights/script.js", (r) =>
    r.fulfill({ status: 200, body: "" }),
  );
  await aiPage.goto(`${origin}/`);
  await aiPage.locator(".home-ai-trigger").click();
  assert.equal(
    events().filter((op) => op === "ai-intent").length,
    beforeIntent,
    "opening Plan with AI spends no allowance",
  );
  await aiPage
    .locator("textarea")
    .fill("A quiet weekend from Prishtina for two with 500 euros");
  const submitted = aiPage.waitForResponse((response) =>
    response.url().endsWith("/api/ai/intent"),
  );
  await aiPage.locator(".ai-search-panel .button").click();
  await submitted;
  assert.equal(
    events().filter((op) => op === "ai-intent").length,
    beforeIntent + 1,
    "only an explicit AI submission reaches the intent gate",
  );
  assert.equal(
    events().includes("unexpected-provider"),
    false,
    "no live AI/provider calls",
  );
  await aiPage.close();
  console.log(
    "PASS real search stays protected; ordinary render/search uses zero AI calls; explicit AI POST reaches its own gate",
  );
} finally {
  await browser.close();
}
