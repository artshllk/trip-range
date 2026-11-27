/** Local browser QA. External/paid operations are disabled by the chosen server configuration. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3110";
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
  page.setDefaultTimeout(15000);
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "/* local analytics stub */",
    }),
  );
  const errors = [];
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("console", (m) => {
    if (/content security policy|violates.*directive/i.test(m.text()))
      errors.push("csp");
  });
  const overflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "horizontal overflow",
    );
  const metrics = [];
  for (const [name, path] of [
    ["home", "/"],
    ["results", "/plan/results?scope=domestic&budget=300"],
    ["detail", "/plan/trips/prizren?scope=domestic&budget=300"],
  ]) {
    stage = name;
    await page.goto(origin + path);
    await page.locator("main").waitFor();
    await overflow();
    metrics.push(
      await page.evaluate((name) => {
        const n = performance.getEntriesByType("navigation")[0];
        const scripts = performance
          .getEntriesByType("resource")
          .filter((r) => r.initiatorType === "script");
        return {
          page: name,
          ttfbMs: Math.round(n.responseStart),
          domLoadedMs: Math.round(n.domContentLoadedEventEnd),
          htmlBytes: n.decodedBodySize,
          scriptBytes: scripts.reduce((sum, r) => sum + r.decodedBodySize, 0),
        };
      }, name),
    );
  }
  console.log(JSON.stringify({ localWarmCacheMetrics: metrics }));
  stage = "detail edit and focus";
  const edit = page.getByRole("button", { name: "Edit search", exact: true });
  await edit.click();
  stage = "detail sheet opened";
  assert.equal(await page.locator("dialog[open]").count(), 1);
  await page.locator("dialog .search-field").first().click();
  assert.equal(await page.locator("dialog[open]").count(), 1);
  stage = "detail origin editor";
  const input = page.locator('dialog input[role="combobox"]');
  await input.fill(
    "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch",
  );
  await overflow();
  assert.ok(await input.getAttribute("aria-controls"));
  stage = "detail close origin";
  await input.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.equal(await edit.evaluate((e) => e === document.activeElement), true);
  stage = "mobile";
  for (const width of [1440, 390, 375, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const locale of ["en"]) {
      await page.goto(`${origin}/${locale}`);
      await overflow();
      assert.equal(
        await page.getByRole("button", { name: /Language:/ }).count(),
        0,
      );
      assert.equal(await page.locator(".language-options").count(), 0);
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      stage = `${width}px ${locale}: budget scope and party boundaries`;
      assert.equal(
        await page
          .locator(".search-field")
          .nth(4)
          .locator("span")
          .textContent(),
        locale === "en" ? "Total trip budget" : "Buxheti total i udhëtimit",
      );
      const budgetNote = page.locator(".search-budget-note");
      assert.equal(
        await budgetNote.innerText(),
        locale === "en"
          ? "For everyone travelling, for the whole trip."
          : "Për të gjithë udhëtarët, për gjithë udhëtimin.",
      );
      assert.ok((await budgetNote.boundingBox()).height <= 60);
      await page.locator(".search-field").nth(3).click();
      for (const [adults, children] of [
        [8, 1],
        [8, 2],
        [4, 6],
        [3, 6],
      ]) {
        await page
          .locator('dialog input[type="number"]')
          .nth(0)
          .fill(String(adults));
        await page
          .locator('dialog input[type="number"]')
          .nth(1)
          .fill(String(children));
        const warning = page.locator(".traveller-handoff-warning");
        if (adults + children > 9) {
          await warning.waitFor();
          assert.equal(
            await warning.innerText(),
            locale === "en"
              ? "For groups over nine, flight booking links may be unavailable. Planning still includes everyone."
              : "Për grupe mbi nëntë veta, lidhjet e fluturimeve mund të mungojnë. Planifikimi përfshin të gjithë.",
          );
          assert.ok((await warning.boundingBox()).height <= 120);
        } else assert.equal(await warning.count(), 0);
        assert.equal(
          await page.locator('dialog input[type="number"]').nth(0).inputValue(),
          String(adults),
        );
        assert.equal(
          await page.locator('dialog input[type="number"]').nth(1).inputValue(),
          String(children),
        );
        await overflow();
      }
      // A large party remains plannable and travels unchanged in the actual search URL.
      await page.locator('dialog input[type="number"]').nth(0).fill("4");
      await page.locator('dialog input[type="number"]').nth(1).fill("6");
      await page.screenshot({
        path: `/tmp/goeksplo-party-${width}-${locale}.png`,
      });
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
      assert.equal(await page.locator(".search-submit").isEnabled(), true);
      await page.locator(".search-submit").click();
      await page.waitForURL((u) => u.pathname.endsWith("/plan/results"));
      const partyQuery = new URL(page.url()).searchParams;
      assert.equal(partyQuery.get("adults"), "4");
      assert.equal(partyQuery.get("children"), "6");
      assert.equal(partyQuery.get("budget"), "500");
      await page.goto(`${origin}/${locale}`);
      stage = "mobile";
      await page.locator(".ai-trigger").click();
      await page
        .locator("textarea")
        .fill("I have 700 euros for two adults from Zurich next weekend.");
      await page.locator(".ai-search-panel button.button").click();
      await page.locator('.ai-search-panel [role="alert"]').waitFor();
      assert.match(
        await page.locator('.ai-search-panel [role="alert"]').innerText(),
        locale === "en" ? /normal search/ : /kërkimin e zakonshëm/,
      );
      await overflow();
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
      await page.locator(".search-field").nth(2).click();
      await overflow();
      assert.equal(await page.locator("dialog[open]").count(), 1);
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
      await page.goto(
        `${origin}/${locale}/plan/results?scope=domestic&budget=300`,
      );
      await page.locator(".trip-card").first().waitFor();
      await overflow();
      await page.goto(
        `${origin}/${locale}/plan/trips/prizren?scope=domestic&budget=300`,
      );
      await overflow();
      await page.locator(".trip-search-summary button").click();
      await overflow();
      await page.locator("dialog .search-field").first().click();
      await page
        .locator('dialog input[role="combobox"]')
        .fill("Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch");
      await overflow();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
    }
    await page.screenshot({
      path: `/tmp/goeksplo-launch-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  stage = "localized collection booking FAQs";
  for (const [locale, path] of [
    ["en", "/from/prishtina/weekend-trips/under-300"],
  ]) {
    await page.goto(origin + path);
    const faq = page.locator("#faq details").filter({
      hasText:
        locale === "en" ? "Can I book here?" : "A mund të rezervoj këtu?",
    });
    await faq.locator("summary").click();
    const answer = await faq.locator("p").innerText();
    assert.match(
      answer,
      locale === "en" ? /external provider search/ : /ofrues i jashtëm/,
    );
    assert.match(
      answer,
      locale === "en"
        ? /verify current fares and availability/
        : /kontrollosh tarifat dhe disponueshmërinë aktuale/,
    );
    assert.match(
      answer,
      locale === "en"
        ? /not be available for every result/
        : /mund të mungojnë për disa rezultate/,
    );
    assert.match(
      answer,
      locale === "en"
        ? /not confirmed booking offers/
        : /nuk janë oferta të konfirmuara/,
    );
    assert.doesNotMatch(answer, /not connected|nuk janë aktive/);
    await overflow();
  }
  stage = "flight handoff failure";
  const to = encodeURIComponent(
    JSON.stringify({
      id: "city:VIE",
      type: "city",
      name: "Vienna",
      cityCode: "VIE",
      countryCode: "AT",
      countryName: { en: "Austria", sq: "Austria" },
    }),
  );
  const departureDate = new Date(Date.now() + 14 * 86400000)
    .toISOString()
    .slice(0, 10);
  const returnDate = new Date(Date.now() + 16 * 86400000)
    .toISOString()
    .slice(0, 10);
  await page.goto(
    `${origin}/plan/trips/city%3AVIE?origin=zurich&budget=2000&adults=2&children=1&start=${departureDate}&end=${returnDate}&toPlace=${to}`,
  );
  await overflow();
  const partial = page.locator(".trip-unpriced-summary");
  await partial.waitFor();
  const knownCosts = await partial.locator(".result-partial").innerText();
  assert.match(knownCosts, /≈\s*CHF\s*[\d,.]+/);
  const assertPartialPricing = async () => {
    assert.match(await partial.innerText(), /Total incomplete/);
    assert.match(
      await partial.innerText(),
      /Estimated costs excluding flights/,
    );
    const disclosure = partial.locator(".flight-budget-disclosure");
    assert.equal(await disclosure.getAttribute("open"), null);
    await disclosure.locator("summary").click();
    assert.match(
      await disclosure.innerText(),
      /Budget ceiling, not a fare estimate\./,
    );
    await disclosure.locator("summary").click();
    assert.equal(await partial.locator(".total").count(), 0);
    assert.equal(
      await partial.locator(".result-partial").innerText(),
      knownCosts,
    );
    assert.equal(
      await page.locator(".trip-budget-main .result-price").count(),
      0,
    );
    assert.equal(await page.locator(".budget-bar").count(), 0);
    const main = await page.locator("main").innerText();
    assert.doesNotMatch(
      main,
      /Estimated spending|Budget needed|Money left|left after (?:buffer|safety reserve)/,
    );
    await page.locator("#price-details > summary").click();
    const rows = await page.locator(".cost-rows").innerText();
    assert.doesNotMatch(
      rows,
      /Estimated spending|Reserve kept aside|Budget needed|Money left/,
    );
    await page.locator("#price-details > summary").click();
    // Any reference fare belongs outside the current partial-cost summary.
    for (const reference of await page.locator(".trip-reference").all()) {
      assert.match(
        await reference.innerText(),
        /reference only, not this trip’s price/,
      );
      assert.equal(await partial.locator(".trip-reference").count(), 0);
    }
  };
  await assertPartialPricing();
  let handoff;
  await page.route("**/api/affiliate/flights", (route) => {
    handoff = route.request().postDataJSON();
    return route.fulfill({ status: 503, json: { status: "unavailable" } });
  });
  await page
    .getByRole("button", { name: /Check (?:current )?flights on Aviasales/ })
    .click();
  await page.getByRole("button", { name: /Retry flight search/ }).waitFor();
  assert.equal(handoff.route.originCode, "ZRH");
  assert.equal(handoff.route.destinationCode, "VIE");
  assert.equal(handoff.route.departureDate, departureDate);
  assert.equal(handoff.route.returnDate, returnDate);
  assert.deepEqual(handoff.route.party, { adults: 2, children: 1 });
  assert.equal(handoff.placement, "trip");
  assert.match(
    await page.locator(".affiliate-action [role='status']").innerText(),
    /Your trip estimate is still here/,
  );
  await assertPartialPricing();
  await overflow();
  stage = "keyboard and desktop";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("href")),
    "#main",
  );
  await page.screenshot({
    path: "/tmp/goeksplo-launch-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.deepEqual(
    errors,
    [],
    "browser errors/CSP violations (content withheld)",
  );
  console.log(
    "PASS Chromium desktop, 390/375/360/320 English, nine/ten-person warnings and preserved search counts, total-trip budget copy, booking FAQs, calendar, AI unavailable fallback, long city, single modal, focus restoration, reduced motion, preserved family affiliate payload and safe failure, no overflow or CSP violations",
  );
} catch (e) {
  console.error(
    `FAIL ${stage}: ${
      e instanceof assert.AssertionError
        ? e.message.split("\n")[0]
        : String(e?.message ?? "browser interaction failed")
            .split("\n")[0]
            .slice(0, 150)
    }`,
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
