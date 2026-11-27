import type {
  MediaCandidate,
  MediaEvidence,
  MediaAsset,
  MediaSourceTier,
  DestinationMediaRole,
  PlaceIdentity,
  MediaGate,
} from "../../domain/media/types";
import { assetProblems } from "../../domain/media/validation";
import {
  AUTOMATIC_MEDIA_APPROVAL,
  MEDIA_POLICY_VERSION,
} from "../../domain/media/policy";

export const DESTINATION_VETO_TAGS = [
  "animal",
  "flora-closeup",
  "portrait",
  "food",
  "flag",
  "coat-of-arms",
  "logo",
  "map",
  "diagram",
  "screenshot",
  "collage",
  "satellite",
] as const;
export const SCENE_TAGS = [
  "cityscape",
  "landscape",
  "coast",
  "panorama",
] as const;
/** Conservative text/structured-metadata signals, not image recognition. Unknown remains review. */
export const DEPICTION_PATTERNS: ReadonlyArray<{
  tag: string;
  pattern: RegExp;
}> = [
  {
    tag: "animal",
    pattern:
      /\b(animal|species|taxon|wildlife|bird|pigeon|dog|cat|insect|butterfly)\b/i,
  },
  {
    tag: "flora-closeup",
    pattern: /\b(flower|flora|botanical|plant close.?up|petal)\b/i,
  },
  { tag: "portrait", pattern: /\b(portrait|selfie|human|person)\b/i },
  { tag: "food", pattern: /\b(food|dish|meal|cuisine)\b/i },
  ...[
    "flag",
    "logo",
    "map",
    "diagram",
    "screenshot",
    "collage",
    "satellite",
  ].map((tag) => ({ tag, pattern: new RegExp(`\\b${tag}\\b`, "i") })),
  { tag: "collage", pattern: /\bmontage\b/i },
  { tag: "coat-of-arms", pattern: /\bcoat[ _-]of[ _-]arms\b/i },
  { tag: "cityscape", pattern: /\b(cityscape|skyline|townscape)\b/i },
  { tag: "landscape", pattern: /\b(landscape|valley|mountains|waterfall)\b/i },
  { tag: "coast", pattern: /\b(coast|coastal|beach|seascape)\b/i },
  { tag: "panorama", pattern: /\bpanorama\b/i },
];
export function depictionTags(metadata: string): string[] {
  return [
    ...new Set(
      DEPICTION_PATTERNS.filter((p) => p.pattern.test(metadata)).map(
        (p) => p.tag,
      ),
    ),
  ];
}
export function evaluateCandidate(
  identity: PlaceIdentity,
  role: DestinationMediaRole,
  asset: MediaAsset,
  sourceTier: MediaSourceTier,
  evidence: MediaEvidence,
): MediaCandidate {
  const admissibilityErrors = assetProblems(asset);
  const exact =
    !!identity.external &&
    identity.external.authority === evidence.entity.authority &&
    identity.external.id === evidence.entity.id;
  const identityErrors = !exact ? ["destination-identity-mismatch"] : [];
  const veto = evidence.depictionTags
    .filter((t) => (DESTINATION_VETO_TAGS as readonly string[]).includes(t))
    .map((t) => `depiction:${t}`);
  if (asset.mimeType === "image/svg+xml") veto.push("unsafe-svg");
  const dimensions = asset.width >= 1200 && asset.height >= 600;
  const ratio = asset.width / asset.height;
  const shape = Number.isFinite(ratio) && ratio >= 1.2 && ratio <= 2.5;
  const roleErrors = [
    ...(!dimensions ? ["too-small"] : []),
    ...(!shape ? ["unsuitable-dimensions"] : []),
  ];
  const scene = evidence.depictionTags.some((t) =>
    (SCENE_TAGS as readonly string[]).includes(t),
  );
  const gate = (errors: string[], review?: string): MediaGate => ({
    status: errors.length ? "fail" : review ? "review" : "pass",
    reasons: errors.length ? errors : review ? [review] : [],
  });
  const strongIdentity =
    exact &&
    ((sourceTier === "T1" && evidence.exactEntityImage) ||
      (sourceTier === "T2" && evidence.exactDepicts));
  const vetoReasons = [
    ...new Set([
      ...admissibilityErrors,
      ...identityErrors,
      ...veto,
      ...roleErrors,
    ]),
  ];
  // Scores are diagnostic; even four passes never produce an approval.
  const score = Math.min(
    100,
    (exact && evidence.exactEntityImage ? 35 : 0) +
      (exact && evidence.exactDepicts ? 25 : 0) +
      (scene ? 15 : 0) +
      (dimensions ? 5 : 0) +
      (shape ? 5 : 0) +
      (evidence.articleUsage ? 5 : 0) +
      (evidence.recognizedQuality ? 5 : 0) +
      (evidence.withinBounds ? 5 : 0),
  );
  if (AUTOMATIC_MEDIA_APPROVAL)
    throw Error("Automatic approval must remain disabled");
  return {
    subject: identity.subject,
    role,
    asset,
    sourceTier,
    evidence,
    policyVersion: MEDIA_POLICY_VERSION,
    decision: vetoReasons.length ? "rejected" : "pending-review",
    evaluation: {
      admissibility: gate(admissibilityErrors),
      identity: gate(
        identityErrors,
        !strongIdentity ? "review-destination-relationship" : undefined,
      ),
      depiction: gate(veto, "human-must-confirm-the-main-subject"),
      roleFit: gate(
        roleErrors,
        sourceTier === "T3"
          ? "landmark-tier-is-review-only"
          : !scene
            ? "review-travel-scene-and-crop"
            : undefined,
      ),
      score,
      vetoReasons,
    },
  };
}
