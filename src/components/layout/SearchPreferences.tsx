"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { CurrencyCode } from "@/domain/money/currency";

type Selection = { scope: string; currency: CurrencyCode };
const CurrencyContext = createContext<{
  selection?: Selection;
  chooseCurrency: (currency: CurrencyCode) => void;
} | null>(null);

/** Presentation state only. No page-level Suspense: route status/SEO must remain server-controlled. */
export function SearchPreferences({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection>();
  return (
    <CurrencyContext.Provider
      value={{
        selection,
        chooseCurrency: (currency) => {
          setSelection({
            scope: window.location.pathname + window.location.search,
            currency,
          });
        },
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}
/** The in-memory currency choice for the page the visitor is on, read at click time. */
export function useCurrencySelection() {
  const context = useContext(CurrencyContext);
  return () => {
    const selected = context?.selection;
    return selected &&
      selected.scope === window.location.pathname + window.location.search
      ? selected.currency
      : undefined;
  };
}
export function useSearchCurrency(fallback: CurrencyCode) {
  const context = useContext(CurrencyContext);
  const path = usePathname();
  // Selection exists only after a browser interaction. The URL is compared in memory,
  // never persisted or logged; navigating to another request restores its own currency.
  const selected = context?.selection;
  const currency =
    selected &&
    typeof window !== "undefined" &&
    selected.scope === path + window.location.search
      ? selected.currency
      : fallback;
  return { currency, chooseCurrency: context?.chooseCurrency };
}
