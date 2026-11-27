"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { containDialogFocus } from "./dialog-focus";
export function SearchDialog({
  title,
  closeLabel,
  onClose,
  children,
  className = "",
  closeAction = true,
  busy = false,
  containFocus = false,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  closeAction?: boolean;
  busy?: boolean;
  containFocus?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);
  const id = useId();
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      element?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  function close() {
    if (closing || busy) return;
    setClosing(true);
    timer.current = setTimeout(
      onClose,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    );
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={id}
      className={`search-dialog ${className} ${closing ? "closing" : ""}`}
      onKeyDown={containFocus ? containDialogFocus : undefined}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="search-dialog-inner" inert={closing}>
        <div className="row-between">
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            className="text-button"
            onClick={close}
            aria-label={closeLabel}
            disabled={busy}
          >
            ×
          </button>
        </div>
        {children}
        {closeAction ? (
          <button
            type="button"
            className="button"
            onClick={close}
            disabled={busy}
          >
            {closeLabel}
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
