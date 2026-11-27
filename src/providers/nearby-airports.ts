import type { NearbyAirportProvider } from "./contracts";
import type { TravelLocation } from "../domain/types";
import {
  departureCode,
  estimateAirportTransfer,
  selectedDeparture,
  type TransferPolicy,
} from "../domain/airports";

/** Curated planning allowances, not transport schedules, tickets or live routing. */
export const launchAirports: Record<string, TravelLocation> = {
  PRN: {
    id: "airport:PRN",
    type: "airport",
    name: "Prishtina Airport",
    airportIata: "PRN",
    iataCodes: ["PRN"],
    countryCode: "XK",
    countryName: { en: "Kosovo", sq: "Kosovë" },
  },
  SKP: {
    id: "airport:SKP",
    type: "airport",
    name: "Skopje Airport",
    airportIata: "SKP",
    iataCodes: ["SKP"],
    countryCode: "MK",
    countryName: { en: "North Macedonia", sq: "Maqedonia e Veriut" },
  },
  TIA: {
    id: "airport:TIA",
    type: "airport",
    name: "Tirana Airport",
    airportIata: "TIA",
    iataCodes: ["TIA"],
    countryCode: "AL",
    countryName: { en: "Albania", sq: "Shqipëri" },
  },
};
export const launchTransfers: Record<string, Record<string, TransferPolicy>> = {
  PRN: {
    SKP: { currency: "EUR", returnPerPersonCents: 4000, oneWayMinutes: 120 },
    TIA: { currency: "EUR", returnPerPersonCents: 6000, oneWayMinutes: 240 },
  },
  SKP: {
    PRN: { currency: "EUR", returnPerPersonCents: 4000, oneWayMinutes: 120 },
    TIA: { currency: "EUR", returnPerPersonCents: 7000, oneWayMinutes: 300 },
  },
  TIA: {
    PRN: { currency: "EUR", returnPerPersonCents: 6000, oneWayMinutes: 240 },
    SKP: { currency: "EUR", returnPerPersonCents: 7000, oneWayMinutes: 300 },
  },
};
export const curatedNearbyAirports: NearbyAirportProvider = {
  candidates(request, origin) {
    const selected = selectedDeparture(origin);
    if (!selected) return [];
    if (
      request.budget.currency !== "EUR" ||
      !request.preferences.nearbyAirports ||
      request.noFlight ||
      request.scope === "domestic"
    )
      return [selected];
    const code = departureCode(origin)!;
    // City/airport identity and country must both agree; never infer coverage from proximity alone.
    if (
      !launchAirports[code] ||
      origin.countryCode !== launchAirports[code].countryCode
    )
      return [selected];
    return [
      selected,
      ...Object.entries(launchTransfers[code]).map(([alternative, policy]) => ({
        code: alternative,
        airport: launchAirports[alternative],
        selected: false,
        transfer: estimateAirportTransfer(
          origin,
          launchAirports[alternative],
          request.party,
          policy,
        ),
      })),
    ];
  },
};
