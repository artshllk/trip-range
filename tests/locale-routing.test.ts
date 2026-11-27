import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { defaultLocale, localePath, localeFromPath } from "../src/i18n/routing";
import { translatedPath } from "../src/i18n/config";
import { proxy, config } from "../src/proxy";

test("the default locale is unprefixed; other locales keep their prefix", () => {
  assert.equal(defaultLocale, "en");
  assert.equal(localePath("en"), "/");
  assert.equal(
    localePath("en", "/destinations/vienna"),
    "/destinations/vienna",
  );
  assert.equal(localePath("en", "/#search"), "/#search");
  assert.equal(localePath("sq"), "/sq");
  assert.equal(
    localePath("sq", "/destinations/vienna"),
    "/sq/destinations/vienna",
  );
  assert.equal(localePath("sq", "/#search"), "/sq#search");
  assert.equal(localePath("sq", "/?origin=tirana"), "/sq?origin=tirana");
  assert.throws(() => localePath("en", "about"));
});

test("public paths split into locale and unprefixed path", () => {
  assert.deepEqual(localeFromPath("/"), { locale: "en", path: "/" });
  assert.deepEqual(localeFromPath("/about"), { locale: "en", path: "/about" });
  assert.deepEqual(localeFromPath("/sq"), { locale: "sq", path: "/" });
  assert.deepEqual(localeFromPath("/sq/about"), {
    locale: "sq",
    path: "/about",
  });
  // Not locale prefixes: an unknown two-letter segment, or a longer word.
  assert.deepEqual(localeFromPath("/de/about"), {
    locale: "en",
    path: "/de/about",
  });
  assert.deepEqual(localeFromPath("/square"), {
    locale: "en",
    path: "/square",
  });
  assert.equal(translatedPath("/plan/results", "sq"), "/sq/plan/results");
  assert.equal(translatedPath("/sq/plan/results", "en"), "/plan/results");
  assert.equal(translatedPath("/from/tirana", "sq"), "/sq");
});

test("the proxy serves English unprefixed and leaves other locales alone", async () => {
  const rewrite = async (path: string) =>
    (
      await proxy(new NextRequest(`https://www.trip-range.com${path}`))
    )?.headers.get("x-middleware-rewrite");
  assert.equal(await rewrite("/"), "https://www.trip-range.com/en");
  assert.equal(
    await rewrite("/destinations/vienna?origin=tirana"),
    "https://www.trip-range.com/en/destinations/vienna?origin=tirana",
  );
  assert.equal(
    await rewrite("/from/tirana"),
    "https://www.trip-range.com/en/from/tirana",
  );
  assert.equal(
    await proxy(new NextRequest("https://www.trip-range.com/sq/about")),
    undefined,
  );
  // Assets, metadata files and Next internals never reach the proxy. API routes
  // reach it only through their own matcher, for the per-client limiter.
  const matcher = new RegExp(`^${config.matcher[1]}$`);
  for (const path of ["/", "/about", "/plan/results", "/destinations/vienna"])
    assert.ok(matcher.test(path), path);
  for (const path of [
    "/api/health",
    "/_next/static/chunk.js",
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/destinations/vienna-640.webp",
    "/demo/hero-portrait.jpg",
  ])
    assert.ok(!matcher.test(path), path);
});

test("API routes reach the proxy only for the limiter, never the locale rewrite", async () => {
  const api = new RegExp(`^${config.matcher[2].replace("/:path*", "/.*")}$`);
  assert.ok(api.test("/api/health"));
  assert.ok(!api.test("/plan"));
  assert.equal(
    await proxy(new NextRequest("https://www.trip-range.com/api/health")),
    undefined,
  );
});

test("old English URLs redirect once, preserving the query and request method", async () => {
  for (const [path, target] of [
    ["/en", "/"],
    ["/en/plan?month=2026-12&ceiling=600", "/plan?month=2026-12&ceiling=600"],
    ["/en/destinations/vienna", "/destinations/vienna"],
    ["/en/icon.svg", "/icon.svg"],
  ]) {
    const response = await proxy(
      new NextRequest(`https://www.trip-range.com${path}`, { method: "POST" }),
    );
    assert.equal(response?.status, 308);
    assert.equal(
      response.headers.get("location"),
      `https://www.trip-range.com${target}`,
    );
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
  }
  assert.equal(config.matcher[0], "/en/:path*");
  assert.equal(
    (
      await proxy(new NextRequest("https://www.trip-range.com/english"))
    )?.headers.get("location"),
    null,
  );
});
