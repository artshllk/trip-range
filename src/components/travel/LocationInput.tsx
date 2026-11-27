"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { TravelLocation } from "@/domain/types";
import type { Dictionary } from "@/i18n/dictionaries";
import { readLocation } from "@/domain/locations";
export function LocationInput({
  value,
  onChange,
  origin,
  t,
  onAnywhere,
}: {
  value?: TravelLocation;
  onChange: (location?: TravelLocation) => void;
  origin: boolean;
  t: Dictionary;
  onAnywhere: () => void;
}) {
  const [text, setText] = useState(value?.name ?? "");
  const [found, setFound] = useState<TravelLocation[]>([]);
  const [status, setStatus] = useState("idle");
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  function showOptions() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
  }
  function hideOptions() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 180);
  }
  useEffect(() => {
    const controller = new AbortController();
    if (text.trim().length < 2 || text === value?.name) return;
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(
          `/api/locations?q=${encodeURIComponent(text.trim())}`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(6000),
            ]),
          },
        );
        if (!res.ok) throw Error();
        const body = await res.json();
        const results = Array.isArray(body.locations)
          ? body.locations
              .flatMap((v: unknown) => {
                const l = readLocation(v);
                return l ? [l] : [];
              })
              .slice(0, 8)
          : [];
        if (controller.signal.aborted) return;
        setFound(results);
        setStatus(body.status === "available" ? "ready" : "error");
        setActive(-1);
      } catch {
        if (!controller.signal.aborted) {
          setFound([]);
          setStatus("error");
        }
      }
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, value?.name]);
  useEffect(() => {
    function outside(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) hideOptions();
    }
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);
  useEffect(() => {
    if (active >= 0 && open)
      root.current
        ?.querySelector(`[aria-selected="true"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  function select(location: TravelLocation) {
    onChange(location);
    setText(location.name);
    hideOptions();
    setActive(-1);
  }
  return (
    <div ref={root} className="location-input stack">
      {!origin ? (
        <button
          type="button"
          className="pill"
          onClick={() => {
            onAnywhere();
            setText("");
            hideOptions();
          }}
        >
          {t.anywhere}
        </button>
      ) : null}
      <label htmlFor={id}>{t.searchLocation}</label>
      <input
        id={id}
        autoFocus
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !closing && found.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={
          active >= 0 && open && !closing ? `${id}-${active}` : undefined
        }
        aria-describedby={`${id}-help`}
        value={text}
        placeholder={t.locationHint}
        onFocus={() => {
          if (found.length) showOptions();
        }}
        onChange={(e) => {
          setText(e.target.value);
          onChange(undefined);
          setFound([]);
          setStatus("idle");
          showOptions();
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open && !closing) {
            e.preventDefault();
            e.stopPropagation();
            hideOptions();
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            showOptions();
            setActive((i) =>
              found.length
                ? i < 0
                  ? e.key === "ArrowDown"
                    ? 0
                    : found.length - 1
                  : (i + (e.key === "ArrowDown" ? 1 : -1) + found.length) %
                    found.length
                : -1,
            );
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (open && !closing && active >= 0 && found[active])
              select(found[active]);
          }
        }}
      />
      <p id={`${id}-help`} className="small muted" role="status">
        {value?.type === "country" && origin
          ? t.cityRequired
          : status === "loading"
            ? t.searching
            : status === "error"
              ? t.locationFailure
              : status === "ready" && !found.length
                ? t.noLocations
                : !value && text.length >= 2
                  ? t.chooseSuggestion
                  : t.locationHint}
      </p>
      {open && found.length ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={t.searchLocation}
          className={`location-options ${closing ? "closing" : ""}`}
          aria-hidden={closing}
        >
          {found.map((l, i) => (
            <li
              key={l.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={active === i}
            >
              <button
                type="button"
                tabIndex={-1}
                disabled={closing}
                className={active === i ? "active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(l)}
              >
                <strong>{l.name}</strong>
                <span>
                  {l.countryName.en} ·{" "}
                  {
                    t[
                      l.type === "airport"
                        ? "airportType"
                        : l.type === "country"
                          ? "countryType"
                          : "cityType"
                    ]
                  }{" "}
                  {l.airportIata ?? l.cityCode ?? l.iataCodes?.[0] ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
