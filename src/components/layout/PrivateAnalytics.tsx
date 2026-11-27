"use client";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { track } from "@vercel/analytics";
import { Analytics } from "@vercel/analytics/next";
import { sanitizeAnalyticsEvent } from "@/domain/analytics";
const AnalyticsContext = createContext(false);
export function PrivateAnalytics({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <AnalyticsContext.Provider value={enabled}>
      {children}
      {enabled ? (
        <Analytics beforeSend={sanitizeAnalyticsEvent} debug={false} />
      ) : null}
    </AnalyticsContext.Provider>
  );
}
/** Analytics failure or a disabled host must never interrupt a product action. */
export function usePrivateAnalytics() {
  const enabled = useContext(AnalyticsContext);
  return useCallback(
    (...args: Parameters<typeof track>) => {
      if (!enabled) return;
      try {
        track(...args);
      } catch {}
    },
    [enabled],
  );
}
