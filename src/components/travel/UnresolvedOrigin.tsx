import { localePath } from "@/i18n/routing";
import type { Locale } from "../../i18n/config";
import { localized } from "../../i18n/localized";
import { originResolutionCopy } from "../../i18n/origin-resolution";

/** Shown instead of a search when the query names no origin we can identify. */
export function UnresolvedOrigin({
  locale,
  inline = false,
}: {
  locale: Locale;
  inline?: boolean;
}) {
  const copy = localized(originResolutionCopy, locale);
  if (inline)
    return (
      <div className="origin-unresolved" role="alert">
        <p>
          <strong>{copy.title}.</strong> {copy.body}
        </p>
      </div>
    );
  return (
    <main id="main" className="shell section">
      <div className="origin-unresolved" role="alert">
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <a className="button ember" href={localePath(locale, `/plan`)}>
          {copy.action}
        </a>
      </div>
    </main>
  );
}
