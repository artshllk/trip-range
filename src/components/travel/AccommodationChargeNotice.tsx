import type { TripPlan } from "../../domain/types";
import { planDerived, planningEstimate } from "../../domain/money/provenance";
import { formatMoney, type Locale } from "../../i18n/config";
import { resultsCopy } from "../../i18n/results";
import {
  fitUnconfirmedText,
  inheritedTaxText,
  stayAttributionText,
  stayFallbackText,
  stayBasisText,
} from "../../i18n/stay-basis";

/** Visible next to the headline, even when flights are not priced. */
export function PanelTaxNotice({
  plan,
  locale,
}: {
  plan: TripPlan;
  locale: Locale;
}) {
  const x = plan.lodgingTax;
  if (!x) return null;
  const en = locale === "en";
  const amount = x.amount
    ? formatMoney(planningEstimate(x.amount), locale)
    : "";
  const upper = x.upperAllowance
    ? formatMoney(planningEstimate(x.upperAllowance), locale)
    : "";
  return (
    <div className="small panel-tax-disclosure">
      <p className="stay-basis">{stayBasisText(plan, locale)}</p>
      {stayFallbackText(plan, locale) ? (
        <p className="stay-fallbacks">{stayFallbackText(plan, locale)}</p>
      ) : null}
      {x.treatment === "possible" ? (
        <p>
          <a href={x.source}>{en ? "Lodging tax" : "Taksa e qëndrimit"}</a>
          {amount
            ? en
              ? `: about ${amount}.`
              : `: rreth ${amount}.`
            : en
              ? ": amount unknown."
              : ": shuma nuk dihet."}{" "}
          {en
            ? `May already be in the room price, so we have not added this possible extra. ${x.atHotel ? "If charged separately, it is paid to the hotel. " : ""}${upper ? "The budget check allows up to " + upper + " extra." : "We cannot put an upper limit on it. Budget fit unconfirmed."}`
            : `Mund të jetë në çmimin e dhomës, ndaj nuk e kemi shtuar këtë kosto të mundshme. ${x.atHotel ? "Nëse tarifohet veçmas, paguhet te hoteli. " : ""}${upper ? "Për buxhetin llogarisim deri në " + upper + " shtesë." : "Nuk dimë kufirin e sipërm të saj. Përshtatja me buxhetin mbetet e pasigurt."}`}
        </p>
      ) : x.treatment === "extra" ? (
        <p>
          <a href={x.source}>{en ? "Lodging tax" : "Taksa e qëndrimit"}</a>
          {amount
            ? en
              ? `: ${x.operatorAmount ? "" : "about "}${amount}, included once in the costs shown.`
              : `: ${x.operatorAmount ? "" : "rreth "}${amount}, e përfshirë vetëm një herë në kostot e shfaqura.`
            : en
              ? ": extra, but we do not know the amount."
              : ": shtesë, por shuma nuk dihet."}
          {x.upperAllowance && x.upperAllowance.cents > 0
            ? en
              ? ` The budget check allows a further ${upper} because we do not know exactly how much of the room price is taxable.`
              : ` Për buxhetin llogarisim edhe ${upper}, sepse nuk dimë saktësisht cila pjesë e çmimit të dhomës tatohet.`
            : null}
        </p>
      ) : x.treatment === "inherited" ? (
        <p>{inheritedTaxText(plan, locale)}</p>
      ) : null}
      {stayAttributionText(plan, locale) ? (
        <p className="eurostat-attribution">
          {stayAttributionText(plan, locale)}
        </p>
      ) : null}
    </div>
  );
}

export function AccommodationChargeNotice({
  plan,
  locale,
}: {
  plan: TripPlan;
  locale: Locale;
}) {
  const charges = plan.accommodation?.charges;
  const copy = resultsCopy[locale];
  if (charges?.status === "included" || charges?.status === "panel" || !charges)
    return null;
  return (
    <p className="small accommodation-charge-notice">
      {charges.status === "property-dependent"
        ? `${copy.propertyCharges[charges.charge]} ${copy.propertyChargeNote}`
        : copy.missingAccommodationCharges}
    </p>
  );
}

export function ConditionalPropertyTotal({
  plan,
  locale,
}: {
  plan: Extract<
    TripPlan,
    {
      pricingCompleteness: "property-charges-conditional" | "fit-unconfirmed";
    }
  >;
  locale: Locale;
}) {
  const copy = resultsCopy[locale];
  return (
    <div className="result-price result-price-conditional">
      <p className="small muted">
        {plan.pricingCompleteness === "fit-unconfirmed"
          ? fitUnconfirmedText(plan.fitUnconfirmedBy, locale)
          : copy.beforePropertyCharges}
      </p>
      <p className="total">
        <strong>
          ≈ {formatMoney(planDerived(plan.conditionalTotal, plan), locale)}
        </strong>
      </p>
      <p className="small muted">
        {plan.pricingCompleteness !== "fit-unconfirmed"
          ? copy.conditionalReserve
          : null}
      </p>
      <AccommodationChargeNotice plan={plan} locale={locale} />
    </div>
  );
}
