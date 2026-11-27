import type { UnsupportedPreference } from "../domain/ai/intent";
export const aiCopy = {
  en: {
    title: "✨ Describe your trip",
    input: "What trip do you have in mind?",
    example:
      "€600 for me and my wife from Tirana next weekend, somewhere quiet with nature. Include nearby airports.",
    find: "Find my trip",
    working: "Understanding your trip…",
    error:
      "We couldn't understand that request right now. You can still use the normal search.",
    clarification: "Complete these search details",
    origin: "Where are you leaving from? Choose a city or airport.",
    destination: "Choose your destination",
    currency:
      "Choose the planning currency explicitly. The numeric amount is not converted. Origin defaults and a currency written in your request may differ.",
    budget: "What's your total trip budget?",
    dates: "Choose valid future dates (1–14 nights)",
    party: "How many adults and children are travelling?",
    why: "✨ Why this matches",
    unsupported: "Understood, but not used in trip ranking yet:",
    privacy:
      "Your description is sent to our AI provider only when you select Find my trip.",
  },
  sq: {
    title: "✨ Përshkruaj udhëtimin",
    input: "Çfarë udhëtimi ke në mendje?",
    example:
      "600 euro për mua dhe gruan time nga Tirana vikendin tjetër, diku qetë në natyrë. Përfshi aeroportet afër.",
    find: "Gjej udhëtimin tim",
    working: "Po kuptojmë udhëtimin…",
    error:
      "Nuk mundëm ta kuptojmë kërkesën tani. Mund të përdorësh kërkimin e zakonshëm.",
    clarification: "Plotëso këto detaje të kërkimit",
    origin: "Nga do të nisesh? Zgjidh qytetin ose aeroportin.",
    destination: "Zgjidh destinacionin",
    currency:
      "Zgjidhni monedhën e planifikimit. Shuma numerike nuk konvertohet; monedha e kërkuar mund të ndryshojë nga ajo e nisjes.",
    budget: "Sa është buxheti yt i përgjithshëm?",
    dates: "Zgjidh data të ardhshme (1–14 net)",
    party: "Sa të rritur dhe fëmijë udhëtojnë?",
    why: "✨ Pse përshtatet",
    unsupported: "U kuptuan, por ende nuk përdoren në renditjen e udhëtimeve:",
    privacy:
      "Përshkrimi dërgohet te ofruesi ynë i AI vetëm kur zgjedh Gjej udhëtimin tim.",
  },
};
export const unsupportedCopy: Record<
  "en" | "sq",
  Record<UnsupportedPreference, string>
> = {
  en: {
    weather: "warm weather",
    accessibility: "wheelchair accessibility",
    pregnancy: "pregnancy-friendly",
    nightlife: "nightlife intensity",
    "low-walking": "low walking",
    "visa-free": "visa-free travel",
    "direct-flight": "direct flights only",
    pool: "hotel swimming pool",
    other: "other unsupported preferences",
  },
  sq: {
    weather: "mot i ngrohtë",
    accessibility: "qasje me karrocë",
    pregnancy: "përshtatshmëri gjatë shtatzënisë",
    nightlife: "intensiteti i jetës së natës",
    "low-walking": "pak ecje",
    "visa-free": "udhëtim pa viza",
    "direct-flight": "vetëm fluturime direkte",
    pool: "pishinë hoteli",
    other: "preferenca të tjera të pambështetura",
  },
};
