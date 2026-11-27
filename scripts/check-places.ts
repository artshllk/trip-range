import { placeRegistryData } from "../content/places/records";
import { validatePlaceRegistry } from "../src/domain/places/validation";
import { checkDestinationContentFiles } from "./lib/destination-content-files";
try {
  if (process.argv.length !== 2) throw Error("arguments");
  const checked = validatePlaceRegistry(placeRegistryData);
  const files = checkDestinationContentFiles(
    "content/places",
    placeRegistryData.records,
    "subject",
  );
  const errors = [...checked.errors, ...(!files.ok ? files.errors : [])];
  console.log(
    JSON.stringify(
      {
        status: errors.length ? "failed" : "passed",
        mode: "offline",
        places: checked.ok ? checked.data.records.length : 0,
        writes: 0,
        externalCalls: 0,
        errors,
      },
      null,
      2,
    ),
  );
  process.exitCode = errors.length ? 1 : 0;
} catch {
  console.error(
    "Place validation failed: invalid arguments or source-controlled data.",
  );
  process.exitCode = 1;
}
