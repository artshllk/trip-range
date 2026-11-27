import { editorialArguments } from "./lib/editorial-commands";
import { editorialMaintenance } from "./lib/editorial-maintenance";
import { loadEditorialWorkspace } from "./lib/editorial-workspace";
import { travelMaintenance } from "./lib/travel-maintenance";
try {
  const flags = editorialArguments(process.argv.slice(2), ["--within-days"]),
    value = flags.get("--within-days") ?? "30";
  if (!/^\d+$/.test(value)) throw Error("invalid-days");
  console.log(
    JSON.stringify(
      {
        ...editorialMaintenance(loadEditorialWorkspace(), +value),
        travelEvidence: travelMaintenance(+value),
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Maintenance report unavailable: invalid arguments or source-controlled data.",
  );
  process.exitCode = 1;
}
