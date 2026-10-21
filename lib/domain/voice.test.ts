import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, describeProfile, diffProfiles, parseVoiceForm, readVoiceVersion } from "./voice";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("parseVoiceForm", () => {
  it("reads attributes, one-per-line lists and per-format notes", () => {
    const parsed = parseVoiceForm(
      form({
        sentenceLength: "short",
        humor: "",
        pointOfView: " First person ",
        expertiseTopics: "repair operations\n\n fleet maintenance ",
        styleRules: "No em-dashes",
        "format:story": "Open with the moment",
        "format:list": " ",
        changeReason: "First version",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.attributes).toEqual({
      sentenceLength: "short",
      paragraphStyle: "",
      anecdotes: "",
      pointOfView: "First person",
    });
    expect(parsed.data.expertiseTopics).toEqual(["repair operations", "fleet maintenance"]);
    expect(parsed.data.styleRules).toEqual(["No em-dashes"]);
    expect(parsed.data.formatPreferences).toEqual({ story: "Open with the moment" });
    expect(parsed.data.changeReason).toBe("First version");
  });

  it("requires a reason for every change", () => {
    const parsed = parseVoiceForm(form({ pointOfView: "x" }));
    expect(parsed).toEqual({ ok: false, errors: { changeReason: "Say why the profile is changing." } });
  });

  it("rejects values outside the allowed choices", () => {
    const parsed = parseVoiceForm(form({ humor: "constant", changeReason: "x" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.errors)).toEqual(["humor"]);
  });
});

describe("readVoiceVersion", () => {
  it("drops unknown formats and tolerates malformed attributes", () => {
    const profile = readVoiceVersion({
      attributes: { humor: "constant" },
      preferred_phrases: [],
      avoid_phrases: [],
      expertise_topics: ["ops"],
      writing_habits: [],
      style_rules: [],
      format_preferences: { story: "A", poem: "B" },
      notes: "",
    });
    expect(profile.attributes).toEqual(EMPTY_PROFILE.attributes);
    expect(profile.formatPreferences).toEqual({ story: "A" });
    expect(profile.expertiseTopics).toEqual(["ops"]);
  });
});

it("describes only the parts of a profile that are filled in", () => {
  const rows = describeProfile({
    ...EMPTY_PROFILE,
    attributes: { ...EMPTY_PROFILE.attributes, humor: "light" },
    avoidPhrases: ["game-changer"],
    formatPreferences: { how_to: "Numbered steps" },
  });
  expect(rows).toEqual([
    { label: "Humor", values: ["light"] },
    { label: "Phrases to avoid", values: ["game-changer"] },
    { label: "Format: How-to", values: ["Numbered steps"] },
  ]);
});

it("diffs two versions field by field", () => {
  const before = { ...EMPTY_PROFILE, avoidPhrases: ["game-changer", "synergy"], styleRules: ["No em-dashes"] };
  const after = { ...EMPTY_PROFILE, avoidPhrases: ["game-changer", "Never open with a question"], notes: "New" };
  expect(diffProfiles(before, after)).toEqual([
    { field: "Phrases to avoid", before: ["synergy"], after: ["Never open with a question"] },
    { field: "Style rules agreed with this founder", before: ["No em-dashes"], after: [] },
    { field: "Notes", before: [], after: ["New"] },
  ]);
});
