"use client";
import { useState } from "react";
import type { FlightHandoff, FareAgeBucket } from "@/domain/affiliate";
import { openFlightSearch } from "../travel/open-flight-search";

export function MonthFlightCheck({
  route,
  fareAge,
}: {
  route: FlightHandoff;
  fareAge: FareAgeBucket;
}) {
  const [state, setState] = useState<"ready" | "pending" | "failed">("ready");
  async function check() {
    setState("pending");
    try {
      const result = await openFlightSearch(route, "results", fareAge);
      setState(result === "available" ? "ready" : "failed");
    } catch {
      setState("failed");
    }
  }
  return (
    <div>
      <button
        type="button"
        className="text-button"
        disabled={state === "pending"}
        onClick={check}
      >
        {state === "pending" ? "Opening Aviasales…" : "Check on Aviasales ↗"}
      </button>
      {state === "failed" && (
        <p className="small muted" role="status">
          The booking link is unavailable. Try again later.
        </p>
      )}
    </div>
  );
}
