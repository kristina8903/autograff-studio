// Founder voice profile (docs/PRODUCT_SPEC.md §5.5). Stored on each immutable
// voice_profile_versions row; this schema is the single definition of its shape.

import { z } from "zod";
import { lines } from "./briefs";
import { FORMAT_VALUES, POST_FORMATS, formatLabel, isPostFormat, type PostFormat } from "./formats";

export const SENTENCE_LENGTHS = ["short", "medium", "long", "varied"] as const;
export const HUMOR_LEVELS = ["none", "light", "frequent"] as const;
export const TECHNICAL_DEPTHS = ["low", "medium", "high"] as const;

const text = (max: number) => z.string().trim().max(max).default("");

export const voiceAttributesSchema = z.object({
  sentenceLength: z.enum(SENTENCE_LENGTHS).optional(),
  paragraphStyle: text(500),
  humor: z.enum(HUMOR_LEVELS).optional(),
  anecdotes: text(500),
  technicalDepth: z.enum(TECHNICAL_DEPTHS).optional(),
  pointOfView: text(500),
});
export type VoiceAttributes = z.infer<typeof voiceAttributesSchema>;

const item = z.string().trim().min(1).max(300);
const list = z.array(item).max(40).default([]);

export const voiceProfileSchema = z.object({
  attributes: voiceAttributesSchema,
  preferredPhrases: list,
  avoidPhrases: list,
  expertiseTopics: list,
  writingHabits: list,
  styleRules: list,
  formatPreferences: z.partialRecord(z.enum(FORMAT_VALUES), z.string().trim().min(1).max(500)),
  notes: text(4000),
});
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const LIST_FIELDS = [
  ["expertiseTopics", "Topics of real experience", "The only topics the AI may write about in the first person."],
  ["preferredPhrases", "Phrases they use", ""],
  ["avoidPhrases", "Phrases to avoid", ""],
  ["writingHabits", "Writing habits", "e.g. Ends with a question to the reader."],
  ["styleRules", "Style rules agreed with this founder", "e.g. No em-dashes. Overrides the company default."],
] as const satisfies readonly (readonly [keyof VoiceProfile, string, string])[];

export const EMPTY_PROFILE: VoiceProfile = voiceProfileSchema.parse({ attributes: {}, formatPreferences: {} });

export function parseVoiceForm(
  form: FormData,
): { ok: true; data: VoiceProfile & { changeReason: string } } | { ok: false; errors: Record<string, string> } {
  const optional = (key: string) => String(form.get(key) ?? "") || undefined;
  const parsed = voiceProfileSchema.safeParse({
    attributes: {
      sentenceLength: optional("sentenceLength"),
      paragraphStyle: form.get("paragraphStyle") ?? "",
      humor: optional("humor"),
      anecdotes: form.get("anecdotes") ?? "",
      technicalDepth: optional("technicalDepth"),
      pointOfView: form.get("pointOfView") ?? "",
    },
    ...Object.fromEntries(LIST_FIELDS.map(([key]) => [key, lines(form.get(key))])),
    formatPreferences: Object.fromEntries(
      POST_FORMATS.map(([value]) => [value, String(form.get(`format:${value}`) ?? "").trim()]).filter(
        ([, note]) => note,
      ),
    ),
    notes: form.get("notes") ?? "",
  });
  const changeReason = String(form.get("changeReason") ?? "").trim();
  const errors: Record<string, string> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0] === "attributes" ? issue.path[1] : issue.path[0])] ??= "Too long, or too many lines.";
  if (!changeReason) errors.changeReason = "Say why the profile is changing.";
  else if (changeReason.length > 500) errors.changeReason = "Keep the reason under 500 characters.";
  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { ...parsed.data, changeReason } };
}

/** Reads a stored version leniently (it was validated when saved). */
export function readVoiceVersion(row: {
  attributes: unknown;
  preferred_phrases: string[];
  avoid_phrases: string[];
  expertise_topics: string[];
  writing_habits: string[];
  style_rules: string[];
  format_preferences: unknown;
  notes: string;
}): VoiceProfile {
  const attributes = voiceAttributesSchema.safeParse(row.attributes);
  const formats = z.record(z.string(), z.string()).catch({}).parse(row.format_preferences);
  return {
    attributes: attributes.success ? attributes.data : EMPTY_PROFILE.attributes,
    preferredPhrases: row.preferred_phrases,
    avoidPhrases: row.avoid_phrases,
    expertiseTopics: row.expertise_topics,
    writingHabits: row.writing_habits,
    styleRules: row.style_rules,
    formatPreferences: Object.fromEntries(Object.entries(formats).filter(([key]) => isPostFormat(key))) as Partial<
      Record<PostFormat, string>
    >,
    notes: row.notes,
  };
}

const ATTRIBUTE_LABELS: Record<keyof VoiceAttributes, string> = {
  sentenceLength: "Sentence length",
  paragraphStyle: "Paragraph structure",
  humor: "Humor",
  anecdotes: "Anecdotes",
  technicalDepth: "Technical depth",
  pointOfView: "Point of view and style",
};

/** Label and display lines for every non-empty part of a profile, in a fixed order. */
export function describeProfile(profile: VoiceProfile): { label: string; values: string[] }[] {
  const rows: { label: string; values: string[] }[] = [];
  for (const key of Object.keys(ATTRIBUTE_LABELS) as (keyof VoiceAttributes)[]) {
    const value = profile.attributes[key];
    if (value) rows.push({ label: ATTRIBUTE_LABELS[key], values: [value] });
  }
  for (const [key, label] of LIST_FIELDS) if (profile[key].length) rows.push({ label, values: profile[key] });
  for (const [format, note] of Object.entries(profile.formatPreferences))
    rows.push({ label: `Format: ${formatLabel(format)}`, values: [note] });
  if (profile.notes) rows.push({ label: "Notes", values: [profile.notes] });
  return rows;
}

export type VoiceChange = { field: string; before: string[]; after: string[] };

export function diffProfiles(before: VoiceProfile, after: VoiceProfile): VoiceChange[] {
  const map = (profile: VoiceProfile) => new Map(describeProfile(profile).map((row) => [row.label, row.values]));
  const a = map(before);
  const b = map(after);
  const labels = [...new Set([...a.keys(), ...b.keys()])];
  return labels
    .map((field) => {
      const was = a.get(field) ?? [];
      const now = b.get(field) ?? [];
      return { field, before: was.filter((v) => !now.includes(v)), after: now.filter((v) => !was.includes(v)) };
    })
    .filter((change) => change.before.length || change.after.length);
}
