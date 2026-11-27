/**
 * Origins a traveller can choose on /plan (owner decision, 23 November 2026). The
 * choice travels only in the URL (`/plan?depart=london`): nothing is stored on the
 * device. Every option is a collected origin; tests keep this list and
 * src/config/fare-warm.json in step.
 */
export type PlanOrigin = {
  /** URL value of `depart`. */
  slug: string;
  /** Provider city-market code. */
  code: string;
  name: string;
};

export const planOrigins: readonly PlanOrigin[] = [
  { slug: "tirana", code: "TIA", name: "Tirana" },
  { slug: "london", code: "LON", name: "London" },
  { slug: "barcelona", code: "BCN", name: "Barcelona" },
  { slug: "warsaw", code: "WAW", name: "Warsaw" },
];

/**
 * Tirana: the home market and, on 23 November 2026, the only origin that had passed
 * the five-snapshot coverage gate. Revisit on 28 November 2026 (see
 * docs/collector/handover.md): if London, Barcelona and Warsaw pass the same gate,
 * the default should become the strongest origin.
 */
export const defaultPlanOrigin = planOrigins[0];

/**
 * Resolve `depart`. A missing value is the default; an unrecognised one (a typo in a
 * shared link) also falls back to the default, and `unknown` lets the page say so.
 */
export function planOrigin(depart: unknown): {
  origin: PlanOrigin;
  unknown?: string;
} {
  if (depart === undefined || depart === "")
    return { origin: defaultPlanOrigin };
  const value = typeof depart === "string" ? depart.trim().toLowerCase() : "";
  const origin = planOrigins.find((o) => o.slug === value);
  if (origin) return { origin };
  return {
    origin: defaultPlanOrigin,
    unknown: typeof depart === "string" ? depart.slice(0, 40) : "that place",
  };
}

export function planOriginByCode(code: string) {
  return planOrigins.find((o) => o.code === code);
}
