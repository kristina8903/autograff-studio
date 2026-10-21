import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { exportDate, parseLinkedInExport } from "./linkedin-export";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas and line breaks in fields, CRLF and a BOM", () => {
    const csv = '﻿a,b,c\r\n1,"two, with comma","three ""quoted""\r\nand a second line"\r\n,,\n';
    expect(parseCsv(csv)).toEqual([
      ["a", "b", "c"],
      ["1", "two, with comma", 'three "quoted"\r\nand a second line'],
      ["", "", ""],
    ]);
  });
  it("keeps a last row without a trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

const SHARES = [
  "Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility",
  '2024-03-12 14:22:05,https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1,"First post.\nSecond paragraph, with a comma.",,,MEMBER_NETWORK',
  "2024-05-01 09:00:00,https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A2,,https://example.com/article,,MEMBER_NETWORK",
  '2024-06-02 10:00:00,https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A3,"A newer post with ""quotes"".",,,MEMBER_NETWORK',
  '2024-06-03 10:00:00,http://insecure.example/x,"A post with a bad link.",,,MEMBER_NETWORK',
].join("\n");

describe("parseLinkedInExport", () => {
  it("reads posts with their link and date, newest first, and counts reposts without text", () => {
    const result = parseLinkedInExport(SHARES);
    expect(result.error).toBeNull();
    expect(result.withoutText).toBe(1);
    expect(result.posts).toEqual([
      { body: "A post with a bad link.", sourceUrl: null, publishedAt: "2024-06-03" },
      {
        body: 'A newer post with "quotes".',
        sourceUrl: "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A3",
        publishedAt: "2024-06-02",
      },
      {
        body: "First post.\nSecond paragraph, with a comma.",
        sourceUrl: "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1",
        publishedAt: "2024-03-12",
      },
    ]);
  });

  it("matches renamed columns and skips notes above the header", () => {
    const csv = [
      "Notes:",
      '"This file contains your posts."',
      "",
      "Post Date,Post Link,Post Commentary",
      "3/7/2025,https://www.linkedin.com/posts/x,Hello",
    ].join("\n");
    expect(parseLinkedInExport(csv).posts).toEqual([
      { body: "Hello", sourceUrl: "https://www.linkedin.com/posts/x", publishedAt: "2025-03-07" },
    ]);
  });

  it("refuses files that are not the posts file, including private messages", () => {
    const messages = "CONVERSATION ID,FROM,TO,DATE,SUBJECT,CONTENT\n1,A,B,2024-01-01,Hi,Private text";
    const result = parseLinkedInExport(messages);
    expect(result.posts).toEqual([]);
    expect(result.error).toMatch(/Shares\.csv/);
    expect(result.columns).toEqual(["CONVERSATION ID", "FROM", "TO", "DATE", "SUBJECT", "CONTENT"]);
  });

  it("skips over-long posts and duplicates", () => {
    const csv = `ShareCommentary\n"${"x".repeat(10_001)}"\nSame\nSame`;
    const result = parseLinkedInExport(csv);
    expect(result.tooLong).toBe(1);
    expect(result.posts.map((p) => p.body)).toEqual(["Same"]);
  });
});

it("exportDate reads the export's date formats", () => {
  expect(exportDate("2024-03-12 14:22:05")).toBe("2024-03-12");
  expect(exportDate("2024-03-12T14:22:05Z")).toBe("2024-03-12");
  expect(exportDate("12/31/2024")).toBe("2024-12-31");
  expect(exportDate("2024-02-30 10:00")).toBeNull();
  expect(exportDate("yesterday")).toBeNull();
});
