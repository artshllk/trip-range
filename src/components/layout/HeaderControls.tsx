"use client";
import { localePath } from "@/i18n/routing";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "@/i18n/config";
import {
  currencyMetadata,
  supportedCurrencies,
  type CurrencyCode,
} from "@/domain/money/currency";
import { DiscoveryNavigation } from "../discovery/DiscoveryNavigation";
import Link from "next/link";
import { isMonthDiscovery } from "@/domain/month-discovery";
import { ContextLink } from "../discovery/ContextLink";
import { homeCopy } from "@/i18n/home";
import { parseRequest } from "@/domain/request";
import { SearchDialog } from "../travel/SearchDialog";
import { useSearchCurrency } from "./SearchPreferences";

export function HeaderControls({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const homepage =
    path === localePath(locale) || path === localePath(locale, `/`);
  const params = useSearchParams();
  const monthly =
    (homepage || path === "/plan" || path === "/from/tirana") &&
    isMonthDiscovery(Object.fromEntries(params));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const appliedSearch =
    /\/(?:plan\/(?:results|trips\/[^/]+)|destinations(?:\/[^/]+)?|about)\/?$/.test(
      path,
    );
  const requestCurrency = parseRequest(Object.fromEntries(params)).budget
    .currency;
  const preference = useSearchCurrency(requestCurrency);
  // Existing searches belong to their URL, including Back/Forward navigation.
  const currency = appliedSearch ? requestCurrency : preference.currency;
  const c = homeCopy[locale];
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);
  function chooseCurrency(next: CurrencyCode) {
    if (!appliedSearch) {
      preference.chooseCurrency?.(next);
      return;
    }
    if (pending || next === currency) return;
    const query = new URLSearchParams(params.toString());
    // Nominal currency choice, not FX. Preserve budget, dates, party and route hints.
    query.set("currency", next);
    startTransition(() => router.push(`${path}?${query}`, { scroll: false }));
  }
  return (
    <>
      <div className="header-preferences">
        {monthly ? (
          <Link className="nav-plan" href="/plan">
            {c.plan} <span aria-hidden="true">↗</span>
          </Link>
        ) : (
          <>
            {" "}
            <CurrencyMenu
              label={c.currency}
              note={c.currencyNote}
              currency={currency}
              pending={pending}
              onChoose={chooseCurrency}
            />
            <ContextLink
              className="nav-plan"
              path={localePath(locale)}
              hash="search"
            >
              {c.plan} <span aria-hidden="true">↗</span>
            </ContextLink>
          </>
        )}
      </div>
      <button
        className="header-control mobile-menu-trigger"
        type="button"
        aria-label={c.menu}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {c.menu}
      </button>
      {open ? (
        <SearchDialog
          title={homepage ? "Trip Range" : c.menu}
          closeLabel={c.close}
          onClose={() => setOpen(false)}
          className={`header-dialog${homepage ? " home-menu" : ""}`}
          closeAction={!homepage}
          containFocus={homepage}
        >
          <nav className="mobile-links" aria-label={c.menu}>
            <DiscoveryNavigation onNavigate={() => setOpen(false)} />
          </nav>
          {homepage && monthly ? (
            <Link
              className="button ember home-menu-start"
              href="/plan"
              onClick={() => setOpen(false)}
            >
              Explore departure dates →
            </Link>
          ) : homepage ? (
            <ContextLink
              className="button ember home-menu-start"
              path={localePath(locale)}
              hash="search"
              onClick={() => setOpen(false)}
            >
              Start with a budget <span aria-hidden="true">→</span>
            </ContextLink>
          ) : null}
        </SearchDialog>
      ) : null}
    </>
  );
}

// Hover opens it for mouse users; tap/click/keyboard toggle it everywhere.
function CurrencyMenu({
  label,
  note,
  currency,
  pending,
  onChoose,
}: {
  label: string;
  note: string;
  currency: CurrencyCode;
  pending: boolean;
  onChoose: (next: CurrencyCode) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number>(undefined);
  const openedByHover = useRef(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("popstate", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("popstate", close);
    };
  }, [open]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  function hover(next: boolean) {
    window.clearTimeout(hoverTimer.current);
    if (next) {
      openedByHover.current = !open;
      setOpen(true);
    } else {
      hoverTimer.current = window.setTimeout(() => setOpen(false), 150);
    }
  }
  function focusItem(index: number) {
    const items = root.current?.querySelectorAll<HTMLButtonElement>(
      "[role=menuitemradio]",
    );
    if (!items?.length) return;
    items[(index + items.length) % items.length].focus();
  }
  function choose(next: CurrencyCode) {
    onChoose(next);
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      ref={root}
      className="currency-menu"
      onPointerEnter={(event) => event.pointerType === "mouse" && hover(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && hover(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="header-control"
        aria-label={`${label}: ${currency}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          // A click after a hover-open keeps it open instead of toggling shut.
          setOpen((value) => (openedByHover.current ? true : !value));
          openedByHover.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() =>
            focusItem(supportedCurrencies.indexOf(currency)),
          );
        }}
      >
        {currency}
        <svg
          className="currency-menu-chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 3.5 5 6.5 8 3.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      {open ? (
        <div className="currency-menu-panel">
          <div className="currency-menu-card">
            <div
              className="currency-menu-list"
              role="menu"
              aria-label={label}
              aria-busy={pending}
              onKeyDown={(event) => {
                const index = supportedCurrencies.indexOf(
                  (event.target as HTMLElement).dataset.value as CurrencyCode,
                );
                if (event.key === "ArrowDown") focusItem(index + 1);
                else if (event.key === "ArrowUp") focusItem(index - 1);
                else return;
                event.preventDefault();
              }}
            >
              {supportedCurrencies.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === currency}
                  data-value={value}
                  disabled={pending}
                  onClick={() => choose(value)}
                >
                  <span className="currency-menu-symbol" aria-hidden="true">
                    {currencyMetadata[value].symbol === value
                      ? null
                      : currencyMetadata[value].symbol}
                  </span>
                  {value}
                  {value === currency ? (
                    <span className="currency-menu-check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <p className="currency-menu-note">{note}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
