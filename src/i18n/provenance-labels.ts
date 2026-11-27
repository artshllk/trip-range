import type { MoneyProvenance } from "../domain/money/provenance";
import type { LocalizedCopy } from "./localized";

/** Short visible tags naming where a cost line came from. */
export const provenanceLabel: LocalizedCopy<
  Record<MoneyProvenance["kind"], string>
> = {
  en: {
    observed_fare: "Stored fare",
    planning_estimate: "Planning estimate",
    user_input: "Your budget",
    derived: "Calculated",
    demo_fixture: "Demo figure",
  },
};
