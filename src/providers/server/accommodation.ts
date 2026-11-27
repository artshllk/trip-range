import "server-only";
import type { AccommodationEvidenceProvider } from "../contracts";
import type { Destination, TripRequest } from "../../domain/types";
import type { AccommodationEvidence } from "../../domain/accommodation-evidence";
/** Reserved detail-refinement boundary; no production caller/adapter until partner access.
 * One search, no retry, no cache, no query for children without ages. */
export async function requestAccommodationEvidence(
  provider: AccommodationEvidenceProvider | undefined,
  request: TripRequest,
  destination: Destination,
  context:
    | { bookerCountry: string; platform: "desktop" | "mobile" }
    | undefined,
  timeoutMs = 1500,
): Promise<AccommodationEvidence> {
  if (!provider) return { status: "unavailable", reason: "disabled" };
  if (
    !context ||
    !/^[A-Z]{2}$/.test(context.bookerCountry) ||
    !["desktop", "mobile"].includes(context.platform) ||
    request.party.children > 0
  )
    return { status: "unavailable", reason: "scope-mismatch" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.search(request, destination, {
        ...context,
        signal: controller.signal,
      }),
      new Promise<AccommodationEvidence>((resolve) => {
        timer = setTimeout(
          () => {
            controller.abort();
            resolve({ status: "unavailable", reason: "timeout" });
          },
          Math.max(1, Math.min(1500, timeoutMs)),
        );
      }),
    ]);
  } catch {
    return { status: "unavailable", reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
