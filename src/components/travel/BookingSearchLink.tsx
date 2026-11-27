import {
  bookingSearchUrl,
  type BookingSearch,
} from "../../domain/booking-search";

import { stayDateLabel } from "../../domain/dates";

export function BookingSearchLink(props: BookingSearch) {
  const href = bookingSearchUrl(props);
  if (!href) return <p>Choose valid stay dates to check room prices.</p>;
  return (
    <div className="room-search">
      <a
        className="button ember"
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
      >
        Check room prices for {stayDateLabel(props.checkIn, props.checkOut)} ↗
      </a>
      <p className="small muted">
        Booking.com · {props.city} · {props.checkIn}–{props.checkOut} ·{" "}
        {props.adults ?? 2} adults
        {props.childCount
          ? `, ${props.childCount} children (add their ages on Booking.com)`
          : ""}{" "}
        · 1 room. Opens a new tab; check availability, terms and the final price
        there.
      </p>
    </div>
  );
}
