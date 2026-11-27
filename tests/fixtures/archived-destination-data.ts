import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDestinationAccessStore } from "../../src/travel/runtime/access-store";
import { createPinnedDestinationContentStore } from "../../src/content/runtime/publication";
import type { loadContentOperations as liveOperations } from "../../scripts/lib/content-operations";
import { loadEditorialWorkspace as liveWorkspace } from "../../scripts/lib/editorial-workspace";
import { fxData } from "./fx-frozen";
import type { DestinationContentData } from "../../src/domain/destination-content/types";
import type { DestinationAccessData } from "../../src/domain/destination-access/types";

/** Immutable historical scenarios, never current editorial inputs. See the fixture README.
 * Real loader/receipt/expiry guards still run; only their data and clock are pinned. */
export const historicalEditorialRoot = resolve(
  "tests/fixtures/editorial-baseline-2026-11-02",
);
export const historicalEditorialNow = Date.parse("2026-10-26T16:00:00Z");
const read = (path: string) =>
  JSON.parse(readFileSync(join(historicalEditorialRoot, path), "utf8"));
type Operations = ReturnType<typeof liveOperations>;
const snapshot = read("operations.json") as Omit<
  Operations,
  "data" | "evidence"
> & {
  evidence: Array<
    [string, Operations["evidence"] extends Map<string, infer V> ? V : never]
  >;
};
export const placeIdentities = snapshot.context.identities;
export const destinationContentValidationContext = snapshot.context;
export const destinationContentData: DestinationContentData = {
  schemaVersion: 1,
  records: readdirSync(join(historicalEditorialRoot, "content/destinations"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => read(`content/destinations/${name}`))
    .sort((a, b) => a.destinationId.localeCompare(b.destinationId)),
};
export const destinationAccessData: DestinationAccessData = read("access.json");
export const destinationAccess = createDestinationAccessStore(
  destinationAccessData,
  placeIdentities,
  () => historicalEditorialNow,
  fxData,
);
export const approvedDestinationContent = createPinnedDestinationContentStore(
  destinationContentData,
  destinationContentValidationContext,
  () => historicalEditorialNow,
);

export function loadContentOperations(): Operations {
  return structuredClone({
    ...snapshot,
    data: destinationContentData,
    evidence: new Map(snapshot.evidence),
  });
}

export function loadEditorialWorkspace(
  root = process.cwd(),
  operations = loadContentOperations(),
  now = historicalEditorialNow,
) {
  // Synthetic mutation tests retain their temporary files and the real loader's guards.
  // The ordinary historical path reads frozen files, never the mutable live corpus.
  return liveWorkspace(
    resolve(root) === process.cwd() ? historicalEditorialRoot : root,
    operations,
    now,
  );
}

export type { EditorialWorkspace } from "../../scripts/lib/editorial-workspace";

import { createDestinationGuideService } from "../../src/services/destination-guides";
import { approvedPlaceMedia } from "../../src/media/runtime/approved";
import { createTravelProviders as compose } from "../../src/providers/server/composition";
import { createTravelProviders as offlineCompose } from "../flight-provider-fixture";
import { demoProviders } from "../../src/providers/demo";
import {
  existingAirportCodes,
  flightDestinations,
} from "../../src/catalogue/flight-destinations";
import parkedPolicy from "../../src/config/parked-destinations.json";
import { reviewDestinationBatch as reviewBatch } from "../../scripts/lib/destination-batch-review";
export { isBatchPreparation } from "../../scripts/lib/destination-batch-review";
// Explicit pre-archive guide collection, for historical render/receipt regression only.
export const destinationCollection = [
  ["vienna", "vienna"],
  ["london", "london"],
  ["paris", "paris"],
  ["new-york", "place:Q60"],
  ["istanbul", "istanbul"],
  ["barcelona", "city:BCN"],
  ["singapore", "place:Q334"],
  ["mexico-city", "place:Q1489"],
  ["tokyo", "place:Q1490"],
  ["kyoto", "place:Q34600"],
  ["bangkok", "place:Q1861"],
  ["marrakesh", "place:Q101625"],
  ["cape-town", "place:Q5465"],
  ["rio-de-janeiro", "place:Q8678"],
  ["sydney", "place:Q3130"],
  ["dubai", "place:Q612"],
].map(([slug, subject]) => ({ slug, subject }));
export const { destinationGuideTarget, loadDestinationGuide } =
  createDestinationGuideService(
    destinationCollection,
    placeIdentities,
    destinationAccess,
    approvedDestinationContent,
    approvedPlaceMedia,
  );
export async function getDestinationGuides() {
  const guides = await Promise.all(
    destinationCollection.map((d) => loadDestinationGuide(d.slug)),
  );
  return guides.filter((g): g is NonNullable<typeof g> => !!g);
}
export async function createTravelProviders(
  ...args: Parameters<typeof compose>
): Promise<import("../../src/providers/contracts").TravelProviders> {
  const providers = await compose(...args);
  return historicalProviders(providers);
}
export async function createOfflineTravelProviders(
  ...args: Parameters<typeof compose>
): Promise<import("../../src/providers/contracts").TravelProviders> {
  const providers = await offlineCompose(...args);
  return historicalProviders(providers);
}
/** Parked and origin-only destinations remain explicit historical fixtures. */
async function historicalProviders(
  providers: import("../../src/providers/contracts").TravelProviders,
) {
  const current = await providers.destinations.list();
  const previous = [
    ...(await demoProviders.destinations.list()).map((d) => ({
      ...d,
      iataCodes: existingAirportCodes[d.id],
    })),
    ...flightDestinations,
  ].filter(
    (d) =>
      d.id === "prishtina" ||
      parkedPolicy.records.some((p) => p.name === d.name.en),
  );
  const catalogue = [
    ...current,
    ...previous.filter((d) => !current.some((c) => c.id === d.id)),
  ];
  return {
    ...providers,
    destinationAccess,
    destinations: { list: async () => catalogue },
  };
}
export function reviewDestinationBatch(
  ...args: Parameters<typeof reviewBatch>
) {
  const [batch, preparation, workspace, now] = args;
  return reviewBatch(batch, preparation, workspace, now, destinationAccessData);
}
