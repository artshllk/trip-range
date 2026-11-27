import {
  allowOperation,
  rateLimitHeaders,
} from "../../../../server/rate-limit";
import { boundedJson } from "../../../../server/request-body";
import { validFlightAffiliateRequest } from "../../../../services/affiliate-handoff";
import { readAffiliateEvent } from "../../../../domain/affiliate";
import { recordAffiliateEvent } from "../../../../server/affiliate-events";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** CTA views (sendBeacon). Clicks are recorded by /api/affiliate/flights. */
export async function POST(request: Request) {
  if (!validFlightAffiliateRequest(request))
    return new Response(null, { status: 400, headers });
  if (!(await allowOperation("affiliate-view")))
    return new Response(null, { status: 429, headers: rateLimitHeaders });
  try {
    const event = readAffiliateEvent(await boundedJson(request, 512));
    if (!event) return new Response(null, { status: 400, headers });
    await recordAffiliateEvent(event);
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 400, headers });
  }
}
