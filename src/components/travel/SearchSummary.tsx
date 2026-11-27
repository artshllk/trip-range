"use client";
import { requestBudget } from "../../domain/money/provenance";
import { useState } from "react";
import type { TripRequest } from "@/domain/types";
import { locationName } from "@/catalogue/locations";
import { formatMoney, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { SearchSheet } from "./SearchSheet";
import { ResultDates } from "./ResultDates";
import { resultMonth } from "@/i18n/result-dates";
export function SearchSummary({
  request,
  locale,
  t,
  today,
  variant = "trip",
  onEdit,
}: {
  request: TripRequest;
  locale: Locale;
  t: Dictionary;
  today: string;
  variant?: "trip" | "results";
  onEdit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={
        variant === "results"
          ? "results-search-summary"
          : "trip-search-summary row-between"
      }
    >
      {variant === "results" ? (
        <div className="results-search-description">
          <h1>
            {request.origin?.name ?? locationName(request.originId)} →{" "}
            {request.destination?.name ?? t.anywhere}
          </h1>
          <p className="small muted">
            {request.dates.mode === "weekends" ? (
              `${t.anyWeekend} ${resultMonth(request.dates.month ?? today.slice(0, 7), locale)}`
            ) : (
              <ResultDates
                start={request.dates.startDate}
                end={request.dates.endDate}
                locale={locale}
                currentYear={today.slice(0, 4)}
              />
            )}
            {request.dates.mode !== "weekends" && request.dates.flexibleDays
              ? " ±3"
              : ""}
            {" · "}
            <span className="results-summary-nights">
              {request.nights} {t.nights} ·{" "}
            </span>
            {request.party.adults + request.party.children} {t.people}
            {" · "}
            {formatMoney(requestBudget(request), locale)}
          </p>
        </div>
      ) : (
        <p>
          {request.origin?.name ?? locationName(request.originId)} →{" "}
          {request.destination?.name ?? t.anywhere} ·{" "}
          {request.dates.mode === "weekends" ? (
            `${t.anyWeekend} ${resultMonth(request.dates.month ?? today.slice(0, 7), locale)}`
          ) : (
            <>
              <ResultDates
                start={request.dates.startDate}
                end={request.dates.endDate}
                locale={locale}
                currentYear={today.slice(0, 4)}
              />
              {request.dates.flexibleDays ? " ±3" : ""}
            </>
          )}
          {" · "}
          {request.nights} {t.nights} ·{" "}
          {formatMoney(requestBudget(request), locale)}
        </p>
      )}
      <button className="pill" onClick={onEdit ?? (() => setOpen(true))}>
        {t.editSearch}
      </button>
      {open ? (
        <SearchSheet
          request={request}
          locale={locale}
          t={t}
          today={today}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
