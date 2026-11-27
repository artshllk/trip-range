import type { KeyboardEvent } from "react";

/** Keep Tab on a modal's visible controls, including after controls change. */
export function containDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab" || !event.currentTarget.matches(":modal")) return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.matches(':disabled, [type="hidden"]') &&
      !element.closest("[inert]") &&
      element.getClientRects().length > 0,
  );
  const first = controls[0],
    last = controls[controls.length - 1];
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      !controls.includes(document.activeElement as HTMLElement))
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
