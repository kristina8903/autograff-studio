// Reads the posts file from a LinkedIn data export ("Get a copy of your data").
// The export is parsed in the browser; only the posts are sent to the server.
//
// LinkedIn has renamed these columns over time, so each is matched against a
// list of known names, case- and space-insensitively. The posts file has been
// `Shares.csv` with Date, ShareLink, ShareCommentary, SharedUrl, MediaUrl and
// Visibility [S: not verified against a current export].

import { parseCsv } from "./csv";
import { isIsoDate, type IsoDate } from "./dates";
import { MAX_EXAMPLE_LENGTH, isHttpsUrl, type PastedExample } from "./examples";

// Deliberately narrow: the export's messages.csv has a CONTENT column, and a
// private message must never be mistaken for a post.
const TEXT_COLUMNS = ["sharecommentary", "postcommentary", "commentary"];
const LINK_COLUMNS = ["sharelink", "postlink", "permalink", "link", "url"];
const DATE_COLUMNS = ["date", "sharedate", "createddate", "publisheddate", "postdate"];

export const MAX_IMPORT_POSTS = 2000;

export type LinkedInImport = {
  posts: PastedExample[];
  /** Rows with no text of their own, e.g. reposts. */
  withoutText: number;
  tooLong: number;
  /** Column names found, for the error message when the file isn't recognized. */
  columns: string[];
  error: string | null;
};

const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

function findColumn(header: string[], names: string[]): number {
  const keys = header.map(key);
  for (const name of names) {
    const index = keys.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

/** "2024-03-12 14:22:05", "2024-03-12T14:22:05Z" or "3/12/2024" → "2024-03-12". */
export function exportDate(value: string): IsoDate | null {
  const trimmed = value.trim();
  const iso = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) && isIsoDate(iso)) return iso;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const date = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    return isIsoDate(date) ? date : null;
  }
  return null;
}

export function parseLinkedInExport(csv: string): LinkedInImport {
  const rows = parseCsv(csv);
  // Some LinkedIn files start with a few lines of notes before the header.
  const headerIndex = rows.findIndex((row) => findColumn(row, TEXT_COLUMNS) >= 0);
  const result: LinkedInImport = { posts: [], withoutText: 0, tooLong: 0, columns: [], error: null };
  if (headerIndex < 0) {
    result.columns = (rows.find((row) => row.some((cell) => cell.trim())) ?? []).map((c) => c.trim()).slice(0, 20);
    result.error = "This doesn't look like the posts file from a LinkedIn export. Choose the export ZIP or Shares.csv.";
    return result;
  }
  const header = rows[headerIndex];
  result.columns = header.map((c) => c.trim());
  const text = findColumn(header, TEXT_COLUMNS);
  const link = findColumn(header, LINK_COLUMNS);
  const date = findColumn(header, DATE_COLUMNS);

  const seen = new Set<string>();
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.every((cell) => !cell.trim())) continue;
    const body = (row[text] ?? "").trim();
    if (!body) {
      result.withoutText++;
      continue;
    }
    if (body.length > MAX_EXAMPLE_LENGTH) {
      result.tooLong++;
      continue;
    }
    if (seen.has(body)) continue;
    seen.add(body);
    const url = link >= 0 ? (row[link] ?? "").trim() : "";
    result.posts.push({
      body,
      sourceUrl: url && isHttpsUrl(url) ? url : null,
      publishedAt: date >= 0 ? exportDate(row[date] ?? "") : null,
    });
  }
  // Newest first, so a capped import keeps the most recent posts.
  result.posts.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  if (result.posts.length > MAX_IMPORT_POSTS) {
    result.posts = result.posts.slice(0, MAX_IMPORT_POSTS);
  }
  return result;
}
