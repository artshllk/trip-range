import "./guard.mjs";
/** Explicit offline acceptance fixture. Real adapters/routes consume synthetic provider responses. */
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
if (
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.GOEKSPLO_GATEWAY_FIXTURE !== "1" ||
  !process.env.GATEWAY_FIXTURE_LOG
)
  throw Error("Gateway fixture requires explicit local opt-in");
const base = globalThis.fetch;
const log = (entry) =>
  appendFileSync(process.env.GATEWAY_FIXTURE_LOG, JSON.stringify(entry) + "\n");
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
      destination = url.searchParams.get("destination"),
      month = url.searchParams.get("departure_at");
    log({ operation: "flight-discovery", origin, destination, month });
    const mode = process.env.GOEKSPLO_GATEWAY_MODE;
    if (mode === "failure") return new Response(null, { status: 503 });
    const airport =
      month === "2026-12" ? "ITM" : month === "2027-01" ? undefined : "KIX";
    return Response.json({
      success: true,
      currency: url.searchParams.get("currency"),
      data:
        mode === "empty"
          ? []
          : [
              {
                origin,
                destination: "OSA",
                destination_airport: airport,
                price: 200,
                departure_at: `${month}-20`,
                return_at: `${month}-22`,
                found_at: new Date().toISOString(),
                airline: "QA",
              },
            ],
    });
  }
  if (url.hostname === "autocomplete.travelpayouts.com") {
    log({ operation: "provider-metadata" });
    return Response.json([
      {
        type: "city",
        code: "OSA",
        name: "Osaka",
        country_code: "JP",
        country_name: "Japan",
      },
    ]);
  }
  if (
    url.hostname === "api.travelpayouts.com" &&
    url.pathname === "/links/v1/create"
  ) {
    const body = JSON.parse(options.body);
    log({
      operation: "affiliate",
      destinationPath: new URL(body.links[0].url).pathname,
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
            partner_url: "https://avs.io/GatewayQA",
          },
        ],
      },
    });
  }
  return base(input, options);
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
