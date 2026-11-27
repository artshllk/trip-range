import "server-only";
import type { Destination } from "../../domain/types";
import type { ImageProvider } from "../contracts";
import type { PlaceMediaStore } from "../../domain/media/types";
import { approvedPlaceMedia } from "../../media/runtime/approved";
import { displayImageAsset } from "../../media/runtime/display";

/** Runtime sees approved DisplayImage | none only; no legacy catalogue fallback or discovery. */
export function createDestinationImages(
  catalogue: Destination[],
  store: PlaceMediaStore = approvedPlaceMedia,
  access?: import("../../domain/destination-access/types").DestinationAccessStore,
): ImageProvider {
  return {
    async forDestination(id, role = "destination.card") {
      if (!catalogue.some((d) => d.id === id) && !access?.get(id))
        throw new RangeError("Unknown image destination");
      const result = await store.get(id, role);
      return result.status === "approved"
        ? displayImageAsset(result.image)
        : undefined;
    },
  };
}
