// Post formats. The same list is the `post_format` enum in the database.

export const POST_FORMATS = [
  ["story", "Story"],
  ["opinion", "Opinion"],
  ["how_to", "How-to"],
  ["data_insight", "Data insight"],
  ["lesson", "Lesson learned"],
  ["announcement", "Announcement"],
  ["list", "List"],
  ["question", "Question to the audience"],
  ["other", "Other"],
] as const;

export type PostFormat = (typeof POST_FORMATS)[number][0];

const VALUES = new Set<string>(POST_FORMATS.map(([value]) => value));

export function isPostFormat(value: unknown): value is PostFormat {
  return typeof value === "string" && VALUES.has(value);
}

export function formatLabel(format: string | null | undefined): string {
  return POST_FORMATS.find(([value]) => value === format)?.[1] ?? "No format";
}

export const FORMAT_VALUES = POST_FORMATS.map(([value]) => value) as [PostFormat, ...PostFormat[]];
