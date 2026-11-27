/** Local synthetic provider QA; affiliate requests never leave this browser. */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
(async () => {
  const b = await chromium.launch(),
    o = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162",
    dir = "docs/verification/results-v2";
  assert.match(o, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const base = {
    origin: "zurich",
    budget: "800",
    currency: "EUR",
    start: "2027-01-20",
    end: "2027-01-22",
    adults: "2",
    children: "0",
    when: "custom",
    airports: "0",
  };
  const city = (code, name, country) =>
    JSON.stringify({
      id: `city:${code}`,
      name,
      type: "city",
      cityCode: code,
      iataCodes: [code],
      countryCode: country,
      countryName: { en: country, sq: country },
    });
  let checks = [];
  for (const width of [1440, 390, 320]) {
    const p = await b.newPage({
      viewport: { width, height: 844 },
      hasTouch: width < 900,
      reducedMotion: "reduce",
    });
    const go = async (extra) => {
      await p.goto(
        o + "/plan/results?" + new URLSearchParams({ ...base, ...extra }),
      );
      await p.locator("main").waitFor();
    };
    for (const [name, extra] of Object.entries({
      reference: { toPlace: city("PAR", "Paris", "FR") },
      over: { budget: "420" },
      vienna: {
        toPlace: city("VIE", "Vienna", "AT"),
        start: "2027-02-20",
        end: "2027-02-22",
      },
      long: {
        toPlace: city(
          "XXX",
          "Synthetic City of the Long River and the Northern Mountain Gardens",
          "CH",
        ),
      },
    })) {
      await go(extra);
      if (name === "over") {
        await p
          .getByRole("button", { name: /Show .*trip.*over budget/ })
          .click();
        assert.equal(
          await p.locator("#over-budget-trips .result-balance").count(),
          1,
        );
      }
      if (name === "over")
        assert.equal(
          (await p.locator(".results-count").textContent()).split(" ")[0],
          String(await p.locator(".result-card").count()),
        );
      if (name === "reference") {
        assert.match(
          await p.locator(".result-reference").innerText(),
          /24.*26 Jan 2027/,
        );
        assert.equal(await p.locator(".result-balance").count(), 0);
      }
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        name,
      );
      await p.screenshot({
        path: `${dir}/after-${name}-${width}.png`,
        fullPage: true,
      });
      if (name === "vienna") {
        await p.locator(".result-details > summary").click();
        assert.equal(await p.locator(".result-flight-limit").isVisible(), true);
        await p.screenshot({
          path: `${dir}/after-price-details-${width}.png`,
          fullPage: true,
        });
      }
    }
    // A booking check intercepts only the browser response; never leaves local QA or creates a booking.
    await go({});
    let payload;
    await p.route("**/api/affiliate/flights", (r) => {
      payload = r.request().postDataJSON();
      return r.fulfill({ status: 503, json: { status: "unavailable" } });
    });
    await p
      .locator(".result-card")
      .first()
      .locator(".affiliate-action button")
      .click();
    await p.locator(".affiliate-action [role=status]").first().waitFor();
    assert.equal(payload.placement, "results");
    assert.equal(payload.route.originCode, "ZRH");
    assert.equal(payload.route.destinationCode, "VIE");
    assert.equal(payload.route.departureDate, "2027-01-20");
    assert.equal(payload.route.returnDate, "2027-01-22");
    assert.deepEqual(payload.route.party, { adults: 2, children: 0 });
    if (width < 900) {
      await p.getByRole("button", { name: "Filters", exact: true }).tap();
      const d = p.locator(".results-v2-editor");
      await p.setViewportSize({ width, height: 480 });
      await d.evaluate((e) => (e.scrollTop = e.scrollHeight));
      assert.equal(
        await d.getByRole("button", { name: /Update search/ }).isVisible(),
        true,
      );
      await p.keyboard.press("Escape");
      await d.waitFor({ state: "detached" });
      await p.setViewportSize({ width, height: 844 });
      await p.getByRole("button", { name: "Menu", exact: true }).tap();
      const menu = p.locator(".header-dialog[open]");
      assert.equal(
        await menu
          .locator("a")
          .first()
          .evaluate((e) => getComputedStyle(e).color),
        "rgb(21, 23, 26)",
      );
      await p.screenshot({ path: `${dir}/after-menu-${width}.png` });
      const menuUrl = await menu
        .getByRole("link", { name: "Destinations", exact: true })
        .getAttribute("href");
      assert.equal(new URL(menuUrl, o).searchParams.get("budget"), "800");
      await p.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
    }
    checks.push({
      width,
      status: "passed",
      checks: [
        "reference-only",
        "over-budget reveal",
        "incomplete ceiling disclosure",
        "long destination name",
        "affiliate route and failure recovery",
        "touch and short-viewport sheet scrolling",
      ],
    });
    await p.close();
  }
  fs.writeFileSync(
    dir + "/extra-functional-results.json",
    JSON.stringify(checks, null, 2),
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
