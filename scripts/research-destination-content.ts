import { placeRegistry } from "../src/places/runtime/registry";
import { demoProviders } from "../src/providers/demo";
import {
  flightDestinations,
  existingAirportCodes,
} from "../src/catalogue/flight-destinations";
import type { PlaceInput } from "../src/domain/media/types";
import { parseContentResearchArguments } from "../src/content/operator/arguments";
import { researchDestinationContent } from "../src/content/operator/research";

export async function runContentResearchCommand(args: readonly string[]) {
  const { destination, live } = parseContentResearchArguments(args);
  const reviewed = placeRegistry.get(destination);
  const catalogue = [
    ...(await demoProviders.destinations.list()),
    ...flightDestinations,
  ];
  const record = catalogue.find((place) => place.id === destination);
  const input: PlaceInput | undefined =
    reviewed ??
    (record
      ? {
          subject: record.id,
          name: record.name.en,
          countryCode: record.countryCode,
          placeKind: record.cityCode ? "city" : "unknown",
          coordinates: record.coordinates,
          iataCodes: record.iataCodes ?? existingAirportCodes[record.id],
          cityCode: record.cityCode,
        }
      : undefined);
  if (!input) {
    console.error(
      "Unknown destination. Register its stable identity in the reviewed place data first.",
    );
    return 1;
  }
  const report = await researchDestinationContent(input, { live, reviewed });
  console.log(JSON.stringify(report, null, 2));
  return report.status === "unavailable" ? 1 : 0;
}

if (require.main === module) {
  void runContentResearchCommand(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        "Destination content research unavailable: invalid arguments or source-controlled data. Usage: research:destination-content -- --destination <id> [--live]",
      );
      process.exitCode = 1;
    });
}
