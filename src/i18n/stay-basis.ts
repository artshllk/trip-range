import type { TripPlan } from "../domain/types";
import { EUROSTAT_ATTRIBUTION } from "../domain/costs/eurostat";
import type { Locale } from "./config";

/**
 * Names the stay's basis: observed rates, scaling, or a general allowance.
 * The month is the sampled stay period, not when prices were recorded.
 * A planning figure is never presented as a bookable hotel price.
 */
const months = {
  en: [
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
  ],
  sq: [
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
  ],
};
const monthLabel = (ym: string, locale: Locale) =>
  `${months[locale === "sq" ? "sq" : "en"][Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** One line naming where the stay figure comes from, or that there is none. */
export function stayBasisText(
  plan: TripPlan,
  locale: Locale,
): string | undefined {
  const sq = locale === "sq";
  const f = plan.stayFigure;
  if (f) {
    const anchor = f.anchorName[sq ? "sq" : "en"];
    const stays = sq
      ? `${f.weekday} qëndrime gjatë javës dhe ${f.weekend} në fundjavë`
      : `${f.weekday} weekday and ${f.weekend} weekend stays`;
    const when = monthLabel(f.stayMonth, locale);
    // n travels with every measured band; anything else says it is a placeholder.
    const band = sq
      ? f.band === "measured"
        ? `intervali ±${f.bandPercent}% (i matur, n=${f.bandN} qytete)`
        : `intervali ±${f.bandPercent}% (vlerë editoriale provizore)`
      : f.band === "measured"
        ? `±${f.bandPercent}% range (measured, n=${f.bandN} cities)`
        : `±${f.bandPercent}% range (editorial placeholder)`;
    if (f.kind === "observed")
      return sq
        ? `Qëndrimi: çmime të vëzhguara në ${f.properties} hotele në ${anchor} për ${when}. ${stays} · ${band}.`
        : `Stay: rates observed at ${f.properties} hotels in ${anchor} for ${when}. ${stays} · ${band}.`;
    const level = `${f.priceLevel?.year ?? ""}${f.priceLevel?.provisional ? (sq ? ", paraprake" : ", provisional") : ""}`;
    return sq
      ? `Qëndrimi i përshtatur nga ${anchor} sipas niveleve të çmimeve të BE-së (${level}). Bazuar në ${stays} për ${when} · ${band}.`
      : `Stay scaled from ${anchor} by EU price levels (${level}). Based on ${stays} for ${when} · ${band}.`;
  }
  const x = plan.lodgingTax;
  if (x)
    return sq
      ? `Vlerësimi i dhomës: ${x.weekday} qëndrime gjatë javës dhe ${x.weekend} në fundjavë · intervali ±${x.bandPercent}% (vlerë editoriale provizore).`
      : `Room estimate: ${x.weekday} weekday and ${x.weekend} weekend stays · ±${x.bandPercent}% range (editorial placeholder).`;
  if (plan.accommodation?.kind === "generic-estimate") {
    const city = plan.destination.name[sq ? "sq" : "en"];
    return sq
      ? `Qëndrimi: shumë e përgjithshme planifikimi. Ende nuk kemi vëzhguar çmime hotelesh për ${city}.`
      : `Stay: a general planning allowance. We haven’t observed hotel prices for ${city} yet.`;
  }
  return undefined;
}

/**
 * Which rates the figure reflects when any stay used a permitted fallback. At half
 * or more breakfast-included, the figure is called a breakfast-included figure.
 */
export function stayFallbackText(
  plan: TripPlan,
  locale: Locale,
): string | undefined {
  const f = plan.stayFigure?.fallbacks;
  if (!f || (!f.breakfastIncluded && !f.nonRefundable)) return undefined;
  const sq = locale === "sq";
  const parts: string[] = [];
  if (f.breakfastIncluded)
    parts.push(
      f.breakfastIncluded * 2 >= f.contributing
        ? sq
          ? `Vlerësim me mëngjes të përfshirë (${f.breakfastIncluded} nga ${f.contributing} qëndrime përfshinin mëngjesin)`
          : `Breakfast-included estimate (${f.breakfastIncluded} of ${f.contributing} stays included breakfast)`
        : sq
          ? `Mëngjesi i përfshirë në ${f.breakfastIncluded} nga ${f.contributing} qëndrime`
          : `Breakfast included in ${f.breakfastIncluded} of ${f.contributing} stays`,
    );
  if (f.nonRefundable)
    parts.push(
      sq
        ? `pa rimbursim në ${f.nonRefundable} nga ${f.contributing} qëndrime`
        : `non-refundable in ${f.nonRefundable} of ${f.contributing} stays`,
    );
  return parts.join("; ") + ".";
}

/** Required wherever a figure was scaled with the Eurostat price-level series. */
export function stayAttributionText(
  plan: TripPlan,
  locale: Locale,
): string | undefined {
  const date = plan.stayFigure?.priceLevel?.retrievedAt;
  return date
    ? EUROSTAT_ATTRIBUTION[locale === "sq" ? "sq" : "en"].replace(
        "{date}",
        date,
      )
    : undefined;
}

/** Scaled stays carry the anchor's embedded tax, not the destination's own. */
export function inheritedTaxText(
  plan: TripPlan,
  locale: Locale,
): string | undefined {
  if (plan.lodgingTax?.treatment !== "inherited" || !plan.stayFigure)
    return undefined;
  const sq = locale === "sq";
  const anchor = plan.stayFigure.anchorName[sq ? "sq" : "en"];
  const city = plan.destination.name[sq ? "sq" : "en"];
  return sq
    ? `Taksa e qëndrimit: ky vlerësim mbart trajtimin e taksës së ${anchor}, jo rregullat e ${city}. Çdo taksë shtesë në hotel mbetet e panjohur në këtë vlerësim.`
    : `Lodging tax: this estimate carries ${anchor}’s tax treatment, not ${city}’s own rules. Any extra tax at the hotel is unknown in this estimate.`;
}

/** Why a central estimate that fits is not called a fit. */
export function fitUnconfirmedText(
  reasons: readonly ("stay-range" | "lodging-tax")[],
  locale: Locale,
): string {
  const sq = locale === "sq";
  const stay = reasons.includes("stay-range"),
    tax = reasons.includes("lodging-tax");
  if (stay && tax)
    return sq
      ? "Totali i vlerësuar para taksës së mundshme · përshtatja me buxhetin e pasigurt: kostoja më e lartë e qëndrimit dhe taksa e mundshme mund ta tejkalojnë buxhetin"
      : "Estimated total before possible lodging tax · Budget fit unconfirmed: higher stay costs and possible tax may exceed your budget";
  if (stay)
    return sq
      ? "Totali i vlerësuar · përshtatja me buxhetin e pasigurt: kufiri i sipërm i vlerësimit të qëndrimit e tejkalon buxhetin"
      : "Estimated total · Budget fit unconfirmed: the higher end of the stay estimate exceeds your budget";
  return sq
    ? "Totali i vlerësuar para taksës së mundshme · përshtatja me buxhetin e pasigurt: taksa shtesë e mundshme mund të tejkalojë buxhetin e mbetur"
    : "Estimated total before possible lodging tax · Budget fit unconfirmed: possible extra tax may exceed the remaining budget";
}
