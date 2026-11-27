import { allowOperation, rateLimitHeaders } from "@/server/rate-limit";
import { createOpenAiIntent } from "@/providers/server/ai/openai";
import { createLocationSearch } from "@/providers/server/location-search";
import { referenceToday } from "@/services/current-request";
import { parseIntentRequest } from "@/services/ai/intent-request";
import { acquireAiSlot, readAiBody } from "@/services/ai/request-guard";
import { serverEnvironment } from "@/providers/server/environment";
import { reportDiagnostic } from "@/server/observability";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const body = await readAiBody(request);
  if (!body)
    return Response.json({ status: "unavailable" }, { status: 400, headers });
  if (!serverEnvironment().ai.enabled)
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  if (!(await allowOperation("ai-intent")))
    return Response.json(
      { status: "unavailable" },
      { status: 429, headers: rateLimitHeaders },
    );
  const release = acquireAiSlot();
  if (!release)
    return Response.json({ status: "unavailable" }, { status: 429, headers });
  try {
    const result = await parseIntentRequest(
      body,
      referenceToday(),
      createOpenAiIntent(),
      createLocationSearch(),
    );
    reportDiagnostic({
      level: "debug",
      component: "ai",
      operation: "ai-resolution",
      status: result.status,
      ...("request" in result
        ? { currency: result.request.budget.currency }
        : {}),
    });
    return Response.json(result, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  } finally {
    release();
  }
}
