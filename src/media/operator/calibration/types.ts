import type {
  MediaCandidate,
  PlaceIdentity,
  PlaceInput,
  PlaceKind,
} from "../../../domain/media/types";
import type { MediaApiFailure } from "../../adapters/api";
import type { IdentityDiagnostic } from "../../../places/adapters/wikidata";
export type CalibrationCase = {
  input: PlaceInput;
  continent:
    | "Europe"
    | "Asia"
    | "North America"
    | "South America"
    | "Africa"
    | "Oceania";
  expected: {
    countryCode: string;
    placeKind: PlaceKind;
    wikidataId: string | null;
    outcome: "resolve" | "unresolved";
    reference: string | null;
  };
  notes: string;
};
export type CalibrationDataset = {
  schemaVersion: 1;
  id: string;
  reviewedOn: string;
  basis: string;
  cases: CalibrationCase[];
};
export type ReviewAnswer = "yes" | "no" | "uncertain";
export type VisualReview = {
  imageRelevant: ReviewAnswer;
  roleFit: ReviewAnswer;
  method: "pending" | "visual";
  reviewedAt: string | null;
  reviewerNotes: string;
};
export type FailureCategory =
  | "ambiguous"
  | "no-transport-mapping"
  | "name-mismatch"
  | "country-mismatch"
  | "coordinate-mismatch"
  | "unsupported-class"
  | "missing-data"
  | "provider-unavailable"
  | "wrong-entity";
export type CalibrationCandidate = {
  candidate: MediaCandidate;
  sourceProperties: string[];
  review: VisualReview;
};
export type CalibrationRow = {
  input: PlaceInput;
  identity: PlaceIdentity;
  identityEvidence: IdentityDiagnostic[];
  identityReview: {
    identityCorrect: ReviewAnswer;
    reviewedAt: string | null;
    reviewerNotes: string;
  };
  status: "offline" | "complete" | "unresolved" | "unavailable";
  requests: { wikidata: number; commons: number };
  failures: MediaApiFailure[];
  failureCategories: FailureCategory[];
  candidates: CalibrationCandidate[];
  missedGoodImageNotes: string[];
};
export type CalibrationReport = {
  schemaVersion: 1;
  datasetId: string;
  datasetHash: string;
  mode: "offline" | "live";
  startedAt: string;
  finishedAt: string;
  automaticApproval: false;
  automaticIngestion: false;
  stopReason: "complete" | "rate-limit" | "provider-failures" | "deadline";
  rows: CalibrationRow[];
};
