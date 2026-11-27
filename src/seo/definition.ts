import type { SeoPageId, SeoLandingKey } from "./identity";
import type { CurrencyCode } from "../domain/money/currency";
import type { MoneyAmount, TravelLocation } from "../domain/types";
import type { SeoDateContract } from "./date-contract";
export type SeoSection =
  | "results"
  | "budgets"
  | "dates"
  | "coverage"
  | "value"
  | "nearby"
  | "methodology"
  | "questions"
  | "related";
export type SeoEditorialDefinition = {
  id: SeoPageId;
  key: SeoLandingKey;
  planningCurrency: CurrencyCode;
  exampleBudget: MoneyAmount;
  nearbyNote: string;
  path: `/from/${string}`;
  locale: "en";
  type: "origin" | "weekend" | "budget";
  origin: TravelLocation;
  budget?: MoneyAmount;
  title: string;
  h1: string;
  description: string;
  intro: string;
  dateContract: SeoDateContract;
  parent?: SeoPageId;
  breadcrumb: string;
  related: readonly SeoPageId[];
  sections: readonly SeoSection[];
  keywords: { primary: string; related: readonly string[] };
  questions: readonly { question: string; answer: string }[];
};
