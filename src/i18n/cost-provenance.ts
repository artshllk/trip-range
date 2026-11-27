import type { Locale } from "./config";
import type {
  CostIntegrity,
  PlanningCostBasis,
  PlanningCostProvenance,
} from "../domain/costs/types";
/** Compact summary beside amounts; detailed component evidence remains in Price details. */
export function costEstimateLabel(
  integrity: CostIntegrity | undefined,
  locale: Locale,
) {
  if (!integrity) return undefined;
  if (integrity.status === "generic" && !integrity.providerComponents?.length)
    return locale === "en"
      ? "General planning estimates for non-flight costs"
      : "Vlerësime të përgjithshme për kostot pa fluturime";
  if (integrity.generalComponents.length)
    return locale === "en"
      ? "Includes general planning estimates"
      : "Përfshin vlerësime të përgjithshme planifikimi";
  return costBasisText("reviewed-destination", locale);
}
export function costComponentText(
  component: PlanningCostProvenance["component"],
  locale: Locale,
) {
  const labels = {
    stay: { en: "Stay", sq: "Qëndrimi" },
    food: { en: "Food", sq: "Ushqimi" },
    localTransport: { en: "Local transport", sq: "Transporti lokal" },
    gatewayTransfer: {
      en: "Onward transfer to the destination (return)",
      sq: "Transferi drejt destinacionit (vajtje-ardhje)",
    },
    arrivalTransport: {
      en: "Destination airport transfer",
      sq: "Transferi nga aeroporti në destinacion",
    },
    activities: { en: "Activities", sq: "Aktivitetet" },
    baggage: { en: "Baggage", sq: "Bagazhi" },
    departureTransfer: {
      en: "Departure airport transfer",
      sq: "Transferi drejt aeroportit të nisjes",
    },
    car: { en: "Car", sq: "Makina" },
  };
  return labels[component][locale];
}
export function costBasisText(basis: PlanningCostBasis, locale: Locale) {
  const text = {
    "provider-availability": {
      en: "Current provider stay evidence",
      sq: "Të dhëna aktuale akomodimi nga ofruesi",
    },
    "reviewed-destination": {
      en: "Reviewed destination estimate",
      sq: "Vlerësim i rishikuar për destinacionin",
    },
    "generic-currency": {
      en: "General planning estimate",
      sq: "Vlerësim i përgjithshëm planifikimi",
    },
    "curated-legacy": {
      en: "Earlier planning estimate; not recently reviewed",
      sq: "Vlerësim i mëparshëm planifikimi; pa rishikim të fundit",
    },
    "planning-allowance": {
      en: "Planning allowance",
      sq: "Shumë e parashikuar për planifikim",
    },
  };
  return text[basis][locale];
}
export function costIntegrityText(
  integrity: CostIntegrity | undefined,
  locale: Locale,
) {
  const date = integrity?.profile?.reviewedAt;
  if (integrity?.providerComponents?.length)
    return locale === "sq"
      ? "Qëndrimi përdor të dhëna aktuale nga ofruesi; kostot e tjera mbeten vlerësime planifikimi."
      : "Stay uses current provider evidence; other costs remain planning estimates.";
  // Browser ICU may omit Albanian. Keep the source date label identical during hydration.
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
  const checked = date
    ? `${months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
    : "";
  if (integrity?.status === "reviewed")
    return locale === "sq"
      ? `Kostot e destinacionit përdorin një profil planifikimi të rishikuar në ${checked}. Mbeten vlerësime, jo çmime të konfirmuara.`
      : `Destination costs use a reviewed planning profile checked ${checked}. They remain estimates, not confirmed prices.`;
  if (integrity?.status === "mixed")
    return locale === "sq"
      ? `Disa kosto të destinacionit janë rishikuar në ${checked}; të tjerat përdorin shuma të përgjithshme planifikimi.`
      : `Some destination costs were reviewed in ${checked}; others use general planning allowances.`;
  return locale === "sq"
    ? "Kostot e destinacionit përdorin vlerësime të përgjithshme ose të mëparshme planifikimi, pa një rishikim të plotë të fundit."
    : "Destination costs use general or earlier planning estimates, without a current destination review.";
}
