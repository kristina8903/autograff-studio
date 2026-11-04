// Monthly brief content (docs/PRODUCT_SPEC.md §3.1). Stored as JSON on each
// immutable brief version; this schema is the single definition of its shape.

import { z } from "zod";

export const MAX_LIST_ITEMS = 30;
export const MAX_ITEM_LENGTH = 2000;

const item = z.string().trim().min(1).max(MAX_ITEM_LENGTH);
// Missing lists read as empty, so older stored versions still parse.
const list = z.array(item).max(MAX_LIST_ITEMS).default([]);

export const briefContentSchema = z.object({
  theme: z.string().trim().min(1, "Enter the month's theme.").max(200, "Keep the theme under 200 characters."),
  secondaryThemes: list,
  objectives: list,
  audiences: list,
  coreArguments: list,
  productUpdates: list,
  industryDevelopments: list,
  contentMix: list,
  topicsToAvoid: list,
  callsToAction: list,
  datesAndEvents: list,
  previousThemesToAvoid: list,
});

export type BriefContent = z.infer<typeof briefContentSchema>;

/** Founder-specific emphasis, keyed by founder id. */
export const founderEmphasisSchema = z.record(z.uuid(), z.string().trim().max(4000));
export type FounderEmphasis = z.infer<typeof founderEmphasisSchema>;

/** Facts and approved messaging the generator may state as fact. */
export const approvedFactsSchema = list;

export const LIST_FIELDS = [
  ["secondaryThemes", "Secondary themes"],
  ["objectives", "Business objectives"],
  ["audiences", "Target audiences"],
  ["coreArguments", "Core arguments and viewpoints"],
  ["productUpdates", "Product or company updates"],
  ["industryDevelopments", "Relevant industry developments"],
  ["contentMix", "Desired content mix"],
  ["topicsToAvoid", "Topics to avoid"],
  ["callsToAction", "Calls to action"],
  ["datesAndEvents", "Dates, events and launches"],
  ["previousThemesToAvoid", "Previous themes and topics not to repeat"],
] as const satisfies readonly (readonly [keyof BriefContent, string])[];

export type BriefInput = {
  content: BriefContent;
  founderEmphasis: FounderEmphasis;
  approvedFacts: string[];
  changeNote: string;
};

/** One item per non-empty line. */
export function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * What is wrong with a one-item-per-line field, in words that say which limit
 * was hit and where, or undefined if it is within the limits.
 */
export function listProblem(items: string[]): string | undefined {
  if (items.length > MAX_LIST_ITEMS)
    return `This has ${items.length} lines; the limit is ${MAX_LIST_ITEMS}. Combine related items on one line, or keep the most important ones.`;
  const long = items.findIndex((text) => text.length > MAX_ITEM_LENGTH);
  if (long >= 0)
    return `Line ${long + 1} is ${items[long].length.toLocaleString("en-US")} characters; each line can be up to ${MAX_ITEM_LENGTH.toLocaleString("en-US")}. Split it into shorter lines.`;
  return undefined;
}

export function parseBriefForm(
  form: FormData,
  founderIds: string[],
): { ok: true; data: BriefInput } | { ok: false; errors: Record<string, string> } {
  const listValues = Object.fromEntries(LIST_FIELDS.map(([key]) => [key, lines(form.get(key))]));
  const content = briefContentSchema.safeParse({ theme: form.get("theme") ?? "", ...listValues });
  const emphasis = founderEmphasisSchema.safeParse(
    Object.fromEntries(
      founderIds
        .map((id) => [id, String(form.get(`emphasis:${id}`) ?? "").trim()] as const)
        .filter(([, text]) => text.length > 0),
    ),
  );
  const factLines = lines(form.get("approvedFacts"));
  const facts = approvedFactsSchema.safeParse(factLines);
  const errors: Record<string, string> = {};
  for (const [key] of LIST_FIELDS) {
    const problem = listProblem(listValues[key]);
    if (problem) errors[key] = problem;
  }
  if (!content.success)
    for (const issue of content.error.issues) errors[String(issue.path[0])] ??= friendly(issue.message);
  if (!emphasis.success)
    errors.founderEmphasis = "Founder emphasis is too long: keep each founder's to 4,000 characters.";
  if (!facts.success)
    errors.approvedFacts =
      listProblem(factLines) ??
      `Keep approved facts to ${MAX_LIST_ITEMS} lines of up to ${MAX_ITEM_LENGTH.toLocaleString("en-US")} characters.`;
  if (!content.success || !emphasis.success || !facts.success) return { ok: false, errors };
  return {
    ok: true,
    data: {
      content: content.data,
      founderEmphasis: emphasis.data,
      approvedFacts: facts.data,
      changeNote: String(form.get("changeNote") ?? "")
        .trim()
        .slice(0, 500),
    },
  };
}

function friendly(message: string): string {
  return message.startsWith("Too big") ? "Too many lines, or a line is too long." : message;
}

export type BriefSnapshot = { content: BriefContent; founderEmphasis: FounderEmphasis; approvedFacts: string[] };

/** Reads a stored version leniently (stored data was validated when saved). */
export function readSnapshot(row: {
  content: unknown;
  founder_emphasis: unknown;
  approved_facts: unknown;
}): BriefSnapshot {
  const content = briefContentSchema.safeParse(row.content);
  return {
    content: content.success
      ? content.data
      : briefContentSchema.parse({ theme: String((row.content as { theme?: unknown })?.theme ?? "(untitled)") }),
    founderEmphasis: founderEmphasisSchema.catch({}).parse(row.founder_emphasis),
    approvedFacts: z.array(z.string()).catch([]).parse(row.approved_facts),
  };
}

export type BriefChange = { field: string; before: string[]; after: string[] };

/** What changed between two versions, field by field, for the history view. */
export function diffBriefs(
  before: BriefSnapshot,
  after: BriefSnapshot,
  founderNames: Record<string, string> = {},
): BriefChange[] {
  const changes: BriefChange[] = [];
  const push = (field: string, a: string[], b: string[]) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ field, before: a, after: b });
  };
  push("Theme", [before.content.theme], [after.content.theme]);
  for (const [key, label] of LIST_FIELDS) push(label, before.content[key], after.content[key]);
  const ids = [...new Set([...Object.keys(before.founderEmphasis), ...Object.keys(after.founderEmphasis)])].sort();
  for (const id of ids) {
    const name = founderNames[id] ?? "Founder";
    push(
      `Emphasis: ${name}`,
      before.founderEmphasis[id] ? [before.founderEmphasis[id]] : [],
      after.founderEmphasis[id] ? [after.founderEmphasis[id]] : [],
    );
  }
  push("Approved facts and messaging", before.approvedFacts, after.approvedFacts);
  return changes;
}
