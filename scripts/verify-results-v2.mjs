/** Local browser acceptance using scripts/fixtures/search-recovery.mjs only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const output = "docs/verification/results-v2";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reports = [];
let stage = "start";
const base = {
  origin: "zurich",
  budget: "800",
  currency: "EUR",
  start: "2027-01-20",
  end: "2027-01-22",
  when: "custom",
  adults: "2",
  children: "0",
  airports: "0",
};
const city = (code, name, country) => ({
  id: `city:${code}`,
  name,
  type: "city",
  cityCode: code,
  iataCodes: [code],
  countryCode: country,
  countryName: { en: country, sq: country },
});
const url = (extra) =>
  `${origin}/plan/results?${new URLSearchParams({ ...base, ...extra })}`;
try {
  for (const width of [1440, 390, 375, 360, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    let ai = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/ai/")) ai++;
    });
    await page.route("**/_vercel/**", (r) => r.fulfill({ body: "" }));
    await page.route("**/api/locations?**", (r) =>
      r.fulfill({
        json: { status: "available", locations: [city("LON", "London", "GB")] },
      }),
    );
    const overflow = async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${stage} overflow`,
      );
    const desktop = width >= 900;
    const open = async (name) => {
      if (!desktop)
        await page
          .getByRole("button", { name: "Edit search", exact: true })
          .click();
      await page
        .locator(
          `${desktop ? ".results-search-desktop" : "dialog"} [data-field=${name}]`,
        )
        .click();
    };
    const panel = () =>
      page.locator(
        desktop ? ".home-field-editor[open]" : ".search-inline-editor",
      );
    const done = async () => {
      await panel()
        .getByRole("button", { name: desktop ? "Apply" : "Back", exact: true })
        .click();
    };
    const cancel = async () => {
      await page.keyboard.press("Escape");
      await page.locator("dialog[open]").waitFor({ state: "detached" });
    };
    const submit = async () => {
      await page
        .getByRole("button", { name: /Update search/ })
        .filter({ visible: true })
        .click();
    };
    stage = `${width} load`;
    await page.goto(url({}));
    await page.locator(".result-card").first().waitFor();
    await overflow();
    assert.match(
      await page.locator("meta[name=robots]").getAttribute("content"),
      /noindex/,
    );
    assert.equal(await page.locator("main h1").count(), 1);
    for (const card of await page
      .locator(".result-card:not([data-pricing=complete])")
      .all()) {
      assert.match(
        await card.locator(".result-price").innerText(),
        /Trip total not yet known/,
      );
      assert.equal(await card.locator(".result-balance").count(), 0);
      assert.equal(
        await card
          .locator(".result-flight-limit")
          .isVisible()
          .catch(() => false),
        false,
      );
    }
    stage = `${width} budget cancel`;
    await open("budget");
    await panel().locator("input[type=number]").fill("999");
    await overflow();
    await cancel();
    assert.equal(new URL(page.url()).searchParams.get("budget"), "800");
    await open("budget");
    assert.equal(
      await panel().locator("input[type=number]").inputValue(),
      "800",
    );
    await panel().locator("input[type=number]").fill("0");
    if (desktop)
      assert.equal(
        await panel()
          .getByRole("button", { name: "Apply", exact: true })
          .isDisabled(),
        true,
      );
    await panel().locator("input[type=number]").fill("900");
    await done();
    await submit();
    await page.waitForURL((u) => u.searchParams.get("budget") === "900");
    await page.goBack();
    await page.waitForURL((u) => u.searchParams.get("budget") === "800");
    await page.reload();
    stage = `${width} dates`;
    await open("dates");
    const dateFields = panel().locator("input[type=date]");
    await dateFields.first().fill("2027-01-25");
    await dateFields.last().fill("2027-01-24");
    if (desktop)
      assert.equal(
        await panel()
          .getByRole("button", { name: "Apply", exact: true })
          .isDisabled(),
        true,
      );
    await dateFields.first().fill("2027-01-20");
    await dateFields.last().fill("2027-01-22");
    await panel().getByRole("button", { name: /±/ }).click();
    await done();
    await submit();
    await page.waitForURL((u) => u.searchParams.get("flexDays") === "3");
    stage = `${width} travellers`;
    await open("travelers");
    await panel().locator("input[type=number]").first().fill("8");
    await panel().locator("input[type=number]").last().fill("1");
    await done();
    await submit();
    await page.waitForURL((u) => u.searchParams.get("adults") === "8");
    await overflow();
    stage = `${width} origin`;
    await open("from");
    await panel().getByRole("combobox").fill("London");
    await panel().getByRole("option").first().waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await done();
    await submit();
    await page.waitForURL((u) => u.searchParams.get("origin")?.includes("LON"));
    stage = `${width} destination`;
    await open("to");
    await panel().getByRole("combobox").fill("London");
    await panel().getByRole("option").first().click();
    await done();
    await submit();
    await page.waitForURL((u) =>
      u.searchParams.get("toPlace")?.includes("LON"),
    );
    stage = `${width} currency`;
    await open("budget");
    await panel().locator("select").selectOption("GBP");
    await done();
    await submit();
    await page.waitForURL((u) => u.searchParams.get("currency") === "GBP");
    assert.equal(new URL(page.url()).searchParams.get("adults"), "8");
    await page.goto(url({}));
    stage = `${width} filters`;
    await page
      .getByRole("button", {
        name: desktop ? "More filters" : "Filters",
        exact: true,
      })
      .click();
    const sheet = page.locator(".results-v2-editor[open]");
    await sheet.waitFor();
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).overflow),
      "hidden",
    );
    await sheet.getByRole("button", { name: "City", exact: true }).click();
    await cancel();
    assert.equal(new URL(page.url()).searchParams.get("styles"), null);
    await page
      .getByRole("button", {
        name: desktop ? "More filters" : "Filters",
        exact: true,
      })
      .click();
    await sheet.getByRole("button", { name: "City", exact: true }).click();
    await sheet.locator("select").selectOption("comfort");
    if (width === 390 || width === 320)
      await page.screenshot({ path: `${output}/after-filters-${width}.png` });
    await sheet.getByRole("button", { name: /Update search/ }).click();
    await page.waitForURL((u) => u.searchParams.get("styles") === "city");
    assert.equal(new URL(page.url()).searchParams.get("stay"), "comfort");
    await page.goBack();
    await page.waitForURL((u) => !u.searchParams.has("styles"));
    stage = `${width} disclosure`;
    await page.locator(".result-details summary").first().click();
    await overflow();
    await page.locator(".result-details summary").first().click();
    if (desktop) {
      await open("budget");
      await page.screenshot({ path: `${output}/after-budget-1440.png` });
      await page.mouse.click(20, 280);
      await page.locator(".home-field-editor").waitFor({ state: "detached" });
      await open("dates");
      await page.screenshot({ path: `${output}/after-dates-1440.png` });
      await cancel();
    } else {
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await sheet.locator("button").last().focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => !!document.activeElement.closest("dialog")),
        true,
      );
      await page.mouse.click(5, 10);
      await sheet.waitFor({ state: "detached" });
    }
    assert.deepEqual(errors, []);
    assert.equal(ai, 0);
    reports.push({
      width,
      status: "passed",
      checks: [
        "all fields",
        "Apply/Cancel",
        "invalid budget/dates",
        "flexibility",
        "9 travellers",
        "autocomplete identities",
        "currency",
        "filters",
        "Back/reload",
        "noindex",
        "disclosures",
        "no overflow",
        "no browser errors",
        "AI off",
      ],
    });
    console.log(`PASS ${width}`);
    await page.close();
  }
  writeFileSync(
    `${output}/functional-results.json`,
    JSON.stringify(reports, null, 2) + "\n",
  );
} catch (e) {
  console.error(stage, e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
