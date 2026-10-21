// Feedback signal kinds (docs/PRODUCT_SPEC.md §5.5). Only the voice kinds can
// ever change a voice profile; the database enforces the same rule.

export const FEEDBACK_KIND_LABELS = {
  stable_preference: "Stable preference",
  format_preference: "Format preference",
  one_off: "One-off edit",
  editorial_correction: "Editorial correction",
} as const;

export type FeedbackKind = keyof typeof FEEDBACK_KIND_LABELS;

export const VOICE_FEEDBACK_KINDS: readonly FeedbackKind[] = ["stable_preference", "format_preference"];

export function changesVoice(kind: string): boolean {
  return (VOICE_FEEDBACK_KINDS as readonly string[]).includes(kind);
}
