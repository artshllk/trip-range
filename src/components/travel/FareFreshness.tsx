"use client";
import { localized } from "../../i18n/localized";
import { useSyncExternalStore } from "react";
import type { Money } from "../../domain/money/provenance";
import { ageParts, fareFreshness } from "../../domain/money/freshness";
import { freshnessCopy } from "../../i18n/freshness";
import type { Locale } from "../../i18n/config";

// Minute resolution keeps the snapshot stable between renders.
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;
const noSubscribe = () => () => {};

function absolute(at: string, locale: Locale) {
  return `${new Intl.DateTimeFormat(locale === "sq" ? "sq-AL" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(at))} UTC`;
}

/** The single freshness label. Renders nothing for amounts that are not observed fares. */
export function FareFreshness({
  money,
  locale,
  handoffHref = "#flight-handoff",
}: {
  money: Money;
  locale: Locale;
  /** Where the amber tier's partner check points: the trip page's handoff section.
   * null: no handoff exists for this fare (e.g. a nearby airport), so no link. */
  handoffHref?: string | null;
}) {
  // Server render has no clock: it shows the absolute time; the client adds the age.
  const now = useSyncExternalStore(noSubscribe, minuteNow, () => null);
  const reference = fareFreshness(money, now ?? Date.parse("2100-01-01"));
  if (!reference) return null;
  const copy = localized(freshnessCopy, locale);
  const fresh = now === null ? undefined : fareFreshness(money, now);
  const age = fresh
    ? (() => {
        const { value, unit } = ageParts(fresh.ageMs);
        return copy.ago[unit].replace("{n}", String(value));
      })()
    : absolute(reference.at, locale);
  const label = (
    reference.basis === "fare-observed" ? copy.fareSeen : copy.lastChecked
  ).replace("{age}", age);
  return (
    <div
      className={`fare-freshness tier-${fresh?.tier ?? "unknown"}`}
      data-basis={reference.basis}
    >
      <details>
        <summary>
          <i aria-hidden="true" />
          <time dateTime={reference.at}>{label}</time>
        </summary>
        <dl>
          <div>
            <dt>{copy.fetchedRow}</dt>
            <dd>
              {reference.fetchedAt ? (
                <time dateTime={reference.fetchedAt}>
                  {absolute(reference.fetchedAt, locale)}
                </time>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>{copy.observedRow}</dt>
            <dd>
              {reference.fareObservedAt ? (
                <time dateTime={reference.fareObservedAt}>
                  {absolute(reference.fareObservedAt, locale)}
                </time>
              ) : (
                copy.observedUnknown
              )}
            </dd>
          </div>
          <div>
            <dt>{copy.sourceRow}</dt>
            <dd>{copy.sourceValue.replace("{source}", reference.source)}</dd>
          </div>
        </dl>
        <p>{copy.note}</p>
      </details>
      {fresh?.tier === "old" && handoffHref ? (
        <a className="fare-freshness-check" href={handoffHref}>
          {copy.checkPartner}
        </a>
      ) : null}
    </div>
  );
}
