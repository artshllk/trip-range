"use client";
import { ContextLink } from "./ContextLink";

/** Clean canonical hrefs; search context is carried on click only. */
export function DiscoveryNavigation({
  onNavigate,
  footer = false,
}: {
  onNavigate?: () => void;
  footer?: boolean;
}) {
  return (
    <>
      {(footer
        ? [
            ["Explore trips", "/", "search"],
            ["Destination guides", "/destinations", ""],
          ]
        : [
            ["Explore trips", "/", "search"],
            ["Destinations", "/destinations", ""],
            ["How it works", "/", "how-it-works"],
            ["About", "/about", ""],
          ]
      ).map(([label, path, hash]) => (
        <ContextLink
          key={label}
          prefetch={false}
          path={path}
          hash={hash}
          onClick={onNavigate}
        >
          {label}
        </ContextLink>
      ))}
    </>
  );
}
