/** Real Next routes/editor/serialization; scripts/fixtures/search-arrival.mjs only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3170";
const restoredOrigin =
  process.env.VERIFY_RESTORED_ORIGIN || "http://127.0.0.1:3171";
for (const url of [origin, restoredOrigin])
  assert.match(url, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
assert.notEqual(
  origin,
  restoredOrigin,
  "Changed evidence must use a separate fixture process/cache token",
);
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-search-arrival";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
const reports = [],
  errors = [],
  forbidden = [];
let stage = "setup";
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "avs.io")
      return route.fulfill({
        contentType: "text/html",
        body: "Synthetic partner handoff",
      });
    if (u.pathname.startsWith("/_vercel/"))
      return route.fulfill({ contentType: "application/javascript", body: "" });
    if (
      ![origin, restoredOrigin].includes(u.origin) ||
      u.pathname.startsWith("/api/ai/")
    ) {
      forbidden.push(u.hostname + u.pathname);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(`${stage}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${stage}: ${m.text()}`);
  });
  const country = {
    id: "country:ZA",
    name: "South Africa",
    type: "country",
    countryCode: "ZA",
    countryName: { en: "South Africa", sq: "Afrika e Jugut" },
  };
  const query = new URLSearchParams({
    origin: "prishtina",
    currency: "EUR",
    budget: "3000",
    adults: "2",
    children: "1",
    when: "custom",
    start: "2027-01-20",
    end: "2027-01-22",
    nights: "2",
    flexDays: "0",
    scope: "anywhere",
    airports: "1",
    toPlace: JSON.stringify(country),
  });
  const params = () => new URL(page.url()).searchParams;
  const noPin = () => {
    assert.equal(params().has("arrival"), false);
    assert.equal(params().has("arrivalFor"), false);
  };
  const pin = () => {
    assert.equal(params().get("arrival"), "MQP");
    assert.equal(params().get("arrivalFor"), "place:Q24451");
  };
  const open = async () => {
    await page
      .locator(".trip-search-summary button,.search-results-bar button")
      .first()
      .click();
    await page.locator("dialog[open]").waitFor();
  };
  const field = async (i) => {
    await page.locator("dialog .search-field").nth(i).click();
    await page.locator(".search-inline-editor").waitFor();
  };
  const back = async () => {
    await page.locator(".search-inline-editor > button").click();
    await page.locator(".search-inline-editor").waitFor({ state: "detached" });
  };
  const choose = async (name) => {
    await page.getByRole("combobox").fill(name);
    await page
      .getByRole("option")
      .filter({ hasText: name })
      .first()
      .getByRole("button")
      .click();
  };
  const apply = async () => {
    await page.locator(".search-apply").click();
    await page.locator("dialog").waitFor({ state: "detached" });
    await page.waitForURL((u) => u.pathname.endsWith("/results"));
    await page.locator(".results-search-summary").waitFor();
  };
  const reload = async () => {
    await page.reload();
    await page
      .locator(".results-search-summary,.trip-detail-page")
      .first()
      .waitFor();
  };
  const handoff = async (expected) => {
    const request = page.waitForRequest((r) =>
      r.url().endsWith("/api/affiliate/flights"),
    );
    await page.locator(".flight-booking .affiliate-action button").click();
    assert.deepEqual((await request).postDataJSON().route, expected);
    await page.waitForURL("https://avs.io/**");
  };
  const route = {
    originCode: "SKP",
    destinationCode: "MQP",
    departureDate: "2027-01-20",
    returnDate: "2027-01-22",
    party: { adults: 2, children: 1 },
  };
  const pass = async (name) => {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    reports.push({ name, status: "PASS", url: page.url() });
    console.log("PASS " + name);
  };
  stage = "generate real saved SKP → MQP link";
  await page.goto(`${origin}/plan/results?${query}`);
  const kruger = page
    .locator(".result-card")
    .filter({ hasText: "Kruger National Park" });
  await kruger.waitFor();
  const saved = await kruger.locator("a.button").getAttribute("href");
  const savedQuery = new URL(saved, origin).searchParams;
  assert.equal(savedQuery.get("departure"), "SKP");
  assert.equal(savedQuery.get("arrival"), "MQP");
  assert.equal(savedQuery.get("arrivalFor"), "place:Q24451");
  await pass(stage);
  for (const locale of ["en", "sq"]) {
    await page.setViewportSize({
      width: locale === "en" ? 390 : 320,
      height: 844,
    });
    const path = saved.replace("/", `/${locale}/`);
    const go = async () => {
      await page.goto(origin + path);
      await page.locator(".flight-booking").waitFor();
      assert.match(
        await page.locator(".trip-flight-route").innerText(),
        /SKP.*MQP/,
      );
      pin();
    };
    stage = `${locale}: Paris Apply removes both hints; reload, detail and affiliate agree`;
    await go();
    await open();
    await field(1);
    await choose("Paris");
    await back();
    await apply();
    noPin();
    assert.equal(JSON.parse(params().get("toPlace")).id, "city:PAR");
    await reload();
    noPin();
    await page.screenshot({
      path: `${output}/${locale}-paris-results.png`,
      fullPage: true,
    });
    const paris = page
      .locator(".result-card")
      .filter({ hasText: locale === "en" ? "Paris" : "Parisi" });
    await paris.locator("a.button").click();
    await page.locator(".flight-booking").waitFor();
    assert.match(
      await page.locator(".trip-flight-route").innerText(),
      /PRN.*PAR/,
    );
    assert.doesNotMatch(
      await page.locator(".trip-flight-route").innerText(),
      /MQP|SZK/,
    );
    noPin();
    await handoff({ ...route, originCode: "PRN", destinationCode: "PAR" });
    await pass(stage);

    stage = `${locale}: explicit Anywhere Apply clears context, including after reload`;
    await go();
    await open();
    await field(1);
    await page.locator(".location-input > button").click();
    await back();
    await apply();
    noPin();
    assert.equal(params().has("toPlace"), false);
    await reload();
    noPin();
    await pass(stage);

    for (const dismissal of ["X", "Escape", "backdrop"]) {
      stage = `${locale}: Paris ${dismissal} cancel preserves original request and reload arrival`;
      await go();
      const before = page.url();
      await open();
      await field(1);
      await choose("Paris");
      await back();
      if (dismissal === "X")
        await page.locator("dialog .row-between > button").click();
      else if (dismissal === "Escape") await page.keyboard.press("Escape");
      else await page.mouse.click(2, 2);
      await page.locator("dialog").waitFor({ state: "detached" });
      assert.equal(page.url(), before);
      pin();
      await open();
      assert.match(
        await page.locator("dialog .search-field").nth(1).innerText(),
        /South Africa/,
      );
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
      await reload();
      assert.match(
        await page.locator(".trip-flight-route").innerText(),
        /SKP.*MQP/,
      );
      pin();
      await pass(stage);
    }
    for (const edit of ["budget", "party", "dates"]) {
      stage = `${locale}: ${edit}-only Apply preserves canonical hint through serialization and reload`;
      await go();
      await open();
      await field({ budget: 4, party: 3, dates: 2 }[edit]);
      if (edit === "budget")
        await page.locator("dialog input[type=number]").fill("4000");
      if (edit === "party") {
        await page.locator("dialog input[type=number]").first().fill("3");
        await page.locator("dialog input[type=number]").last().fill("2");
      }
      if (edit === "dates") {
        await page
          .locator("dialog input[type=date]")
          .first()
          .fill("2027-01-21");
        await page.locator("dialog input[type=date]").last().fill("2027-01-23");
      }
      await back();
      await apply();
      pin();
      assert.equal(params().has("departure"), false);
      if (edit === "budget") assert.equal(params().get("budget"), "4000");
      if (edit === "party") {
        assert.equal(params().get("adults"), "3");
        assert.equal(params().get("children"), "2");
      }
      if (edit === "dates") {
        assert.equal(params().get("start"), "2027-01-21");
        assert.equal(params().get("end"), "2027-01-23");
      }
      await reload();
      pin();
      await pass(stage);
    }
    stage = `${locale}: destination away/back to a country is ambiguous and clears pin`;
    await go();
    await open();
    await field(1);
    await choose("Paris");
    await back();
    await field(1);
    await choose("South Africa");
    await back();
    await apply();
    assert.equal(JSON.parse(params().get("toPlace")).id, "country:ZA");
    noPin();
    await reload();
    noPin();
    await pass(stage);

    for (const selection of [
      "Kruger Mpumalanga Airport",
      "Ambiguous Kruger city group",
    ]) {
      stage = `${locale}: ${selection} selection cannot inherit canonical Kruger pin`;
      await go();
      await open();
      await field(1);
      await choose(selection);
      await back();
      await apply();
      noPin();
      await reload();
      noPin();
      await pass(stage);
    }
    stage = `${locale}: unsupported free text blocks Apply and Cancel leaves original pin`;
    await go();
    const before = page.url();
    await open();
    await field(1);
    await page.getByRole("combobox").fill("unsupported qzx destination");
    await back();
    assert.equal(await page.locator(".search-apply").isDisabled(), true);
    assert.equal(page.url(), before);
    await page.keyboard.press("Escape");
    await page.locator("dialog").waitFor({ state: "detached" });
    pin();
    await pass(stage);

    stage = `${locale}: copied original link restores MQP despite fresh process offering only SZK`;
    await page.goto(restoredOrigin + path);
    await page.locator(".flight-booking").waitFor();
    assert.match(
      await page.locator(".trip-flight-route").innerText(),
      /SKP.*MQP/,
    );
    assert.equal(
      await page
        .locator(".result-price-complete,.result-budget-equation,.result-fits")
        .count(),
      0,
    );
    assert.equal(await page.locator(".flight-booking p.mono").count(), 0);
    await handoff(route);
    await pass(stage);

    stage = `${locale}: retained context never pins ordinary discovery to the old arrival`;
    await page.goto(restoredOrigin + path);
    await page.locator(".flight-booking").waitFor();
    await open();
    await field(4);
    await page.locator("dialog input[type=number]").fill("4000");
    await back();
    await apply();
    pin();
    const discovered = page
      .locator(".result-card")
      .filter({ hasText: "Kruger" });
    const next = new URL(
      await discovered.locator("a.button").getAttribute("href"),
      restoredOrigin,
    );
    assert.equal(next.searchParams.get("arrival"), "SZK");
    await discovered.locator("a.button").click();
    await page.locator(".flight-booking").waitFor();
    assert.match(await page.locator(".trip-flight-route").innerText(), /SZK/);
    assert.doesNotMatch(
      await page.locator(".trip-flight-route").innerText(),
      /MQP/,
    );
    await pass(stage);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  console.log(
    `PASS ${reports.length} browser regression groups; no client errors or forbidden requests`,
  );
} catch (error) {
  reports.push({ name: stage, status: "FAIL", reason: error.message });
  throw error;
} finally {
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify({ reports, errors, forbidden }, null, 2),
  );
  await browser.close();
}
