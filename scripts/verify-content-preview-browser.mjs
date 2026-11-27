/** Exercise the actual operator command, separately from the isolated component harness. */
import { selectPreviewRecords } from "./lib/content-preview-selection.mjs";
import assert from "node:assert/strict";
import { get } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output =
  process.env.VERIFY_SCREENSHOTS || "/tmp/goeksplo-content-preview";
mkdirSync(output, { recursive: true });
const records = readdirSync("content/destinations")
  .filter((file) => file.endsWith(".json"))
  .map((file) => ({
    file,
    raw: readFileSync(`content/destinations/${file}`, "utf8"),
  }));
const selected = new Set(
  selectPreviewRecords(records.map((record) => JSON.parse(record.raw))).map(
    (record) => record.destinationId,
  ),
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
try {
  for (const record of records) {
    const data = JSON.parse(record.raw);
    if (!selected.has(data.destinationId)) continue;
    for (const locale of ["en"]) {
      const server = spawn(
        process.execPath,
        [
          "scripts/preview-destination-content.mjs",
          "--destination",
          data.destinationId,
          "--locale",
          locale,
          "--port",
          "4174",
        ],
        {
          env: { ...process.env, NODE_ENV: "development", VERCEL: "" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("preview-start-timeout")),
            20000,
          );
          server.once("exit", () => {
            clearTimeout(timer);
            reject(Error("preview-start-failed"));
          });
          server.stdout.on("data", (chunk) => {
            if (String(chunk).includes("http://127.0.0.1:4174/")) {
              clearTimeout(timer);
              resolve();
            }
          });
        });
        const origin = "http://127.0.0.1:4174";
        assert.equal(
          await new Promise((resolve, reject) => {
            get(origin, { headers: { Host: "evil.example" } }, (r) => {
              r.resume();
              resolve(r.statusCode);
            }).on("error", reject);
          }),
          403,
        );
        assert.equal(
          (await fetch(origin, { headers: { Origin: "https://evil.example" } }))
            .status,
          403,
        );
        assert.equal(
          (await fetch(`${origin}/plan/trips/anything?previewDraft=1`))
            .status,
          404,
        );
        assert.equal(
          (await fetch(`${origin}/api/affiliate/flights`, { method: "POST" }))
            .status,
          503,
        );
        const response = await fetch(origin);
        assert.match(response.headers.get("x-robots-tag"), /noindex/);
        assert.match(
          response.headers.get("content-security-policy"),
          /connect-src 'self'/,
        );
        const page = await browser.newPage({
          viewport: { width: 1280, height: 900 },
        });
        const errors = [],
          external = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.route("**/*", (route) => {
          if (new URL(route.request().url()).origin !== origin) {
            external.push(route.request().url());
            return route.abort();
          }
          return route.continue();
        });
        await page.goto(origin);
        await page.locator(".trip-detail-page").waitFor();
        assert.match(
          await page.locator(".pilot-draft-banner").innerText(),
          /DRAFT — NOT PUBLISHED/,
        );
        assert.equal(await page.locator("h1").count(), 1);
        assert.equal(
          await page
            .locator("#price-details[open], #trip-sources[open]")
            .count(),
          0,
        );
        // Check the real operator preview at the same widths as the component harness.
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({
            width,
            height: width === 1440 ? 900 : 844,
          });
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(() => {
            document.activeElement?.blur();
            scrollTo({ top: 0, behavior: "instant" });
            return new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
            `${data.destinationId} ${locale} ${width}: no horizontal overflow`,
          );
          assert.equal(await page.locator("img").count(), 0);
          assert.equal(
            await page
              .locator(".trip-detail-media .destination-no-image")
              .count(),
            1,
          );
          for (const attraction of data.attractions ?? []) {
            const heading = page.locator(
              `[id="trip-attraction-${attraction.id}"] h3`,
            );
            assert.equal(await heading.innerText(), attraction.name[locale]);
            assert.equal(
              await heading.evaluate(
                (e) =>
                  e.scrollWidth <= e.clientWidth + 1 &&
                  e.scrollHeight <= e.clientHeight + 1,
              ),
              true,
            );
          }
          await page.screenshot({
            path: `${output}/${data.destinationId.replaceAll(":", "-")}-${locale}-${width}.png`,
            fullPage: true,
            animations: "disabled",
          });
          const sources = page.locator("#trip-sources > summary");
          await sources.focus();
          await page.keyboard.press("Enter");
          // Public projection discloses sources actually cited by the selected content.
          const usedSources = new Set(data.sourceIds ?? []);
          for (const item of [
            data.overview,
            ...(data.highlights ?? []),
            ...(data.attractions ?? []),
            ...(data.areas ?? []),
            ...(data.transport ?? []),
            ...(data.practicalNotes ?? []),
            ...(data.dayTemplates ?? []),
          ])
            item?.sourceIds?.forEach((id) => usedSources.add(id));
          for (const source of data.sources.filter((source) =>
            usedSources.has(source.id),
          )) {
            const link = page.locator(
              `[id="destination-source-${source.id}"] > a`,
            );
            assert.equal(await link.getAttribute("href"), source.url);
            assert.equal(await link.getAttribute("target"), "_blank");
            assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
            assert.ok(await link.isVisible());
            await link.focus();
            assert.equal(
              await link.evaluate((e) => e === document.activeElement),
              true,
            );
          }
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
            `${data.destinationId} ${locale} ${width}: source disclosure fits`,
          );
          if (width === 320) {
            await page.screenshot({
              path: `${output}/${data.destinationId.replaceAll(":", "-")}-${locale}-${width}-sources.png`,
              fullPage: true,
              animations: "disabled",
            });
          }
          await sources.focus();
          await page.keyboard.press("Enter");
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        // Actual controls still recalculate; the preview does not fake their behavior.
        const amount = await page
          .locator(".trip-unpriced-summary .total")
          .innerText();
        await page.locator(".stay-levels button").first().click();
        assert.notEqual(
          await page.locator(".trip-unpriced-summary .total").innerText(),
          amount,
        );
        assert.equal(await page.locator(".trip-budget .fit").count(), 0);
        for (const id of ["price-details", "trip-sources"]) {
          await page.locator(`#${id} > summary`).focus();
          await page.keyboard.press("Enter");
          assert.equal(await page.locator(`#${id}[open]`).count(), 1);
          await page.keyboard.press("Enter");
          assert.equal(await page.locator(`#${id}[open]`).count(), 0);
        }
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
          document.activeElement?.blur();
          scrollTo({ top: 0, behavior: "instant" });
        });
        assert.equal(
          await page.evaluate(() =>
            [...document.querySelectorAll("main *")].some(
              (e) => e.getBoundingClientRect().right > innerWidth + 1,
            ),
          ),
          false,
        );
        await page.screenshot({
          path: `${output}/${data.destinationId.replaceAll(":", "-")}-${locale}-200-percent.png`,
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        await page.close();
        console.log(
          `PASS operator preview ${data.destinationId} ${locale}: loopback isolation, current UI, disclosure keyboard, stay recalculation, 200% zoom`,
        );
      } finally {
        const stopped = once(server, "exit");
        server.kill("SIGTERM");
        await stopped;
      }
    }
    assert.equal(
      readFileSync(`content/destinations/${record.file}`, "utf8"),
      record.raw,
      "Preview never writes or approves a draft",
    );
  }
} finally {
  await browser.close();
}
