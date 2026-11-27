import type { LocalizedCopy } from "./localized";

/**
 * Copy shown before the traveller leaves for a booking partner. Meanings:
 * - leaving: the traveller leaves Trip Range for {partner}; the price is checked there, not here.
 * - disclosure: affiliate relationship, stated before the click, in body text (FTC
 *   "clear and conspicuous": next to the link, not behind it, not only in the footer).
 * - disclosureLink: the full affiliate disclosure page.
 */
export const handoffCopy = {
  en: {
    leaving:
      "You’ll leave Trip Range for {partner} in this tab. {partner} shows today’s price and availability; Trip Range doesn’t.",
    disclosure:
      "Affiliate link: if you book, Trip Range may earn a commission from Travelpayouts at no extra cost to you.",
    disclosureLink: "How we earn",
  },
} as const satisfies LocalizedCopy<unknown>;
