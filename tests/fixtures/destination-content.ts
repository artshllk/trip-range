import type {
  DestinationContentData,
  DestinationContentValidationContext,
  SourcedContent,
} from "../../src/domain/destination-content/types";
import type { PlaceIdentity } from "../../src/domain/media/types";

/** Entirely synthetic acceptance data. Never imported by production records. */
export const contentTestIdentity: PlaceIdentity = {
  subject: "synthetic-content-city",
  name: "Synthetic Content City",
  placeKind: "city",
  countryCode: "GB",
  coordinates: { latitude: 51, longitude: 0 },
  external: { authority: "wikidata", id: "Q900000001" },
  resolutionMethod: "reviewed",
  confidence: "reviewed",
  resolvedAt: "2026-10-01T00:00:00Z",
  policyVersion: "destination-media-v1",
  unresolvedReason: null,
};
export const contentTestNow = Date.parse("2026-10-10T12:00:00Z");
const copy = (en: string) => ({ en, sq: `Shembull testimi: ${en}` });
const stable = (): SourcedContent => ({
  reviewStatus: "reviewed",
  reviewedAt: "2026-10-10T00:00:00Z",
  sourceIds: ["source:synthetic:review"],
  freshness: { kind: "stable" },
});
export function contentFixtureContext(): DestinationContentValidationContext {
  return {
    identities: [structuredClone(contentTestIdentity)],
    mediaSubjects: [],
  };
}
export function destinationContentFixture(): DestinationContentData {
  const destinationId = contentTestIdentity.subject;
  return {
    schemaVersion: 1,
    records: [
      {
        destinationId,
        identitySubject: destinationId,
        contentVersion: 1,
        reviewStatus: "reviewed",
        reviewedAt: "2026-10-10T00:00:00Z",
        sourceIds: ["source:synthetic:review"],
        sources: [
          {
            id: "source:synthetic:review",
            type: "internal-reviewed",
            title: "Synthetic acceptance fixture; no real destination claims",
            publisher: "GoEksplo test fixture",
          },
          {
            id: "source:synthetic:official",
            type: "official",
            url: "https://example.org/synthetic-fare",
            title: "Synthetic official fare observation for tests",
            publisher: "Example test authority",
            observedAt: "2026-10-09T00:00:00Z",
            retrievedAt: "2026-10-09T01:00:00Z",
          },
        ],
        overview: {
          ...stable(),
          text: copy("A synthetic overview for acceptance testing."),
        },
        highlights: [
          {
            ...stable(),
            id: "highlight:synthetic:one",
            text: copy("Synthetic reason to visit."),
          },
        ],
        attractions: [
          {
            ...stable(),
            id: "attraction:synthetic:one",
            destinationId,
            externalIdentities: [{ authority: "wikidata", id: "Q900000002" }],
            name: copy("Test landmark"),
            kind: "landmark",
            coordinates: { latitude: 51.01, longitude: 0 },
            shortDescription: copy(
              "A fictional attraction used only in tests.",
            ),
            whyVisit: copy("Synthetic editorial selection for testing."),
            typicalVisitMinutes: { minimum: 30, maximum: 60 },
          },
        ],
        areas: [
          {
            ...stable(),
            id: "area:synthetic:one",
            destinationId,
            name: copy("Test district"),
            summary: copy("A fictional district."),
            goodFor: [copy("Testing optional neighbourhood guidance.")],
            tradeoffs: [copy("No real world recommendation is made.")],
            bounds: { north: 51.02, south: 51, east: 0.01, west: 0 },
          },
        ],
        transport: [
          {
            ...stable(),
            id: "transport:synthetic:one",
            destinationId,
            freshness: {
              kind: "periodically-reviewed",
              reviewBy: "2026-10-31T00:00:00Z",
            },
            title: copy("Synthetic transport guidance"),
            guidance: copy(
              "This fixture makes no claim about a real transport system.",
            ),
          },
        ],
        practicalNotes: [
          {
            ...stable(),
            id: "note:synthetic:fare",
            destinationId,
            kind: "transport",
            sourceIds: ["source:synthetic:official"],
            freshness: {
              kind: "volatile",
              observedAt: "2026-10-09T00:00:00Z",
              validUntil: "2026-10-15T00:00:00Z",
            },
            text: copy("Synthetic observed fare; not a live offer."),
            observedPrice: {
              amount: 4,
              currency: "EUR",
              sourceId: "source:synthetic:official",
              observedAt: "2026-10-09T00:00:00Z",
            },
          },
        ],
        dayTemplates: [
          {
            ...stable(),
            id: "day:synthetic:one",
            destinationId,
            suitableNights: [1, 2, 3],
            title: copy("Synthetic day building block"),
            stops: [
              {
                attractionId: "attraction:synthetic:one",
                notes: copy("A synthetic stop."),
              },
            ],
            notes: copy("A reusable test template, not a generated itinerary."),
          },
        ],
      },
    ],
  };
}
