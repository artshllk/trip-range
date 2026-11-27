import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingSearchUrl } from "../src/domain/booking-search";

const search = {
  city: "Berlin",
  country: "Germany",
  checkIn: "2027-01-19",
  checkOut: "2027-01-21",
};
test("Booking search preserves the city, exact dates and two-person room with no affiliate ID", () => {
  const u = new URL(bookingSearchUrl(search)!);
  assert.equal(
    u.origin + u.pathname,
    "https://www.booking.com/searchresults.html",
  );
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    ss: "Berlin, Germany",
    checkin: "2027-01-19",
    checkout: "2027-01-21",
    group_adults: "2",
    group_children: "0",
    no_rooms: "1",
    selected_currency: "EUR",
    lang: "en-gb",
  });
});
test("Booking search encodes worldwide names and adds only a configured numeric affiliate ID", () => {
  const u = new URL(
    bookingSearchUrl(
      { ...search, city: "İstanbul & Kadıköy", country: "Türkiye" },
      "12345",
    )!,
  );
  assert.equal(u.searchParams.get("ss"), "İstanbul & Kadıköy, Türkiye");
  assert.equal(u.searchParams.get("aid"), "12345");
  assert.equal(
    new URL(bookingSearchUrl(search, "bad&aid=1")!).searchParams.has("aid"),
    false,
  );
});
test("Booking search fails closed for invalid dates or incomplete places", () => {
  for (const patch of [
    { checkIn: "2027-02-30" },
    { checkOut: search.checkIn },
    { country: "" },
    { adults: 0 },
  ])
    assert.equal(bookingSearchUrl({ ...search, ...patch }), undefined);
});
