import { genericStayBasis } from "../domain/accommodation";
import { flightQueryPlan } from "../domain/flight-query";
import { searchFlightPlan } from "./flight-search";
import {
  fareMatchesDetailArrival,
  reviewedDetailArrival,
} from "./trip-detail-selection";
import { resolveFlightPricing } from "../domain/flight-pricing";
import {
  arrivalAccess,
  directBindings,
  directArrival,
  matchesDirectFare,
  isMixedAccess,
} from "../domain/destination-access/arrival";
import type {
  ArrivalAccess,
  AccessibleDestination,
} from "../domain/destination-access/types";
import { registerDestination } from "../domain/dynamic-destinations";
import {
  boundedDepartures,
  selectedDeparture,
  type DepartureAirportCandidate,
} from "../domain/airports";
import { matchesDestination, roadOriginId } from "../domain/locations";
import { nightsBetween, referenceCalendarDate } from "../domain/dates";
import {
  shortlistFlights,
  sortDiscoveryFares,
  MAX_FLIGHT_DESTINATIONS,
} from "../domain/discovery";
import { pricePlan } from "../domain/pricing";
import {
  chooseDeparturePlans,
  comparePlans,
} from "../domain/airport-comparison";
import { selfAirportFare } from "../domain/fare-evidence";
import { demoProviders } from "../providers/demo";
import type { ProviderResult, TravelProviders } from "../providers/contracts";
import type {
  TripTemplate,
  TransportQuote,
  TripRequest,
  PriceQuote,
  SourceStatus,
  FlightDiscoveryFare,
  DiscoveryDiagnostic,
  Destination,
} from "../domain/types";

export type SearchIssue = {
  destinationId: string;
  category: "transport" | "stay";
  source: SourceStatus;
};
export type TripSearch = {
  templates: TripTemplate[];
  issues: SearchIssue[];
  diagnostics?: DiscoveryDiagnostic[];
};

/** Preserve source health independently from confidence in the displayed price. */
export function normalizeQuote(
  result: ProviderResult<PriceQuote>,
): PriceQuote | undefined {
  if (result.status === "unavailable") {
    return result.fallback
      ? {
          ...result.fallback,
          confidence: "estimate",
          source: { status: "fallback", reason: result.reason },
        }
      : undefined;
  }
  return {
    ...result.value,
    source:
      result.status === "stale"
        ? { status: "stale", reason: result.reason }
        : { status: "available" },
  };
}
async function safely<T>(
  call: () => Promise<ProviderResult<T>>,
): Promise<ProviderResult<T>> {
  try {
    return await call();
  } catch {
    return { status: "unavailable", reason: "provider-error" };
  }
}

/** Selected origin remains stable; explicitly allowed departure airports are bounded to three. */
export async function getTripTemplates(
  request: TripRequest,
  providers: TravelProviders = demoProviders,
  preferredId?: string,
): Promise<TripSearch> {
  const origin = await providers.locations.get(request.originId);
  if (!origin || origin.type === "country")
    return { templates: [], issues: [] };
  const roadOrigin = !!roadOriginId(origin);
  const costReferenceDate = referenceCalendarDate(new Date());
  const catalogue: Destination[] = (await providers.destinations.list()).map(
    (d) => ({
      ...d,
      iataCodes: d.iataCodes ? [...d.iataCodes] : undefined,
    }),
  );
  // Exact reviewed direct bindings take precedence over ephemeral provider-city aliases.
  const registerDirect = (access: AccessibleDestination) => {
    const bindings = directBindings(access);
    if (!bindings.length) return;
    const codes = [
      ...bindings.flatMap((b) => [b.providerCityCode, ...b.airportCodes]),
      ...(isMixedAccess(access)
        ? access.gateways.flatMap((g) => [g.providerCityCode, g.airportCode])
        : []),
    ];
    for (let i = catalogue.length - 1; i >= 0; i--)
      if (
        catalogue[i].id === access.destination.id ||
        catalogue[i].iataCodes?.some((c) => codes.includes(c))
      )
        catalogue.splice(i, 1);
    catalogue.push(access.destination);
  };
  for (const destination of [...catalogue]) {
    const access = providers.destinationAccess?.directForCode(
      destination.cityCode ?? destination.iataCodes?.[0] ?? "",
    );
    if (access) registerDirect(access);
  }
  const accessId = preferredId ?? request.destination?.id;
  const exactAccess = accessId
    ? providers.destinationAccess?.get(accessId)
    : undefined;
  const selectedCode = preferredId
    ? preferredId.match(/^city:([A-Z]{3})$/)?.[1]
    : request.destination?.type === "airport"
      ? request.destination.airportIata
      : request.destination?.cityCode;
  const restoredAccess =
    exactAccess ??
    (selectedCode
      ? providers.destinationAccess?.directForCode(selectedCode)
      : undefined);
  // Only detail restoration may consume the URL hint, and only for its pinned destination.
  const selectedArrival = reviewedDetailArrival(
    preferredId,
    request,
    restoredAccess,
  );
  const selectedEntryCode = selectedArrival?.airportCode;
  if (restoredAccess && directBindings(restoredAccess).length) {
    registerDirect(restoredAccess);
    if (preferredId) preferredId = restoredAccess.destination.id;
  } else if (restoredAccess) catalogue.push(restoredAccess.destination);
  const restoreCode = preferredId?.match(/^city:([A-Z]{3})$/)?.[1];
  // A URL snapshot is not proof of a provider-discovered city. Re-resolve on a fresh process.
  if (restoreCode) {
    for (let i = catalogue.length - 1; i >= 0; i--)
      if (
        catalogue[i].id === preferredId &&
        catalogue[i].metadataSource === "location-selection"
      )
        catalogue.splice(i, 1);
  }
  const knownCity = restoreCode
    ? catalogue.find((d) => !d.metadataSource && d.cityCode === restoreCode)
    : undefined;
  // Historic dynamic-code URLs may refer to a now-curated city. Local identity is sufficient.
  if (knownCity && !catalogue.some((d) => d.id === preferredId))
    catalogue.push({ ...knownCity, id: preferredId! });
  const initialCode =
    knownCity || restoredAccess
      ? undefined
      : (restoreCode ??
        (request.destination?.type === "airport"
          ? request.destination.airportIata
          : request.destination?.type === "city" &&
              !catalogue.some((d) => matchesDestination(d, request.destination))
            ? request.destination.cityCode
            : undefined));
  if (
    initialCode &&
    providers.destinationResolver &&
    !request.noFlight &&
    request.scope !== "domestic"
  ) {
    try {
      for (const d of await providers.destinationResolver.resolve([
        initialCode,
      ]))
        registerDestination(catalogue, d);
    } catch {}
  }
  // Unknown IDs cannot trigger a broad search or become trusted by syntax alone.
  if (preferredId && !catalogue.some((d) => d.id === preferredId))
    return {
      templates: [],
      issues: [],
      diagnostics: [{ code: "unknown-destination", count: 1 }],
    };
  const eligible = (d: Destination) =>
    (!preferredId || d.id === preferredId) &&
    matchesDestination(d, request.destination) &&
    (!request.noFlight || (roadOrigin && !d.requiresFlight)) &&
    (request.scope !== "domestic" || d.countryCode === origin.countryCode) &&
    request.styles.every((style) => d.styles.includes(style));
  let destinations = catalogue.filter(eligible);
  // Apply the same hard constraints as ranking before contacting providers.
  // Flight relevance follows the current transport policy, including Zurich.
  let flightDestinations = destinations.filter(
    (d) => d.id !== origin.id && (!roadOrigin || d.requiresFlight),
  );
  const selected = selectedDeparture(origin);
  let departures = selected ? [selected] : [];
  if (
    request.preferences.nearbyAirports &&
    !request.noFlight &&
    request.scope !== "domestic" &&
    providers.nearbyAirports
  ) {
    try {
      departures = boundedDepartures(
        origin,
        providers.nearbyAirports.candidates(request, origin),
        request.budget.currency,
      );
    } catch {
      /* A failed expansion never removes the selected airport. */
    }
  }
  type Candidate = {
    destination: Destination;
    departure?: DepartureAirportCandidate;
    discovered?: FlightDiscoveryFare;
    arrival?: ArrivalAccess;
  };
  const discoveryIssues: SearchIssue[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];
  let candidates: Candidate[] = destinations.map((destination) => ({
    destination,
    departure: selected,
  }));
  const dynamicEligible =
    !!providers.destinationResolver &&
    request.scope !== "domestic" &&
    request.styles.every((s) => s === "city");
  if (
    providers.discovery &&
    (flightDestinations.length || dynamicEligible) &&
    !request.noFlight
  ) {
    const target = preferredId
      ? catalogue.find((d) => d.id === preferredId)
      : request.destination?.type !== "country" && request.destination
        ? catalogue.find((d) => matchesDestination(d, request.destination))
        : undefined;
    const access =
      restoredAccess ??
      (target ? providers.destinationAccess?.get(target.id) : undefined);
    const plan = flightQueryPlan(
      target,
      request.destination,
      access,
      selectedEntryCode,
    );
    if (plan.kind !== "broad")
      diagnostics.push({
        code:
          plan.kind === "gateway"
            ? "gateway-restoration"
            : "targeted-restoration",
        count: plan.targets.length,
      });
    const searches = await searchFlightPlan(
      providers.discovery,
      request,
      departures,
      plan,
    );
    // Merge target queries by departure before shortlisting, avoiding one card per island airport.
    const merged = departures.map((departure) => ({
      departure,
      successful: searches.filter(
        (s) =>
          s.departure.code === departure.code &&
          s.result.status !== "unavailable",
      ),
    }));
    for (const s of searches) {
      if (s.result.status === "unavailable") {
        diagnostics.push({
          code:
            s.result.reason === "malformed-response"
              ? "schema-invalid"
              : ["currency-mismatch", "currency-unconfirmed"].includes(
                    s.result.reason,
                  )
                ? "currency-rejected"
                : "provider-failed",
          count: 1,
        });
        discoveryIssues.push({
          destinationId: "flight-discovery",
          category: "transport",
          source: { status: "unavailable", reason: s.result.reason },
        });
      } else diagnostics.push(...s.result.value.diagnostics);
    }
    if (plan.kind === "broad") {
      const fares = sortDiscoveryFares(
        searches.flatMap((s) =>
          s.result.status === "unavailable"
            ? []
            : s.result.value.fares.filter(
                (f) => f.originCode === s.departure.code,
              ),
        ),
        request,
      );
      for (const fare of fares)
        for (const access of providers.destinationAccess?.forFare(fare) ?? [])
          if (directBindings(access).length) registerDirect(access);
      const unknown = [
        ...new Set(
          fares
            .filter(
              (f) =>
                !providers.destinationAccess?.forFare(f).some(isMixedAccess) &&
                !catalogue.some(
                  (d) =>
                    d.iataCodes?.includes(f.destinationCode) ||
                    d.iataCodes?.includes(f.destinationAirport ?? ""),
                ),
            )
            .map((f) => f.destinationCode),
        ),
      ].slice(0, 10);
      if (dynamicEligible) {
        try {
          for (const d of await providers.destinationResolver!.resolve(unknown))
            registerDestination(catalogue, d);
        } catch {}
      }
      destinations = catalogue.filter(eligible);
      flightDestinations = destinations.filter(
        (d) => d.id !== origin.id && (!roadOrigin || d.requiresFlight),
      );
    }
    candidates = [];
    for (const { departure, successful } of merged) {
      const fares = successful
        .flatMap((s) =>
          s.result.status === "unavailable" ? [] : s.result.value.fares,
        )
        .filter(
          (f) =>
            !selfAirportFare(f) &&
            f.originCode === departure.code &&
            // A saved detail selects an operational airport, not whichever fare ranks best.
            (!selectedArrival ||
              (!!restoredAccess &&
                fareMatchesDetailArrival(
                  f,
                  selectedArrival.airportCode,
                  restoredAccess,
                ))),
        );
      const shortlist = shortlistFlights(
        fares.filter((fare) => {
          // Mixed approaches must compete after completeness is known, not airfare alone.
          if (providers.destinationAccess?.forFare(fare).some(isMixedAccess))
            return false;
          const direct =
            providers.destinationAccess?.directForCode(fare.destinationCode) ??
            providers.destinationAccess?.directForCode(
              fare.destinationAirport ?? "",
            );
          return !direct || matchesDirectFare(direct, fare);
        }),
        flightDestinations,
        request,
      );
      diagnostics.push({
        code: "unknown-destination",
        count: new Set(
          fares
            .filter(
              (f) =>
                !catalogue.some(
                  (d) =>
                    d.iataCodes?.includes(f.destinationCode) ||
                    d.iataCodes?.includes(f.destinationAirport ?? ""),
                ) && !providers.destinationAccess?.forFare(f).length,
            )
            .map((f) => f.destinationCode),
        ).size,
      });
      candidates.push(
        ...shortlist.candidates.map(({ destination, fare }) => ({
          destination,
          discovered: fare,
          departure,
        })),
      );
      // Expand a bounded set of gateway fares into distinct final destinations.
      // Fare objects remain untouched; an airport may serve several final places.
      const mapped = new Set<string>();
      for (const fare of sortDiscoveryFares(fares, request)) {
        for (const access of providers.destinationAccess?.forFare(fare) ?? []) {
          // Direct cities use the normal one-destination fare shortlist above.
          if (directBindings(access).length && !isMixedAccess(access)) continue;
          if (
            mapped.has(
              `${access.destination.id}:${fare.destinationAirport ?? fare.destinationCode}`,
            ) ||
            !eligible(access.destination)
          )
            continue;
          mapped.add(
            `${access.destination.id}:${fare.destinationAirport ?? fare.destinationCode}`,
          );
          if (!catalogue.some((d) => d.id === access.destination.id))
            catalogue.push(access.destination);
          candidates.push({
            destination: access.destination,
            discovered: fare,
            departure,
            arrival: arrivalAccess(access, fare, request.budget.currency),
          });
        }
      }
    }
    // A failing optional airport is diagnostic information, not a global provider-unavailable warning.
    if (searches.some((s) => s.result.status !== "unavailable"))
      discoveryIssues.length = 0;
    for (const destination of destinations) {
      const explicit =
        !!request.destination && request.destination.type !== "country";
      if (
        !candidates.some(
          (c) => c.destination.id === destination.id && c.departure?.selected,
        ) &&
        ((roadOrigin && !destination.requiresFlight) ||
          explicit ||
          !!preferredId)
      )
        candidates.push({
          destination,
          departure: selected,
          arrival:
            restoredAccess && destination.id === restoredAccess.destination.id
              ? arrivalAccess(
                  restoredAccess,
                  undefined,
                  request.budget.currency,
                  selectedEntryCode,
                )
              : undefined,
        });
    }
  } else {
    candidates = candidates.filter(
      (c) =>
        !!preferredId ||
        (roadOrigin && !c.destination.requiresFlight) ||
        !!request.destination,
    );
  }
  // Reuse the already-bounded departure set, including when a saved arrival's discovery is disabled.
  // URL syntax alone cannot authorize a nearby departure.
  if (providers.discovery || selectedArrival) {
    const pinned = departures.find((d) => d.code === request.departureAirport);
    const destination = destinations.find((d) => d.id === preferredId);
    if (
      pinned &&
      destination &&
      !candidates.some(
        (c) =>
          c.destination.id === destination.id &&
          c.departure?.code === pinned.code,
      )
    )
      candidates.push({
        destination,
        departure: pinned,
        arrival: restoredAccess
          ? arrivalAccess(
              restoredAccess,
              undefined,
              request.budget.currency,
              selectedEntryCode,
            )
          : undefined,
      });
  }
  if (restoredAccess)
    for (const candidate of candidates) {
      if (
        candidate.destination.id === restoredAccess.destination.id &&
        !candidate.arrival
      )
        candidate.arrival = arrivalAccess(
          restoredAccess,
          candidate.discovered,
          request.budget.currency,
          selectedEntryCode,
        );
    }
  const rows = await Promise.all(
    candidates.map(async ({ destination, discovered, departure, arrival }) => {
      const flightPricing = resolveFlightPricing(discovered, request);
      const fare =
        flightPricing.kind === "priced" ? flightPricing.fare : undefined;
      const [route, stayResult, itinerary] = await Promise.all([
        discovered || selectedArrival || (departure && !departure.selected)
          ? Promise.resolve({
              status: "available" as const,
              value: { mode: "flight" as const, flightPricing, departure },
            })
          : safely(() => providers.transport.quote(request, destination)),
        safely(() => providers.stays.quote(request, destination)),
        providers.places.itinerary(
          destination,
          fare
            ? nightsBetween(
                fare.scope.dates.startDate,
                fare.scope.dates.endDate,
              )
            : request.nights,
        ),
      ]);
      const stay = normalizeQuote(stayResult) ?? genericStayBasis(request);
      const issues: SearchIssue[] = [];
      for (const [category, result] of [
        ["transport", route],
        ["stay", stayResult],
      ] as const) {
        if (result.status !== "available")
          issues.push({
            destinationId: destination.id,
            category,
            source: {
              status:
                result.status === "unavailable" &&
                result.fallback &&
                (category === "stay" ||
                  ("mode" in result.fallback &&
                    result.fallback.mode === "road"))
                  ? "fallback"
                  : result.status,
              reason: result.reason,
            },
          });
      }
      let transport: TransportQuote | undefined =
        route.status === "unavailable" ? route.fallback : route.value;
      if (!transport && (!roadOrigin || destination.requiresFlight))
        transport = {
          mode: "flight",
          flightPricing: {
            kind: "unavailable",
            reason: "provider-unavailable",
          },
        };
      if (transport?.mode === "road") {
        const price = normalizeQuote(
          route.status === "unavailable"
            ? { ...route, fallback: transport.price }
            : { ...route, value: transport.price },
        );
        transport = price ? { ...transport, price } : undefined;
      } else if (transport) {
        const access = providers.destinationAccess?.get(destination.id);
        transport = {
          ...transport,
          departure,
          arrival: selectedArrival
            ? selectedArrival.arrival
            : (arrival ??
              (access
                ? arrivalAccess(
                    access,
                    discovered,
                    request.budget.currency,
                    selectedEntryCode ?? selectedCode,
                  )
                : undefined)),
          directArrival: selectedArrival
            ? selectedArrival.directArrival
            : access
              ? directArrival(access, discovered, selectedEntryCode)
              : undefined,
        };
      }
      const validCurrency =
        stay?.amount.currency === request.budget.currency &&
        (transport?.mode !== "road" ||
          transport.price.amount.currency === request.budget.currency);
      const template: TripTemplate | undefined =
        stay && transport && validCurrency
          ? {
              id: destination.id,
              destination: {
                ...destination,
                image: undefined,
                heroImage: undefined,
                fallbackImage: undefined,
              },
              origin,
              transport,
              stay,
              itinerary,
              costReferenceDate,
            }
          : undefined;
      if (!template && stay && transport)
        issues.push({
          destinationId: destination.id,
          category: "transport",
          source: { status: "unavailable", reason: "currency-mismatch" },
        });
      return { template, issues };
    }),
  );
  // Direct arrivals compete on completeness/total before deduplication. Preserve
  // the existing multi-approach contract for gateways/mixed access and departure options.
  const directChoices = new Map<string, (typeof rows)[number]>();
  const candidateRows = rows.filter((row) => {
    const template = row.template;
    if (!template || template.transport.mode === "road") return true;
    const access = providers.destinationAccess?.get(template.id);
    if (access && (!directBindings(access).length || isMixedAccess(access)))
      return true;
    const key = `${template.id}:${template.transport.departure?.code ?? ""}`;
    const previous = directChoices.get(key);
    if (
      !previous ||
      comparePlans(
        pricePlan(template, request),
        pricePlan(previous.template!, request),
      ) < 0
    )
      directChoices.set(key, row);
    return false;
  });
  candidateRows.push(...directChoices.values());
  // Cost/stay/itinerary evaluation is local in the current composition. Rank the
  // already-returned, identity-resolved evidence before the ten-destination cap.
  // Preserve alternate departures/arrivals for those destinations and detail restoration.
  // Provider query, response and metadata-resolution bounds remain unchanged.
  const retainedIds = new Set(
    chooseDeparturePlans(
      candidateRows.flatMap(({ template }) =>
        template?.transport.mode === "flight"
          ? [pricePlan(template, request)]
          : [],
      ),
    )
      .slice(0, MAX_FLIGHT_DESTINATIONS)
      .map((plan) => plan.id),
  );
  const retainedRows = candidateRows.filter(
    ({ template }) =>
      template &&
      (template.transport.mode === "road" || retainedIds.has(template.id)),
  );
  // Read both approved roles for every engine-bounded destination; no media metadata/network lookup.
  const imageRows = retainedRows
    .filter(
      (row, index, all) =>
        row.template &&
        all.findIndex((other) => other.template?.id === row.template?.id) ===
          index,
    )
    .sort(
      (a, b) =>
        Number(b.template!.id === preferredId) -
        Number(a.template!.id === preferredId),
    );
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, imageRows.length) }, async () => {
      while (cursor < imageRows.length) {
        const template = imageRows[cursor++].template!;
        try {
          const [card, hero] = await Promise.all([
            providers.images.forDestination(template.id, "destination.card"),
            providers.images.forDestination(template.id, "destination.hero"),
          ]);
          template.destination.image = card;
          template.destination.heroImage = hero;
        } catch {
          /* A failed image never removes an otherwise usable trip. */
        }
      }
    }),
  );
  for (const row of retainedRows) {
    const enriched = imageRows.find(
      (other) => other.template?.id === row.template?.id,
    )?.template;
    if (row.template && enriched)
      row.template.destination = enriched.destination;
  }
  return {
    diagnostics,
    templates: retainedRows.flatMap((row) =>
      row.template ? [row.template] : [],
    ),
    issues: [...discoveryIssues, ...rows.flatMap((row) => row.issues)],
  };
}
