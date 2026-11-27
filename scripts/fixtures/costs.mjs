import "./guard.mjs";
/** Explicit local QA only. Real reviewed partial profiles; synthetic flight data. */
import "./pricing.mjs";
import { splitAviasalesApi } from "./api-split.mjs";
if (process.env.GOEKSPLO_COST_FIXTURE !== "1")
  throw Error("Cost fixture requires explicit local opt-in");
const previousFetch = globalThis.fetch;
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
    url.pathname.endsWith("prices_for_dates") &&
    url.searchParams.get("destination") === "MIL"
  ) {
    return Response.json({
      success: true,
      currency: url.searchParams.get("currency"),
      data: [
        {
          origin: url.searchParams.get("origin"),
          destination: "MIL",
          price: 50,
          departure_at: "2026-11-14",
          return_at: "2026-11-16",
          found_at: new Date().toISOString(),
        },
      ],
    });
  }
  return previousFetch(input, options);
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
