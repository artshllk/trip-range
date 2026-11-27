import type { FlightDiscoveryFare } from "../types";
import type {
  AccessibleDestination,
  ArrivalAccess,
  DirectCityBinding,
  DirectDestinationEntry,
  DirectArrival,
} from "./types";
import type { CurrencyCode } from "../money/currency";
export function directBindings(access: {
  directCity?: DirectCityBinding;
  directEntries?: DirectDestinationEntry[];
}): DirectCityBinding[] {
  return access.directCity ? [access.directCity] : (access.directEntries ?? []);
}
/** A mismatched explicit airport must not be accepted just because its city code matches. */
export function matchesDirectFare(
  access: AccessibleDestination,
  fare: FlightDiscoveryFare,
) {
  return directBindings(access).some((d) => matchesBinding(d, fare));
}
function matchesBinding(d: DirectCityBinding, fare: FlightDiscoveryFare) {
  const airport = fare.destinationAirport;
  return airport
    ? d.airportCodes.includes(airport) &&
        (fare.destinationCode === d.providerCityCode ||
          fare.destinationCode === airport)
    : fare.destinationCode === d.providerCityCode ||
        d.airportCodes.includes(fare.destinationCode);
}
/** URL hints are never identity evidence: only exact reviewed bindings are eligible. */
export function directEntryForCode(
  access: AccessibleDestination,
  code?: string,
) {
  return code
    ? access.directEntries?.find(
        (e) => e.providerCityCode === code || e.airportCodes.includes(code),
      )
    : undefined;
}
export function gatewayForCode(access: AccessibleDestination, code?: string) {
  return code
    ? access.gateways.find(
        (g) => g.airportCode === code || g.providerCityCode === code,
      )
    : undefined;
}
export function isMixedAccess(access: AccessibleDestination) {
  return !!access.directEntries?.length && access.gateways.length > 0;
}
export function directArrival(
  access: AccessibleDestination,
  fare?: FlightDiscoveryFare,
  selectedCode?: string,
): DirectArrival | undefined {
  const selected = directEntryForCode(access, selectedCode);
  const entry = fare
    ? access.directEntries?.find((e) => matchesBinding(e, fare))
    : (selected ??
      (isMixedAccess(access) ? undefined : access.directEntries?.[0]));
  if (!entry) return;
  const airport =
    fare?.destinationAirport ??
    (fare && entry.airportCodes.includes(fare.destinationCode)
      ? fare.destinationCode
      : !fare && selected?.airportCodes.includes(selectedCode!)
        ? selectedCode
        : undefined);
  return {
    label: structuredClone(entry.cityLabel),
    airportCode: airport,
    flightDestinationCode:
      airport ?? fare?.destinationCode ?? entry.providerCityCode,
  };
}
/** Explicit airports dominate city groups. Never replace an unknown airport with a known one. */
export function arrivalAccess(
  access: AccessibleDestination,
  fare?: FlightDiscoveryFare,
  currency: CurrencyCode = "EUR",
  selectedCode?: string,
): ArrivalAccess | undefined {
  // Rio's approved guide explicitly leaves RRJ ground transport unverified.
  // This is a cost constraint, not a change from direct-city to gateway identity.
  // Keep it until reviewed transfer evidence replaces the known uncertainty.
  const directAirport =
    fare?.destinationAirport ?? fare?.destinationCode ?? selectedCode;
  if (
    access.destination.id === "place:Q8678" &&
    directAirport === "RRJ" &&
    access.directCity?.airportCodes.includes("RRJ") &&
    (!fare || matchesDirectFare(access, fare))
  )
    return {
      destinationSubject: access.destination.id,
      providerCityCode: access.directCity.providerCityCode,
      flightDestinationCode: "RRJ",
      airportCode: "RRJ",
      label: { en: "RRJ", sq: "RRJ" },
      onwardTransfer: {
        status: "unpriced",
        required: true,
        reason: "no-reviewed-price",
      },
    };
  if (fare && matchesDirectFare(access, fare)) return;
  const selected = !fare ? gatewayForCode(access, selectedCode) : undefined;
  // A mixed profile alone does not establish which relationship the traveller chose.
  if (!fare && isMixedAccess(access) && !selected) return;
  const code = fare?.destinationCode ?? selected?.providerCityCode;
  const selectedAirport =
    selected &&
    (selectedCode === selected.airportCode ||
      access.gateways.filter((g) => g.providerCityCode === selectedCode)
        .length === 1)
      ? selected.airportCode
      : undefined;
  const airport =
    fare?.destinationAirport ??
    selectedAirport ??
    (access.gateways.some((g) => g.airportCode === code) ? code : undefined);
  const g = airport
    ? access.gateways.find(
        (g) =>
          g.airportCode === airport &&
          (!code || code === g.airportCode || code === g.providerCityCode),
      )
    : access.gateways.find((g) => !code || code === g.providerCityCode);
  if (!g) return;
  return {
    destinationSubject: access.destination.id,
    providerCityCode: g.providerCityCode,
    flightDestinationCode: airport ?? code ?? g.providerCityCode,
    airportCode: airport,
    label: airport ? { en: airport, sq: airport } : g.cityLabel,
    // A group-only fare does not establish which airport/transfer will be used.
    onwardTransfer: airport
      ? structuredClone(
          access.transferPrices[airport]?.[currency] ?? {
            status: "unpriced",
            required: true,
            reason: "no-reviewed-price",
          },
        )
      : { status: "unpriced", required: true, reason: "airport-unconfirmed" },
  };
}
