import type {
  ContentText,
  SourcedContent,
} from "../../src/domain/destination-content/types";
import {
  contentFixtureContext,
  contentTestIdentity,
  contentTestNow,
  destinationContentFixture,
} from "./destination-content";

/** Fictional acceptance content. No real destination recommendation or production record. */
export const tripContentDestinationId = contentTestIdentity.subject;
export const tripContentNow = contentTestNow;
export const tripContentFixtureContext = contentFixtureContext;
const copy = (en: string, sq: string): ContentText => ({ en, sq });
const stable = (): SourcedContent => ({
  reviewStatus: "reviewed",
  reviewedAt: "2026-10-10T00:00:00Z",
  sourceIds: ["source:synthetic:review"],
  freshness: { kind: "stable" },
});
const volatile = (): SourcedContent => ({
  ...stable(),
  sourceIds: ["source:synthetic:official"],
  freshness: {
    kind: "volatile",
    observedAt: "2026-10-09T00:00:00Z",
    validUntil: "2026-10-15T00:00:00Z",
  },
});
export function tripContentFixture() {
  const data = destinationContentFixture();
  const record = data.records[0];
  record.overview = {
    ...stable(),
    text: copy(
      "A fictional riverside city with compact walks, small galleries and quiet gardens. This reviewed-content fixture demonstrates trip planning without making real destination claims.",
      "Një qytet imagjinar buzë lumit me shëtitje të shkurtra, galeri të vogla dhe kopshte të qeta. Ky shembull i rishikuar demonstron planifikimin pa pretendime për një destinacion real.",
    ),
  };
  record.highlights = [
    {
      ...stable(),
      id: "highlight:synthetic:river",
      text: copy("Short riverside walks", "Shëtitje të shkurtra buzë lumit"),
    },
    {
      ...stable(),
      id: "highlight:synthetic:gallery",
      text: copy("Small independent galleries", "Galeri të vogla të pavarura"),
    },
    {
      ...stable(),
      id: "highlight:synthetic:gardens",
      text: copy("Room for a slower afternoon", "Kohë për një pasdite të qetë"),
    },
  ];
  record.attractions = [
    {
      ...stable(),
      id: "attraction:synthetic:one",
      destinationId: tripContentDestinationId,
      name: copy("Riverside Gallery", "Galeria buzë lumit"),
      kind: "museum",
      shortDescription: copy(
        "A fictional small gallery beside the river.",
        "Një galeri e vogël imagjinare pranë lumit.",
      ),
      whyVisit: copy(
        "A compact stop for a slower afternoon.",
        "Një ndalesë e shkurtër për një pasdite të qetë.",
      ),
      typicalVisitMinutes: { minimum: 45, maximum: 90 },
    },
    {
      ...stable(),
      id: "attraction:synthetic:two",
      destinationId: tripContentDestinationId,
      name: copy(
        "Garden of the Old Waterworks and the Riverside Heritage Promenade",
        "Kopshti i ujësjellësit të vjetër dhe shëtitorja e trashëgimisë buzë lumit",
      ),
      kind: "park",
      shortDescription: copy(
        "An imagined garden and promenade linking two parts of the riverside.",
        "Një kopsht dhe shëtitore imagjinare që lidhin dy pjesë të bregut.",
      ),
      typicalVisitMinutes: { minimum: 30, maximum: 60 },
    },
    {
      ...stable(),
      id: "attraction:synthetic:three",
      destinationId: tripContentDestinationId,
      name: copy("Market Courtyard", "Oborri i tregut"),
      kind: "market",
      shortDescription: copy(
        "A fictional courtyard used to demonstrate a short neighbourhood stop.",
        "Një oborr imagjinar për të treguar një ndalesë të shkurtër në lagje.",
      ),
      typicalVisitMinutes: { minimum: 20, maximum: 40 },
    },
    {
      ...stable(),
      id: "attraction:synthetic:four",
      destinationId: tripContentDestinationId,
      name: copy("Hilltop Terrace", "Tarraca mbi kodër"),
      kind: "viewpoint",
      shortDescription: copy(
        "An invented terrace overlooking the fictional city.",
        "Një tarracë e sajuar me pamje mbi qytetin imagjinar.",
      ),
      typicalVisitMinutes: { minimum: 30, maximum: 30 },
    },
    {
      ...stable(),
      id: "attraction:synthetic:five",
      destinationId: tripContentDestinationId,
      name: copy("Old Workshop Lane", "Rrugica e punishteve të vjetra"),
      kind: "district",
      shortDescription: copy(
        "A fictional lane with small workshops and side streets.",
        "Një rrugicë imagjinare me punishte të vogla dhe rrugë anësore.",
      ),
      typicalVisitMinutes: { minimum: 30, maximum: 45 },
    },
    {
      ...volatile(),
      id: "attraction:synthetic:six",
      destinationId: tripContentDestinationId,
      name: copy("Seasonal Glasshouse", "Sera sezonale"),
      kind: "landmark",
      shortDescription: copy(
        "A fictional seasonal glasshouse for freshness testing.",
        "Një serë sezonale imagjinare për të provuar aktualitetin e të dhënave.",
      ),
      bookingAdvice: copy(
        "Synthetic current booking note: check the source before visiting.",
        "Shënim aktual testimi për rezervim: kontrollo burimin para vizitës.",
      ),
      typicalVisitMinutes: { minimum: 30, maximum: 60 },
    },
  ];
  record.areas = [
    {
      ...stable(),
      id: "area:synthetic:river",
      destinationId: tripContentDestinationId,
      name: copy("Riverside", "Buzë lumit"),
      summary: copy(
        "A fictional central base for short walks.",
        "Një bazë qendrore imagjinare për shëtitje të shkurtra.",
      ),
      goodFor: [copy("A short first visit", "Një vizitë e parë e shkurtër")],
      tradeoffs: [
        copy(
          "Some busy walking routes",
          "Disa rrugë shëtitjeje mund të jenë të ngarkuara",
        ),
      ],
    },
    {
      ...stable(),
      id: "area:synthetic:gardens",
      destinationId: tripContentDestinationId,
      name: copy("Garden Quarter", "Lagjja e kopshteve"),
      summary: copy(
        "An imagined quieter district near green spaces.",
        "Një lagje më e qetë imagjinare pranë hapësirave të gjelbra.",
      ),
      goodFor: [copy("A quieter evening", "Një mbrëmje më të qetë")],
      tradeoffs: [
        copy(
          "A longer walk to the centre",
          "Një ecje më të gjatë drejt qendrës",
        ),
      ],
    },
    {
      ...stable(),
      id: "area:synthetic:workshops",
      destinationId: tripContentDestinationId,
      name: copy("Workshop District", "Lagjja e punishteve"),
      summary: copy(
        "A fictional neighbourhood with small independent spaces.",
        "Një lagje imagjinare me hapësira të vogla të pavarura.",
      ),
      goodFor: [
        copy("Exploring side streets", "Eksplorimin e rrugëve anësore"),
      ],
      tradeoffs: [
        copy("Fewer direct routes", "Më pak rrugë të drejtpërdrejta"),
      ],
    },
  ];
  record.dayTemplates = [
    {
      ...stable(),
      id: "day:synthetic:wide",
      destinationId: tripContentDestinationId,
      suitableNights: [1, 2, 3],
      title: copy(
        "A short riverside loop",
        "Një shëtitje e shkurtër buzë lumit",
      ),
      stops: [
        { attractionId: "attraction:synthetic:one" },
        { attractionId: "attraction:synthetic:two" },
      ],
    },
    {
      ...stable(),
      id: "day:synthetic:two-nights",
      destinationId: tripContentDestinationId,
      suitableNights: [2],
      title: copy(
        "Gallery, gardens and courtyard",
        "Galeri, kopshte dhe oborr",
      ),
      stops: [
        {
          attractionId: "attraction:synthetic:one",
          notes: copy(
            "Start with the gallery at your own pace.",
            "Fillo me galerinë sipas ritmit tënd.",
          ),
        },
        {
          attractionId: "attraction:synthetic:two",
          notes: copy(
            "Continue along the imagined riverside walk.",
            "Vazhdo përgjatë shëtitores imagjinare buzë lumit.",
          ),
        },
        {
          attractionId: "attraction:synthetic:three",
          notes: copy(
            "Finish with a short courtyard stop.",
            "Përfundo me një ndalesë të shkurtër në oborr.",
          ),
        },
      ],
      notes: copy(
        "Use this building block when it suits your arrival and departure times.",
        "Përdore këtë pjesë të planit sipas orarit të mbërritjes dhe nisjes.",
      ),
    },
  ];
  record.transport = [
    {
      ...stable(),
      id: "transport:synthetic:walk",
      destinationId: tripContentDestinationId,
      freshness: {
        kind: "periodically-reviewed",
        reviewBy: "2026-10-31T00:00:00Z",
      },
      title: copy("Walking between neighbourhoods", "Ecja mes lagjeve"),
      guidance: copy(
        "This synthetic route groups nearby stops; allow time for breaks and check your own access needs.",
        "Kjo rrugë testimi bashkon ndalesa të afërta; lër kohë për pushime dhe kontrollo nevojat e tua për akses.",
      ),
    },
    {
      ...volatile(),
      id: "transport:synthetic:ticket",
      destinationId: tripContentDestinationId,
      title: copy(
        "Synthetic transit observation",
        "Vëzhgim testimi për transportin",
      ),
      guidance: copy(
        "An invented observed ticket price for testing; no real ticket is offered.",
        "Një çmim bilete i sajuar për testim; nuk ofrohet biletë reale.",
      ),
      observedPrice: {
        amount: 4.5,
        currency: "EUR",
        sourceId: "source:synthetic:official",
        observedAt: "2026-10-09T00:00:00Z",
      },
    },
  ];
  record.practicalNotes = [
    {
      ...stable(),
      id: "note:synthetic:pace",
      destinationId: tripContentDestinationId,
      kind: "other",
      text: copy(
        "Leave some unplanned time between the example stops.",
        "Lër pak kohë të lirë mes ndalesave të shembullit.",
      ),
    },
    {
      ...volatile(),
      id: "note:synthetic:current",
      destinationId: tripContentDestinationId,
      kind: "closure",
      text: copy(
        "Synthetic current closure note: consult the official source before visiting.",
        "Shënim aktual testimi për mbylljet: konsulto burimin zyrtar para vizitës.",
      ),
    },
  ];
  return data;
}
