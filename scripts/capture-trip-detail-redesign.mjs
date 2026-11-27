/** Production-rendered local trip comparisons. Prototype server is required for the before phase. */
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
(async () => {
  const dir = process.cwd() + "/docs/verification/trip-detail-redesign";
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ headless: true });
  const rows = [];
  const phase = process.argv[2] || "before";
  for (const width of [1440, 390, 320]) {
    const p = await b.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    let errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.addInitScript(() => {
      window.qaCLS = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          if (!e.hadRecentInput) window.qaCLS += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await p.goto(
      "http://127.0.0.1:3162/plan/trips/vienna?origin=zurich&budget=800&currency=EUR&start=2027-02-20&end=2027-02-22&when=custom&adults=2&children=0&airports=0",
    );
    await p.locator(".trip-detail-page").waitFor();
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(600);
    await p.screenshot({
      path: `${dir}/${phase}-${width}.png`,
      fullPage: true,
    });
    rows.push({
      width,
      errors,
      text: await p.locator("main").innerText(),
      ...(await p.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
        cls: window.qaCLS,
        resources: performance
          .getEntriesByType("resource")
          .map((r) => ({
            name: r.name,
            bytes: r.encodedBodySize,
            type: r.initiatorType,
          })),
      }))),
    });
    if (width === 1440)
      for (const [name, sel] of Object.entries({
        budget: ".trip-budget",
        days: "#days",
        attractions: "#worth-seeing",
        stay: "#where-to-stay",
      }))
        if (await p.locator(sel).count())
          await p
            .locator(sel)
            .screenshot({ path: `${dir}/${phase}-${name}.png` });
    await p.locator("#price-details").evaluate((e) => (e.open = true));
    await p.locator("#trip-sources").evaluate((e) => (e.open = true));
    await p.screenshot({
      path: `${dir}/${phase}-expanded-${width}.png`,
      fullPage: true,
    });
    await p.close();
  }
  fs.writeFileSync(
    `${dir}/${phase}-observations.json`,
    JSON.stringify(rows, null, 2),
  );
  if (phase === "before") {
    const p = await b.newPage({ viewport: { width: 3200, height: 1100 } });
    await p.goto(
      "http://127.0.0.1:3111/GoEksplo%20Trip%20Detail%20(offline%20single%20file).html",
    );
    await p.waitForTimeout(2500);
    console.log("frames", await p.locator(".sc-host").count());
    for (let i = 0; i < (await p.locator(".sc-host").count()); i++) {
      const l = p.locator(".sc-host").nth(i);
      const box = await l.boundingBox();
      console.log(i, box);
      if (box?.width >= 300)
        await l.screenshot({
          path: `${dir}/prototype-${i}.png`,
          timeout: 30000,
        });
    }
  }
  await b.close();
  console.log(
    rows.map((r) => ({
      width: r.width,
      height: r.height,
      overflow: r.overflow,
      errors: r.errors,
      cls: r.cls,
    })),
  );
})();
