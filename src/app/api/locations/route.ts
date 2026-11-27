import { customPlannerEnabled } from "@/config/features";
import { allowOperation, rateLimitHeaders } from "@/server/rate-limit";
import { createLocationSearch } from "@/providers/server/location-search";
export async function GET(request: Request) {
  // Only the custom planner calls this; while it is switched off
  // (src/config/features.ts) no direct call may spend provider or AI quota.
  if (!customPlannerEnabled)
    return Response.json({ error: "not available" }, { status: 404 });
  const url = new URL(request.url);
  if (
    url.search.length > 400 ||
    [...url.searchParams.keys()].some((k) => k !== "q") ||
    url.searchParams.getAll("q").length > 1
  )
    return Response.json(
      { locations: [], status: "unavailable" },
      {
        status: 400,
        headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
      },
    );
  if (!(await allowOperation("locations")))
    return Response.json(
      { locations: [], status: "unavailable" },
      { status: 429, headers: rateLimitHeaders },
    );
  const term = url.searchParams.get("q") ?? "";
  if (term.trim().length < 2 || term.length > 80)
    return Response.json(
      { locations: [], status: "available" },
      { headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" } },
    );
  try {
    return Response.json(await createLocationSearch().search(term), {
      headers: {
        "X-Robots-Tag": "noindex",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return Response.json(
      { locations: [], status: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
      },
    );
  }
}
