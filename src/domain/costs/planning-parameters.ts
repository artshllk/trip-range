/**
 * Hand-set model parameters: planning inputs, not observations. Kept because no
 * accommodation or ground-transfer data source exists (Hotellook is closed); without
 * them stays would be unpriceable. Each renders visibly as an estimate with its basis
 * and the date its values were last set (from git history).
 *
 * `range` is shown only once documented. None is documented yet for either parameter,
 * and a range is never invented: supply one (with its basis) here to display it.
 */
export type ParameterRange = {
  /** Multipliers applied to the parameter value, e.g. 0.8 and 1.3. */
  lowFactor: number;
  highFactor: number;
  basis: string;
};
export type PlanningParameter = {
  id: "stay-baseline" | "departure-transfer";
  /** Date the values were last set: git blame of the value lines. */
  asOf: string;
  /** Where the values live and the commit that set them. */
  source: string;
  range?: ParameterRange;
};

/** Standard private room, two nights, per destination (src/catalogue/flight-destinations.ts). */
export const stayBaseline: PlanningParameter = {
  id: "stay-baseline",
  asOf: "2026-10-06",
  source: "src/catalogue/flight-destinations.ts @ df8aba0",
};

/** Return inter-city transfer per traveller to an alternative departure airport. */
export const departureTransfer: PlanningParameter = {
  id: "departure-transfer",
  asOf: "2026-10-08",
  source: "src/providers/nearby-airports.ts @ b807f4ce",
};

export function parameterRange(
  cents: number,
  parameter: PlanningParameter,
): { low: number; high: number } | undefined {
  const r = parameter.range;
  if (!r || !(r.lowFactor > 0) || !(r.highFactor >= r.lowFactor)) return;
  return {
    low: Math.round(cents * r.lowFactor),
    high: Math.round(cents * r.highFactor),
  };
}
