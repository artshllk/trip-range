/** Safe local end-to-end synthetic fare QA. No real booking or AI requests. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3111";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "setup";
try {
  const page = await browser.newPage();
  const errors = [],
    forbidden = [];
  page.on("pageerror", () => errors.push(stage));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(stage);
  });
  page.on("request", (r) => {
    if (/\/api\/ai\/|api.openai.com/.test(r.url())) forbidden.push(stage);
  });
  await page.route("**/_vercel/insights/script.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "/* local analytics stub */",
    }),
  );
  await page.route("https://avs.io/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>External flight search handoff verified</h1>",
    }),
  );
  page.setDefaultTimeout(20000);
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "horizontal overflow",
    );
  function search(code, extra = {}) {
    const cities = {
      WAW: ["Warsaw", "PL", "Poland"],
      ROM: ["Rome", "IT", "Italy"],
      BER: ["Berlin", "DE", "Germany"],
      VIE: ["Vienna", "AT", "Austria"],
    };
    const [name, countryCode, country] = cities[code];
    const params = new URLSearchParams({
      origin: "prishtina",
      currency: "EUR",
      budget: "2000",
      adults: "2",
      children: "0",
      when: "custom",
      start: "2026-11-20",
      end: "2026-11-23",
      nights: "3",
      flex: "0",
      toPlace: JSON.stringify({
        id: `city:${code}`,
        type: "city",
        name,
        cityCode: code,
        iataCodes: [code],
        countryCode,
        countryName: { en: country, sq: country },
      }),
      ...extra,
    });
    return origin + "/plan/results?" + params;
  }
  async function visit(code, extra) {
    await page.goto(search(code, extra));
    await page.locator(".trip-card").first().waitFor();
    assert.equal(await page.locator(".trip-card").count(), 1);
    assert.equal(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      "noindex, follow",
    );
    await noOverflow();
    return page.locator(".trip-card").first();
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    for (const [label, dates, fits] of [
      ["three priced", { start: "2026-12-18", end: "2026-12-21" }, 3],
      ["mixed", { start: "2026-11-20", end: "2026-11-23" }, 1],
      ["all ideas", { start: "2026-11-24", end: "2026-11-27" }, 0],
    ]) {
      stage = `${width}px ${label}`;
      const url = new URL(search("VIE", { origin: "zurich", ...dates }));
      url.searchParams.delete("toPlace");
      await page.goto(url.href);
      await page.locator(".trip-card").first().waitFor();
      assert.match(await page.locator("h1").innerText(), /Zurich → Anywhere/);
      assert.equal(await page.locator("h1").count(), 1);
      const firstBox = await page.locator(".trip-card").first().boundingBox();
      if (fits)
        assert.ok(
          firstBox.y < (width === 1440 ? 360 : 480),
          "priced destination appears early",
        );
      else {
        const recovery = page.locator(
          '.results-empty[data-state="insufficient-pricing"]',
        );
        const recoveryBox = await recovery.boundingBox();
        assert.ok(
          recoveryBox.y + recoveryBox.height <= firstBox.y,
          "incomplete-price recovery precedes ideas",
        );
        assert.match(await recovery.innerText(), /Prices are incomplete/);
      }
      assert.equal(await page.locator(".result-details[open]").count(), 0);
      assert.equal(await page.locator(".trip-card img").count(), 0);
      assert.equal(
        await page.locator(".trip-card.result-card-no-photo").count(),
        3,
      );
      assert.equal(
        await page
          .locator(
            ".trip-card .destination-no-image, .trip-card .result-visual, .trip-card .result-media-reserve, .trip-card .result-photo-credit",
          )
          .count(),
        0,
        "initially missing photos use an intentional compact layout",
      );
      const pricedSection = page.getByRole("region", {
        name: "Trips within your budget",
      });
      assert.equal(await pricedSection.locator(".trip-card").count(), fits);
      assert.equal(
        await pricedSection.locator(".flight-affordability").count(),
        0,
      );
      if (fits)
        assert.match(
          await pricedSection.innerText(),
          /left after safety reserve/,
        );
      const ideas = page.getByRole("region", {
        name: "Options with incomplete prices",
        exact: true,
      });
      if (fits < 3) {
        assert.equal(await ideas.locator(".trip-card").count(), 3 - fits);
        assert.equal(
          await ideas.locator(".flight-affordability").count(),
          3 - fits,
        );
        assert.doesNotMatch(
          await ideas.innerText(),
          /Estimated spending|Budget needed|left after safety reserve/,
        );
        if (fits === 1) {
          const pricedBox = await pricedSection.boundingBox(),
            ideasBox = await ideas.boundingBox();
          assert.ok(
            ideasBox.y >= pricedBox.y + pricedBox.height,
            "complete results precede unpriced ideas",
          );
        }
      } else assert.equal(await ideas.count(), 0);
      assert.equal(await page.locator(".trip-card").count(), 3);
      await noOverflow();
      await page.screenshot({
        path: `/tmp/goeksplo-affordability-${label.replace(/ /g, "-")}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      console.log(
        `PASS ${stage}: accurate heading, card count and separate price groups`,
      );
    }
    stage = `${width}px matching fare`;
    let card = await visit("VIE");
    let text = await card.innerText();
    assert.match(text, /Estimated spending/);
    assert.match(text, /left after safety reserve/);
    await card.locator(".result-details > summary").click();
    assert.match(await card.innerText(), /Reserve kept aside/);
    assert.match(text, /Recent flight fare · other costs estimated/);
    assert.doesNotMatch(text, /Total incomplete/);
    await card.locator("a.button").click();
    await page.locator(".flight-booking").waitFor();
    assert.match(
      await page.locator(".flight-booking").innerText(),
      /€360 · Recent flight data/,
    );
    await noOverflow();
    console.log(`PASS ${stage}: complete total and recent cached flight`);

    stage = `${width}px Warsaw unavailable`;
    card = await visit("WAW", { budget: "600" });
    text = await card.innerText();
    assert.match(await page.locator("h1").innerText(), /Prishtina → Warsaw/);
    assert.match(text, /Total incomplete/);
    assert.match(text, /Estimated costs excluding flights/);
    assert.match(text, /€436/);
    const ceiling = card.locator(".flight-budget-disclosure");
    assert.equal(await ceiling.getAttribute("open"), null);
    assert.doesNotMatch(text, /€109.45|Budget ceiling, not a fare estimate/);
    await ceiling.locator("summary").click();
    assert.match(await ceiling.innerText(), /≤ €109.45/);
    assert.match(
      await ceiling.innerText(),
      /Budget ceiling, not a fare estimate/,
    );
    await ceiling.locator("summary").click();
    assert.doesNotMatch(
      text,
      /€440|Estimated spending|Reserve kept aside|Budget needed|left after safety reserve|Fits your budget/,
    );
    await card.getByRole("button", { name: /Check current flights/ }).click();
    await page.waitForURL("https://avs.io/**");
    card = await visit("WAW", { budget: "600" });
    await card.locator("a.button").click();
    await page.locator(".flight-booking").waitFor();
    text = await page.locator("main").innerText();
    assert.match(text, /Total incomplete/);
    assert.doesNotMatch(text, /€440|left after safety reserve/);
    const detailCeiling = page.locator(
      ".trip-unpriced-summary .flight-budget-disclosure",
    );
    assert.equal(await detailCeiling.getAttribute("open"), null);
    await detailCeiling.locator("summary").click();
    assert.match(await detailCeiling.innerText(), /≤ €109.45/);
    await detailCeiling.locator("summary").click();
    // Trip overview displays human-readable dates; semantic values retain the exact selection.
    assert.equal(
      await page
        .locator('.trip-detail-dates time[datetime="2026-11-20"]')
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator('.trip-detail-dates time[datetime="2026-11-23"]')
        .count(),
      1,
    );
    await noOverflow();
    await page.screenshot({
      path: `/tmp/goeksplo-pricing-warsaw-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Edit search", exact: true })
      .click();
    await page.locator("dialog .search-field").nth(4).click();
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: /Check current flights on Aviasales/ })
      .click();
    await page.waitForURL("https://avs.io/**");
    console.log(
      `PASS ${stage}: no fake total, estimates remain, both affiliate placements, one edit sheet`,
    );

    stage = `${width}px tight budget`;
    card = await visit("WAW", { budget: "450" });
    text = await card.innerText();
    assert.match(text, /Other estimated costs leave no room for flights/);
    assert.doesNotMatch(text, /or less|€0|Estimated spending|Budget needed/);
    await card.locator("a.button").click();
    await page.locator(".flight-booking").waitFor();
    assert.match(await page.locator("main").innerText(), /no room for flights/);
    await noOverflow();
    console.log(
      `PASS ${stage}: reserve leaves no useful ceiling, no invented price`,
    );

    stage = `${width}px reference fare`;
    card = await visit("ROM");
    text = await card.innerText();
    assert.match(text, /Total incomplete/);
    assert.match(text, /Recent fare reference/);
    assert.equal(
      await card
        .locator('.result-reference time[datetime="2026-11-12"]')
        .count(),
      1,
    );
    assert.match(text, /€92/);
    assert.equal(
      await card
        .locator('.result-date-line time[datetime="2026-11-20"]')
        .count(),
      1,
    );
    const referenceCeiling = card.locator(".flight-budget-disclosure");
    await referenceCeiling.locator("summary").click();
    assert.match(
      await referenceCeiling.innerText(),
      /Budget ceiling, not a fare estimate/,
    );
    await referenceCeiling.locator("summary").click();
    assert.doesNotMatch(
      text,
      /Estimated spending|Budget needed|left after safety reserve/,
    );
    await page.screenshot({
      path: `/tmp/goeksplo-pricing-reference-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    console.log(
      `PASS ${stage}: informational price/date excluded from actual trip total`,
    );

    for (const [label, extra] of [
      ["flexible", { flex: "1" }],
      ["weekend", { dateMode: "weekends", month: "2026-11" }],
    ]) {
      stage = `${width}px ${label}`;
      card = await visit("BER", extra);
      text = await card.innerText();
      assert.equal(
        await card
          .locator('.result-date-line time[datetime="2026-11-21"]')
          .count(),
        1,
      );
      assert.match(text, /Estimated spending/);
      await card.locator("a.button").click();
      await page.locator(".flight-booking").waitFor();
      assert.match(
        await page.locator(".flight-booking").innerText(),
        /€184 · Recent flight data/,
      );
      await page
        .getByRole("button", { name: /Check flights on Aviasales/ })
        .click();
      await page.waitForURL("https://avs.io/**");
      console.log(
        `PASS ${stage}: accepted actual dates, complete total and affiliate handoff`,
      );
    }
    stage = `${width}px nearby airport`;
    card = await visit("VIE", { airports: "1" });
    text = await card.innerText();
    assert.match(text, /SKP/);
    assert.match(text, /120/);
    assert.match(text, /after.*transfer|including.*transfer/i);
    card = await visit("ROM", { airports: "1" });
    text = await card.innerText();
    assert.doesNotMatch(text, /Save €|Save after transfer/);
    console.log(
      `PASS ${stage}: comparable real fare saving; reference never qualifies`,
    );

    stage = `${width}px budget SEO`;
    await page.goto(origin + "/from/zurich/weekend-trips-under-500");
    await page.locator(".trip-card").first().waitFor();
    assert.equal(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      "noindex, follow",
    );
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://www.trip-range.com/from/zurich/weekend-trips-under-500",
    );
    assert.equal(await page.locator("h1").count(), 1);
    assert.match(
      await page.locator(".seo-answer").innerText(),
      /0 destinations fit/,
    );
    assert.match(
      await page.locator(".seo-answer").innerText(),
      /not enough matching flight prices/,
    );
    await noOverflow();
    console.log(`PASS ${stage}: reference-only coverage stays noindex`);
  }
  // Results-only UX regressions, exercising the real engine and existing search editor.
  for (const [width, locale] of [
    [1440, "en"],
    [390, "en"],
    [320, "sq"],
  ]) {
    stage = `${width}px ${locale} Vienna missing matching fare`;
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const url = new URL(
      search("VIE", {
        budget: "500",
        nights: "2",
        start: "2026-11-24",
        end: "2026-11-26",
      }),
    );
    url.pathname = `/${locale}/plan/results`;
    await page.goto(url.href);
    const card = page.locator(".trip-card").first();
    await card.waitFor();
    assert.equal(await page.locator(".trip-card").count(), 1);
    assert.equal(await card.getAttribute("data-pricing"), "flight-unpriced");
    const recovery = page.locator(
      '.results-empty[data-state="insufficient-pricing"]',
    );
    const recoveryBox = await recovery.boundingBox();
    assert.ok(
      recoveryBox.y + recoveryBox.height <= (await card.boundingBox()).y,
      "unknown-price recovery remains ahead of the destination",
    );
    const recoveryAction = await recovery.getByRole("button").boundingBox();
    assert.ok(
      recoveryAction.y >= 0 &&
        recoveryAction.y + recoveryAction.height <= page.viewportSize().height,
      "recovery action is immediately reachable",
    );
    const text = await card.innerText();
    assert.match(text, /312/); // Existing Vienna two-night nonflight costs.
    const ceiling = card.locator(".flight-budget-disclosure");
    assert.equal(await ceiling.getAttribute("open"), null);
    await ceiling.locator("summary").click();
    assert.match(await ceiling.innerText(), /142[.,]54/); // Existing inverse ceiling, including future reserve.
    await ceiling.locator("summary").click();
    assert.doesNotMatch(
      text,
      /Nothing we trust|cannot confirm enough|Fits your budget|Estimated spending/,
    );
    assert.match(
      text,
      locale === "en" ? /Total incomplete/ : /Totali i paplotë/,
    );
    assert.equal(
      await page.locator('.results-empty[data-state="empty"]').count(),
      0,
    );
    await noOverflow();
    await page.screenshot({
      path: `/tmp/goeksplo-ux2-vienna-${locale}-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    // Every field edits inside one sheet; Escape restores focus to its trigger.
    const edit = page.locator(".results-search-summary > button");
    await edit.click();
    for (const i of [0, 1, 2, 3, 4]) {
      await page.locator("dialog .search-field").nth(i).click();
      assert.equal(await page.locator("dialog[open]").count(), 1);
      assert.equal(await page.locator(".search-inline-editor").count(), 1);
      await noOverflow();
      await page.locator(".search-inline-editor button").last().click();
    }
    await page.keyboard.press("Escape");
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(
      await edit.evaluate((el) => el === document.activeElement),
      true,
    );
    console.log(
      `PASS ${stage}: destination, known costs, real ceiling, all five fields in one sheet`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  stage = "filter state and true empty";
  await page.goto(
    search("VIE", {
      budget: "2000",
      currency: "CHF",
      flex: "1",
      car: "1",
      luggage: "1",
      family: "1",
      stay: "comfort",
    }),
  );
  const beforeFilter = new URL(page.url()).searchParams;
  const nearby = page.getByRole("button", {
    name: "Nearby airports",
    exact: true,
  });
  assert.equal(await nearby.getAttribute("aria-pressed"), "false");
  await nearby.click();
  await page.waitForURL((u) => u.searchParams.get("airports") === "1");
  for (const key of [
    "origin",
    "budget",
    "currency",
    "adults",
    "children",
    "start",
    "end",
    "nights",
    "flex",
    "car",
    "luggage",
    "family",
    "stay",
  ])
    assert.equal(
      new URL(page.url()).searchParams.get(key),
      beforeFilter.get(key),
      `filter preserves ${key}`,
    );
  assert.deepEqual(
    JSON.parse(new URL(page.url()).searchParams.get("toPlace")),
    JSON.parse(beforeFilter.get("toPlace")),
    "filter preserves destination identity",
  );
  await page.getByRole("button", { name: "Beach", exact: true }).click();
  await page.waitForURL((u) => u.searchParams.get("styles") === "beach");
  await page.locator(".results-empty").waitFor();
  assert.equal(await page.locator(".trip-card").count(), 0);
  assert.match(
    await page.locator(".results-empty").innerText(),
    /useful match/,
  );
  assert.equal(
    await page
      .locator(".results-empty")
      .getByRole("link", { name: /Explore anywhere/ })
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator(".results-empty")
      .getByRole("link", { name: /Raise/ })
      .count(),
    0,
  );
  await noOverflow();
  console.log(
    "PASS filters preserve request, nearby opt-in, true empty has valid alternatives and no invented prices",
  );

  stage = "slightly over budget hidden by default";
  await page.goto(search("VIE", { origin: "zurich", budget: "550" }));
  await page.locator(".over-toggle").waitFor();
  assert.equal(await page.locator(".trip-card").count(), 0);
  assert.equal(
    await page.locator(".over-toggle").getAttribute("aria-expanded"),
    "false",
  );
  assert.match(await page.locator(".results-comparison").innerText(), /550/);
  assert.match(await page.locator(".results-comparison").innerText(), /589.60/);
  await page.locator(".over-toggle").click();
  assert.equal(await page.locator("#over-budget-trips .trip-card").count(), 1);
  assert.match(
    await page.locator(".result-price").innerText(),
    /€39.60 Over budget/,
  );
  assert.equal(await page.locator(".result-balance b").innerText(), "€39.60");
  await page.locator(".over-toggle").click();
  assert.equal(await page.locator(".trip-card").count(), 0);
  await page.goto(search("VIE", { origin: "zurich", budget: "500" }));
  await page.locator(".results-empty").waitFor();
  assert.equal(
    await page.locator(".over-toggle").count(),
    0,
    "more than 15% over cannot be revealed",
  );
  console.log(
    "PASS only <=15% over-budget results can be revealed; budget, cheapest and excess remain accurate",
  );
  const sitemap = await (
    await page.request.get(origin + "/sitemap.xml")
  ).text();
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 2);
  assert.deepEqual(errors, [], "client errors");
  assert.deepEqual(forbidden, [], "unexpected AI calls");
  console.log(
    "PASS pricing integrity, sparse SEO sitemap and no browser errors at 1440px and 390px",
  );
} catch (error) {
  console.error(
    `FAIL ${stage}: ${String(error?.message ?? "browser failure")
      .replace(/https?:\/\/\S+/g, "[URL]")
      .split("\n")[0]
      .slice(0, 200)}`,
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
