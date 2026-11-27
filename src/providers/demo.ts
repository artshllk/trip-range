import { planningCostPolicy } from "../domain/money/planning-rates";
import { roadOriginId } from "../domain/locations";
import type { Destination, ImageAsset, PriceQuote } from "../domain/types";
import type { TravelProviders } from "./contracts";
import { findLocation } from "../catalogue/locations";
import { money } from "../domain/budget";
const rows = [
  [
    "rugova",
    "Rugova Valley",
    "Lugina e Rugovës",
    "Kosovo",
    "Kosova",
    1.5,
    "nature,quiet",
    30,
    100,
    "canyon",
  ],
  [
    "prizren",
    "Prizren",
    "Prizreni",
    "Kosovo",
    "Kosova",
    1,
    "city",
    20,
    110,
    "van-portrait",
  ],
  [
    "mirusha",
    "Mirusha Waterfalls",
    "Ujëvarat e Mirushës",
    "Kosovo",
    "Kosova",
    0.8,
    "nature,quiet",
    15,
    80,
    "canyon",
  ],
  [
    "brezovica",
    "Brezovica",
    "Brezovica",
    "Kosovo",
    "Kosova",
    1.3,
    "nature,quiet",
    25,
    105,
    "canyon",
  ],
  [
    "mavrovo",
    "Mavrovo",
    "Mavrova",
    "North Macedonia",
    "Maqedonia e Veriut",
    2,
    "nature,quiet",
    45,
    105,
    "canyon",
  ],
  [
    "skopje",
    "Skopje",
    "Shkupi",
    "North Macedonia",
    "Maqedonia e Veriut",
    1.3,
    "city",
    35,
    100,
    "van-portrait",
  ],
  [
    "ohrid",
    "Ohrid",
    "Ohri",
    "North Macedonia",
    "Maqedonia e Veriut",
    3,
    "nature,quiet",
    60,
    180,
    "beach",
  ],
  [
    "ulcinj",
    "Ulcinj",
    "Ulqini",
    "Montenegro",
    "Mali i Zi",
    3.7,
    "beach,quiet",
    65,
    190,
    "beach",
  ],
  [
    "thessaloniki",
    "Thessaloniki",
    "Selaniku",
    "Greece",
    "Greqia",
    5,
    "city,beach",
    90,
    230,
    "beach",
  ],
  [
    "crete",
    "Crete",
    "Kreta",
    "Greece",
    "Greqia",
    2.8,
    "beach,quiet",
    null, // Flight price requires provider evidence; no demo airfare.
    200,
    "beach",
  ],
] as const;
function image(id: string, name: string): ImageAsset {
  return {
    src: `/demo/${name}.png`,
    source: "design-reference",
    sourceId: `img/${name}.png`,
    author: null,
    attribution: "Supplied design reference; illustrative demo image",
    license: null,
    destinationId: id,
    verification: "illustrative",
  };
}
const destinations: Destination[] = rows.map((r) => ({
  id: r[0],
  name: { en: r[1], sq: r[2] },
  country: { en: r[3], sq: r[4] },
  travelHours: r[5],
  styles: r[6].split(",") as Destination["styles"],
  countryCode:
    r[3] === "Kosovo"
      ? "XK"
      : r[3] === "North Macedonia"
        ? "MK"
        : r[3] === "Montenegro"
          ? "ME"
          : "GR",
  requiresFlight: r[0] === "crete",
  image: image(r[0], r[9]),
  why: r[6].includes("city")
    ? {
        en: "A compact city break, local food and time to wander. A simple stay keeps more of your budget for the experience.",
        sq: "Një pushim në qytet, ushqim lokal dhe kohë për shëtitje. Akomodimi i thjeshtë lë më shumë për përvojën.",
      }
    : {
        en: "A change of scenery without a packed schedule. Time outdoors, a relaxed stay and every part of the trip accounted for.",
        sq: "Ndryshim ambienti pa orar të ngarkuar. Kohë në natyrë, qëndrim i qetë dhe çdo pjesë e udhëtimit e llogaritur.",
      },
}));
function quote(
  euros: number,
  confidence: PriceQuote["confidence"],
): PriceQuote {
  return {
    amount: money(Math.round(euros * 100), "EUR"),
    confidence,
    source: { status: "available" },
    providerId: "local-demo",
    observedAt: confidence === "estimate" ? null : "2026-10-05T08:00:00Z",
    demo: true,
  };
}
function isRoadOrigin(request: import("../domain/types").TripRequest) {
  const origin = request.origin ?? findLocation(request.originId);
  return origin ? roadOriginId(origin) : undefined;
}
export const demoProviders: TravelProviders = {
  locations: {
    async get(id) {
      return findLocation(id);
    },
  },
  destinations: {
    async list() {
      return destinations;
    },
  },
  transport: {
    async quote(request, d) {
      if (!isRoadOrigin(request) || d.requiresFlight) {
        return {
          status: "available",
          value: {
            mode: "flight",
            flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
          },
        };
      }
      const roadEuros = rows.find((row) => row[0] === d.id)?.[7];
      if (typeof roadEuros !== "number")
        return { status: "unavailable", reason: "unsupported-road-route" };
      const factor =
        request.originId === "prizren"
          ? 0.85
          : request.originId === "skopje"
            ? 0.8
            : 1;
      return {
        status: "available",
        value: {
          mode: "road",
          price:
            request.budget.currency === "EUR"
              ? quote(roadEuros * factor, "estimate")
              : {
                  ...quote(0, "estimate"),
                  amount: money(
                    planningCostPolicy[request.budget.currency].roadVehicle,
                    request.budget.currency,
                  ),
                },
        },
      };
    },
  },
  stays: {
    async quote(_request, d) {
      if (_request.budget.currency !== "EUR")
        return {
          status: "available",
          value: {
            ...quote(0, "estimate"),
            amount: money(
              planningCostPolicy[_request.budget.currency].stayTwoNights,
              _request.budget.currency,
            ),
          },
        };
      return {
        status: "available",
        value: quote(rows.find((r) => r[0] === d.id)![8], "recent"),
      };
    },
  },
  images: {
    async forDestination() {
      return undefined; // Demo artwork is not an approved destination selection.
    },
  },
  places: {
    async itinerary(d, nights) {
      return Array.from({ length: nights + 1 }, (_, i) => ({
        en:
          i === 0
            ? `Arrive in ${d.name.en}, settle in and take a short walk.`
            : i === nights
              ? "A slow breakfast, one last walk and the journey home."
              : d.styles.includes("city")
                ? "Explore the old town, stop for lunch and leave the afternoon open."
                : "Spend the day outdoors, with an easy walk and a relaxed local lunch.",
        sq:
          i === 0
            ? `Mbërritja në ${d.name.sq}, akomodimi dhe një shëtitje e shkurtër.`
            : i === nights
              ? "Mëngjes i qetë, një shëtitje e fundit dhe kthimi në shtëpi."
              : d.styles.includes("city")
                ? "Eksploro qytetin e vjetër, ndalo për drekë dhe lëre pasditen të lirë."
                : "Kalo ditën në natyrë, me një shëtitje të lehtë dhe drekë lokale.",
      }));
    },
  },
};
