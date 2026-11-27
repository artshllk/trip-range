/** Local, deterministic QA. Start serve-results-v2-fixture.mjs first. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const phase = process.argv[2] || "after";
assert.ok(["before", "after", "journey"].includes(phase));
if (phase === "journey") {
  const temp = mkdtempSync(join(tmpdir(), "trip-range-journey-"));
  try {
    const source = readFileSync("scripts/verify-three-page-journey.mjs", "utf8")
      .replace(
        '"docs/verification/three-page-acceptance"',
        '"docs/verification/trip-range-rebrand/journey"',
      )
      .replace(
        "await chromium.launch();",
        "await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE});",
      );
    const entry = join(temp, "journey.mjs");
    writeFileSync(entry, source);
    execFileSync(process.execPath, [entry], {
      env: process.env,
      stdio: "inherit",
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  process.exit(0);
}
const out = `docs/verification/trip-range-rebrand/${phase}`;
mkdirSync(out, { recursive: true });
const query =
  "origin=zurich&budget=800&currency=EUR&start=2027-01-20&end=2027-01-22&when=custom&adults=2&children=0&airports=0&styles=city&stay=standard&flexDays=0";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
});
const results = [];
try {
  for (const width of [1440, 390, 375, 360, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 1440 ? 900 : 844 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== origin && ["http:", "https:"].includes(u.protocol))
        return route.abort();
      return route.continue();
    });
    for (const [name, path] of [
      ["home", ""],
      ["results", "/plan/results"],
      ["trip", "/plan/trips/vienna"],
      ["about", "/about"],
    ]) {
      await page.goto(`${origin}/en${path}?${query}`);
      await page.locator("main h1").waitFor();
      await page
        .locator(
          width <= 1050
            ? ".site-header .mobile-menu-trigger"
            : ".site-header .header-preferences button",
        )
        .waitFor({ state: "visible" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const data = await page.evaluate(() => {
        const logo = document.querySelector(".site-header .logo");
        const nav = document.querySelector(".nav");
        const mark = document.querySelector(".site-header .brand-mark");
        const menu = document.querySelector(".mobile-menu-trigger");
        const box = (e) => {
          const r = e?.getBoundingClientRect();
          return r
            ? {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                right: r.right,
              }
            : null;
        };
        return {
          title: document.title,
          canonical: document.querySelector('link[rel="canonical"]')?.href,
          robots: document.querySelector('meta[name="robots"]')?.content,
          logo: box(logo),
          nav: box(nav),
          mark: box(mark),
          menu:
            menu && getComputedStyle(menu).display !== "none"
              ? box(menu)
              : null,
          background: mark ? getComputedStyle(mark).backgroundImage : null,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          og: [...document.querySelectorAll('meta[property^="og:"]')].map(
            (e) => [e.getAttribute("property"), e.content],
          ),
          icons: [
            ...document.querySelectorAll(
              'link[rel*="icon"],link[rel="manifest"]',
            ),
          ].map((e) => ({
            rel: e.rel,
            url: e.href,
            sizes: e.getAttribute("sizes"),
          })),
          clientScripts: [...document.scripts]
            .filter((e) => e.src)
            .map((e) => e.src),
          resources: performance
            .getEntriesByType("resource")
            .filter((r) => r.name.includes("/branding/"))
            .map((r) => ({ url: r.name, bytes: r.encodedBodySize })),
        };
      });
      if (data.overflow) {
        await page.screenshot({ path: `${out}/overflow.png`, fullPage: true });
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
            .map((e) => ({
              tag: e.tagName,
              cls: e.className,
              width: e.getBoundingClientRect().width,
              right: e.getBoundingClientRect().right,
            }))
            .slice(0, 30),
        );
        writeFileSync(
          `${out}/overflow.json`,
          JSON.stringify(
            { name, width, ...data, overflowElements: overflow },
            null,
            2,
          ),
        );
      }
      assert.equal(data.overflow, false, `${phase} ${name} ${width}: overflow`);
      if (phase === "after") {
        assert.ok(data.title.includes("Trip Range"), `${name} title`);
        assert.ok(data.mark.width >= 192, `${name} logo width`);
        assert.ok(
          data.background.includes(
            name === "about" ? "horizontal-light" : "horizontal-dark",
          ),
        );
        if (data.menu)
          assert.ok(
            data.logo.right <= data.menu.x,
            `${name}: navigation clipping`,
          );
        assert.equal(
          data.nav.height,
          name === "home" ? (width === 1440 ? 84 : 64) : 68,
        );
        assert.equal(
          await page
            .locator('.site-header a[aria-label="Trip Range home"]')
            .count(),
          1,
        );
        if (["results", "trip"].includes(name)) {
          assert.match(data.robots, /noindex/);
          assert.equal(data.canonical, undefined);
        } else
          assert.ok(data.canonical.startsWith("https://www.trip-range.com/"));
        assert.ok(data.icons.some((i) => i.url.includes("icon.svg")));
        assert.ok(data.icons.some((i) => i.rel === "apple-touch-icon"));
      }
      await page.screenshot({
        path: `${out}/${name}-${width}.png`,
        fullPage: true,
      });
      if (width === 1440 || width === 320)
        await page
          .locator("footer")
          .screenshot({ path: `${out}/${name}-footer-${width}.png` });
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({ path: `${out}/${name}-viewport-${width}.png` });
      if (phase === "after") {
        assert.deepEqual(errors, [], `${name}: browser errors`);
        const homeLink = page.locator(
          '.site-header a[aria-label="Trip Range home"]',
        );
        await homeLink.focus();
        assert.equal(
          await homeLink.evaluate((e) => e === document.activeElement),
          true,
        );
        if (name === "home" && width < 900) {
          await page.locator(".mobile-menu-trigger").click();
          await page.getByRole("dialog").waitFor();
          assert.ok(
            (await page.getByRole("dialog").innerText()).includes("Trip Range"),
          );
          if ([390, 320].includes(width))
            await page.screenshot({ path: `${out}/menu-${width}.png` });
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          assert.equal(await page.getByRole("dialog").count(), 0);
          assert.equal(
            await page
              .locator(".mobile-menu-trigger")
              .evaluate((e) => e === document.activeElement),
            true,
          );
        }
        if (name === "trip") {
          const style = await page
            .locator(".trip-section-nav")
            .evaluate((e) => ({
              position: getComputedStyle(e).position,
              top: getComputedStyle(e).top,
            }));
          assert.equal(style.position, width === 1440 ? "sticky" : "static");
          if (width === 1440) assert.equal(style.top, "68px");
        }
      }
      results.push({ name, width, ...data, errors: [...errors] });
    }
    await page.close();
  }
  if (phase === "after") {
    const request = await browser.newContext();
    for (const path of [
      "/icon.svg",
      "/favicon.ico",
      "/apple-icon.png",
      "/manifest.webmanifest",
      "/branding/trip-range/social-1200x630.png",
    ]) {
      const res = await request.request.get(origin + path);
      assert.equal(res.status(), 200, path);
      if (path === "/manifest.webmanifest") {
        const m = await res.json();
        assert.equal(m.name, "Trip Range");
        assert.equal(m.start_url, "/");
        assert.equal(m.display, "browser");
      }
    }
    const metadata = [];
    for (const path of [
      "/destinations",
      "/destinations/vienna",
      "/privacy",
      "/terms",
      "/affiliate-disclosure",
      "/plan",
      "/from/zurich",
      "/from/prishtina/weekend-trips/under-300",
      "/missing/rebrand/review",
    ]) {
      const response = await request.request.get(origin + path);
      const html = await response.text();
      const title = html.match(/<title>(.*?)<\/title>/)?.[1];
      assert.ok(title?.includes("Trip Range"), `${path}: title`);
      const canonical = html.match(
        /<link rel="canonical" href="([^"]+)"/i,
      )?.[1];
      if (canonical)
        assert.ok(canonical.startsWith("https://www.trip-range.com/"));
      assert.ok(!html.includes('hreflang="sq"'));
      const robots = html.match(/<meta name="robots" content="([^"]+)"/)?.[1];
      if (
        [
          "/privacy",
          "/terms",
          "/affiliate-disclosure",
          "/plan",
          "/missing/rebrand/review",
        ].includes(path)
      )
        assert.match(robots, /noindex/);
      assert.equal(response.status(), path.includes("/missing/") ? 404 : 200);
      metadata.push({
        path,
        status: response.status(),
        title,
        canonical,
        robots,
      });
    }
    writeFileSync(
      `${out}/metadata.json`,
      JSON.stringify(metadata, null, 2) + "\n",
    );
    await request.close();
  }
  writeFileSync(
    `${out}/verification.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(`${phase}: ${results.length} page/viewport checks passed`);
} finally {
  await browser.close();
}
