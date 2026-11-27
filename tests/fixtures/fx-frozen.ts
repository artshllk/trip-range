import type { FxData } from "../../src/domain/money/fx";

/**
 * Frozen ECB snapshot for tests. The live file (content/money/fx/ecb-reference.json)
 * is rewritten daily by scripts/refresh-fx.mjs, so tests with a fixed clock must never
 * read it. These are the reviewed ECB rates of 2026-10-13, under the live id that
 * transfer policies pin.
 * DKK/TRY for that same date were checked against ECB's eurofxref-hist-90d.xml
 * on 2026-11-02; they are not copied from a newer reference date.
 * CZK/HUF/SEK/PLN for that same date were taken from ECB's eurofxref-hist-90d.xml on
 * 2026-11-24 (the same file reproduces the six rates above exactly).
 */
export const fxData = {
  schemaVersion: 1,
  records: [
    {
      id: "ecb-reference",
      source: "ecb",
      sourceUrl:
        "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
      sourceDate: "2026-10-13",
      checkedAt: "2026-10-13T15:53:03Z",
      reviewAfter: "2026-10-20T00:00:00Z",
      reviewStatus: "reviewed",
      baseCurrency: "EUR",
      rates: [
        {
          currency: "EUR",
          perEuro: "1",
        },
        {
          currency: "GBP",
          perEuro: "0.84460",
        },
        {
          currency: "USD",
          perEuro: "1.1188",
        },
        {
          currency: "CHF",
          perEuro: "0.9312",
        },
        {
          currency: "JPY",
          perEuro: "176.91",
        },
        {
          currency: "DKK",
          perEuro: "7.4753",
        },
        {
          currency: "TRY",
          perEuro: "55.2325",
        },
        {
          currency: "CZK",
          perEuro: "24.368",
        },
        {
          currency: "HUF",
          perEuro: "364.31",
        },
        {
          currency: "SEK",
          perEuro: "11.1698",
        },
        {
          currency: "PLN",
          perEuro: "4.3768",
        },
      ],
    },
  ],
} as FxData;
