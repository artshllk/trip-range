import type {
  AffiliatePlacement,
  FareAgeBucket,
  FlightHandoff,
} from "@/domain/affiliate";

/** Only the server-validated partner URL may be used for a booking handoff. */
export async function openFlightSearch(
  route: FlightHandoff,
  placement: AffiliatePlacement,
  fareAge: FareAgeBucket,
) {
  const response = await fetch("/api/affiliate/flights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route, placement, fareAge }),
    signal: AbortSignal.timeout(7000),
  });
  const result = await response.json();
  if (result.status === "unsupported") return "unsupported";
  if (
    !response.ok ||
    result.status !== "available" ||
    typeof result.link?.url !== "string"
  )
    throw new Error("Flight link unavailable");
  window.location.assign(result.link.url);
  return "available";
}
