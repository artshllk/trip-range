import { object } from "../../src/domain/places/validation";
import type { PlaceIdentity } from "../../src/domain/places/types";
import {
  validateMediaData,
  validateMediaRegistry,
} from "../../src/domain/media/validation";
/** Offline historical reader only. Legacy identities are a revision snapshot, never runtime authority. */
export function validateHistoricalMedia(
  value: unknown,
  places?: readonly PlaceIdentity[],
) {
  return object(value) && value.schemaVersion === 1
    ? validateMediaData(value)
    : validateMediaRegistry(value, places ?? []);
}
