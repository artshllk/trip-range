/** Homepage acceptance; deterministic autocomplete fixtures, no booking actions. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3112";
const output =
  process.env.VERIFY_SCREENSHOTS || "docs/verification/homepage-redesign";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reports = [];
const location = (id, type, name, code, countryCode = "CH") => ({
  id,
  type,
  name,
  countryCode,
  countryName: {
    en: countryCode === "CH" ? "Switzerland" : "United Kingdom",
    sq: "Country",
  },
  ...(type === "airport"
    ? { airportIata: code, cityCode: code }
    : { cityCode: code }),
  coordinates: { latitude: 47.45, longitude: 8.56 },
});
const zurich = location("airport:ZRH", "airport", "Zurich Airport", "ZRH");
const london = location("city:LON", "city", "London", "LON", "GB");
let stage = "startup";
try {
  for (const width of [1440, 390, 375, 360, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 1440 ? 900 : 844 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(12000);
    const errors = [];
    let aiCalls = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/ai/")) aiCalls++;
    });
    await page.route("**/api/locations?**", (route) =>
      route.fulfill({
        json: {
          status: "available",
          locations: new URL(route.request().url()).searchParams
            .get("q")
            .toLowerCase()
            .includes("lon")
            ? [london]
            : [location("zurich", "city", "Zurich", "ZRH"), zurich],
        },
      }),
    );
    await page.route("**/_vercel/insights/**", (route) =>
      route.fulfill({ status: 200, body: "" }),
    );
    const field = (name) => page.locator(`[data-field=${name}]`);
    const dialog = () => page.locator(".home-field-editor[open]");
    const open = async (name) => {
      await field(name).click();
      await dialog().waitFor();
    };
    const apply = async () => {
      await dialog()
        .getByRole("button", { name: "Apply", exact: true })
        .click();
      await dialog().waitFor({ state: "detached" });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    };
    const cancel = async () => {
      await dialog()
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await dialog().waitFor({ state: "detached" });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    };
    const param = async (key, value) => {
      await page.waitForFunction(
        ([k, v]) => new URL(location.href).searchParams.get(k) === v,
        [key, value],
      );
    };
    const layout = async () => {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        "horizontal overflow",
      );
      if (await dialog().count())
        assert.ok(
          await dialog().evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.x >= 0 &&
              r.right <= innerWidth + 1 &&
              r.top >= 0 &&
              r.bottom <= innerHeight + 1
            );
          }),
          `editor fits viewport: ${JSON.stringify(await dialog().boundingBox())}`,
        );
    };
    stage = `${width}: initial, metadata and layout`;
    await page.goto(`${origin}/`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".hero-media img").evaluate((el) => el.decode());
    // Wait for hydration by opening and dismissing a field.
    await open("budget");
    await cancel();
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(
      await page.locator("link[rel=canonical]").getAttribute("href"),
      "https://www.trip-range.com/",
    );
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator(".search-submit").isDisabled(), true);
    assert.equal(await page.locator(".ai-trigger").count(), 0);
    assert.deepEqual(
      await page
        .locator(".search-field")
        .evaluateAll((es) => es.map((e) => e.dataset.field)),
      ["budget", "from", "dates", "travelers", "to"],
    );
    await layout();
    await page.keyboard.press("Tab");
    await field("budget").focus();
    await page.keyboard.press("Enter");
    await dialog().waitFor();
    assert.equal(
      await dialog().evaluate((el) => el.contains(document.activeElement)),
      true,
    );
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "detached" });
    assert.equal(
      await field("budget").evaluate((el) => el === document.activeElement),
      true,
    );
    // Load lazy images for consistent screenshots.
    for (const img of await page.locator(".home-guide img").all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate((el) => el.decode());
    }
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.screenshot({
      path: `${output}/implemented-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({ path: `${output}/implemented-hero-${width}.png` });
    stage = `${width}: budget transaction, validation and currency`;
    await open("budget");
    await dialog().locator("input[type=number]").fill("0");
    assert.equal(
      await dialog()
        .getByRole("button", { name: "Apply", exact: true })
        .isDisabled(),
      true,
    );
    await dialog().locator("input[type=number]").fill("731");
    await dialog().locator("select").selectOption("GBP");
    await cancel();
    assert.match(await field("budget").innerText(), /€500/);
    await open("budget");
    await dialog().locator("input[type=number]").fill("731");
    await dialog().locator("select").selectOption("GBP");
    await apply();
    await param("budget", "731");
    await param("currency", "GBP");
    await open("budget");
    await dialog().locator("input[type=number]").fill("800");
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "detached" });
    assert.match(await field("budget").innerText(), /731/);
    await open("budget");
    if (width === 1440) {
      await field("budget").click();
      await dialog().waitFor({ state: "detached" });
      await open("budget");
    }
    if (width === 320) {
      await page.setViewportSize({ width, height: 480 });
      await dialog().evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await layout();
      assert.ok(
        await dialog().evaluate(
          (el) => el.scrollHeight > el.clientHeight && el.scrollTop > 0,
        ),
        "short mobile sheet scrolls",
      );
      await page.setViewportSize({ width, height: 844 });
      await dialog().evaluate((el) => {
        el.scrollTop = 0;
      });
    }
    await layout();
    await page.screenshot({
      path: `${output}/implemented-budget-${width}.png`,
    });
    if (width === 1440) {
      await page.mouse.click(1400, 150);
      await dialog().waitFor({ state: "detached" });
    } else {
      await page.mouse.click(8, 8);
      await dialog().waitFor({ state: "detached" });
    }
    stage = `${width}: origin and autocomplete identity`;
    await open("from");
    await dialog().getByRole("combobox").fill("Zur");
    await dialog().getByRole("option").last().waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await dialog().getByRole("checkbox").uncheck();
    await apply();
    await param("origin", "airport:ZRH");
    assert.equal(
      JSON.parse(new URL(page.url()).searchParams.get("originPlace"))
        .airportIata,
      "ZRH",
    );
    assert.equal(await page.locator(".search-submit").isEnabled(), true);
    // Changing origin follows existing currency rules; explicitly choose GBP again.
    await open("budget");
    await dialog().locator("select").selectOption("GBP");
    await apply();
    stage = `${width}: dates, flexibility, invalid range and weekend mode`;
    await open("dates");
    const start = dialog().locator("input[type=date]").first(),
      end = dialog().locator("input[type=date]").last();
    const min = await start.getAttribute("min");
    const date = new Date(`${min}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 7);
    const from = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 3);
    const to = date.toISOString().slice(0, 10);
    await start.fill(from);
    await end.fill(from);
    assert.equal(
      await dialog()
        .getByRole("button", { name: "Apply", exact: true })
        .isDisabled(),
      true,
    );
    await end.fill(to);
    await dialog()
      .getByRole("button", { name: "Flexible ±3 days", exact: true })
      .click();
    await layout();
    await page.screenshot({ path: `${output}/implemented-dates-${width}.png` });
    await apply();
    await param("flexDays", "3");
    await param("start", from);
    await param("end", to);
    await open("dates");
    await dialog()
      .getByRole("button", { name: /Any weekend/ })
      .click();
    await dialog().locator("input[type=month]").fill(from.slice(0, 7));
    await apply();
    await param("dateMode", "weekends");
    await open("dates");
    await dialog()
      .getByRole("button", { name: "Exact dates", exact: true })
      .click();
    await apply();
    await param("start", from);
    stage = `${width}: travellers limits and warning`;
    await open("travelers");
    await dialog().getByLabel("Adults", { exact: true }).fill("8");
    await dialog().getByLabel("Children", { exact: true }).fill("6");
    await dialog().locator(".traveller-handoff-warning").waitFor();
    await dialog().getByLabel("Adults", { exact: true }).fill("9");
    assert.equal(
      await dialog().getByLabel("Adults", { exact: true }).inputValue(),
      "8",
    );
    await dialog().getByLabel("Adults", { exact: true }).fill("3");
    await dialog().getByLabel("Children", { exact: true }).fill("1");
    await apply();
    await param("adults", "3");
    await param("children", "1");
    stage = `${width}: destination, styles and persistence`;
    await open("to");
    await dialog().getByRole("combobox").fill("Lon");
    assert.equal(
      await dialog()
        .getByRole("button", { name: "Apply", exact: true })
        .isDisabled(),
      true,
    );
    await dialog().getByRole("option").first().waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await apply();
    assert.equal(
      JSON.parse(new URL(page.url()).searchParams.get("toPlace")).cityCode,
      "LON",
    );
    await page.getByRole("button", { name: /City breaks/ }).click();
    await param("styles", "city");
    await page.getByRole("button", { name: /Outdoors/ }).click();
    await param("styles", "city,nature");
    const saved = new URL(page.url()).search;
    await page.reload();
    await field("budget").waitFor();
    assert.match(await field("budget").innerText(), /731/);
    assert.match(await field("to").innerText(), /London/);
    assert.match(await field("travelers").innerText(), /4 people/);
    assert.equal(
      await page
        .getByRole("button", { name: /City breaks/ })
        .getAttribute("aria-pressed"),
      "true",
    );
    stage = `${width}: navigation menu and currency`;
    if (width < 900) {
      await page.locator(".mobile-menu-trigger").click();
      await page.locator(".home-menu[open]").waitFor();
      await page.screenshot({
        path: `${output}/implemented-menu-${width}.png`,
      });
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(
            () => !!document.activeElement?.closest("dialog"),
          ),
          true,
          "mobile focus trapped",
        );
      }
      await page.getByRole("radio", { name: "USD", exact: true }).check();
      await page.keyboard.press("Escape");
      await page.locator(".home-menu").waitFor({ state: "detached" });
    } else {
      await page
        .getByRole("button", { name: "Currency: GBP", exact: true })
        .click();
      await page.getByRole("radio", { name: "USD", exact: true }).check();
      await page.keyboard.press("Escape");
      await page.locator(".header-dialog").waitFor({ state: "detached" });
    }
    await param("currency", "USD");
    await param("budget", "731");
    await page.reload();
    assert.match(await field("budget").innerText(), /731/);
    assert.equal(new URL(page.url()).searchParams.get("currency"), "USD");
    stage = `${width}: guide links, Back and To prefilling`;
    const guide = page.getByRole("link", {
      name: "Read Vienna guide",
      exact: true,
    });
    const guideHref = await guide.getAttribute("href");
    assert.equal(new URL(guideHref, origin).searchParams.get("budget"), "731");
    await guide.click();
    await page.waitForURL((u) => u.pathname === "/destinations/vienna");
    await page.goBack();
    await page.waitForURL((u) => u.pathname === "/");
    assert.match(await field("budget").innerText(), /731/);
    const tripLink = page
      .getByRole("link", { name: "Trips to Vienna", exact: false })
      .first();
    await tripLink.click();
    await page.waitForFunction(
      () =>
        JSON.parse(new URL(location.href).searchParams.get("toPlace"))
          .cityCode === "VIE",
    );
    assert.match(await field("to").innerText(), /Vienna/);
    await open("to");
    await dialog()
      .getByRole("button", { name: "Anywhere", exact: true })
      .click();
    await apply();
    assert.equal(new URL(page.url()).searchParams.has("toPlace"), false);
    await layout();
    assert.equal(aiCalls, 0);
    assert.deepEqual(errors, []);
    reports.push({
      width,
      status: "passed",
      checks: [
        "layout",
        "keyboard",
        "apply/cancel",
        "budget/currency",
        "airport identity",
        "dates/flex/weekends",
        "traveller limits",
        "destination validation",
        "styles",
        "reload/Back",
        "menu focus",
        "guide links",
      ],
      savedSearch: saved,
    });
    console.log(`PASS ${width}px: all homepage checks`);
    await page.close();
  }
  writeFileSync(
    `${output}/functional-results.json`,
    JSON.stringify(reports, null, 2) + "\n",
  );
} catch (error) {
  console.error(`FAIL ${stage}\n${error.stack}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
