import "./guard.mjs";
/** Explicit local-only synthetic evidence; no live fares, editorial research or hotel inventory. */
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
if (
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.GOEKSPLO_DIRECT_CITY_FIXTURE !== "1" ||
  !process.env.DIRECT_CITY_LOG
)
  throw Error("Direct city fixture requires explicit local opt-in");
const previous = globalThis.fetch;
const log = (event) =>
  appendFileSync(process.env.DIRECT_CITY_LOG, JSON.stringify(event) + "\n");
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (
    url.hostname === "api.travelpayouts.com" &&
    url.pathname.endsWith("prices_for_dates")
  ) {
    const origin = url.searchParams.get("origin"),
      target = url.searchParams.get("destination"),
      month = url.searchParams.get("departure_at");
    log({
      operation: "discovery",
      origin,
      target,
      month,
      evidence: "synthetic",
    });
    const mode = process.env.DIRECT_CITY_MODE;
    if (mode === "failure") return new Response(null, { status: 503 });
    const row = (airport, price, day = "20") => ({
      origin,
      origin_airport: origin,
      destination: "NYC",
      destination_airport: airport,
      price,
      departure_at: `${month}-${day}`,
      return_at: `${month}-${Number(day) + 2}`,
      found_at: new Date().toISOString(),
      airline: "QA",
    });
    // Cheaper JFK reference must lose to exact EWR. LGA is also exact, but more costly.
    const data =
      mode === "empty"
        ? []
        : [row("JFK", 50, "18"), row("EWR", 200), row("LGA", 260)];
    return Response.json({
      success: true,
      currency: url.searchParams.get("currency"),
      data,
    });
  }
  if (url.hostname === "autocomplete.travelpayouts.com") {
    log({
      operation: "metadata",
      code: url.searchParams.get("term"),
      evidence: "synthetic",
    });
    return Response.json([]);
  }
  if (
    url.hostname === "api.travelpayouts.com" &&
    url.pathname === "/links/v1/create"
  ) {
    const body = JSON.parse(options.body);
    log({
      operation: "affiliate",
      path: new URL(body.links[0].url).pathname,
      placement: body.links[0].sub_id,
      evidence: "synthetic",
    });
    return Response.json({
      code: "success",
      status: 200,
      result: {
        links: [
          {
            url: body.links[0].url,
            code: "success",
            partner_url: "https://avs.io/DirectCityQA",
          },
        ],
      },
    });
  }
  return previous(input, options);
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
