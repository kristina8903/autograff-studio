// Writing examples: bulk paste parsing and tag cleanup.

import { isIsoDate, type IsoDate } from "./dates";

export const MAX_EXAMPLE_LENGTH = 10_000;
export const MAX_BULK_EXAMPLES = 100;

export type PastedExample = { body: string; sourceUrl: string | null; publishedAt: IsoDate | null };

/**
 * Parses posts pasted in one block. Posts are separated by a line of three or
 * more dashes. Each post may start with "URL: …" and "Date: YYYY-MM-DD" lines,
 * in either order; everything after them is the post text.
 */
export function parseBulkPaste(text: string): { items: PastedExample[]; problems: string[] } {
  const items: PastedExample[] = [];
  const problems: string[] = [];
  const chunks = text
    .replace(/\r\n?/g, "\n")
    .split(/^[ \t]*-{3,}[ \t]*$/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  chunks.forEach((chunk, index) => {
    const label = `Post ${index + 1}`;
    const lines = chunk.split("\n");
    let sourceUrl: string | null = null;
    let publishedAt: IsoDate | null = null;
    while (lines.length) {
      const url = lines[0].match(/^\s*url:\s*(.*?)\s*$/i);
      const date = lines[0].match(/^\s*date:\s*(.*?)\s*$/i);
      if (url) sourceUrl = url[1];
      else if (date) publishedAt = date[1];
      else break;
      lines.shift();
    }
    const body = lines.join("\n").trim();
    if (!body) return void problems.push(`${label} has no text.`);
    if (body.length > MAX_EXAMPLE_LENGTH) return void problems.push(`${label} is longer than 10,000 characters.`);
    if (sourceUrl !== null && !isHttpsUrl(sourceUrl))
      return void problems.push(`${label}: the URL must start with https://.`);
    if (publishedAt !== null && !isIsoDate(publishedAt))
      return void problems.push(`${label}: write the date as YYYY-MM-DD.`);
    items.push({ body, sourceUrl, publishedAt });
  });
  if (items.length + problems.length > MAX_BULK_EXAMPLES)
    problems.push(`Paste at most ${MAX_BULK_EXAMPLES} posts at a time.`);
  return { items, problems };
}

export function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\/\S+$/.test(value) || value.length > 2000) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Comma-separated tags: lower-cased, trimmed, de-duplicated (as the database stores them). */
export function parseTags(value: FormDataEntryValue | null): string[] {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
    .sort()
    .slice(0, 20);
}
