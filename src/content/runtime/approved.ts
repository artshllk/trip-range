import "server-only";
import { placeIdentities } from "../../places/runtime/registry";
import { destinationContentData } from "../../../content/destinations/records";
import type {
  DestinationContentStore,
  DestinationContentValidationContext,
} from "../../domain/destination-content/types";
import { createPinnedDestinationContentStore } from "./publication";

/** The neutral canonical place registry is shared; no parallel destination resolver or identity list. */
export const destinationContentValidationContext: DestinationContentValidationContext =
  {
    identities: placeIdentities,
    mediaSubjects: placeIdentities.map((place) => place.subject),
  };
/** Source-controlled authority. No Redis, external calls, file writes, or AI. */
export const approvedDestinationContent: DestinationContentStore =
  createPinnedDestinationContentStore(
    destinationContentData,
    destinationContentValidationContext,
  );
