/** Test-only server rendering of the actual budget component. Never imported by application code. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { BudgetPanel } from "../src/components/travel/Budget";
import type { Dictionary } from "../src/i18n/dictionaries";
import { pricePlan } from "../src/domain/pricing";
import { costProfile, costTrip } from "./cost-profile-fixtures";

export function renderCostBrowserFixture(
  locale: "en" | "sq",
  unpriced: boolean,
  css: string,
) {
  const { request, base } = costTrip();
  const plan = pricePlan(
    unpriced
      ? {
          ...base,
          transport: {
            mode: "flight",
            flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
          },
        }
      : base,
    request,
    "none",
    undefined,
    { today: "2026-10-08", profiles: [costProfile()] },
  );
  const t: Dictionary = JSON.parse(
    readFileSync(`src/i18n/${locale}.json`, "utf8"),
  );
  const content = renderToStaticMarkup(
    createElement(BudgetPanel, { plan, locale, t }),
  );
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Synthetic reviewed-cost QA</title><style>${css}</style></head><body><main style="max-width:760px;margin:24px auto;padding:16px"><h1>Synthetic reviewed-cost QA</h1><p>Test amounts only — never production evidence.</p><aside class="trip-budget stack">${content}</aside></main></body></html>`;
}
