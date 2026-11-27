import type { CurrencyCode } from "./currency";
export type PlanningRates = {
  stayTwoNights: number;
  roadVehicle: number;
  baggage: number;
  carDay: number;
  localPerson: number;
  arrivalTransport: number;
  foodPersonDay: number;
  activityPersonNight: number;
  minimumReserve: number;
  rankingBand: number;
};
/** Independent coarse planning allowances in each currency's minor units, NOT exchange rates.
 * Existing destination-specific EUR bases remain EUR-only. No local-price accuracy is implied.
 */
export const planningCostPolicy: Record<CurrencyCode, PlanningRates> = {
  EUR: {
    stayTwoNights: 18000,
    roadVehicle: 6000,
    baggage: 3000,
    carDay: 3500,
    localPerson: 500,
    arrivalTransport: 3000,
    foodPersonDay: 1200,
    activityPersonNight: 500,
    minimumReserve: 2000,
    rankingBand: 5000,
  },
  GBP: {
    stayTwoNights: 16000,
    roadVehicle: 5500,
    baggage: 2500,
    carDay: 4000,
    localPerson: 600,
    arrivalTransport: 2500,
    foodPersonDay: 1800,
    activityPersonNight: 800,
    minimumReserve: 2500,
    rankingBand: 5000,
  },
  USD: {
    stayTwoNights: 24000,
    roadVehicle: 8500,
    baggage: 4500,
    carDay: 5500,
    localPerson: 900,
    arrivalTransport: 4500,
    foodPersonDay: 2500,
    activityPersonNight: 1200,
    minimumReserve: 3500,
    rankingBand: 7500,
  },
  CHF: {
    stayTwoNights: 26000,
    roadVehicle: 9000,
    baggage: 4000,
    carDay: 6000,
    localPerson: 800,
    arrivalTransport: 4000,
    foodPersonDay: 2500,
    activityPersonNight: 1000,
    minimumReserve: 3000,
    rankingBand: 6000,
  },
};
