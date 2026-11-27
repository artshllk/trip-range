import { matchesRequestOrigin } from "../server/request-origin";
import { boundedJson } from "../server/request-body";
import "server-only";
import { reportDiagnostic } from "../server/observability";
import {
  type AffiliateResult,
  readFlightHandoff,
  readHandoffContext,
  isFareAge,
} from "../domain/affiliate";
import { recordAffiliateEvent } from "../server/affiliate-events";
import type { FlightAffiliateProvider } from "../providers/contracts";
/** Cheap request checks must precede shared quota consumption and provider work. */
export function validFlightAffiliateRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  return (
    request.method === "POST" &&
    (!origin || matchesRequestOrigin(request, origin)) &&
    [null, "same-origin"].includes(request.headers.get("sec-fetch-site")) &&
    request.headers.get("content-type")?.split(";")[0] === "application/json"
  );
}
export async function handleFlightAffiliate(
  request: Request,
  provider: FlightAffiliateProvider,
) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const fail = (status = 503) =>
    Response.json({ status: "unavailable" }, { status, headers });
  if (!validFlightAffiliateRequest(request)) return fail(400);
  try {
    const body = (await boundedJson(request, 2048)) as
      | {
          route?: unknown;
          placement?: unknown;
          context?: unknown;
          fareAge?: unknown;
        }
      | undefined;
    const route = readFlightHandoff(body?.route);
    const context =
      body?.context === undefined
        ? undefined
        : readHandoffContext(body.context);
    if (
      !body ||
      Object.keys(body).some(
        (k) => !["route", "placement", "context", "fareAge"].includes(k),
      ) ||
      !route ||
      (body.context !== undefined && !context) ||
      (body.fareAge !== undefined && !isFareAge(body.fareAge)) ||
      (body.fareAge !== undefined &&
        context !== undefined &&
        body.fareAge !== context.fareAge) ||
      !["results", "trip"].includes(String(body.placement))
    )
      return fail(400);
    const result = await provider
      .createLink(route, body.placement as "results" | "trip")
      .catch(
        (): AffiliateResult => ({ status: "unavailable", reason: "provider" }),
      );
    // Operational failures need a reason, never an itinerary or a per-click success log.
    if (result.status === "unavailable") {
      const reason = result.reason;
      reportDiagnostic({
        level: ["configuration", "malformed", "authentication"].includes(reason)
          ? "error"
          : "warn",
        component: "affiliate",
        operation: "affiliate-handoff",
        status: "unavailable",
        affiliateReason: reason,
      });
    }
    await recordAffiliateEvent({
      originCode: route.originCode,
      destinationCode: route.destinationCode,
      outcome:
        result.status === "available" ? "click_available" : "click_unavailable",
      fareAge: body.fareAge ?? context?.fareAge ?? "unknown",
    });
    if (result.status === "unavailable" && result.reason === "unsupported")
      return Response.json({ status: "unsupported" }, { status: 422, headers });
    return result.status === "available"
      ? Response.json(result, { headers })
      : fail();
  } catch {
    return fail();
  }
}
