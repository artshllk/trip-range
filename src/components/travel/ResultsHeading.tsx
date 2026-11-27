import { requestBudget } from "../../domain/money/provenance";
import type { TripRequest } from "@/domain/types";
import type { curate } from "@/domain/ranking";
import { localized } from "@/i18n/localized";
import { flightRoomCopy } from "@/i18n/flight-room";
import { locationName } from "@/catalogue/locations";
import { formatMoney, type Locale } from "@/i18n/config";

/** Describe only the actual shortlist. Reference fares are never counted as priced trips. */
export function ResultsHeading({
  request,
  result,
  locale,
  unavailable,
  revealOver,
}: {
  request: TripRequest;
  result: ReturnType<typeof curate>;
  locale: Locale;
  unavailable: boolean;
  revealOver: boolean;
}) {
  const count = unavailable
    ? 0
    : result.cards.length + (revealOver ? result.slightlyOver.length : 0);
  const roomCopy = localized(flightRoomCopy, locale);
  const hasFlights = result.cards.some((p) => p.transportMode === "flight");
  const unpriced = result.ideas.filter(
    (p) => p.pricingCompleteness === "flight-unpriced",
  ).length;
  const incomplete = result.ideas.length - unpriced;
  // Nothing priced: one line for the list, so cards lead with what they know.
  const allUnpriced = !unavailable && !result.fits.length && unpriced > 0;
  return (
    <header className="results-heading">
      <h1>
        {request.destination
          ? `Trips to ${request.destination.name}`
          : hasFlights
            ? `Trips from ${request.origin?.name ?? locationName(request.originId)}`
            : `Where ${formatMoney(requestBudget(request), locale)} can take you`}
      </h1>
      <p className="muted">
        {unavailable
          ? "Results temporarily unavailable"
          : `${count} ${count === 1 ? "result" : "results"} from ${request.origin?.name ?? locationName(request.originId)}`}
      </p>
      {!unavailable && count > 0 ? (
        <p className="results-status-counts" role="status">
          {result.fits.length ? (
            <span className="status-fits">
              {result.fits.length} {result.fits.length === 1 ? "fits" : "fit"}{" "}
              your budget
            </span>
          ) : null}
          {unpriced ? (
            <span>
              {roomCopy.unpricedCount.replace("{n}", String(unpriced))}
            </span>
          ) : null}
          {incomplete ? (
            <span>
              {incomplete} {incomplete === 1 ? "needs" : "need"} complete prices
            </span>
          ) : null}
          {revealOver && result.slightlyOver.length ? (
            <span className="status-over">
              {result.slightlyOver.length} over budget
            </span>
          ) : null}
        </p>
      ) : null}
      {hasFlights ? (
        <p className="results-unpriced-note">
          Trip totals are not yet known for flight destinations. Compare the
          available fare and room evidence, then check the missing costs for
          your dates.
        </p>
      ) : allUnpriced ? (
        <p className="results-unpriced-note">
          {roomCopy.header} {roomCopy.sorted}
        </p>
      ) : null}
    </header>
  );
}
