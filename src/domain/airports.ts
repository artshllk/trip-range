import type { CurrencyCode } from "./money/currency";
import type { MoneyAmount, TravelLocation, TravelerParty } from "./types";
export type AirportTransferEstimate = {
  origin: TravelLocation;
  departureAirport: TravelLocation;
  amount: MoneyAmount;
  durationMinutes: number; // One way; cost covers both directions for the whole party.
  confidence: "estimate";
  providerId: "goeksplo-transfer-estimate";
  journey: "return";
};
export type DepartureAirportCandidate = {
  code: string;
  airport: TravelLocation;
  selected: boolean;
  transfer?: AirportTransferEstimate;
};
export function departureCode(origin: TravelLocation) {
  return origin.airportIata ?? origin.cityCode ?? origin.iataCodes?.[0];
}
export function selectedDeparture(
  origin: TravelLocation,
): DepartureAirportCandidate | undefined {
  const code = departureCode(origin);
  return code && /^[A-Z]{3}$/.test(code)
    ? { code, airport: origin, selected: true }
    : undefined;
}
export type TransferPolicy = {
  currency: CurrencyCode;
  returnPerPersonCents: number;
  oneWayMinutes: number;
};
export function estimateAirportTransfer(
  origin: TravelLocation,
  airport: TravelLocation,
  party: TravelerParty,
  policy: TransferPolicy,
): AirportTransferEstimate {
  return {
    origin,
    departureAirport: airport,
    amount: {
      cents: policy.returnPerPersonCents * (party.adults + party.children),
      currency: policy.currency,
    },
    durationMinutes: policy.oneWayMinutes,
    confidence: "estimate",
    providerId: "goeksplo-transfer-estimate",
    journey: "return",
  };
}
/** Enforce limits at orchestration even if a future provider returns duplicate or invalid candidates. */
export function boundedDepartures(
  origin: TravelLocation,
  candidates: DepartureAirportCandidate[],
  currency: CurrencyCode = "EUR",
) {
  const selected = selectedDeparture(origin);
  if (!selected) return [];
  const result = [selected];
  for (const candidate of candidates) {
    const transfer = candidate.transfer;
    if (result.length === 3) break;
    if (
      !/^[A-Z]{3}$/.test(candidate.code) ||
      result.some((c) => c.code === candidate.code) ||
      departureCode(candidate.airport) !== candidate.code ||
      !transfer ||
      transfer.origin.id !== origin.id ||
      departureCode(transfer.departureAirport) !== candidate.code ||
      !Number.isSafeInteger(transfer.amount.cents) ||
      transfer.amount.cents <= 0 ||
      !Number.isSafeInteger(transfer.durationMinutes) ||
      transfer.durationMinutes <= 0 ||
      transfer.amount.currency !== currency ||
      transfer.journey !== "return" ||
      transfer.confidence !== "estimate"
    )
      continue;
    result.push({ ...candidate, selected: false });
  }
  return result;
}
