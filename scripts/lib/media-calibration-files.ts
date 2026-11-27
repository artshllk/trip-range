import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CalibrationDataset,
  CalibrationReport,
} from "../../src/media/operator/calibration/types";
import { validateCalibrationReport } from "../../src/media/operator/calibration/validation";
import { reviewHtml } from "../../src/media/operator/calibration/report";
import { calibrationMetrics } from "../../src/media/operator/calibration/metrics";
/** Fixed research directory only: no caller-supplied output path, production imports or writes. */
export function calibrationFiles(
  run: string,
  dataset: CalibrationDataset,
  root = process.cwd(),
) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(run)) throw Error("invalid-run-name");
  let directory = resolve(root);
  for (const segment of ["docs", "research", "destination-media", "runs"]) {
    directory = join(directory, segment);
    if (existsSync(directory)) {
      if (
        lstatSync(directory).isSymbolicLink() ||
        !lstatSync(directory).isDirectory()
      )
        throw Error("unsafe-research-directory");
    } else mkdirSync(directory);
  }
  const file = (extension: string) => join(directory, `${run}.${extension}`);
  const safe = (path: string) => {
    if (
      existsSync(path) &&
      (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
    )
      throw Error("unsafe-research-file");
  };
  return {
    exists: () => {
      safe(file("json"));
      return existsSync(file("json"));
    },
    read: () => {
      safe(file("json"));
      if (lstatSync(file("json")).size > 5_000_000)
        throw Error("oversized-research-file");
      return validateCalibrationReport(
        JSON.parse(readFileSync(file("json"), "utf8")),
        dataset,
      );
    },
    write: (report: CalibrationReport) => {
      validateCalibrationReport(report, dataset);
      for (const [ext, body] of [
        ["json", JSON.stringify(report, null, 2) + "\n"],
        [
          "metrics.json",
          JSON.stringify(calibrationMetrics(report, dataset), null, 2) + "\n",
        ],
        ["html", reviewHtml(report, dataset)],
      ]) {
        if (Buffer.byteLength(body) > 5_000_000)
          throw Error("oversized-research-output");
        const target = file(ext);
        safe(target);
        const temporary = join(directory, `.${randomUUID()}.tmp`);
        writeFileSync(temporary, body, { flag: "wx", mode: 0o600 });
        renameSync(temporary, target);
      }
    },
  };
}
