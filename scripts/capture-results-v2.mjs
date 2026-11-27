/** Capture production-rendered pages against the isolated search-recovery fixture. */
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3162";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
  throw Error("Local QA only");
const dir = "docs/verification/results-v2",
  phase = process.argv[2] || "before";
const cases = {
  several: {},
  vienna: { start: "2027-02-20", end: "2027-02-22", to: "vienna" },
  priced: { to: "vienna" },
  empty: { start: "2027-02-20", end: "2027-02-22" },
  unavailable: { start: "2027-04-20", end: "2027-04-22" },
};
(async () => {
  let b = await chromium.launch({ headless: true });
  let rows = [];
  for (const [name, extra] of Object.entries(cases)) {
    for (const width of name === "several" ? [1440, 390, 320] : [1440]) {
      let p = await b.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      let q = new URLSearchParams({
        origin: "zurich",
        budget: "800",
        currency: "EUR",
        start: "2027-01-20",
        end: "2027-01-22",
        adults: "2",
        children: "0",
        when: "custom",
        airports: "0",
        ...extra,
      });
      if (extra.to) {
        q.delete("to");
        q.set(
          "toPlace",
          JSON.stringify({
            id: "city:VIE",
            type: "city",
            name: "Vienna",
            countryCode: "AT",
            cityCode: "VIE",
            iataCodes: ["VIE"],
            countryName: { en: "Austria", sq: "Austri" },
          }),
        );
      }
      await p.goto(origin + "/plan/results?" + q);
      await p.locator(".results-page").waitFor();
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(800);
      await p.screenshot({
        path: `${dir}/${phase}-${name}-${width}.png`,
        fullPage: true,
      });
      rows.push({
        name,
        width,
        url: p.url(),
        text: await p.locator("main").innerText(),
        overflow: await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        resources: await p.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .map((r) => ({
              name: r.name,
              bytes: r.encodedBodySize,
              type: r.initiatorType,
            })),
        ),
      });
      await p.close();
    }
  }
  fs.writeFileSync(
    `${dir}/${phase}-observations.json`,
    JSON.stringify(rows, null, 2),
  );
  await b.close();
})();
