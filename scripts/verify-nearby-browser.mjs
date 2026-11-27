/** Run against the explicitly started synthetic nearby-airports fixture server, never a live deployment. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://localhost:3103";
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin));
const screenshotDir = process.env.VERIFY_SCREENSHOTS || "/tmp";
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
  const errors = [];
  page.on("pageerror", () => errors.push("pageerror"));
  const query = (nearby, month = "11") =>
    `origin=prishtina&budget=500&adults=2&start=2026-${month}-${month === "11" ? "07" : "05"}&end=2026-${month}-${month === "11" ? "09" : "07"}&airports=${nearby ? 1 : 0}`;
  const visit = async (path) => {
    await page.goto(origin + path);
    await page.waitForSelector(".trip-card");
    await page.locator(".trip-card").first().waitFor({ state: "visible" });
  };
  const overflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  stage = "A: nearby off";
  await visit("/plan/results?" + query(false));
  assert.equal(
    await page
      .locator(".trip-card")
      .filter({ hasText: "Departure airport: SKP" })
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator(".trip-card")
      .filter({ hasText: "Departure airport: TIA" })
      .count(),
    0,
  );
  console.log("PASS A: nearby off preserves selected departure scope");
  stage = "B: nearby enabled";
  await page
    .getByRole("button", { name: "Nearby airports", exact: true })
    .click();
  await page.waitForURL((url) => url.searchParams.get("airports") === "1");
  const vienna = page.locator(".trip-card").filter({
    has: page.getByRole("heading", { name: "Vienna", exact: true }),
  });
  await vienna
    .locator(".result-destination")
    .getByText(/Departure airport: SKP/)
    .waitFor();
  await vienna.locator(".result-details > summary").click();
  assert.ok((await vienna.innerText()).includes("€120 cheaper after transfer"));
  assert.ok((await vienna.innerText()).includes("€80"));
  assert.ok((await vienna.innerText()).includes("€497.20"));
  await overflow();
  await page.screenshot({
    path: `${screenshotDir}/goeksplo-phase3b-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  console.log(
    "PASS B: SKP selected at €452 spend + €45.20 reserve; €120 saving includes €80 transfer",
  );
  stage = "D: alternative detail and affiliate handoff";
  await vienna.getByRole("link", { name: "View trip" }).click();
  await page.waitForURL((url) => url.pathname.includes("/trips/vienna"));
  assert.equal(new URL(page.url()).searchParams.get("departure"), "SKP");
  await page.getByText("SKP → VIE", { exact: true }).waitFor();
  assert.ok(
    (await page.locator("main").innerText()).includes(
      "Prishtina → Skopje Airport",
    ),
  );
  assert.ok(
    (await page.locator("main").innerText()).includes(
      "€120 cheaper after transfer",
    ),
  );
  stage = "D: opening edit sheet";
  await page.getByRole("button", { name: "Edit search", exact: true }).click();
  stage = "D: editing origin in sheet";
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /From.*Prishtina/i })
    .click();
  assert.equal(await page.locator("dialog[open]").count(), 1);
  stage = "D: closing edit sheet";
  await page.keyboard.press("Escape");
  await page.locator("dialog").waitFor({ state: "detached" });
  stage = "D: clicking affiliate CTA";
  let affiliateRoute;
  page.on("request", (req) => {
    if (req.url() === origin + "/api/affiliate/flights")
      affiliateRoute = req.postDataJSON().route;
  });
  let safeDestination;
  // The fixture's synthetic partner link is never sent to the real redirect service.
  await page.route("https://tp.media/**", async (route) => {
    const u = new URL(route.request().url());
    safeDestination = u.searchParams.get("u");
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>Fixture flight handoff reached</h1>",
    });
  });
  await page
    .getByRole("button", { name: "Check flights on Aviasales" })
    .click();
  await page
    .getByRole("heading", { name: "Fixture flight handoff reached" })
    .waitFor();
  assert.equal(
    safeDestination,
    "https://www.aviasales.com/search/SKP0711VIE09112",
  );
  assert.deepEqual(affiliateRoute, {
    originCode: "SKP",
    destinationCode: "VIE",
    departureDate: "2026-11-07",
    returnDate: "2026-11-09",
    party: { adults: 2, children: 0 },
  });
  console.log(
    "PASS D: click sends SKP→VIE, Nov 7–9, two adults; validated affiliate response reaches navigation (external redirect intercepted)",
  );
  stage = "C: cheaper airfare loses after transfer";
  await visit("/plan/results?" + query(true, "12"));
  const c = page.locator(".trip-card").filter({
    has: page.getByRole("heading", { name: "Vienna", exact: true }),
  });
  await c.locator(".result-details > summary").click();
  assert.ok((await c.innerText()).includes("Departure airport: PRN"));
  assert.ok(!(await c.innerText()).includes("cheaper after transfer"));
  console.log("PASS C: selected PRN wins when transfer exceeds airfare saving");
  stage = "mobile and SQ";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visit("/sq/plan/results?" + query(true));
  const sqCard = page
    .locator(".trip-card")
    .filter({ has: page.getByRole("heading", { name: "Vjena", exact: true }) });
  await sqCard
    .locator(".result-destination")
    .getByText(/Aeroporti i nisjes: SKP/)
    .waitFor();
  assert.ok((await sqCard.innerText()).includes("më lirë pas transferit"));
  await overflow();
  await page.screenshot({
    path: `${screenshotDir}/goeksplo-phase3b-mobile.png`,
    fullPage: true,
    animations: "disabled",
  });
  await sqCard.getByRole("link").last().click();
  await page.waitForURL((url) => url.pathname.includes("/trips/vienna"));
  await page.getByText("SKP → VIE", { exact: true }).waitFor();
  await overflow();
  await page.screenshot({
    path: `${screenshotDir}/goeksplo-phase3b-mobile-detail.png`,
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(errors.length, 0);
  if (process.env.NEARBY_FIXTURE_LOG) {
    const events = readFileSync(process.env.NEARBY_FIXTURE_LOG, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      events.some(
        (e) =>
          e.type === "affiliate" &&
          e.subId === "trip_flight" &&
          e.destinationUrl === safeDestination,
      ),
    );
    assert.deepEqual(
      new Set(
        events.filter((e) => e.type === "discovery").map((e) => e.origin),
      ),
      new Set(["PRN", "SKP", "TIA"]),
    );
  }
  console.log(
    "PASS mobile/SQ, reduced motion, no overflow, no page errors; one edit dialog and tracked trip placement preserved",
  );
} catch {
  // Do not print Playwright call logs: navigation URLs may contain affiliate identifiers.
  console.error(`FAIL nearby browser verification at ${stage}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
