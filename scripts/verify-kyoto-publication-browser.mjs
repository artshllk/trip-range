/** Real reviewed store → production UI in an isolated synthetic trip frame.
 * Does not prove discovery can map Kyoto's place ID; probe normal routes separately.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { build } = require("esbuild");
const output = process.env.VERIFY_SCREENSHOTS || "/tmp/kyoto-reviewed-runtime";
mkdirSync(output, { recursive: true });
const snapshot = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "-e",
      `
  globalThis.fetch=async()=>{throw Error('No runtime research')};
  const {approvedDestinationContent}=require('./.content-build/src/content/runtime/approved');
  const {placeIdentities}=require('./.content-build/src/places/runtime/registry');
  approvedDestinationContent.get('place:Q34600').then(result=>{
    if(result.status!=='reviewed') throw Error('Reviewed Kyoto required');
    console.log(JSON.stringify({result,identity:placeIdentities.find(p=>p.subject==='place:Q34600')}));
  }).catch(()=>process.exit(1));
`,
    ],
    { encoding: "utf8" },
  ),
);
const { content } = snapshot.result;
assert.equal(content.publication, undefined);
assert.doesNotMatch(
  JSON.stringify(snapshot),
  /contentDigest|identityDigest|evidence-review|"reviewer"|"history"/,
);
const files = readdirSync(".next/static", { recursive: true }).filter(
  (f) => typeof f === "string",
);
const css = files
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(resolve(".next/static", f), "utf8"))
  .join("\n");
assert.ok(css.length > 1000);
const bundle = await build({
  entryPoints: ["tests/fixtures/reviewed-kyoto-browser.tsx"],
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: {
    "process.env": "{}",
    "process.env.NODE_ENV": '"production"',
    "process.env.__NEXT_IMAGE_OPTS": JSON.stringify({
      deviceSizes: [640, 1080],
      imageSizes: [32, 64],
      path: "/_next/image",
      loader: "default",
      unoptimized: true,
      remotePatterns: [],
    }),
  },
});
const server = createServer((req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/runtime-content.json") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(snapshot));
  }
  if (path === "/fixture.js") {
    res.setHeader("Content-Type", "application/javascript");
    return res.end(bundle.outputFiles[0].contents);
  }
  if (path.startsWith("/_next/static/") && files.includes(path.slice(14)))
    return res.end(readFileSync(resolve(".next/static", path.slice(14))));
  if (path === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }
  if (path !== "/") {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
  );
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
  for (const locale of ["en", "sq"]) {
    const page = await browser.newPage();
    const errors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${origin}/?destination=place:Q34600&locale=${locale}`);
    await page.locator(".trip-detail-page").waitFor();
    assert.equal(await page.locator("h1").innerText(), "Kyoto");
    const noOverflow = async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      const body = await page.locator("body").innerText();
      assert.doesNotMatch(
        body,
        /DRAFT — NOT PUBLISHED|evidence-review|contentDigest|identityDigest/,
      );
      assert.ok(body.includes(content.overview.text[locale]));
      for (const item of content.attractions) {
        const h = page.locator(`[id="trip-attraction-${item.id}"] h3`);
        assert.equal(await h.innerText(), item.name[locale]);
        assert.ok(body.includes(item.shortDescription[locale]));
        assert.ok(
          await h.evaluate(
            (e) =>
              e.scrollWidth <= e.clientWidth + 1 &&
              e.scrollHeight <= e.clientHeight + 1,
          ),
        );
      }
      assert.ok(body.includes(content.areas[0].summary[locale]));
      assert.ok(body.includes(content.transport[0].guidance[locale]));
      assert.ok(body.includes(content.practicalNotes[0].text[locale]));
      assert.deepEqual(
        await page.locator("#days .trip-content-stop-list a").allTextContents(),
        content.attractions.slice(0, 2).map((a) => a.name[locale]),
      );
      assert.equal(
        await page.locator(".trip-detail-media .destination-no-image").count(),
        1,
      );
      assert.equal(await page.locator("img").count(), 0);
      await noOverflow();
      await page.screenshot({
        path: join(output, `kyoto-${locale}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      const summary = page.locator("#trip-sources > summary");
      await summary.focus();
      await page.keyboard.press("Enter");
      for (const source of content.sources) {
        const link = page.locator(`[id="destination-source-${source.id}"] > a`);
        assert.equal(await link.getAttribute("href"), source.url);
        assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
        assert.equal(await link.getAttribute("target"), "_blank");
        await link.focus();
        assert.ok(await link.isVisible());
      }
      await noOverflow();
      if (width === 320)
        await page.screenshot({
          path: join(output, `kyoto-${locale}-320-sources.png`),
          fullPage: true,
        });
      await summary.focus();
      await page.keyboard.press("Enter");
      console.log(
        `PASS reviewed store UI ${locale}-${width}: all sections, no draft/operator data, no-photo, sources, no overflow`,
      );
    }
    const amount = await page
      .locator(".trip-unpriced-summary .total")
      .innerText();
    await page.locator(".stay-levels button").first().click();
    assert.notEqual(
      await page.locator(".trip-unpriced-summary .total").innerText(),
      amount,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
      scrollTo(0, 0);
    });
    await noOverflow();
    await page.screenshot({
      path: join(output, `kyoto-${locale}-200-percent.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await page.close();
  }
  console.log(
    "PASS reviewed Kyoto store/UI verification. Discovery routing is a separate acceptance check.",
  );
} finally {
  await browser.close();
  server.close();
  await once(server, "close");
}
