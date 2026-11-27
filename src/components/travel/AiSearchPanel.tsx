"use client";
import { localePath } from "@/i18n/routing";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivateAnalytics } from "../layout/PrivateAnalytics";
import { SearchEditor } from "./SearchEditor";
import { LocationInput } from "./LocationInput";
import { supportedCurrencies } from "@/domain/money/currency";
import { planningCurrency } from "@/domain/market/policy";
import { aiCopy } from "@/i18n/ai";
import { homeCopy } from "@/i18n/home";
import type { Dictionary } from "@/i18n/dictionaries";
import type { Query } from "@/domain/request";
import { requestQuery } from "@/domain/request";
import { validateDraft } from "@/domain/ai/validation";
import {
  MAX_AI_INPUT,
  validIntentText,
  type IntentResolution,
} from "@/domain/ai/intent";
import type { TravelLocation, TripRequest } from "@/domain/types";
export function AiSearchPanel({
  draft,
  locale,
  t,
  today,
  embedded,
  onClose,
  onReview,
}: {
  draft: Query;
  locale: "en" | "sq";
  t: Dictionary;
  today: string;
  embedded: boolean;
  onClose: () => void;
  onReview?: (
    request: TripRequest,
    unsupported: IntentResolution["unsupportedPreferences"],
  ) => void;
}) {
  const track = usePrivateAnalytics();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [failed, setFailed] = useState(false);
  const [resolution, setResolution] = useState<IntentResolution>();
  const [clarified, setClarified] = useState<Query>({});
  const [answered, setAnswered] = useState<string[]>([]);
  const router = useRouter();
  const c = aiCopy[locale];
  function event(name: string, clarification = false) {
    try {
      track(name, { locale, clarification });
    } catch {}
  }
  function navigate(
    request: TripRequest,
    unsupported: IntentResolution["unsupportedPreferences"],
  ) {
    if (onReview) {
      onReview(request, unsupported);
      return;
    }
    const query = new URLSearchParams(requestQuery(request));
    query.set("ai", "1");
    if (unsupported.length) query.set("unsupported", unsupported.join(","));
    router.push(localePath(locale, `/plan/results?${query}`));
  }
  async function parse() {
    if (busy.current || !validIntentText(text)) return;
    controller.current = new AbortController();
    busy.current = true;
    setPending(true);
    setFailed(false);
    event("ai_search_started");
    try {
      const response = await fetch("/api/ai/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, locale, draft }),
        signal: AbortSignal.any([
          controller.current.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      const result = await response.json();
      if (controller.current.signal.aborted) return;
      if (!response.ok || !["ready", "clarification"].includes(result.status))
        throw Error();
      const value = result as IntentResolution;
      event("ai_search_parsed", value.status === "clarification");
      if (value.status === "ready")
        navigate(value.request, value.unsupportedPreferences);
      else {
        setResolution(value);
        setText("");
        setClarified(
          Object.fromEntries(new URLSearchParams(requestQuery(value.request))),
        );
      }
    } catch {
      if (controller.current?.signal.aborted) return;
      setFailed(true);
      event("ai_search_failed");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function update(field: string, patch: Query) {
    setClarified((q) => ({ ...q, ...patch }));
    setAnswered((a) => [...new Set([...a, field])]);
  }
  function location(field: "origin" | "destination", value?: TravelLocation) {
    if (!value || (field === "origin" && value.type === "country")) {
      setAnswered((a) => a.filter((f) => f !== field));
      return;
    }
    update(
      field,
      field === "origin"
        ? {
            origin: value.id,
            originPlace: JSON.stringify(value),
            ...(resolution?.clarifications.some((c) => c.field === "currency")
              ? {}
              : { currency: planningCurrency(value).currency }),
          }
        : { toPlace: JSON.stringify(value) },
    );
  }
  const validation = validateDraft(clarified, today);
  const canContinue =
    !!resolution &&
    resolution.clarifications.every((f) => answered.includes(f.field)) &&
    !validation.fields.length;
  return (
    <SearchEditor
      embedded={embedded}
      title={onReview ? homeCopy[locale].ai : c.title}
      closeLabel={t.done}
      onClose={onClose}
    >
      <div className="stack ai-search-panel" aria-busy={pending}>
        {!resolution ? (
          <>
            <label className="stack">
              {c.input}
              <textarea
                autoFocus
                rows={onReview ? 2 : 4}
                placeholder={
                  onReview ? homeCopy[locale].aiPlaceholder : undefined
                }
                maxLength={MAX_AI_INPUT}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={pending}
              />
            </label>
            {!onReview ? <p className="small muted">{c.example}</p> : null}
            <p className="small muted">
              {onReview ? homeCopy[locale].aiPrivacy : c.privacy}
            </p>
            <button
              className="button ember"
              disabled={pending || !validIntentText(text)}
              onClick={parse}
            >
              {pending
                ? c.working
                : onReview
                  ? homeCopy[locale].aiParse
                  : c.find}{" "}
              →
            </button>
            {failed ? (
              <p role="alert" className="small">
                {c.error}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p role="status">{c.clarification}</p>
            {resolution.clarifications.map(({ field, choices }) => (
              <div className="stack" key={field}>
                <p>{c[field]}</p>
                {field === "origin" || field === "destination" ? (
                  <>
                    {!!choices?.length && (
                      <div className="chips">
                        {choices.map((l) => (
                          <button
                            className="pill"
                            key={l.id}
                            onClick={() => location(field, l)}
                          >
                            {l.name} · {l.countryName[locale]}
                          </button>
                        ))}
                      </div>
                    )}
                    <LocationInput
                      t={t}
                      origin={field === "origin"}
                      value={
                        answered.includes(field)
                          ? field === "origin"
                            ? validation.request.origin
                            : validation.request.destination
                          : undefined
                      }
                      onChange={(l) => location(field, l)}
                      onAnywhere={
                        field === "destination"
                          ? () => update(field, { toPlace: undefined })
                          : () => {}
                      }
                    />
                  </>
                ) : null}
                {field === "currency" ? (
                  <div className="chips">
                    {supportedCurrencies.map((currency) => (
                      <button
                        className={`pill ${answered.includes("currency") && clarified.currency === currency ? "active" : ""}`}
                        key={currency}
                        onClick={() => update("currency", { currency })}
                      >
                        {currency}
                      </button>
                    ))}
                  </div>
                ) : null}
                {field === "budget" ? (
                  <label>
                    {t.totalBudget} ({validation.request.budget.currency})
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      step="0.01"
                      value={String(clarified.budget ?? "")}
                      onChange={(e) =>
                        update(field, { budget: e.target.value })
                      }
                    />
                  </label>
                ) : null}
                {field === "party" ? (
                  <div className="search-date-grid">
                    {(["adults", "children"] as const).map((k) => (
                      <label key={k}>
                        {t[k]}
                        <input
                          type="number"
                          min={k === "adults" ? 1 : 0}
                          max={k === "adults" ? 8 : 6}
                          value={String(clarified[k] ?? "")}
                          onChange={(e) =>
                            update(field, { [k]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
                {field === "dates" ? (
                  <div className="search-date-grid">
                    {(["start", "end"] as const).map((k) => (
                      <label key={k}>
                        {k === "start" ? t.departureDate : t.returnDate}
                        <input
                          type="date"
                          min={today}
                          value={String(clarified[k] ?? "")}
                          onChange={(e) =>
                            update(field, {
                              [k]: e.target.value,
                              dateMode: undefined,
                              month: undefined,
                              when: "custom",
                              flexDays: "0",
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            <button
              className="button ember"
              disabled={!canContinue}
              onClick={() =>
                navigate(validation.request, resolution.unsupportedPreferences)
              }
            >
              {onReview ? homeCopy[locale].aiParse : c.find} →
            </button>
          </>
        )}
      </div>
    </SearchEditor>
  );
}
