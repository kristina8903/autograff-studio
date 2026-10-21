import "server-only";
import type { RetrievableExample } from "@/lib/domain/retrieval";
import type { Database } from "@/lib/supabase/database.types";

export type ExampleRow = Database["public"]["Tables"]["writing_examples"]["Row"];

export const EXAMPLE_COLUMNS =
  "id, founder_id, kind, body, source_url, published_at, format, topics, approved_for_voice, eval_holdout, created_at";

export function toRetrievable(
  row: Pick<
    ExampleRow,
    | "id"
    | "founder_id"
    | "body"
    | "format"
    | "topics"
    | "published_at"
    | "created_at"
    | "approved_for_voice"
    | "eval_holdout"
  >,
): RetrievableExample {
  return {
    id: row.id,
    founderId: row.founder_id,
    body: row.body,
    format: row.format,
    topics: row.topics,
    publishedAt: row.published_at,
    createdAt: row.created_at.slice(0, 10),
    approvedForVoice: row.approved_for_voice,
    evalHoldout: row.eval_holdout,
  };
}
