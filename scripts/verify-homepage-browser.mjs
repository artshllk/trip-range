/** Local UX acceptance. All intent responses below are synthetic; no paid AI or bookings. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { parseRequest } = require("../.test-build/src/domain/request.js");
const { referenceCalendarDate } = require("../.test-build/src/domain/dates.js");
const { resultDateRange } = require("../.test-build/src/i18n/result-dates.js");
const aiEnabled = process.env.VERIFY_AI_ENABLED === "true";
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3110";
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-homepage";
mkdirSync(output, { recursive: true });
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "setup";
try {
  for (const width of [1440, 390, 375, 360, 320])
    for (const locale of ["en"]) {
      stage = `${width}px ${locale}`;
      const page = await browser.newPage({
        viewport: { width, height: width === 1440 ? 900 : 844 },
      });
      await page.emulateMedia({
        reducedMotion: width === 1440 ? "no-preference" : "reduce",
      });
      page.setDefaultTimeout(15000);
      const errors = [];
      let intents = 0;
      page.on("pageerror", () => errors.push("pageerror"));
      page.on("console", (m) => {
        if (/content security policy|violates.*directive/i.test(m.text()))
          errors.push("csp");
      });
      page.on("request", (r) => {
        if (r.url().includes("/api/ai/")) intents++;
      });
      await page.route("**/_vercel/insights/script.js", (r) =>
        r.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: "",
        }),
      );
      const visit = async () => {
        await page.goto(`${origin}/${locale}`);
        await page.locator(".home .search-submit").waitFor();
        await page.evaluate(() => document.fonts.ready);
      };
      const noOverflow = async () =>
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          "horizontal overflow",
        );
      const menu = async (kind) => {
        if (width < 720)
          await page.locator(".mobile-menu-trigger:visible").click();
        else
          await page
            .getByRole("button", {
              name:
                kind === "currency"
                  ? `${locale === "en" ? "Currency" : "Monedha"}: ${await page
                      .locator(".header-preferences button")
                      .first()
                      .innerText()
                      .then((t) => t.slice(0, 3))}`
                  : `${locale === "en" ? "Language" : "Gjuha"}: ${locale.toUpperCase()}`,
            })
            .click();
        assert.equal(await page.locator("dialog[open]").count(), 1);
        await noOverflow();
      };
      const close = async () => {
        await page.keyboard.press("Escape");
        await page.locator("dialog").waitFor({ state: "detached" });
      };
      await visit();
      const html = await (await fetch(`${origin}/${locale}`)).text();
      assert.equal(
        (html.match(/<h1\b/g) || []).length,
        1,
        "one server-rendered H1",
      );
      assert.ok(html.includes(`href="https://www.trip-range.com/${locale}"`));
      assert.doesNotMatch(html, /hrefLang=|hreflang=|og:locale:alternate/);
      assert.equal(
        await page.getByRole("button", { name: /Language:/ }).count(),
        0,
      );
      assert.equal(await page.locator(".language-options").count(), 0);
      assert.equal(await page.locator("main h1").count(), 1);
      assert.equal(
        await page
          .locator(".home .budget-panel, .home .budget-bar, .hero-kicker")
          .count(),
        0,
      );
      assert.equal(await page.locator(".destination-card").count(), 4);
      assert.match(
        await page.locator(".discovery-trust").innerText(),
        /total stays incomplete/,
      );
      assert.equal(
        await page.locator(".destination-card .inspiration-price").count(),
        0,
        "Evergreen cards cannot advertise an unpriced trip total",
      );
      assert.equal(
        await page.locator(".search-submit").isDisabled(),
        true,
        "New visitors must choose their origin",
      );
      assert.equal(await page.locator(".home-how li").count(), 3);
      const hero = await page.locator(".hero").boundingBox();
      // Phase 3 adds a real introduction. Preserve the useful fold contract:
      // the primary search action is visible and reviewed discovery follows promptly.
      const viewportHeight = width === 1440 ? 900 : 844;
      const primaryAction = await page.locator(".search-submit").boundingBox();
      assert.ok(
        primaryAction.y + primaryAction.height < viewportHeight - 24,
        "primary search action visible without scrolling",
      );
      assert.ok(
        hero.height <= viewportHeight,
        "initial hero fits the viewport",
      );
      assert.ok(
        (await page.locator("#destinations-title").boundingBox()).y <
          viewportHeight + 96,
        "destination discovery follows within a short scroll",
      );
      assert.equal(intents, 0);
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("href")),
        "#main",
      );
      await noOverflow();
      // Finish lazy images before full-page design captures.
      for (const img of await page.locator("main img").all()) {
        await img.scrollIntoViewIfNeeded();
        await img.evaluate((el) => el.decode().catch(() => {}));
      }
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await page.screenshot({
        path: `${output}/after-${locale}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      stage = `${width}px ${locale} currency controls`;
      // The following searches deliberately choose an origin, rather than relying on a default.
      await page.goto(`${origin}/${locale}?origin=zurich`);
      await page.locator(".search-submit").waitFor();
      // Header controls: all currencies, one focus-trapped layer, unchanged amount.
      for (const currency of ["GBP", "USD", "CHF", "EUR"]) {
        await menu("currency");
        await page.getByRole("radio", { name: currency, exact: true }).check();
        assert.equal(
          await page
            .getByRole("radio", { name: currency, exact: true })
            .isChecked(),
          true,
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(
            () => !!document.activeElement?.closest("dialog"),
          ),
          true,
        );
        await close();
        assert.match(
          await page.locator(".search-field").nth(4).innerText(),
          currency === "GBP"
            ? /£500|500\s*£/
            : currency === "USD"
              ? /\$500|500\s*\$/
              : currency === "CHF"
                ? /CHF\s*500|500\s*CHF/
                : /€500|500\s*€/,
        );
      }
      stage = `${width}px ${locale} structured search`;
      // Unsaved budget survives changing the header currency.
      await page.locator(".search-field").nth(4).click();
      await page.locator('dialog input[type="number"]').fill("731");
      await close();
      await menu("currency");
      await page.getByRole("radio", { name: "GBP", exact: true }).check();
      await close();
      await page.locator(".search-submit").click();
      await page.waitForURL((u) => u.pathname.endsWith("/results"));
      assert.equal(new URL(page.url()).searchParams.get("currency"), "GBP");
      assert.equal(new URL(page.url()).searchParams.get("budget"), "731");
      assert.equal(intents, 0, "ordinary search makes no AI request");
      await menu("currency");
      await page.goBack();
      await page.waitForURL((u) => u.pathname === `/${locale}`);
      await page.locator("dialog").waitFor({ state: "detached" });
      stage = `${width}px legacy language redirect`;
      await page.goto(
        `${origin}/sq?currency=EUR&budget=731&adults=2&children=1`,
      );
      assert.equal(new URL(page.url()).pathname, "/");
      assert.equal(new URL(page.url()).searchParams.get("budget"), "731");
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.equal(
        await page.getByRole("link", { name: "Shqip", exact: true }).count(),
        0,
      );
      await visit();
      if (!aiEnabled) {
        assert.equal(
          await page.locator(".ai-trigger,.ai-search-panel").count(),
          0,
        );
        const denied = await page.evaluate(async () => {
          const r = await fetch("/api/ai/intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: "A quiet weekend",
              locale: "en",
              draft: { origin: "zurich" },
            }),
          });
          return { status: r.status, cache: r.headers.get("cache-control") };
        });
        assert.equal(denied.status, 503);
        assert.equal(denied.cache, "no-store");
        assert.equal(
          intents,
          1,
          "only the explicit disabled-endpoint check; normal search made zero AI calls",
        );
        assert.deepEqual(errors, []);
        console.log(
          `PASS ${width}px: AI OFF, ordinary search, endpoint denial, English routes, no overflow`,
        );
        await page.close();
        continue;
      }
      stage = `${width}px ${locale} AI review`;
      // Expanding AI is local. A ready parse fills editable fields, never navigates automatically.
      await page.locator(".home-ai-trigger").click();
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(intents, 0);
      await noOverflow();
      await page
        .locator("textarea")
        .fill("€600 for two from Prishtina next weekend, somewhere quiet");
      const request = parseRequest(
        {
          origin: "prishtina",
          budget: "600",
          currency: "EUR",
          adults: "2",
          children: "0",
          when: "next-weekend",
          styles: "quiet",
        },
        undefined,
        referenceCalendarDate(new Date()),
      );
      await page.route("**/api/ai/intent", (r) =>
        r.fulfill({
          status: 200,
          json: {
            status: "ready",
            request,
            clarifications: [],
            unsupportedPreferences: [],
          },
        }),
      );
      await page.locator(".ai-search-panel .button").click();
      await page.locator(".home-ai-review").waitFor();
      assert.equal(new URL(page.url()).pathname, `/${locale}`);
      assert.match(
        await page.locator(".search-field").nth(4).innerText(),
        /600/,
      );
      assert.equal(
        (await page.locator(".search-field").nth(2).innerText())
          .split("\n")
          .at(-1),
        `${resultDateRange(request.dates.startDate, request.dates.endDate, locale, referenceCalendarDate(new Date()).slice(0, 4))} · ${request.nights} ${locale === "en" ? "nights" : "net"}`,
      );
      assert.equal(
        await page.locator(".home-ai-review [aria-pressed=true]").count(),
        1,
      );
      await page.locator(".search-field").nth(4).click();
      await page.locator('dialog input[type="number"]').fill("650");
      await close();
      await page.locator(".search-submit").click();
      await page.waitForURL((u) => u.pathname.endsWith("/results"));
      assert.equal(new URL(page.url()).searchParams.get("budget"), "650");
      assert.equal(new URL(page.url()).searchParams.get("ai"), "1");
      assert.equal(
        new URL(page.url()).searchParams.get("start"),
        request.dates.startDate,
      );
      assert.equal(intents, 1);
      stage = `${width}px ${locale} AI clarification`;
      // A clarification remains blocked until answered, then also returns to review.
      await visit();
      await page.unroute("**/api/ai/intent");
      await page.route("**/api/ai/intent", (r) =>
        r.fulfill({
          status: 200,
          json: {
            status: "clarification",
            request,
            clarifications: [{ field: "budget" }],
            unsupportedPreferences: [],
          },
        }),
      );
      await page.locator(".home-ai-trigger").click();
      await page.locator("textarea").fill("A quiet weekend");
      await page.locator(".ai-search-panel .button").click();
      await page.locator('.ai-search-panel input[type="number"]').waitFor();
      assert.equal(
        await page.locator(".ai-search-panel .button").isDisabled(),
        true,
      );
      await page.locator('.ai-search-panel input[type="number"]').fill("700");
      await page.locator(".ai-search-panel .button").click();
      await page.locator(".home-ai-review").waitFor();
      assert.equal(new URL(page.url()).pathname, `/${locale}`);
      await noOverflow();
      stage = `${width}px ${locale} AI failure`;
      // With an explicitly chosen origin, AI failure must not disable ordinary search.
      await page.goto(`${origin}/${locale}?origin=zurich`);
      await page.locator(".search-submit").waitFor();
      await page.unroute("**/api/ai/intent");
      await page.route("**/api/ai/intent", (r) =>
        r.fulfill({ status: 503, json: { status: "unavailable" } }),
      );
      await page.locator(".home-ai-trigger").click();
      await page.locator("textarea").fill("A quiet weekend");
      await page.locator(".ai-search-panel .button").click();
      await page.locator('.ai-search-panel [role="alert"]').waitFor();
      await page.keyboard.press("Escape");
      await page.locator("textarea").waitFor({ state: "detached" });
      assert.equal(
        await page
          .locator(".home-ai-trigger")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      assert.equal(await page.locator(".search-submit").isEnabled(), true);
      await noOverflow();
      assert.deepEqual(errors, [], "no client errors or CSP violations");
      console.log(
        `PASS ${width}px ${locale} (hero ${Math.round(hero.height)}px): layout, metadata, one menu/back, currencies/no FX, English-only navigation/legacy redirect, ordinary search, AI review/clarification/failure, keyboard/reduced motion`,
      );
      await page.close();
    }
} catch (error) {
  console.error(
    `FAIL ${stage}: ${String(error?.message ?? "browser check failed")
      .split("\n")[0]
      .slice(0, 180)}`,
  );
  console.error(
    String(error?.stack ?? "")
      .split("\n")
      .find((line) => line.includes("verify-homepage-browser.mjs:")) ?? "",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
