"use client";
import { openFlightSearch } from "./open-flight-search";
import { localePath } from "@/i18n/routing";
import { localized } from "@/i18n/localized";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TripPlan } from "@/domain/types";
import type { Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";
import { handoffCopy } from "@/i18n/handoff";
import {
  type FareAgeBucket,
  type FlightHandoff,
  flightConfidence,
  flightHandoff,
  handoffFareAge,
  type AffiliatePlacement,
} from "@/domain/affiliate";

/** Views are sent from the page. The flight-link endpoint records clicks. */
function recordView(route: FlightHandoff, fareAge: FareAgeBucket) {
  const { originCode, destinationCode } = route;
  try {
    navigator.sendBeacon(
      "/api/affiliate/event",
      new Blob(
        [
          JSON.stringify({
            event: "cta_view",
            originCode,
            destinationCode,
            fareAge,
          }),
        ],
        {
          type: "application/json",
        },
      ),
    );
  } catch {}
}

export function FlightAffiliateCTA({
  plan,
  placement,
  primary = placement === "trip",
  locale,
  t,
}: {
  plan: TripPlan;
  placement: AffiliatePlacement;
  /** Styled as the main action. Leaving context and disclosure show either way. */
  primary?: boolean;
  locale: Locale;
  t: Dictionary;
}) {
  const [state, setState] = useState<
    "idle" | "pending" | "failed" | "unsupported"
  >("idle");
  const route = flightHandoff(plan);
  // Server components can re-create the same plan object on a re-render.
  const itinerary = route ? JSON.stringify(route) : null;
  const viewed = useRef<{ itinerary: string; fareAge: FareAgeBucket } | null>(
    null,
  );

  useEffect(() => {
    if (!route || !itinerary || viewed.current?.itinerary === itinerary) return;
    const fareAge = handoffFareAge(
      plan,
      Math.floor(Date.now() / 60_000) * 60_000,
      placement,
    );
    viewed.current = { itinerary, fareAge };
    recordView(route, fareAge);
  }, [itinerary, route, placement, plan]);

  useEffect(() => {
    // A page restored from the back/forward cache can still have a disabled button.
    function restoreButton(event: PageTransitionEvent) {
      if (event.persisted) setState("idle");
    }
    window.addEventListener("pageshow", restoreButton);
    return () => window.removeEventListener("pageshow", restoreButton);
  }, []);

  if (!route || state === "unsupported")
    return placement === "trip" ? (
      <p className="small muted">{t.flightRouteUnsupported}</p>
    ) : null;
  const copy = localized(handoffCopy, locale);
  async function open() {
    if (!route || state === "pending") return;
    setState("pending");
    // A click belongs to the fare-age band of the view that offered this button.
    const fareAge =
      viewed.current && viewed.current.itinerary === itinerary
        ? viewed.current.fareAge
        : handoffFareAge(
            plan,
            Math.floor(Date.now() / 60_000) * 60_000,
            placement,
          );
    try {
      if ((await openFlightSearch(route, placement, fareAge)) === "unsupported")
        setState("unsupported");
    } catch {
      // No fallback to an unattributed partner URL: the traveller retries or stays.
      setState("failed");
    }
  }
  return (
    <div className="affiliate-action stack">
      <p className="affiliate-leaving">
        {copy.leaving.replaceAll("{partner}", "Aviasales")}
      </p>
      <p className="affiliate-disclosure">
        {copy.disclosure}{" "}
        <Link href={localePath(locale, `/affiliate-disclosure`)}>
          {copy.disclosureLink}
        </Link>
      </p>
      <button
        className={primary ? "button ember" : "text-button"}
        disabled={state === "pending"}
        onClick={open}
      >
        {state === "pending"
          ? t.preparingFlightSearch
          : state === "failed"
            ? t.retryFlightSearch
            : flightConfidence(plan) === "unavailable"
              ? placement === "trip"
                ? t.checkCurrentFlightsProvider
                : t.checkCurrentFlights
              : placement === "trip"
                ? t.checkFlightsProvider
                : t.checkFlights}{" "}
        →
      </button>
      {state === "failed" ? (
        <p className="small muted" role="status">
          {t.flightLinkUnavailable}
        </p>
      ) : null}
    </div>
  );
}
