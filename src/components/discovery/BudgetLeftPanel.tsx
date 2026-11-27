import type {
  BudgetLeft,
  KnownCost,
  SourceRef,
} from "../../domain/budget-left";
import { FOOD_DAYS } from "../../domain/budget-left";
import type { StayAttraction } from "../../domain/attractions";

const euros = (cents: number) =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: cents % 100 ? 2 : 0,
    minimumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);

const unknownLabel = {
  "city-tax": "City tax",
  "airport-transfer": "Airport transfer",
};

function Source({ source }: { source: SourceRef }) {
  return (
    <span className="small muted">
      {" · "}
      <a href={source.url} target="_blank" rel="noopener noreferrer">
        {source.publisher}
      </a>
      , effective {source.effectiveFrom}, checked{" "}
      <time dateTime={source.checkedAt}>{source.checkedAt}</time>
      {source.manualCheckedOn
        ? `; the operator's page blocks automated checks, so this was read by hand on ${source.manualCheckedOn}`
        : ""}
      {source.fx
        ? `; converted from ${source.fx.from} at the ECB reference rate of ${source.fx.sourceDate}`
        : ""}
    </span>
  );
}

function Known({ cost }: { cost: KnownCost }) {
  return (
    <li>
      {cost.detail}: <strong>{euros(cost.cents)}</strong>
      {cost.observedAt && (
        <span className="small muted">
          {" · "}fare seen by provider{" "}
          <time dateTime={cost.observedAt}>{cost.observedAt.slice(0, 10)}</time>
        </span>
      )}
      {cost.source && <Source source={cost.source} />}
      {cost.note && <span className="small"> {cost.note}</span>}
    </li>
  );
}

/**
 * What is left of the budget after the costs we can prove. Never a total: known
 * costs are listed with their sources, unknown costs are named, and the remaining
 * figure says what it is "before".
 */
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso + "T00:00:00Z"));

function Cited({ cite }: { cite: StayAttraction["priceSource"] }) {
  return (
    <span className="small muted">
      {" · "}
      <a href={cite.url} target="_blank" rel="noopener noreferrer">
        {cite.publisher}
      </a>
      : “{cite.quote}”, checked{" "}
      <time dateTime={cite.checkedAt}>{cite.checkedAt}</time>
    </span>
  );
}

/** Official sight prices for the stay. Optional, so never subtracted. */
function Sights({ items }: { items: StayAttraction[] }) {
  return (
    <section className="budget-left-sights" aria-label="Official sight prices">
      <p className="small">
        Official prices for sights, if you visit (not subtracted above):
      </p>
      <ul>
        {items.map((a) => (
          <li key={a.id}>
            {a.name}:{" "}
            {a.status === "priced" ? (
              <>
                <strong>{euros(a.partyCents!)} for two</strong> (
                {euros(a.adultCents!)} each, {a.ticketName})
                <Cited cite={a.priceSource} />
              </>
            ) : (
              <>
                <strong>not known</strong>
                <span className="small muted">
                  {" "}
                  (no current official price)
                </span>
              </>
            )}
            {a.closedOn.length > 0 && (
              <span className="small">
                {" "}
                Closed on {a.closedOn.map(day).join(", ")}.
                <Cited cite={a.hoursSource} />
              </span>
            )}
            {a.freeOn.length > 0 && (
              <span className="small">
                {" "}
                Free on {a.freeOn.map(day).join(", ")} (first Sunday of the
                month).
              </span>
            )}
            {a.lastEntry && (
              <span className="small muted"> Last entry {a.lastEntry}.</span>
            )}
            {a.unknownPart && (
              <span className="small muted"> {a.unknownPart}</span>
            )}
            <span className="small muted"> Listed because: {a.basis}</span>
            <Cited cite={a.basisSource} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BudgetLeftPanel({
  result,
  attractions,
}: {
  result: BudgetLeft;
  attractions?: StayAttraction[];
}) {
  const before = result.unknown.map((u) => unknownLabel[u.id].toLowerCase());
  const beforeText = before.length ? ` before ${before.join(" and ")}` : "";
  const over = result.leftCents < 0;
  return (
    <section className="budget-left" aria-label="What is left of your budget">
      <p className="small">
        Your budget for two: <strong>{euros(result.budgetCents)}</strong>
      </p>
      <ul className="budget-left-known">
        {result.known.map((cost) => (
          <Known key={cost.id} cost={cost} />
        ))}
        {result.noCityTax && (
          <li>
            City tax: none
            <Source source={result.noCityTax} />
          </li>
        )}
        {result.percentTax && (
          <li>
            City tax: {result.percentTax.percent}% of the room price
            {result.percentTax.percentOf === "price-excluding-vat"
              ? " before VAT"
              : ""}
            {result.percentTax.onFullPrice
              ? " (counted on the full price, so slightly overstated)"
              : ""}
            {result.percentTax.capCentsPerRoomNight !== undefined
              ? `, up to ${euros(result.percentTax.capCentsPerRoomNight)} a night for two`
              : ""}
            , taken into account in the room figure below
            <Source source={result.percentTax.source} />
          </li>
        )}
      </ul>
      {result.unknown.length > 0 && (
        <ul className="budget-left-unknown">
          {result.unknown.map((u) => (
            <li key={u.id}>
              {unknownLabel[u.id]}: <strong>not known</strong>
              <span className="small muted"> ({u.reason})</span>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">
        Not counted:{" "}
        {result.transferNotCounted
          ? "getting between the airport and the city, travel around the city"
          : "travel around the city"}
        , and getting to and from your home airport.
      </p>
      {over ? (
        <p className="budget-left-result">
          The costs above already exceed your budget by{" "}
          <strong>{euros(-result.leftCents)}</strong>
          {beforeText}.
        </p>
      ) : result.food === undefined ? (
        <p className="budget-left-result">
          <strong>{euros(result.leftCents)}</strong> is left for room and food
          together{beforeText}.
        </p>
      ) : (
        <p className="budget-left-result">
          <strong>{euros(result.leftCents)}</strong> is left for room and food
          {beforeText}. With your {euros(result.food.perDayCents)} a day for
          food ({FOOD_DAYS} days),{" "}
          {result.roomPerNightCents !== undefined ? (
            <>
              about <strong>{euros(result.roomPerNightCents)} a night</strong>{" "}
              is left for a room
              {result.percentTax ? ", including its city tax" : ""}.
            </>
          ) : (
            <>nothing is left for a room.</>
          )}
        </p>
      )}
      {attractions && attractions.length > 0 && <Sights items={attractions} />}
      <p className="small muted">
        This is what remains of your budget, not a room price we found. Check
        the price for your dates before you book.
      </p>
    </section>
  );
}
