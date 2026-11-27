/** Local synthetic provider QA: no live AI, FX or affiliate requests. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.VERIFY_ORIGIN || "http://127.0.0.1:3111";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
let stage = "setup";
try {
  const page = await browser.newPage();
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "/* local analytics stub */",
    }),
  );
  const errors = [],
    forbidden = [];
  page.on("pageerror", () => errors.push(stage));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(stage);
  });
  page.on("request", (r) => {
    if (/\/api\/ai\/|api.openai.com|\/api\/affiliate\//.test(r.url()))
      forbidden.push(stage);
  });
  page.setDefaultTimeout(20000);
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "horizontal overflow",
    );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.emulateMedia({
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    for (const [name, currency, label] of [
      ["Zurich", "CHF", "CHF 500"],
      ["London", "GBP", "£500"],
      ["New York", "USD", "$500"],
      ["Tokyo", "EUR", "€500"],
    ]) {
      stage = `${width}px ${name}`;
      await page.goto(origin + "/");
      await page.locator(".search-field").first().click();
      await page.locator("dialog").getByRole("combobox").fill(name);
      await page.getByRole("option").filter({ hasText: name }).first().click();
      await page
        .getByRole("button", { name: "Done", exact: true })
        .last()
        .click();
      assert.match(
        await page.locator(".search-field").nth(4).innerText(),
        new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      if (currency !== "EUR")
        assert.ok(
          (await page.locator(".search-workspace").innerText()).includes(
            "No currency conversion",
          ),
        );
      await noOverflow();
      // Increase the numeric budget to inspect complete trips in every native planning currency.
      await page.locator(".search-field").nth(4).click();
      await page.locator('dialog input[type="number"]').fill("2000");
      assert.equal(
        await page.getByRole("combobox", { name: /^Currency/ }).inputValue(),
        currency,
      );
      await page
        .getByRole("button", { name: "Done", exact: true })
        .last()
        .click();
      await page.locator(".search-submit").click();
      await page.waitForURL("**/plan/results?**");
      assert.deepEqual(new URL(page.url()).searchParams.getAll("currency"), [
        currency,
      ]);
      await page.locator(".trip-card").first().waitFor();
      assert.equal(
        await page.locator('meta[name="robots"]').getAttribute("content"),
        "noindex, follow",
      );
      assert.ok(
        (await page.locator(".trip-card").first().innerText()).includes(
          currency === "GBP"
            ? "£"
            : currency === "USD"
              ? "$"
              : currency === "CHF"
                ? "CHF"
                : "€",
        ),
      );
      await noOverflow();
      await page.locator(".trip-card a.button").first().click();
      await page.waitForURL("**/plan/trips/**");
      assert.equal(new URL(page.url()).searchParams.get("currency"), currency);
      await page.reload();
      await page
        .getByRole("button", { name: "Edit search", exact: true })
        .click();
      assert.equal(await page.locator("dialog[open]").count(), 1);
      await page.locator("dialog .search-field").nth(4).click();
      assert.equal(await page.locator("dialog[open]").count(), 1);
      assert.equal(
        await page.getByRole("combobox", { name: /^Currency/ }).inputValue(),
        currency,
      );
      await noOverflow();
      if (width === 390 && name === "London")
        await page.screenshot({
          path: "/tmp/goeksplo-currency-mobile.png",
          animations: "disabled",
        });
      if (width === 1440 && name === "New York")
        await page.screenshot({
          path: "/tmp/goeksplo-currency-desktop.png",
          animations: "disabled",
        });
      console.log(
        `PASS ${stage}: origin currency, no FX, results/detail/refresh/edit continuity, one sheet, no overflow`,
      );
    }
    stage = `${width}px explicit SEO currency reselect`;
    await page.goto(
      origin + "/plan/results?origin=zurich&budget=2000&currency=EUR",
    );
    await page
      .getByRole("button", { name: "Edit search", exact: true })
      .click();
    await page.locator(".search-field").first().click();
    await page.locator("dialog").getByRole("combobox").fill("");
    await page.locator("dialog").getByRole("combobox").fill("Zurich");
    await page
      .getByRole("option")
      .filter({ hasText: "Zurich" })
      .first()
      .click();
    await page.locator(".search-inline-editor > button").click();
    await page.locator(".search-submit").click();
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(new URL(page.url()).searchParams.get("currency"), "EUR");
    assert.ok(
      (await page.locator(".results-search-summary").innerText()).includes(
        "€2,000",
      ),
    );
    stage = `${width}px Albanian`;
    await page.goto(origin + "/sq");
    assert.equal(await page.locator("html").getAttribute("lang"), "sq");
    await page.locator(".search-submit").click();
    await page.waitForURL("**/sq/plan/results?**");
    assert.equal(new URL(page.url()).searchParams.get("currency"), "EUR");
    await page.locator(".trip-card").first().waitFor();
    await noOverflow();
  }
  assert.deepEqual(errors, [], "client errors");
  assert.deepEqual(forbidden, [], "unexpected AI or affiliate calls");
  console.log(
    "PASS EN/SQ and all four planning currencies at 1440px and 390px",
  );
} catch (error) {
  console.error(
    `FAIL ${stage}: ${String(error?.message ?? "browser failure")
      .split("\n")[0]
      .slice(0, 200)}`,
  );
  console.error(
    String(error?.stack ?? "")
      .split("\n")
      .find((l) => l.includes("verify-currency-browser.mjs")) ?? "",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
