import "./guard.mjs";
/** Explicit local synthetic QA. Never imported by production application code. */
import "./worldwide.mjs";
import { appendFileSync } from "node:fs";
import { splitAviasalesApi } from "./api-split.mjs";
if (process.env.GOEKSPLO_PRICING_FIXTURE !== "1")
  throw Error("Pricing fixture requires explicit local opt-in");
const previousFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  // Detail restoration requires exact provider identity, even when the fare is absent.
  if (
    url.hostname === "autocomplete.travelpayouts.com" &&
    url.searchParams.get("term") === "WAW"
  )
    return Response.json([
      {
        type: "city",
        code: "WAW",
        name: "Warsaw",
        country_code: "PL",
        country_name: "Poland",
      },
    ]);
  if (
    url.hostname === "api.travelpayouts.com" &&
    url.pathname.endsWith("prices_for_dates")
  ) {
    const origin = url.searchParams.get("origin"),
      destination = url.searchParams.get("destination");
    const row = (code, departure_at, return_at, price) => ({
      origin,
      destination: code,
      departure_at,
      return_at,
      price,
      found_at: new Date().toISOString(),
    });
    const month = url.searchParams.get("departure_at");
    const data =
      origin === "ZRH" && month === "2026-12"
        ? ["VIE", "BUD", "ROM"].map((code) =>
            row(code, "2026-12-18", "2026-12-21", 50),
          )
        : origin === "ZRH" && month === "2026-11"
          ? [
              row("VIE", "2026-11-20", "2026-11-23", 50),
              row("BUD", "2026-11-12", "2026-11-15", 40),
              {
                ...row("ROM", "2026-11-20", "2026-11-23", 40),
                found_at: "2000-01-01T00:00:00Z",
              },
            ]
          : origin === "ZRH"
            ? ["VIE", "BUD", "ROM", "MIL"].map((code) =>
                row(code, "2026-11-12", "2026-11-15", 10),
              )
            : destination === "WAW"
              ? []
              : destination === "ROM"
                ? [row("ROM", "2026-11-12", "2026-11-15", 92)]
                : destination === "BER"
                  ? [row("BER", "2026-11-21", "2026-11-23", 92)]
                  : destination === "VIE"
                    ? [
                        row(
                          "VIE",
                          "2026-11-20",
                          "2026-11-23",
                          origin === "SKP" ? 80 : 180,
                        ),
                      ]
                    : [];
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
    // Record only the public destination search path and placement; never credentials or partner URLs.
    if (process.env.PRICING_FIXTURE_LOG)
      appendFileSync(
        process.env.PRICING_FIXTURE_LOG,
        JSON.stringify({
          operation: "affiliate",
          destinationPath: new URL(body.links[0].url).pathname,
          placement: body.links[0].sub_id,
        }) + "\n",
      );
    return Response.json({
      code: "success",
      status: 200,
      result: {
        links: [
          {
            url: body.links[0].url,
            code: "success",
            partner_url: "https://avs.io/PricingQA",
          },
        ],
      },
    });
  }
  return previousFetch(input, options);
};
// Real API shape: found_at is served from get_latest_prices, never prices_for_dates.
splitAviasalesApi();
