import { derived, userInput } from "../domain/money/provenance";
import type { FlightAffordability } from "../domain/budget";
import { formatMoney, type MoneyAmount } from "../domain/money/currency";

/** Shared by cards, detail and reviewed AI options; no pricing arithmetic here. */
export function flightAffordabilityText(
  state: FlightAffordability,
  budget: MoneyAmount,
  locale: "en" | "sq",
): string {
  if (state.status === "accommodation-charges-unpriced")
    return locale === "en"
      ? "Accommodation charges still need checking. Budget fit and the flight budget limit are not yet known."
      : "Tarifat e akomodimit duhen kontrolluar. Përshtatja me buxhetin dhe kufiri për fluturimet nuk dihen ende.";
  if (state.status === "stay-unpriced")
    return locale === "en"
      ? "Stay price unavailable. Whole-trip total and budget fit are not yet known."
      : "Çmimi i qëndrimit nuk dihet. Totali dhe përshtatja me buxhetin nuk dihen ende.";
  if (state.status === "required-transfer-unpriced")
    return locale === "en"
      ? "The onward transfer still needs pricing. The whole-trip total and budget fit are not yet known."
      : "Çmimi i transferit drejt destinacionit ende duhet kontrolluar. Totali dhe përshtatja me buxhetin nuk dihen ende.";
  if (state.status === "no-room-in-budget")
    return locale === "en"
      ? "Other estimated costs leave no room for flights within this budget, including the reserve."
      : "Kostot e tjera të vlerësuara nuk lënë hapësirë për fluturime brenda këtij buxheti, përfshirë rezervën.";
  // Budget minus the reserve and estimated non-flight costs: never a fare.
  const ceiling = formatMoney(
    derived(state.ceiling, ["user_input", "planning_estimate"]),
    locale,
  );
  const total = formatMoney(userInput(budget), locale);
  return locale === "en"
    ? `Flights for your selected dates need to cost ${ceiling} or less in total for your party to fit your ${total} budget. This is a budget ceiling, not a fare estimate.`
    : `Fluturimet për datat e zgjedhura duhet të kushtojnë gjithsej ${ceiling} ose më pak për grupin tuaj që udhëtimi të hyjë në buxhetin ${total}. Ky është kufi buxheti, jo vlerësim i tarifës.`;
}
