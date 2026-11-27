import type { MediaRole } from "../media/types";
import type {
  Coordinates,
  ExternalIdentity,
  PlaceIdentity,
} from "../places/types";

/** English is required for V1; optional translations are retained for future review. */
export type ContentText = Record<string, string>;
export type ContentReviewStatus = "draft" | "reviewed" | "withdrawn";
export type ContentReview = {
  reviewStatus: ContentReviewStatus;
  reviewedAt: string | null;
};
export type ContentFreshness =
  | { kind: "stable" }
  | { kind: "periodically-reviewed"; reviewBy: string }
  | { kind: "volatile"; observedAt: string; validUntil: string };

export type ContentSource = {
  id: string;
  type: "wikidata" | "openstreetmap" | "official" | "internal-reviewed";
  url?: string;
  externalId?: ExternalIdentity;
  title: string;
  publisher: string;
  observedAt?: string;
  retrievedAt?: string;
  /** Required for persisted OSM-derived fields; never stripped at runtime. */
  licensing?: { identifier: string; url: string; attribution: string };
};
export type SourcedContent = ContentReview & {
  sourceIds: string[];
  freshness: ContentFreshness;
};
export type ContentOverview = SourcedContent & { text: ContentText };
export type ContentHighlight = SourcedContent & {
  id: string;
  text: ContentText;
};
export type AttractionKind =
  | "landmark"
  | "museum"
  | "historic-site"
  | "religious-site"
  | "park"
  | "viewpoint"
  | "market"
  | "beach"
  | "nature"
  | "district"
  | "other";
export type Attraction = SourcedContent & {
  id: string;
  destinationId: string;
  externalIdentities?: ExternalIdentity[];
  name: ContentText;
  kind: AttractionKind;
  coordinates?: Coordinates;
  shortDescription: ContentText;
  whyVisit?: ContentText;
  typicalVisitMinutes?: { minimum: number; maximum: number };
  bookingAdvice?: ContentText;
  /** A subject reference only: no image URL, selection, or approval is implied. */
  media?: { subject: string; role: Extract<MediaRole, "attraction.primary"> };
};
export type DestinationArea = SourcedContent & {
  id: string;
  destinationId: string;
  name: ContentText;
  summary: ContentText;
  goodFor: ContentText[];
  tradeoffs: ContentText[];
  coordinates?: Coordinates;
  bounds?: { north: number; south: number; east: number; west: number };
};
export type DayTemplate = SourcedContent & {
  id: string;
  destinationId: string;
  suitableNights: number[];
  title: ContentText;
  /** Optional calendar-day grouping; grouped templates specify exactly one night count. */
  stops: { attractionId: string; day?: number; notes?: ContentText }[];
  notes?: ContentText;
};
/** An observation, never a live offer or input into trip affordability. */
export type ObservedContentPrice = {
  amount: number;
  currency: string;
  sourceId: string;
  observedAt: string;
};
export type TransportGuide = SourcedContent & {
  id: string;
  destinationId: string;
  title: ContentText;
  guidance: ContentText;
  observedPrice?: ObservedContentPrice;
};
export type PracticalNote = SourcedContent & {
  id: string;
  destinationId: string;
  kind:
    | "booking"
    | "closure"
    | "transport"
    | "tax"
    | "payment"
    | "accessibility"
    | "seasonal"
    | "safety"
    | "entry"
    | "other";
  text: ContentText;
  observedPrice?: ObservedContentPrice;
};
export type DestinationContent = ContentReview & {
  destinationId: string;
  /** References the existing PlaceIdentity registry by our stable subject ID. */
  identitySubject: PlaceIdentity["subject"];
  contentVersion: number;
  /** Publication receipt only. Human checklists/identities stay operator-only. */
  publication?: {
    contentDigest: string;
    identityDigest: string;
    approvedAt: string;
  };
  sourceIds: string[];
  sources: ContentSource[];
  overview?: ContentOverview;
  highlights?: ContentHighlight[];
  attractions?: Attraction[];
  areas?: DestinationArea[];
  transport?: TransportGuide[];
  practicalNotes?: PracticalNote[];
  dayTemplates?: DayTemplate[];
};
export type DestinationContentData = {
  schemaVersion: 1;
  records: DestinationContent[];
};
export type DestinationContentValidationContext = {
  identities: readonly PlaceIdentity[];
  mediaSubjects: readonly string[];
};
export type DestinationContentResult =
  | { status: "reviewed"; content: DestinationContent }
  | {
      status: "none";
      reason:
        | "missing-record"
        | "invalid-record"
        | "not-reviewed"
        | "no-current-content";
    };
export interface DestinationContentStore {
  get(destinationId: string): Promise<DestinationContentResult>;
}
