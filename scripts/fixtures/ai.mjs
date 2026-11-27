import "./guard.mjs";
if (process.env.VERCEL || process.env.VERCEL_ENV) throw Error("Local fixtures are forbidden on deployed environments");
/** Explicit local-only HTTP fixture. Never imported by application code. No real OpenAI calls. */
import { appendFileSync } from "node:fs";
if (process.env.GOEKSPLO_AI_FIXTURE !== "1")
  throw Error("AI fixture requires explicit opt-in");
const originalFetch = globalThis.fetch;
const record = (event) => {
  if (process.env.AI_FIXTURE_LOG)
    appendFileSync(process.env.AI_FIXTURE_LOG, JSON.stringify(event) + "\n");
};
const empty = {
  originQuery: null,
  destinationQuery: null,
  anywhere: false,
  budgetAmount: null,
  currency: null,
  adults: null,
  children: null,
  travellersAmbiguous: false,
  travellerTotal: null,
  dateIntent: null,
  styles: null,
  stayLevel: null,
  nearbyAirports: null,
  luggage: null,
  noFlight: null,
  familyStay: null,
  unsupportedPreferences: [],
};
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname === "api.openai.com") {
    const body = JSON.parse(String(options.body));
    const data = JSON.parse(body.input);
    let value;
    if (body.text.format.name === "trip_explanations") {
      record({
        type: "explanation",
        count: data.facts.length,
        locale: data.locale,
      });
      value = {
        explanations: data.facts.map((f) => ({
          tripId: f.tripId,
          text: f.options[0],
        })),
      };
    } else {
      record({ type: "intent", locale: data.locale });
      const t = data.text;
      const intent = { ...empty };
      if (t.includes("Drenica")) intent.originQuery = "Drenica Airport";
      else if (t.includes("Ignore all previous")) {
        intent.originQuery = "Prishtina";
        intent.budgetAmount = 500;
      } else if (t.includes("Kam 700")) {
        intent.originQuery = "Zurich";
        intent.budgetAmount = 700;
        intent.adults = 2;
        intent.children = 0;
        intent.styles = ["city"];
        intent.dateIntent = {
          type: "next-weekend",
          start: null,
          end: null,
          month: null,
        };
      } else if (t.includes("€600")) {
        intent.originQuery = "Prishtina";
        intent.budgetAmount = 600;
        intent.adults = 2;
        intent.children = 0;
        intent.styles = ["nature", "quiet"];
        intent.dateIntent = {
          type: "next-weekend",
          start: null,
          end: null,
          month: null,
        };
      } else {
        intent.styles = ["nature"];
        intent.nearbyAirports = true;
      }
      if (t.includes("low walking"))
        intent.unsupportedPreferences = ["low-walking"];
      value = intent;
    }
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
    });
  }
  if (url.hostname === "autocomplete.travelpayouts.com")
    return Response.json([]);
  if (url.hostname === "api.travelpayouts.com")
    return Response.json({ success: true, data: [] });
  if (url.hostname === "commons.wikimedia.org")
    return Response.json({ query: { pages: [] } });
  if (url.hostname === "api.pexels.com") return Response.json({ photos: [] });
  return originalFetch(input, options);
};
