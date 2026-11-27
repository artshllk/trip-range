/** Isolated synthetic UI harness; no application route, media record or provider is added. */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResultCard } from "../../src/components/travel/ResultCard";
import { FullTrip } from "../../src/components/travel/FullTrip";
import {
  budgetMediaFixture,
  budgetMediaDetailFixture,
  budgetStates,
} from "./budget-media";
import { trustedImageFixture } from "../destination-image-fixtures";
import { isCurrency } from "../../src/domain/money/currency";
import en from "../../src/i18n/en.json";
import sq from "../../src/i18n/sq.json";

const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "sq" ? "sq" : "en";
document.documentElement.lang = locale;
const state =
  budgetStates.find((s) => s === params.get("state")) ?? "affordable";
const currency = params.get("currency");
const detail = params.has("detail");
const { base, request, plan } = (
  detail ? budgetMediaDetailFixture : budgetMediaFixture
)(state, isCurrency(currency) ? currency : "EUR");
const media = params.get("media") ?? "missing";
const trusted = { ...trustedImageFixture, destinationId: plan.destination.id };
if (
  ["approved", "failed", "fallback", "both-failed", "unverified"].includes(
    media,
  )
) {
  plan.destination.image = {
    ...trusted,
    src: ["failed", "fallback", "both-failed"].includes(media)
      ? "/destinations/qa-failed.png"
      : trusted.src,
    verification: media === "unverified" ? "unverified" : "verified",
  };
  if (["fallback", "both-failed"].includes(media))
    plan.destination.fallbackImage = {
      ...trusted,
      src:
        media === "fallback"
          ? "/destinations/qa-alternate.png"
          : "/destinations/qa-failed-alternate.png",
      author: "Synthetic fallback photographer",
    };
}
if (params.has("long"))
  plan.destination.name = {
    en: "Synthetic City of the Long River and the Northern Mountain Gardens",
    sq: "Qyteti Sintetik i Lumit të Gjatë dhe Kopshteve të Maleve Veriore",
  };
const root = document.getElementById("root")!;
root.dataset.budget = JSON.stringify(plan.budget ?? null);
root.dataset.requestBudget = JSON.stringify(request.budget);

function CardFixture() {
  const [replacement, setReplacement] = useState<
    "original" | "approved" | "missing"
  >("original");
  const [hidden, setHidden] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [mount, setMount] = useState(0);
  useEffect(() => {
    root.dataset.ready = "true";
    if (!params.has("lifecycle")) return;
    const act = (event: Event) => {
      switch ((event as CustomEvent<string>).detail) {
        case "replace":
          setReplacement("approved");
          break;
        case "remove":
          setReplacement("missing");
          break;
        case "hide":
          setHidden(true);
          break;
        case "show":
          setHidden(false);
          break;
        case "reorder":
          setReversed((value) => !value);
          break;
        case "remount":
          // Simulate new route data without a photo while the old card still reserves media.
          setReplacement("missing");
          setMount((value) => value + 1);
          break;
      }
    };
    window.addEventListener("budget-media-qa", act);
    return () => window.removeEventListener("budget-media-qa", act);
  }, []);
  const current =
    replacement === "original"
      ? plan
      : {
          ...plan,
          destination: {
            ...plan.destination,
            image:
              replacement === "approved"
                ? {
                    ...trusted,
                    src: "/destinations/qa-replacement.png",
                    author: "Synthetic replacement photographer",
                  }
                : undefined,
            fallbackImage: undefined,
          },
        };
  const primary = (
    <div
      key="primary"
      data-qa-primary
      style={{ display: hidden ? "none" : undefined }}
    >
      <ResultCard
        key={mount}
        plan={current}
        locale={locale}
        t={locale === "en" ? en : sq}
        index={0}
        currentYear="2026"
      />
    </div>
  );
  const other = (
    <ResultCard
      key="other"
      plan={{
        ...plan,
        id: "synthetic-second",
        destination: {
          ...plan.destination,
          name: {
            en: "Second synthetic destination",
            sq: "Destinacioni i dytë sintetik",
          },
          image: undefined,
          fallbackImage: undefined,
        },
      }}
      locale={locale}
      t={locale === "en" ? en : sq}
      index={1}
      currentYear="2026"
    />
  );
  return (
    <div className="result-list">
      {params.has("lifecycle")
        ? reversed
          ? [other, primary]
          : [primary, other]
        : primary}
    </div>
  );
}
createRoot(root).render(
  <AppRouterContext.Provider
    value={{
      bfcacheId: "synthetic-budget-media",
      back() {},
      forward() {},
      refresh() {},
      push() {},
      replace() {},
      prefetch() {},
    }}
  >
    {detail ? (
      <FullTrip
        base={base}
        initial={request}
        scenario="none"
        today="2026-10-08"
        locale={locale}
        t={locale === "en" ? en : sq}
      />
    ) : (
      <main className="results-page">
        <div className="shell results-shell">
          <h1 style={{ fontSize: 24, margin: "24px 0" }}>
            Synthetic budget / media QA
          </h1>
          <CardFixture />
          <div style={{ height: 1200 }} aria-hidden="true" />
        </div>
      </main>
    )}
  </AppRouterContext.Provider>,
);
