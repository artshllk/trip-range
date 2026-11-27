/** Local production UI against serve-results-v2-fixture.mjs; no live inventory. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const out = "docs/verification/trip-detail-redesign";
mkdirSync(out, { recursive: true });
const base = {
  origin: "zurich",
  budget: "800",
  currency: "EUR",
  start: "2027-02-20",
  end: "2027-02-22",
  when: "custom",
  adults: "2",
  children: "0",
  airports: "0",
  styles: "city",
  stay: "standard",
  flexDays: "0",
};
const target = {
  id: "city:VIE",
  name: "Vienna",
  type: "city",
  cityCode: "VIE",
  iataCodes: ["VIE"],
  countryCode: "AT",
  countryName: { en: "Austria", sq: "Austri" },
};
const url = (path, extra = {}) =>
  `${origin}/plan/${path}?${new URLSearchParams({ ...base, ...extra })}`;
const browser = await chromium.launch();
const reports = [];
let stage = "start";
try {
  for (const width of [1440, 390, 375, 360, 320]) {
    const p = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    p.setDefaultTimeout(12000);
    const errors = [],
      affiliate = [];
    let ai = 0;
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (r.url().includes("/api/ai/")) ai++;
    });
    await p.route("**/_vercel/**", (r) => r.fulfill({ body: "" }));
    await p.route("**/api/affiliate/flights", async (r) => {
      affiliate.push(r.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 200));
      await r.fulfill({ status: 503, json: { status: "unavailable" } });
    });
    const overflow = async () =>
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        stage + " overflow",
      );
    const shot = async (name, locator) => {
      if (![1440, 390, 320].includes(width)) return;
      // Native section screenshots must fit the capture viewport; keep dialog
      // screenshots at the real device height so their scrolling remains visible.
      const section =
        locator &&
        !(await locator.evaluate((element) => element.tagName === "DIALOG"));
      if (section) {
        const box = await locator.boundingBox();
        await p.setViewportSize({
          width,
          height: Math.max(900, Math.ceil(box.height) + 300),
        });
        await locator.scrollIntoViewIfNeeded();
        await p.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
      }
      await (locator || p).screenshot({
        path: `${out}/${name}-${width}.png`,
        ...(locator ? {} : { fullPage: true }),
      });
      if (section) await p.setViewportSize({ width, height: 900 });
    };
    stage = `${width} results to trip`;
    await p.goto(url("results", { toPlace: JSON.stringify(target) }));
    await p.locator('a[href*="/plan/trips/vienna"]').first().click();
    await p.waitForURL(/\/plan\/trips\/vienna/);
    await p.locator(".trip-detail-page").waitFor();
    await p.getByRole("button", { name: "Edit search", exact: true }).waitFor();
    await overflow();
    assert.match(
      await p.locator("meta[name=robots]").getAttribute("content"),
      /noindex/,
    );
    assert.equal(await p.locator("main h1").count(), 1);
    assert.equal(
      await p.locator(".result-total-unknown").innerText(),
      "Trip total not yet known",
    );
    assert.equal(
      await p.locator(".trip-budget .fit,.trip-budget .result-balance").count(),
      0,
    );
    assert.equal(await p.locator(".result-flight-limit").isVisible(), false);
    assert.equal(affiliate.length, 0);
    stage = `${width} day tabs`;
    const tabs = p.getByRole("tab");
    assert.equal(await tabs.count(), 3);
    assert.match(await tabs.first().innerText(), /20 Feb/);
    assert.match(await tabs.last().innerText(), /22 Feb/);
    await tabs.first().focus();
    await p.keyboard.press("ArrowRight");
    assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
    assert.equal(
      await tabs.nth(1).evaluate((e) => e === document.activeElement),
      true,
    );
    assert.match(await p.getByRole("tabpanel").innerText(), /Schönbrunn/);
    await p.keyboard.press("End");
    assert.equal(await tabs.last().getAttribute("aria-selected"), "true");
    await p.keyboard.press("Home");
    assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
    await tabs.nth(1).click();
    await shot("day-two", p.locator("#days"));
    await tabs.first().click();
    stage = `${width} accommodation persistence`;
    const initialURL = p.url();
    await p.locator(".stay-level").first().click();
    await p.waitForURL((u) => u.searchParams.get("stay") === "simple");
    const changedURL = p.url();
    const saved = new URL(changedURL).searchParams;
    for (const key of [
      "origin",
      "budget",
      "currency",
      "start",
      "end",
      "adults",
      "children",
      "styles",
      "airports",
      "toPlace",
    ])
      assert.equal(
        saved.get(key),
        new URL(initialURL).searchParams.get(key),
        key,
      );
    assert.equal(
      await p.locator(".stay-level").first().getAttribute("aria-pressed"),
      "true",
    );
    await shot("stay-simple", p.locator("#where-to-stay"));
    await p.reload();
    assert.equal(
      await p.locator(".stay-level").first().getAttribute("aria-pressed"),
      "true",
    );
    stage = `${width} disclosures and guide roundtrip`;
    await p.locator(".trip-place-details > summary").first().focus();
    await p.keyboard.press("Enter");
    assert.equal(await p.locator(".trip-place-details[open]").count(), 1);
    assert.ok(await p.locator(".trip-place-details[open] a").count());
    await shot("attraction-open", p.locator("#worth-seeing"));
    await p.locator("#price-details > summary").click();
    assert.equal(await p.locator(".result-flight-limit").isVisible(), true);
    await p.locator("#trip-sources > summary").click();
    assert.equal(await p.locator("#trip-sources[open]").count(), 1);
    await shot("sources-open", p.locator("#trip-sources"));
    await shot("price-open", p.locator(".trip-budget"));
    const guide = p.locator('.trip-guide-band a[href*="/destinations/"]');
    assert.equal(await guide.getAttribute("href"), "/destinations/vienna");
    await guide.click();
    await p.waitForURL((u) => u.pathname === "/destinations/vienna");
    assert.equal(new URL(p.url()).search, "");
    await p.goBack();
    await p.waitForURL((u) => u.pathname.includes("/plan/trips/vienna"));
    assert.equal(new URL(p.url()).searchParams.get("stay"), "simple");
    stage = `${width} search cancel and validation`;
    const edit = p.getByRole("button", { name: "Edit search", exact: true });
    await edit.click();
    await p.locator("dialog[open]").waitFor();
    const field = async (name) =>
      p.locator(`dialog [data-field=${name}]`).click();
    assert.equal(
      await p.evaluate(() => getComputedStyle(document.body).overflow),
      "hidden",
    );
    for (let n = 0; n < 12; n++) {
      await p.keyboard.press("Tab");
      assert.equal(
        await p.evaluate(
          () => !!document.activeElement?.closest("dialog[open]"),
        ),
        true,
      );
    }
    await field("budget");
    await p.locator(".search-inline-editor input[type=number]").fill("999");
    await p.keyboard.press("Escape");
    await p.locator("dialog[open]").waitFor({ state: "detached" });
    assert.equal(new URL(p.url()).searchParams.get("budget"), "800");
    assert.equal(
      await edit.evaluate((e) => e === document.activeElement),
      true,
    );
    await edit.click();
    await field("budget");
    assert.equal(
      await p.locator(".search-inline-editor input[type=number]").inputValue(),
      "800",
    );
    await p.locator(".search-inline-editor input[type=number]").fill("0");
    await p.getByRole("button", { name: "Back", exact: true }).click();
    assert.equal(
      await p.getByRole("button", { name: /Update search/ }).isDisabled(),
      true,
    );
    await field("budget");
    await p.locator(".search-inline-editor input[type=number]").fill("900");
    await p.getByRole("button", { name: "Back", exact: true }).click();
    await field("dates");
    const dates = p.locator(".search-inline-editor input[type=date]");
    await dates.first().fill("2027-02-24");
    await dates.last().fill("2027-02-22");
    await p.getByRole("button", { name: "Back", exact: true }).click();
    assert.equal(
      await p.getByRole("button", { name: /Update search/ }).isDisabled(),
      true,
    );
    await field("dates");
    await dates.first().fill("2027-02-20");
    await dates.last().fill("2027-02-22");
    await p
      .locator(".search-inline-editor")
      .getByRole("button", { name: /±/ })
      .click();
    await p.getByRole("button", { name: "Back", exact: true }).click();
    await field("travelers");
    await p
      .locator(".search-inline-editor input[type=number]")
      .first()
      .fill("3");
    await p
      .locator(".search-inline-editor input[type=number]")
      .last()
      .fill("1");
    await p.getByRole("button", { name: "Back", exact: true }).click();
    for (const name of ["from", "to"]) {
      await field(name);
      assert.ok(
        await p
          .locator(".search-inline-editor")
          .getByRole("combobox")
          .inputValue(),
      );
      await p.getByRole("button", { name: "Back", exact: true }).click();
    }
    await overflow();
    await shot("search-sheet", p.locator("dialog[open]"));
    await p.getByRole("button", { name: /Update search/ }).click();
    await p.waitForURL(
      (u) =>
        u.searchParams.get("budget") === "900" &&
        u.pathname.endsWith("/results"),
    );
    assert.equal(new URL(p.url()).searchParams.get("adults"), "3");
    assert.equal(new URL(p.url()).searchParams.get("children"), "1");
    assert.equal(new URL(p.url()).searchParams.get("flexDays"), "3");
    await p.goBack();
    await p.waitForURL((u) => u.pathname.includes("/plan/trips/vienna"));
    assert.equal(new URL(p.url()).searchParams.get("budget"), "800");
    // Native backdrop dismissal cancels an untouched draft and restores focus.
    await p.getByRole("button", { name: "Edit search", exact: true }).click();
    const beforeOutside = p.url();
    await p.mouse.click(2, 2);
    await p.locator("dialog[open]").waitFor({ state: "detached" });
    assert.equal(p.url(), beforeOutside);
    assert.notEqual(
      await p.evaluate(() => getComputedStyle(document.body).overflow),
      "hidden",
    );
    stage = `${width} affiliate failure`;
    await p.locator(".affiliate-action button").click();
    await p
      .getByRole("status")
      .filter({ hasText: /couldn.t open|unavailable|try again/i })
      .waitFor();
    assert.equal(affiliate.length, 1);
    assert.deepEqual(affiliate[0].route, {
      originCode: "ZRH",
      destinationCode: "VIE",
      departureDate: "2027-02-20",
      returnDate: "2027-02-22",
      party: { adults: 2, children: 0 },
    });
    assert.equal(affiliate[0].placement, "trip");
    assert.equal(await p.locator(".affiliate-action button").count(), 1);
    await shot("booking-unavailable", p.locator(".trip-budget"));
    await overflow();
    stage = `${width} menu and currency`;
    if (width < 900) {
      await p.getByRole("button", { name: "Menu", exact: true }).click();
      await p.locator("dialog[open]").waitFor();
      await overflow();
      await shot("menu", p.locator("dialog[open]"));
      await p.keyboard.press("Escape");
      await p.locator("dialog[open]").waitFor({ state: "detached" });
    } else {
      await p.getByRole("button", { name: "Currency: EUR" }).click();
      await p.getByRole("radio", { name: "GBP", exact: true }).click();
      await p.waitForURL((u) => u.searchParams.get("currency") === "GBP");
      await p.keyboard.press("Escape");
      await p.reload();
      assert.match(await p.locator("#trip-budget-title").innerText(), /£800/);
    }
    await p.locator(".trip-back").click();
    await p.waitForURL((u) => u.pathname.endsWith("/results"));
    assert.equal(new URL(p.url()).searchParams.get("stay"), "simple");
    assert.deepEqual(errors, [], stage);
    assert.equal(ai, 0);
    reports.push({
      width,
      checks:
        "journey, tabs and keyboard, stay/reload/Back, disclosures, canonical guide, search cancellation/validation/apply, affiliate failure, navigation",
      errors,
      affiliateCalls: affiliate.length,
      ai,
    });
    await p.close();
  }
  const p = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const cases = {
    priced: ["vienna", { start: "2027-01-20", end: "2027-01-22" }],
    over: ["vienna", { start: "2027-01-20", end: "2027-01-22", budget: "420" }],
    reference: ["paris", { start: "2027-01-20", end: "2027-01-22" }],
    outage: ["vienna", { start: "2027-04-20", end: "2027-04-22" }],
    transfer: [
      "place:Q41858",
      {
        start: "2027-01-20",
        end: "2027-01-22",
        styles: "",
        budget: "3000",
        toPlace: JSON.stringify({
          id: "country:CA",
          type: "country",
          name: "Canada",
          countryCode: "CA",
          countryName: { en: "Canada", sq: "Canada" },
        }),
      },
    ],
    threeNights: ["vienna", { end: "2027-02-23" }],
    largeParty: ["vienna", { adults: "8", children: "2" }],
  };
  for (const [name, [id, extra]] of Object.entries(cases)) {
    stage = name;
    await p.goto(url(`trips/${encodeURIComponent(id)}`, extra));
    await p.locator(".trip-detail-page").waitFor();
    await p.waitForTimeout(300);
    let text = await p.locator(".trip-budget").innerText();
    if (["reference", "outage", "transfer"].includes(name)) {
      assert.match(text, /Trip total not yet known/);
      assert.equal(
        await p
          .locator(".trip-budget .fit,.trip-budget .result-balance")
          .count(),
        0,
      );
    }
    if (name === "priced")
      assert.equal(await p.locator(".result-price-complete").count(), 1);
    if (name === "over") assert.equal(await p.locator(".fit.over").count(), 1);
    if (name === "reference") {
      assert.match(text, /24–26 Jan 2027/);
      assert.match(
        await p.locator(".trip-detail-dates").innerText(),
        /20–22 Jan/,
      );
    }
    if (name === "transfer") {
      assert.match(text, /transfer/i);
      assert.match(text, /YYC/);
    }
    if (name === "threeNights") {
      assert.equal(await p.getByRole("tab").count(), 4);
      assert.match(await p.getByRole("tab").last().innerText(), /23 Feb/);
      await p.getByRole("tab").last().click();
    }
    if (name === "largeParty") {
      assert.match(
        await p.locator(".trip-detail-dates").innerText(),
        /10 people/,
      );
      assert.equal(await p.locator(".affiliate-action button").count(), 0);
    }
    await p.screenshot({
      path: `${out}/state-${name}-1440.png`,
      fullPage: true,
    });
    await p.setViewportSize({ width: 320, height: 900 });
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      name + " 320 overflow",
    );
    await p.screenshot({
      path: `${out}/state-${name}-320.png`,
      fullPage: true,
    });
    await p.setViewportSize({ width: 1440, height: 1000 });
    reports.push({ state: name, text });
  }
  writeFileSync(
    `${out}/functional-results.json`,
    JSON.stringify(reports, null, 2),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      widths: 5,
      states: 7,
      reports: reports.length,
    }),
  );
} catch (e) {
  console.error("FAILED", stage);
  throw e;
} finally {
  await browser.close();
}
