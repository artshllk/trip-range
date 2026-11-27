"use client";
import { localePath } from "@/i18n/routing";
import { userInput } from "../../domain/money/provenance";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Ref,
} from "react";
import { useRouter } from "next/navigation";
import type { TripRequest, TravelLocation, TripStyle } from "@/domain/types";
import { locations } from "@/catalogue/locations";
import { requestQuery, parseBudget, requestWithOrigin } from "@/domain/request";
import {
  currencyMetadata,
  supportedCurrencies,
  isCurrency,
  parsePlanningBudget,
  majorUnits,
} from "@/domain/money/currency";
import { useSearchCurrency } from "../layout/SearchPreferences";
import { homeCopy } from "@/i18n/home";
import { resultDateRange, resultMonth } from "@/i18n/result-dates";
import type { IntentResolution } from "@/domain/ai/intent";
import {
  isCalendarDate,
  nightsBetween,
  resolveTravelDates,
  weekendsInMonth,
} from "@/domain/dates";
import { formatMoney, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { LocationInput } from "./LocationInput";
import { SearchEditor } from "./SearchEditor";
import { Stepper } from "./Stepper";
import dynamic from "next/dynamic";
import { useAiEnabled } from "../layout/AiFeature";
const AiSearchPanel = dynamic(() =>
  import("./AiSearchPanel").then((m) => m.AiSearchPanel),
);
import { aiCopy } from "@/i18n/ai";
import { searchArrivalEntry } from "./search-arrival";
export type SearchStyleControl = { toggleStyle: (style: TripStyle) => void };
type Field = "from" | "to" | "dates" | "travelers" | "budget";
export function SearchBar({
  initial,
  locale,
  t,
  today,
  refinements = false,
  embedded = false,
  home = false,
  results = false,
  onSearch,
  onPendingChange,
  filtersOnly = false,
  onDraftChange,
  styleControl,
}: {
  initial: TripRequest;
  locale: Locale;
  t: Dictionary;
  today: string;
  refinements?: boolean;
  embedded?: boolean;
  home?: boolean;
  results?: boolean;
  onSearch?: () => void;
  onPendingChange?: (pending: boolean) => void;
  filtersOnly?: boolean;
  onDraftChange?: (request: TripRequest) => void;
  styleControl?: Ref<SearchStyleControl>;
}) {
  const fieldPanels = home || results;
  const aiId = useId();
  const aiEnabled = useAiEnabled();
  const [review, setReview] =
    useState<IntentResolution["unsupportedPreferences"]>();
  const fieldTrigger = useRef<HTMLButtonElement | null>(null);
  const [draft, setDraft] = useState(initial);
  const preference = useSearchCurrency(
    home ? draft.budget.currency : initial.budget.currency,
  );
  const [editor, setEditor] = useState<Field | null>(null);
  const destinationEdited = useRef(false);
  // Field and results-sheet currency belong to their editing transaction.
  const currency =
    embedded || results || (home && editor)
      ? draft.budget.currency
      : preference.currency;
  const previousOrigin = useRef(initial.originId);
  const [currencyChanged, setCurrencyChanged] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // Keep a header currency choice in the draft before its URL scope changes.
  if (home && !editor && currency !== draft.budget.currency)
    setDraft({ ...draft, budget: { ...draft.budget, currency } });
  useEffect(() => {
    if (!home || !aiOpen || !aiEnabled) return;
    // Submitting temporarily disables the focused button. Escape must still work
    // if the browser returns focus to the document while the request is pending.
    const closeAi = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      setAiOpen(false);
      fieldTrigger.current?.focus();
    };
    document.addEventListener("keydown", closeAi);
    return () => document.removeEventListener("keydown", closeAi);
  }, [home, aiOpen, aiEnabled]);
  const [more, setMore] = useState(filtersOnly);
  const [pending, startTransition] = useTransition();
  const submitted = useRef(false);
  useEffect(() => {
    if (!pending && submitted.current) {
      submitted.current = false;
      onPendingChange?.(false);
      onSearch?.();
    }
  }, [pending, onPendingChange, onSearch]);
  const router = useRouter();
  const origin = draft.origin ?? locations.find((l) => l.id === draft.originId);
  const [invalidTo, setInvalidTo] = useState(false);
  const [budget, setBudget] = useState(majorUnits(initial.budget));
  const [start, setStart] = useState(initial.dates.startDate);
  const [end, setEnd] = useState(initial.dates.endDate);
  const [mode, setMode] = useState(
    initial.dates.mode === "weekends"
      ? "weekends"
      : initial.dates.flexibleDays === 3
        ? "flexible"
        : "exact",
  );
  const [month, setMonth] = useState(initial.dates.month ?? today.slice(0, 7));
  const weekends = useMemo(() => weekendsInMonth(month, today), [month, today]);
  const validDates =
    mode === "weekends"
      ? weekends.length > 0
      : isCalendarDate(start) &&
        isCalendarDate(end) &&
        start >= today &&
        nightsBetween(start, end) >= 1 &&
        nightsBetween(start, end) <= 14;
  const validBudget = !!parsePlanningBudget(budget, currency);
  const valid =
    !!origin &&
    origin.type !== "country" &&
    !invalidTo &&
    validDates &&
    validBudget;
  const request = useCallback((): TripRequest => {
    const dates =
      mode === "weekends"
        ? { ...weekends[0], mode: "weekends" as const, month }
        : {
            startDate: start,
            endDate: end,
            flexibleDays: mode === "flexible" ? 3 : 0,
          };
    return {
      ...draft,
      departureAirport: undefined,
      arrivalEntry: searchArrivalEntry(
        initial,
        draft.destination,
        destinationEdited.current,
      ),
      budget: parseBudget(budget, currency),
      dates,
      nights: nightsBetween(dates.startDate, dates.endDate),
      when:
        mode !== "weekends" &&
        start === draft.dates.startDate &&
        end === draft.dates.endDate
          ? draft.when
          : "custom",
      flexible: dates.flexibleDays === 3,
    };
  }, [budget, currency, draft, mode, start, end, weekends, month, initial]);
  // Optional homepage discovery observes the same validated draft used by Search.
  // No price, provider request or global preference is inferred by this callback.
  useEffect(() => {
    if (onDraftChange && validDates && validBudget && (!home || !editor))
      onDraftChange(request());
  }, [onDraftChange, validDates, validBudget, request, home, editor]);
  useImperativeHandle(
    styleControl,
    () => ({
      toggleStyle(style) {
        setDraft((previous) => ({
          ...previous,
          styles: previous.styles.includes(style)
            ? previous.styles.filter((value) => value !== style)
            : [...previous.styles, style],
        }));
      },
    }),
    [],
  );
  function search() {
    if (!valid || pending || submitted.current) return;
    submitted.current = true;
    onPendingChange?.(true);
    const r = request();
    // Applied currency travels in the URL; never bind it to the old history entry.
    const query = new URLSearchParams(requestQuery(r));
    if (review) {
      query.set("ai", "1");
      if (review.length) query.set("unsupported", review.join(","));
    }
    startTransition(() => {
      router.push(localePath(locale, `/plan/results?${query}`), {
        scroll: true,
      });
    });
  }
  function choose(location: TravelLocation | undefined, from: boolean) {
    if (from) {
      if (location) {
        const next = requestWithOrigin(
          {
            ...draft,
            budget: parseBudget(budget, currency),
            originId: previousOrigin.current,
          },
          location,
        );
        previousOrigin.current = location.id;
        setCurrencyChanged(next.budget.currency !== currency);
        setDraft(next);
        if (!embedded && !fieldPanels)
          preference.chooseCurrency?.(next.budget.currency);
      } else setDraft({ ...draft, origin: undefined, originId: "" });
    } else {
      destinationEdited.current = true;
      setDraft({ ...draft, destination: location });
      setInvalidTo(!location);
    }
  }
  const snapshot = useRef<{
    draft: TripRequest;
    budget: string;
    start: string;
    end: string;
    mode: string;
    month: string;
    invalidTo: boolean;
    destinationEdited: boolean;
    currencyChanged: boolean;
  } | null>(null);
  function cancelEditor() {
    const saved = snapshot.current;
    if (fieldPanels && saved) {
      setDraft(saved.draft);
      setBudget(saved.budget);
      setStart(saved.start);
      setEnd(saved.end);
      setMode(saved.mode);
      setMonth(saved.month);
      setInvalidTo(saved.invalidTo);
      destinationEdited.current = saved.destinationEdited;
      previousOrigin.current = saved.draft.originId;
      setCurrencyChanged(saved.currencyChanged);
    }
    setEditor(null);
  }
  const editorValid =
    editor === "budget"
      ? validBudget
      : editor === "dates"
        ? validDates
        : editor === "from"
          ? !!origin && origin.type !== "country"
          : editor === "to"
            ? !invalidTo
            : true;
  const fieldOrder: Field[] = fieldPanels
    ? ["budget", "from", "dates", "travelers", "to"]
    : ["from", "to", "dates", "travelers", "budget"];
  const values = {
    from: origin?.name ?? t.chooseOrigin,
    to: draft.destination?.name ?? t.anywhere,
    dates:
      mode === "weekends"
        ? `${t.anyWeekend} · ${resultMonth(month, locale)}`
        : `${resultDateRange(start, end, locale, today.slice(0, 4))}${mode === "flexible" ? " ±3" : ""}${isCalendarDate(start) && isCalendarDate(end) && end > start ? ` · ${nightsBetween(start, end)} ${t.nights}` : ""}`,
    travelers: `${draft.party.adults + draft.party.children} ${t.people}`,
    budget: validBudget
      ? formatMoney(userInput(parseBudget(budget, currency)), locale)
      : `${currencyMetadata[currency].symbol} —`,
  };
  return (
    <fieldset
      className="search-workspace"
      disabled={pending}
      aria-label={embedded ? t.editSearch : t.searchLabel}
      data-filters-only={filtersOnly || undefined}
      aria-busy={pending}
      data-editing={
        embedded && (!!editor || (aiEnabled && aiOpen)) ? "true" : undefined
      }
    >
      <div className="search-bar">
        {fieldOrder.map((field) => (
          <button
            key={field}
            type="button"
            className="search-field"
            data-field={field}
            aria-expanded={editor === field}
            aria-haspopup={embedded ? undefined : "dialog"}
            onClick={(e) => {
              if (fieldPanels && editor === field) {
                cancelEditor();
                return;
              }
              if (fieldPanels) {
                // Switching fields cancels the uncommitted field before opening the next.
                const saved =
                  editor && snapshot.current
                    ? snapshot.current
                    : {
                        draft: {
                          ...draft,
                          budget: { ...draft.budget, currency },
                        },
                        budget,
                        start,
                        end,
                        mode,
                        month,
                        invalidTo,
                        destinationEdited: destinationEdited.current,
                        currencyChanged,
                      };
                if (editor) cancelEditor();
                snapshot.current = saved;
                setDraft(saved.draft);
              }
              fieldTrigger.current = e.currentTarget;
              setAiOpen(false);
              setEditor(field);
            }}
          >
            <span>
              {
                t[
                  field === "from"
                    ? "fromLabel"
                    : field === "to"
                      ? "toLabel"
                      : field === "dates"
                        ? "datesLabel"
                        : field === "budget"
                          ? "totalTripBudget"
                          : field
                ]
              }
            </span>
            <strong>{values[field]}</strong>
            {home ? (
              <small>
                {field === "budget"
                  ? `for ${draft.party.adults + draft.party.children} people, all costs`
                  : field === "from"
                    ? draft.preferences.nearbyAirports
                      ? "Nearby airports included"
                      : "City or airport"
                    : field === "dates"
                      ? mode === "flexible"
                        ? "Flexible ±3 days"
                        : mode === "weekends"
                          ? "Weekends this month"
                          : "Exact dates"
                      : field === "travelers"
                        ? `${draft.party.adults} adults · ${draft.party.children} children`
                        : draft.styles.length
                          ? draft.styles.map((style) => t[style]).join(", ")
                          : "Optional · anywhere"}
              </small>
            ) : null}
          </button>
        ))}
        {!embedded ? (
          <button
            className="button ember search-submit"
            disabled={!valid || pending}
            onClick={search}
          >
            {pending
              ? t.searching
              : results
                ? t.updateSearch
                : home
                  ? "Find trips"
                  : refinements
                    ? t.searchLabel
                    : t.find}{" "}
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
      </div>
      {!filtersOnly ? (
        <p className="small muted search-budget-note">
          {home
            ? "Flights, stays and daily costs. A reserve for the unexpected."
            : t.totalTripBudgetNote}
        </p>
      ) : null}
      {currencyChanged ? (
        <p className="small search-currency-note" role="status">
          {homeCopy[locale].currencyNote}
        </p>
      ) : null}
      {!valid ? (
        <p className="small search-error" role="status">
          {!origin
            ? home
              ? "Choose your departure city or airport to find trips."
              : t.chooseSuggestion
            : origin.type === "country"
              ? t.cityRequired
              : invalidTo
                ? t.chooseSuggestion
                : !validBudget
                  ? t.budgetError
                  : t.dateError}
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="small">
          {t.findingTrips}
        </p>
      ) : null}
      {editor ? (
        <SearchEditor
          key={editor}
          embedded={embedded}
          home={
            fieldPanels
              ? {
                  anchor: fieldTrigger,
                  onCancel: cancelEditor,
                  valid: editorValid,
                  onApply: () => {
                    if (home)
                      preference.chooseCurrency?.(draft.budget.currency);
                    setEditor(null);
                  },
                }
              : undefined
          }
          title={
            t[
              editor === "from"
                ? "fromLabel"
                : editor === "to"
                  ? "toLabel"
                  : editor === "dates"
                    ? "datesLabel"
                    : editor
            ]
          }
          closeLabel={embedded ? t.back : t.done}
          onClose={() => {
            setEditor(null);
            requestAnimationFrame(() => fieldTrigger.current?.focus());
          }}
        >
          {editor === "from" || editor === "to" ? (
            <LocationInput
              value={editor === "from" ? origin : draft.destination}
              origin={editor === "from"}
              t={t}
              onChange={(l) => choose(l, editor === "from")}
              onAnywhere={() => {
                destinationEdited.current = true;
                setDraft({ ...draft, destination: undefined });
                setInvalidTo(false);
              }}
            />
          ) : null}
          {home && editor === "from" ? (
            <label className="home-nearby-toggle">
              <input
                type="checkbox"
                checked={draft.preferences.nearbyAirports}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    preferences: {
                      ...draft.preferences,
                      nearbyAirports: event.target.checked,
                    },
                  })
                }
              />
              <span>
                Include nearby airports<small>{t.nearbyExplanation}</small>
              </span>
            </label>
          ) : null}
          {editor === "dates" ? (
            <div className="stack">
              <div className="chips">
                {(["exact", "flexible", "weekends"] as const).map((m) => (
                  <button
                    className={`pill ${mode === m ? "active" : ""}`}
                    aria-pressed={mode === m}
                    key={m}
                    onClick={() => setMode(m)}
                  >
                    {
                      t[
                        m === "exact"
                          ? "exactDates"
                          : m === "flexible"
                            ? "flexibleDates"
                            : "anyWeekend"
                      ]
                    }
                  </button>
                ))}
              </div>
              {mode === "weekends" ? (
                <label>
                  {t.monthLabel}
                  <input
                    type="month"
                    value={month}
                    min={today.slice(0, 7)}
                    onInput={(e) => setMonth(e.currentTarget.value)}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </label>
              ) : (
                <>
                  <div className="chips">
                    {(["weekend", "next-weekend"] as const).map((p) => (
                      <button
                        className="pill"
                        key={p}
                        onClick={() => {
                          const dates = resolveTravelDates(p, today, 2);
                          setStart(dates.startDate);
                          setEnd(dates.endDate);
                        }}
                      >
                        {t[p]}
                      </button>
                    ))}
                  </div>
                  <div className="search-date-grid">
                    <label>
                      {t.departureDate}
                      <input
                        type="date"
                        min={today}
                        value={start}
                        onInput={(e) => setStart(e.currentTarget.value)}
                        onChange={(e) => setStart(e.target.value)}
                      />
                    </label>
                    <label>
                      {t.returnDate}
                      <input
                        type="date"
                        min={start}
                        value={end}
                        onInput={(e) => setEnd(e.currentTarget.value)}
                        onChange={(e) => setEnd(e.target.value)}
                      />
                    </label>
                  </div>
                </>
              )}
              {!validDates ? (
                <p role="alert">{t.dateError}</p>
              ) : (
                <p className="small muted">
                  {mode === "weekends"
                    ? t.weekendNote
                    : mode === "flexible"
                      ? t.flexDateNote
                      : t.exactDateNote}
                </p>
              )}
            </div>
          ) : null}
          {editor === "travelers" ? (
            <div className="stack">
              <div>
                {(["adults", "children"] as const).map((key) => (
                  <Stepper
                    key={key}
                    label={t[key]}
                    value={draft.party[key]}
                    min={key === "adults" ? 1 : 0}
                    max={key === "adults" ? 8 : 6}
                    onChange={(n) =>
                      setDraft({
                        ...draft,
                        party: { ...draft.party, [key]: n },
                      })
                    }
                  />
                ))}
              </div>
              {draft.party.adults + draft.party.children > 9 ? (
                <p
                  className="small muted traveller-handoff-warning"
                  role="status"
                >
                  {t.largePartyFlightNote}
                </p>
              ) : null}
            </div>
          ) : null}
          {editor === "budget" ? (
            <div className="stack">
              <label>
                {t.totalBudget} ({currency})
                <input
                  autoFocus
                  type="number"
                  min="1"
                  max="100000"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>
              <label>
                {locale === "en" ? "Currency" : "Monedha"}
                <select
                  value={currency}
                  onChange={(e) => {
                    if (isCurrency(e.target.value)) {
                      setDraft({
                        ...draft,
                        budget: parseBudget(budget, e.target.value),
                      });
                      if (!embedded && !fieldPanels)
                        preference.chooseCurrency?.(e.target.value);
                      setCurrencyChanged(true);
                    }
                  }}
                >
                  {supportedCurrencies.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>
              <div className="chips">
                {[200, 300, 500, 1000, 2000].map((n) => (
                  <button
                    className="pill"
                    key={n}
                    onClick={() => setBudget(String(n))}
                  >
                    {formatMoney(
                      userInput(parseBudget(String(n), currency)),
                      locale,
                    )}
                  </button>
                ))}
              </div>
              <p className="small muted">{t.budgetNote}</p>
              {!validBudget ? <p role="alert">{t.budgetError}</p> : null}
            </div>
          ) : null}
        </SearchEditor>
      ) : null}
      {refinements ? (
        <div className="search-refinements">
          <div className="chips">
            {(["beach", "city", "nature", "quiet"] as const).map((s) => (
              <button
                className={`pill ${draft.styles.includes(s) ? "active" : ""}`}
                aria-pressed={draft.styles.includes(s)}
                key={s}
                onClick={() =>
                  setDraft({
                    ...draft,
                    styles: draft.styles.includes(s)
                      ? draft.styles.filter((v) => v !== s)
                      : [...draft.styles, s],
                  })
                }
              >
                {t[s]}
              </button>
            ))}
            <button
              className={`pill ${draft.noFlight ? "active" : ""}`}
              aria-pressed={!!draft.noFlight}
              onClick={() => setDraft({ ...draft, noFlight: !draft.noFlight })}
            >
              {t.noFlight}
            </button>
            <label className="refinement-select">
              {t.stay}
              <select
                value={draft.preferences.stayLevel}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    preferences: {
                      ...draft.preferences,
                      stayLevel: e.target
                        .value as TripRequest["preferences"]["stayLevel"],
                    },
                  })
                }
              >
                {(["simple", "standard", "comfort"] as const).map((s) => (
                  <option value={s} key={s}>
                    {t[s]}
                  </option>
                ))}
              </select>
            </label>
            {!filtersOnly ? (
              <button
                className="pill"
                aria-expanded={more}
                onClick={() => setMore(!more)}
              >
                {t.moreFilters}
              </button>
            ) : null}
          </div>
          {more ? (
            <div className="chips">
              {(
                ["nearbyAirports", "car", "luggage", "familyStay"] as const
              ).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={draft.preferences[key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        preferences: {
                          ...draft.preferences,
                          [key]: e.target.checked,
                        },
                      })
                    }
                  />
                  {t[key]}
                </label>
              ))}
            </div>
          ) : null}
          {more && !filtersOnly ? (
            <p className="small muted">{t.nearbyExplanation}</p>
          ) : null}
          {!embedded && !filtersOnly ? (
            <p className="small muted">{t.applySearch}</p>
          ) : null}
        </div>
      ) : null}
      {home && review ? (
        <div className="home-ai-review" role="status">
          <strong>{homeCopy[locale].aiReview}</strong>
          <p>{homeCopy[locale].aiReviewNote}</p>
          <fieldset>
            <legend>{homeCopy[locale].styles}</legend>
            <div className="chips">
              {(["city", "nature", "quiet", "beach"] as const).map((style) => (
                <button
                  type="button"
                  className={`pill ${draft.styles.includes(style) ? "active" : ""}`}
                  aria-pressed={draft.styles.includes(style)}
                  key={style}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      styles: draft.styles.includes(style)
                        ? draft.styles.filter((s) => s !== style)
                        : [...draft.styles, style],
                    })
                  }
                >
                  {t[style]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
      {aiEnabled ? (
        <button
          className={`search-words ai-trigger ${home ? "home-ai-trigger" : ""}`}
          type="button"
          aria-haspopup={home || embedded ? undefined : "dialog"}
          aria-expanded={aiOpen}
          aria-controls={aiOpen ? aiId : undefined}
          onClick={(e) => {
            fieldTrigger.current = e.currentTarget;
            setEditor(null);
            setAiOpen(!aiOpen);
          }}
        >
          {home ? (
            <>
              <span aria-hidden="true">✧</span> {homeCopy[locale].ai}
              <span aria-hidden="true"> {aiOpen ? "−" : "+"}</span>
            </>
          ) : (
            aiCopy[locale].title
          )}
        </button>
      ) : null}
      {aiEnabled && aiOpen ? (
        <div
          id={aiId}
          className={
            home
              ? "home-ai-panel"
              : embedded
                ? "search-inline-editor"
                : undefined
          }
        >
          <AiSearchPanel
            locale={locale}
            t={t}
            today={today}
            embedded={home || embedded}
            onReview={
              home || embedded
                ? (request, unsupported) => {
                    setDraft(request);
                    previousOrigin.current = request.originId;
                    if (!embedded)
                      preference.chooseCurrency?.(request.budget.currency);
                    setBudget(majorUnits(request.budget));
                    setStart(request.dates.startDate);
                    setEnd(request.dates.endDate);
                    setMode(
                      request.dates.mode === "weekends"
                        ? "weekends"
                        : request.dates.flexibleDays === 3
                          ? "flexible"
                          : "exact",
                    );
                    setMonth(request.dates.month ?? today.slice(0, 7));
                    setInvalidTo(false);
                    setReview(unsupported);
                    setAiOpen(false);
                    requestAnimationFrame(() =>
                      fieldTrigger.current
                        ?.closest(".search-workspace")
                        ?.querySelector<HTMLButtonElement>(".search-field")
                        ?.focus(),
                    );
                  }
                : undefined
            }
            onClose={() => {
              setAiOpen(false);
              requestAnimationFrame(() => fieldTrigger.current?.focus());
            }}
            draft={{
              ...Object.fromEntries(new URLSearchParams(requestQuery(draft))),
              ...(invalidTo ? { toPlace: "invalid" } : {}),
              origin: origin?.id ?? "",
              originPlace: origin ? JSON.stringify(origin) : undefined,
              budget,
              currency: currency,
              start,
              end,
              dateMode: mode === "weekends" ? "weekends" : undefined,
              month: mode === "weekends" ? month : undefined,
              flexDays: mode === "flexible" ? "3" : "0",
            }}
          />
        </div>
      ) : null}
      {embedded ? (
        <button
          type="button"
          className="button ember search-apply"
          disabled={!valid || pending}
          onClick={search}
        >
          {pending ? t.searching : t.updateSearch}{" "}
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
    </fieldset>
  );
}
