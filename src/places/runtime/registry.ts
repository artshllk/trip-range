import "server-only";
import { placeRegistryData } from "../../../content/places/records";
import { createPlaceRegistry } from "./store";
/** Sole canonical source; no research, filesystem discovery or network dependency. */
export const placeRegistry = createPlaceRegistry(placeRegistryData);
export const placeIdentities = placeRegistry.list();
