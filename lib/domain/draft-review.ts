// Review flags and claim records for a draft version (PRODUCT_SPEC §5.3,
// §5.6, §5.7, §7.3). Pure: the same text and inputs always give the same flags.

import { LINKEDIN_MAX_CHARACTERS, findPlaceholders, type Span } from "./drafts";

export type FlagKind =
  | "unsupported_claim"
  | "weak_evidence"
  | "needs_personal_context"
  | "competitor_claim"
  | "product_claim"
  | "repetition"
  | "sensitive_content"
  | "style";
export type Severity = "blocking" | "warning" | "info";
export type FlagSource = "model" | "lint" | "placeholder" | "claims" | "repetition";

export type FlagInput = {
  kind: FlagKind;
  severity: Severity;
  source: FlagSource;
  message: string;
  span_start: number | null;
  span_end: number | null;
  compared_type?: "draft" | "concept" | "published_post";
  compared_id?: string;
};

export type ClaimKind = "sourced_fact" | "opinion" | "interpretation" | "founder_experience";
export type ClaimRecord = {
  claim_text: string;
  claim_kind: ClaimKind;
  span_start: number | null;
  span_end: number | null;
  approved_fact: string | null;
  support_status: "supported" | "unsupported" | "not_applicable";
};

/** Stock phrases of generic AI thought leadership (PRODUCT_SPEC §5.7). Per-founder phrases add to these. */
export const GLOBAL_BANNED_PHRASES = [
  "in today's fast-paced world",
  "game-changer",
  "game changer",
  "let that sink in",
  "delve into",
  "unlock the power",
  "secret sauce",
  "paradigm shift",
  "revolutionize",
  "buckle up",
  "at the end of the day",
  "it's not just about",
  "here's the kicker",
  "in conclusion",
  "synergy",
];

/** Lines that belong in metadata, never in the post (PRODUCT_SPEC §5.3). */
const METADATA_LINE =
  /^\s*(?:\*\*)?(rationale|sources?|references?|review flags?|flags?|claims?|internal notes?)(?:\*\*)?\s*:/im;

export function metadataLeak(body: string): string | null {
  const match = body.match(METADATA_LINE);
  if (match) return `The post contains a "${match[1]}:" line; that belongs in metadata, not the post.`;
  if (/\[(?:flag|review|internal)[^\]]*\]/i.test(body))
    return "The post contains review or internal notes in brackets.";
  return null;
}

function span(body: string, needle: string): Span | null {
  const start = needle ? body.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  return start < 0 ? null : { start, end: start + needle.length };
}

function flag(
  kind: FlagKind,
  severity: Severity,
  source: FlagSource,
  message: string,
  at: Span | null = null,
): FlagInput {
  return { kind, severity, source, message, span_start: at?.start ?? null, span_end: at?.end ?? null };
}

const URL_PATTERN = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/gi;

/** Deterministic checks of the text alone. */
export function lintDraft(
  body: string,
  options: { avoidPhrases: string[]; styleRules: string[]; approvedFacts: string[] },
): FlagInput[] {
  const flags: FlagInput[] = [];
  const leak = metadataLeak(body);
  if (leak) flags.push(flag("style", "blocking", "lint", leak));

  if (body.length > LINKEDIN_MAX_CHARACTERS)
    flags.push(
      flag(
        "style",
        "blocking",
        "lint",
        `The post is ${body.length.toLocaleString("en-US")} characters; LinkedIn allows 3,000.`,
      ),
    );

  // No invented URLs: a link must appear in an approved fact (until research sources exist).
  for (const match of body.matchAll(URL_PATTERN)) {
    if (options.approvedFacts.some((fact) => fact.includes(match[0]))) continue;
    flags.push(
      flag("unsupported_claim", "blocking", "lint", `The link ${match[0]} is not from an approved source.`, {
        start: match.index,
        end: match.index + match[0].length,
      }),
    );
  }

  const phrases = [...new Set([...GLOBAL_BANNED_PHRASES, ...options.avoidPhrases.map((p) => p.toLowerCase())])];
  for (const phrase of phrases) {
    const at = span(body, phrase);
    if (at) flags.push(flag("style", "warning", "lint", `Avoid "${phrase}".`, at));
  }

  if (options.styleRules.some((rule) => /em[\s-]?dash/i.test(rule)) && body.includes("—"))
    flags.push(flag("style", "warning", "lint", "This founder doesn't use em-dashes.", span(body, "—")));

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const sentences = (p: string) => (p.match(/[.!?](?=\s|$)/g) ?? []).length;
  const choppy = paragraphs.filter((p) => p.length < 80 && sentences(p) <= 1);
  if (paragraphs.length >= 5 && choppy.length / paragraphs.length >= 0.6)
    flags.push(flag("style", "warning", "lint", "Most paragraphs are a single short line; the post reads choppy."));

  return flags;
}

/** Each [FOUNDER TO SUPPLY: …] placeholder blocks approval until the founder fills it in. */
export function placeholderFlags(body: string): FlagInput[] {
  return findPlaceholders(body).map((p) =>
    flag(
      "needs_personal_context",
      "blocking",
      "placeholder",
      `Founder to supply: ${p.request || "personal context"}`,
      p,
    ),
  );
}

export type ModelClaim = { text: string; kind: ClaimKind; approved_fact_index: number | null };

/**
 * Claim records and the flags they raise. Every factual claim not backed by
 * an approved fact is unsupported and blocks approval (Phase 4 criterion 5).
 * First-person experience must come from the founder.
 */
export function reviewClaims(
  body: string,
  claims: ModelClaim[],
  approvedFacts: string[],
): { records: ClaimRecord[]; flags: FlagInput[] } {
  const placeholders = findPlaceholders(body);
  const records: ClaimRecord[] = [];
  const flags: FlagInput[] = [];
  for (const claim of claims) {
    const at = span(body, claim.text);
    const base = {
      claim_text: claim.text.slice(0, 1000),
      claim_kind: claim.kind,
      span_start: at?.start ?? null,
      span_end: at?.end ?? null,
    };
    if (claim.kind === "sourced_fact") {
      const fact = claim.approved_fact_index !== null ? approvedFacts[claim.approved_fact_index] : undefined;
      if (fact) {
        records.push({ ...base, approved_fact: fact, support_status: "supported" });
      } else {
        records.push({ ...base, approved_fact: null, support_status: "unsupported" });
        flags.push(
          flag(
            "unsupported_claim",
            "blocking",
            "claims",
            `"${claim.text}" is stated as fact but isn't backed by an approved fact. Add a source, rephrase it as opinion, or remove it.`,
            at,
          ),
        );
      }
    } else if (claim.kind === "founder_experience") {
      const insidePlaceholder = at !== null && placeholders.some((p) => at.start >= p.start && at.end <= p.end);
      records.push({
        ...base,
        approved_fact: null,
        support_status: insidePlaceholder ? "not_applicable" : "unsupported",
      });
      if (!insidePlaceholder)
        flags.push(
          flag(
            "needs_personal_context",
            "blocking",
            "claims",
            `"${claim.text}" is the founder's own experience. Confirm it with the founder or replace it with a placeholder.`,
            at,
          ),
        );
    } else {
      records.push({ ...base, approved_fact: null, support_status: "not_applicable" });
    }
  }
  return { records, flags };
}

export type ModelFlag = {
  kind: "competitor_claim" | "product_claim" | "sensitive_content" | "weak_evidence" | "needs_personal_context";
  message: string;
  quote: string;
};

/** Flags the model raised about its own draft. Competitor claims block until they have a source. */
export function modelFlags(body: string, flags: ModelFlag[]): FlagInput[] {
  return flags.map((f) =>
    flag(
      f.kind,
      f.kind === "competitor_claim" || f.kind === "needs_personal_context" ? "blocking" : "warning",
      "model",
      f.message.slice(0, 1000) || f.kind,
      span(body, f.quote),
    ),
  );
}

/** Everything a fresh version is checked against, apart from repetition. */
export function reviewDraft(input: {
  body: string;
  claims: ModelClaim[];
  modelFlags: ModelFlag[];
  approvedFacts: string[];
  avoidPhrases: string[];
  styleRules: string[];
}): { records: ClaimRecord[]; flags: FlagInput[] } {
  const claims = reviewClaims(input.body, input.claims, input.approvedFacts);
  return {
    records: claims.records,
    flags: [
      ...placeholderFlags(input.body),
      ...claims.flags,
      ...modelFlags(input.body, input.modelFlags),
      ...lintDraft(input.body, input),
    ],
  };
}

/** Claims of an earlier version that still appear word for word in the edited text. */
export function carryClaims(body: string, previous: ModelClaim[]): ModelClaim[] {
  return previous.filter((claim) => body.toLowerCase().includes(claim.text.toLowerCase()));
}
