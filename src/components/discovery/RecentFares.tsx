import { localePath } from "@/i18n/routing";
import { localized } from "@/i18n/localized";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { recentObservations } from "@/server/fare-store";
import { flightDestinations } from "@/catalogue/flight-destinations";
import { locations } from "@/catalogue/locations";
import { requestQuery } from "@/domain/request";
import { isCalendarDate, nightsBetween } from "@/domain/dates";
import { isCurrency } from "@/domain/money/currency";
import { quoteMoney, AVIASALES_DATA_PROVIDER } from "@/domain/money/provenance";
import type { TripRequest } from "@/domain/types";
import { formatMoney, type Locale } from "@/i18n/config";
import { recentFaresCopy } from "@/i18n/recent-fares";
import { FareFreshness } from "../travel/FareFreshness";
import { launchOriginCodes } from "@/domain/market/primary-origin";

const MIN_SHOWN = 3;
const cachedRecent = unstable_cache(
  (origin: string, currency: string) =>
    recentObservations(origin, currency, 12),
  ["recent-fares-v1"],
  { revalidate: 300 },
);

/** Real recent observations as proof. Fewer than three qualifying: the honest empty variant. */
export async function RecentFares({
  request,
  locale,
}: {
  request: TripRequest;
  locale: Locale;
}) {
  const copy = localized(recentFaresCopy, locale);
  const origin = request.origin;
  const code =
    origin?.airportIata ?? origin?.cityCode ?? origin?.iataCodes?.[0];
  const currency = request.budget.currency;
  const rows =
    code && isCurrency(currency) ? await cachedRecent(code, currency) : [];
  const items = rows
    .map((row) => ({
      row,
      destination: flightDestinations.find((d) =>
        d.iataCodes?.includes(row.destination),
      ),
      nights:
        isCalendarDate(row.departureDate) && isCalendarDate(row.returnDate)
          ? nightsBetween(row.departureDate, row.returnDate)
          : 0,
    }))
    .filter((i) => i.destination && i.nights >= 1 && i.nights <= 14)
    .slice(0, MIN_SHOWN);
  const originName = origin?.name ?? "";
  if (!code || items.length < MIN_SHOWN) {
    const starts = locations.filter((l) =>
      launchOriginCodes.some(
        (code) => l.iataCodes?.includes(code) || l.cityCode === code,
      ),
    );
    return (
      <div className="recent-fares recent-fares-empty">
        {code ? <p>{copy.empty.replace("{origin}", originName)}</p> : null}
        <p className="eyebrow">{copy.emptyOrigins}</p>
        <div className="recent-fares-origins">
          {starts.map((l) => (
            <Link
              key={l.id}
              href={localePath(locale, `/?origin=${l.id}#search`)}
            >
              {l.name}
            </Link>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="recent-fares">
      <h3>{copy.heading.replace("{origin}", originName)}</h3>
      <p className="small muted">{copy.intro}</p>
      <ul>
        {items.map(({ row, destination, nights }) => {
          const fare = quoteMoney({
            amount: { cents: row.priceMinor, currency },
            confidence: "estimate",
            providerId: AVIASALES_DATA_PROVIDER,
            observedAt: row.fareObservedAt,
            fetchedAt: row.fetchedAt,
            demo: false,
          });
          const trip: TripRequest = {
            ...request,
            when: "custom",
            dates: {
              startDate: row.departureDate,
              endDate: row.returnDate,
              flexibleDays: 0,
            },
            nights,
          };
          return (
            <li key={row.destination}>
              <Link
                href={localePath(
                  locale,
                  `/plan/trips/${encodeURIComponent(destination!.id)}?${requestQuery(trip)}`,
                )}
              >
                <strong>{destination!.name[locale]}</strong>
                <span>
                  {copy.dates
                    .replace("{start}", row.departureDate)
                    .replace("{end}", row.returnDate)}
                </span>
              </Link>
              <p>
                <b>{formatMoney(fare, locale)}</b> {copy.perTraveller}
              </p>
              <FareFreshness
                money={fare}
                locale={locale}
                handoffHref={localePath(
                  locale,
                  `/plan/trips/${encodeURIComponent(destination!.id)}?${requestQuery(trip)}#flight-handoff`,
                )}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
