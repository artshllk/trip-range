import type { TripRequest } from "@/domain/types";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { SearchBar } from "./SearchBar";
export function SentencePlanner({
  initial,
  locale,
  t,
  today,
}: {
  initial: TripRequest;
  locale: Locale;
  t: Dictionary;
  today: string;
}) {
  return (
    <div id="search" className="hero-content shell">
      <h1>{t.searchHero}</h1>
      <SearchBar initial={initial} locale={locale} t={t} today={today} home />
    </div>
  );
}
