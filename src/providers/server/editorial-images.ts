import "server-only";
import type { Destination } from "../../domain/types";
import type { PlaceMediaStore } from "../../domain/media/types";
import type { ImageProvider } from "../contracts";
import { createDestinationImages } from "./images";

/** Stored imagery only: no external discovery, cache revalidation or quota calls on editorial views. */
export function createEditorialImages(
  catalogue: Destination[],
  store?: PlaceMediaStore,
): ImageProvider {
  return createDestinationImages(catalogue, store);
}
