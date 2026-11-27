import { supportedCurrencies } from "../money/currency";
import { emptyIntent, unsupportedPreferences } from "./intent";
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const date = { type: "string", pattern: "^(?:[0-9]{4}-)?[0-9]{2}-[0-9]{2}$" };
export const intentSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(emptyIntent),
  properties: {
    originQuery: nullable({ type: "string", minLength: 2, maxLength: 80 }),
    destinationQuery: nullable({ type: "string", minLength: 2, maxLength: 80 }),
    anywhere: { type: "boolean" },
    budgetAmount: nullable({ type: "number" }),
    currency: nullable({
      type: "string",
      enum: [...supportedCurrencies, "unsupported"],
    }),
    adults: nullable({ type: "integer" }),
    children: nullable({ type: "integer" }),
    travellersAmbiguous: { type: "boolean" },
    travellerTotal: nullable({ type: "integer" }),
    dateIntent: nullable({
      type: "object",
      additionalProperties: false,
      required: ["type", "start", "end", "month"],
      properties: {
        type: {
          type: "string",
          enum: [
            "exact",
            "this-weekend",
            "next-weekend",
            "flexible-three-days",
            "any-weekend",
          ],
        },
        start: nullable(date),
        end: nullable(date),
        month: nullable({
          type: "string",
          pattern: "^(?:[0-9]{4}-)?[0-9]{2}$",
        }),
      },
    }),
    styles: nullable({
      type: "array",
      maxItems: 4,
      items: { type: "string", enum: ["nature", "beach", "city", "quiet"] },
    }),
    stayLevel: nullable({
      type: "string",
      enum: ["simple", "standard", "comfort"],
    }),
    nearbyAirports: nullable({ type: "boolean" }),
    luggage: nullable({ type: "boolean" }),
    noFlight: nullable({ type: "boolean" }),
    familyStay: nullable({ type: "boolean" }),
    unsupportedPreferences: {
      type: "array",
      maxItems: 9,
      items: { type: "string", enum: unsupportedPreferences },
    },
  },
};
