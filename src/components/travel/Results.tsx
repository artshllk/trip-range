"use client";
import { localePath } from "@/i18n/routing";
import { requestBudget, planDerived } from "../../domain/money/provenance";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { aiCopy, unsupportedCopy } from "@/i18n/ai";
import { resultsCopy } from "@/i18n/results";
import type { UnsupportedPreference } from "@/domain/ai/intent";
import type { TripTemplate, TripRequest } from "@/domain/types";
import { requestQuery, updateRequestDates } from "@/domain/request";
import { discoveryHref } from "@/domain/destination-discovery";
import { pricePlan } from "@/domain/pricing";
import { curateTripCards } from "@/domain/trip-card-ranking";
import type { SearchIssue } from "@/services/travel";
import { formatMoney, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { ResultsSearchHeader } from "./ResultsSearchHeader";
import { ResultsHeading } from "./ResultsHeading";
import { SearchSheet } from "./SearchSheet";
import {
  resultsState,
  nearbyRecoveryAvailable,
  flightDiscoveryUnavailable,
} from "./results-state";
import { SourceIssues } from "./SourceIssues";
import { ResultCard } from "./ResultCard";
import { PriceLegend } from "./Budget";
import { useAiEnabled } from "../layout/AiFeature";

export function Results({
  bases,
  request,
  locale,
  t,
  issues,
  today,
  explanations = {},
  unsupported = [],
}: {
  bases: TripTemplate[];
  request: TripRequest;
  locale: Locale;
  t: Dictionary;
  issues: SearchIssue[];
  today: string;
  explanations?: Record<string, string>;
  unsupported?: UnsupportedPreference[];
}) {
  const aiEnabled = useAiEnabled();
  const [over, setOver] = useState(false);
  const [editor, setEditor] = useState<"search" | "filters" | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const copy = resultsCopy[locale];
  const result = curateTripCards(
    bases.map((b) => pricePlan(b, request)),
    request,
  );
  const url = (r: TripRequest) =>
    localePath(locale, `/plan/results?${requestQuery(r)}`);
  const refine = (r: TripRequest) =>
    startTransition(() => router.push(url(r), { scroll: false }));
  const activeFilters =
    request.styles.length +
    Number(!!request.noFlight) +
    Number(request.preferences.stayLevel !== "standard") +
    (["nearbyAirports", "car", "luggage", "familyStay"] as const).filter(
      (key) => request.preferences[key],
    ).length;
  const state = resultsState(result);
  const providerUnavailable = flightDiscoveryUnavailable(issues);
  const visibleCount =
    result.cards.length + (over ? result.slightlyOver.length : 0);

  // At most two contextual alternatives, alongside the always-available editor.
  const alternatives = [
    ...(request.destination
      ? [
          {
            title: copy.anywhere,
            request: { ...request, destination: undefined },
          },
        ]
      : []),
    ...(state === "no-fit" && request.preferences.stayLevel !== "simple"
      ? [
          {
            title: t.simpleAlt,
            request: {
              ...request,
              preferences: {
                ...request.preferences,
                stayLevel: "simple" as const,
              },
            },
          },
        ]
      : []),
    ...(nearbyRecoveryAvailable(request)
      ? [
          {
            title: copy.nearbyAction,
            request: {
              ...request,
              preferences: { ...request.preferences, nearbyAirports: true },
            },
          },
        ]
      : []),
    ...(request.styles.length
      ? [{ title: "Clear travel styles", request: { ...request, styles: [] } }]
      : []),
    ...(!request.noFlight &&
    request.scope !== "domestic" &&
    request.dates.mode !== "weekends" &&
    !request.dates.flexibleDays
      ? [
          {
            title: t.flexAlt,
            request: updateRequestDates(
              request,
              { flexible: true },
              request.dates.startDate,
            ),
          },
        ]
      : []),
  ].slice(0, 2);
  return (
    <main id="main" className="results-page">
      <ResultsSearchHeader
        request={request}
        locale={locale}
        t={t}
        today={today}
        onEdit={() => setEditor("search")}
      />
      <div className="shell results-shell">
        <div
          className="results-filters"
          role="group"
          aria-label={copy.filters}
          aria-busy={pending}
        >
          {(["beach", "city", "nature", "quiet"] as const).map((style) => (
            <button
              key={style}
              className={`pill result-taste ${request.styles.includes(style) ? "active" : ""} ${request.styles[0] === style ? "mobile-active" : ""}`}
              aria-pressed={request.styles.includes(style)}
              disabled={pending}
              onClick={() =>
                refine({
                  ...request,
                  styles: request.styles.includes(style)
                    ? request.styles.filter((s) => s !== style)
                    : [...request.styles, style],
                })
              }
            >
              {t[style]}
              <span className="filter-mobile-label" aria-hidden="true">
                {" "}
                ×
              </span>
            </button>
          ))}
          <span className="results-filter-divider" aria-hidden="true" />
          <label className="results-stay-select">
            <span>{t.stay}</span>
            <select
              value={request.preferences.stayLevel}
              disabled={pending}
              onChange={(e) =>
                refine({
                  ...request,
                  preferences: {
                    ...request.preferences,
                    stayLevel: e.target
                      .value as TripRequest["preferences"]["stayLevel"],
                  },
                })
              }
            >
              {(["simple", "standard", "comfort"] as const).map((level) => (
                <option key={level} value={level}>
                  {t[level]}
                </option>
              ))}
            </select>
          </label>
          <button
            className={`pill results-nearby ${request.preferences.nearbyAirports ? "active" : ""}`}
            aria-pressed={request.preferences.nearbyAirports}
            disabled={pending}
            onClick={() =>
              refine({
                ...request,
                preferences: {
                  ...request.preferences,
                  nearbyAirports: !request.preferences.nearbyAirports,
                },
              })
            }
          >
            <span className="results-switch" aria-hidden="true" />
            {copy.nearby}
          </button>
          <button
            className="pill results-more-filters"
            aria-haspopup="dialog"
            onClick={() => setEditor("filters")}
          >
            <span className="filter-desktop-label">{t.moreFilters}</span>
            <span className="filter-mobile-label">
              {copy.filtersButton}
              {activeFilters ? ` · ${activeFilters}` : ""}
            </span>
          </button>
          <p className="results-count small muted" role="status">
            {pending
              ? t.searching
              : providerUnavailable
                ? "Results unavailable"
                : `${visibleCount} ${visibleCount === 1 ? "destination" : "destinations"}`}
          </p>
        </div>
        {editor ? (
          <SearchSheet
            request={request}
            locale={locale}
            t={t}
            today={today}
            filtersOnly={editor === "filters"}
            results
            onClose={() => setEditor(null)}
          />
        ) : null}
        {aiEnabled && unsupported.length ? (
          <p className="small muted">
            {aiCopy[locale].unsupported}{" "}
            {unsupported.map((p) => unsupportedCopy[locale][p]).join(", ")}.
          </p>
        ) : null}
        <div className="results-sections">
          <ResultsHeading
            request={request}
            result={result}
            locale={locale}
            unavailable={providerUnavailable}
            revealOver={over}
          />
          {!providerUnavailable &&
          result.cards.length === 1 &&
          result.ideas.length === 1 &&
          nearbyRecoveryAvailable(request) ? (
            <button
              className="text-button results-inline-recovery"
              disabled={pending}
              onClick={() =>
                refine({
                  ...request,
                  preferences: { ...request.preferences, nearbyAirports: true },
                })
              }
            >
              {copy.nearbyAction} →
            </button>
          ) : null}
          {!providerUnavailable && result.cards.length ? (
            <section
              aria-labelledby="results-trips-title"
              className="result-list"
            >
              <h2 id="results-trips-title" className="sr-only">
                Trip results
              </h2>
              {result.cards.map((p, i) => (
                <ResultCard
                  key={p.id}
                  plan={p}
                  currentYear={today.slice(0, 4)}
                  locale={locale}
                  t={t}
                  index={i}
                  featured={result.cards.length === 1}
                  explanation={explanations[p.id]}
                />
              ))}
            </section>
          ) : null}
          {state === "empty" || state === "no-fit" || providerUnavailable ? (
            <section
              className="results-empty stack"
              data-state={state}
              aria-labelledby="result-alternatives"
            >
              <h2 id="result-alternatives">
                {providerUnavailable
                  ? copy.providerUnavailable
                  : state === "empty"
                    ? copy.empty
                    : state === "no-fit"
                      ? copy.noFit
                      : copy.insufficient}
              </h2>
              {providerUnavailable ? (
                <p className="muted">{copy.providerUnavailableNote}</p>
              ) : state === "empty" ? (
                <p className="muted">{copy.emptyNote}</p>
              ) : null}
              {!providerUnavailable && result.cheapest ? (
                <dl className="results-comparison">
                  <div>
                    <dt>{t.budget}</dt>
                    <dd>{formatMoney(requestBudget(request), locale)}</dd>
                  </div>
                  <div>
                    <dt>
                      {copy.cheapest} ·{" "}
                      {result.cheapest.destination.name[locale]}
                    </dt>
                    <dd>
                      {formatMoney(
                        planDerived(
                          result.cheapest.budget.budgetNeeded,
                          result.cheapest,
                        ),
                        locale,
                      )}
                    </dd>
                  </div>
                </dl>
              ) : null}
              <div className="results-alternatives">
                {providerUnavailable ? (
                  <button
                    className="button ember"
                    disabled={pending}
                    onClick={() => startTransition(() => router.refresh())}
                  >
                    {pending ? t.searching : "Try again"}
                  </button>
                ) : null}
                <button className="pill" onClick={() => setEditor("search")}>
                  {t.editSearch} →
                </button>
                {providerUnavailable ? (
                  <Link
                    className="pill"
                    prefetch={false}
                    href={discoveryHref(
                      localePath(locale, `/destinations`),
                      Object.fromEntries(
                        new URLSearchParams(requestQuery(request)),
                      ),
                    )}
                  >
                    {copy.browseGuides} →
                  </Link>
                ) : (
                  alternatives.map((a) => (
                    <Link className="pill" href={url(a.request)} key={a.title}>
                      {a.title} →
                    </Link>
                  ))
                )}
              </div>
            </section>
          ) : null}
          {!providerUnavailable && result.slightlyOver.length ? (
            <section className="stack results-over-section" aria-label={t.over}>
              <button
                className="button outline over-toggle"
                aria-expanded={over}
                aria-controls="over-budget-trips"
                onClick={() => setOver(!over)}
              >
                {over
                  ? t.hideOver
                  : result.slightlyOver.length === 1
                    ? t.showOverOne
                    : t.showOver.replace(
                        "{n}",
                        String(result.slightlyOver.length),
                      )}
              </button>
              <div id="over-budget-trips" hidden={!over}>
                {over ? (
                  <div className="result-list">
                    <h2 className="results-over-heading">
                      {copy.overHeading} ·{" "}
                      {formatMoney(requestBudget(request), locale)}
                    </h2>
                    {result.slightlyOver.map((p, i) => (
                      <ResultCard
                        key={p.id}
                        plan={p}
                        currentYear={today.slice(0, 4)}
                        locale={locale}
                        t={t}
                        index={result.cards.length + i}
                        explanation={explanations[p.id]}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
          <details className="results-methodology">
            <summary>
              {copy.how}
              <span aria-hidden="true">+</span>
            </summary>
            <div className="stack small muted">
              {bases.some((b) => b.transport.mode === "flight") ? (
                <p>
                  Flight destinations are ordered by return airfare where
                  available, not total trip cost. Room evidence has its own
                  scope and dates. Missing food, transport or room costs are not
                  zero, and a listed destination is not a budget verdict.
                </p>
              ) : (
                <>
                  <PriceLegend hybrid={false} t={t} />
                  <p>{copy.buffer}</p>
                  <p>{t.priceNote}</p>
                </>
              )}
              <p>{t.providerLimits}</p>
              <p>{t.overNote}</p>
              <SourceIssues issues={issues} t={t} />
            </div>
          </details>
        </div>
      </div>
    </main>
  );
}
