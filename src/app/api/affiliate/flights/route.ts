import {
  allowOperation,
  rateLimitHeaders,
} from "../../../../server/rate-limit";
import { affiliateProviders } from "../../../../providers/server/affiliates";
import {
  handleFlightAffiliate,
  validFlightAffiliateRequest,
} from "../../../../services/affiliate-handoff";
export async function POST(request: Request) {
  if (!validFlightAffiliateRequest(request))
    return Response.json(
      { status: "unavailable" },
      {
        status: 400,
        headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
      },
    );
  if (!(await allowOperation("affiliate")))
    return Response.json(
      { status: "unavailable" },
      { status: 429, headers: rateLimitHeaders },
    );
  return handleFlightAffiliate(request, affiliateProviders().flight);
}
