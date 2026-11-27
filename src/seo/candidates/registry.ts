import { userInput } from "../../domain/money/provenance";
import "server-only";
import type { SeoEditorialDefinition } from "../definition";
import { landingId, landingPath, type SeoLandingKey } from "../identity";
import { formatMoney } from "../../domain/money/currency";
import { candidateMarkets, type CandidateOrigin } from "./markets";

export type SeoCandidateDefinition = SeoEditorialDefinition & {
  stage: "candidate";
  reviews: {
    dateContract: "pending" | "reviewed";
    costAssumptions: "pending" | "reviewed";
  };
  approved?: never;
  indexable?: never;
};
type Copy = Pick<
  SeoEditorialDefinition,
  "h1" | "description" | "intro" | "questions" | "keywords"
>;
const monthlyCopy =
  "These examples compare Saturday–Monday weekend options during the displayed month. Each trip shows its actual dates; cards can use different weekends.";
/** Shared identity mechanics only; the twelve editorial intents below are explicitly written. */
function candidate(
  origin: CandidateOrigin,
  type: SeoEditorialDefinition["type"],
  copy: Copy,
): SeoCandidateDefinition {
  const market = candidateMarkets.find((m) => m.slug === origin)!;
  const key: SeoLandingKey =
    type === "budget"
      ? { locale: "en", originId: origin, intent: type, budget: market.budget }
      : { locale: "en", originId: origin, intent: type };
  const originId = landingId({
    locale: "en",
    originId: origin,
    intent: "origin",
  });
  const weekendId = landingId({
    locale: "en",
    originId: origin,
    intent: "weekend",
  });
  const budgetId = landingId({
    locale: "en",
    originId: origin,
    intent: "budget",
    budget: market.budget,
  });
  return {
    ...copy,
    title: `${copy.h1} | GoEksplo`,
    intro: `${copy.intro} ${monthlyCopy}`,
    stage: "candidate",
    reviews: { dateContract: "pending", costAssumptions: "pending" },
    id: landingId(key),
    key,
    path: landingPath(key),
    locale: "en",
    type,
    origin: market.origin,
    planningCurrency: market.budget.currency,
    exampleBudget: market.budget,
    ...(type === "budget" ? { budget: market.budget } : {}),
    dateContract: { kind: "month-weekends", monthPolicy: "next-full-month" },
    parent:
      type === "origin" ? undefined : type === "weekend" ? originId : weekendId,
    related:
      type === "origin"
        ? [weekendId, budgetId]
        : type === "weekend"
          ? [originId, budgetId]
          : [originId, weekendId],
    breadcrumb:
      type === "origin"
        ? `From ${market.origin.name}`
        : type === "weekend"
          ? "Weekend trips"
          : `Under ${formatMoney(userInput(market.budget), "en")}`,
    nearbyNote:
      "This example uses the selected city departure code. It does not compare the cost of reaching alternative departure airports; check the actual airport and ground journey before booking.",
    sections: [
      "results",
      "dates",
      "coverage",
      "value",
      "nearby",
      "methodology",
      "questions",
      "related",
    ],
  };
}

/** Tooling-only drafts. Routes and sitemap must never import this module. */
export const seoCandidateRegistry: readonly SeoCandidateDefinition[] = [
  candidate("london", "origin", {
    h1: "Trips from London by total trip budget",
    description:
      "Explore trips from London with flight evidence, stay and everyday cost estimates, plus reserved spending money. Compare the total for two adults.",
    intro:
      "Start with the money available for both travellers, then compare what remains after the flight, two nights away and everyday spending. London city searches may return different departure airports: read the route before choosing a trip.",
    keywords: {
      primary: "trips from London",
      related: [
        "where can I travel from London on a budget",
        "total trip cost from London",
      ],
    },
    questions: [
      {
        question: "Does a London search include every airport?",
        answer:
          "The city code asks the provider for London routes. Cached coverage is incomplete, and a city result is not an exhaustive airport comparison. Check the departure airport and allow for your own journey there.",
      },
      {
        question: "What if the flight price is missing?",
        answer:
          "The destination can remain an idea, but its flight is unpriced. Estimated local costs and a flight budget ceiling cannot establish that the whole trip fits.",
      },
    ],
  }),
  candidate("london", "weekend", {
    h1: "Weekend breaks from London by air",
    description:
      "Compare two-night city breaks from London across a calendar month, with actual weekend dates and whole-trip estimates for two adults.",
    intro:
      "Use a month of Saturday departures and Monday returns to compare city breaks by air. A low fare on one weekend says nothing about another: choose the card's dates or rerun the normal search for the weekend you can travel.",
    keywords: {
      primary: "weekend breaks from London",
      related: [
        "city breaks from London by air",
        "two-night breaks from London",
      ],
    },
    questions: [
      {
        question: "Are all these breaks on one weekend?",
        answer:
          "No. Each card uses its own supported Saturday–Monday dates in the example month. Select specific dates in the planner if everyone must travel on the same weekend.",
      },
      {
        question: "Do two nights guarantee two full days away?",
        answer:
          "No. This comparison does not assess flight times or time at the destination. Check the actual itinerary, airport journey and Monday commitments before booking.",
      },
    ],
  }),
  candidate("london", "budget", {
    h1: "Weekend trips from London under £500 for two",
    description:
      "Test a £500 whole-party weekend budget from London: recent matching flight evidence, estimated stay and daily costs, plus a safety buffer.",
    intro:
      "£500 is the total available for two adults, not a per-person fare. Compare the full budget needed for two nights, including reserved money, and use the cost breakdown to judge which allowances suit your plans.",
    keywords: {
      primary: "weekend trips from London under £500",
      related: ["London weekend budget for two", "city breaks within £500"],
    },
    questions: [
      {
        question: "What does the £500 limit include?",
        answer:
          "It includes the party's flight, estimated accommodation, food, destination transport and activities, plus a safety buffer. Selected baggage would cost extra; the example does not include it or travel to the departure airport.",
      },
      {
        question: "Can I book every part for the displayed total?",
        answer:
          "The total is a planning calculation. Only the matching cached flight has provider fare evidence; other costs are allowances. Confirm accommodation and flight prices before committing money.",
      },
    ],
  }),
  candidate("manchester", "origin", {
    h1: "Trips from Manchester by total budget",
    description:
      "Plan trips from Manchester around the whole-party budget, combining matching flight evidence with two-night stay and everyday spending estimates.",
    intro:
      "Compare departures from Manchester by the money needed for the whole break. Two flights are only the starting point: the example also allows for a room, meals, local journeys, activities and a reserve for two adults.",
    keywords: {
      primary: "trips from Manchester",
      related: [
        "Manchester budget travel ideas",
        "whole-trip planning from Manchester",
      ],
    },
    questions: [
      {
        question: "Does a missing destination mean there are no flights?",
        answer:
          "No. This is a bounded selection from cached provider data. Routes without useful matching evidence may be absent even when an airline sells them.",
      },
      {
        question: "Can I start from a different airport?",
        answer:
          "Change the origin in the normal planner. These Manchester examples do not claim to compare nearby airports or include the cost of travelling to one.",
      },
    ],
  }),
  candidate("manchester", "weekend", {
    h1: "Weekend city breaks from Manchester",
    description:
      "Compare Saturday–Monday city breaks by air from Manchester across the example month. Each result keeps its actual dates and full budget estimate.",
    intro:
      "Find two-night city-break ideas by air without assuming the same weekend works for every destination. Compare supported options across a calendar month, then narrow the dates to fit the time you actually have away.",
    keywords: {
      primary: "city breaks from Manchester",
      related: [
        "weekend breaks from Manchester",
        "two-night trips from Manchester",
      ],
    },
    questions: [
      {
        question: "Why do the cards have different dates?",
        answer:
          "The example allows any Saturday–Monday weekend departing within the selected month. GoEksplo keeps the dates attached to the matching fare instead of assigning that price to another weekend.",
      },
      {
        question: "Will an overnight flight work for a short break?",
        answer:
          "The budget comparison does not validate flight times or usable hours away. Inspect the provider itinerary, connections and arrival times before deciding whether two nights are practical.",
      },
    ],
  }),
  candidate("manchester", "budget", {
    h1: "Weekend trips from Manchester under £500 for two",
    description:
      "Compare a £500 total budget for two adults leaving Manchester, with flight evidence, estimated local costs and an explicit safety reserve.",
    intro:
      "Treat £500 as the ceiling for the whole party's weekend, including the reserve. A fare that looks affordable on its own may leave too little for a room and meals; the complete breakdown makes that trade-off visible.",
    keywords: {
      primary: "weekend trips from Manchester under £500",
      related: [
        "Manchester city break budget for two",
        "affordable Manchester weekend breaks",
      ],
    },
    questions: [
      {
        question: "Is £500 per person?",
        answer:
          "No. The example is £500 for two adults together, for two nights, including the safety buffer. Change the party size in the planner to recalculate.",
      },
      {
        question: "What happens when no complete trip fits?",
        answer:
          "The summary should say that no supported complete trip fits. An unpriced flight idea or a fare for the wrong dates must not be presented as an affordable result.",
      },
    ],
  }),
  candidate("dublin", "origin", {
    h1: "Trips from Dublin by total trip budget",
    description:
      "Explore Dublin departures using matching flight evidence and estimates for accommodation, food, local transport and activities for two adults.",
    intro:
      "Choose a budget for the whole trip before choosing a destination. These Dublin examples connect flight evidence to the costs of two nights away, so you can compare what is priced, what is estimated and what remains unknown.",
    keywords: {
      primary: "trips from Dublin",
      related: [
        "where to travel from Dublin on a budget",
        "Dublin whole-trip estimates",
      ],
    },
    questions: [
      {
        question: "Does the example cover every destination from Dublin?",
        answer:
          "No. The provider's cached fares and a bounded destination shortlist determine coverage. The number checked is the number actually evaluated, not the full route network.",
      },
      {
        question: "Will the same results work in December?",
        answer:
          "Do not assume so. Fare coverage, accommodation costs and travel demand can change by month. Use a new search for December rather than carrying over a previous month's prices.",
      },
    ],
  }),
  candidate("dublin", "weekend", {
    h1: "Weekend city breaks from Dublin",
    description:
      "Compare two-night city breaks by air from Dublin across the example month, keeping each trip's actual weekend and complete budget calculation.",
    intro:
      "Compare city breaks by air for a Saturday departure and Monday return. The month gives several possible weekends; the card's dates tell you which one has matching evidence. Check the travel schedule before treating it as a workable short break.",
    keywords: {
      primary: "city breaks from Dublin",
      related: ["weekend trips from Dublin", "two-night Dublin departures"],
    },
    questions: [
      {
        question: "Can I compare just one weekend?",
        answer:
          "Yes. Choose fixed dates in the normal planner. Fares for other weekends then become reference information rather than prices for that trip.",
      },
      {
        question: "Are these package holidays?",
        answer:
          "No. GoEksplo combines a matching cached flight observation with separate planning allowances. The estimates are not a bundled offer, and accommodation must be checked separately.",
      },
    ],
  }),
  candidate("dublin", "budget", {
    h1: "Weekend trips from Dublin under €500 for two",
    description:
      "See how a €500 whole-party budget compares with two-night Dublin departures, including flight evidence, estimated daily costs and a safety buffer.",
    intro:
      "€500 covers both adults in this two-night planning example. Compare the budget needed after adding stay and daily allowances to the flight, with reserve money kept separate from expected spending. A fit depends on the card's actual dates.",
    keywords: {
      primary: "weekend trips from Dublin under €500",
      related: [
        "Dublin city breaks budget for two",
        "two-night trips within €500",
      ],
    },
    questions: [
      {
        question: "Does €500 include money set aside for changes?",
        answer:
          "Yes. The budget-needed figure includes the safety buffer. It is reserved money rather than expected spending and does not guarantee that later price changes will be covered.",
      },
      {
        question: "Can a cheaper reference fare make a trip fit?",
        answer:
          "No. A fare for dates outside an allowed weekend cannot price that result. Without a matching fare, GoEksplo cannot confirm a complete budget fit.",
      },
    ],
  }),
  candidate("chicago", "origin", {
    h1: "Trips from Chicago by plane and total budget",
    description:
      "Explore trips by plane from Chicago using whole-party budget calculations for flights, two nights, everyday costs and a safety reserve.",
    intro:
      "Start with the budget for two people flying from Chicago. This comparison focuses on trips by plane, with estimated destination costs added to matching flight evidence; it is not a guide to regional drives or rail getaways.",
    keywords: {
      primary: "trips from Chicago by plane",
      related: [
        "where to fly from Chicago on a budget",
        "Chicago whole-trip flight planning",
      ],
    },
    questions: [
      {
        question: "Does this compare driving with flying?",
        answer:
          "No. These candidates answer flight-led trip discovery. They do not calculate the value of driving or rail alternatives for a Chicago weekend.",
      },
      {
        question: "Which Chicago airport will I use?",
        answer:
          "The city code requests Chicago routes, but coverage is not exhaustive. Read the airport on the provider itinerary and account for your own journey to it before booking.",
      },
    ],
  }),
  candidate("chicago", "weekend", {
    h1: "Weekend trips from Chicago by plane",
    description:
      "Compare weekend getaways you can fly to from Chicago, using Saturday–Monday dates across a month and whole-party estimates for two adults.",
    intro:
      "Look for weekend getaways by plane from Chicago, with two nights at the destination. Different cards may suit different weekends. The calculation compares cost, not departure times, connection quality or a promise of two full days away.",
    keywords: {
      primary: "weekend trips from Chicago by plane",
      related: [
        "weekend getaways to fly to from Chicago",
        "two-night flight trips from Chicago",
      ],
    },
    questions: [
      {
        question: "Do these getaways avoid taking leave?",
        answer:
          "Not necessarily. The example returns on Monday, and flight times may affect work or other commitments. Check the actual itinerary and your schedule.",
      },
      {
        question: "Are all routes nonstop?",
        answer:
          "No nonstop claim is made. Review stops, flight duration, airports and fare conditions on the provider website before choosing a weekend trip.",
      },
    ],
  }),
  candidate("chicago", "budget", {
    h1: "Weekend flights and stays from Chicago under $1,200",
    description:
      "Test $1,200 for two adults flying from Chicago for two nights, including stay, food, local transport, activities and a reserve in the total.",
    intro:
      "$1,200 is the whole-party planning budget for a weekend trip by plane from Chicago. It covers two adults and two nights, with estimated destination costs and a reserve. It is not a flight-only ceiling or a package booking price.",
    keywords: {
      primary: "weekend flights and stays from Chicago",
      related: [
        "Chicago weekend trips by plane under $1,200",
        "whole-party Chicago weekend budget",
      ],
    },
    questions: [
      {
        question: "What does the $1,200 budget pay for?",
        answer:
          "The example includes matching flight evidence for two adults, a stay allowance, food, destination transport, activities and a reserve. Baggage is unselected, and the journey to the Chicago departure airport is not included.",
      },
      {
        question: "Does a complete calculation confirm availability?",
        answer:
          "No. A matching recent fare is cached evidence. Accommodation and other costs remain estimates; both the itinerary and current prices need checking before booking.",
      },
    ],
  }),
];
