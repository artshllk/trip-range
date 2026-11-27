import type {
  DayTemplate,
  DestinationContent,
  DestinationContentResult,
} from "../domain/destination-content/types";

/** Only consume the reviewed store result for the selected destination. */
export function selectDestinationContent(
  result: DestinationContentResult,
  destinationId: string,
): DestinationContent | undefined {
  return result.status === "reviewed" &&
    result.content.destinationId === destinationId &&
    result.content.identitySubject === destinationId &&
    result.content.reviewStatus === "reviewed"
    ? result.content
    : undefined;
}

/** Select an explicit fit, never the nearest unsupported trip length. */
export function selectDayTemplate(
  templates: readonly DayTemplate[] | undefined,
  nights: number,
): DayTemplate | undefined {
  if (!Number.isSafeInteger(nights) || nights < 1) return;
  return templates
    ?.filter(
      (template) =>
        template.reviewStatus === "reviewed" &&
        template.suitableNights.includes(nights),
    )
    .sort((a, b) => {
      const aRange =
        Math.max(...a.suitableNights) - Math.min(...a.suitableNights);
      const bRange =
        Math.max(...b.suitableNights) - Math.min(...b.suitableNights);
      return (
        aRange - bRange ||
        a.suitableNights.length - b.suitableNights.length ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
    })[0];
}

/** Source-controlled array order is the explicit human editorial order.
 * Selection never scores popularity, geography or destinations. Overflow stays available.
 */
export const contentPresentationLimits = {
  attractions: 5,
  transport: 3,
  practicalNotes: 5,
  overviewCharacters: 320,
  attractionCharacters: 180,
  areaCharacters: 200,
  guidanceCharacters: 240,
} as const;

export function editorialSelection<T>(
  items: readonly T[] | undefined,
  limit: number,
) {
  return {
    primary: (items ?? []).slice(0, limit),
    more: (items ?? []).slice(limit),
  };
}

/** A visibly abbreviated preview, never a rewritten fact. Full copy remains in disclosure. */
export function contentExcerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const end = text.lastIndexOf(" ", limit - 1);
  return `${text.slice(0, end > limit / 2 ? end : limit - 1).trimEnd()}…`;
}
