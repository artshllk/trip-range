import {
  identityValid,
  object,
  text,
  instant,
  safeMediaUrl,
  checksumValid,
  coordinatesValid,
  wikidataId,
} from "../../../domain/media/validation";
import { evaluateCandidate } from "../evaluate";
import { datasetHash } from "./dataset";
import type {
  CalibrationDataset,
  CalibrationReport,
  CalibrationCandidate,
  CalibrationRow,
} from "./types";
const answer = (v: unknown) => ["yes", "no", "uncertain"].includes(String(v));
const note = (v: unknown) => v === "" || text(v, 2000);
function safeTree(v: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (v === null || typeof v === "boolean") return true;
  if (typeof v === "number")
    return Number.isFinite(v) && Math.abs(v) <= 1000000;
  if (typeof v === "string")
    return v.length <= 3000 && !/[<>\u0000-\u001f\u007f-\u009f]/.test(v);
  if (Array.isArray(v))
    return v.length <= 100 && v.every((x) => safeTree(x, depth + 1));
  return (
    object(v) &&
    Object.keys(v).length <= 40 &&
    Object.entries(v).every(
      ([k, x]) =>
        !/token|password|secret|authorization|__proto__|constructor|rawhtml/i.test(
          k,
        ) && safeTree(x, depth + 1),
    )
  );
}
function candidateValid(
  entry: unknown,
  row: CalibrationRow,
): entry is CalibrationCandidate {
  if (
    !object(entry) ||
    !object(entry.candidate) ||
    !object(entry.review) ||
    !Array.isArray(entry.sourceProperties) ||
    !entry.sourceProperties.every((p) =>
      ["P18", "P3451", "P4291"].includes(String(p)),
    )
  )
    return false;
  const c = entry.candidate,
    r = entry.review;
  if (
    c.subject !== row.input.subject ||
    c.role !== "destination.card" ||
    !["T1", "T2", "T3"].includes(String(c.sourceTier)) ||
    !object(c.asset) ||
    !object(c.evidence) ||
    !object(c.evidence.entity) ||
    c.evidence.entity.authority !== "wikidata" ||
    !(
      wikidataId(c.evidence.entity.id) || c.evidence.entity.id === "unresolved"
    ) ||
    !Array.isArray(c.evidence.depictionTags) ||
    !c.evidence.depictionTags.every((t) => text(t, 80)) ||
    ![
      c.evidence.exactEntityImage,
      c.evidence.exactDepicts,
      c.evidence.articleUsage,
      c.evidence.recognizedQuality,
      c.evidence.withinBounds,
    ].every((v) => typeof v === "boolean")
  )
    return false;
  const a = c.asset;
  if (
    a.provider !== "wikimedia-commons" ||
    typeof a.providerFileId !== "string" ||
    !/^[1-9]\d{0,14}$/.test(a.providerFileId) ||
    a.id !== `commons:${a.providerFileId}` ||
    !checksumValid(a.checksum) ||
    !(
      a.sourcePage === null ||
      safeMediaUrl(a.sourcePage, "commons.wikimedia.org", "/wiki/File:")
    ) ||
    !(
      a.originalUrl === null ||
      safeMediaUrl(
        a.originalUrl,
        "upload.wikimedia.org",
        "/wikipedia/commons/",
        true,
      )
    ) ||
    !Number.isSafeInteger(a.width) ||
    !Number.isSafeInteger(a.height) ||
    !text(a.mimeType, 80) ||
    !note(a.author) ||
    !note(a.attribution) ||
    !object(a.health) ||
    a.health.status !== "unchecked" ||
    a.health.checkedAt !== null
  )
    return false;
  if (
    a.license !== null &&
    (!object(a.license) ||
      !text(a.license.name, 80) ||
      !instant(a.license.verifiedAt) ||
      !safeMediaUrl(a.license.url, "creativecommons.org", "/"))
  )
    return false;
  if (
    !answer(r.imageRelevant) ||
    !answer(r.roleFit) ||
    !note(r.reviewerNotes) ||
    (r.method === "pending"
      ? r.imageRelevant !== "uncertain" ||
        r.roleFit !== "uncertain" ||
        r.reviewedAt !== null
      : r.method !== "visual" ||
        !instant(r.reviewedAt) ||
        !text(r.reviewerNotes, 2000))
  )
    return false;
  const typed = c as CalibrationCandidate["candidate"];
  const evaluated = evaluateCandidate(
    row.identity,
    typed.role,
    typed.asset,
    typed.sourceTier,
    typed.evidence,
  );
  return (
    c.policyVersion === evaluated.policyVersion &&
    c.decision === evaluated.decision &&
    JSON.stringify(c.evaluation) === JSON.stringify(evaluated.evaluation)
  );
}
/** Reject corrupt, unsafe or incompatible evidence before metrics, resume or HTML generation. */
export function validateCalibrationReport(
  value: unknown,
  dataset: CalibrationDataset,
): CalibrationReport {
  const fail = () => {
    throw Error("invalid-calibration-report");
  };
  if (
    !safeTree(value) ||
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.datasetId !== dataset.id ||
    value.datasetHash !== datasetHash(dataset) ||
    !["offline", "live"].includes(String(value.mode)) ||
    !instant(value.startedAt) ||
    !instant(value.finishedAt) ||
    value.finishedAt < value.startedAt ||
    value.automaticApproval !== false ||
    value.automaticIngestion !== false ||
    !["complete", "rate-limit", "provider-failures", "deadline"].includes(
      String(value.stopReason),
    ) ||
    !Array.isArray(value.rows) ||
    value.rows.length > dataset.cases.length
  )
    return fail();
  const ids = new Set();
  for (const raw of value.rows) {
    if (
      !object(raw) ||
      !object(raw.input) ||
      !identityValid(raw.identity) ||
      !object(raw.requests) ||
      !object(raw.identityReview) ||
      !Array.isArray(raw.failures) ||
      !Array.isArray(raw.identityEvidence) ||
      !Array.isArray(raw.failureCategories) ||
      !Array.isArray(raw.candidates) ||
      raw.candidates.length > 8 ||
      !Array.isArray(raw.missedGoodImageNotes) ||
      !raw.missedGoodImageNotes.every(note)
    )
      return fail();
    const input = raw.input;
    const c = dataset.cases.find((c) => c.input.subject === input.subject);
    if (
      !c ||
      ids.has(c.input.subject) ||
      JSON.stringify(c.input) !== JSON.stringify(raw.input) ||
      raw.identity.subject !== c.input.subject ||
      !["offline", "complete", "unresolved", "unavailable"].includes(
        String(raw.status),
      )
    )
      return fail();
    ids.add(c.input.subject);
    if (
      ![raw.requests.wikidata, raw.requests.commons].every(
        (v) => Number.isSafeInteger(v) && Number(v) >= 0,
      ) ||
      Number(raw.requests.wikidata) > 10 ||
      Number(raw.requests.commons) > 4 ||
      !answer(raw.identityReview.identityCorrect) ||
      !note(raw.identityReview.reviewerNotes) ||
      !(
        raw.identityReview.reviewedAt === null ||
        instant(raw.identityReview.reviewedAt)
      ) ||
      (raw.identityReview.identityCorrect !== "uncertain" &&
        !instant(raw.identityReview.reviewedAt))
    )
      return fail();
    if (
      raw.status === "offline" &&
      (value.mode !== "offline" ||
        raw.requests.wikidata !== 0 ||
        raw.requests.commons !== 0 ||
        raw.candidates.length ||
        raw.failures.length ||
        raw.identity.external)
    )
      return fail();
    if (value.mode === "offline" && raw.status !== "offline") return fail();
    if (
      (raw.status === "complete" &&
        (!raw.identity.external || !raw.requests.wikidata)) ||
      (raw.status === "unresolved" &&
        (raw.identity.external || raw.failures.length)) ||
      (raw.failures.length && raw.status !== "unavailable") ||
      (raw.candidates.length && raw.status !== "complete")
    )
      return fail();
    for (const f of raw.failures)
      if (
        !object(f) ||
        !["wikidata", "commons"].includes(String(f.service)) ||
        ![
          "rate-limit",
          "timeout",
          "network",
          "provider-unavailable",
          "malformed-response",
          "oversized-response",
          "request-budget-exhausted",
        ].includes(String(f.reason)) ||
        !(
          f.httpStatus === null ||
          (Number.isInteger(f.httpStatus) &&
            Number(f.httpStatus) >= 100 &&
            Number(f.httpStatus) <= 599)
        )
      )
        return fail();
    if (
      !raw.failureCategories.every((v) =>
        [
          "ambiguous",
          "no-transport-mapping",
          "name-mismatch",
          "country-mismatch",
          "coordinate-mismatch",
          "unsupported-class",
          "missing-data",
          "provider-unavailable",
          "wrong-entity",
        ].includes(String(v)),
      )
    )
      return fail();
    for (const trace of raw.identityEvidence)
      if (
        !object(trace) ||
        !["transport-code", "constrained-name"].includes(String(trace.stage)) ||
        !Array.isArray(trace.evidence) ||
        trace.evidence.length > 32 ||
        !trace.evidence.every(
          (e) =>
            object(e) &&
            object(e.external) &&
            e.external.authority === "wikidata" &&
            wikidataId(e.external.id) &&
            Array.isArray(e.names) &&
            e.names.length <= 13 &&
            e.names.every((n) => text(n, 180)) &&
            typeof e.countryCode === "string" &&
            /^[A-Z]{2}$/.test(e.countryCode) &&
            ["city", "island", "region", "nature-area", "unknown"].includes(
              String(e.placeKind),
            ) &&
            (e.coordinates === undefined || coordinatesValid(e.coordinates)) &&
            Array.isArray(e.transportCodes) &&
            e.transportCodes.length <= 12 &&
            e.transportCodes.every(
              (c) => typeof c === "string" && /^[A-Z]{3}$/.test(c),
            ),
        ) ||
        !Array.isArray(trace.excluded) ||
        !trace.excluded.every((v) =>
          [
            "unsupported-class",
            "missing-data",
            "no-transport-mapping",
          ].includes(String(v)),
        )
      )
        return fail();
    const row = raw as CalibrationRow;
    if (
      !raw.candidates.every((entry) => candidateValid(entry, row)) ||
      new Set(row.candidates.map((e) => e.candidate.asset.id)).size !==
        row.candidates.length
    )
      return fail();
  }
  if (
    value.rows.some((r) =>
      r.failures.some((f: { reason: string }) => f.reason === "rate-limit"),
    ) &&
    value.stopReason !== "rate-limit"
  )
    return fail();
  return value as CalibrationReport;
}
