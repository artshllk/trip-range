import { placeIdentities } from "../src/places/runtime/registry";
import approvedMedia from "../content/media/approved.json";
import { destinationContentData } from "../content/destinations/records";
import { validateMediaRegistry } from "../src/domain/media/validation";
import { checkDestinationContentFiles } from "./lib/destination-content-files";
import {
  buildDestinationContentReview,
  renderDestinationContentReviewHtml,
  renderDestinationContentReviewText,
} from "./lib/destination-content-review";
import { loadEditorialWorkspace } from "./lib/editorial-workspace";
import { assessEditorialReview } from "./lib/editorial-review";

export function parseContentReviewArguments(args: string[]): {
  destination: string;
  format: "text" | "html";
} {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--destination", "--format"].includes(args[i]) ||
      !args[i + 1] ||
      flags.has(args[i])
    )
      throw Error("invalid-arguments");
    flags.set(args[i], args[i + 1]);
  }
  const destination = flags.get("--destination");
  const format = flags.get("--format") ?? "text";
  if (
    !destination ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,119}$/.test(destination) ||
    !["text", "html"].includes(format)
  )
    throw Error("invalid-arguments");
  return { destination, format: format as "text" | "html" };
}

export function runContentReviewCommand(args: string[]): number {
  const options = parseContentReviewArguments(args);
  const media = validateMediaRegistry(approvedMedia, placeIdentities);
  const files = checkDestinationContentFiles(
    "content/destinations",
    destinationContentData.records,
  );
  if (!media.ok || !files.ok) throw Error("invalid-source-controlled-data");
  const report = buildDestinationContentReview(
    destinationContentData,
    {
      identities: placeIdentities,
      mediaSubjects: placeIdentities.map((place) => place.subject),
    },
    options.destination,
  );
  const workspace = loadEditorialWorkspace();
  report.editorial = assessEditorialReview(
    workspace.inputs.get(options.destination)!,
    workspace.reviews.get(options.destination),
  );
  console.log(
    options.format === "html"
      ? renderDestinationContentReviewHtml(report)
      : renderDestinationContentReviewText(report),
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = runContentReviewCommand(process.argv.slice(2));
  } catch {
    console.error(
      "Destination content review failed: invalid arguments, missing manifest destination or invalid source-controlled data. Usage: review:destination-content -- --destination <id> [--format text|html] (offline, read-only)",
    );
    process.exitCode = 1;
  }
}
