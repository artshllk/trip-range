import "./guard.mjs";
/**
 * Local QA only. Mirrors the real Aviasales Data API split, verified 2026-10-27
 * (tests/aviasales-contract.test.ts): prices_for_dates rows never carry found_at;
 * found_at and actual come from get_latest_prices. Fixtures may declare found_at on
 * their rows for convenience; call splitAviasalesApi() at the END of a fixture so the
 * app sees the real shape. Idempotent; each fixture stub is called once per query.
 */
export function splitAviasalesApi() {
  const stub = globalThis.fetch;
  if (stub.aviasalesApiSplit) return;
  const slots = new Map();
  const slot = (key) => {
    if (!slots.has(key)) {
      let resolve;
      const rows = new Promise((r) => (resolve = r));
      slots.set(key, { rows, resolve });
    }
    return slots.get(key);
  };
  const keyOf = (q, monthParam) =>
    [
      q.get("origin"),
      q.get("destination") ?? "",
      (q.get(monthParam) ?? "").slice(0, 7),
    ].join("|");
  const split = async (input, options) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname !== "api.travelpayouts.com") return stub(input, options);
    if (url.pathname.endsWith("/get_latest_prices")) {
      const rows = await Promise.race([
        slot(keyOf(url.searchParams, "beginning_of_period")).rows,
        new Promise((r) => setTimeout(() => r([]), 3000)),
      ]);
      const data = rows
        .filter((r) => r && typeof r === "object" && "found_at" in r)
        .map((r) => ({
          origin: r.origin,
          destination: r.destination,
          depart_date: r.departure_at,
          return_date: r.return_at,
          value: r.price,
          found_at: r.found_at,
          actual: true,
          trip_class: 0,
        }));
      return Response.json({
        success: true,
        currency: url.searchParams.get("currency"),
        data,
      });
    }
    if (!url.pathname.endsWith("/prices_for_dates"))
      return stub(input, options);
    const key = keyOf(url.searchParams, "departure_at");
    let response;
    try {
      response = await stub(input, options);
    } catch (error) {
      slot(key).resolve([]);
      throw error;
    }
    let body;
    try {
      body = await response.clone().json();
    } catch {
      slot(key).resolve([]);
      return response;
    }
    const data = Array.isArray(body?.data) ? body.data : undefined;
    slot(key).resolve(data ?? []);
    if (!data) return response;
    return new Response(
      JSON.stringify({
        ...body,
        data: data.map((row) => {
          if (!row || typeof row !== "object") return row;
          const { found_at, observed_at, ...rest } = row;
          void found_at;
          void observed_at;
          return rest;
        }),
      }),
      { status: response.status, headers: response.headers },
    );
  };
  split.aviasalesApiSplit = true;
  globalThis.fetch = split;
}
