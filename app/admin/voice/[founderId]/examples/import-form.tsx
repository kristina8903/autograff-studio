"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import {
  MAX_EXPORT_FILE_BYTES,
  MAX_IMPORT_POSTS,
  parseLinkedInExport,
  type LinkedInImport,
} from "@/lib/domain/linkedin-export";
import { importPostsAction } from "../../../voice-actions";

const BATCH = 50;

export function ImportExportForm({ founderId }: { founderId: string }) {
  const router = useRouter();
  const [parsed, setParsed] = useState<LinkedInImport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [approved, setApproved] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function choose(file: File | undefined) {
    setParsed(null);
    setOutcome(null);
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_EXPORT_FILE_BYTES) return setFileError("That file is larger than 10 MB. Choose Shares.csv.");
    // The file is read here in the browser; only the posts are sent to the server.
    setParsed(parseLinkedInExport(await file.text()));
  }

  function run() {
    if (!parsed) return;
    const posts = parsed.posts;
    startTransition(async () => {
      let added = 0;
      let duplicates = 0;
      for (let start = 0; start < posts.length; start += BATCH) {
        setProgress(`Importing ${Math.min(start + BATCH, posts.length)} of ${posts.length}…`);
        const result = await importPostsAction(founderId, posts.slice(start, start + BATCH), approved);
        if ("error" in result) {
          setProgress(null);
          setOutcome({ tone: "error", text: `${result.error} ${added} were added before this.` });
          return;
        }
        added += result.added;
        duplicates += result.duplicates;
      }
      setProgress(null);
      setParsed(null);
      setOutcome({
        tone: "success",
        text:
          `Imported ${added} post${added === 1 ? "" : "s"}.` +
          (duplicates ? ` Skipped ${duplicates} already in the library.` : ""),
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        On LinkedIn: Settings → Data privacy → Get a copy of your data. Choose the posts (or the full archive), download
        the ZIP when LinkedIn emails it, unzip it, and pick <strong>Shares.csv</strong>. The file is read in this
        browser; only the posts are uploaded.
      </p>
      <Field label="LinkedIn export file (Shares.csv)">
        <Input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void choose(event.target.files?.[0])}
          disabled={pending}
        />
      </Field>
      {fileError ? <Alert tone="error">{fileError}</Alert> : null}
      {parsed?.error ? (
        <Alert tone="error">
          {parsed.error}
          {parsed.columns.length ? ` Columns found: ${parsed.columns.join(", ")}.` : ""}
        </Alert>
      ) : null}
      {parsed && !parsed.error ? (
        <section aria-label="Import preview" className="space-y-2 rounded-md border border-border p-3 text-sm">
          <p>
            Found <strong>{parsed.posts.length}</strong> post{parsed.posts.length === 1 ? "" : "s"}
            {parsed.withoutText ? `, plus ${parsed.withoutText} repost(s) with no text of their own (skipped)` : ""}
            {parsed.tooLong ? `, and ${parsed.tooLong} over 10,000 characters (skipped)` : ""}.
            {parsed.posts.length === MAX_IMPORT_POSTS ? ` Only the newest ${MAX_IMPORT_POSTS} are imported.` : ""}
          </p>
          {parsed.posts.slice(0, 3).map((post, index) => (
            <p key={index} className="line-clamp-2 text-xs text-muted">
              {post.publishedAt ?? "No date"}: {post.body}
            </p>
          ))}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> Approve all for
            voice
          </label>
          <Button type="button" onClick={run} disabled={pending || parsed.posts.length === 0}>
            {pending ? (progress ?? "Importing…") : `Import ${parsed.posts.length} posts`}
          </Button>
        </section>
      ) : null}
      {outcome ? <Alert tone={outcome.tone}>{outcome.text}</Alert> : null}
    </div>
  );
}
