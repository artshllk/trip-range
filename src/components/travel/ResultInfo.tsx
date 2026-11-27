"use client";
import { useId, type ReactNode } from "react";

/** Native, non-modal disclosure: keyboard activation, Escape and light dismiss. */
export function ResultInfo({
  label,
  closeLabel,
  children,
}: {
  label: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <button
        type="button"
        className="result-info-button"
        popoverTarget={id}
        aria-label={label}
        title={label}
      >
        <span aria-hidden="true">i</span>
      </button>
      <div id={id} popover="auto" className="result-info-popover">
        <div className="row-between">
          <strong>{label}</strong>
          <button
            type="button"
            className="text-button"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label={closeLabel}
          >
            ×
          </button>
        </div>
        <div className="small">{children}</div>
      </div>
    </>
  );
}
