import { isCalendarDate } from "./dates";
import config from "../config/booking.json";

export type BookingSearch = {
  city: string;
  country: string;
  checkIn: string;
  checkOut: string;
  adults?: number;
  childCount?: number;
};

/** Public city search, never a named hotel or a quoted/available room. */
export function bookingSearchUrl(
  search: BookingSearch,
  affiliateId = config.affiliateId,
): string | undefined {
  const {
    city,
    country,
    checkIn,
    checkOut,
    adults = 2,
    childCount = 0,
  } = search;
  if (
    !city.trim() ||
    !country.trim() ||
    !isCalendarDate(checkIn) ||
    !isCalendarDate(checkOut) ||
    checkOut <= checkIn ||
    !Number.isInteger(adults) ||
    adults < 1 ||
    adults > 30 ||
    !Number.isInteger(childCount) ||
    childCount < 0 ||
    childCount > 9
  )
    return undefined;
  const url = new URL("https://www.booking.com/searchresults.html");
  url.search = new URLSearchParams({
    ss: `${city.trim()}, ${country.trim()}`,
    checkin: checkIn,
    checkout: checkOut,
    group_adults: String(adults),
    group_children: String(childCount),
    no_rooms: "1",
    selected_currency: "EUR",
    lang: "en-gb",
  }).toString();
  if (/^[1-9]\d*$/.test(affiliateId.trim()))
    url.searchParams.set("aid", affiliateId.trim());
  return url.href;
}
