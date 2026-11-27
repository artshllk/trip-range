import { isExcludedTravelDestination } from "../domain/destination-lifecycle";
import { referenceCalendarDate } from "../domain/dates";
import { reportDiagnostic } from "../server/observability";
import "server-only";
import { allowOperation } from "../server/rate-limit";
import type { TripRequest } from "../domain/types";
import { createTravelProviders } from "../providers/server/composition";
import { createEditorialImages } from "../providers/server/editorial-images";
import { getTripTemplates } from "./travel";
import { pricePlan } from "../domain/pricing";
import type { TripTemplate } from "../domain/types";

function prepareCostContextAndDiagnostics(
  templates: TripTemplate[],
  request: TripRequest,
) {
  const today = referenceCalendarDate(new Date());
  for (const template of templates) {
    template.costReferenceDate = today;
    const plan = pricePlan(template, request);
    reportDiagnostic({
      level: "debug",
      component: "money",
      operation: "accommodation-evidence",
      status: plan.accommodation?.kind ?? "unavailable",
    });
    reportDiagnostic({
      level: "debug",
      component: "money",
      operation: "accommodation-provider",
      status: plan.accommodation?.providerStatus ?? "disabled",
    });
    if (template.transport.mode !== "flight") continue;
    reportDiagnostic({
      level: "debug",
      component: "money",
      operation: "cost-profile",
      status:
        plan.costIntegrity?.status === "generic"
          ? "generic-fallback"
          : "reviewed-profile",
      currency: request.budget.currency,
      destinationCode:
        template.destination.cityCode ?? template.destination.iataCodes?.[0],
    });
    if (plan.pricingCompleteness === "complete") continue;
    reportDiagnostic({
      level: "debug",
      component: "money",
      operation: "flight-affordability",
      status: plan.flightAffordability.status,
      currency: request.budget.currency,
    });
  }
}
export async function getAppTripTemplates(
  request: TripRequest,
  preferredId?: string,
) {
  if (!(await allowOperation("search"))) {
    const fallback = await createTravelProviders(
      {},
      async () => new Response(null, { status: 503 }),
      false,
      request,
    );
    const result = await getTripTemplates(request, fallback, preferredId);
    if (request.scope !== "domestic" && !request.noFlight)
      result.issues.push({
        destinationId: "flight-discovery",
        category: "transport",
        source: { status: "unavailable", reason: "rate-limit" },
      });
    prepareCostContextAndDiagnostics(result.templates, request);
    return result;
  }
  const result = await getTripTemplates(
    request,
    await createTravelProviders(undefined, undefined, true, request),
    preferredId,
  );
  reportDiagnostic({
    level: "debug",
    component: "search",
    operation: "destination-resolution",
    status: result.templates.length ? "ready" : "no-results",
    currency: request.budget.currency,
    count: result.templates.length,
  });
  reportDiagnostic({
    level: "debug",
    component: "search",
    operation: "nearby-comparison",
    status:
      request.preferences.nearbyAirports && request.budget.currency !== "EUR"
        ? "excluded"
        : "ready",
    currency: request.budget.currency,
    count: new Set(
      result.templates.map((t) => t.transport.departure?.code).filter(Boolean),
    ).size,
  });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.count)
      reportDiagnostic({
        level: "debug",
        component: "search",
        operation: "discovery-evidence",
        status: "ready",
        evidence: diagnostic.code,
        count: diagnostic.count,
      });
  }
  for (const template of result.templates) {
    const route = template.transport;
    if (route.mode !== "flight") continue;
    reportDiagnostic({
      level: "debug",
      component: "search",
      operation: "flight-pricing",
      status:
        route.flightPricing.kind === "priced" ? "available" : "unconfirmed",
      state:
        route.flightPricing.kind === "priced"
          ? "matching-fare"
          : route.flightPricing.kind === "reference"
            ? "reference-only"
            : "unavailable",
      originCode: route.departure?.code ?? template.origin.iataCodes?.[0],
      destinationCode: template.destination.iataCodes?.[0],
      currency: request.budget.currency,
      dateMode:
        request.dates.mode === "weekends"
          ? "weekends"
          : request.dates.flexibleDays === 3
            ? "flexible"
            : "exact",
      provider: "travelpayouts",
    });
  }
  prepareCostContextAndDiagnostics(result.templates, request);
  return result;
}

/** Editorial examples retain demo prices and read only stored destination image records. */
export async function getDemoImageTemplates(
  request: TripRequest,
  destinationIds?: readonly string[],
) {
  const { demoProviders } = await import("../providers/demo");
  const catalogue = (await demoProviders.destinations.list()).filter(
    (destination) =>
      !isExcludedTravelDestination(destination) &&
      (!destinationIds || destinationIds.includes(destination.id)),
  );
  // These are explicitly selected editorial examples, not a flight-outage fallback.
  const selections = await Promise.all(
    catalogue.map((destination) =>
      getTripTemplates(
        request,
        {
          ...demoProviders,
          destinations: { list: async () => catalogue },
          images: createEditorialImages(catalogue),
        },
        destination.id,
      ),
    ),
  );
  return {
    templates: selections.flatMap((s) => s.templates),
    issues: selections.flatMap((s) => s.issues),
    diagnostics: selections.flatMap((s) => s.diagnostics ?? []),
  };
}
