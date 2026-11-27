import { isCalendarDate, nightsBetween } from "../dates";
import { isCurrency, type CurrencyCode } from "../money/currency";
import { planningCostPolicy } from "../money/planning-rates";
import type { Destination, PriceQuote, TripRequest } from "../types";
import { destinationCostId } from "./identity";
import { destinationCostProfiles } from "./profiles";
import type {
  CostIntegrity,
  DestinationCostComponent,
  DestinationCostProfile,
  PlanningCostProvenance,
} from "./types";
export const destinationCostComponents: readonly DestinationCostComponent[] = [
  "stay",
  "food",
  "localTransport",
  "arrivalTransport",
  "activities",
];
const units = {
  stay: ["room-night"],
  food: ["person-day"],
  localTransport: ["person-trip", "person-day"],
  arrivalTransport: ["party-trip", "person-trip"],
  activities: ["person-night"],
};
export function validateCostProfiles(
  profiles: readonly DestinationCostProfile[],
): void {
  const identities = new Set<string>();
  const profileIds = new Set<string>();
  for (const p of profiles) {
    const key = `${p.destinationId}:${p.currency}`;
    if (identities.has(key))
      throw Error("Duplicate destination/currency cost profile");
    identities.add(key);
    if (profileIds.has(p.id)) throw Error("Duplicate cost profile ID");
    profileIds.add(p.id);
    if (
      !/^(city:[A-Z]{3}|place:Q[1-9]\d*)$/.test(p.destinationId) ||
      !/^[A-Z]{2}$/.test(p.countryCode) ||
      !isCurrency(p.currency) ||
      !/^[a-z0-9-]{1,80}$/.test(p.id) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.revision) ||
      !["reviewed", "draft"].includes(p.reviewStatus) ||
      !isCalendarDate(p.reviewedAt) ||
      !isCalendarDate(p.reviewAfter) ||
      p.revision !== p.reviewedAt ||
      nightsBetween(p.reviewedAt, p.reviewAfter) < 1 ||
      nightsBetween(p.reviewedAt, p.reviewAfter) > 90 ||
      !Number.isSafeInteger(p.maxNights) ||
      p.maxNights < 1 ||
      p.maxNights > 14 ||
      !p.sourceReferences.length ||
      !Object.keys(p.costs).length
    )
      throw Error("Invalid cost profile identity or review");
    if (
      new Set(p.sourceReferences.map((s) => s.id)).size !==
      p.sourceReferences.length
    )
      throw Error("Duplicate cost source");
    for (const source of p.sourceReferences) {
      const url = new URL(source.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !isCalendarDate(source.checkedAt) ||
        source.checkedAt > p.reviewedAt ||
        nightsBetween(source.checkedAt, p.reviewedAt) > 90 ||
        ![
          "official-transport",
          "official-tourism",
          "accommodation-observation",
          "official-menu",
          "official-attraction",
          "consumer-study",
        ].includes(source.type)
      )
        throw Error("Invalid cost source");
    }
    for (const [name, c] of Object.entries(p.costs)) {
      const key = name as DestinationCostComponent;
      if (
        !destinationCostComponents.includes(key) ||
        !units[key].includes(c.unit) ||
        c.amount.currency !== p.currency ||
        !Number.isSafeInteger(c.amount.cents) ||
        c.amount.cents < 0 ||
        c.amount.cents > 1_000_000 ||
        (["stay", "food", "localTransport"].includes(key) &&
          c.amount.cents === 0) ||
        typeof c.basket?.en !== "string" ||
        c.basket.en.trim().length < 20 ||
        (c.basket.sq !== undefined &&
          (typeof c.basket.sq !== "string" ||
            c.basket.sq.trim().length < 20)) ||
        !c.sourceIds.length ||
        c.sourceIds.some((id) => !p.sourceReferences.some((s) => s.id === id))
      )
        throw Error("Invalid cost assumption");
    }
  }
}
validateCostProfiles(destinationCostProfiles); // Validate once when the static catalogue loads, never parse files per card.
export function activeCostProfile(
  destinationId: string,
  currency: CurrencyCode,
  today: string,
  profiles = destinationCostProfiles,
) {
  if (!isCalendarDate(today)) return undefined;
  return profiles.find(
    (p) =>
      p.destinationId === destinationId &&
      p.currency === currency &&
      p.reviewStatus === "reviewed" &&
      p.reviewedAt <= today &&
      today < p.reviewAfter,
  );
}
export function completeCostProfile(profile?: DestinationCostProfile) {
  return (
    !!profile && destinationCostComponents.every((key) => !!profile.costs[key])
  );
}
export type CostContext = {
  now?: number;
  today: string;
  profiles?: readonly DestinationCostProfile[];
  /** Test/offline override for reviewed room panels and Eurostat series. */
  stayData?: import("./stay-figures").StayData;
};
/** Exact identity/currency, active review and bounded trip duration. No FX or name matching. */
export function resolveDestinationCosts(
  destination: Destination,
  request: TripRequest,
  stay: PriceQuote,
  context?: CostContext,
) {
  const currency = request.budget.currency,
    rates = planningCostPolicy[currency];
  const id = destinationCostId(destination);
  const found =
    context && id
      ? activeCostProfile(id, currency, context.today, context.profiles)
      : undefined;
  const profile =
    found &&
    found.countryCode === destination.countryCode &&
    request.nights <= found.maxNights
      ? found
      : undefined;
  const reference = profile
    ? {
        id: profile.id,
        revision: profile.revision,
        destinationId: profile.destinationId,
        currency,
        reviewedAt: profile.reviewedAt,
        reviewAfter: profile.reviewAfter,
      }
    : undefined;
  const provenance = (
    component: DestinationCostComponent,
    generic: PlanningCostProvenance["basis"] = "generic-currency",
  ): PlanningCostProvenance => {
    const assumption = profile?.costs[component];
    return assumption && reference
      ? {
          component,
          basis: "reviewed-destination",
          profile: reference,
          sourceIds: assumption.sourceIds,
          basket: assumption.basket,
        }
      : { component, basis: generic, sourceIds: [] };
  };
  const people = request.party.adults + request.party.children,
    days = request.nights + 1;
  const local = profile?.costs.localTransport;
  const arrival = profile?.costs.arrivalTransport;
  return {
    profile: reference,
    stayRoomNight: profile?.costs.stay?.amount,
    stayProvenance: provenance(
      "stay",
      stay.planning?.[0]?.basis ?? "curated-legacy",
    ),
    foodPersonDay: profile?.costs.food?.amount.cents ?? rates.foodPersonDay,
    foodProvenance: provenance("food"),
    localTotal: local
      ? local.amount.cents * people * (local.unit === "person-day" ? days : 1)
      : rates.localPerson * people,
    localProvenance: provenance("localTransport"),
    arrivalTotal: arrival
      ? arrival.amount.cents * (arrival.unit === "person-trip" ? people : 1)
      : rates.arrivalTransport,
    arrivalProvenance: provenance("arrivalTransport"),
    activityPersonNight:
      profile?.costs.activities?.amount.cents ?? rates.activityPersonNight,
    activityProvenance: provenance("activities", "planning-allowance"),
  };
}
/** All relevant destination components must be reviewed; baggage/departure travel stay separate. */
export function deriveCostIntegrity(
  provenance: readonly PlanningCostProvenance[],
): CostIntegrity {
  const relevant = provenance.filter((p) =>
    destinationCostComponents.includes(p.component as DestinationCostComponent),
  );
  const reviewedComponents = destinationCostComponents.filter(
    (key) =>
      relevant.some(
        (p) => p.component === key && p.basis === "reviewed-destination",
      ) &&
      relevant
        .filter((p) => p.component === key)
        .every((p) => p.basis === "reviewed-destination"),
  );
  const providerComponents = destinationCostComponents.filter((key) =>
    relevant.some(
      (p) => p.component === key && p.basis === "provider-availability",
    ),
  );
  const generalComponents = [
    ...new Set(
      relevant
        .filter(
          (p) =>
            !reviewedComponents.includes(
              p.component as DestinationCostComponent,
            ) &&
            !providerComponents.includes(
              p.component as DestinationCostComponent,
            ),
        )
        .map((p) => p.component as DestinationCostComponent),
    ),
  ];
  const reference = relevant.find(
    (p) => p.basis === "reviewed-destination",
  )?.profile;
  return {
    providerComponents,
    status: providerComponents.length
      ? "mixed"
      : reviewedComponents.length
        ? generalComponents.length
          ? "mixed"
          : "reviewed"
        : "generic",
    reviewedComponents,
    generalComponents,
    profile: reference,
  };
}
