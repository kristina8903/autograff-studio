// Retrieval of a founder's writing examples for generation (docs/PRODUCT_SPEC.md
// §5.5: "same format, same topic, most recent"; decision D-25). Pure and
// deterministic: the same examples and query always give the same order.

import { daysBetween, type IsoDate } from "./dates";
import type { PostFormat } from "./formats";

export type RetrievableExample = {
  id: string;
  founderId: string;
  body: string;
  format: PostFormat | null;
  topics: string[];
  publishedAt: IsoDate | null;
  createdAt: IsoDate;
  approvedForVoice: boolean;
  evalHoldout: boolean;
};

export type RetrievalQuery = {
  founderId: string;
  format: PostFormat | null;
  topics: string[];
  text: string;
  today: IsoDate;
};

/** score = 3·format + 2·topics + 2·text + 1·recency, each part between 0 and 1. */
export const WEIGHTS = { format: 3, topics: 2, text: 2, recency: 1 } as const;
/** Recency halves after this many days. */
export const RECENCY_HALF_LIFE_DAYS = 180;
export const DEFAULT_LIMIT = 5;

export type ScoreParts = { format: number; topics: number; text: number; recency: number };
export type ScoredExample<T extends RetrievableExample = RetrievableExample> = {
  example: T;
  score: number;
  parts: ScoreParts;
};

const STOPWORDS = new Set(
  (
    "the and for are but not you your yours our ours their theirs they them this that these those with from " +
    "have has had was were will would can could should about into over under than then there here what when " +
    "where which who whom why how its it's all any each few more most other some such only own same very just " +
    "also been being because before after again further once while out off too onto via per"
  ).split(" "),
);

/** Lower-case word stems of three letters or more, without common words. */
export function terms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [];
  const out = new Set<string>();
  for (const word of words) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    out.add(stem(word));
  }
  return out;
}

// Deliberately crude: enough to match "repairs" with "repair" and "fleets" with "fleet".
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function overlap(query: Set<string>, candidate: Set<string>): number {
  if (query.size === 0) return 0;
  let hits = 0;
  for (const term of query) if (candidate.has(term)) hits++;
  return hits / query.size;
}

const normalizeTopics = (topics: string[]) => new Set(topics.map((t) => t.trim().toLowerCase()).filter(Boolean));

export function scoreExample(example: RetrievableExample, query: RetrievalQuery, queryTerms = terms(query.text)) {
  const age = Math.max(0, daysBetween(example.publishedAt ?? example.createdAt, query.today));
  const parts: ScoreParts = {
    format: query.format !== null && example.format === query.format ? 1 : 0,
    topics: overlap(normalizeTopics(query.topics), normalizeTopics(example.topics)),
    text: overlap(queryTerms, terms(example.body)),
    recency: RECENCY_HALF_LIFE_DAYS / (RECENCY_HALF_LIFE_DAYS + age),
  };
  const score =
    WEIGHTS.format * parts.format +
    WEIGHTS.topics * parts.topics +
    WEIGHTS.text * parts.text +
    WEIGHTS.recency * parts.recency;
  // Rounded so floating-point noise can never reorder equal scores.
  return { score: Math.round(score * 1e6) / 1e6, parts };
}

/** Whether an example may ever be retrieved for this founder. */
export function isRetrievable(example: RetrievableExample, founderId: string): boolean {
  return example.founderId === founderId && example.approvedForVoice && !example.evalHoldout;
}

/**
 * The top `limit` examples for a concept: only this founder's approved,
 * non-held-out examples, by score, then most recent, then id.
 */
export function retrieveExamples<T extends RetrievableExample>(
  examples: T[],
  query: RetrievalQuery,
  limit = DEFAULT_LIMIT,
): ScoredExample<T>[] {
  const queryTerms = terms(query.text);
  return examples
    .filter((example) => isRetrievable(example, query.founderId))
    .map((example) => ({ example, ...scoreExample(example, query, queryTerms) }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const dateA = a.example.publishedAt ?? a.example.createdAt;
      const dateB = b.example.publishedAt ?? b.example.createdAt;
      if (dateA !== dateB) return dateA < dateB ? 1 : -1;
      return a.example.id < b.example.id ? -1 : a.example.id > b.example.id ? 1 : 0;
    })
    .slice(0, Math.max(0, limit));
}
