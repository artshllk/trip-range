import Link from "next/link";
import { SearchBar } from "@/components/travel/SearchBar";
import { TripCard } from "@/components/travel/TripCard";
import { CostRows } from "@/components/travel/Budget";
import { formatMoney } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import {
  breadcrumbs,
  breadcrumbSchema,
  type SeoLandingModel,
} from "@/seo/publication";
import { relatedLandings } from "@/seo/registry";
import { seoDatePresentation } from "@/seo/date-contract";
import { seoSearchHref } from "@/seo/summary";
import { JsonLd } from "./JsonLd";
import type { Money } from "@/domain/money/provenance";
// Summary sums arrive without their plan, so their inputs are not tracked (derived, inputs []).
import { derived, planDerived, requestBudget } from "@/domain/money/provenance";
const showMoney = (amount: Money) => formatMoney(amount, "en");
export function SeoLanding({
  model,
  t,
}: {
  model: SeoLandingModel;
  t: Dictionary;
}) {
  const { page, summary, request, cards, cheapest, state, today } = model;
  const dateCopy = seoDatePresentation(page.dateContract, request.dates);
  const crumbs = breadcrumbs(page),
    related = relatedLandings(page);
  const section = (id: (typeof page.sections)[number]) => {
    switch (id) {
      case "results":
        return (
          <section
            key={id}
            id="trip-options"
            className="stack"
            aria-labelledby="options-heading"
          >
            <div className="seo-answer stack">
              <h2 id="options-heading">
                {page.type === "budget"
                  ? `Where could ${showMoney(requestBudget(request))} take you?`
                  : "Compare complete-trip estimates"}
              </h2>
              {summary.destinationsChecked === 0 ? (
                <p>
                  We don’t have enough flight data to calculate useful examples
                  for this search right now. The search above still lets you try
                  your own dates and budget.
                </p>
              ) : (
                <>
                  <p>
                    <strong>
                      {summary.fitsCount}{" "}
                      {summary.fitsCount === 1
                        ? "destination fits"
                        : "destinations fit"}
                    </strong>{" "}
                    the {showMoney(requestBudget(request))} example budget,
                    including the safety buffer, among{" "}
                    <strong>
                      {summary.completeCalculationCount} destinations with
                      enough pricing data
                    </strong>
                    . This is a bounded shortlist, not every possible route from
                    {page.origin.name}.
                  </p>
                  {summary.completeCalculationCount === 0 ? (
                    <p>
                      We found destinations, but not enough matching flight
                      prices to confirm complete trip totals. Other costs remain
                      estimates; check current flights before deciding what
                      fits.
                    </p>
                  ) : null}
                  {summary.fitsCount === 0 &&
                  summary.completeCalculationCount > 0 ? (
                    <p>
                      No complete plan currently fits this example budget. Try
                      another date or adjust the search; a cheap flight alone is
                      not enough to establish a fit.
                    </p>
                  ) : null}
                  {state !== "ready" || summary.providerSupportedCount < 3 ? (
                    <p className="small muted">
                      Flight coverage is limited for this example. Unpriced
                      flight ideas do not count as complete trips or budget
                      matches.
                    </p>
                  ) : null}
                  {summary.lowestCostDestination &&
                  summary.cheapestBudgetNeeded &&
                  summary.cheapestEstimatedSpend ? (
                    <p>
                      The lowest budget needed in this calculation is{" "}
                      <strong>
                        {showMoney(derived(summary.cheapestBudgetNeeded, []))}
                      </strong>{" "}
                      for {summary.lowestCostDestination}:{" "}
                      {showMoney(derived(summary.cheapestEstimatedSpend, []))}{" "}
                      estimated spending plus a reserve. This is not a claim
                      about the cheapest trip on the market.
                    </p>
                  ) : null}
                  <p className="small muted">
                    {summary.recentFareCount} matching recent flight{" "}
                    {summary.recentFareCount === 1 ? "fare" : "fares"} ·{" "}
                    {summary.unpricedFlightCount} unpriced flight{" "}
                    {summary.unpricedFlightCount === 1 ? "idea" : "ideas"}.{" "}
                    {summary.referenceFareCount > 0
                      ? `${summary.referenceFareCount} destinations also have a monthly reference fare for different dates; it does not price this trip.`
                      : ""}
                  </p>
                </>
              )}
              <p className="small muted">
                Estimates, not booking offers.{" "}
                <Link href="/methodology">How these totals are calculated</Link>
              </p>
              {summary.observationRange ? (
                <p className="small muted">
                  Dated provider fare observations:{" "}
                  {summary.observationRange.first}
                  {summary.observationRange.last !==
                  summary.observationRange.first
                    ? ` to ${summary.observationRange.last}`
                    : ""}
                  . These are observation dates, not confirmation of current
                  availability.
                </p>
              ) : null}
            </div>
            {cards.length ? (
              <>
                {summary.fitsCount === 0 &&
                cards.every((p) => p.pricingCompleteness === "complete") ? (
                  <p className="notice">
                    These comparisons are above the example budget. They are
                    starting points for changing the dates or budget, not
                    affordable matches.
                  </p>
                ) : null}
                <div className="results-grid">
                  {cards.map((plan, index) => (
                    <TripCard
                      key={plan.id}
                      plan={plan}
                      locale="en"
                      t={t}
                      index={index}
                      headingLevel={3}
                    />
                  ))}
                </div>
              </>
            ) : null}
            <Link
              className="button ember seo-main-cta"
              href={seoSearchHref(request)}
            >
              Find trips for my budget →
            </Link>
          </section>
        );
      case "budgets":
        return (
          <section key={id} className="stack">
            <h2>
              {page.type === "origin"
                ? "Start with a weekend or a total budget"
                : "Explore the weekend budget"}
            </h2>
            <p>
              The amount is for the whole party, including the reserve. The
              current example uses {showMoney(requestBudget(request))}; change
              it freely in the search.
            </p>
            <ul className="seo-link-list">
              {related
                .filter((p) => p.type !== "origin")
                .map((p) => (
                  <li key={p.id}>
                    <Link href={p.path}>{p.h1} →</Link>
                  </li>
                ))}
            </ul>
            <p className="muted">
              Other budget amounts can be tested in the planner. We publish
              dedicated guides only when there is enough useful data to support
              them.
            </p>
          </section>
        );
      case "dates":
        return (
          <section key={id} className="stack">
            <h2>{dateCopy.heading}</h2>
            <p>{dateCopy.description}</p>
            <p>{dateCopy.evidenceNote}</p>
          </section>
        );
      case "coverage":
        return (
          <section key={id} className="stack">
            <h2>What {showMoney(requestBudget(request))} covers</h2>
            <p>
              {showMoney(requestBudget(request))} is the total budget for the
              two-adult example, not a flight-only allowance. The cost
              categories below must fit together, with money reserved for the
              safety buffer.
            </p>
            {cheapest && summary.fitsCount > 0 ? (
              <div className="panel stack">
                <h3>A calculated example: {cheapest.destination.name.en}</h3>
                <CostRows plan={cheapest} locale="en" t={t} />
                <p className="small">
                  Budget needed:{" "}
                  {showMoney(
                    planDerived(cheapest.budget.budgetNeeded, cheapest),
                  )}
                  , including{" "}
                  {showMoney(planDerived(cheapest.safetyBuffer, cheapest))} kept
                  as reserve.
                </p>
              </div>
            ) : (
              <p>
                There is no qualifying example to break down at the moment.
                Change the search to compare other dates or budgets.
              </p>
            )}
          </section>
        );
      case "value":
        return (
          <section key={id} className="stack">
            <h2>Value means the whole trip</h2>
            <p>
              {summary.fitsCount > 0 && cheapest
                ? `${cheapest.destination.name.en} has the lowest calculated budget needed in this shortlist. `
                : "No within-budget recommendation is available for this example. "}
              Trip Range ranks the complete budget and fare confidence, and
              considers supported airport-transfer costs. A cheaper flight can
              lose its advantage once the stay and ground costs are counted.
            </p>
          </section>
        );
      case "nearby":
        return (
          <section key={id} className="stack">
            <h2>Could another departure airport help?</h2>
            <p>{page.nearbyNote}</p>
          </section>
        );
      case "methodology":
        return (
          <section key={id} id="methodology" className="stack">
            <h2>How the budget is calculated</h2>
            <p>
              Each total covers flights, stay, food, local transport and
              activities for the whole party, plus a separate safety buffer.{" "}
              <Link href="/methodology">
                Read how Trip Range calculates trip costs
              </Link>
              .
            </p>
          </section>
        );
      case "questions":
        return (
          <section key={id} className="stack">
            <h2>Useful questions</h2>
            {page.questions.map((q) => (
              <div className="stack" key={q.question}>
                <h3>{q.question}</h3>
                <p>{q.answer}</p>
              </div>
            ))}
          </section>
        );
      case "related":
        return (
          <section key={id} className="stack">
            <h2>Keep exploring</h2>
            <ul className="seo-link-list">
              {related.map((p) => (
                <li key={p.id}>
                  <Link href={p.path}>{p.h1} →</Link>
                </li>
              ))}
            </ul>
          </section>
        );
    }
  };
  return (
    <main id="main" className="shell section seo-landing">
      <JsonLd value={breadcrumbSchema(page)} />
      <nav aria-label="Breadcrumb" className="seo-breadcrumb">
        <ol>
          {crumbs.map((crumb, i) => (
            <li key={crumb.url}>
              {i === crumbs.length - 1 ? (
                <span aria-current="page">{crumb.name}</span>
              ) : (
                <Link href={new URL(crumb.url).pathname}>{crumb.name}</Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="seo-intro stack">
        <p className="eyebrow ember-text">Whole-trip budget discovery</p>
        <h1>{page.h1}</h1>
        <p>{page.intro}</p>
      </div>
      <div className="seo-search stack">
        <SearchBar initial={request} locale="en" t={t} today={today} />
        <p className="small muted">
          Example: {page.origin.name} · {dateCopy.summary} · 2 adults · 2 nights
          · {showMoney(requestBudget(request))} total budget. Search changes
          open the normal Trip Range results.
        </p>
      </div>
      {page.sections.map(section)}
    </main>
  );
}
