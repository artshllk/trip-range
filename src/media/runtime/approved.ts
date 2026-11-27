import "server-only";
import { placeIdentities } from "../../places/runtime/registry";
import { validateMediaRegistry } from "../../domain/media/validation";
import approved from "../../../content/media/approved.json";
import { createReviewedMediaStore } from "./store";
import type { PlaceMediaStore } from "../../domain/media/types";
/** Source-controlled media authority with neutral identities; no discovery or writes. */
const checked = validateMediaRegistry(approved, placeIdentities);
export const approvedPlaceMedia: PlaceMediaStore = createReviewedMediaStore(
  checked.ok ? checked.data : null,
);
