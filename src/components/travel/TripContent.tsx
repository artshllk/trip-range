import { TripDayTabs } from "./TripDayTabs";
import type { ReactNode } from "react";
import type {
  DestinationContentResult,
  ContentSource,
  ContentText,
  ObservedContentPrice,
  SourcedContent,
} from "../../domain/destination-content/types";
import type { LocalizedText } from "../../domain/types";
import type { Locale } from "../../i18n/config";
import {
  contentPresentationLimits as limits,
  editorialSelection,
  contentExcerpt,
  selectDayTemplate,
  selectDestinationContent,
} from "../../content/presentation";
import { safeContentSourceUrl } from "../../domain/destination-content/validation";
import {
  attractionKindText,
  contentDateText,
  contentSourceTypeText,
  destinationContentText,
} from "../../i18n/destination-content";

/** Server-rendered slots: no raw destination record crosses the client boundary. */
export type TripContentSections = {
  overview: ReactNode;
  days: ReactNode;
  attractions: ReactNode;
  areas: ReactNode;
  transport: ReactNode;
  leadNotes?: ReactNode;
  practical: ReactNode;
  sources: ReactNode;
};
export type TripContentProps = {
  result: DestinationContentResult;
  destinationId: string;
  nights: number;
  startDate?: string;
  /** Opt in only on personalized trip pages; evergreen guides keep their existing view. */
  compact?: boolean;
  guideMenuNoteIds?: readonly string[];
  locale: Locale;
  fallbackItinerary: LocalizedText[];
};

function Freshness({ item, locale }: { item: SourcedContent; locale: Locale }) {
  if (item.freshness.kind !== "volatile") return null;
  return (
    <small className="trip-content-meta">
      {destinationContentText(locale).checked}{" "}
      <time dateTime={item.freshness.observedAt}>
        {contentDateText(item.freshness.observedAt, locale)}
      </time>
    </small>
  );
}

function ObservedPrice({
  price,
  sources,
  locale,
}: {
  price: ObservedContentPrice | undefined;
  sources: ContentSource[];
  locale: Locale;
}) {
  if (!price) return null;
  const source = sources.find((candidate) => candidate.id === price.sourceId);
  const text = destinationContentText(locale);
  // This is a source observation in its original currency, never a MoneyAmount or budget input.
  const amount = String(price.amount).replace(".", locale === "sq" ? "," : ".");
  return (
    <p className="trip-content-meta trip-content-observation">
      {text.observed}:{" "}
      <strong>
        {amount} {price.currency}
      </strong>{" "}
      ·{" "}
      <time dateTime={price.observedAt}>
        {contentDateText(price.observedAt, locale)}
      </time>
      {source ? (
        <>
          {" "}
          · {text.source}:{" "}
          <a href={`#destination-source-${source.id}`}>{source.title}</a>
        </>
      ) : null}
      <span>{text.reference}</span>
    </p>
  );
}

function Sources({
  sources,
  locale,
}: {
  sources: ContentSource[];
  locale: Locale;
}) {
  const text = destinationContentText(locale);
  return (
    <div className="trip-content-sources">
      <h3>{text.sources}</h3>
      <ul className="trip-content-source-list">
        {sources.map((source) => (
          <li key={source.id} id={`destination-source-${source.id}`}>
            {source.url && safeContentSourceUrl(source.url) ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
            ) : (
              <span>{source.title}</span>
            )}
            <small className="trip-content-meta">
              {contentSourceTypeText(source.type, locale)} · {source.publisher}
            </small>
            {source.licensing ? (
              <small className="trip-content-meta">
                {source.licensing.attribution} ·{" "}
                {safeContentSourceUrl(source.licensing.url) ? (
                  <a
                    href={source.licensing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.licensing.identifier}
                  </a>
                ) : (
                  source.licensing.identifier
                )}
              </small>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Short previews never discard stored facts; longer copy stays keyboard accessible. */
function ConciseText({
  value,
  limit,
  locale,
}: {
  value: string;
  limit: number;
  locale: Locale;
}) {
  const preview = contentExcerpt(value, limit);
  return (
    <>
      <p>{preview}</p>
      {preview !== value ? (
        <details className="trip-content-more">
          <summary>{destinationContentText(locale).readMore}</summary>
          <p>{value}</p>
        </details>
      ) : null}
    </>
  );
}

/** Caller must obtain result from DestinationContentStore, which applies review/freshness policy. */
export function renderTripContentSections({
  result,
  destinationId,
  nights,
  startDate,
  compact = false,
  guideMenuNoteIds,
  locale,
  fallbackItinerary,
}: TripContentProps): TripContentSections {
  const content = selectDestinationContent(result, destinationId);
  const text = destinationContentText(locale);
  const copy = (value: ContentText) => value[locale] ?? value.en;
  const attractions = content?.attractions ?? [];
  const areas = content?.areas ?? [];
  const transport = content?.transport ?? [];
  const allNotes = content?.practicalNotes ?? [];
  const leadNotes = guideMenuNoteIds
    ? allNotes.filter(
        (note) =>
          note.kind === "transport" ||
          note.observedPrice ||
          guideMenuNoteIds.includes(note.id),
      )
    : [];
  const practical = allNotes.filter((note) => !leadNotes.includes(note));
  const sources = content?.sources ?? [];
  const template = selectDayTemplate(content?.dayTemplates, nights);
  const places = editorialSelection(attractions, limits.attractions);
  const guides = editorialSelection(transport, limits.transport);
  const notes = editorialSelection(practical, limits.practicalNotes);
  const critical = notes.more.filter(
    (note) =>
      compact &&
      ["closure", "safety", "entry", "accessibility"].includes(note.kind),
  );
  notes.primary = [...notes.primary, ...critical];
  notes.more = notes.more.filter((note) => !critical.includes(note));
  const stops = template?.stops.map((stop) => ({
    stop,
    attraction: attractions.find(
      (attraction) => attraction.id === stop.attractionId,
    ),
  }));
  const reviewedOutline =
    template && stops?.length && stops.every(({ attraction }) => attraction);
  const dayNumbers = [
    ...new Set(
      template?.stops
        .map((stop) => stop.day)
        .filter((day): day is number => day !== undefined),
    ),
  ];
  const attractionRows = (items: typeof attractions) => (
    <ul className="trip-place-list">
      {items.map((attraction) => (
        <li
          className="trip-place-row"
          id={`trip-attraction-${attraction.id}`}
          key={attraction.id}
        >
          <div className="trip-place-copy">
            <h3>{copy(attraction.name)}</h3>
            <p className="trip-content-meta">
              {attractionKindText(attraction.kind, locale)}
              {attraction.typicalVisitMinutes ? (
                <>
                  {" "}
                  ·{" "}
                  {attraction.typicalVisitMinutes.minimum ===
                  attraction.typicalVisitMinutes.maximum
                    ? attraction.typicalVisitMinutes.minimum
                    : `${attraction.typicalVisitMinutes.minimum}–${attraction.typicalVisitMinutes.maximum}`}{" "}
                  {text.minutes}
                </>
              ) : null}
            </p>
            {compact ? (
              <>
                <p>{copy(attraction.shortDescription).split(/(?<=\.)\s/)[0]}</p>
                {stops?.some(
                  ({ stop }) => stop.attractionId === attraction.id && stop.day,
                ) ? (
                  <p className="trip-in-plan">
                    In your plan ·{" "}
                    {text.day(
                      stops.find(
                        ({ stop }) => stop.attractionId === attraction.id,
                      )!.stop.day!,
                    )}
                  </p>
                ) : null}
                <details className="trip-place-details">
                  <summary>Before you go</summary>
                  <div className="stack">
                    <p>{copy(attraction.shortDescription)}</p>
                    {attraction.bookingAdvice ? (
                      <p className="trip-place-advice">
                        {copy(attraction.bookingAdvice)}
                      </p>
                    ) : null}
                    {attraction.sourceIds
                      .map((id) => sources.find((source) => source.id === id))
                      .filter(
                        (source) =>
                          source?.type === "official" &&
                          source.url &&
                          safeContentSourceUrl(source.url),
                      )
                      .slice(0, 1)
                      .map((source) => (
                        <a
                          className="trip-visitor-link"
                          key={source!.id}
                          href={source!.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {text.visitSite} ↗
                        </a>
                      ))}
                  </div>
                </details>
              </>
            ) : (
              <>
                <ConciseText
                  value={copy(attraction.shortDescription)}
                  limit={limits.attractionCharacters}
                  locale={locale}
                />
                {attraction.bookingAdvice ? (
                  <p className="trip-place-advice">
                    {copy(attraction.bookingAdvice)}
                  </p>
                ) : null}
                {attraction.sourceIds
                  .map((id) => sources.find((source) => source.id === id))
                  .filter(
                    (source) =>
                      source?.type === "official" &&
                      source.url &&
                      safeContentSourceUrl(source.url),
                  )
                  .slice(0, 1)
                  .map((source) => (
                    <a
                      className="trip-visitor-link"
                      key={source!.id}
                      href={source!.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {text.visitSite} ↗
                    </a>
                  ))}
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
  const transportRows = (items: typeof transport) => (
    <ul className="trip-content-notes">
      {items.map((guide) => (
        <li key={guide.id}>
          <h3>{copy(guide.title)}</h3>
          {compact ? (
            <p>{copy(guide.guidance)}</p>
          ) : (
            <ConciseText
              value={copy(guide.guidance)}
              limit={limits.guidanceCharacters}
              locale={locale}
            />
          )}
          <Freshness item={guide} locale={locale} />
          <ObservedPrice
            price={guide.observedPrice}
            sources={sources}
            locale={locale}
          />
        </li>
      ))}
    </ul>
  );
  const noteRows = (items: typeof practical) => (
    <ul className="trip-content-notes">
      {items.map((note) => (
        <li key={note.id}>
          {compact &&
          ["closure", "safety", "entry", "accessibility"].includes(
            note.kind,
          ) ? (
            <p>{copy(note.text)}</p>
          ) : (
            <ConciseText
              value={copy(note.text)}
              limit={limits.guidanceCharacters}
              locale={locale}
            />
          )}

          <Freshness item={note} locale={locale} />
          {leadNotes.includes(note) ? (
            <small className="trip-content-meta">
              {note.sourceIds.map((id) => {
                const source = sources.find((candidate) => candidate.id === id);
                return source ? (
                  <span key={id}>
                    {" "}
                    <a href={source.url}>{source.title}</a>
                  </span>
                ) : null;
              })}
            </small>
          ) : null}
          <ObservedPrice
            price={note.observedPrice}
            sources={sources}
            locale={locale}
          />
        </li>
      ))}
    </ul>
  );
  return {
    // Highlights are retained in storage/review, not repeated beside the attractions.
    overview: content?.overview ? (
      <div className="trip-content-intro">
        {compact ? (
          <>
            <p>
              {copy(content.overview.text)
                .split(/(?<=\.)\s/)
                .slice(0, 2)
                .join(" ")}
            </p>
          </>
        ) : (
          <>
            <ConciseText
              value={copy(content.overview.text)}
              limit={limits.overviewCharacters}
              locale={locale}
            />
          </>
        )}
        <Freshness item={content.overview} locale={locale} />
      </div>
    ) : null,
    attractions: attractions.length ? (
      <section
        className="trip-content-section"
        id="worth-seeing"
        aria-labelledby="trip-attractions-heading"
      >
        <h2 id="trip-attractions-heading">{text.places}</h2>
        {attractionRows(places.primary)}
        {places.more.length ? (
          <details className="trip-content-more">
            <summary>{text.morePlaces(places.more.length)}</summary>
            {attractionRows(places.more)}
          </details>
        ) : null}
      </section>
    ) : null,
    days:
      reviewedOutline || fallbackItinerary.length ? (
        <section
          className="trip-content-section"
          id="days"
          aria-labelledby="trip-days-heading"
        >
          <h2 id="trip-days-heading">
            {reviewedOutline
              ? compact && locale === "en"
                ? `Your ${nights}-night plan`
                : text.days
              : text.outline}
          </h2>
          {reviewedOutline ? (
            <>
              <p className="trip-content-meta">{text.reusable}</p>
              {dayNumbers.length ? (
                compact ? (
                  <TripDayTabs
                    label={text.days}
                    days={dayNumbers.map((day) => {
                      const date = startDate
                        ? new Date(`${startDate}T12:00:00Z`)
                        : undefined;
                      date?.setUTCDate(date.getUTCDate() + day - 1);
                      const context =
                        day === 1
                          ? locale === "en"
                            ? "Arrival"
                            : text.arrival
                          : day === nights + 1
                            ? locale === "en"
                              ? "Departure"
                              : text.departure
                            : "Full day";
                      return {
                        label: text.day(day),
                        context,
                        date: date
                          ? new Intl.DateTimeFormat(
                              locale === "en" ? "en-GB" : "sq-AL",
                              {
                                day: "numeric",
                                month: "short",
                                timeZone: "UTC",
                              },
                            ).format(date)
                          : undefined,
                        content: (
                          <>
                            <p className="trip-day-context small muted">
                              {day === 1
                                ? text.arrival
                                : day === nights + 1
                                  ? text.departure
                                  : "Full day"}
                            </p>
                            <ol className="trip-day-stops">
                              {stops
                                .filter(({ stop }) => stop.day === day)
                                .map(({ stop, attraction }, index) => (
                                  <li key={stop.attractionId}>
                                    <p className="eyebrow">
                                      {index === 0
                                        ? "Main visit"
                                        : "Also in your plan"}{" "}
                                      ·{" "}
                                      {attractionKindText(
                                        attraction!.kind,
                                        locale,
                                      )}
                                    </p>
                                    <h3>
                                      <a
                                        href={`#trip-attraction-${stop.attractionId}`}
                                      >
                                        {copy(attraction!.name)}
                                      </a>
                                    </h3>
                                    {stop.notes ? (
                                      <p>{copy(stop.notes)}</p>
                                    ) : null}
                                  </li>
                                ))}
                            </ol>
                          </>
                        ),
                      };
                    })}
                  />
                ) : (
                  <ol className="trip-calendar-days">
                    {dayNumbers.map((day) => (
                      <li key={day}>
                        <h3>{text.day(day)}</h3>
                        {day === 1 || day === nights + 1 ? (
                          <p className="trip-content-meta">
                            {day === 1 ? text.arrival : text.departure}
                          </p>
                        ) : null}
                        <ul className="trip-content-stop-list">
                          {stops
                            .filter(({ stop }) => stop.day === day)
                            .map(({ stop, attraction }) => (
                              <li key={stop.attractionId}>
                                <a
                                  href={`#trip-attraction-${stop.attractionId}`}
                                >
                                  {copy(attraction!.name)}
                                </a>
                                {stop.notes ? <p>{copy(stop.notes)}</p> : null}
                              </li>
                            ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )
              ) : (
                <ol className="trip-content-stop-list">
                  {stops.map(({ stop, attraction }) => (
                    <li key={stop.attractionId}>
                      <a href={`#trip-attraction-${stop.attractionId}`}>
                        {copy(attraction!.name)}
                      </a>
                      {stop.notes ? <p>{copy(stop.notes)}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
              {template.notes ? (
                <ConciseText
                  value={copy(template.notes)}
                  limit={limits.guidanceCharacters}
                  locale={locale}
                />
              ) : null}
            </>
          ) : (
            <>
              <p className="trip-content-meta">{text.generic}</p>
              <ol className="trip-content-stop-list">
                {text.genericStops.map((stop) => (
                  <li key={stop}>{stop}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      ) : null,
    areas: areas.length ? (
      <ul className="trip-area-list">
        {areas.map((area) => (
          <li key={area.id}>
            <h3>{copy(area.name)}</h3>
            <ConciseText
              value={copy(area.summary)}
              limit={limits.areaCharacters}
              locale={locale}
            />
            {compact ? (
              <>
                {area.tradeoffs.length ? (
                  <details className="trip-area-details">
                    <summary>What to check</summary>
                    {area.tradeoffs.map((tradeoff, index) => (
                      <p key={index}>{copy(tradeoff)}</p>
                    ))}
                  </details>
                ) : null}
              </>
            ) : (
              <>
                {area.tradeoffs[0] ? (
                  <div className="small muted">
                    <ConciseText
                      value={copy(area.tradeoffs[0])}
                      limit={limits.areaCharacters}
                      locale={locale}
                    />
                  </div>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
    ) : null,
    transport: transport.length ? (
      <section
        className="trip-content-section"
        id="getting-around"
        aria-labelledby="trip-transport-heading"
      >
        <h2 id="trip-transport-heading">{text.transport}</h2>
        {transportRows(guides.primary)}
        {guides.more.length ? (
          <details className="trip-content-more">
            <summary>{text.moreTransport}</summary>
            {transportRows(guides.more)}
          </details>
        ) : null}
      </section>
    ) : null,
    ...(guideMenuNoteIds && leadNotes.length
      ? { leadNotes: noteRows(leadNotes) }
      : {}),
    practical: practical.length ? (
      <>
        {noteRows(notes.primary)}
        {notes.more.length ? (
          <details className="trip-content-more">
            <summary>{text.moreNotes}</summary>
            {noteRows(notes.more)}
          </details>
        ) : null}
      </>
    ) : null,
    sources: sources.length ? (
      <>
        {compact && content?.overview ? (
          <div className="trip-content-overview-source">
            <h3>About this destination</h3>
            <p>{copy(content.overview.text)}</p>
            <Freshness item={content.overview} locale={locale} />
          </div>
        ) : null}
        <Sources sources={sources} locale={locale} />
        {attractions.some(
          (item) => item.whyVisit || item.freshness.kind === "volatile",
        ) ? (
          <div className="trip-content-sources">
            <h3>{text.placeDetails}</h3>
            <ul className="trip-content-notes">
              {attractions
                .filter(
                  (item) => item.whyVisit || item.freshness.kind === "volatile",
                )
                .map((item) => (
                  <li key={item.id}>
                    <b>{copy(item.name)}</b>
                    {item.whyVisit ? <p>{copy(item.whyVisit)}</p> : null}
                    <Freshness item={item} locale={locale} />
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </>
    ) : null,
  };
}
