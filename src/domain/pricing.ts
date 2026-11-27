import {
  resolveDestinationCosts,
  deriveCostIntegrity,
  type CostContext,
} from "./costs/policy";
import type { PlanningCostProvenance } from "./costs/types";
import { assertCurrency } from "./money/currency";
import { planningCostPolicy } from "./money/planning-rates";
import { estimateAccommodation } from "./accommodation";
import { resolveFlightPricing } from "./flight-pricing";
import { resolvePanelTax } from "./panel-lodging-tax";
import {
  resolveStayFigure,
  stayFigureEvidence,
  summarizeStayFigure,
} from "./costs/stay-figures";
import { reviewedStayData } from "./costs/reviewed-stay-data";
import { destinationCostId } from "./costs/identity";

/** What a reviewed room-panel stay is, for the assumptions list. Placeholder copy for Codex. */
const RANGE_STEP = 500;
const ROOM_PANEL_BASKET = {
  en: "Standard double room for two adults: median displayed two-night price from a reviewed hotel panel, weekday and weekend weighted equally. Not bookable inventory.",
  sq: "Dhomë dyshe standarde për dy të rritur: mediana e çmimit të shfaqur për dy net nga një panel hotelesh i rishikuar, ditë jave dhe fundjavë me peshë të barabartë. Jo inventar për rezervim.",
};
import { nightsBetween, referenceCalendarDate } from "./dates";
import {
  calculateBudget,
  maxAffordableFlight,
  safetyBufferFor,
  money,
} from "./budget";
import type {
  TripPlan,
  TripTemplate,
  TripRequest,
  DemoScenario,
  CostItem,
  MoneyAmount,
} from "./types";
/** Non-flight allowances never authorize a complete total when flight evidence is missing. */
export function pricePlan(
  base: TripTemplate,
  request: TripRequest,
  scenario: DemoScenario = "none",
  savedEstimatedSpend?: MoneyAmount,
  costContext?: CostContext,
): TripPlan {
  const currency = request.budget.currency;
  const rates = planningCostPolicy[currency];
  assertCurrency(base.stay.amount, currency);
  if (base.origin.id !== request.originId)
    throw new Error("Quote origin does not match request");
  const route = base.transport;
  if (route.mode === "road") assertCurrency(route.price.amount, currency);
  if (route.departure?.transfer)
    assertCurrency(route.departure.transfer.amount, currency);
  const requestedDates = request.dates;
  // Recheck evidence when UI edits dates/party. Cached template state cannot bypass eligibility.
  const flightPricing =
    route.mode === "flight"
      ? route.flightPricing.kind === "unavailable"
        ? route.flightPricing
        : resolveFlightPricing(
            route.flightPricing.kind === "priced"
              ? route.flightPricing.fare
              : route.flightPricing.referenceFare,
            request,
          )
      : undefined;
  const fare =
    flightPricing?.kind === "priced" ? flightPricing.fare : undefined;
  if (
    fare &&
    (fare.scope.dates.startDate !== request.dates.startDate ||
      fare.scope.dates.endDate !== request.dates.endDate ||
      request.dates.mode === "weekends")
  ) {
    request = {
      ...request,
      dates: { ...fare.scope.dates, flexibleDays: 0 },
      nights: nightsBetween(
        fare.scope.dates.startDate,
        fare.scope.dates.endDate,
      ),
      flexible: false,
      when: "custom",
    };
  } else if (request.dates.mode === "weekends") {
    request = {
      ...request,
      dates: {
        startDate: request.dates.startDate,
        endDate: request.dates.endDate,
        flexibleDays: 0,
      },
      flexible: false,
      when: "custom",
    };
  }
  const flying = route.mode === "flight";
  const arrival = flying ? route.arrival : undefined;
  if (arrival && arrival.destinationSubject !== base.destination.id)
    throw Error("Arrival access does not match final destination");
  const transfer = arrival?.onwardTransfer;
  const transferEstimate =
    transfer?.status === "estimate" &&
    transfer.perPersonReturn.currency === currency &&
    Number.isSafeInteger(transfer.perPersonReturn.cents) &&
    transfer.perPersonReturn.cents > 0 &&
    transfer.perPersonReturn.cents <= 1000000 &&
    Date.parse(transfer.reviewAfter) >
      (costContext?.today
        ? Date.parse(costContext.today + "T00:00:00Z")
        : Date.now())
      ? transfer
      : undefined;
  if (flying) scenario = "none";
  const people = request.party.adults + request.party.children;
  const days = request.nights + 1;
  const destinationCosts = resolveDestinationCosts(
    base.destination,
    request,
    base.stay,
    costContext ??
      (base.costReferenceDate ? { today: base.costReferenceDate } : undefined),
  );
  // A reviewed room panel (observed here, or scaled from this country's anchor)
  // replaces the planning basis outright. Without one, nothing changes.
  const stayFigure = resolveStayFigure(
    base.destination,
    currency,
    costContext?.today ?? base.costReferenceDate,
    costContext?.stayData ?? reviewedStayData,
  );
  const stayBasis = stayFigure
    ? {
        amount: money(stayFigure.roomNight.cents * 2, currency),
        confidence: "estimate" as const,
        providerId: "goeksplo-stay-estimate",
        observedAt: null,
        demo: false,
        source: { status: "available" as const },
        roomPanel: stayFigureEvidence(stayFigure, base.destination),
      }
    : base.stay;
  let accommodation = estimateAccommodation(
    { ...stayBasis, planning: [destinationCosts.stayProvenance] },
    request,
    destinationCosts.stayRoomNight && !stayFigure
      ? {
          roomNight: destinationCosts.stayRoomNight,
          provenance: destinationCosts.stayProvenance,
        }
      : undefined,
    {
      destination: base.destination,
      evidence: base.accommodationEvidence,
      now: costContext?.now ?? Date.now(),
    },
  );
  if (accommodation.quote && scenario === "price-change" && currency === "EUR")
    accommodation.quote.amount = money(
      accommodation.quote.amount.cents + 8000,
      currency,
    );
  const panel =
    accommodation.kind === "generic-estimate" && accommodation.quote.roomPanel;
  const lodgingTax =
    panel && accommodation.quote
      ? resolvePanelTax(
          panel,
          base.destination,
          request,
          accommodation.quote.amount,
          costContext?.today ??
            referenceCalendarDate(new Date(costContext?.now ?? Date.now())),
        )
      : undefined;
  const panelCostId = panel ? destinationCostId(base.destination) : undefined;
  const panelProfile =
    panel && panelCostId
      ? {
          id: panel.sourceId,
          revision: panel.checkedDate,
          destinationId: panelCostId,
          currency,
          reviewedAt: panel.checkedDate,
          reviewAfter: panel.reviewAfter,
        }
      : undefined;
  if (panel && accommodation.kind === "generic-estimate") {
    if (!lodgingTax) {
      accommodation = {
        kind: "unavailable",
        rooms: accommodation.rooms,
        paidNights: accommodation.paidNights,
        charges: accommodation.charges,
        providerStatus: accommodation.providerStatus,
        rejection: accommodation.rejection,
      };
    } else {
      accommodation = {
        ...accommodation,
        kind: "reviewed-estimate",
        charges:
          accommodation.charges.status === "unresolved"
            ? accommodation.charges
            : { status: "panel", basis: "displayed-rate" },
        quote: {
          ...accommodation.quote,
          planning: [
            {
              component: "stay",
              basis: "reviewed-destination",
              sourceIds: [panel.sourceId],
              ...(panelProfile ? { profile: panelProfile } : {}),
              basket: ROOM_PANEL_BASKET,
            },
          ],
        },
      };
    }
  }
  if (flying && route.departure)
    request = { ...request, departureAirport: route.departure.code };
  // Persist reviewed arrival context across processes, never fare/price evidence.
  request = {
    ...request,
    arrivalEntry:
      flying && (route.directArrival || route.arrival)
        ? {
            destinationId: base.destination.id,
            code: (route.arrival ?? route.directArrival)!.flightDestinationCode,
          }
        : undefined,
  };
  const estimate = (
    category: CostItem["category"],
    cents: number,
    planning: readonly PlanningCostProvenance[],
  ): CostItem => ({
    category,
    planning,
    amount: money(cents, currency),
    confidence: "estimate",
    source: { status: "available" },
    providerId:
      category === "airportTransfer"
        ? "goeksplo-transfer-estimate"
        : category === "baggage"
          ? "goeksplo-baggage-estimate"
          : "goeksplo-cost-estimate",
    observedAt: null,
    demo: route.mode === "road" && route.price.demo,
  });
  const transport: CostItem | undefined = fare
    ? {
        ...fare.price,
        fetchedAt: fare.retrievedAt,
        category: "transport",
        confidence: "recent",
        amount: money(
          fare.price.amount.cents *
            (fare.scope.unit === "per-traveller" ? people : 1),
          currency,
        ),
      }
    : route.mode === "road"
      ? {
          ...route.price,
          category: "transport",
          amount: money(
            route.price.amount.cents * Math.ceil(people / 5),
            currency,
          ),
          source:
            scenario === "unavailable"
              ? { status: "fallback", reason: "demo-provider-unavailable" }
              : route.price.source,
        }
      : undefined;
  const costs: CostItem[] = [
    ...(transport ? [transport] : []),
    ...(accommodation.quote
      ? [{ ...accommodation.quote, category: "stay" as const }]
      : []),
    ...(flying && route.departure?.transfer
      ? [
          estimate("airportTransfer", route.departure.transfer.amount.cents, [
            {
              component: "departureTransfer",
              basis: "planning-allowance",
              sourceIds: [],
            },
          ]),
        ]
      : []),
    ...(flying && request.preferences.luggage
      ? [
          estimate("baggage", rates.baggage * people, [
            { component: "baggage", basis: "generic-currency", sourceIds: [] },
          ]),
        ]
      : []),
    ...(transferEstimate
      ? [
          estimate(
            "gatewayTransfer",
            transferEstimate.perPersonReturn.cents * people,
            [
              {
                component: "gatewayTransfer",
                basis: "planning-allowance",
                sourceIds: transferEstimate.sourceIds,
                transfer: transferEstimate.provenance,
                basket: transferEstimate.provenance?.basis,
              },
            ],
          ),
        ]
      : []),
    estimate(
      "local",
      (request.preferences.car
        ? rates.carDay * days
        : destinationCosts.localTotal) +
        (flying && !arrival ? destinationCosts.arrivalTotal : 0),
      [
        request.preferences.car
          ? {
              component: "localTransport",
              basis: "planning-allowance",
              sourceIds: [],
            }
          : destinationCosts.localProvenance,
        ...(flying && !arrival ? [destinationCosts.arrivalProvenance] : []),
      ],
    ),
    estimate("food", destinationCosts.foodPersonDay * people * days, [
      destinationCosts.foodProvenance,
    ]),
    estimate(
      "activities",
      destinationCosts.activityPersonNight * people * request.nights,
      [destinationCosts.activityProvenance],
    ),
  ];
  if (lodgingTax?.treatment === "extra" && lodgingTax.amount) {
    costs.push({
      category: "lodgingTax",
      amount: lodgingTax.amount,
      confidence: "estimate",
      providerId: "goeksplo-lodging-tax",
      observedAt: null,
      demo: false,
      source: { status: "available" },
    });
  }
  const possible = lodgingTax?.upperAllowance?.cents ?? 0;
  const taxUnbounded = Boolean(
    panel &&
    (!lodgingTax ||
      ((lodgingTax.treatment === "possible" ||
        lodgingTax.treatment === "extra") &&
        !lodgingTax.amount)),
  );
  // The agreed planning band around the room figure. "Leaves for flights" uses its
  // high end so the room for flights is never overstated.
  // Rounded outward to whole €5 (500 minor units): cents on a ±25% estimate would be
  // false precision, and rounding outward never narrows the band.
  const stayRange =
    lodgingTax && accommodation.quote
      ? {
          low: money(
            Math.floor(
              (accommodation.quote.amount.cents *
                (100 - lodgingTax.bandPercent)) /
                100 /
                RANGE_STEP,
            ) * RANGE_STEP,
            currency,
          ),
          high: money(
            Math.ceil(
              (accommodation.quote.amount.cents *
                (100 + lodgingTax.bandPercent)) /
                100 /
                RANGE_STEP,
            ) * RANGE_STEP,
            currency,
          ),
        }
      : undefined;
  const stayHighExtra =
    stayRange && accommodation.quote
      ? stayRange.high.cents - accommodation.quote.amount.cents
      : 0;
  const figureUsed =
    stayFigure && lodgingTax?.panelSourceId === stayFigure.anchor.id
      ? summarizeStayFigure(stayFigure)
      : undefined;
  const common = {
    lodgingTax,
    stayRange,
    stayFigure: figureUsed,
    id: base.id,
    destination: base.destination,
    origin: base.origin,
    itinerary: base.itinerary,
    transportMode: route.mode,
    departure: flying ? route.departure : undefined,
    directArrival: flying ? route.directArrival : undefined,
    arrival: arrival
      ? {
          ...arrival,
          onwardTransfer: transferEstimate ?? {
            status: "unpriced" as const,
            required: true as const,
          },
        }
      : undefined,
    accommodation,
    flightPricing,
    requestedDates:
      request.dates !== requestedDates ? requestedDates : undefined,
    request,
    costs,
    costIntegrity: deriveCostIntegrity(costs.flatMap((c) => c.planning ?? [])),
  };
  const spend = costs.reduce((sum, c) => sum + c.amount.cents, 0);
  if (accommodation.kind === "unavailable")
    return {
      ...common,
      pricingCompleteness: "stay-unpriced",
      knownCosts: money(spend, currency),
      knownNonFlightCosts: money(
        costs
          .filter((c) => c.category !== "transport")
          .reduce((sum, c) => sum + c.amount.cents, 0),
        currency,
      ),
      flightAffordability: { status: "stay-unpriced" },
    };
  if (arrival && !transferEstimate)
    return {
      ...common,
      pricingCompleteness: "required-transfer-unpriced",
      knownCosts: money(spend, currency),
      knownNonFlightCosts: money(
        costs
          .filter((c) => c.category !== "transport")
          .reduce((sum, c) => sum + c.amount.cents, 0),
        currency,
      ),
      flightAffordability: { status: "required-transfer-unpriced" },
    };
  const chargesIncomplete = {
    ...common,
    knownCosts: money(spend, currency),
    knownNonFlightCosts: money(
      costs
        .filter((c) => c.category !== "transport")
        .reduce((sum, c) => sum + c.amount.cents, 0),
      currency,
    ),
    flightAffordability: { status: "accommodation-charges-unpriced" as const },
  };
  if (
    accommodation.charges.status === "unresolved" ||
    (taxUnbounded && flying && !fare) ||
    (accommodation.charges.status === "property-dependent" && flying && !fare)
  )
    return {
      ...chargesIncomplete,
      pricingCompleteness: "accommodation-charges-unpriced",
    };
  if (flying && !fare) {
    const knownNonFlightCosts = money(spend, currency);
    const ceiling = maxAffordableFlight(
      money(Math.max(0, request.budget.cents - (possible ?? 0)), currency),
      money(spend + stayHighExtra, currency),
    );
    return {
      ...common,
      pricingCompleteness: "flight-unpriced",
      knownNonFlightCosts,
      flightAffordability: ceiling
        ? { status: "calculated", ceiling }
        : { status: "no-room-in-budget" },
    };
  }
  const safetyBuffer = safetyBufferFor(money(spend, currency));
  // The fit test uses the upper bound: the stay band's high end and the possible
  // tax, with the reserve recomputed on the higher spend, exactly as the flight
  // ceiling does. Never say a trip fits when its upper bound does not.
  const centralNeeded = spend + safetyBuffer.cents;
  const highSpend = spend + stayHighExtra;
  const upperNeeded =
    highSpend + safetyBufferFor(money(highSpend, currency)).cents + possible;
  const fitUnconfirmedBy = [
    ...(stayHighExtra > 0 ? (["stay-range"] as const) : []),
    ...(possible > 0 || taxUnbounded ? (["lodging-tax"] as const) : []),
  ];
  if (taxUnbounded)
    return {
      ...chargesIncomplete,
      pricingCompleteness: "fit-unconfirmed",
      conditionalTotal: money(centralNeeded, currency),
      fitUnconfirmedBy,
    };
  if (accommodation.charges.status === "property-dependent")
    return {
      ...chargesIncomplete,
      pricingCompleteness: "property-charges-conditional",
      conditionalTotal: money(centralNeeded, currency),
    };
  if (
    centralNeeded <= request.budget.cents &&
    upperNeeded > request.budget.cents
  )
    return {
      ...chargesIncomplete,
      pricingCompleteness: "fit-unconfirmed",
      conditionalTotal: money(centralNeeded, currency),
      fitUnconfirmedBy,
      upperBoundNeeded: money(upperNeeded, currency),
    };
  return {
    ...common,
    pricingCompleteness: "complete",
    safetyBuffer,
    budget: calculateBudget(
      request.budget,
      costs,
      safetyBuffer,
      savedEstimatedSpend,
      // Over budget even at the central estimate: report the smallest overage.
      centralNeeded <= request.budget.cents && upperNeeded > centralNeeded
        ? money(upperNeeded - centralNeeded, currency)
        : undefined,
    ),
  };
}
