import { describe, expect, it } from "vitest";
import { LINKEDIN_PROFILE_URL, isValidTimeZone, parseFounderForm } from "./founders";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("parseFounderForm", () => {
  it("accepts a valid founder and turns an empty LinkedIn URL into null", () => {
    const result = parseFounderForm(
      form({ role_title: " CEO ", display_name: "Ada", linkedin_profile_url: "", timezone: "America/New_York" }),
    );
    expect(result).toEqual({
      ok: true,
      data: { role_title: "CEO", display_name: "Ada", linkedin_profile_url: null, timezone: "America/New_York" },
    });
  });
  it("reports one message per invalid field", () => {
    const result = parseFounderForm(
      form({
        role_title: "",
        display_name: "x".repeat(121),
        linkedin_profile_url: "https://evil.example/in/x",
        timezone: "Mars/Olympus",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual([
        "display_name",
        "linkedin_profile_url",
        "role_title",
        "timezone",
      ]);
  });
});

describe("LinkedIn profile URLs (mirrors the database check)", () => {
  it.each([
    "https://www.linkedin.com/in/ada",
    "https://linkedin.com/in/ada-lovelace/",
    "https://uk.linkedin.com/in/ada",
  ])("accepts %s", (url) => {
    expect(LINKEDIN_PROFILE_URL.test(url)).toBe(true);
  });
  it.each([
    "http://www.linkedin.com/in/ada",
    "https://www.linkedin.com/company/autograff",
    "https://linkedin.com.evil.com/in/ada",
    "https://www.linkedin.com/in/ada?x=1",
  ])("rejects %s", (url) => {
    expect(LINKEDIN_PROFILE_URL.test(url)).toBe(false);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and UTC", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });
  it("rejects invalid zones and fixed offsets", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
