import { PanelTaxNotice } from "./AccommodationChargeNotice";
import { quoteMoney } from "../../domain/money/provenance";
import type { TripPlan } from "../../domain/types";
import { formatMoney, type Locale } from "../../i18n/config";
import { stayCopy } from "../../i18n/accommodation";

export function stayAmountLabel(plan: TripPlan, locale: Locale) {
  const quote = plan.accommodation?.quote;
  return quote
    ? formatMoney(quoteMoney(quote), locale)
    : stayCopy[locale].unavailable;
}
export function StayUnavailableSummary({ locale }: { locale: Locale }) {
  return (
    <p className="small muted stay-unavailable">
      {stayCopy[locale].unavailable}. {stayCopy[locale].incomplete}
    </p>
  );
}
export function StayPrice({
  plan,
  locale,
}: {
  plan: TripPlan;
  locale: Locale;
}) {
  const kind = plan.accommodation?.kind ?? "unavailable";
  return (
    <p className="mono trip-stay-price" data-stay-evidence={kind}>
      {kind !== "unavailable" ? "≈ " : ""}
      {stayAmountLabel(plan, locale)}
      {kind !== "unavailable" ? <> · {stayCopy[locale][kind]}</> : null}
    </p>
  );
}
/** Scope and caveats are shown without a property name, booking link or invented savings. */
export function StayEvidenceDetails({
  plan,
  locale,
  allocation = false,
}: {
  plan: TripPlan;
  locale: Locale;
  allocation?: boolean;
}) {
  const stay = plan.accommodation;
  if (!stay || stay.kind === "unavailable") return null;
  const copy = stayCopy[locale];
  if (allocation)
    return (
      <p className="small muted">
        {stay.rooms} {copy.rooms} × {stay.paidNights} {copy.nights}.{" "}
        {stay.kind === "provider-priced"
          ? copy.providerAllocation
          : copy.planningAllocation}
      </p>
    );
  return (
    <div className="small muted stay-evidence" data-stay-evidence={stay.kind}>
      <PanelTaxNotice plan={plan} locale={locale} />
      <p>
        {copy[stay.kind]}.{" "}
        {stay.kind === "provider-priced" ? copy.volatile : copy.planning}
      </p>
      {stay.kind !== "provider-priced" ? (
        <p>
          {copy.tiers} {plan.request.party.children > 0 ? copy.children : ""}
        </p>
      ) : (
        <>
          <p>
            {copy.mandatory}{" "}
            {stay.evidence.charges.conditional ? copy.conditional : ""}
          </p>
          <p>
            {stay.evidence.cancellation === "non-refundable"
              ? copy.nonRefundable
              : stay.evidence.cancellation === "unknown"
                ? copy.cancellationUnknown
                : copy.cancellationCheck}{" "}
            {copy.meals}
          </p>
          <p>
            {copy.observed}{" "}
            <time dateTime={stay.evidence.observedAt}>
              {stay.evidence.observedAt}
            </time>
          </p>
        </>
      )}
      {stay.rejection === "charges-unknown" ? (
        <p>{copy.unknownCharges}</p>
      ) : null}
    </div>
  );
}
