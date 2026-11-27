import { resultDateLabels } from "../../i18n/result-dates";
import type { Locale } from "../../i18n/config";

export function ResultDates({
  start,
  end,
  locale,
  currentYear,
}: {
  start: string;
  end: string;
  locale: Locale;
  currentYear: string;
}) {
  const labels = resultDateLabels(start, end, locale, currentYear);
  return (
    <span className="result-dates">
      <time dateTime={start}>{labels.start}</time>
      {labels.end ? (
        <>
          –<time dateTime={end}>{labels.end}</time>
        </>
      ) : null}
    </span>
  );
}
