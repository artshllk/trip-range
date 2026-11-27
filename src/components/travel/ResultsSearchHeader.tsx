"use client";
import { requestBudget } from "../../domain/money/provenance";
import type { TripRequest } from "@/domain/types";
import { locationName } from "@/catalogue/locations";
import { formatMoney, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { resultDateRange, resultMonth } from "@/i18n/result-dates";
import { SearchBar } from "./SearchBar";

export function ResultsSearchHeader({
  request,
  locale,
  t,
  today,
  onEdit,
}: {
  request: TripRequest;
  locale: Locale;
  t: Dictionary;
  today: string;
  onEdit: () => void;
}) {
  const dates =
    request.dates.mode === "weekends"
      ? `${t.anyWeekend} ${resultMonth(request.dates.month ?? today.slice(0, 7), locale)}`
      : `${resultDateRange(request.dates.startDate, request.dates.endDate, locale, today.slice(0, 4))}${request.dates.flexibleDays ? " ±3" : ""}`;
  return (
    <div className="results-search-band search-results-bar">
      <div className="shell results-search-desktop">
        <SearchBar
          initial={request}
          locale={locale}
          t={t}
          today={today}
          results
        />
      </div>
      <div className="shell results-search-mobile">
        <button
          className="results-mobile-summary"
          onClick={onEdit}
          aria-label={t.editSearch}
          aria-haspopup="dialog"
        >
          <span>
            <strong>
              {request.origin?.name ?? locationName(request.originId)} →{" "}
              {request.destination?.name ?? t.anywhere}
            </strong>
            <span>
              {formatMoney(requestBudget(request), locale)} · {dates} ·{" "}
              {request.party.adults + request.party.children} {t.people}
            </span>
          </span>
          <b>Edit</b>
        </button>
      </div>
    </div>
  );
}
