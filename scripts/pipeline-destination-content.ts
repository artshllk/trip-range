import { loadContentOperations } from "./lib/content-operations";
import { destinationCoverage } from "./lib/destination-coverage";
import { seoLandingRegistry } from "../src/seo/registry";

export function parseContentPipelineArguments(args: readonly string[]): string {
  if (
    args.length !== 2 ||
    args[0] !== "--destination" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,119}$/.test(args[1])
  )
    throw Error("invalid-arguments");
  return args[1];
}
export async function runContentPipelineCommand(
  args: readonly string[],
): Promise<number> {
  const destinationId = parseContentPipelineArguments(args);
  const operations = loadContentOperations();
  const report = await destinationCoverage({
    ...operations,
    destinationId,
    evidence: operations.evidence.get(destinationId) ?? "missing",
    filesValid: true,
    seo: seoLandingRegistry,
  });
  console.log(
    `Destination: ${report.destinationId}\nIdentity: ${report.identity}\nResearch evidence: ${report.research}\nContent file: ${report.draft}\nValidation: ${report.validation}\nReview: ${report.review}\nPublication: ${report.publication}\nLifecycle: ${report.lifecycle}\nDestination media: ${report.mediaDestination}\nAttraction media: ${report.mediaAttractions}\nSEO: ${report.seo.state} (independent policy)\nAutomatic approval: OFF\nWrites: 0 · external calls: 0\nNext: ${report.next}`,
  );
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  return report.validation === "invalid" || report.research === "invalid"
    ? 1
    : 0;
}
if (require.main === module)
  void runContentPipelineCommand(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        "Content pipeline unavailable: invalid arguments or source-controlled data. Usage: pipeline:destination-content -- --destination <id> (offline, read-only)",
      );
      process.exitCode = 1;
    });
