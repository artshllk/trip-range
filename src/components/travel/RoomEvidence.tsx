import Link from "next/link";
import {
  roomEuros,
  type RoomEvidence as Evidence,
} from "../../domain/room-evidence";

const preciseEuros = (cents: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );

export function RoomEvidence({
  evidence,
  checkIn,
  checkOut,
}: {
  evidence: Evidence;
  checkIn?: string;
  checkOut?: string;
}) {
  if (evidence.kind === "unavailable") return null;
  if (evidence.kind === "published")
    return (
      <div
        className="room-evidence"
        data-room-tier={
          evidence.scope === "pooled" ? "market-context" : "published-class"
        }
      >
        <p>
          <strong>
            {evidence.scope === "three-star" ? "Three-star hotels" : "Hotels"}{" "}
            averaged {roomEuros(evidence.roomNightCents)} per room/night
          </strong>{" "}
          <span className="evidence-label">
            {evidence.scope === "pooled"
              ? "Published · all hotel classes"
              : "Published · three-star average"}
          </span>
        </p>
        {evidence.pooledRoomNightCents !== undefined && (
          <p className="small">
            All hotel classes: {roomEuros(evidence.pooledRoomNightCents)} per
            room/night · same period.
          </p>
        )}
        {evidence.priceNote && (
          <p className="small muted">{evidence.priceNote}</p>
        )}
        <p>
          {evidence.period.label} ·{" "}
          {evidence.scope === "pooled"
            ? "Citywide average; individual rooms and your dates will vary."
            : "Published average; individual rooms and your dates will vary."}
        </p>
        <p className="small">
          <a href={evidence.source.url}>{evidence.source.title}</a> ·{" "}
          <a href={evidence.source.reuseUrl}>Reuse terms</a>
        </p>
        <details className="room-source">
          <summary>Source and scope</summary>
          <p className="small muted">{evidence.caveat}</p>
          <p className="small">
            Published amount: {preciseEuros(evidence.roomNightCents)} per
            room/night.
          </p>
          <p className="small">{evidence.source.attribution}</p>
          <p className="small">{evidence.source.reuse}</p>
          <p className="small">
            Period: {evidence.period.start}–{evidence.period.end}. Checked{" "}
            {evidence.checkedAt}. {evidence.frequency} publication; next review
            by {evidence.reviewAfter}.
          </p>
        </details>
      </div>
    );
  const f = evidence.figure;
  const stay = (["weekday", "weekend"] as const).find(
    (s) => f[s].checkIn === checkIn && f[s].checkOut === checkOut,
  );
  const contributors = f.contributors.filter(
    (c) => !stay || c.stayType === stay,
  );
  const prices = contributors.map((c) => c.twoNightCents);
  const notice = f.comparisonContext?.notice;
  return (
    <div className="room-evidence" data-room-tier="measured">
      <p>
        <strong>
          {stay ? "Three-star rooms we checked" : "Measured room benchmark"}:{" "}
          {roomEuros(Math.min(...prices))}–{roomEuros(Math.max(...prices))} for
          two nights
        </strong>{" "}
        <span className="evidence-label">Measured · three-star room panel</span>
      </p>
      <p>
        Two adults · one room.{" "}
        {stay
          ? "Quotes for your selected stay dates."
          : "Based on the sampled stays below; check prices for your dates."}
      </p>
      <p className="small">
        Checked {f.observationDate} · stays {f.weekday.checkIn}–
        {f.weekday.checkOut} and {f.weekend.checkIn}–{f.weekend.checkOut}.{" "}
        {f.properties.contributing} contributing properties;{" "}
        {f.weekday.contributing} weekday and {f.weekend.contributing} weekend
        quotes.
      </p>
      <p className="small muted">
        {f.classificationBasis === "independent"
          ? "Independent hotel classification."
          : "Operator-declared or mixed classification; weaker evidence than an independently classified panel."}{" "}
        {typeof notice === "string" ? notice : null}
      </p>
      <details className="room-source">
        <summary>Panel scope and terms</summary>
        <p className="small muted">
          The spread describes the rooms checked, not all available rooms.
          Provisional panel band ±{f.bandPercent}%; this is not a measured
          confidence interval. Prices and availability may change.
        </p>
        <p className="small muted">
          Displayed room prices. Tax stated extra:{" "}
          {f.taxTreatments.stated_extra}; tax wording silent:{" "}
          {f.taxTreatments.page_silent}. Breakfast fallback:{" "}
          {f.fallbacks.breakfastIncluded}; non-refundable fallback:{" "}
          {f.fallbacks.nonRefundable}. Check mandatory charges and terms before
          booking.
        </p>
        <p className="small">
          <Link href="/methodology">Panel method</Link> · {f.compositionId} ·
          review by {f.reviewAfter}
        </p>
      </details>
    </div>
  );
}
