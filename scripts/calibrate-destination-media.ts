import { readFileSync } from "node:fs";
import {
  validateDataset,
  parseCalibrationArgs,
} from "../src/media/operator/calibration/dataset";
import { calibrateDestinationMedia } from "../src/media/operator/calibration/runner";
import { calibrationMetrics } from "../src/media/operator/calibration/metrics";
import { calibrationFiles } from "./lib/media-calibration-files";
async function main() {
  const options = parseCalibrationArgs(process.argv.slice(2));
  const dataset = validateDataset(
    JSON.parse(
      readFileSync("docs/research/destination-media/dataset.json", "utf8"),
    ),
  );
  const files =
    options.run === "offline"
      ? undefined
      : calibrationFiles(options.run, dataset);
  if (options.reportOnly) {
    const report = files!.read();
    files!.write(report);
    console.log(
      JSON.stringify(
        { mode: "report-only", metrics: calibrationMetrics(report, dataset) },
        null,
        2,
      ),
    );
    return;
  }
  if (files?.exists() && !options.resume)
    throw Error("existing-run-requires-resume");
  const previous = options.resume ? files?.read() : undefined;
  const report = await calibrateDestinationMedia(dataset, options, {
    previous,
    onRow: (report) => {
      files?.write(report);
      const row = report.rows[report.rows.length - 1]!;
      console.error(
        JSON.stringify({
          subject: row.input.subject,
          status: row.status,
          requests: row.requests,
          candidates: row.candidates.length,
          failures: row.failures,
        }),
      );
    },
  });
  files?.write(report);
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        stopReason: report.stopReason,
        automaticApproval: false,
        automaticIngestion: false,
        metrics: calibrationMetrics(report, dataset),
      },
      null,
      2,
    ),
  );
  if (
    ["rate-limit", "provider-failures", "deadline"].includes(report.stopReason)
  )
    process.exitCode = 1;
}
void main().catch(() => {
  console.error(
    "Calibration stopped: invalid arguments, incompatible/corrupt research data, or unsafe output. Use [--live --run name] [--limit 1..12] [--start index | --destination id] [--resume], or --report-only --run name. No production records were written.",
  );
  process.exitCode = 1;
});
