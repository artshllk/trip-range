import type { LocalizedCopy } from "./localized";

/**
 * Notes beside hand-set planning amounts. Meanings:
 * - stay: a Trip Range planning baseline for a standard private room, set on {date};
 *   not a hotel price or availability.
 * - transfer: a Trip Range planning allowance for getting to that airport and back,
 *   set on {date}; not a fare, timetable or confirmed connection.
 * - range: the documented planning range. Only shown when a range is documented.
 */
export const planningParameterCopy = {
  en: {
    stay: "Room allowance set by Trip Range on {date}, for a standard private room. We chose this amount; it is not an observed hotel price.",
    transfer:
      "Airport transfer allowance set by Trip Range on {date}, for travel there and back. We chose this amount; it is not a quoted fare or a timetable.",
    range: "Planning range: {low}–{high}",
  },
} as const satisfies LocalizedCopy<unknown>;
