/**
 * Transcribes the ECB daily euro reference rates into content/money/fx/ecb-reference.json.
 * Transcription from the authoritative feed is not a judgment call, so the snapshot is
 * written as reviewed without a human sign-off (decided 2026-10-28). Validity: 30 days
 * from the ECB date, with shorter currency limits enforced during conversion.
 * Same-date snapshots are rewritten if currency coverage or feed rates change.
 *   node scripts/refresh-fx.mjs           fetch and write
 *   node scripts/refresh-fx.mjs --check   fetch and report, never write
 */
import { readFileSync, writeFileSync } from "node:fs";

const FEED = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const FILE = "content/money/fx/ecb-reference.json";
// Evidence currencies (src/domain/money/fx.ts evidenceMinorUnits), EUR implicit.
const CURRENCIES = [
  "GBP",
  "USD",
  "CHF",
  "JPY",
  "DKK",
  "TRY",
  "CZK",
  "HUF",
  "SEK",
  "PLN",
];
const VALID_DAYS = 30;

const args = process.argv.slice(2);
if (args.some((a) => a !== "--check")) {
  console.error("usage: node scripts/refresh-fx.mjs [--check]");
  process.exit(2);
}
const response = await fetch(FEED, { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw Error(`ECB feed HTTP ${response.status}`);
const xml = await response.text();
const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
if (!date) throw Error("ECB feed: no reference date");
const rates = CURRENCIES.map((currency) => {
  const perEuro = xml.match(
    new RegExp(`currency=['"]${currency}['"]\\s+rate=['"]([0-9.]+)['"]`),
  )?.[1];
  if (!perEuro || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,8})?$/.test(perEuro))
    throw Error(`ECB feed: no valid ${currency} rate`);
  return { currency, perEuro };
});

let previous;
try {
  previous = JSON.parse(readFileSync(FILE, "utf8"));
} catch {}
if (
  previous?.sourceDate === date &&
  JSON.stringify(previous.rates) ===
    JSON.stringify([{ currency: "EUR", perEuro: "1" }, ...rates])
) {
  console.log(JSON.stringify({ status: "unchanged", sourceDate: date }));
  process.exit(0);
}
const checkedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const reviewAfter = new Date(
  Date.parse(`${date}T00:00:00Z`) + VALID_DAYS * 86400000,
)
  .toISOString()
  .replace(/\.\d{3}Z$/, "Z");
const snapshot = {
  id: "ecb-reference",
  source: "ecb",
  sourceUrl:
    "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
  sourceDate: date,
  checkedAt,
  reviewAfter,
  reviewStatus: "reviewed",
  baseCurrency: "EUR",
  rates: [{ currency: "EUR", perEuro: "1" }, ...rates],
};
if (args[0] === "--check") {
  console.log(JSON.stringify({ status: "would-write", snapshot }));
  process.exit(0);
}
writeFileSync(FILE, JSON.stringify(snapshot, null, 2) + "\n");
console.log(
  JSON.stringify({
    status: "written",
    sourceDate: date,
    previous: previous?.sourceDate ?? null,
  }),
);
