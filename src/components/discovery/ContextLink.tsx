"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import {
  discoveryHref,
  planDestinationHref,
} from "@/domain/destination-discovery";
import type { TravelLocation } from "@/domain/types";
import { useCurrencySelection } from "../layout/SearchPreferences";

type Props = Omit<ComponentProps<typeof Link>, "href"> & {
  /** Clean canonical path. Never pass a query string here. */
  path: string;
  hash?: string;
  /** Builds the homepage planner link for this destination instead of `path`. */
  toPlace?: TravelLocation;
};

/**
 * Crawlers and the HTML only ever see the clean canonical href. On a plain
 * left click the visitor's current search inputs (read from the address bar,
 * which the homepage keeps in sync) travel with them, so search context is
 * preserved without creating crawlable query-string variants.
 */
export function ContextLink({
  path,
  hash = "",
  toPlace,
  onClick,
  ...props
}: Props) {
  const router = useRouter();
  const selectedCurrency = useCurrencySelection();
  const build = (query: Record<string, string>) =>
    toPlace
      ? planDestinationHref(toPlace, query)
      : discoveryHref(path, query, hash);
  // The href never carries a query, including the destination prefill.
  const clean = discoveryHref(
    toPlace ? "/" : path,
    {},
    toPlace ? "search" : hash,
  );
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target
    )
      return;
    const query = Object.fromEntries(
      new URLSearchParams(window.location.search),
    );
    const currency = selectedCurrency();
    if (currency) query.currency = currency;
    const target = build(query);
    if (target === clean) return;
    event.preventDefault();
    router.push(target);
  }
  return <Link {...props} href={clean} onClick={navigate} />;
}
