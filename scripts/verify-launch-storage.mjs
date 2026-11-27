/** Run against a local Netlify-profile production build with no provider credentials. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://localhost:32842";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const writes = [],
    events = [],
    unexpectedRequests = [];
  const partner = "https://partner.invalid/checkout";
  const clicks = [];

  const cdp = await context.newCDPSession(page);
  await cdp.send("DOMStorage.enable");
  for (const action of [
    "domStorageItemAdded",
    "domStorageItemUpdated",
    "domStorageItemRemoved",
    "domStorageItemsCleared",
  ]) {
    cdp.on("DOMStorage." + action, () => writes.push(action));
  }
  await context.exposeBinding("reportDeviceWrite", (_, api) =>
    writes.push(api),
  );
  await context.addInitScript(() => {
    const report = window.reportDeviceWrite;
    const cookie = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "cookie",
    );
    Object.defineProperty(Document.prototype, "cookie", {
      ...cookie,
      set(value) {
        report("document.cookie");
        cookie.set.call(this, value);
      },
    });
    for (const [object, method] of [
      [IDBFactory.prototype, "open"],
      [IDBFactory.prototype, "deleteDatabase"],
      [globalThis.cookieStore, "set"],
      [globalThis.cookieStore, "delete"],
    ]) {
      if (!object) continue;
      const original = object[method];
      object[method] = function (...args) {
        report(method);
        return original.apply(this, args);
      };
    }
  });
  // Real page code and navigation; intercept writes and the outbound booking flow.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === partner)
      return route.fulfill({
        contentType: "text/html",
        body: "<title>Partner fixture</title>",
      });
    if (
      url.origin !== origin ||
      /^\/(?:_vercel|api\/ai)\//.test(url.pathname)
    ) {
      unexpectedRequests.push(url.origin + url.pathname);
      return route.abort();
    }
    if (url.pathname === "/api/affiliate/event") {
      events.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === "/api/affiliate/flights") {
      clicks.push(route.request().postDataJSON());
      return route.fulfill({
        json: { status: "available", link: { url: partner } },
      });
    }
    return route.continue();
  });
  cdp.on("Network.responseReceivedExtraInfo", ({ headers }) => {
    if (Object.keys(headers).some((k) => k.toLowerCase() === "set-cookie"))
      writes.push("Set-Cookie");
  });
  await cdp.send("Network.enable");

  const sitemap = await (
    await context.request.get(origin + "/sitemap.xml")
  ).text();
  const indexed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    ([, url]) => new URL(url).pathname,
  );
  assert.equal(indexed.length, 9);
  const date = (days) =>
    new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const query = new URLSearchParams({
    origin: "zurich",
    departure: "ZRH",
    when: "custom",
    start: date(30),
    end: date(32),
    budget: "800",
  });
  const trip = "/plan/trips/vienna?" + query;
  const pages = [
    ...indexed,
    "/privacy",
    "/terms",
    "/affiliate-disclosure",
    "/from/tirana",
    "/plan",
    "/plan/results?" + query,
    trip,
  ];
  for (const path of pages) {
    const response = await page.goto(origin + path, {
      waitUntil: "networkidle",
    });
    assert.equal(response.status(), 200, path);
    if (["/privacy", "/terms", "/affiliate-disclosure"].includes(path)) {
      assert.doesNotMatch(
        await page.locator("main").innerText(),
        /\b(OpenAI|AI|Vercel)\b|tab storage|private preview/i,
        path,
      );
    }
    const stored = await page.evaluate(async () => [
      localStorage.length,
      sessionStorage.length,
      (await indexedDB.databases()).length,
      document.cookie,
    ]);
    assert.deepEqual(stored, [0, 0, 0, ""], path);
  }
  assert(events.length > 0, "a real CTA must emit a view");
  const button = page.locator(".affiliate-action button").first();
  await Promise.all([page.waitForURL(partner), button.click()]);
  await page.goBack({ waitUntil: "networkidle" });
  assert.equal(await button.isEnabled(), true);
  assert.equal(clicks.length, 1);
  for (const view of events) {
    assert.deepEqual(Object.keys(view).sort(), [
      "destinationCode",
      "event",
      "fareAge",
      "originCode",
    ]);
    assert.equal(view.event, "cta_view");
    assert(["fresh", "aging", "old", "unknown"].includes(view.fareAge));
  }
  const [click] = clicks;
  assert.deepEqual(Object.keys(click).sort(), [
    "fareAge",
    "placement",
    "route",
  ]);
  const matchingView = events.findLast(
    (v) =>
      v.originCode === click.route.originCode &&
      v.destinationCode === click.route.destinationCode,
  );
  assert(matchingView);
  assert.equal(click.fareAge, matchingView.fareAge);
  assert.deepEqual(await context.cookies(), []);
  assert.deepEqual(writes, []);
  assert.deepEqual(unexpectedRequests, []);
  console.log(
    `PASS ${pages.length} launch pages and simulated partner/Back journey, views and click preserved, zero return events, storage writes, cookies or unexpected browser origins.`,
  );
} finally {
  await browser.close();
}
