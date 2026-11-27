"use client";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { SearchDialog } from "./SearchDialog";
import { HomeSearchEditor } from "./HomeSearchEditor";
/** An editor inside Edit search stays in that sheet's existing focus/modal layer. */
export function SearchEditor({
  embedded,
  title,
  closeLabel,
  onClose,
  children,
  home,
}: {
  embedded: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  home?: {
    anchor: RefObject<HTMLButtonElement | null>;
    onCancel: () => void;
    onApply: () => void;
    valid: boolean;
  };
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (embedded) heading.current?.focus();
  }, [embedded]);
  if (home)
    return (
      <HomeSearchEditor title={title} {...home}>
        {children}
      </HomeSearchEditor>
    );
  if (!embedded)
    return (
      <SearchDialog title={title} closeLabel={closeLabel} onClose={onClose}>
        {children}
      </SearchDialog>
    );
  return (
    <section className="search-inline-editor stack" aria-label={title}>
      <h3 ref={heading} tabIndex={-1}>
        {title}
      </h3>
      {children}
      <button className="button" type="button" onClick={onClose}>
        {closeLabel}
      </button>
    </section>
  );
}
