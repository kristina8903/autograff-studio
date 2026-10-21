import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { localToday } from "@/lib/domain/dates";
import { POST_FORMATS, formatLabel, isPostFormat } from "@/lib/domain/formats";
import { WEIGHTS, retrieveExamples } from "@/lib/domain/retrieval";
import { EXAMPLE_COLUMNS, toRetrievable } from "@/lib/server/voice";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AddExampleForm, BulkAddForm, ExampleSettings } from "./example-forms";

export const metadata: Metadata = { title: "Writing examples" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_LABEL = {
  published_linkedin: "LinkedIn post",
  approved_example: "Shared by the founder",
  slack_excerpt: "Slack excerpt",
  other: "Other",
} as const;

export default async function ExamplesPage({ params, searchParams }: PageProps<"/admin/voice/[founderId]/examples">) {
  await requireAdmin();
  const { founderId } = await params;
  if (!UUID.test(founderId)) notFound();
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: founder }, { data: rows }] = await Promise.all([
    supabase.from("founders").select("id, display_name, timezone").eq("id", founderId).maybeSingle(),
    supabase
      .from("writing_examples")
      .select(EXAMPLE_COLUMNS)
      .eq("founder_id", founderId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ]);
  if (!founder) notFound();
  const examples = rows ?? [];

  // Retrieval preview: what generation would see for a concept like this.
  const testing = typeof query.test === "string";
  const testFormat = typeof query.format === "string" && isPostFormat(query.format) ? query.format : null;
  const testTopics = typeof query.topics === "string" ? query.topics : "";
  const testText = typeof query.q === "string" ? query.q : "";
  const results = testing
    ? retrieveExamples(examples.map(toRetrievable), {
        founderId,
        format: testFormat,
        topics: testTopics.split(","),
        text: testText,
        today: localToday(founder.timezone),
      })
    : [];
  const bodyOf = new Map(examples.map((e) => [e.id, e.body]));

  return (
    <>
      <PageHeader
        title={`${founder.display_name}: writing examples`}
        description="Only approved examples are given to the AI, and never those held out for evaluation."
        actions={
          <div className="flex gap-4 text-sm">
            <Link href={`/admin/voice/${founderId}`} className="text-accent hover:underline">
              Voice profile
            </Link>
            <Link href="/admin/voice" className="text-muted hover:text-foreground">
              ← All founders
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Add one example</h2>
          <AddExampleForm founderId={founderId} />
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Paste several LinkedIn posts</h2>
          <BulkAddForm founderId={founderId} />
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="mb-1 text-sm font-semibold">Which examples would the AI see?</h2>
        <p className="mb-3 text-xs text-muted">
          Describe a post to see the {5} examples generation would use, best match first. Score = {WEIGHTS.format} ×
          same format + {WEIGHTS.topics} × shared topics + {WEIGHTS.text} × shared words + {WEIGHTS.recency} × recency.
        </p>
        <form className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="test" value="1" />
          <Field label="Post format">
            <Select name="format" defaultValue={testFormat ?? ""} className="w-44">
              <option value="">Any</option>
              {POST_FORMATS.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Post topics">
            <Input name="topics" defaultValue={testTopics} placeholder="fleet maintenance" className="w-48" />
          </Field>
          <Field label="What the post is about">
            <Input name="q" defaultValue={testText} className="w-72" />
          </Field>
          <Button type="submit" variant="secondary">
            Show examples
          </Button>
        </form>
        {testing ? (
          results.length ? (
            <ol aria-label="Retrieved examples" className="mt-4 space-y-2 text-sm">
              {results.map(({ example, score, parts }) => (
                <li key={example.id} className="rounded-md border border-border p-3">
                  <p className="line-clamp-2">{bodyOf.get(example.id)}</p>
                  <p className="mt-1 text-xs text-muted">
                    Score {score.toFixed(2)} · format {parts.format} · topics {parts.topics.toFixed(2)} · words{" "}
                    {parts.text.toFixed(2)} · recency {parts.recency.toFixed(2)}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-muted">No approved examples to use yet.</p>
          )
        ) : null}
      </Card>

      <Card className="overflow-x-auto p-0">
        <table aria-label="Examples" className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Example</th>
            </tr>
          </thead>
          <tbody>
            {examples.map((example) => (
              <tr key={example.id} className="border-b border-border align-top last:border-0">
                <td className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{KIND_LABEL[example.kind]}</span>
                    {example.published_at ? <span>· {example.published_at}</span> : null}
                    <span>· {formatLabel(example.format)}</span>
                    {example.source_url ? (
                      <a href={example.source_url} target="_blank" rel="noreferrer noopener" className="underline">
                        link
                      </a>
                    ) : null}
                    {example.eval_holdout ? (
                      <Badge>held out</Badge>
                    ) : example.approved_for_voice ? (
                      <Badge tone="success">approved</Badge>
                    ) : (
                      <Badge>not used</Badge>
                    )}
                  </div>
                  <p className="whitespace-pre-line">{example.body}</p>
                  <ExampleSettings founderId={founderId} example={example} />
                </td>
              </tr>
            ))}
            {examples.length ? null : (
              <tr>
                <td className="px-4 py-6 text-center text-muted">No examples yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
