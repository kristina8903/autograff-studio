// A fixed, invented evaluation set: one brief, one voice profile, approved
// examples, and examples held out from retrieval to compare drafts against.
// For a founder's real held-out examples, point EVAL_VOICE_FILE at a JSON file
// with the same shape as VOICE_SET.
import { readSnapshot } from "@/lib/domain/briefs";
import { EMPTY_PROFILE, type VoiceProfile } from "@/lib/domain/voice";

export const BRIEF = {
  ...readSnapshot({
    content: {
      theme: "Operational uncertainty in vehicle repair",
      coreArguments: ["Predictability matters more to fleets than raw speed"],
      topicsToAvoid: ["Naming competitors"],
    },
    founder_emphasis: { f1: "Why software must help work progress, not just record it" },
    approved_facts: [],
  }),
  versionNo: 1,
};

export const PROFILE: VoiceProfile = {
  ...EMPTY_PROFILE,
  attributes: {
    ...EMPTY_PROFILE.attributes,
    sentenceLength: "varied",
    humor: "light",
    pointOfView: "First person, plain and direct",
  },
  expertiseTopics: ["repair operations", "fleet maintenance"],
  avoidPhrases: ["game-changer"],
  styleRules: ["No em-dashes"],
};

export type VoiceSet = {
  founder: { displayName: string; roleTitle: string };
  profile: VoiceProfile;
  examples: { id: string; body: string; format: string | null; publishedAt: string | null }[];
  heldOut: { id: string; body: string; topic: string }[];
};

export const VOICE_SET: VoiceSet = {
  founder: { displayName: "Sample CEO", roleTitle: "CEO" },
  profile: PROFILE,
  examples: [
    {
      id: "e1",
      body: "A fleet manager told me last week that the hardest part of a repair is not the repair. It is not knowing when the van comes back. We build for that sentence.",
      format: "story",
      publishedAt: "2026-09-15",
    },
    {
      id: "e2",
      body: "Three things I would track before buying any shop software: cycle time, parts wait, and how often customers call to ask for an update. The third one tells you the most.",
      format: "list",
      publishedAt: "2026-08-02",
    },
  ],
  heldOut: [
    {
      id: "h1",
      body: "We used to think speed was the goal. It turns out predictability is what fleets pay for. A late van you knew about is a plan. A late van you did not know about is a crisis.",
      topic: "Why predictability beats speed for fleet repairs",
    },
  ],
};
