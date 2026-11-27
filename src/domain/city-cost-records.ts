/**
 * Sourced city tax and airport transfer records (owner decision, 24 November 2026).
 * Format and rules: src/domain/budget-left.ts and docs/city-costs.md. A city or
 * airport without a valid, current record is unknown, never zero.
 */
import taxes from "../../content/city-costs/city-tax.json";
import transfers from "../../content/city-costs/airport-transfers.json";
import attractions from "../../content/city-costs/attractions.json";
import type { AirportTransferRecord, CityTaxRecord } from "./budget-left";
import type { AttractionRecord } from "./attractions";

export const cityTaxRecords =
  taxes.records as unknown as readonly CityTaxRecord[];
export const airportTransferRecords =
  transfers.records as unknown as readonly AirportTransferRecord[];
/** Official sight prices; Rome only for now (owner decision, 25 November 2026). */
export const attractionRecords =
  attractions.records as unknown as readonly AttractionRecord[];
