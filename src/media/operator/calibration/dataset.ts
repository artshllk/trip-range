import { createHash } from "node:crypto";
import {
  identityValid,
  object,
  subjectId,
  text,
  wikidataId,
} from "../../../domain/media/validation";
import { unresolvedIdentity } from "../../../places/operator/identity";
import type { CalibrationDataset, CalibrationCase } from "./types";
export const CALIBRATION_LIMITS = {
  defaultBatch: 10,
  maxBatch: 12,
  maxCases: 40,
  deadlineMs: 360000,
  spacingMs: 300,
} as const;
export function validateDataset(value: unknown): CalibrationDataset {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !subjectId(value.id) ||
    typeof value.reviewedOn !== "string" ||
    !/^\d{4}-\d\d-\d\d$/.test(value.reviewedOn) ||
    !text(value.basis, 2000) ||
    !Array.isArray(value.cases) ||
    !value.cases.length ||
    value.cases.length > CALIBRATION_LIMITS.maxCases
  )
    throw Error("invalid-calibration-dataset");
  const ids = new Set<string>();
  for (const c of value.cases) {
    if (
      !object(c) ||
      !object(c.input) ||
      !identityValid(
        unresolvedIdentity(c.input as CalibrationCase["input"], "calibration"),
      ) ||
      ![
        "Europe",
        "Asia",
        "North America",
        "South America",
        "Africa",
        "Oceania",
      ].includes(String(c.continent)) ||
      !text(c.notes, 1500) ||
      !object(c.expected) ||
      c.expected.countryCode !== c.input.countryCode ||
      c.expected.placeKind !== c.input.placeKind ||
      !["resolve", "unresolved"].includes(String(c.expected.outcome)) ||
      !(c.expected.wikidataId === null || wikidataId(c.expected.wikidataId)) ||
      (c.expected.wikidataId
        ? c.expected.reference !==
          `https://www.wikidata.org/wiki/${c.expected.wikidataId}`
        : c.expected.reference !== null) ||
      (c.expected.outcome === "unresolved" && c.expected.wikidataId !== null) ||
      ids.has(String(c.input.subject))
    )
      throw Error("invalid-calibration-case");
    ids.add(String(c.input.subject));
  }
  return value as CalibrationDataset;
}
export function datasetHash(dataset: CalibrationDataset) {
  return createHash("sha256").update(JSON.stringify(dataset)).digest("hex");
}
export type BatchOptions = {
  live: boolean;
  start: number;
  limit: number;
  destination?: string;
};
export function parseCalibrationArgs(args: string[]) {
  const options: BatchOptions & {
    run: string;
    resume: boolean;
    reportOnly: boolean;
  } = {
    live: false,
    start: 0,
    limit: CALIBRATION_LIMITS.defaultBatch,
    run: "offline",
    resume: false,
    reportOnly: false,
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw Error("duplicate-flag");
    seen.add(flag);
    if (flag === "--live") options.live = true;
    else if (flag === "--resume") options.resume = true;
    else if (flag === "--report-only") options.reportOnly = true;
    else if (["--start", "--limit"].includes(flag)) {
      const value = args[++i];
      if (!/^\d{1,2}$/.test(value ?? "")) throw Error("invalid-bound");
      options[flag === "--start" ? "start" : "limit"] = Number(value);
    } else if (flag === "--destination") {
      options.destination = args[++i];
      if (!subjectId(options.destination)) throw Error("invalid-destination");
    } else if (flag === "--run") {
      options.run = args[++i];
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(options.run ?? ""))
        throw Error("invalid-run-name");
    } else throw Error("unknown-flag");
  }
  if (options.live && options.run === "offline")
    throw Error("live-requires-named-run");
  if (options.resume && options.run === "offline")
    throw Error("resume-requires-named-run");
  if (
    options.reportOnly &&
    (options.live ||
      options.resume ||
      options.run === "offline" ||
      seen.has("--destination") ||
      seen.has("--start") ||
      seen.has("--limit"))
  )
    throw Error("invalid-report-only-options");
  if (options.destination && seen.has("--start"))
    throw Error("conflicting-selection");
  if (options.limit < 1 || options.limit > CALIBRATION_LIMITS.maxBatch)
    throw Error("batch-bound-exceeded");
  return options;
}
export function selectCases(
  dataset: CalibrationDataset,
  options: BatchOptions,
  completed: readonly string[] = [],
) {
  if (
    !Number.isInteger(options.start) ||
    options.start < 0 ||
    options.start >= dataset.cases.length ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > CALIBRATION_LIMITS.maxBatch
  )
    throw Error("invalid-batch-bounds");
  if (
    options.destination &&
    !dataset.cases.some((c) => c.input.subject === options.destination)
  )
    throw Error("unknown-calibration-destination");
  return dataset.cases
    .slice(options.start)
    .filter(
      (c) =>
        (!options.destination || c.input.subject === options.destination) &&
        !completed.includes(c.input.subject),
    )
    .slice(0, options.limit);
}
