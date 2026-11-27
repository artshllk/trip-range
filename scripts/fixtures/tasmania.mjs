import "./guard.mjs";
/** Explicit local-only SYNTHETIC fares; no credentials or live provider traffic. */
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
const codes = ["HBA", "LST", "DPO", "BWT"];
const mode = process.env.TASMANIA_MODE;
const chosen = process.env.TASMANIA_ENTRY;
if (
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.GOEKSPLO_TASMANIA_FIXTURE !== "1" ||
  !process.env.TASMANIA_LOG ||
  !codes.includes(chosen) ||
  !["normal", "restored", "empty", "failure"].includes(mode)
)
  throw Error("Tasmania fixture requires explicit local opt-in");
const previous = globalThis.fetch;
const log = (event) =>
  appendFileSync(
    process.env.TASMANIA_LOG,
    JSON.stringify({ ...event, evidence: "synthetic" }) + "\n",
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
    if (mode === "failure") return new Response(null, { status: 503 });
    const data =
      mode === "empty"
        ? []
        : codes
            .flatMap((code) =>
              [18, 20].map((day) => ({
                origin,
                origin_airport: origin,
                destination: code,
                destination_airport: code,
                price: day === 18 ? 10 : code === chosen ? 200 : 260,
                departure_at: `${month}-${day}`,
                return_at: `${month}-${day + 2}`,
                found_at: new Date().toISOString(),
                airline: "QA",
              })),
            )
            .filter(
              (r) =>
                (!target || r.destination === target) &&
                (mode !== "restored" || r.destination === chosen),
            );
    return Response.json({
      success: true,
      currency: url.searchParams.get("currency"),
      data,
    });
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
            partner_url: "https://avs.io/TasmaniaSyntheticQA",
          },
        ],
      },
    });
  }
  if (url.hostname === "autocomplete.travelpayouts.com")
    throw Error("Tasmania must resolve from reviewed local access");
  return previous(input, options);
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
