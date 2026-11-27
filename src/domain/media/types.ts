/** English required; optional translations may be retained without enabling a locale. */
export type MediaAltText = { en: string; [locale: string]: string };

import type { PlaceIdentity, ExternalIdentity } from "../places/types";
export type {
  PlaceKind,
  Coordinates,
  PlaceInput,
  ExternalIdentity,
  PlaceIdentity,
  PlaceIdentityResolver,
} from "../places/types";
export type DestinationMediaRole = "destination.hero" | "destination.card";
/** Reserved roles do not have ingestion or publication support in V1. */
export type MediaRole = DestinationMediaRole | "attraction.primary" | "social";
export type MediaChecksum = { algorithm: "sha1" | "sha256"; value: string };
export type MediaLicense = { name: string; url: string; verifiedAt: string };
/** Approved local WebP derivatives; the selection separately pins this exact delivery. */
export type LocalMediaDelivery = {
  /** Explicit human-reviewed rectangle in original pixels; originals stay unchanged. */
  crop?: { left: number; top: number; width: number; height: number };
  src: string;
  variants: {
    src: string;
    width: number;
    height: number;
    bytes: number;
    sha256: string;
  }[];
};
export type MediaAsset = {
  localDelivery?: LocalMediaDelivery;
  id: string;
  provider: string;
  providerFileId: string;
  checksum: MediaChecksum | null;
  sourcePage: string | null;
  originalUrl: string | null;
  width: number;
  height: number;
  mimeType: string;
  author: string;
  attribution: string;
  license: MediaLicense | null;
  health: {
    status: "unchecked" | "healthy" | "unavailable" | "changed" | "withdrawn";
    checkedAt: string | null;
  };
};
export type MediaSourceTier = "T1" | "T2" | "T3";
export type MediaEvidence = {
  entity: ExternalIdentity;
  exactEntityImage: boolean;
  exactDepicts: boolean;
  /** Normalized metadata signals, never a claim of visual classification. */
  depictionTags: string[];
  articleUsage: boolean;
  recognizedQuality: boolean;
  withinBounds: boolean;
};
export type MediaGate = {
  status: "pass" | "fail" | "review";
  reasons: string[];
};
export type MediaEvaluation = {
  admissibility: MediaGate;
  identity: MediaGate;
  depiction: MediaGate;
  roleFit: MediaGate;
  score: number;
  vetoReasons: string[];
};
export type MediaCandidate = {
  subject: string;
  role: DestinationMediaRole;
  asset: MediaAsset;
  sourceTier: MediaSourceTier;
  evidence: MediaEvidence;
  evaluation: MediaEvaluation;
  policyVersion: string;
  decision: "pending-review" | "rejected";
};
export type NoneReason =
  | "unresolved-identity"
  | "no-candidates"
  | "all-rejected"
  | "awaiting-review"
  | "withdrawn";
export type SelectionRevision = {
  revision: number;
  status: "approved" | "none";
  assetId: string | null;
  method: "human-review" | "policy";
  selectedAt: string;
  reviewedAt: string | null;
  locked: boolean;
  noneReason: NoneReason | null;
};
export type MediaSelection = SelectionRevision & {
  subject: string;
  role: DestinationMediaRole;
  focalPoint: { x: number; y: number } | null;
  alt: MediaAltText | null;
  reviewedChecksum: MediaChecksum | null;
  reviewedLocalDelivery?: LocalMediaDelivery;
  history: SelectionRevision[];
};
export type MediaRejection = {
  subject: string;
  assetId: string;
  reason: string;
  reviewedAt: string;
};
/** Validated joined snapshot for media policy/history, never a persisted identity authority. */
export type PlaceMediaData = {
  schemaVersion: 1;
  places: PlaceIdentity[];
  assets: MediaAsset[];
  selections: MediaSelection[];
  rejections: MediaRejection[];
};
export type DisplayImage = {
  localVariants?: { src: string; width: number; height: number }[];
  subject: string;
  role: DestinationMediaRole;
  assetId: string;
  provider: string;
  providerFileId: string;
  src: string;
  sourcePage: string;
  author: string;
  attribution: string;
  license: string;
  width: number;
  height: number;
  alt: MediaAltText;
  focalPoint: { x: number; y: number };
  revision: number;
};
export type PlaceMediaResult =
  | { status: "approved"; image: DisplayImage }
  | {
      status: "none";
      reason: NoneReason | "missing-selection" | "invalid-record";
    };
export interface PlaceMediaStore {
  get(subject: string, role: DestinationMediaRole): Promise<PlaceMediaResult>;
}
export interface DestinationMediaDiscovery {
  discover(
    identity: PlaceIdentity,
    role: DestinationMediaRole,
    rejected: readonly MediaRejection[],
  ): Promise<MediaCandidate[]>;
}
