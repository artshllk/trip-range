import {
  currencyMetadata,
  isCurrency,
  majorUnits,
  type MoneyAmount,
} from "../domain/money/currency";
export type SeoLandingKey = {
  locale: "en";
  originId: string;
} & (
  | { intent: "origin" | "weekend"; budget?: never }
  | { intent: "budget"; budget: MoneyAmount }
);
export type SeoPageId = `en-${string}`;
function originSlug(origin: string) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(origin) || origin.length > 80)
    throw new RangeError("Invalid SEO origin slug");
  return origin;
}
/** Default-locale (unprefixed) paths. Publication is English-only (see landingId). */
export function originPath(origin: string): `/from/${string}` {
  return `/from/${originSlug(origin)}`;
}
export function weekendPath(origin: string): `/from/${string}` {
  return `${originPath(origin)}/weekend-trips`;
}
export function budgetPath(
  origin: string,
  majorAmount: number,
): `/from/${string}` {
  if (
    !Number.isSafeInteger(majorAmount) ||
    majorAmount <= 0 ||
    majorAmount > 100000
  )
    throw new RangeError("Invalid SEO budget");
  return `${weekendPath(origin)}-under-${majorAmount}`;
}
/**
 * CANCELLED (6 November 2026): the /from/{origin}/to/{destination} page
 * family is not approved. The content architecture replaced it with one
 * destination cost page, /costs/{city}, with a selectable origin, because
 * routes to the same city share stay, food and local costs and differ only
 * in the fare. Kept, with its tests, because the slug rules (city to city,
 * guide-slug destinations, nothing variable in the path) may serve
 * /costs/{city}. Do not publish pages at this path.
 */
export function routePath(
  origin: string,
  destination: string,
): `/from/${string}/to/${string}` {
  if (originSlug(origin) === originSlug(destination))
    throw new RangeError("A route needs two different cities");
  return `${originPath(origin)}/to/${destination}`;
}
export function landingId(key: SeoLandingKey): SeoPageId {
  originSlug(key.originId);
  if (key.locale !== "en")
    throw new RangeError("Unsupported publication locale");
  if (!["origin", "weekend", "budget"].includes(key.intent))
    throw new RangeError("Invalid SEO intent");
  if (key.intent !== "budget") return `en-${key.originId}-${key.intent}`;
  if (
    !isCurrency(key.budget.currency) ||
    !Number.isSafeInteger(key.budget.cents) ||
    key.budget.cents <= 0
  )
    throw new RangeError("Invalid SEO currency or budget");
  return `en-${key.originId}-budget-${key.budget.currency.toLowerCase()}-${key.budget.cents}`;
}
export function landingPath(key: SeoLandingKey) {
  landingId(key);
  if (key.intent === "origin") return originPath(key.originId);
  if (key.intent === "weekend") return weekendPath(key.originId);
  if (key.intent !== "budget") throw new RangeError("Invalid SEO intent");
  if (
    !isCurrency(key.budget.currency) ||
    key.budget.cents % 10 ** currencyMetadata[key.budget.currency].minorUnits
  )
    throw new RangeError("SEO budget requires whole major units");
  return budgetPath(key.originId, Number(majorUnits(key.budget)));
}
