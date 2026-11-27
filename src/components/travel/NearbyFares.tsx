"use client";
import { localized } from "../../i18n/localized";
import Link from "next/link";
import type { NearbyFare } from "../../domain/nearby-fares";
import type { TripRequest } from "../../domain/types";
import { requestQuery } from "../../domain/request";
import {
  quoteMoney,
  AVIASALES_DATA_PROVIDER,
} from "../../domain/money/provenance";
import { formatMoney, type Locale } from "../../i18n/config";
import { nearbyFaresCopy } from "../../i18n/nearby-fares";
import { launchAirports } from "../../providers/nearby-airports";
import { FareFreshness } from "./FareFreshness";

/** No-fare state: the fare side of nearby airports. No transfer cost or time is shown. */
export function NearbyFares({
  fares,
  request,
  tripPath,
  locale,
}: {
  fares: NearbyFare[];
  request: TripRequest;
  tripPath: string;
  locale: Locale;
}) {
  if (!fares.length) return null;
  const copy = localized(nearbyFaresCopy, locale);
  return (
    <section className="nearby-fares stack" aria-label={copy.heading}>
      <h4>{copy.heading}</h4>
      <ul>
        {fares.map((fare) => {
          const money = quoteMoney({
            amount: fare.price,
            confidence: "recent",
            providerId: AVIASALES_DATA_PROVIDER,
            observedAt: fare.foundAt,
            fetchedAt: fare.fetchedAt,
            demo: false,
          });
          // Only airports the planner can depart from get a link.
          const airport = launchAirports[fare.originCode];
          return (
            <li key={fare.originCode}>
              <p>
                <b>
                  {fare.originCode} → {fare.destinationCode}
                </b>{" "}
                · {fare.departureDate} – {fare.returnDate}
              </p>
              <p>
                <b>{formatMoney(money, locale)}</b> {copy.perTraveller}
              </p>
              {/* The page's handoff is for the traveller's own airport, not this one. */}
              <FareFreshness money={money} locale={locale} handoffHref={null} />
              {airport ? (
                <Link
                  href={`${tripPath}?${requestQuery({
                    ...request,
                    departureAirport: fare.originCode,
                  })}`}
                >
                  {copy.planFrom.replace("{airport}", airport.name)}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="small muted">{copy.noTransfer}</p>
    </section>
  );
}
