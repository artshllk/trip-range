/** Production QA plus an isolated component harness. Synthetic full baskets never enter application routes. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const {
  renderCostBrowserFixture,
} = require("../.test-build/tests/render-cost-browser-fixture.js");
// Production CSS, real component, synthetic domain fixture, loopback only. No provider/environment bypass.
const css = readdirSync(".next/static", { recursive: true })
  .filter((p) => typeof p === "string" && p.endsWith(".css"))
  .map((p) => readFileSync(resolve(".next/static", p), "utf8"))
  .join("\n");
assert.ok(css.length > 1000, "build CSS required");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3113";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const fixtureServer = createServer((request, response) => {
  const match = /^\/(en|sq)\/(full|unpriced)$/.exec(request.url || "");
  if (!match) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  response.end(
    renderCostBrowserFixture(match[1], match[2] === "unpriced", css),
  );
});
fixtureServer.listen(0, "127.0.0.1");
await once(fixtureServer, "listening");
const fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
let browser;
let stage = "setup";
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE
      ? { executablePath: process.env.CHROME_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", () => errors.push(stage));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(stage);
  });
  page.on("request", (r) => {
    if (/\/api\/ai\/|api.openai.com/.test(r.url()))
      errors.push("unexpected-ai");
  });
  await page.route("**/_vercel/insights/script.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "/* local analytics stub */",
    }),
  );
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "horizontal overflow",
    );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.emulateMedia({
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    for (const scenario of [
      "reviewed-component",
      "generic",
      "unpriced",
      "sq-reviewed",
    ]) {
      stage = `${width}px ${scenario}`;
      const generic = scenario === "generic",
        sq = scenario === "sq-reviewed";
      const query = new URLSearchParams({
        origin: "prishtina",
        budget: generic ? "2000" : "600",
        currency: "EUR",
        adults: "2",
        children: "0",
        when: "custom",
        nights: generic ? "3" : "2",
        flex: "0",
        start:
          scenario === "unpriced"
            ? "2026-11-21"
            : generic
              ? "2026-11-20"
              : "2026-11-14",
        end:
          scenario === "unpriced"
            ? "2026-11-23"
            : generic
              ? "2026-11-23"
              : "2026-11-16",
        toPlace: JSON.stringify({
          id: generic ? "city:VIE" : "city:MIL",
          type: "city",
          name: generic ? "Vienna" : "Milan",
          cityCode: generic ? "VIE" : "MIL",
          iataCodes: [generic ? "VIE" : "MIL"],
          countryCode: generic ? "AT" : "IT",
          countryName: {
            en: generic ? "Austria" : "Italy",
            sq: generic ? "Austri" : "Itali",
          },
        }),
      });
      await page.goto(`${origin}/${sq ? "sq" : "en"}/plan/results?${query}`);
      const card = page.locator(".trip-card").first();
      await card.waitFor();
      assert.equal(
        await card.locator(".cost-provenance").isVisible(),
        false,
        "cost provenance stays behind Price details",
      );
      await noOverflow();
      await card.locator("a.button").click();
      await page.locator("#trip-sources > summary").click();
      const provenance = page.locator(".cost-provenance");
      await provenance.waitFor();
      if (generic)
        assert.match(
          await provenance.innerText(),
          /general or earlier planning estimates/,
        );
      else if (sq)
        assert.match(
          await provenance.innerText(),
          /Disa kosto të destinacionit janë rishikuar/,
        );
      else
        assert.match(
          await provenance.innerText(),
          /Some destination costs were reviewed/,
        );
      await provenance.locator("summary").click();
      if (!generic && !sq) {
        assert.match(
          await provenance.innerText(),
          /Local transport · Reviewed destination estimate/,
        );
        assert.match(await provenance.innerText(), /ATM three-day/);
        assert.match(
          await provenance.innerText(),
          /Destination airport transfer · General planning estimate/,
        );
        assert.match(
          await provenance.innerText(),
          /journey to the departure airport is excluded/,
        );
      }
      await page.locator("#price-details > summary").click();
      const rows = await page.locator("#price-details .cost-rows").innerText();
      if (!generic && !sq) assert.match(rows, /€61/); // €31 local reviewed + €30 generic arrival.
      if (scenario === "unpriced") {
        const panel = await page.locator(".trip-budget").innerText();
        assert.match(panel, /Estimated costs excluding flights/);
        assert.match(panel, /€323/); // Curated €170 stay; food €72; local/arrival €61; activities €20.
        const ceiling = page.locator(
          ".trip-unpriced-summary .flight-budget-disclosure",
        );
        assert.equal(await ceiling.getAttribute("open"), null);
        await ceiling.locator("summary").click();
        assert.match(await ceiling.innerText(), /≤ €222.45/); // Standard inverse ceiling from €600, not an airfare.
        await ceiling.locator("summary").click();
        assert.doesNotMatch(
          panel,
          /Budget needed|Safety buffer|Reserve kept aside|Fits your budget|left after buffer/,
        );
        assert.match(
          await page.locator(".trip-unpriced-summary").innerText(),
          /Total incomplete/,
        );
      } else if (scenario === "reviewed-component") {
        assert.match(
          await page.locator(".flight-booking").innerText(),
          /€100 · Recent flight data/,
        );
        assert.match(rows, /Stay[\s\S]*≈/);
      }
      assert.equal(
        await page.locator('meta[name="robots"]').getAttribute("content"),
        "noindex, follow",
      );
      await noOverflow();
      await page.locator(".trip-budget").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/goeksplo-cost-${scenario}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      console.log(
        `PASS ${stage}: provenance, estimate semantics, readable costs and no overflow`,
      );
    }
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const locale of ["en", "sq"])
      for (const kind of ["full", "unpriced"]) {
        stage = `${width}px synthetic-${locale}-${kind}`;
        await page.goto(`${fixtureOrigin}/${locale}/${kind}`);
        const panel = page.locator(".trip-budget");
        const provenance = panel.locator(".cost-provenance");
        assert.match(
          await provenance.innerText(),
          locale === "en"
            ? /Destination costs use a reviewed planning profile/
            : /Kostot e destinacionit përdorin një profil planifikimi të rishikuar/,
        );
        await provenance.locator("summary").click();
        assert.equal(await provenance.locator("li").count(), 5);
        assert.match(
          await provenance.innerText(),
          locale === "en"
            ? /not bookable inventory/
            : /jo inventar për rezervim/,
        );
        assert.match(
          await provenance.innerText(),
          locale === "en"
            ? /Meals are an illustrative planning basket; final costs can differ/
            : /kostot përfundimtare mund të ndryshojnë/,
        );
        assert.equal(await panel.locator(".price-mark.live").count(), 0);
        assert.equal(await panel.locator(".price-mark.estimate").count(), 4);
        assert.equal(
          await panel.locator(".price-mark.recent").count(),
          kind === "full" ? 1 : 0,
        );
        if (kind === "unpriced") {
          assert.match(await panel.innerText(), /349/);
          assert.match(
            await panel.locator(".flight-affordability").innerText(),
            /560[.,]09/,
          );
          assert.doesNotMatch(
            await panel.innerText(),
            /Budget needed|Safety buffer|Reserve kept aside|Fits your budget|Buxheti i nevojshëm|Rezerva e sigurisë|Rezervë e lënë mënjanë/,
          );
        } else {
          assert.match(await panel.innerText(), /389/);
          assert.match(await panel.innerText(), /427[.,]90/);
        }
        await noOverflow();
        await page.screenshot({
          path: `/tmp/goeksplo-cost-synthetic-${locale}-${kind}-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
        console.log(
          `PASS ${stage}: real budget component, all five reviewed estimates, no overflow`,
        );
      }
  }
  assert.deepEqual(errors, [], "client errors or AI calls");
} catch (error) {
  console.error(
    `FAIL ${stage}: ${String(error?.message ?? "browser failure")
      .replace(/https?:\/\/\S+/g, "[URL]")
      .slice(0, 250)}`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => fixtureServer.close(resolve));
}
