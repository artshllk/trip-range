/** Explicit live local browser verification. Never prints partner URLs or response bodies. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://localhost:3106";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "initialization";
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  const q =
    "origin=zurich&currency=EUR&budget=2000&adults=2&children=0&start=2026-11-07&end=2026-11-09";
  const overflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  stage = "A Zurich Anywhere";
  await page.goto(`${origin}/plan/results?${q}`);
  await page.locator(".trip-card").first().waitFor();
  await overflow();
  let dynamic = page
    .locator(".trip-card")
    .filter({ has: page.locator('a[href*="/trips/city:"]') });
  assert.ok(await dynamic.count());
  console.log("PASS A: live Anywhere displays a dynamic city");
  stage = "B Zurich city";
  await page.goto(`${origin}/plan/results?${q}&styles=city`);
  await page.locator(".trip-card").first().waitFor();
  dynamic = page
    .locator(".trip-card")
    .filter({ has: page.locator('a[href*="/trips/city:"]') });
  assert.ok(await dynamic.count());
  await page.screenshot({
    path: "/tmp/goeksplo-phase5-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  console.log("PASS B: city filter displays a dynamic city");
  stage = "D detail restore";
  await dynamic
    .first()
    .getByRole("link", { name: /View trip|Explore trip/ })
    .click();
  await page
    .getByRole("button", { name: /Check flights on Aviasales/ })
    .waitFor();
  const detailUrl = page.url();
  await page.reload();
  await page
    .getByRole("button", { name: /Check flights on Aviasales/ })
    .waitFor();
  assert.ok(
    (await page.locator("main").innerText()).includes("GoEksplo estimate"),
  );
  await overflow();
  stage = "D affiliate";
  let finish;
  const conversion = new Promise((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/affiliate/flights", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    finish({
      status: body.status,
      http: response.status(),
      host:
        body.status === "available"
          ? new URL(body.link.url).hostname
          : undefined,
    });
    // Verify real conversion while keeping the browser local and tracking data out of output.
    await route.fulfill({ status: 503, json: { status: "unavailable" } });
  });
  await page
    .getByRole("button", { name: /Check flights on Aviasales/ })
    .click();
  const converted = await conversion;
  console.log(
    JSON.stringify({
      affiliateStatus: converted.status,
      http: converted.http,
      partnerHost: converted.host,
    }),
  );
  assert.equal(converted.status, "available");
  console.log("PASS D: shared dynamic detail and live affiliate conversion");
  await page.unroute("**/api/affiliate/flights");
  stage = "C Prishtina nearby";
  await page.goto(
    `${origin}/plan/results?${q.replace("origin=zurich", "origin=prishtina")}&airports=1`,
  );
  await page.locator(".trip-card").first().waitFor();
  const names = await page.locator(".trip-card h2").allTextContents();
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length <= 3);
  await overflow();
  console.log(
    "PASS C: nearby-airport search has at most three distinct destination cards",
  );
  stage = "E Albanian AI";
  await page.goto(`${origin}/sq`);
  await page.locator(".ai-trigger").click();
  await page
    .locator("textarea")
    .fill(
      "Kam 700 euro per dy persona nga Zurich, vikendin tjeter, dua qytet.",
    );
  await page.locator(".ai-search-panel button").click();
  await page.getByRole("button", { name: "EUR", exact: true }).click();
  await page
    .locator(".ai-search-panel")
    .getByRole("button", { name: /^Gjej udhëtimin tim/ })
    .click();
  await page.waitForURL(
    (u) =>
      u.pathname === "/sq/plan/results" && u.searchParams.get("ai") === "1",
  );
  assert.equal(new URL(page.url()).searchParams.get("budget"), "700");
  assert.equal(new URL(page.url()).searchParams.get("styles"), "city");
  assert.equal(new URL(page.url()).searchParams.get("origin"), "zurich");
  const aiUrl = page.url();
  console.log(
    "PASS E: live Albanian AI produces ordinary city-discovery search",
  );
  stage = "mobile";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/plan/results?${q}&styles=city`);
  await page.locator(".trip-card").first().waitFor();
  await overflow();
  await page.screenshot({
    path: "/tmp/goeksplo-phase5-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.goto(detailUrl);
  await page
    .getByRole("button", { name: /Check flights on Aviasales/ })
    .waitFor();
  await overflow();
  await page.goto(aiUrl);
  await page.locator(".search-results-bar").waitFor();
  await overflow();
  console.log(
    "PASS 390px: dynamic results, shared detail, Albanian search and no horizontal overflow",
  );
} catch {
  console.error(`FAIL ${stage}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
