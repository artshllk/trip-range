import type { Dictionary } from "@/i18n/dictionaries";
import type { SearchIssue } from "@/services/travel";

export function SourceIssues({
  issues,
  t,
}: {
  issues: SearchIssue[];
  t: Dictionary;
}) {
  if (!issues.length) return null;
  return (
    <div className="notice warning stack" role="status">
      <b>{t.unavailableTitle}</b>
      <p>
        {issues.some((i) => i.source.status === "unavailable")
          ? t.incompleteSearch
          : t.unavailableBody}
      </p>
      <ul>
        {Array.from(
          new Set(
            issues.map((i) => `${t[i.category]} · ${t[i.source.status]}`),
          ),
        ).map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </div>
  );
}
