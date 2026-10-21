// The founder-voice part of a generation prompt: the structured profile plus the
// retrieved writing examples. Phase 4 puts this in the cached prompt prefix.
// Versioned file (docs/ARCHITECTURE.md): change behavior in a new v2 file.

import { formatLabel } from "@/lib/domain/formats";
import { describeProfile, type VoiceProfile } from "@/lib/domain/voice";

export const VOICE_CONTEXT_VERSION = "voice-context.v1";

export type VoiceContextInput = {
  founder: { displayName: string; roleTitle: string };
  profile: VoiceProfile | null;
  profileVersion: number | null;
  examples: { id: string; body: string; format: string | null; publishedAt: string | null }[];
};

export function buildVoiceContext({ founder, profile, profileVersion, examples }: VoiceContextInput): string {
  const out: string[] = [];
  out.push(`# Founder voice: ${founder.displayName} (${founder.roleTitle})`);
  if (profile) {
    out.push(`Voice profile version ${profileVersion ?? "?"}.`);
    for (const row of describeProfile(profile)) {
      out.push(`\n## ${row.label}`);
      for (const value of row.values) out.push(`- ${value}`);
    }
    out.push(
      "",
      profile.expertiseTopics.length
        ? `Write in the first person only about: ${profile.expertiseTopics.join("; ")}.`
        : "No topics of first-hand experience are recorded: do not write first-person experience.",
    );
  } else {
    out.push("No voice profile has been written yet. Write plainly and do not imitate a personal style.");
  }

  out.push(
    "",
    "# Writing examples",
    "These are this founder's own posts, given as a style reference only. Match their rhythm, structure and word",
    "choice. Do not reuse their facts, numbers, anecdotes, names or claims unless the concept provides them.",
  );
  if (examples.length === 0) out.push("(No approved examples yet.)");
  for (const example of examples) {
    const meta = [`id="${example.id}"`, `format="${formatLabel(example.format)}"`];
    if (example.publishedAt) meta.push(`published="${example.publishedAt}"`);
    out.push(`<example ${meta.join(" ")}>`, example.body.replaceAll("</example>", "<\\/example>"), "</example>");
  }
  return out.join("\n");
}
