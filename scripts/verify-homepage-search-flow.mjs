/** Run against the existing search-recovery fixture; no live inventory or bookings. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/_vercel/**", (r) => r.fulfill({ body: "" }));
    const query = new URLSearchParams({
      origin: "zurich",
      budget: "800",
      currency: "EUR",
      start: "2027-01-20",
      end: "2027-01-22",
      when: "custom",
      adults: "2",
      children: "1",
      flexDays: "3",
      styles: "city,quiet",
      stay: "comfort",
      car: "1",
      luggage: "1",
      family: "1",
      airports: "0",
    });
    await page.goto(`${origin}?${query}`);
    // Real /api/locations endpoint, with the existing fixture handling provider responses.
    await page.locator("[data-field=from]").click();
    await page.getByRole("combobox").fill("London");
    await page.getByRole("option").first().waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("origin")?.includes("LON"),
    );
    const homeUrl = page.url();
    const homeParams = new URL(homeUrl).searchParams;
    let release;
    const held = new Promise((resolve) => (release = resolve));
    let intercepted = false;
    await page.route("**/plan/results?**", async (route) => {
      intercepted = true;
      await held;
      await route.continue();
    });
    await page.locator(".search-submit").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".search-workspace")
          .getAttribute("aria-busy") === "true",
    );
    assert.equal(await page.locator(".search-submit").isDisabled(), true);
    assert.match(await page.locator(".search-submit").innerText(), /Searching/);
    release();
    await page.waitForURL((u) => u.pathname.endsWith("/results"));
    await page.locator(".search-results-bar").waitFor();
    assert.equal(intercepted, true);
    const resultsUrl = page.url();
    for (const [key, value] of homeParams)
      assert.equal(
        new URL(resultsUrl).searchParams.get(key),
        value,
        `preserved ${key}`,
      );
    await page.unroute("**/plan/results?**");
    // Closing the existing results sheet must discard all unsaved field changes.
    await page
      .getByRole("button", { name: "Edit search", exact: true })
      .click();
    await page.locator("dialog .search-field[data-field=budget]").click();
    await page.locator(".search-inline-editor input[type=number]").fill("999");
    await page.keyboard.press("Escape");
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(page.url(), resultsUrl);
    await page
      .getByRole("button", { name: "Edit search", exact: true })
      .click();
    assert.match(
      await page.locator("dialog [data-field=budget]").innerText(),
      /800/,
    );
    await page.locator("dialog [data-field=budget]").click();
    await page.locator(".search-inline-editor input[type=number]").fill("900");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page
      .getByRole("button", { name: "Update search", exact: false })
      .click();
    await page.waitForURL((u) => u.searchParams.get("budget") === "900");
    await page.locator("dialog").waitFor({ state: "detached" });
    await page.goBack();
    await page.waitForURL(resultsUrl);
    await page.goBack();
    await page.waitForURL((u) => u.pathname === "/");
    assert.match(await page.locator("[data-field=budget]").innerText(), /800/);
    await page.reload();
    assert.match(await page.locator("[data-field=budget]").innerText(), /800/);
    assert.deepEqual(errors, []);
    checks.push({
      width,
      status: "passed",
      checks: [
        "real autocomplete API with synthetic provider",
        "pending/disabled submission",
        "unchanged serialized search",
        "results Cancel discards",
        "results Apply commits",
        "Back and reload restore homepage",
        "no browser errors",
      ],
    });
    console.log(`PASS ${width}: submission and results Apply/Cancel`);
    await page.close();
  }
  writeFileSync(
    "docs/verification/homepage-redesign/search-flow-results.json",
    JSON.stringify(checks, null, 2) + "\n",
  );
} catch (e) {
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await browser.close();
}
