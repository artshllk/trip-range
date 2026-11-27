import type { TravelIntentResult } from "../domain/ai/intent";
import type {
  TripExplanationFacts,
  TripExplanationResult,
} from "../domain/ai/explanations";
import type { DepartureAirportCandidate } from "../domain/airports";
import type {
  Destination,
  ImageAsset,
  LocalizedText,
  PriceQuote,
  TripRequest,
  TransportQuote,
  TravelLocation,
  FlightDiscovery,
} from "../domain/types";
import type {
  AffiliateResult,
  AffiliatePlacement,
  FlightHandoff,
} from "../domain/affiliate";
export interface FlightAffiliateProvider {
  createLink(
    route: FlightHandoff,
    placement: AffiliatePlacement,
  ): Promise<AffiliateResult>;
}
/** Reserved boundary only: no accommodation affiliate provider is configured. */
export interface AccommodationAffiliateProvider {
  createLink(
    request: TripRequest,
    destination: Destination,
  ): Promise<AffiliateResult>;
}
export type ProviderResult<T> =
  | { status: "available"; value: T }
  | { status: "stale"; value: T; reason: string }
  | { status: "unavailable"; fallback?: T; reason: string };
export interface LocationProvider {
  get(id: string): Promise<TravelLocation | undefined>;
}
export interface NearbyAirportProvider {
  candidates(
    request: TripRequest,
    origin: TravelLocation,
  ): DepartureAirportCandidate[];
}
export interface FlightDiscoveryProvider {
  discover(
    request: TripRequest,
    origin: TravelLocation,
    options?: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<ProviderResult<FlightDiscovery>>;
}
export interface TransportProvider {
  quote(
    request: TripRequest,
    destination: Destination,
  ): Promise<ProviderResult<TransportQuote>>;
}
/** Planning allowance only. Never return inventory through this unscoped contract. */
export interface StayProvider {
  quote(
    request: TripRequest,
    destination: Destination,
  ): Promise<ProviderResult<PriceQuote>>;
}
/** Reserved inventory boundary. Production has no implementation until partner access.
 * Context must come from the user/request, never guessed from origin or IP. */
export interface AccommodationEvidenceProvider {
  search(
    request: TripRequest,
    destination: Destination,
    context: {
      bookerCountry: string;
      platform: "desktop" | "mobile";
      signal: AbortSignal;
    },
  ): Promise<import("../domain/accommodation-evidence").AccommodationEvidence>;
}
export interface DestinationResolver {
  resolve(codes: string[]): Promise<Destination[]>;
}
export interface DestinationProvider {
  list(): Promise<Destination[]>;
}
export interface PlacesProvider {
  itinerary(destination: Destination, nights: number): Promise<LocalizedText[]>;
}
export interface ImageProvider {
  forDestination(
    id: string,
    role?: import("../domain/media/types").DestinationMediaRole,
  ): Promise<ImageAsset | undefined>;
}
export type TravelProviders = {
  destinationAccess?: import("../domain/destination-access/types").DestinationAccessStore;
  locations: LocationProvider;
  discovery?: FlightDiscoveryProvider;
  destinationResolver?: DestinationResolver;
  nearbyAirports?: NearbyAirportProvider;
  transport: TransportProvider;
  stays: StayProvider;
  destinations: DestinationProvider;
  places: PlacesProvider;
  images: ImageProvider;
};

export interface LocationSearch {
  search(term: string): Promise<{
    locations: TravelLocation[];
    status: "available" | "unavailable";
  }>;
}

export interface TravelIntentProvider {
  parse(input: {
    text: string;
    locale: "en" | "sq";
  }): Promise<TravelIntentResult>;
}
export interface TripExplanationProvider {
  explain(
    facts: TripExplanationFacts[],
    locale: "en" | "sq",
  ): Promise<TripExplanationResult>;
}
