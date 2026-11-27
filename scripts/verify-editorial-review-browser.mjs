/** Offline static operator reports. Never mutates or approves real content. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output =
  process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-editorial-review";
mkdirSync(output, { recursive: true });
const reports = new Map();
for (const id of ["city:BCN", "crete", "place:Q34600"]) {
  const html = execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      ".content-build/scripts/review-destination-content.js",
      "--destination",
      id,
      "--format",
      "html",
    ],
    { encoding: "utf8" },
  );
  reports.set(id, html);
}
const server = createServer((request, response) => {
  const id = new URL(request.url, "http://localhost").searchParams.get("id");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.end(reports.get(id) || "Not found");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage(),
    errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  for (const id of reports.keys())
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/?id=${encodeURIComponent(id)}`);
      assert.equal(await page.locator("h1").count(), 1);
      assert.match(
        await page.locator(".banner").innerText(),
        /DRAFT — NOT PUBLISHED/,
      );
      const editorial = await page
        .getByRole("region", { name: "Editorial decision" })
        .innerText();
      for (const check of [
        "identity",
        "sources",
        "englishCopy",
        "albanianCopy",
        "selectionAndOrder",
        "freshness",
      ])
        assert.ok(editorial.includes(`${check}: pending`));
      assert.match(editorial, /Current digest: [a-f0-9]{64}/);
      assert.match(editorial, /Overall review: pending/);
      assert.match(editorial, /Publication: not approved/);
      const warnings = page.getByText(/^Review blockers and advisories/);
      await warnings.click();
      const warningText = await warnings.locator("..").innerText();
      if (id === "crete") assert.match(warningText, /253\/240/);
      if (id === "city:BCN") assert.match(warningText, /Picasso/);
      await warnings.click();
      assert.equal(await page.locator("script,img,iframe").count(), 0);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      const summary = page.getByText("Identity verification details", {
        exact: true,
      });
      await summary.focus();
      await page.keyboard.press("Enter");
      assert.equal(await summary.locator("..").getAttribute("open"), "");
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `${output}/${id.replaceAll(":", "-")}-${width}.png`,
        fullPage: false,
      });
      console.log(
        `PASS editorial report ${id} ${width}px: checklist, digest, warnings, EN/SQ, keyboard, no overflow`,
      );
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await page.close();
  writeFileSync(
    `${output}/summary.json`,
    JSON.stringify(
      {
        destinations: [...reports.keys()],
        widths: [1440, 390, 320],
        checks: 9,
        externalCalls: 0,
        clientErrors: 0,
      },
      null,
      2,
    ),
  );
} finally {
  server.closeAllConnections();
  server.close();
  await browser.close();
}
