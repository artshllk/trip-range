/**
 * Custom trip planner (search form, /plan/results, /plan/trips/*, the homepage's
 * planner view and the planner-backed origin landings such as /from/prishtina).
 *
 * Off since 24 November 2026 (owner decision). That flow presents estimated
 * whole-trip totals built from partial city profiles and general allowances, and no
 * city has supported whole-trip cost evidence yet. The code stays; every entry point
 * checks this flag. Keep it off until real whole-trip cost evidence exists, and then
 * rebuild the flow's copy rather than patching it (docs/collector/handover.md).
 *
 * A code constant, not an environment variable, so turning it back on is a reviewed
 * change, never a deploy setting.
 */
export const customPlannerEnabled = false;
