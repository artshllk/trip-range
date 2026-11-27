import "server-only";
import { unstable_cache } from "next/cache";
import { createHash } from "node:crypto";
import type { Destination } from "../../domain/types";
import type { ImageProvider } from "../contracts";
/** Persistent stored-image cache. The complete catalogue record participates in the key,
 * so approval/metadata changes invalidate it. v3 excludes old runtime-discovered selections.
 * This app has not opted into Cache Components; use the supported compatibility API.
 */
export function cacheDestinationImages(
  provider: ImageProvider,
  catalogue: Destination[],
  pexelsKey?: string,
): ImageProvider {
  return {
    async forDestination(id) {
      const identity = createHash("sha256")
        .update(
          JSON.stringify([catalogue.find((d) => d.id === id), pexelsKey ?? ""]),
        )
        .digest("hex");
      return unstable_cache(
        async () => provider.forDestination(id),
        ["destination-images-stored-only-v3", id, identity],
        { revalidate: 86400 },
      )();
    },
  };
}
