import { planDerived } from "../../domain/money/provenance";
import type { TripPlan } from "../../domain/types";
import { matchingFlight } from "../../domain/flight-pricing";
import { formatMoney, type Locale } from "../../i18n/config";

export const gatewayCopy = {
  en: {
    known: "Known costs so far",
    check: "Onward transfer needs checking",
    missing: "Flight and onward transfer need checking",
    incomplete: "Whole-trip total and budget fit are not yet known.",
  },
  sq: {
    known: "Kostot e njohura deri tani",
    check: "Transferi në vijim duhet kontrolluar",
    missing: "Fluturimi dhe transferi në vijim duhen kontrolluar",
    incomplete: "Totali i udhëtimit dhe përshtatja me buxhetin ende nuk dihen.",
  },
};

/** Arrival-side context is separate from the departure-airport comparison. */
export function GatewaySummary({
  plan,
  locale,
}: {
  plan: TripPlan;
  locale: Locale;
}) {
  if (plan.directArrival)
    return (
      <p className="small muted gateway-summary">
        {locale === "en" ? "Arrive via " : "Mbërritja përmes "}
        {plan.directArrival.label[locale]}
        {plan.directArrival.airportCode
          ? ` (${plan.directArrival.airportCode})`
          : ""}
        .
      </p>
    );
  if (!plan.arrival) return null;
  const name = plan.destination.name[locale];
  return (
    <p className="small muted gateway-summary">
      {locale === "en"
        ? `Arrive via ${plan.arrival.label.en} · onward transfer to ${name} required.`
        : `Mbërritja përmes ${plan.arrival.label.sq} · kërkohet transfer drejt ${name}.`}
    </p>
  );
}

export function TransferUnpricedSummary({
  plan,
  locale,
}: {
  plan: Extract<
    TripPlan,
    { pricingCompleteness: "required-transfer-unpriced" }
  >;
  locale: Locale;
}) {
  const copy = gatewayCopy[locale];
  return (
    <div className="stack result-price-unpriced">
      <p className="result-price-status">
        {matchingFlight(plan) ? copy.check : copy.missing}
      </p>
      <div>
        <p className="small muted">{copy.known}</p>
        <strong>
          ≈ {formatMoney(planDerived(plan.knownCosts, plan), locale)}
        </strong>
      </div>
      <p className="small muted">{copy.incomplete}</p>
    </div>
  );
}
