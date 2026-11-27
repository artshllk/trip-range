import { loadContentOperations } from "./lib/content-operations";
import { destinationContentData } from "../content/destinations/records";
import { destinationContentValidationContext } from "../src/content/runtime/approved";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";
import { checkDestinationContentFiles } from "./lib/destination-content-files";

function main() {
  if (process.argv.length !== 2) throw Error("arguments-not-supported");
  loadContentOperations(); // Includes cross-registry evidence/queue/media and manifest consistency.
  const checked = validateDestinationContentData(
    destinationContentData,
    destinationContentValidationContext,
  );
  const files = checkDestinationContentFiles(
    "content/destinations",
    destinationContentData.records,
  );
  const errors = [
    ...(!checked.ok ? checked.errors : []),
    ...(!files.ok ? files.errors : []),
  ];
  console.log(
    JSON.stringify(
      {
        status: errors.length ? "failed" : "passed",
        mode: "offline",
        externalCalls: 0,
        aiCalls: 0,
        ...(checked.ok && files.ok
          ? {
              files: files.files,
              destinations: checked.data.records.length,
              attractions: checked.data.records.reduce(
                (total, record) => total + (record.attractions?.length ?? 0),
                0,
              ),
            }
          : { errors }),
      },
      null,
      2,
    ),
  );
  process.exitCode = errors.length ? 1 : 0;
}
try {
  main();
} catch {
  console.error(
    "Destination content validation failed: invalid arguments or source-controlled records. Usage: check:destination-content (offline only)",
  );
  process.exitCode = 1;
}
