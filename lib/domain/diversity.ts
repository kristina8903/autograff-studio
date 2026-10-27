// The diversity report (PRODUCT_SPEC §6): how a month's content spreads over
// each fingerprint field, per founder and across founders, and where it
// repeats itself. Pure; the page reads the month's live drafts.

export const DIVERSITY_FIELDS = ["topics", "format", "hook_type", "audience", "product_mentions", "cta"] as const;
export type DiversityField = (typeof DIVERSITY_FIELDS)[number];

export const FIELD_LABELS: Record<DiversityField, string> = {
  topics: "Topics",
  format: "Formats",
  hook_type: "Hooks",
  audience: "Audiences",
  product_mentions: "Product mentions",
  cta: "Calls to action",
};

/** Fields that hold a list: an item counts once for each value. */
const LIST_FIELDS: ReadonlySet<DiversityField> = new Set(["topics", "product_mentions"]);

export const NOT_SET = "Not set";

export type DiversityItem = {
  id: string;
  founderId: string;
  title: string;
  fingerprint: Record<string, unknown>;
  /** Open repetition warnings on the current version. */
  repetitionWarnings: number;
};

export type ValueCount = { value: string; total: number; byFounder: Record<string, number> };

function valuesOf(item: DiversityItem, field: DiversityField): string[] {
  const raw = item.fingerprint[field];
  const list = Array.isArray(raw) ? raw : [raw];
  const values = list.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
  // A list field with nothing in it is "none", a missing single value "not set".
  if (values.length === 0) return LIST_FIELDS.has(field) && Array.isArray(raw) ? [] : [NOT_SET];
  // Each value once per item, compared without case.
  const seen = new Map<string, string>();
  for (const v of values) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()];
}

/** Values of one field, most used first. Values that differ only in case are one value. */
export function distribution(items: DiversityItem[], field: DiversityField): ValueCount[] {
  const counts = new Map<string, ValueCount>();
  for (const item of items) {
    for (const value of valuesOf(item, field)) {
      const key = value.toLowerCase();
      const entry = counts.get(key) ?? { value, total: 0, byFounder: {} };
      entry.total += 1;
      entry.byFounder[item.founderId] = (entry.byFounder[item.founderId] ?? 0) + 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
}

export type HotSpot =
  | { kind: "same_argument"; argument: string; items: DiversityItem[] }
  | { kind: "crowded"; field: DiversityField; value: string; founderId: string | null; count: number; of: number }
  | { kind: "repetition_warning"; item: DiversityItem };

/** A value is crowded when it covers more than half of at least this many items. */
export const CROWDED_MIN_ITEMS = 4;

export function hotSpots(items: DiversityItem[]): HotSpot[] {
  const spots: HotSpot[] = [];

  // The same argument key in two or more pieces of content, any founders.
  const byArgument = new Map<string, DiversityItem[]>();
  for (const item of items) {
    const key = item.fingerprint.argument_key;
    if (typeof key !== "string" || key.trim() === "") continue;
    const normalized = key.trim().toLowerCase();
    byArgument.set(normalized, [...(byArgument.get(normalized) ?? []), item]);
  }
  for (const group of byArgument.values())
    if (group.length > 1)
      spots.push({ kind: "same_argument", argument: String(group[0].fingerprint.argument_key).trim(), items: group });

  // One value taking over a founder's month, or everyone's.
  const scopes: { founderId: string | null; items: DiversityItem[] }[] = [
    { founderId: null, items },
    ...[...new Set(items.map((i) => i.founderId))].map((id) => ({
      founderId: id,
      items: items.filter((i) => i.founderId === id),
    })),
  ];
  for (const scope of scopes) {
    if (scope.items.length < CROWDED_MIN_ITEMS) continue;
    for (const field of DIVERSITY_FIELDS) {
      if (field === "audience") continue; // one audience for a month is normal
      for (const v of distribution(scope.items, field)) {
        if (v.value !== NOT_SET && v.total * 2 > scope.items.length)
          spots.push({
            kind: "crowded",
            field,
            value: v.value,
            founderId: scope.founderId,
            count: v.total,
            of: scope.items.length,
          });
      }
    }
  }

  for (const item of items) if (item.repetitionWarnings > 0) spots.push({ kind: "repetition_warning", item });
  return spots;
}
