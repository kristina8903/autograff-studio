import { diffWords } from "@/lib/domain/diff";

/** Word-level changes between two versions of a post. */
export function WordDiff({ before, after }: { before: string; after: string }) {
  return (
    <p aria-label="Changes" className="whitespace-pre-wrap text-sm leading-relaxed">
      {diffWords(before, after).map((part, i) =>
        part.kind === "same" ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === "added" ? (
          <ins key={i} className="bg-success/15 text-success no-underline">
            {part.text}
          </ins>
        ) : (
          <del key={i} className="bg-danger/10 text-danger">
            {part.text}
          </del>
        ),
      )}
    </p>
  );
}
