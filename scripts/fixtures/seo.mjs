import "./guard.mjs";
/** Local synthetic coverage for SEO acceptance. Never imported by application code. */
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
if (
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.GOEKSPLO_SEO_FIXTURE !== "1"
)
  throw Error("SEO fixture requires explicit local opt-in");
const realFetch = globalThis.fetch;
const record = (operation) => {
  if (process.env.SEO_FIXTURE_LOG)
    appendFileSync(
      process.env.SEO_FIXTURE_LOG,
      JSON.stringify({ operation }) + "\n",
    );
};
const day = (date) => date.toISOString().slice(0, 10);
const start = new Date();
start.setUTCHours(12, 0, 0, 0);
start.setUTCDate(start.getUTCDate() + ((6 - start.getUTCDay() + 7) % 7));
const end = new Date(start);
end.setUTCDate(end.getUTCDate() + 2);
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname === "api.openai.com") {
    record("forbidden-ai");
    throw Error("SEO must never request AI");
  }
  if (
    url.hostname === "api.travelpayouts.com" &&
    url.pathname.endsWith("prices_for_dates")
  ) {
    record("flight-discovery");
    if (process.env.GOEKSPLO_SEO_FAILURE === "1")
      return new Response(null, { status: 503 });
    return Response.json({
      success: true,
      currency: url.searchParams.get("currency"),
      data: ["VIE", "BUD", "ROM", "MIL"].map((destination) => ({
        origin: url.searchParams.get("origin"),
        destination,
        price: 10,
        departure_at: day(start),
        return_at: day(end),
        found_at: new Date().toISOString(),
      })),
    });
  }
  if (
    url.hostname === "api.travelpayouts.com" &&
    url.pathname === "/links/v1/create"
  ) {
    record("unexpected-affiliate");
    return new Response(null, { status: 503 });
  }
  if (url.hostname === "autocomplete.travelpayouts.com")
    return Response.json([]);
  if (url.hostname === "commons.wikimedia.org")
    return Response.json({ query: { pages: [] } });
  if (url.hostname === "api.pexels.com") return Response.json({ photos: [] });
  return realFetch(input, options);
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
