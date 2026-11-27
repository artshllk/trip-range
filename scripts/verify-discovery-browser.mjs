/** Bounded loopback-only Phase 3 checks; run against a keyless production build. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const sharp = require("sharp");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:4186";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-discovery";
mkdirSync(output, { recursive: true });
const query = new URLSearchParams({
  origin: "zurich",
  budget: "1450",
  currency: "CHF",
  adults: "3",
  children: "2",
  start: "2026-11-20",
  end: "2026-11-23",
  styles: "quiet",
  flexDays: "3",
  luggage: "1",
  airports: "1",
  family: "1",
  stay: "comfort",
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
const results = [],
  imageResults = [];
let stage = "setup";
try {
  for (const width of [1440, 390, 375, 360, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 1440 ? 900 : 844 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [],
      blocked = [];
    const imageResponses = new Map();
    page.on("response", (response) => {
      if (response.request().resourceType() === "image")
        imageResponses.set(response.url(), response);
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) {
        blocked.push(u.origin);
        return route.abort();
      }
      return route.continue();
    });
    const overflow = async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        stage + " overflow",
      );
    const visit = async (path) => {
      const response = await page.goto(origin + path);
      assert.equal(response.status(), 200, stage);
      await page.evaluate(() => document.fonts.ready);
      if (width <= 1050)
        await page.locator(".mobile-menu-trigger:visible").waitFor();
      else
        await page
          .locator(".header-preferences button:visible")
          .first()
          .waitFor();
      await overflow();
    };
    try {
      stage = `${width} initial homepage`;
      await visit("/");
      assert.equal(await page.locator("main h1").count(), 1);
      assert.equal(await page.locator(".destination-card").count(), 4);
      assert.equal(
        await page
          .getByText("Reviewed guide · no photo selected", { exact: true })
          .count(),
        0,
      );
      for (const name of ["Paris", "New York City"])
        assert.equal(
          await page
            .locator(".destination-card")
            .getByRole("heading", { name, exact: false })
            .count(),
          1,
        );
      assert.match(
        await page.locator(".search-field").first().innerText(),
        /Choose.*origin|Choose.*departure|Choose.*airport|Choose.*city/i,
      );
      assert.equal(await page.locator(".search-submit").isDisabled(), true);
      assert.equal(
        await page.getByRole("button", { name: /Language:/ }).count(),
        0,
      );
      for (const image of await page.locator(".destination-card img").all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((el) => el.decode());
        const src = await image.evaluate((el) => el.currentSrc);
        assert.match(
          src,
          /\/destinations\/(vienna|london|paris|new-york)-(640|1200|1920)\.webp$/,
        );
        imageResults.push({ width, role: "card", src: new URL(src).pathname });
      }
      if (width < 760) {
        await page.locator(".mobile-menu-trigger:visible").click();
        const dialog = page.locator("dialog[open]");
        await dialog.waitFor();
        for (const name of [
          "Explore trips",
          "Destinations",
          "How it works",
          "About",
        ])
          assert.equal(
            await dialog.getByRole("link", { name, exact: true }).count(),
            1,
          );
        await overflow();
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        assert.equal(await page.locator("dialog[open]").count(), 0);
      }
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({
        path: `${output}/home-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      results.push({ width, page: "home", passed: true });
      stage = `${width} footer current currency`;
      if (width < 760)
        await page.locator(".mobile-menu-trigger:visible").click();
      else await page.locator(".header-preferences button").first().click();
      await page.getByRole("radio", { name: "GBP", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.locator("dialog[open]").waitFor({ state: "detached" });
      await page.waitForFunction(() =>
        document
          .querySelector('footer a[href*="destinations"]')
          ?.getAttribute("href")
          .includes("currency=GBP"),
      );
      const initialFooter = new URL(
        await page
          .locator('footer a[href*="destinations"]')
          .getAttribute("href"),
        origin,
      );
      assert.equal(initialFooter.searchParams.get("currency"), "GBP");
      assert.equal(initialFooter.searchParams.has("origin"), false);
      results.push({
        width,
        page: "footer/current-currency/no-assumed-origin",
        passed: true,
      });
      for (const slug of ["vienna", "london", "paris", "new-york"]) {
        stage = `${width} ${slug} guide`;
        await visit(`/destinations/${slug}?${query}`);
        assert.equal(await page.locator("main h1").count(), 1);
        assert.ok((await page.locator(".trip-place-row").count()) >= 3);
        assert.match(
          await page.locator(".guide-planning").innerText(),
          /total incomplete/,
        );
        if (["vienna", "london", "paris", "new-york"].includes(slug)) {
          const image = page.locator(".guide-hero img");
          await image.evaluate((el) => el.decode());
          const src = await image.evaluate((el) => el.currentSrc);
          const response = imageResponses.get(src);
          assert.ok(response, "Browser actually requested its selected image");
          const bytes = await response.body();
          assert.equal(response.status(), 200);
          const metadata = await sharp(bytes).metadata();
          assert.ok(src.includes(`/${slug}-`));
          assert.equal(metadata.width, width === 1440 ? 1200 : 640);
          imageResults.push({
            width,
            role: "hero",
            city: slug,
            downloaded: metadata.width,
            bytes: bytes.length,
          });
          await page
            .locator(".guide-intro .destination-credit summary")
            .click();
          assert.match(
            await page.locator(".guide-intro .destination-credit").innerText(),
            {
              vienna: /Andrzej Otrębski/,
              london: /Ilya Grigorik/,
              paris: /MarcusObal/,
              "new-york": /Aaron Harris/,
            }[slug],
          );
          await overflow();
          await page
            .locator(".guide-intro .destination-credit summary")
            .click();
        } else assert.equal(await page.locator(".guide-hero").count(), 0);
        assert.equal(
          await page.locator('link[rel="canonical"]').getAttribute("href"),
          `https://www.trip-range.com/destinations/${slug}`,
        );
        assert.equal(
          await page.locator(".guide-title-row .button.ember").count(),
          1,
        );
        const link = new URL(
          await page.locator(".guide-title-row a.button").getAttribute("href"),
          origin,
        );
        for (const key of [
          "origin",
          "budget",
          "currency",
          "adults",
          "children",
          "start",
          "end",
        ])
          assert.equal(link.searchParams.get(key), query.get(key));
        await page.screenshot({
          path: `${output}/${slug}-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
        results.push({ width, page: slug, passed: true });
      }
      stage = `${width} destination collection and about`;
      await visit("/destinations");
      assert.equal(await page.locator(".destination-card").count(), 4);
      await visit("/about");
      assert.match(
        await page.locator("h1").innerText(),
        /more than the flight/,
      );
      results.push({ width, page: "collection/about", passed: true });
      stage = `${width} search context and style interaction`;
      await visit(`/?${query}`);
      await page.locator(".search-field").nth(4).click();
      await page.locator('dialog input[type="number"]').fill("1675");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /By the water/ }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('.discovery-style[aria-pressed="true"]')
            ?.textContent?.includes("slower") &&
          [
            ...document.querySelectorAll(
              '.discovery-style[aria-pressed="true"]',
            ),
          ].some((el) => el.textContent.includes("water")),
      );
      await overflow();
      const cardLink = page.locator(".destination-card-copy h3 a").first();
      const cardUrl = new URL(await cardLink.getAttribute("href"), origin);
      assert.equal(cardUrl.searchParams.get("budget"), "1675");
      assert.equal(cardUrl.searchParams.get("adults"), "3");
      assert.ok(
        cardUrl.searchParams.get("styles").split(",").includes("beach"),
      );
      await cardLink.click();
      await page.waitForURL((u) => u.pathname === "/destinations/vienna");
      await page
        .locator(".guide-title-row a.button")
        .waitFor({ state: "visible" });
      // Currency is nominal and belongs to this URL, including a guide-to-search handoff.
      if (width < 760) {
        assert.equal(
          await page.locator(".mobile-menu-trigger:visible").count(),
          1,
          "one active mobile menu",
        );
        await page.locator(".mobile-menu-trigger:visible").click();
      } else await page.locator(".header-preferences button").first().click();
      await page.getByRole("radio", { name: "USD", exact: true }).click();
      await page.waitForURL((u) => u.searchParams.get("currency") === "USD");
      await page.waitForFunction(
        () =>
          document.querySelector('input[name="header-currency"][value="USD"]')
            ?.checked,
      );
      await page.keyboard.press("Escape");
      await page.locator("dialog").waitFor({ state: "detached" });
      const currencyLink = new URL(
        await page.locator(".guide-title-row a.button").getAttribute("href"),
        origin,
      );
      assert.equal(currencyLink.searchParams.get("currency"), "USD");
      assert.equal(currencyLink.searchParams.get("budget"), "1675");
      await page.locator(".guide-title-row a.button").click();
      await page.waitForURL((u) => u.pathname === "/");
      assert.match(
        await page.locator(".search-field").first().innerText(),
        /Zurich/,
      );
      assert.match(
        await page.locator(".search-field").nth(1).innerText(),
        /Vienna/,
      );
      assert.match(
        await page.locator(".search-field").nth(4).innerText(),
        /1,?675/,
      );
      assert.match(await page.locator(".search-field").nth(3).innerText(), /5/);
      assert.equal(
        new URL(page.url()).searchParams.get("start"),
        query.get("start"),
      );
      assert.equal(
        new URL(page.url()).searchParams.get("end"),
        query.get("end"),
      );
      await page.reload();
      assert.match(
        await page.locator(".search-field").nth(1).innerText(),
        /Vienna/,
      );
      const preserved = [...new URL(page.url()).searchParams];
      const checkContext = () => {
        const actual = new URL(page.url()).searchParams;
        for (const [key, value] of preserved)
          assert.equal(actual.get(key), value, `${stage}: ${key}`);
      };
      assert.match(
        await page.locator(".search-field").nth(2).innerText(),
        /20–23 Nov ±3 · 3 nights/,
      );
      const datesBefore = await page
        .locator(".search-field")
        .nth(2)
        .innerText();
      stage = `${width} footer context/reload/back`;
      await page
        .locator("footer")
        .getByRole("link", { name: "Destination guides", exact: true })
        .click();
      await page.waitForURL((u) => u.pathname === "/destinations");
      checkContext();
      await page
        .locator("footer")
        .getByRole("link", { name: "Explore trips", exact: true })
        .click();
      await page.waitForURL((u) => u.pathname === "/");
      checkContext();
      await page.reload();
      checkContext();
      assert.equal(
        await page.locator(".search-field").nth(2).innerText(),
        datesBefore,
      );
      await page.goBack();
      await page.waitForURL((u) => u.pathname === "/destinations");
      checkContext();
      await page.goBack();
      await page.waitForURL((u) => u.pathname === "/");
      checkContext();
      await overflow();
      results.push({
        width,
        page: "footer/context/reload/back/dates",
        passed: true,
      });
      await page.screenshot({
        path: `${output}/search-summary-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page.locator(".search-submit").click();
      await page.waitForURL((u) => u.pathname === "/plan/results");
      assert.equal(new URL(page.url()).searchParams.get("budget"), "1675");
      assert.equal(new URL(page.url()).searchParams.get("adults"), "3");
      assert.match(
        await page.locator('meta[name="robots"]').getAttribute("content"),
        /noindex/,
      );
      await overflow();
      stage = `${width} legacy destination redirect`;
      await page.goto(origin + `/sq/destinations/london?${query}`);
      assert.equal(new URL(page.url()).pathname, "/destinations/london");
      assert.equal(new URL(page.url()).searchParams.get("budget"), "1450");
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, []);
      results.push({
        width,
        page: "navigation/reload/search/style/redirect",
        passed: true,
      });
    } finally {
      await context.close();
    }
  }
  // Fresh DPR 2 contexts verify actual browser response bytes for cards and heroes.
  for (const width of [1440, 390, 375, 360, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      responses = new Map();
    page.on("response", (r) => {
      if (r.request().resourceType() === "image") responses.set(r.url(), r);
    });
    await page.route("**/*", (route) => {
      assert.equal(new URL(route.request().url()).origin, origin);
      return route.continue();
    });
    try {
      for (const slug of ["home", "vienna", "london", "paris", "new-york"]) {
        stage = `${width} DPR 2 ${slug}`;
        await page.goto(
          origin + (slug === "home" ? "/" : `/destinations/${slug}`),
        );
        const images = page.locator(
          slug === "home" ? ".destination-card img" : ".guide-hero img",
        );
        for (const image of await images.all()) {
          await image.scrollIntoViewIfNeeded();
          await image.evaluate((el) => el.decode());
          const src = await image.evaluate((el) => el.currentSrc),
            response = responses.get(src);
          assert.ok(response);
          const bytes = await response.body(),
            metadata = await sharp(bytes).metadata();
          const box = await image.boundingBox(),
            expected =
              (
                await image.evaluate((el) =>
                  el.srcset
                    .split(",")
                    .map((item) =>
                      Number.parseInt(item.trim().split(/\s+/).at(-1)),
                    ),
                )
              ).find((candidate) => candidate >= box.width * 2) ?? 1920;
          assert.equal(metadata.width, expected);
          imageResults.push({
            width,
            dpr: 2,
            role: slug === "home" ? "card" : "hero",
            src: new URL(src).pathname,
            downloaded: metadata.width,
            bytes: bytes.length,
          });
        }
        results.push({ width, dpr: 2, page: slug, passed: true });
      }
    } finally {
      await context.close();
    }
  }
  const sitemap = await (await fetch(origin + "/sitemap.xml")).text();
  for (const path of [
    "/destinations",
    "/destinations/vienna",
    "/destinations/london",
    "/destinations/paris",
    "/destinations/new-york",
    "/about",
  ])
    assert.ok(sitemap.includes("https://www.trip-range.com" + path));
  assert.doesNotMatch(sitemap, /\/sq|\/plan\/trips|\/plan\/results|budget=/);
  writeFileSync(
    `${output}/verification.json`,
    JSON.stringify(
      {
        status: "passed",
        scope:
          "Keyless isolated production build; local failure fixture blocks external providers; no live service claims",
        results,
        imageResults,
        externalRequests: 0,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `PASS: ${results.length} checks across five widths, ${imageResults.length} image checks, zero external browser requests; sitemap passed.`,
  );
} catch (error) {
  console.error("FAILED at " + stage);
  throw error;
} finally {
  await browser.close();
}
