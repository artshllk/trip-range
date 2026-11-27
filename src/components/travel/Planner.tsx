"use client";
import { localePath } from "@/i18n/routing";
import { userInput } from "../../domain/money/provenance";
import { majorUnits } from "@/domain/money/currency";
import { locations, domesticLabel } from "@/catalogue/locations";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TripTemplate, TripRequest } from "@/domain/types";
import {
  requestQuery,
  styles,
  updateRequestDates,
  parseBudget,
  requestWithOrigin,
} from "@/domain/request";
import { pricePlan } from "@/domain/pricing";
import type { SearchIssue } from "@/services/travel";
import { SourceIssues } from "./SourceIssues";
import { curateTripCards } from "@/domain/trip-card-ranking";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatMoney, type Locale } from "@/i18n/config";
export function Planner({
  today,
  initial,
  bases,
  locale,
  t,
  issues,
}: {
  today: string;
  initial: TripRequest;
  bases: TripTemplate[];
  locale: Locale;
  t: Dictionary;
  issues: SearchIssue[];
}) {
  const [r, setR] = useState(initial);
  const [step, setStep] = useState(0);
  const router = useRouter();
  const count = curateTripCards(
    bases.map((b) => pricePlan(b, r)),
    r,
  ).fitCount;
  function change(patch: Partial<TripRequest>) {
    const next = updateRequestDates(r, patch, today);
    if (
      patch.scope !== undefined ||
      patch.styles !== undefined ||
      patch.flexible !== undefined ||
      (patch.originId && patch.originId !== r.originId) ||
      ((patch.when || patch.nights) &&
        bases.some((b) => b.transport.mode === "flight"))
    ) {
      router.push(localePath(locale, `/plan?${requestQuery(next)}`));
      return;
    }
    setR(next);
    window.history.replaceState(null, "", `?${requestQuery(next)}`);
  }
  function show() {
    router.push(localePath(locale, `/plan/results?${requestQuery(r)}`));
  }
  return (
    <main id="main" className="shell section planner-grid">
      <aside className="panel stack planner-summary">
        <p className="eyebrow">{t.soFar}</p>
        <label>
          {t.budget} ({r.budget.currency})
          <input
            aria-label={t.budget}
            type="number"
            min="1"
            max="100000"
            value={majorUnits(r.budget)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 1 && n <= 100000)
                change({
                  budget: parseBudget(e.target.value, r.budget.currency),
                });
            }}
          />
        </label>
        <label>
          {t.from}
          <select
            value={r.originId}
            onChange={(e) =>
              change(
                requestWithOrigin(
                  r,
                  locations.find((o) => o.id === e.target.value)!,
                ),
              )
            }
          >
            {locations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.when}
          <select
            value={r.when}
            onChange={(e) =>
              change({ when: e.target.value as TripRequest["when"] })
            }
          >
            {r.when === "custom" ? (
              <option value="custom">{t.custom}</option>
            ) : null}
            {(["weekend", "next-weekend", "month", "summer"] as const).map(
              (w) => (
                <option key={w} value={w}>
                  {t[w]}
                </option>
              ),
            )}
          </select>
        </label>
        <p className="small">
          {r.dates.startDate} → {r.dates.endDate}
        </p>
        <p>
          {r.party.adults + r.party.children} {t.people} · {r.nights}{" "}
          {r.nights === 1 ? t.night : t.nights}
        </p>
        <div className="fit-counter" aria-live="polite">
          {bases.some((b) => b.transport.mode === "flight") ? (
            "Trip totals still need checking"
          ) : (
            <>
              <strong>≈ {count}</strong> {t.fitCount}
            </>
          )}
          <small>{t.narrow}</small>
        </div>
      </aside>
      <section className="stack">
        <div className="step-progress">
          <i />
          <i className={step === 1 ? "filled" : ""} />
          <span>
            {t.step} {step + 1} / 2
          </span>
        </div>
        <h1 className="page-title">{step === 0 ? t.step1 : t.step2}</h1>
        <p className="muted">{step === 0 ? t.optional : t.pick}</p>
        <SourceIssues issues={issues} t={t} />
        <p className="small muted">{t.providerLimits}</p>
        {step === 0 ? (
          <div className="two-cols">
            <fieldset>
              <legend className="eyebrow">{t.travelers}</legend>
              {(["adults", "children"] as const).map((key) => (
                <div className="stepper" key={key}>
                  <b>{t[key]}</b>
                  <button
                    aria-label={`− ${t[key]}`}
                    disabled={r.party[key] <= (key === "adults" ? 1 : 0)}
                    onClick={() =>
                      change({ party: { ...r.party, [key]: r.party[key] - 1 } })
                    }
                  >
                    −
                  </button>
                  <output>{r.party[key]}</output>
                  <button
                    aria-label={`+ ${t[key]}`}
                    disabled={r.party[key] >= (key === "adults" ? 8 : 6)}
                    onClick={() =>
                      change({ party: { ...r.party, [key]: r.party[key] + 1 } })
                    }
                  >
                    +
                  </button>
                </div>
              ))}
            </fieldset>
            <fieldset>
              <legend className="eyebrow">{t.length}</legend>
              <div className="choice-grid">
                {[1, 2, 3, 5, 7, 10].map((n) => (
                  <button
                    key={n}
                    className={`choice ${r.nights === n ? "selected" : ""}`}
                    aria-pressed={r.nights === n}
                    onClick={() => change({ nights: n })}
                  >
                    {n} {n === 1 ? t.night : t.nights}
                  </button>
                ))}
              </div>
              <label className="toggle">
                <span>{t.flex}</span>
                <input
                  type="checkbox"
                  checked={r.flexible}
                  onChange={(e) => change({ flexible: e.target.checked })}
                />
              </label>
            </fieldset>
          </div>
        ) : (
          <>
            <fieldset>
              <legend className="eyebrow">{t.type}</legend>
              <div className="chips">
                <button
                  className={`pill ${r.scope === "domestic" ? "active" : ""}`}
                  aria-pressed={r.scope === "domestic"}
                  onClick={() =>
                    change({
                      scope: r.scope === "domestic" ? "anywhere" : "domestic",
                    })
                  }
                >
                  {domesticLabel(r.originId, locale)}
                </button>
                {styles.map((s) => (
                  <button
                    key={s}
                    className={`pill ${r.styles.includes(s) ? "active" : ""}`}
                    aria-pressed={r.styles.includes(s)}
                    onClick={() =>
                      change({
                        styles: r.styles.includes(s)
                          ? r.styles.filter((x) => x !== s)
                          : [...r.styles, s],
                      })
                    }
                  >
                    {t[s]}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="eyebrow">{t.details}</legend>
              <div className="choice-grid">
                {(
                  ["nearbyAirports", "car", "luggage", "familyStay"] as const
                ).map((k) => (
                  <label key={k} className="toggle choice">
                    <span>{t[k]}</span>
                    <input
                      type="checkbox"
                      checked={r.preferences[k]}
                      onChange={(e) =>
                        change({
                          preferences: {
                            ...r.preferences,
                            [k]: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="stay-options">
                <span>{t.stayLevel}</span>
                {(["simple", "standard", "comfort"] as const).map((k) => (
                  <button
                    className={`pill ${r.preferences.stayLevel === k ? "active" : ""}`}
                    aria-pressed={r.preferences.stayLevel === k}
                    key={k}
                    onClick={() =>
                      change({
                        preferences: { ...r.preferences, stayLevel: k },
                      })
                    }
                  >
                    {t[k]}
                  </button>
                ))}
              </div>
            </fieldset>
          </>
        )}
        <div className="planner-actions">
          {step === 1 ? (
            <button className="button outline" onClick={() => setStep(0)}>
              {t.back}
            </button>
          ) : null}
          <button
            className="button"
            onClick={() => (step === 0 ? setStep(1) : show())}
          >
            {step === 0 ? t.next : t.show} →
          </button>
          <button className="button outline ember-text" onClick={show}>
            {t.skip}
          </button>
        </div>
        <p className="small muted">
          {bases.some((b) => b.transport.mode === "flight") ? t.hybrid : t.demo}{" "}
          · {formatMoney(userInput(r.budget), locale)}
        </p>
      </section>
    </main>
  );
}
