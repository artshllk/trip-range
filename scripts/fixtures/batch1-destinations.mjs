import "./guard.mjs";
/** Explicit local-only SYNTHETIC fares and metadata; never imported by runtime or CI. */
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
if (
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.GOEKSPLO_BATCH1_FIXTURE !== "1" ||
  !process.env.BATCH1_LOG
)
  throw Error("Batch fixture requires explicit local opt-in");
const previous = globalThis.fetch;
const log = (event) =>
  appendFileSync(
    process.env.BATCH1_LOG,
    JSON.stringify({ ...event, evidence: "synthetic" }) + "\n",
  );
const cities = [
  ["BCN", "BCN", "BCN"],
  ["LON", "STN", "LCY"],
  ["SIN", "SIN", "XSP"],
  ["BKK", "DMK", "BKK"],
  ["YVR", "YVR", "CXH"],
];
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
    if (process.env.BATCH1_MODE === "failure")
      return new Response(null, { status: 503 });
    const row = (city, airport, price, day = 20) => ({
      origin,
      origin_airport: origin,
      destination: city,
      destination_airport: airport,
      price,
      departure_at: `${month}-${day}`,
      return_at: `${month}-${day + 2}`,
      found_at: new Date().toISOString(),
      airline: "QA",
    });
    const data =
      process.env.BATCH1_MODE === "empty"
        ? []
        : cities
            .filter((c) => !target || c.includes(target))
            .flatMap(([city, chosen, other]) => [
              row(city, other, 50, 18),
              row(city, chosen, 200),
              row(city, other, 260),
            ]);
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
      code === "BCN"
        ? [
            {
              type: "city",
              code: "BCN",
              name: "Barcelona",
              country_code: "ES",
              country_name: "Spain",
              coordinates: { lat: 41.387917, lon: 2.1699187 },
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
            partner_url: "https://avs.io/Batch1SyntheticQA",
          },
        ],
      },
    });
  }
  return previous(input, options);
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
