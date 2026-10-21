import { describe, expect, it } from "vitest";
import { isHttpsUrl, parseBulkPaste, parseTags } from "./examples";

describe("parseBulkPaste", () => {
  it("splits posts on dashed lines and reads optional URL and date lines", () => {
    const { items, problems } = parseBulkPaste(
      [
        "URL: https://www.linkedin.com/posts/a",
        "Date: 2026-09-15",
        "First post.",
        "",
        "Second paragraph.",
        "---",
        "date: 2026-08-02",
        "url: https://www.linkedin.com/posts/b",
        "Second post.",
        "-----",
        "Third post with no metadata.",
      ].join("\r\n"),
    );
    expect(problems).toEqual([]);
    expect(items).toEqual([
      {
        body: "First post.\n\nSecond paragraph.",
        sourceUrl: "https://www.linkedin.com/posts/a",
        publishedAt: "2026-09-15",
      },
      { body: "Second post.", sourceUrl: "https://www.linkedin.com/posts/b", publishedAt: "2026-08-02" },
      { body: "Third post with no metadata.", sourceUrl: null, publishedAt: null },
    ]);
  });

  it("keeps dashes inside a line, and metadata-looking lines after the text start", () => {
    const { items } = parseBulkPaste("Costs went up -- again.\nURL: not metadata here");
    expect(items).toEqual([
      { body: "Costs went up -- again.\nURL: not metadata here", sourceUrl: null, publishedAt: null },
    ]);
  });

  it("reports bad posts by number and keeps the good ones", () => {
    const { items, problems } = parseBulkPaste(
      "URL: http://insecure.example\nText\n---\nDate: 15/09/2026\nText\n---\nURL: https://ok.example\n---\nGood",
    );
    expect(items.map((i) => i.body)).toEqual(["Good"]);
    expect(problems).toEqual([
      "Post 1: the URL must start with https://.",
      "Post 2: write the date as YYYY-MM-DD.",
      "Post 3 has no text.",
    ]);
  });

  it("rejects over-long posts and too many posts", () => {
    expect(parseBulkPaste("x".repeat(10_001)).problems).toEqual(["Post 1 is longer than 10,000 characters."]);
    const many = Array.from({ length: 101 }, (_, i) => `Post ${i}`).join("\n---\n");
    expect(parseBulkPaste(many).problems).toEqual(["Paste at most 100 posts at a time."]);
  });
});

it("isHttpsUrl accepts only https URLs", () => {
  expect(isHttpsUrl("https://www.linkedin.com/posts/x")).toBe(true);
  expect(isHttpsUrl("http://www.linkedin.com")).toBe(false);
  expect(isHttpsUrl("https://has space.com")).toBe(false);
  expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
});

it("parseTags cleans comma-separated tags the way the database does", () => {
  const form = new FormData();
  form.set("topics", " Fleet Maintenance, repair status,, fleet maintenance ");
  expect(parseTags(form.get("topics"))).toEqual(["fleet maintenance", "repair status"]);
});
