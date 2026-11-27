import type { Query } from "./request";
import { isCurrency } from "./money/currency";
/** Bound parsing/serialization work before provider composition. Repeated values are invalid. */
export function boundedSearchQuery(query: Query): boolean {
  if (query.currency !== undefined && !isCurrency(query.currency)) return false;
  const entries = Object.entries(query);
  if (entries.length > 40) return false;
  let size = 0;
  for (const [key, value] of entries) {
    if (key.length > 80 || Array.isArray(value)) return false;
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length > 2048)
    )
      return false;
    size += key.length + (value?.length ?? 0);
    if (size > 8192) return false;
  }
  return true;
}
