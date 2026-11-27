/** Phase 6B.2A: production components with scripts/fixtures/search-recovery.mjs only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/phase6b2a/browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "setup",
  checks = 0;
const pass = (message) => {
  checks++;
  console.log(`PASS ${message}`);
};
const q = (extra = {}) =>
  new URLSearchParams({
    origin: "zurich",
    currency: "EUR",
    budget: "50",
    adults: "2",
    children: "0",
    when: "custom",
    start: "2027-01-20",
    end: "2027-01-22",
    nights: "2",
    flexDays: "0",
    ...extra,
  });
try {
  const context = await browser.newContext();
  const errors = [],
    forbidden = [];
  let holdNavigation,
    releaseNavigation,
    heldRequests = 0,
    holdCurrencyNavigation,
    releaseCurrencyNavigation,
    abortedCurrencyRequests = 0,
    abortCurrencyNavigation = false;
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/_vercel/"))
      return route.fulfill({
        contentType: "application/javascript",
        body: "/* offline QA */",
      });
    if (
      u.origin !== origin ||
      /\/api\/(ai|affiliate|content|media)\//.test(u.pathname)
    ) {
      forbidden.push(u.hostname + u.pathname);
      return route.abort();
    }
    if (
      abortCurrencyNavigation &&
      u.pathname.endsWith("/results") &&
      u.searchParams.get("currency") === "GBP" &&
      route.request().headers().rsc === "1"
    ) {
      abortedCurrencyRequests++;
      await holdCurrencyNavigation;
      return route.abort();
    }
    if (
      holdNavigation &&
      u.pathname.endsWith("/results") &&
      u.searchParams.get("adults") === "3" &&
      route.request().headers().rsc === "1"
    ) {
      heldRequests++;
      await holdNavigation;
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(`${stage}: ${e.message}`));
  page.on("console", (m) => {
    // Only this explicitly aborted RSC scenario may emit these framework errors.
    if (
      abortCurrencyNavigation &&
      /Failed to fetch RSC payload|net::ERR_FAILED/.test(m.text())
    )
      return;
    if (m.type() === "error") errors.push(`${stage}: ${m.text()}`);
  });
  const go = async (locale = "en", extra = {}, path = "results") => {
    await page.goto(`${origin}/${locale}/plan/${path}?${q(extra)}`);
    await page
      .locator(".search-results-bar, .trip-detail-page")
      .first()
      .waitFor();
    await page
      .locator(".header-control")
      .first()
      .waitFor({ state: "attached" });
  };
  const open = async () => {
    await page
      .locator(".search-results-bar button, .trip-search-summary button")
      .first()
      .click();
    await page.locator("dialog[open]").waitFor();
  };
  const field = async (i) => {
    await page.locator("dialog .search-field").nth(i).click();
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page.locator(".search-inline-editor").waitFor();
  };
  const back = async () => {
    await page.locator(".search-inline-editor > button").click();
    await page.locator(".search-inline-editor").waitFor({ state: "detached" });
  };
  const cancel = async () => {
    await page.locator("dialog .row-between > button").click();
    await page.locator("dialog").waitFor({ state: "detached" });
  };
  const apply = async () => {
    await page.locator(".search-apply").click();
    await page.locator("dialog").waitFor({ state: "detached" });
  };
  const params = () => new URL(page.url()).searchParams;
  const overflow = async () => {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      stage + " page overflow",
    );
    if (await page.locator("dialog").count())
      assert.equal(
        await page
          .locator("dialog")
          .evaluate((e) => e.scrollWidth > e.clientWidth + 1),
        false,
        stage + " sheet overflow",
      );
  };
  const screenshot = (name) =>
    page.screenshot({
      path: `${output}/${name}.png`,
      fullPage: !name.includes("sheet"),
      animations: "disabled",
    });
  const hierarchy = async (state) => {
    assert.equal(
      await page.locator(".results-empty").getAttribute("data-state"),
      state,
    );
    assert.equal(
      await page
        .locator(".results-sections > :first-child")
        .getAttribute("data-state"),
      state,
    );
    assert.ok((await page.locator(".results-alternatives a").count()) <= 2);
  };
  stage = "transaction";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go("en", { budget: "3000" });
  const initial = page.url();
  const baselineCosts = await page
    .locator(".priced-results .result-card")
    .first()
    .locator(".cost-rows > div:has(.cost-transport) dd")
    .textContent();
  await open();
  await field(3);
  await page.locator(".search-inline-editor input").first().fill("3");
  await back();
  assert.equal(page.url(), initial);
  assert.match(
    await page.locator("dialog .search-field").nth(3).innerText(),
    /3/,
  );
  holdNavigation = new Promise((resolve) => {
    releaseNavigation = resolve;
  });
  await page.locator(".search-apply").click();
  await page.waitForFunction(() =>
    document.querySelector('.search-workspace[aria-busy="true"]'),
  );
  assert.equal(await page.locator(".search-apply").isDisabled(), true);
  assert.equal(
    await page.locator("dialog .row-between > button").isDisabled(),
    true,
  );
  await page.locator(".search-apply").evaluate((e) => {
    e.click();
    e.click();
  });
  await page.waitForFunction(() =>
    document
      .querySelector("dialog [role=status]")
      ?.textContent.includes("Finding"),
  );
  releaseNavigation();
  holdNavigation = undefined;
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.equal(heldRequests, 1);
  assert.equal(params().get("adults"), "3");
  const adultCosts = await page
    .locator(".priced-results .result-card")
    .first()
    .locator(".cost-rows > div:has(.cost-transport) dd")
    .textContent();
  assert.notEqual(adultCosts, baselineCosts);
  assert.match(adultCosts, /150/);
  pass(
    "adult apply changes URL and production flight cost; pending locks editing/dismissal and duplicate submit",
  );
  await open();
  await field(3);
  await page.locator(".search-inline-editor input").nth(1).fill("1");
  await back();
  await apply();
  assert.equal(params().get("children"), "1");
  assert.match(
    await page
      .locator(".priced-results .result-card")
      .first()
      .locator(".cost-rows > div:has(.cost-transport) dd")
      .textContent(),
    /200/,
  );
  pass("child apply changes party and actual pricing inputs");
  const applied = page.url();
  await open();
  await field(3);
  await page.locator(".search-inline-editor input").first().fill("1");
  await cancel();
  assert.equal(page.url(), applied);
  assert.equal(
    await page
      .locator(".search-results-bar button")
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await open();
  assert.match(
    await page.locator("dialog .search-field").nth(3).innerText(),
    /4/,
  );
  await cancel();
  pass("X discards; focus returns; reopen reads applied party");
  await open();
  await field(4);
  await page.locator("dialog input[type=number]").fill("999");
  await page.locator("dialog select:visible").selectOption("GBP");
  await page.keyboard.press("Escape");
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.equal(page.url(), applied);
  await open();
  await field(4);
  assert.equal(
    await page.locator("dialog input[type=number]").inputValue(),
    "3000",
  );
  assert.equal(await page.locator("dialog select:visible").inputValue(), "EUR");
  await back();
  await field(2);
  await page.locator("dialog input[type=date]").first().fill("2027-01-21");
  await page.mouse.click(2, 2);
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.equal(page.url(), applied);
  pass("Escape cancels budget/currency; backdrop cancels dates");
  await open();
  for (const [index, input, value] of [
    [4, "input[type=number]", "0"],
    [2, "input[type=date]", "2027-01-23"],
    [0, "input[role=combobox]", "unmatched synthetic origin"],
  ]) {
    await field(index);
    await page.locator(`dialog ${input}`).first().fill(value);
    await back();
    assert.equal(await page.locator(".search-apply").isDisabled(), true);
    await cancel();
    await open();
  }
  await apply();
  assert.equal(page.url(), applied);
  pass(
    "invalid budget/date/origin blocked; unchanged apply closes without changing request",
  );
  await open();
  await field(4);
  await page.locator("dialog input[type=number]").fill("700");
  await back();
  await field(3);
  await page.locator("dialog input").first().fill("2");
  await back();
  await field(2);
  await page.locator("dialog input[type=date]").last().fill("2027-01-23");
  await back();
  await apply();
  assert.equal(params().get("budget"), "700");
  assert.equal(params().get("adults"), "2");
  assert.equal(params().get("end"), "2027-01-23");
  assert.equal(params().get("nights"), "3");
  const multi = page.url();
  await page.reload();
  await page.locator(".results-sections").waitFor();
  assert.equal(page.url(), multi);
  await page.goBack();
  await page.locator(".results-sections").waitFor();
  assert.equal(page.url(), applied);
  await page.goForward();
  await page.locator(".results-sections").waitFor();
  assert.equal(page.url(), multi);
  pass(
    "multiple draft fields survive Back; apply/reload/history restore canonical request",
  );
  await page.locator(".results-more-filters").click();
  await page.locator("dialog input[type=checkbox]").nth(2).check();
  await page.locator("dialog select:visible").selectOption("simple");
  await cancel();
  assert.equal(page.url(), multi);
  await page.locator(".results-more-filters").click();
  assert.equal(
    await page.locator("dialog input[type=checkbox]").nth(2).isChecked(),
    false,
  );
  await page.locator("dialog input[type=checkbox]").nth(2).check();
  await page.locator("dialog select:visible").selectOption("simple");
  await apply();
  assert.equal(params().get("luggage"), "1");
  assert.equal(params().get("stay"), "simple");
  await page.locator(".results-filters .result-taste").first().click();
  await page.waitForURL((u) => u.searchParams.get("styles") === "beach");
  assert.equal(await page.locator("dialog").count(), 0);
  pass(
    "filters cancel/apply transactionally; outside chip applies immediately",
  );
  // Full-trip edits must navigate to results; no stale detail or second dialog.
  await go(
    "en",
    { origin: "prishtina", scope: "domestic", budget: "300" },
    "trips/prizren",
  );
  await open();
  await field(3);
  await page.locator("dialog input").first().fill("3");
  await back();
  await apply();
  assert.match(new URL(page.url()).pathname, /\/results$/);
  assert.equal(params().get("adults"), "3");
  pass(
    "full-trip party update leads to results through the same single-layer sheet",
  );
  await page.goto(`${origin}/`);
  await page.locator(".search-submit").click();
  await page.waitForURL("**/plan/results?*");
  assert.equal(await page.locator("dialog").count(), 0);
  pass("homepage remains a one-step search");
  // Result states from real adapters. No fixture is imported into application code.
  stage = "origin-currency";
  await go("en", { budget: "3000" });
  const beforeOrigin = page.url();
  await open();
  await field(0);
  await page.locator("dialog input[role=combobox]").fill("London");
  await page
    .locator("dialog")
    .getByRole("option")
    .filter({ hasText: "London" })
    .click();
  await back();
  assert.match(
    await page.locator("dialog .search-field").nth(4).innerText(),
    /3,000/,
  );
  await field(4);
  assert.equal(await page.locator("dialog select:visible").inputValue(), "GBP");
  assert.match(
    await page
      .locator(".header-preferences .header-control")
      .first()
      .getAttribute("aria-label"),
    /EUR/,
  );
  await cancel();
  assert.equal(page.url(), beforeOrigin);
  assert.match(
    await page
      .locator(".header-preferences .header-control")
      .first()
      .getAttribute("aria-label"),
    /EUR/,
  );
  await open();
  assert.match(
    await page.locator("dialog .search-field").first().innerText(),
    /Zurich/,
  );
  await cancel();
  pass(
    "origin policy changes only draft currency without FX; cancellation leaves shared preference unchanged",
  );
  await open();
  await field(4);
  await page.locator("dialog select:visible").selectOption("GBP");
  await back();
  await apply();
  assert.equal(params().get("currency"), "GBP");
  assert.equal(params().get("budget"), "3000");
  assert.match(
    await page
      .locator(".header-preferences .header-control")
      .first()
      .getAttribute("aria-label"),
    /GBP/,
  );
  pass(
    "currency becomes shared/applied only on Update; numeric budget preserved",
  );
  stage = "combined currency history";
  const destination = {
    id: "city:VIE",
    name: "Vienna",
    type: "city",
    cityCode: "VIE",
    iataCodes: ["VIE"],
    countryCode: "AT",
    countryName: { en: "Austria", sq: "Austri" },
  };
  const currencySearch = {
    budget: "3000",
    children: "1",
    toPlace: JSON.stringify(destination),
  };
  const headerCurrency = () =>
    page.locator(".header-preferences .header-control").first();
  const changeDraftCurrency = async (currency) => {
    await open();
    await field(4);
    await page.locator("dialog select:visible").selectOption(currency);
    await back();
  };
  const assertCurrency = async (currency, adults = "2") => {
    await page.waitForURL((u) => u.searchParams.get("currency") === currency);
    await page.waitForFunction(
      (value) =>
        document
          .querySelector(".header-preferences .header-control")
          ?.textContent.includes(value),
      currency,
    );
    assert.equal(params().get("budget"), "3000");
    assert.equal(params().get("origin"), "zurich");
    assert.equal(JSON.parse(params().get("toPlace")).id, "city:VIE");
    assert.equal(params().get("start"), "2027-01-20");
    assert.equal(params().get("end"), "2027-01-22");
    assert.equal(params().get("adults"), adults);
    assert.equal(params().get("children"), "1");
    const detail = new URL(page.url()).pathname.includes("/trips/");
    // Detail intentionally hides the duplicate search summary; assert its visible
    // title and budget panel instead of treating hidden text as user-facing proof.
    const summary = await page
      .locator(detail ? ".trip-budget" : ".results-search-summary")
      .innerText();
    assert.match(
      detail ? await page.locator("#trip-title").innerText() : summary,
      detail && new URL(page.url()).pathname.startsWith("/sq/")
        ? /Vjena/
        : /Vienna/,
    );
    assert.ok(summary.includes(currency === "GBP" ? "£" : "€"));
    assert.ok(!summary.includes(currency === "GBP" ? "€" : "£"));
    if (!detail) assert.match(summary, /3[,.\s]000/);
    await open();
    await field(4);
    assert.equal(
      await page.locator("dialog select:visible").inputValue(),
      currency,
    );
    assert.equal(
      await page.locator("dialog input[type=number]").inputValue(),
      "3000",
    );
    await back();
    await field(3);
    assert.equal(
      await page.locator(".search-inline-editor input").first().inputValue(),
      adults,
    );
    assert.equal(
      await page.locator(".search-inline-editor input").last().inputValue(),
      "1",
    );
    await back();
    await field(2);
    assert.equal(
      await page.locator("dialog input[type=date]").first().inputValue(),
      "2027-01-20",
    );
    assert.equal(
      await page.locator("dialog input[type=date]").last().inputValue(),
      "2027-01-22",
    );
    await cancel();
  };
  const language = async (locale) => {
    await page.locator(".header-preferences .header-control").nth(1).click();
    await page.locator(`dialog a[hreflang=${locale}]`).click();
    await page.waitForURL((u) => u.pathname.startsWith(`/${locale}/`));
  };
  await go("en", currencySearch);
  await assertCurrency("EUR");
  await changeDraftCurrency("GBP");
  await apply();
  await assertCurrency("GBP");
  await page.goBack();
  await assertCurrency("EUR");
  await language("sq");
  await assertCurrency("EUR");
  await language("en");
  await assertCurrency("EUR");
  pass(
    "EUR → GBP → Back → SQ → EN preserves URL/header/summary/editor currency, amount, destination, dates and party",
  );
  await go("en", { ...currencySearch, currency: "GBP" });
  await assertCurrency("GBP");
  await changeDraftCurrency("EUR");
  await apply();
  await assertCurrency("EUR");
  await page.goBack();
  await assertCurrency("GBP");
  await page.goForward();
  await assertCurrency("EUR");
  await page.reload();
  await assertCurrency("EUR");
  pass(
    "GBP → EUR → Back → Forward → reload and direct explicit-currency entry agree in every surface",
  );
  for (const dismiss of ["cancel", "escape"]) {
    await changeDraftCurrency("GBP");
    if (dismiss === "cancel") await cancel();
    else {
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
    }
    await assertCurrency("EUR");
  }
  await changeDraftCurrency("GBP");
  await field(3);
  await page.locator(".search-inline-editor input").first().fill("3");
  await back();
  await apply();
  await assertCurrency("GBP", "3");
  await page.goBack();
  await assertCurrency("EUR");
  pass(
    "currency X/Escape cancellation and simultaneous party/currency apply retain transaction semantics",
  );
  // Keep the old URL/header unchanged while navigation is held, then exercise
  // the real framework's document fallback after an aborted RSC request.
  await changeDraftCurrency("GBP");
  abortCurrencyNavigation = true;
  holdCurrencyNavigation = new Promise((resolve) => {
    releaseCurrencyNavigation = resolve;
  });
  await page.locator(".search-apply").click();
  await page.waitForFunction(() =>
    document.querySelector('.search-workspace[aria-busy="true"]'),
  );
  assert.equal(params().get("currency"), "EUR");
  assert.match(await headerCurrency().getAttribute("aria-label"), /EUR/);
  assert.match(
    await page.locator(".results-search-summary").innerText(),
    /€3,000/,
  );
  releaseCurrencyNavigation();
  await page.locator("dialog").waitFor({ state: "detached" });
  await assertCurrency("GBP");
  assert.ok(abortedCurrencyRequests > 0);
  abortCurrencyNavigation = false;
  await page.goBack();
  await assertCurrency("EUR");
  pass(
    "held/aborted currency navigation never mutates the previous entry; framework fallback and Back restore coherent state",
  );
  await headerCurrency().click();
  await page.locator('dialog input[value="GBP"]').click();
  await page.waitForURL((u) => u.searchParams.get("currency") === "GBP");
  await page.waitForFunction(
    () => document.querySelector('dialog input[value="GBP"]')?.checked,
  );
  await cancel();
  await assertCurrency("GBP");
  await page.goBack();
  await assertCurrency("EUR");
  pass(
    "intentional header currency change updates the applied URL with no FX and remains reversible",
  );
  const detailHref = await page
    .locator(".priced-results .result-actions a.button")
    .first()
    .getAttribute("href");
  await page.goto(new URL(detailHref, origin).href);
  await assertCurrency("EUR");
  await changeDraftCurrency("GBP");
  await apply();
  assert.match(new URL(page.url()).pathname, /\/results$/);
  await assertCurrency("GBP");
  await page.goBack();
  await assertCurrency("EUR");
  await language("sq");
  await assertCurrency("EUR");
  pass(
    "trip-detail currency apply goes to results; Back and localization restore the original applied currency",
  );
  await page.goto(`${origin}/`);
  assert.equal(params().get("currency"), null);
  await headerCurrency().click();
  await page.locator('dialog input[value="GBP"]').check();
  await cancel();
  assert.equal(params().get("currency"), null);
  assert.match(await page.locator(".search-field").last().innerText(), /£/);
  await page.locator(".search-submit").click();
  await page.waitForURL((u) => u.pathname.endsWith("/results"));
  assert.equal(params().get("currency"), "GBP");
  assert.match(await headerCurrency().getAttribute("aria-label"), /GBP/);
  assert.match(await page.locator(".results-search-summary").innerText(), /£/);
  pass(
    "new homepage search still uses an intentional header preference without a second apply step",
  );
  stage = "states";
  for (const [month, expected] of [
    ["01", "no-fit"],
    ["02", "empty"],
    ["03", "insufficient-pricing"],
    ["04", "insufficient-pricing"],
  ]) {
    await go("en", { start: `2027-${month}-20`, end: `2027-${month}-22` });
    await hierarchy(expected);
    if (expected === "no-fit") {
      assert.match(await page.locator(".results-comparison").innerText(), /50/);
      assert.ok((await page.locator(".result-known-over").count()) > 0);
      assert.equal(await page.locator(".results-over-section").count(), 0);
    } else if (expected === "empty")
      assert.equal(await page.locator(".result-card").count(), 0);
    else {
      assert.equal(await page.locator(".results-comparison").count(), 0);
      assert.match(
        await page.locator(".results-empty").innerText(),
        /can't tell/,
      );
    }
    if (month === "03")
      assert.match(
        await page.locator(".results-empty").innerText(),
        /onward transfers/,
      );
    await screenshot(`after-state-${month}-${expected}`);
    pass(`month ${month}: ${expected} precedes secondary cards`);
  }
  await go("en", {
    start: "2027-02-20",
    end: "2027-02-22",
    toPlace: JSON.stringify({
      id: "city:VIE",
      name: "Vienna",
      type: "city",
      cityCode: "VIE",
      iataCodes: ["VIE"],
      countryCode: "AT",
      countryName: { en: "Austria", sq: "Austri" },
    }),
  });
  await hierarchy("insufficient-pricing");
  assert.match(
    await page.locator(".results-empty").innerText(),
    /Flight prices need checking/,
  );
  assert.equal(
    await page.locator(".result-card[data-pricing='flight-unpriced']").count(),
    1,
  );
  await page
    .locator(".results-alternatives a")
    .filter({ hasText: "Explore anywhere" })
    .click();
  await page.waitForURL((u) => !u.searchParams.has("toPlace"));
  pass(
    "selected destination without fare stays unknown; remove-destination recovery executes",
  );
  await go("en", { budget: "3000" });
  assert.equal(await page.locator(".results-empty").count(), 0);
  assert.equal(
    await page
      .locator(".results-sections > :first-child")
      .getAttribute("class"),
    "priced-results",
  );
  await go("en");
  const budgetText = await page
    .locator(".results-comparison dd")
    .nth(1)
    .innerText();
  const needed = Number(budgetText.replace(/[^0-9.]/g, ""));
  await go("en", { budget: String(Math.ceil(needed / 1.1)) });
  assert.equal(await page.locator(".results-over-section").count(), 1);
  await page.locator(".over-toggle").click();
  assert.ok(await page.locator("#over-budget-trips .result-card").count());
  pass(
    "affordable shortlist first; slightly-over disclosure preserved; €50 excludes far-over cards",
  );
  await go("en", { origin: "prishtina", scope: "domestic" });
  await hierarchy("no-fit");
  assert.doesNotMatch(
    await page.locator(".results-alternatives").innerText(),
    /nearby|flexible/i,
  );
  await go("en", { origin: "prishtina" });
  assert.match(
    await page.locator(".results-alternatives").innerText(),
    /nearby/i,
  );
  await page
    .locator(".results-alternatives a")
    .filter({ hasText: "nearby" })
    .click();
  await page.waitForURL((u) => u.searchParams.get("airports") === "1");
  await go("en", { origin: "prishtina", noFlight: "1" });
  await hierarchy("no-fit");
  assert.doesNotMatch(
    await page.locator(".results-alternatives").innerText(),
    /nearby|flexible/i,
  );
  await go("en");
  assert.doesNotMatch(
    await page.locator(".results-alternatives").innerText(),
    /nearby/i,
  );
  await page
    .locator(".results-alternatives a")
    .filter({ hasText: "flexible" })
    .click();
  await page.waitForURL((u) => u.searchParams.get("flexDays") === "3");
  await page
    .locator(".results-alternatives a")
    .filter({ hasText: "simpler" })
    .click();
  await page.waitForURL((u) => u.searchParams.get("stay") === "simple");
  pass(
    "nearby recovery only for supported origins; domestic recovery avoids flight actions",
  );
  for (const locale of ["en", "sq"])
    for (const [width, height] of [
      [1440, 1000],
      [390, 844],
      [375, 812],
      [360, 780],
      [320, 844],
      [320, 568],
    ]) {
      stage = `${locale}-${width}x${height}`;
      await page.setViewportSize({ width, height });
      await page.emulateMedia({
        reducedMotion: width === 320 ? "reduce" : "no-preference",
      });
      await go(locale);
      await hierarchy("no-fit");
      await overflow();
      const recoveryAction = await page
        .locator(".results-alternatives > button")
        .boundingBox();
      assert.ok(
        recoveryAction.y >= 0 &&
          recoveryAction.y + recoveryAction.height <= height,
        `${stage}: primary recovery action fully visible without scrolling`,
      );
      console.log(
        `MEASURE ${stage}: recovery action top=${recoveryAction.y.toFixed(1)} bottom=${(recoveryAction.y + recoveryAction.height).toFixed(1)} viewport=${height}`,
      );
      if ([1440, 390, 320].includes(width))
        await screenshot(`after-results-${stage}`);
      if (
        (locale === "en" && width === 390) ||
        (locale === "sq" && width === 320 && height === 844)
      ) {
        await go(locale, { start: "2027-03-20", end: "2027-03-22" });
        await hierarchy("insufficient-pricing");
        await overflow();
        await screenshot(`after-insufficient-${stage}`);
        await go(locale);
      }
      await open();
      assert.equal(await page.locator("dialog[open]").count(), 1);
      assert.equal(await page.locator("dialog .search-submit").count(), 0);
      assert.equal(await page.locator("dialog .search-apply").count(), 1);
      await field(4);
      await page.locator("dialog input[type=number]").focus();
      // Short visual viewport proxy; real OS keyboard behavior needs a physical device.
      if (width === 320 && height === 568)
        await page.setViewportSize({ width, height: 340 });
      await page
        .locator(".search-inline-editor > button")
        .scrollIntoViewIfNeeded();
      const backBox = await page
        .locator(".search-inline-editor > button")
        .boundingBox();
      assert.ok(
        backBox.height >= 44 &&
          backBox.y + backBox.height <= page.viewportSize().height + 1,
      );
      await back();
      await page.locator(".search-apply").scrollIntoViewIfNeeded();
      await overflow();
      const box = await page.locator(".search-apply").boundingBox();
      assert.ok(
        box.height >= 44 &&
          box.y >= 0 &&
          box.y + box.height <= page.viewportSize().height + 1,
      );
      assert.equal(
        (await page.locator(".search-apply").innerText()).replace(/\s+/g, " "),
        locale === "en" ? "Update search →" : "Përditëso kërkimin →",
      );
      if ([1440, 390, 320].includes(width))
        await screenshot(`after-sheet-${stage}`);
      await page.locator(".search-apply").focus();
      await page.keyboard.press("Tab");
      // Chrome may move to browser chrome at the native dialog boundary.
      // Background page controls must remain inert; the next Tab returns inside.
      const focus = await page.evaluate(() => ({
        body: document.activeElement === document.body,
        inside: !!document.activeElement?.closest("dialog"),
      }));
      assert.ok(
        focus.body || focus.inside,
        "Tab cannot reach background page controls",
      );
      if (focus.body) await page.keyboard.press("Tab");
      // A scrollable native dialog itself can be an additional keyboard stop.
      if (
        await page
          .locator("dialog")
          .evaluate((e) => e === document.activeElement)
      )
        await page.keyboard.press("Tab");
      assert.equal(
        await page
          .locator("dialog .row-between > button")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
      assert.equal(
        await page
          .locator(".search-results-bar button")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.setViewportSize({ width, height });
      // SQ and narrow layouts must apply too, not only render translated labels.
      await open();
      await field(3);
      await page.locator("dialog input").first().fill("3");
      await back();
      await apply();
      assert.equal(params().get("adults"), "3");
      await overflow();
      await page.locator(".results-more-filters").click();
      await page.locator("dialog input[type=checkbox]").nth(2).check();
      await page.locator(".search-apply").scrollIntoViewIfNeeded();
      await overflow();
      if (locale === "sq" && width === 320 && height === 568)
        await screenshot("after-sheet-filters-sq-320x568");
      await apply();
      assert.equal(params().get("luggage"), "1");
      pass(
        `${stage}: order, one layer, apply, filters, keyboard/focus, reachable action and no overflow`,
      );
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  console.log(
    `PASS ${checks} browser acceptance groups; no client errors or forbidden browser requests`,
  );
  if (process.env.SEARCH_RECOVERY_LOG)
    assert.ok(
      readFileSync(process.env.SEARCH_RECOVERY_LOG, "utf8").includes(
        "synthetic-discovery",
      ),
    );
} catch (error) {
  console.error(`FAIL ${stage}`);
  throw error;
} finally {
  await browser.close();
}
