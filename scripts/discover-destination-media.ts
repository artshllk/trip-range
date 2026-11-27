import { placeIdentities, placeRegistry } from "../src/places/runtime/registry";
import { readFileSync } from "node:fs";
import { demoProviders } from "../src/providers/demo";
import {
  flightDestinations,
  existingAirportCodes,
} from "../src/catalogue/flight-destinations";
import { discoverDestinationMedia } from "../src/media/operator/discover";
import {
  subjectId,
  validateMediaRegistry,
} from "../src/domain/media/validation";
import type {
  DestinationMediaRole,
  PlaceInput,
} from "../src/domain/media/types";
async function main() {
  const args = process.argv.slice(2);
  let destination: string | undefined,
    role: DestinationMediaRole = "destination.card",
    live = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw Error("usage");
    seen.add(flag);
    if (flag === "--live") live = true;
    else if (flag === "--destination") destination = args[++i];
    else if (
      flag === "--role" &&
      ["destination.card", "destination.hero"].includes(args[i + 1])
    )
      role = args[++i] as DestinationMediaRole;
    else throw Error("usage");
  }
  if (!subjectId(destination)) throw Error("usage");
  const raw = readFileSync("content/media/approved.json", "utf8");
  if (Buffer.byteLength(raw) > 2_000_000) throw Error("size");
  const checked = validateMediaRegistry(JSON.parse(raw), placeIdentities);
  if (!checked.ok) throw Error("invalid-store");
  const reviewed = placeRegistry.get(destination);
  const catalogue = [
    ...(await demoProviders.destinations.list()),
    ...flightDestinations,
  ];
  const d = catalogue.find((d) => d.id === destination);
  const input: PlaceInput | undefined =
    reviewed ??
    (d
      ? {
          subject: d.id,
          name: d.name.en,
          countryCode: d.countryCode,
          placeKind: d.cityCode ? "city" : "unknown",
          coordinates: d.coordinates,
          iataCodes: d.iataCodes ?? existingAirportCodes[d.id],
          cityCode: d.cityCode,
        }
      : undefined);
  if (!input) {
    console.error(
      "Unknown destination. Register its stable identity in the reviewed place data first.",
    );
    process.exitCode = 1;
    return;
  }
  const report = await discoverDestinationMedia(input, {
    live,
    role,
    reviewed,
    rejections: checked.data.rejections,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "unavailable") process.exitCode = 1;
}
void main().catch(() => {
  console.error(
    "Media discovery unavailable: invalid arguments or source-controlled data. Usage: discover:destination-media -- --destination <id> [--role destination.card|destination.hero] [--live]",
  );
  process.exitCode = 1;
});
