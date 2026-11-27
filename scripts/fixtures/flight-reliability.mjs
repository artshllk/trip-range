import "./guard.mjs";
/** Explicit offline production-adapter fixture. No live inventory or credentials. */
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
if (
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.GOEKSPLO_FLIGHT_RELIABILITY_FIXTURE !== "1" ||
  !process.env.FLIGHT_RELIABILITY_LOG
)
  throw Error("Flight reliability fixture requires explicit local opt-in");
const previous = globalThis.fetch;
const log = (event) =>
  appendFileSync(
    process.env.FLIGHT_RELIABILITY_LOG,
    JSON.stringify(event) + "\n",
  );
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
    log({ operation: "discovery", origin, target, month });
    if (process.env.FLIGHT_RELIABILITY_MODE === "failure" || origin === "SKP")
      return new Response(null, { status: 503 });
    const row = (destination, airport, price = 100) => ({
      origin,
      origin_airport: origin === "LON" ? "LHR" : origin,
      destination,
      destination_airport: airport,
      price,
      departure_at: `${month}-${month === "2027-01" ? "24" : month === "2027-03" ? "21" : "20"}`,
      return_at: `${month}-${month === "2027-01" ? "26" : month === "2027-03" ? "23" : "22"}`,
      found_at: new Date().toISOString(),
      airline: "QA",
    });
    let data = [];
    if (process.env.FLIGHT_RELIABILITY_MODE !== "empty" && origin !== "TIA") {
      if (target)
        data = [
          row(
            target,
            target === "PAR" ? "CDG" : target === "OSA" ? "KIX" : target,
          ),
        ];
      else
        data =
          month === "2026-12"
            ? [row("ABC", "ABC")]
            : month === "2027-02"
              ? []
              : [row("PAR", "CDG"), row("OSA", "KIX", 200)];
    }
    return Response.json({
      success: true,
      currency: url.searchParams.get("currency"),
      data,
    });
  }
  if (url.hostname === "autocomplete.travelpayouts.com") {
    const code = url.searchParams.get("term");
    log({ operation: "metadata", code });
    return Response.json(
      code === "ABC"
        ? [
            {
              code,
              type: "city",
              name: "Synthetic City",
              country_code: "FR",
              country_name: "France",
            },
          ]
        : code === "OSA"
          ? [
              {
                code,
                type: "city",
                name: "Osaka",
                country_code: "JP",
                country_name: "Japan",
              },
            ]
          : [],
    );
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
    });
    return Response.json({
      code: "success",
      status: 200,
      result: {
        links: [
          {
            url: body.links[0].url,
            code: "success",
            partner_url: "https://avs.io/ReliabilityQA",
          },
        ],
      },
    });
  }
  return previous(input, options);
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
