import type { TripPlan } from "../../domain/types";
import type { TripExplanationProvider } from "../../providers/contracts";
import {
  explanationFacts,
  readExplanations,
} from "../../domain/ai/explanations";
/** Normal searches never call the provider. A single batch cannot mutate the engine's plans. */
export async function explainTrips(
  aiSearch: boolean,
  plans: TripPlan[],
  locale: "en" | "sq",
  provider: TripExplanationProvider,
): Promise<Record<string, string>> {
  if (!aiSearch || !plans.length) return {};
  const facts = explanationFacts(plans, locale);
  if (!facts.length) return {};
  const expected = structuredClone(facts);
  try {
    const result = await provider.explain(facts, locale);
    if (result.status !== "available") return {};
    const checked = readExplanations(
      { explanations: result.explanations },
      expected,
    );
    return checked?.status === "available"
      ? Object.fromEntries(checked.explanations.map((e) => [e.tripId, e.text]))
      : {};
  } catch {
    return {};
  }
}
