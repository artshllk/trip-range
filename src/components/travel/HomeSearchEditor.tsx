"use client";
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { containDialogFocus } from "./dialog-focus";

/** Homepage-only shell. Field values and validation remain in SearchBar. */
export function HomeSearchEditor({
  title,
  anchor,
  onCancel,
  onApply,
  valid,
  children,
}: {
  title: string;
  anchor: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onApply: () => void;
  valid: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const cancel = useRef(onCancel);
  const id = useId();
  useEffect(() => {
    cancel.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const element = dialog.current!;
    const trigger = anchor.current;
    const mobile = window.matchMedia("(max-width: 899px)");
    const previousOverflow = document.body.style.overflow;
    const position = () => {
      if (mobile.matches || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const height = element.getBoundingClientRect().height;
      const below = innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const placeBelow = below >= height || below >= above;
      const available = Math.max(100, placeBelow ? below : above);
      element.style.maxHeight = `${available}px`;
      element.style.left = `${Math.max(16, Math.min(rect.left, innerWidth - element.offsetWidth - 16))}px`;
      element.style.top = `${placeBelow ? rect.bottom + 8 : Math.max(16, rect.top - Math.min(height, available) - 8)}px`;
    };
    const show = () => {
      element.close();
      element.style.removeProperty("left");
      element.style.removeProperty("top");
      element.style.removeProperty("max-height");
      document.body.style.overflow = mobile.matches
        ? "hidden"
        : previousOverflow;
      if (mobile.matches) element.showModal();
      else element.show();
      position();
      heading.current?.focus({ preventScroll: true });
    };
    const outside = (event: PointerEvent) => {
      if (
        !mobile.matches &&
        !element.contains(event.target as Node) &&
        !trigger?.contains(event.target as Node)
      )
        cancel.current();
    };
    show();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    mobile.addEventListener("change", show);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      observer.disconnect();
      mobile.removeEventListener("change", show);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside);
      document.body.style.overflow = previousOverflow;
      element.close();
      trigger?.focus({ preventScroll: true });
    };
  }, [anchor]);
  return (
    <dialog
      ref={dialog}
      className="home-field-editor"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        containDialogFocus(event);
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onCancel();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="home-field-editor-inner">
        <div className="home-sheet-handle" aria-hidden="true" />
        <div className="row-between">
          <h2 id={id} ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <button
            type="button"
            className="text-button"
            aria-label="Cancel and close"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        <div className="home-field-editor-content">{children}</div>
        <div className="home-field-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button ember"
            disabled={!valid}
            onClick={onApply}
          >
            Apply
          </button>
        </div>
      </div>
    </dialog>
  );
}
