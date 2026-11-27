/** Run only against serve-results-v2-fixture.mjs. No live inventory or booking. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const out = "docs/verification/three-page-acceptance";
mkdirSync(out, { recursive: true });
const city = (code, name, countryCode) => ({
  id: `city:${code}`,
  type: "city",
  name,
  cityCode: code,
  iataCodes: [code],
  countryCode,
  countryName: { en: countryCode, sq: countryCode },
});
const vienna = city("VIE", "Vienna", "AT");
const airport = {
  id: "airport:ZRH",
  type: "airport",
  name: "Zurich Airport",
  airportIata: "ZRH",
  cityCode: "ZRH",
  countryCode: "CH",
  countryName: { en: "Switzerland", sq: "Switzerland" },
};
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
  styles: "city",
  stay: "standard",
  flexDays: "0",
};
const url = (path, extra = {}) =>
  `${origin}/en${path}?${new URLSearchParams({ ...base, ...extra })}`;
const browser = await chromium.launch();
const reports = [],
  visuals = [],
  states = [];
let stage = "start";
const params = (href) => Object.fromEntries(new URL(href).searchParams);
const checkContext = (href, expected) => {
  const actual = params(href);
  for (const key of [
    "origin",
    "originPlace",
    "toPlace",
    "start",
    "end",
    "flexDays",
    "budget",
    "currency",
    "adults",
    "children",
    "styles",
    "stay",
    "airports",
    "car",
    "luggage",
    "family",
  ])
    assert.equal(actual[key], expected[key], `${stage}: ${key}`);
};
async function ready(page) {
  await page.locator("main h1").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}
async function inspect(page, name, width, screenshot = true) {
  await ready(page);
  const report = await page.evaluate(() => {
    const style = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const c = getComputedStyle(e);
      return {
        font: c.fontFamily,
        color: c.color,
        background: c.backgroundColor,
        position: c.position,
      };
    };
    const cta = document.querySelector(
      ".search-submit, .result-actions .button.ember, .trip-budget .affiliate-action button",
    );
    const cr = cta?.getBoundingClientRect();
    return {
      url: location.href,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      h1: document.querySelector("main h1")?.textContent,
      headings: document.querySelectorAll("main h1").length,
      header: style(".site-header"),
      main: style("main"),
      title: style("main h1"),
      action: cta
        ? {
            color: getComputedStyle(cta).color,
            background: getComputedStyle(cta).backgroundColor,
            top: cr.top,
            bottom: cr.bottom,
          }
        : null,
      images: [...document.querySelectorAll("main img")].map((i) => ({
        src: i.currentSrc || i.src,
        alt: i.alt,
        width: i.naturalWidth,
        height: i.naturalHeight,
      })),
      cls: window.qaCLS,
    };
  });
  assert.equal(report.overflow, false, `${stage} overflow`);
  assert.equal(report.headings, 1);
  assert.equal(await page.locator(".ai-trigger").count(), 0);
  if (screenshot) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `${out}/${name}-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({ path: `${out}/${name}-${width}-viewport.png` });
  }
  visuals.push({ name, width, ...report });
  return report;
}
try {
  for (const width of [1440, 390, 375, 360, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 1440 ? 900 : 844 },
      reducedMotion: "reduce",
      hasTouch: width < 900,
    });
    page.setDefaultTimeout(12000);
    const errors = [],
      affiliate = [];
    let ai = 0,
      handoffMode = "unavailable";
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/ai/")) ai++;
    });
    await page.addInitScript(() => {
      window.qaCLS = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (!e.hadRecentInput) window.qaCLS += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.route("**/_vercel/**", (r) => r.fulfill({ body: "" }));
    await page.route("**/api/locations?**", (route) => {
      const q = new URL(route.request().url()).searchParams
        .get("q")
        .toLowerCase();
      return route.fulfill({
        json: {
          status: "available",
          locations: [
            q.includes("vie")
              ? vienna
              : q.includes("lon")
                ? city("LON", "London", "GB")
                : airport,
          ],
        },
      });
    });
    const handoff = `${origin}/__qa-three-page-handoff`;
    await page.route(handoff, (r) =>
      r.fulfill({
        contentType: "text/html",
        body: "Local affiliate handoff verified",
      }),
    );
    await page.route("**/api/affiliate/flights", async (r) => {
      affiliate.push(r.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 250));
      return handoffMode === "available"
        ? r.fulfill({ json: { status: "available", link: { url: handoff } } })
        : r.fulfill({ status: 503, json: { status: "unavailable" } });
    });
    stage = `${width} homepage editing`;
    await page.goto(url(""));
    await ready(page);
    const dialog = page.locator(".home-field-editor[open]");
    const open = async (name) => {
      await page.locator(`[data-field=${name}]`).click();
      await dialog.waitFor();
    };
    const apply = async () => {
      await dialog.getByRole("button", { name: "Apply", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
    };
    await open("from");
    await dialog.getByRole("combobox").fill("Zur");
    await dialog.getByRole("option").first().click();
    await dialog.getByRole("checkbox").uncheck();
    await apply();
    await open("to");
    await dialog.getByRole("combobox").fill("Vienna");
    await dialog.getByRole("option").first().click();
    await apply();
    await open("dates");
    await dialog.locator("input[type=date]").first().fill("2027-01-20");
    await dialog.locator("input[type=date]").last().fill("2027-01-22");
    await dialog
      .getByRole("button", { name: "Flexible ±3 days", exact: true })
      .click();
    await apply();
    await open("travelers");
    await dialog.getByLabel("Adults", { exact: true }).fill("3");
    await dialog.getByLabel("Children", { exact: true }).fill("1");
    await apply();
    await open("budget");
    await dialog.locator("input[type=number]").fill("1500");
    await dialog.locator("select").selectOption("GBP");
    await apply();
    await page.waitForURL(
      (u) =>
        u.searchParams.get("currency") === "GBP" &&
        u.searchParams.get("budget") === "1500",
    );
    const homeUrl = page.url(),
      expected = params(homeUrl);
    assert.equal(expected.origin, "airport:ZRH");
    assert.equal(JSON.parse(expected.toPlace).id, "city:VIE");
    assert.equal(expected.flexDays, "3");
    assert.equal(expected.adults, "3");
    assert.equal(expected.children, "1");
    await open("budget");
    await dialog.locator("input[type=number]").fill("99");
    await dialog.locator("select").selectOption("EUR");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    checkContext(page.url(), expected);
    await page.reload();
    await ready(page);
    assert.match(
      await page.locator('[data-field="budget"]').innerText(),
      /1,?500/,
    );
    const homeStyle = await inspect(page, "homepage", width);
    assert.equal(homeStyle.header.background, "rgba(0, 0, 0, 0)");
    assert.equal(homeStyle.header.position, "absolute");
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://www.trip-range.com/",
    );
    stage = `${width} homepage to results`;
    await page.locator(".search-submit").click();
    await page.waitForURL((u) => u.pathname.endsWith("/results"));
    await page.locator(".result-card").first().waitFor();
    checkContext(page.url(), expected);
    const resultsUrl = page.url();
    await page.reload();
    await ready(page);
    checkContext(page.url(), expected);
    const resultsStyle = await inspect(page, "results", width);
    assert.equal(resultsStyle.header.position, "relative");
    assert.equal(resultsStyle.header.background, "rgb(21, 23, 26)");
    assert.match(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      /noindex/,
    );
    assert.equal(await page.locator(".result-price-complete").count(), 1);
    if (width >= 900) {
      await page
        .locator('.results-search-desktop [data-field="budget"]')
        .click();
      await dialog.locator("input[type=number]").fill("99");
    } else {
      await page
        .getByRole("button", { name: "Edit search", exact: true })
        .click();
      await page.locator('dialog [data-field="budget"]').click();
      await page.locator(".search-inline-editor input[type=number]").fill("99");
    }
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    assert.equal(page.url(), resultsUrl);
    stage = `${width} results to trip`;
    const explore = page.locator('.result-card a[href*="/plan/trips/vienna"]');
    const cardPrice = await page.locator(".result-price").innerText();
    await explore.click();
    await page.waitForURL((u) => u.pathname.endsWith("/trips/vienna"));
    await ready(page);
    checkContext(page.url(), expected);
    const tripUrl = page.url();
    assert.equal(await page.locator(".result-price").innerText(), cardPrice);
    await page.reload();
    await ready(page);
    checkContext(page.url(), expected);
    const tripStyle = await inspect(page, "trip", width);
    assert.equal(tripStyle.header.position, "sticky");
    assert.equal(tripStyle.header.background, "rgb(21, 23, 26)");
    assert.equal(tripStyle.title.font, homeStyle.title.font);
    assert.equal(tripStyle.action.background, homeStyle.action.background);
    assert.equal(resultsStyle.action.background, homeStyle.action.background);
    assert.match(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      /noindex/,
    );
    stage = `${width} Back Forward and guide`;
    await page.goBack();
    await page.waitForURL(resultsUrl);
    await ready(page);
    checkContext(page.url(), expected);
    await page.goBack();
    await page.waitForURL(homeUrl);
    await ready(page);
    checkContext(page.url(), expected);
    const restoredHome = await inspect(page, "home-after-back", width, false);
    assert.deepEqual(restoredHome.header, homeStyle.header);
    await page.goForward();
    await page.waitForURL(resultsUrl);
    await ready(page);
    checkContext(page.url(), expected);
    await page.goForward();
    await page.waitForURL(tripUrl);
    await ready(page);
    checkContext(page.url(), expected);
    const guide = page.locator(
      '.trip-guide-band a[href="/destinations/vienna"]',
    );
    await guide.click();
    await page.waitForURL(`${origin}/destinations/vienna`);
    await ready(page);
    assert.equal(new URL(page.url()).search, "");
    await inspect(page, "guide", width, false);
    await page.goBack();
    await page.waitForURL(tripUrl);
    await ready(page);
    checkContext(page.url(), expected);
    await page.goForward();
    await page.waitForURL(`${origin}/destinations/vienna`);
    await page.goBack();
    await page.waitForURL(tripUrl);
    await ready(page);
    stage = `${width} trip cancellation and handoff`;
    const edit = page.getByRole("button", { name: "Edit search", exact: true });
    await edit.click();
    await page.locator('dialog [data-field="budget"]').click();
    await page.locator(".search-inline-editor input[type=number]").fill("77");
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    checkContext(page.url(), expected);
    assert.equal(
      await edit.evaluate((e) => e === document.activeElement),
      true,
    );
    const booking = page.locator(".trip-budget .affiliate-action button");
    assert.equal(affiliate.length, 0);
    await booking.click();
    assert.equal(await booking.isDisabled(), true);
    await page.locator(".affiliate-action [role=status]").waitFor();
    assert.equal(affiliate.length, 1);
    assert.deepEqual(affiliate[0], {
      placement: "trip",
      route: {
        originCode: "ZRH",
        destinationCode: "VIE",
        departureDate: "2027-01-20",
        returnDate: "2027-01-22",
        party: { adults: 3, children: 1 },
      },
    });
    checkContext(page.url(), expected);
    await page.screenshot({ path: `${out}/handoff-unavailable-${width}.png` });
    handoffMode = "available";
    await booking.click();
    await page.waitForURL(handoff);
    assert.equal(affiliate.length, 2);
    assert.deepEqual(affiliate[1], affiliate[0]);
    await page.goBack();
    await page.waitForURL(tripUrl);
    await ready(page);
    checkContext(page.url(), expected);
    assert.deepEqual(errors, []);
    assert.equal(ai, 0);
    reports.push({
      width,
      status: "passed",
      search: expected,
      affiliate: affiliate[0],
      checks:
        "all field edits, cancellation on three pages, persisted pricing/search, Back/Forward/reload, canonical guide, CSS scope, unavailable/pending/retry/success affiliate, no AI or browser errors",
    });
    console.log(
      `PASS ${width}: complete homepage → results → trip → affiliate journey`,
    );
    await page.close();
  }
  const variants = {
    priced: { toPlace: JSON.stringify(vienna) },
    reference: { toPlace: JSON.stringify(city("PAR", "Paris", "FR")) },
    incomplete: {
      toPlace: JSON.stringify(vienna),
      start: "2027-02-20",
      end: "2027-02-22",
    },
    "no-fit": { toPlace: JSON.stringify(vienna), budget: "50" },
    outage: { start: "2027-04-20", end: "2027-04-22" },
    empty: { start: "2027-02-20", end: "2027-02-22" },
    "large-group": {
      toPlace: JSON.stringify(vienna),
      adults: "8",
      children: "2",
      budget: "5000",
    },
  };
  for (const width of [1440, 390, 375, 360, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 1440 ? 900 : 844 },
      reducedMotion: "reduce",
    });
    for (const [state, extra] of Object.entries(variants)) {
      stage = `${width} ${state}`;
      await page.goto(url("/plan/results", extra));
      await ready(page);
      if (
        ["priced", "reference", "incomplete", "large-group"].includes(state)
      ) {
        await page.locator(".result-card").first().waitFor();
        const price = page.locator(".result-card .result-price").first();
        if (state === "priced")
          assert.equal(await page.locator(".result-price-complete").count(), 1);
        if (["reference", "incomplete"].includes(state)) {
          assert.match(await price.innerText(), /Trip total not yet known/);
          assert.equal(
            await page
              .locator(".result-balance,.fit.good,.fit.comfortable")
              .count(),
            0,
          );
        }
        if (state === "reference")
          assert.match(
            await page.locator(".result-reference").innerText(),
            /24–26 Jan 2027/,
          );
      } else {
        assert.equal(await page.locator(".result-card").count(), 0);
        await page.locator(".results-empty").waitFor();
        if (state === "no-fit")
          assert.equal(
            await page.locator(".results-empty").getAttribute("data-state"),
            "no-fit",
          );
        if (state === "outage")
          assert.match(
            await page.locator(".results-empty").innerText(),
            /temporarily unavailable/,
          );
        if (state === "empty")
          assert.equal(
            await page.locator(".results-empty").getAttribute("data-state"),
            "empty",
          );
        const current = params(page.url());
        for (const a of await page.locator(".results-alternatives a").all()) {
          const href = params(
            new URL(await a.getAttribute("href"), origin).href,
          );
          for (const k of [
            "origin",
            "budget",
            "currency",
            "adults",
            "children",
          ])
            assert.equal(href[k], current[k], `recovery lost ${k}`);
        }
      }
      await inspect(
        page,
        `state-${state}`,
        width,
        [1440, 390, 320].includes(width),
      );
      if (["reference", "incomplete", "large-group"].includes(state)) {
        const price = await page.locator(".result-price").first().innerText();
        await page
          .locator('.result-card a[href*="/plan/trips/"]')
          .first()
          .click();
        await page.waitForURL((u) => u.pathname.includes("/trips/"));
        await ready(page);
        assert.equal(await page.locator(".result-price").innerText(), price);
        if (state === "large-group") {
          assert.match(
            await page.locator(".trip-detail-dates").innerText(),
            /10 people/,
          );
          assert.equal(
            await page.locator(".affiliate-action button").count(),
            0,
          );
          assert.match(
            await page.locator(".flight-booking").innerText(),
            /unavailable|support|people|traveller/i,
          );
        }
        await inspect(
          page,
          `trip-${state}`,
          width,
          [1440, 390, 320].includes(width),
        );
      }
      states.push({ width, state, status: "passed" });
    }
    await page.close();
  }
  writeFileSync(`${out}/journeys.json`, JSON.stringify(reports, null, 2));
  writeFileSync(`${out}/states.json`, JSON.stringify(states, null, 2));
  writeFileSync(`${out}/visuals.json`, JSON.stringify(visuals, null, 2));
  console.log(
    JSON.stringify({
      status: "passed",
      journeys: reports.length,
      states: states.length,
    }),
  );
} catch (error) {
  console.error("FAILED", stage);
  throw error;
} finally {
  await browser.close();
}
