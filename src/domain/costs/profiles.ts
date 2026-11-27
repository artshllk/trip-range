import type { DestinationCostProfile } from "./types";
/** Offline reviewed source normalization. Partial destination baskets; missing components remain general estimates.
 * Evidence: docs/seo/evidence/costs/tier-a-baskets-2026-10-08-v2.json. No runtime parsing or network.
 */
export const destinationCostProfiles: readonly DestinationCostProfile[] = [
  {
    id: "belfast-gbp-v2",
    revision: "2026-10-08",
    destinationId: "city:BFS",
    countryCode: "GB",
    currency: "GBP",
    reviewStatus: "reviewed",
    reviewedAt: "2026-10-08",
    reviewAfter: "2026-12-07",
    maxNights: 2,
    costs: {
      stay: {
        amount: { cents: 14000, currency: "GBP" },
        unit: "room-night",
        basket: {
          en: "Standard private-room allowance for two adults, rounded from three Belfast room observations for 28–30 November 2026 (£125–£136.50 per night, taxes and fees shown included). Not bookable inventory; other dates, room types and cancellation terms can cost more.",
          sq: "Shumë për dhomë private standarde për dy të rritur, e rrumbullakosur nga tri vëzhgime në Belfast për 28–30 nëntor 2026 (£125–£136.50 për natë, me taksat dhe tarifat e shfaqura). Jo inventar për rezervim; datat, dhomat dhe anulimi mund të kushtojnë më shumë.",
        },
        sourceIds: ["belfast-rooms-november"],
      },
      food: {
        amount: { cents: 5500, currency: "GBP" },
        unit: "person-day",
        basket: {
          en: "Rounded adult daily basket: light breakfast, burger lunch with fries and a soft drink, casual dinner and two extra soft drinks. Based on Harlem and Bunsen menu examples, not a city average or a promise of every meal. Breakfast included in a room may reduce spending.",
          sq: "Shumë ditore e rrumbullakosur për të rritur: mëngjes i lehtë, hamburger me patate dhe pije, darkë e thjeshtë dhe dy pije shtesë. Bazuar në shembuj nga menutë Harlem dhe Bunsen, jo mesatare qyteti apo garanci për çdo vakt. Mëngjesi i përfshirë në dhomë mund ta ulë shpenzimin.",
        },
        sourceIds: ["harlem-menu", "bunsen-hill-st-menu"],
      },
      activities: {
        amount: { cents: 1000, currency: "GBP" },
        unit: "person-night",
        basket: {
          en: "£10 per person per night toward optional paid sightseeing. Two nights reserve £20, informed by Crumlin Road Gaol's £18.50 adult admission. One night provides only a contribution. Free sightseeing has no admission allowance charged to it.",
          sq: "£10 për person për natë për vizita fakultative me pagesë. Dy net japin £20, bazuar në hyrjen £18.50 për të rritur në Crumlin Road Gaol. Një natë mbulon vetëm një pjesë. Shëtitjet falas nuk llogariten si hyrje me pagesë.",
        },
        sourceIds: ["crumlin-gaol-admission"],
      },
      localTransport: {
        amount: { cents: 400, currency: "GBP" },
        unit: "person-day",
        basket: {
          en: "One adult mLink Metro/Glider day ticket per person per day. City network only; airport journeys separate. Child discounts are not modelled.",
          sq: "Një biletë ditore mLink Metro/Glider për të rritur për person në ditë. Vetëm rrjeti urban; aeroporti llogaritet veç. Uljet për fëmijë nuk modelohen.",
        },
        sourceIds: ["translink-mlink"],
      },
    },
    sourceReferences: [
      {
        id: "belfast-rooms-november",
        url: "https://www.expedia.co.uk/Hotel-Search?destination=Belfast&regionId=6034919&startDate=2026-11-28&endDate=2026-11-30&adults=2&rooms=1",
        type: "accommodation-observation",
        checkedAt: "2026-10-08",
      },
      {
        id: "harlem-menu",
        url: "https://www.harlemcafebelfast.com/menu",
        type: "official-menu",
        checkedAt: "2026-10-08",
      },
      {
        id: "bunsen-hill-st-menu",
        url: "https://order.toasttab.com/online/bunsen-belfast-hill-st-6-8-hill-st-belfast",
        type: "official-menu",
        checkedAt: "2026-10-08",
      },
      {
        id: "crumlin-gaol-admission",
        url: "https://www.crumlinroadgaol.com/gaolexperience/",
        type: "official-attraction",
        checkedAt: "2026-10-08",
      },
      {
        id: "translink-mlink",
        url: "https://www.translink.co.uk/our-apps/mlink-ticketing-app/ticket-types",
        type: "official-transport",
        checkedAt: "2026-10-08",
      },
    ],
  },
  {
    id: "milan-eur-v1",
    revision: "2026-10-08",
    destinationId: "city:MIL",
    countryCode: "IT",
    currency: "EUR",
    reviewStatus: "reviewed",
    reviewedAt: "2026-10-08",
    reviewAfter: "2026-12-07",
    maxNights: 2,
    costs: {
      localTransport: {
        amount: { cents: 1550, currency: "EUR" },
        unit: "person-trip",
        basket: {
          en: "One adult ATM three-day Mi1–Mi3 ticket per person for a trip of up to two nights. Other zones and airport transfers are not assumed included. Child discounts are not modelled.",
          sq: "Një biletë ATM treditore Mi1–Mi3 për të rritur për person për udhëtime deri në dy net. Zonat e tjera dhe transferet e aeroportit nuk supozohen të përfshira. Uljet për fëmijë nuk modelohen.",
        },
        sourceIds: ["atm-three-day"],
      },
    },
    sourceReferences: [
      {
        id: "atm-three-day",
        url: "https://www.atm.it/en/ViaggiaConNoi/Biglietti/Pages/tickets_milan.aspx",
        type: "official-transport",
        checkedAt: "2026-10-08",
      },
    ],
  },
  {
    id: "brussels-eur-v2",
    revision: "2026-10-08",
    destinationId: "city:BRU",
    countryCode: "BE",
    currency: "EUR",
    reviewStatus: "reviewed",
    reviewedAt: "2026-10-08",
    reviewAfter: "2026-12-07",
    maxNights: 2,
    costs: {
      activities: {
        amount: { cents: 750, currency: "EUR" },
        unit: "person-night",
        basket: {
          en: "€7.50 per person per night toward optional paid sightseeing. Two nights reserve €15, informed by €13 adult admission to either the Old Masters or Magritte museum. Not both museums; shorter trips provide only a contribution. Free sightseeing remains free.",
          sq: "€7.50 për person për natë për vizita fakultative me pagesë. Dy net japin €15, bazuar në hyrjen €13 për të rritur në muzeun Old Masters ose Magritte. Jo të dy muzetë; udhëtimet më të shkurtra mbulojnë vetëm një pjesë. Shëtitjet falas mbeten falas.",
        },
        sourceIds: ["brussels-fine-arts-admission"],
      },
      localTransport: {
        amount: { cents: 850, currency: "EUR" },
        unit: "person-day",
        basket: {
          en: "Reserve the adult STIB contactless daily cap per person per day. Fewer rides may cost less. Other operators and airport journeys are separate; each traveller needs a payment method.",
          sq: "Rezervo kufirin ditor për të rritur të STIB pa kontakt për person në ditë. Më pak udhëtime mund të kushtojnë më pak. Operatorët e tjerë dhe aeroporti janë veç; çdo udhëtar ka nevojë për mjet pagese.",
        },
        sourceIds: ["stib-contactless-cap"],
      },
    },
    sourceReferences: [
      {
        id: "brussels-fine-arts-admission",
        url: "https://fine-arts-museum.be/fr/votre-visite/planifier-sa-visite/tarifs",
        type: "official-attraction",
        checkedAt: "2026-10-08",
      },
      {
        id: "stib-contactless-cap",
        url: "https://www.stib-mivb.be/home/client-support/fares-and-transport-tickets",
        type: "official-transport",
        checkedAt: "2026-10-08",
      },
    ],
  },
];
