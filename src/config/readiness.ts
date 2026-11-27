import type { validateEnvironment } from "./environment";
import { legalDocuments, type LegalDocument } from "../services/legal";
import { locales } from "../i18n/config";
import { launchSignoffs, signoffBlockers } from "./launch-signoffs";
type LegalDocuments = Record<string, Record<string, LegalDocument>>;
/** Detect known placeholders without returning legal text or claiming legal sufficiency. */
export function legalPlaceholderReport(
  documents: LegalDocuments = legalDocuments,
) {
  const unresolved: string[] = [];
  for (const kind of ["privacy", "terms", "affiliate-disclosure"] as const) {
    for (const locale of locales) {
      const doc = documents[kind]?.[locale];
      if (
        !doc ||
        !doc.paragraphs.length ||
        /\bTODO\b|\bTBD\b|\bPLACEHOLDER\b|\[insert\b/i.test(JSON.stringify(doc))
      )
        unresolved.push(`${kind}:${locale}`);
    }
  }
  return { pending: unresolved.length > 0, documents: unresolved };
}
/** Public V1 requirements, evaluated offline. Configuration cannot prove authentication or connectivity. */
export function configurationReadiness(
  env: ReturnType<typeof validateEnvironment>,
) {
  const blockers: string[] = [];
  if (env.invalid.length) blockers.push("malformed-environment");
  if (!env.capabilities.flights) blockers.push("flight-provider");
  if (!env.capabilities.affiliate) blockers.push("affiliate-provider");
  if (!env.capabilities.fareStore) blockers.push("fare-store");
  if (env.ai.enabled) blockers.push("launch-ai-must-be-off");
  if (!env.redis || env.limiter !== "distributed")
    blockers.push("distributed-rate-limit");
  return { ready: blockers.length === 0, blockers };
}
/** No env flag can attest to revocation, legal approval or deployment/account checks. */
export function launchReadiness(
  env: ReturnType<typeof validateEnvironment>,
  legal = legalPlaceholderReport(),
  signoffs: unknown = launchSignoffs,
  now = new Date(),
) {
  const configuration = configurationReadiness(env);
  const manual = [
    ...signoffBlockers(signoffs, now),
    ...(legal.pending ? ["launch-legal-placeholders"] : []),
  ];
  return {
    ready: configuration.ready && manual.length === 0,
    configuration: configuration.blockers,
    manual,
    legalPlaceholders: legal.pending,
    capabilities: env.capabilities,
    mode: env.mode,
    limiter: env.limiter,
    distributedLimiterConfigured: !!env.redis,
  };
}

/** Strict launch checks include manual blockers; ordinary inspection does not certify launch. */
export function productionVerificationExitCode(
  report: { ready: boolean; security: "passed" | "failed" },
  strict: boolean,
) {
  return report.security === "failed" || (strict && !report.ready) ? 1 : 0;
}
