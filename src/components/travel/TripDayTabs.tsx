"use client";

import { useId, useRef, useState, type ReactNode } from "react";

/** Only presentation slots cross this boundary; reviewed records remain on the server. */
export function TripDayTabs({
  days,
  label,
}: {
  days: { label: string; context: string; date?: string; content: ReactNode }[];
  label: string;
}) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="trip-day-tabs">
      <div
        role="tablist"
        aria-label={label}
        className="trip-day-tablist"
        onKeyDown={(event) => {
          let next: number;
          if (event.key === "ArrowRight") next = (selected + 1) % days.length;
          else if (event.key === "ArrowLeft")
            next = (selected + days.length - 1) % days.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = days.length - 1;
          else return;
          event.preventDefault();
          setSelected(next);
          buttons.current[next]?.focus();
        }}
      >
        {days.map((day, i) => (
          <button
            key={day.label}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-controls={`${id}-panel-${i}`}
            aria-selected={selected === i}
            tabIndex={selected === i ? 0 : -1}
            ref={(element) => {
              buttons.current[i] = element;
            }}
            onClick={() => setSelected(i)}
          >
            <b>{day.label}</b>
            <span>
              {day.date ? (
                <>
                  {day.date}
                  <span aria-hidden="true"> · </span>
                </>
              ) : null}
              {day.context}
            </span>
          </button>
        ))}
      </div>
      {days.map((day, i) => (
        <div
          key={day.label}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={selected !== i}
          tabIndex={0}
          className="trip-day-panel"
        >
          {day.content}
        </div>
      ))}
    </div>
  );
}
