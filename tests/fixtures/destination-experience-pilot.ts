/** Explicit local review data only. Never import this module into src/ or content/. */
import { destinationContentData } from "../../content/destinations/records";
import { placeRegistryData } from "../../content/places/records";
import type {
  DestinationContent,
  DestinationContentData,
} from "../../src/domain/destination-content/types";
import type { PlaceIdentity } from "../../src/domain/places/types";
import vienna from "../../docs/research/destination-content/phase2/vienna.json";
import london from "../../docs/research/destination-content/phase2/london.json";
import viennaIdentity from "../../docs/research/destination-content/phase2/vienna-identity.json";

export const pilotDrafts = [vienna, london] as DestinationContent[];
export const pilotIdentities = [
  ...placeRegistryData.records.filter(
    (identity) => identity.subject !== "vienna",
  ),
  viennaIdentity,
] as PlaceIdentity[];
export const pilotContentData: DestinationContentData = {
  schemaVersion: 1,
  records: [
    ...destinationContentData.records.filter(
      (record) =>
        !pilotDrafts.some(
          (draft) => draft.destinationId === record.destinationId,
        ),
    ),
    ...pilotDrafts,
  ],
};
