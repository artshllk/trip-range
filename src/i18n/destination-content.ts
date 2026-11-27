import type {
  AttractionKind,
  ContentSource,
} from "../domain/destination-content/types";
import type { Locale } from "./config";

const labels = {
  en: {
    days: "Your trip",
    day: (n: number) => `Day ${n}`,
    arrival: "Arrival · optional first stop",
    departure: "Departure · only if time permits",
    visitSite: "Official visitor information",
    genericStops: ["Arrival and free time", "Explore", "Journey home"],
    readMore: "Read more",
    morePlaces: (count: number) =>
      `+ ${count} more ${count === 1 ? "place" : "places"}`,
    moreTransport: "More transport details",
    moreNotes: "More useful details",
    placeDetails: "Place details",
    outline: "Trip outline",
    generic: "General planning outline",
    reusable: "Suggested stops for this stay",
    places: "Places worth seeing",
    transport: "Getting around",
    goodFor: "Good for",
    tradeoffs: "Keep in mind",
    checked: "Checked",
    observed: "Observed price",
    reference: "For reference only; does not change your trip budget.",
    sources: "Destination content",
    source: "Source",
    minutes: "min",
    suitable: (nights: number) => `Suitable for a ${nights}-night stay`,
  },
  sq: {
    days: "Udhëtimi yt",
    day: (n: number) => `Dita ${n}`,
    arrival: "Mbërritja · ndalesë e parë fakultative",
    departure: "Nisja · vetëm nëse ka kohë",
    visitSite: "Informacioni zyrtar për vizitorë",
    genericStops: [
      "Mbërritja dhe koha e lirë",
      "Eksplorimi",
      "Kthimi në shtëpi",
    ],
    readMore: "Lexo më shumë",
    morePlaces: (count: number) =>
      `+ ${count} ${count === 1 ? "vend tjetër" : "vende të tjera"}`,
    moreTransport: "Më shumë për transportin",
    moreNotes: "Më shumë detaje të dobishme",
    placeDetails: "Detaje për vendet",
    outline: "Skica e udhëtimit",
    generic: "Skicë e përgjithshme planifikimi",
    reusable: "Ndalesa të sugjeruara për këtë qëndrim",
    places: "Vende që ia vlen të shohësh",
    transport: "Si të lëvizësh",
    goodFor: "E përshtatshme për",
    tradeoffs: "Ki parasysh",
    checked: "Kontrolluar më",
    observed: "Çmim i vëzhguar",
    reference: "Vetëm për referencë; nuk ndryshon buxhetin e udhëtimit tënd.",
    sources: "Informacioni për destinacionin",
    source: "Burimi",
    minutes: "min",
    suitable: (nights: number) =>
      `E përshtatshme për një qëndrim me ${nights} net`,
  },
};
export const destinationContentText = (locale: Locale) => labels[locale];

export function attractionKindText(kind: AttractionKind, locale: Locale) {
  const text: Record<AttractionKind, { en: string; sq: string }> = {
    landmark: { en: "Landmark", sq: "Pikë referimi" },
    museum: { en: "Museum", sq: "Muze" },
    "historic-site": { en: "Historic site", sq: "Vend historik" },
    "religious-site": { en: "Religious site", sq: "Vend fetar" },
    park: { en: "Park", sq: "Park" },
    viewpoint: { en: "Viewpoint", sq: "Pikë panoramike" },
    market: { en: "Market", sq: "Treg" },
    beach: { en: "Beach", sq: "Plazh" },
    nature: { en: "Nature", sq: "Natyrë" },
    district: { en: "District", sq: "Lagje" },
    other: { en: "Place", sq: "Vend" },
  };
  return text[kind][locale];
}

export function contentSourceTypeText(
  type: ContentSource["type"],
  locale: Locale,
) {
  const text = {
    official: { en: "Official source", sq: "Burim zyrtar" },
    wikidata: { en: "Wikidata", sq: "Wikidata" },
    openstreetmap: { en: "OpenStreetMap", sq: "OpenStreetMap" },
    "internal-reviewed": {
      en: "Reviewed editorial source",
      sq: "Burim editorial i rishikuar",
    },
  };
  return text[type][locale];
}

/** Pin display to EN/SQ to avoid browser/server ICU differences. */
export function contentDateText(instant: string, locale: Locale) {
  const months =
    locale === "sq"
      ? [
          "jan",
          "shk",
          "mar",
          "pri",
          "maj",
          "qer",
          "korr",
          "gush",
          "sht",
          "tet",
          "nën",
          "dhj",
        ]
      : [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
  return `${Number(instant.slice(8, 10))} ${months[Number(instant.slice(5, 7)) - 1]} ${instant.slice(0, 4)}`;
}
