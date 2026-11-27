"use client";
import { useEffect, useRef, useState } from "react";
import type { DestinationCard } from "@/domain/destination-discovery";
import {
  discoveryStyles,
  discoveryRequestQuery,
} from "@/domain/destination-discovery";
import type { TripRequest, TravelLocation } from "@/domain/types";
import type { Dictionary } from "@/i18n/dictionaries";
import { HeroMedia } from "../travel/HeroMedia";
import { SearchBar, type SearchStyleControl } from "../travel/SearchBar";
import { HomeDestinationGuides } from "./HomeDestinationGuides";
import { TravelStyleArt } from "./TravelStyleArt";

export function HomeExperience({
  initial,
  today,
  cards,
  targets,
  t,
}: {
  initial: TripRequest;
  today: string;
  cards: DestinationCard[];
  targets: Record<string, TravelLocation | undefined>;
  t: Dictionary;
}) {
  const [request, setRequest] = useState(initial);
  const styleControl = useRef<SearchStyleControl>(null);
  const query = discoveryRequestQuery(request);
  const serialized = new URLSearchParams(
    query as Record<string, string>,
  ).toString();
  const previous = useRef(serialized);
  useEffect(() => {
    if (previous.current === serialized) return;
    previous.current = serialized;
    // Replace only this homepage history entry. The existing serializer owns all keys.
    // Native history keeps navigation links in sync without a server fetch per field edit.
    const url = new URL(window.location.href);
    url.search = serialized;
    window.history.replaceState(window.history.state, "", url);
  }, [serialized]);
  return (
    <>
      <section className="hero discovery-hero">
        <HeroMedia
          poster="/demo/hero.jpg"
          mobilePoster="/demo/hero-portrait.jpg"
        />
        <div className="hero-shade" />
        <div id="search" className="hero-content shell">
          <h1>
            Tell us your budget.
            <br className="home-headline-break" /> We’ll find the trip.
          </h1>
          <p className="discovery-hero-intro">
            One total for everyone going.{" "}
            <span>
              See where it can take you, what the whole trip is likely to cost
              and what still needs checking.
            </span>
          </p>
          <SearchBar
            initial={initial}
            today={today}
            locale="en"
            t={t}
            home
            onDraftChange={setRequest}
            styleControl={styleControl}
          />
        </div>
      </section>
      <section
        className="shell discovery-styles"
        aria-labelledby="styles-title"
      >
        <div>
          <h2 id="styles-title">What kind of trip?</h2>
          <p>Pick your pace. We’ll keep it in mind when you search.</p>
        </div>
        <div className="discovery-style-options">
          {discoveryStyles.map((style) => (
            <button
              key={style.id}
              type="button"
              className={`discovery-style home-style-${style.id}`}
              aria-pressed={request.styles.includes(style.id)}
              onClick={() => {
                styleControl.current?.toggleStyle(style.id);
                document.getElementById("search")?.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "instant"
                    : "smooth",
                });
              }}
            >
              <TravelStyleArt style={style.id} />
              <strong>
                {style.name} <span aria-hidden="true">↗</span>
              </strong>
              <span>{style.description}</span>
            </button>
          ))}
        </div>
        <p className="small discovery-style-status" role="status">
          {request.styles.length
            ? `Selected: ${request.styles.map((style) => t[style]).join(", ")}. Your search above keeps your other choices.`
            : "Your departure airport is always your choice."}
        </p>
      </section>
      <HomeDestinationGuides cards={cards} targets={targets} />
    </>
  );
}
