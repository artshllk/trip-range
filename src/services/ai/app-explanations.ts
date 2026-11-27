import { serverEnvironment } from "../../providers/server/environment";
import { allowOperation } from "../../server/rate-limit";
import "server-only";
import { createHash } from "node:crypto";
import { createOpenAiExplanations } from "../../providers/server/ai/openai";
import { explanationFacts } from "../../domain/ai/explanations";
import type { TripPlan } from "../../domain/types";
import { explainTrips } from "./explain-trips";
import { acquireAiSlot } from "./request-guard";
const cache = new Map<
  string,
  { until: number; value: Promise<Record<string, string>> }
>();
export async function appExplanations(
  enabled: boolean,
  plans: TripPlan[],
  locale: "en" | "sq",
) {
  if (!enabled || !plans.length || !serverEnvironment().capabilities.ai)
    return {};
  const facts = explanationFacts(plans, locale);
  if (!facts.length) return {};
  const key = createHash("sha256")
    .update(JSON.stringify([serverEnvironment().ai, locale, facts]))
    .digest("hex");
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  if (!(await allowOperation("ai-explanations"))) return {};
  const release = acquireAiSlot();
  if (!release) return {};
  const value = explainTrips(
    true,
    plans,
    locale,
    createOpenAiExplanations(),
  ).finally(release);
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, { until: Date.now() + 600000, value });
  return value;
}
