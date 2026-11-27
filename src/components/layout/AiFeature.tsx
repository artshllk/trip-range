"use client";
import { createContext, useContext, type ReactNode } from "react";
// Only a nonsecret server decision crosses this boundary. The API independently enforces it.
const AiFeatureContext = createContext(false);
export function AiFeature({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <AiFeatureContext.Provider value={enabled}>
      {children}
    </AiFeatureContext.Provider>
  );
}
export function useAiEnabled() {
  return useContext(AiFeatureContext);
}
