/**
 * Price-claim policy for every user-facing string.
 *
 * Trip Range reads the Aviasales Data API: cached fares derived from other
 * travellers' searches, retained for 2–7 days. We cannot query airlines, so no
 * text may state or imply that WE fetch, refresh, re-check or confirm a live
 * price. The booking partner does that after handoff.
 *
 * tests/claims-policy.test.ts fails the build when a banned phrase appears in
 * user-facing text outside one of the allowed contexts below. Exemptions are by
 * context, never by removing a word from the banned list.
 */
export const bannedPhrases: readonly RegExp[] = [
  /\blive\b/gi,
  /\breal-?time\b/gi,
  /\bcurrent price/gi,
  /\btoday['’]s price/gi,
  /\bup[- ]to[- ]date\b/gi,
  /\blatest fares?\b/gi,
  /\brefresh(?:es|ed|ing)?\b/gi,
  /\bre-?check(?:s|ed|ing)?\b/gi,
  /\bverified\b/gi,
  /\bconfirmed\b/gi,
  /\bguaranteed\b/gi,
  /\bbest price/gi,
  /\bcheapest\b/gi,
  // Albanian equivalents. "aktual" alone means "current" in general (bus routes,
  // park rules), so it is banned only beside a price noun.
  /(?<!\p{L})(?:çmim|tarif)\p{L}*\s+aktual\p{L}*/giu,
  /\bnë kohë reale\b/gi,
  /\bverifikuar\b/gi,
  /\bkonfirmuar\b/gi,
  /\bgarantuar\b/gi,
];
const claimWords =
  "live|real-?time|confirmed|guaranteed|verified|up[- ]to[- ]date|cheapest|current price|aktual\\w*|në kohë reale|konfirmuar|garantuar|verifikuar";

export const allowedContexts: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bcheck live fares?\b/gi,
    reason: "Partner CTA: describes what the partner does after handoff.",
  },
  {
    pattern: new RegExp(
      `\\b(?:not|no|never|without|cannot|can['’]t|aren['’]t|isn['’]t|nuk|pa|jo)\\b[^.;:]{0,80}?\\b(?:${claimWords})\\b(?:\\s+(?:${claimWords})\\b)*`,
      "gi",
    ),
    reason: "Negated claim: says what the figure is NOT, which is true.",
  },
  {
    pattern:
      /\b(?:confirm(?:ed)?|verif(?:y|ied)|re-?check)\b[^.;]{0,64}?\b(?:on|by|with|at)\s+(?:the\s+)?(?:Aviasales|provider|booking (?:site|provider)|partner)\b/gi,
    reason: "Attributes the check to the partner, not to us.",
  },
  {
    pattern:
      /\b(?:partner|provider|Aviasales)\b[^.;]{0,40}?\btoday['’]s price\b|\btoday['’]s price\b[^.;]{0,20}?\b(?:with|on|at) (?:the )?(?:partner|provider|Aviasales)\b/gi,
    reason: "Today's price is shown by the partner, not by us.",
  },
  {
    pattern:
      /\b(?:provider|partner|Aviasales)\b[^.;]{0,80}?\b(?:are|is) confirmed\b/gi,
    reason: "Attributes confirmation to the partner's website.",
  },
  {
    pattern:
      /(?<!\p{L})çmim\p{L}*\s+aktual\p{L}*[^.]{0,40}?konfirmohen në faqen e ofruesit/giu,
    reason: "Albanian: current prices are confirmed on the provider's site.",
  },
  {
    pattern: /\bcurrent prices? needs? checking\b/gi,
    reason: "Says the price still needs checking by the traveller.",
  },
  {
    pattern: /\b(?:use|choose)\s+(?:your\s+|a\s+)?confirmed\b/gi,
    reason: "Editorial: the traveller's own confirmed booking, not a price.",
  },
  {
    pattern: /\bassuming the cheapest room means the cheapest\b/gi,
    reason: "Editorial advice warning against a cheapest assumption.",
  },
  {
    pattern:
      /\byou (?:must |should |need to |can )?(?:verify|re-?check|confirm)\b/gi,
    reason: "An instruction to the traveller, not a claim about us.",
  },
  {
    pattern: /(?:^|[.;:]\s*|\band\s+)re-?check\b/gi,
    reason: "Imperative instruction to the traveller.",
  },
];

/** Banned phrases in `text` that no allowed context covers. */
export function claimViolations(text: string): string[] {
  const covered: [number, number][] = [];
  for (const { pattern } of allowedContexts)
    for (const m of text.matchAll(new RegExp(pattern)))
      covered.push([m.index!, m.index! + m[0].length]);
  const found: string[] = [];
  for (const pattern of bannedPhrases)
    for (const m of text.matchAll(new RegExp(pattern))) {
      const start = m.index!,
        end = start + m[0].length;
      if (!covered.some(([a, b]) => a <= start && end <= b))
        found.push(m[0].trim());
    }
  return found;
}
