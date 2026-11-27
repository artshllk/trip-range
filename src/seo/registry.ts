import {
  landingId,
  landingPath,
  type SeoPageId,
  type SeoLandingKey,
} from "./identity";
import { approvedLandingKeys } from "./approved-keys";
import { primaryOriginId } from "../domain/market/primary-origin";
import { nearbyNote } from "./content";
export type { SeoPageId } from "./identity";
import { locations } from "../catalogue/locations";
export const siteUrl = "https://www.trip-range.com";
/**
 * hreflang: English is the only served language, so it is both the `en` and
 * the `x-default` target. Add a locale here only when its page really exists.
 */
/** Absolute URL for a public path; the homepage is the bare origin, as Next renders it. */
export function absoluteUrl(path: string) {
  return path === "/" ? siteUrl : siteUrl + path;
}
export function languageAlternates(url: string) {
  return { en: url, "x-default": url };
}
/** Public homepage per locale: English at the root, other locales prefixed. */
export const homePaths = { en: "/", sq: "/sq" } as const;
/** Only English is published; legacy paths remain available for redirect mapping. */
export const coreSeoRegistry = [
  // No lastmod: the homepage has no editorial review date to report.
  { id: "home", paths: homePaths, indexable: true },
] as const;

export type { SeoSection } from "./definition";
import type { SeoEditorialDefinition } from "./definition";
/** Indexing is not a field here: see the stored decisions in ./indexing. */
export type SeoLandingDefinition = SeoEditorialDefinition & {
  approved: boolean;
};
const publication = (key: SeoLandingKey) => ({
  key,
  dateContract: { kind: "fixed-weekend" } as const,
  id: landingId(key),
  path: landingPath(key),
  approved: approvedLandingKeys.some((k) => landingId(k) === landingId(key)),
});
const originKey: SeoLandingKey = {
  locale: "en",
  originId: "zurich",
  intent: "origin",
};
const weekendKey: SeoLandingKey = {
  locale: "en",
  originId: "zurich",
  intent: "weekend",
};
const budgetKey: SeoLandingKey = {
  locale: "en",
  originId: "zurich",
  intent: "budget",
  budget: { cents: 50000, currency: "EUR" },
};
const zurich = locations.find((l) => l.id === "zurich")!;
const hubKey = (originId: string): SeoLandingKey => ({
  locale: "en",
  originId,
  intent: "origin",
});
/** Publication is explicit. These three definitions do not authorize other origins or budgets. */
export const seoLandingRegistry: readonly SeoLandingDefinition[] = [
  {
    ...publication(originKey),
    planningCurrency: "EUR",
    exampleBudget: { cents: 70000, currency: "EUR" },
    nearbyNote,
    locale: "en",
    type: "origin",
    origin: zurich,
    title: "Trips From Zurich That Fit Your Budget — Trip Range",
    h1: "Trips from Zurich that fit your budget",
    description:
      "Explore trips from Zurich by total budget: flights, stay, food, local transport, activities and a safety buffer. Adjust the search to your plans.",
    intro:
      "Start with what you can spend on the whole trip. Compare Zurich departures with accommodation and everyday costs included, then adjust the dates, travellers and budget in the same Trip Range search.",
    breadcrumb: "From Zurich",
    related: [landingId(weekendKey), landingId(budgetKey)],
    sections: [
      "results",
      "budgets",
      "nearby",
      "methodology",
      "questions",
      "related",
    ],
    keywords: {
      primary: "trips from Zurich",
      related: [
        "where can I travel from Zurich",
        "trips from Zurich on a budget",
      ],
    },
    questions: [
      {
        question: "Where can I travel from Zurich on a budget?",
        answer:
          "The options above reflect the dates, party size and planning assumptions shown. A low flight fare alone does not establish an affordable trip: compare the budget needed, which also reserves a safety buffer.",
      },
      {
        question: "Can I use a different budget or travel with more people?",
        answer:
          "Yes. Change the budget or travellers in the search. Trip Range recalculates the same cost categories in the normal planner; these example amounts are not a per-person price promise.",
      },
    ],
  },
  {
    ...publication(weekendKey),
    planningCurrency: "EUR",
    exampleBudget: { cents: 70000, currency: "EUR" },
    nearbyNote,
    locale: "en",
    type: "weekend",
    origin: zurich,
    title: "Weekend Trips From Zurich — Trip Range",
    h1: "Weekend trips from Zurich",
    description:
      "Compare weekend trips from Zurich with complete-trip estimates for flights, stay, food and local transport, plus a safety buffer.",
    intro:
      "A weekend break needs more than a flight price. These two-night examples use the displayed travel dates and show how much to set aside for the trip as a whole. Change the dates before choosing a plan.",
    parent: landingId(originKey),
    breadcrumb: "Weekend trips",
    related: [landingId(originKey), landingId(budgetKey)],
    sections: [
      "results",
      "dates",
      "budgets",
      "nearby",
      "methodology",
      "questions",
      "related",
    ],
    keywords: {
      primary: "weekend trips from Zurich",
      related: [
        "cheap weekend trips from Zurich",
        "weekend breaks from Zurich",
      ],
    },
    questions: [
      {
        question: "Which dates do the weekend examples use?",
        answer:
          "The example search starts with Trip Range’s next Saturday departure and a Monday return, for two nights. Each card shows its actual dates. You can choose another weekend or a different length in the normal search.",
      },
      {
        question: "Will a nearby-date fare change my weekend automatically?",
        answer:
          "No. With exact dates, only matching fares can price the flight. A monthly fare for other dates remains reference information. If you explicitly enable flexibility, valid alternatives show their actual dates.",
      },
    ],
  },
  {
    ...publication(budgetKey),
    planningCurrency: "EUR",
    exampleBudget: { cents: 50000, currency: "EUR" },
    nearbyNote,
    locale: "en",
    type: "budget",
    origin: zurich,
    budget: { cents: 50000, currency: "EUR" },
    title: "Weekend Trips From Zurich Under €500 — Trip Range",
    h1: "Weekend trips from Zurich under €500",
    description:
      "Compare weekend trips from Zurich using estimated total trip cost, including flights, stay, food, local transport and a safety buffer within €500.",
    intro:
      "Where can a €500 total budget take you for a weekend? Compare complete-trip estimates for two adults and two nights. The limit includes the safety buffer, so a €500 flight alone would not fit.",
    parent: landingId(weekendKey),
    breadcrumb: "Under €500",
    related: [landingId(originKey), landingId(weekendKey)],
    sections: [
      "results",
      "coverage",
      "value",
      "nearby",
      "methodology",
      "questions",
      "related",
    ],
    keywords: {
      primary: "weekend trips from Zurich under €500",
      related: [
        "cheap weekend trips from Zurich",
        "where to travel from Zurich for €500",
        "budget weekend trips from Zurich",
        "affordable city breaks from Zurich",
      ],
    },
    questions: [
      {
        question: "Is €500 enough for a weekend trip from Zurich?",
        answer:
          "The current calculation above answers for the displayed dates and two-adult example. If no complete plan fits, Trip Range says so. Different dates, party sizes or accommodation choices can change the result; a match is still a planning estimate, not a confirmed offer.",
      },
      {
        question: "Does €500 mean per person or the whole trip?",
        answer:
          "It is the total budget for everyone in the example, including the safety buffer. Flight fares may originate as per-traveller quotes, but Trip Range calculates the party total before comparing it with the budget.",
      },
      {
        question: "What happens if the flight price changes?",
        answer:
          "Recheck the flight on the provider website before booking. A recent cached fare can change or disappear. Accommodation, food and other local costs remain Trip Range estimates, and the buffer is not a guarantee against every price change.",
      },
    ],
  },
  {
    ...publication(hubKey(primaryOriginId)),
    planningCurrency: "EUR",
    exampleBudget: { cents: 60000, currency: "EUR" },
    nearbyNote:
      "All flights in this planner leave Tirana International Airport (TIA).",
    locale: "en",
    type: "origin",
    origin: locations.find((l) => l.id === primaryOriginId)!,
    title: "Two-night trips from Tirana — Trip Range",
    h1: "Two-night trips from Tirana",
    description:
      "Find two-night trips from Tirana for two adults. Compare the departure dates, arrival airports and return fares seen this month and next.",
    intro:
      "Choose a departure month to see where two people can fly for two nights and which dates have a recent return fare.",
    breadcrumb: "From Tirana",
    related: [],
    sections: [
      "dates",
      "results",
      "coverage",
      "methodology",
      "questions",
      "related",
    ],
    keywords: {
      primary: "trips from Tirana",
      related: ["two-night flights from Tirana"],
    },
    questions: [
      {
        question: "Can we leave on a weekday?",
        answer:
          "Yes. Every departure day in the selected month is eligible. A two-night stay can return in the following month.",
      },
      {
        question: "What does the fare cover?",
        answer:
          "The return flight from Tirana for two, using twice the observed single-adult fare. Confirm the seats, baggage and price with the provider.",
      },
    ],
  },
];
export const launchHubIds = [landingId(hubKey(primaryOriginId))];
export function approvedLanding(path: string) {
  return seoLandingRegistry.find((p) => p.path === path && p.approved);
}
export function landingById(id: SeoPageId) {
  return seoLandingRegistry.find((p) => p.id === id && p.approved);
}
export function relatedLandings(page: SeoLandingDefinition) {
  return page.related.flatMap((id) => {
    const p = landingById(id);
    return p ? [p] : [];
  });
}
export function canonicalFor(page: SeoLandingDefinition) {
  return siteUrl + page.path;
}
export const originPriorities = [
  "Zurich",
  "London",
  "Basel",
  "Geneva",
  "Vienna",
] as const;
/** Reserved families with no page yet: the bare /from index and research assets. */
export const reservedSeoFamilies = ["/from", "/research"] as const;
