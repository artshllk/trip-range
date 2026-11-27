/** Local production layout checks; serve-results-v2-fixture.mjs blocks live providers. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const phase = process.argv[2] || "after";
assert.ok(["before", "after"].includes(phase));
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const out = "docs/verification/trip-detail-final-ux";
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
const cases = {
  incomplete: ["vienna", {}],
  priced: ["vienna", { start: "2027-01-20", end: "2027-01-22" }],
  transfer: [
    "place:Q41858",
    {
      start: "2027-01-20",
      end: "2027-01-22",
      styles: "",
      budget: "3000",
    },
  ],
};
const browser = await chromium.launch();
const reports = [];
try {
  for (const [state, [id, extra]] of Object.entries(cases)) {
    for (const width of [1440, 390, 375, 360, 320]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 1440 ? 900 : 844 },
        reducedMotion: "reduce",
      });
      const errors = [],
        affiliate = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/affiliate/flights", async (route) => {
        affiliate.push(route.request().postDataJSON());
        await new Promise((resolve) => setTimeout(resolve, 300));
        await route.fulfill({ status: 503, json: { status: "unavailable" } });
      });
      await page.addInitScript(() => {
        window.qaCLS = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (!entry.hadRecentInput) window.qaCLS += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(
        `${origin}/plan/trips/${encodeURIComponent(id)}?${new URLSearchParams({ ...base, ...extra })}`,
      );
      await page
        .getByRole("button", { name: "Edit search", exact: true })
        .waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const report = await page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const { top, bottom, left, right, height } =
            element.getBoundingClientRect();
          return { top, bottom, left, right, height };
        };
        const selectors = [
          ".trip-detail-heading",
          ".trip-budget",
          ".trip-content-intro",
          ".trip-detail-media",
        ];
        const nodes = selectors
          .map((s) => document.querySelector(s))
          .filter(Boolean);
        const image = document.querySelector(".trip-detail-media img");
        return {
          width: innerWidth,
          height: innerHeight,
          cls: window.qaCLS,
          overflow: document.documentElement.scrollWidth > innerWidth,
          header: rect(".site-header"),
          cta: rect(".affiliate-action button"),
          sections: Object.fromEntries(selectors.map((s) => [s, rect(s)])),
          readingOrder: nodes.every(
            (node, i) =>
              !i ||
              !!(
                nodes[i - 1].compareDocumentPosition(node) &
                Node.DOCUMENT_POSITION_FOLLOWING
              ),
          ),
          navPosition: getComputedStyle(
            document.querySelector(".trip-section-nav"),
          ).position,
          image: image
            ? {
                src: image.currentSrc,
                alt: image.alt,
                sizes: image.sizes,
                loaded: image.complete && image.naturalWidth > 0,
              }
            : null,
          resources: performance.getEntriesByType("resource").map((r) => ({
            name: r.name,
            bytes: r.encodedBodySize,
            type: r.initiatorType,
          })),
        };
      });
      report.state = state;
      assert.equal(report.overflow, false);
      assert.equal(await page.locator(".affiliate-action button").count(), 1);
      assert.match(
        await page.locator('meta[name="robots"]').getAttribute("content"),
        /noindex/,
      );
      if (state !== "priced") {
        assert.equal(
          await page.locator(".result-total-unknown").innerText(),
          "Trip total not yet known",
        );
        assert.equal(
          await page
            .locator(".trip-budget .fit,.trip-budget .result-balance")
            .count(),
          0,
        );
      } else
        assert.equal(await page.locator(".result-price-complete").count(), 1);
      if (state === "transfer")
        assert.match(await page.locator(".trip-budget").innerText(), /YYC/);
      assert.equal(affiliate.length, 0);
      if (phase === "after") {
        assert.equal(
          report.readingOrder,
          true,
          `${state}/${width} DOM reading order`,
        );
        if (width < 900) {
          assert.equal(report.navPosition, "static");
          assert.ok(
            report.cta.top >= 68 && report.cta.bottom <= 844,
            `${state}/${width} CTA outside first viewport`,
          );
          const boxes = Object.values(report.sections).filter(Boolean);
          for (let i = 1; i < boxes.length; i++)
            assert.ok(
              boxes[i].top >= boxes[i - 1].bottom - 1,
              `${state}/${width} visual order`,
            );
        }
      }
      if ([1440, 390, 320].includes(width)) {
        await page.screenshot({
          path: `${out}/${phase}-${state}-${width}.png`,
        });
        if (width !== 1440 && state === "incomplete")
          await page.screenshot({
            path: `${out}/${phase}-full-${width}.png`,
            fullPage: true,
          });
      }
      if (width === 1440) {
        await page.evaluate(() => scrollTo(0, 1500));
        const sticky = await page.evaluate(() => {
          const nav = document.querySelector(".trip-section-nav");
          const a = nav.querySelector("a"),
            r = a.getBoundingClientRect();
          return {
            top: nav.getBoundingClientRect().top,
            bottom: nav.getBoundingClientRect().bottom,
            clickable: a.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            ),
          };
        });
        report.sticky = sticky;
        if (state === "incomplete")
          await page.screenshot({ path: `${out}/${phase}-sticky-1440.png` });
        if (phase === "after") {
          assert.equal(sticky.top, report.header.bottom);
          assert.equal(sticky.clickable, true);
          report.anchors = [];
          for (const link of await page.locator(".trip-section-nav a").all()) {
            const href = await link.getAttribute("href");
            await link.click();
            const top = await page
              .locator(href)
              .evaluate((e) => e.getBoundingClientRect().top);
            assert.ok(
              top >= sticky.bottom,
              `${href} obscured by sticky navigation`,
            );
            report.anchors.push({ href, top });
          }
        }
      }
      if (phase === "after" && width === 390) {
        await page.locator(".affiliate-action button").focus();
        await page.keyboard.press("Tab");
        assert.equal(
          await page
            .locator("#price-details > summary")
            .evaluate((e) => e === document.activeElement),
          true,
        );
        if (report.image) {
          assert.equal(report.image.loaded, true);
          assert.ok(report.image.alt);
          await page.keyboard.press("Tab");
          assert.equal(
            await page
              .locator(".trip-photo-credit > summary")
              .evaluate((e) => e === document.activeElement),
            true,
          );
          await page.keyboard.press("Enter");
          assert.equal(
            (await page.locator(".trip-photo-credit[open] a").count()) > 0,
            true,
          );
          if (state === "incomplete")
            await page.screenshot({
              path: `${out}/after-photo-credits-390.png`,
            });
          await page.keyboard.press("Enter");
        }
        writeFileSync(
          `${out}/${state}-accessibility.txt`,
          await page.locator(".trip-overview").ariaSnapshot(),
        );
        const cta = page.locator(".affiliate-action button");
        await cta.click();
        assert.equal(await cta.isDisabled(), true);
        await page
          .getByRole("status")
          .filter({ hasText: /unavailable|try again/i })
          .waitFor();
        assert.equal(affiliate.length, 1);
        assert.equal(await cta.isDisabled(), false);
        report.affiliate = affiliate[0];
        assert.deepEqual(report.affiliate, {
          route: {
            originCode: "ZRH",
            destinationCode: state === "transfer" ? "YYC" : "VIE",
            departureDate: extra.start || base.start,
            returnDate: extra.end || base.end,
            party: { adults: 2, children: 0 },
          },
          placement: "trip",
        });
        // Exercise a successful explicit retry without contacting an affiliate.
        const handoff = `${origin}/__qa-affiliate-handoff`;
        await page.unroute("**/api/affiliate/flights");
        await page.route("**/api/affiliate/flights", (route) => {
          assert.deepEqual(route.request().postDataJSON(), report.affiliate);
          return route.fulfill({
            json: { status: "available", link: { url: handoff } },
          });
        });
        await page.route(handoff, (route) =>
          route.fulfill({
            contentType: "text/html",
            body: "Local handoff verified",
          }),
        );
        await cta.click();
        await page.waitForURL(handoff);
        report.explicitRetryHandoff = true;
      }
      assert.deepEqual(errors, []);
      reports.push(report);
      await page.close();
    }
  }
  writeFileSync(`${out}/${phase}.json`, JSON.stringify(reports, null, 2));
  console.log(
    JSON.stringify({ phase, cases: reports.length, status: "passed" }),
  );
} finally {
  await browser.close();
}
