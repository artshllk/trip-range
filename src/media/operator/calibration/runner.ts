import "server-only";
import { createMediaApi } from "../../adapters/api";
import { createWikidataIdentityResolver } from "../../../places/adapters/wikidata";
import { createCommonsMediaDiscovery } from "../../adapters/commons";
import {
  unresolvedIdentity,
  normalizedPlaceName,
  distanceKm,
  PLACE_RADIUS_KM,
} from "../../../places/operator/identity";
import {
  AUTOMATIC_MEDIA_APPROVAL,
  AUTOMATIC_MEDIA_INGESTION,
} from "../../../domain/media/policy";
import {
  CALIBRATION_LIMITS,
  datasetHash,
  selectCases,
  type BatchOptions,
} from "./dataset";
import type {
  CalibrationCase,
  CalibrationDataset,
  CalibrationReport,
  CalibrationRow,
  FailureCategory,
} from "./types";
export function failureCategories(
  row: CalibrationRow,
  c: CalibrationCase,
): FailureCategory[] {
  const categories: FailureCategory[] = [];
  if (row.status === "offline") return categories;
  if (row.failures.length) categories.push("provider-unavailable");
  const reason = row.identity.unresolvedReason ?? "";
  if (reason.includes("ambiguous")) categories.push("ambiguous");
  if (reason.includes("coordinates-required")) categories.push("missing-data");
  if (
    row.identity.external &&
    c.expected.wikidataId &&
    row.identity.external.id !== c.expected.wikidataId
  )
    categories.push("wrong-entity");
  if (!row.identity.external) {
    for (const trace of row.identityEvidence) {
      categories.push(...trace.excluded);
      for (const e of trace.evidence) {
        if (e.countryCode !== c.expected.countryCode) {
          categories.push("country-mismatch");
          continue;
        }
        if (
          c.expected.placeKind !== "unknown" &&
          e.placeKind !== c.expected.placeKind
        ) {
          categories.push("unsupported-class");
          continue;
        }
        if (
          !e.names.some(
            (n) => normalizedPlaceName(n) === normalizedPlaceName(c.input.name),
          )
        ) {
          categories.push("name-mismatch");
          continue;
        }
        if (c.input.coordinates && !e.coordinates)
          categories.push("missing-data");
        else if (
          c.input.coordinates &&
          e.coordinates &&
          distanceKm(c.input.coordinates, e.coordinates) >
            PLACE_RADIUS_KM[e.placeKind]
        )
          categories.push("coordinate-mismatch");
      }
    }
    if (!categories.length) categories.push("missing-data");
  }
  return [...new Set(categories)];
}
export async function calibrateDestinationMedia(
  dataset: CalibrationDataset,
  options: BatchOptions,
  dependencies: {
    fetcher?: typeof fetch;
    now?: () => string;
    clock?: () => number;
    pause?: (ms: number) => Promise<void>;
    previous?: CalibrationReport;
    onRow?: (report: CalibrationReport) => void;
  } = {},
): Promise<CalibrationReport> {
  if (AUTOMATIC_MEDIA_APPROVAL || AUTOMATIC_MEDIA_INGESTION)
    throw Error("automation-forbidden");
  const now = dependencies.now ?? (() => new Date().toISOString());
  const clock = dependencies.clock ?? Date.now;
  const pause =
    dependencies.pause ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const previous = dependencies.previous;
  if (
    previous &&
    (previous.datasetHash !== datasetHash(dataset) ||
      previous.mode !== (options.live ? "live" : "offline") ||
      previous.stopReason === "rate-limit")
  )
    throw Error("incompatible-or-rate-limited-resume");
  const report: CalibrationReport = previous
    ? structuredClone(previous)
    : {
        schemaVersion: 1,
        datasetId: dataset.id,
        datasetHash: datasetHash(dataset),
        mode: options.live ? "live" : "offline",
        startedAt: now(),
        finishedAt: now(),
        automaticApproval: false,
        automaticIngestion: false,
        stopReason: "complete",
        rows: [],
      };
  report.stopReason = "complete";
  const selected = selectCases(
    dataset,
    options,
    report.rows.map((r) => r.input.subject),
  );
  const started = clock();
  let consecutiveFailures = 0;
  for (const c of selected) {
    if (clock() - started >= CALIBRATION_LIMITS.deadlineMs) {
      report.stopReason = "deadline";
      break;
    }
    const row: CalibrationRow = {
      input: structuredClone(c.input),
      identity: unresolvedIdentity(c.input, "live-resolution-not-requested"),
      identityEvidence: [],
      identityReview: {
        identityCorrect: "uncertain",
        reviewedAt: null,
        reviewerNotes:
          "Identity review pending; expected-ID comparison is a separate metric.",
      },
      status: "offline",
      requests: { wikidata: 0, commons: 0 },
      failures: [],
      failureCategories: [],
      candidates: [],
      missedGoodImageNotes: [],
    };
    if (options.live) {
      const transport = createMediaApi(async (input, init) => {
        await pause(CALIBRATION_LIMITS.spacingMs);
        // Abort during the pacing wait must not start an overdue network request.
        init?.signal?.throwIfAborted();
        return (dependencies.fetcher ?? fetch)(input, init);
      });
      row.identity = await createWikidataIdentityResolver(
        transport.api,
        now,
        (trace) => row.identityEvidence.push(trace),
      ).resolve(c.input);
      row.status = row.identity.external ? "complete" : "unresolved";
      if (row.identity.external) {
        const properties = new Map<string, string[]>();
        try {
          const candidates = await createCommonsMediaDiscovery(
            transport.api,
            now,
            (id, p) => properties.set(id, p),
          ).discover(row.identity, "destination.card", []);
          row.candidates = candidates.map((candidate) => ({
            candidate,
            sourceProperties: properties.get(candidate.asset.id) ?? [],
            review: {
              imageRelevant: "uncertain",
              roleFit: "uncertain",
              method: "pending",
              reviewedAt: null,
              reviewerNotes:
                "Human visual review pending; metadata is not visual confirmation.",
            },
          }));
        } catch {
          row.status = "unavailable";
        }
      }
      row.requests = { ...transport.counts };
      row.failures = [...transport.failures];
      if (row.failures.length) row.status = "unavailable";
      row.failureCategories = failureCategories(row, c);
      consecutiveFailures =
        row.failures.length || row.status === "unavailable"
          ? consecutiveFailures + 1
          : 0;
      if (row.failures.some((f) => f.reason === "rate-limit"))
        report.stopReason = "rate-limit";
      else if (consecutiveFailures >= 2)
        report.stopReason = "provider-failures";
    }
    report.rows.push(row);
    report.finishedAt = now();
    dependencies.onRow?.(structuredClone(report));
    if (report.stopReason !== "complete") break;
  }
  report.finishedAt = now();
  return report;
}
