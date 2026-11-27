import { readTravelIntent, validIntentText } from "../../domain/ai/intent";
import { readDraftQuery } from "../../domain/ai/validation";
import type {
  LocationSearch,
  TravelIntentProvider,
} from "../../providers/contracts";
import { resolveTravelIntent } from "./resolve-intent";
import { isLocale } from "../../i18n/config";
export async function parseIntentRequest(
  body: unknown,
  today: string,
  provider: TravelIntentProvider,
  locations: LocationSearch,
) {
  if (!body || typeof body !== "object")
    return { status: "unavailable" as const };
  const b = body as Record<string, unknown>;
  const draft = readDraftQuery(b.draft);
  if (
    !draft ||
    !validIntentText(b.text) ||
    typeof b.locale !== "string" ||
    !isLocale(b.locale) ||
    Object.keys(b).some((k) => !["draft", "text", "locale"].includes(k))
  )
    return { status: "unavailable" as const };
  try {
    const output = await provider.parse({
      text: b.text,
      locale: b.locale,
    });
    if (output.status !== "available")
      return { status: "unavailable" as const };
    const intent = readTravelIntent(output.intent);
    if (!intent) return { status: "unavailable" as const };
    return await resolveTravelIntent(intent, draft, b.text, today, locations);
  } catch {
    return { status: "unavailable" as const };
  }
}
