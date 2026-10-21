import { describe, expect, it } from "vitest";
import { buildZip } from "@/tests/zip-fixture";
import { readPostsFile } from "./linkedin-file";
import { readZipEntry } from "./zip";

const blob = (buffer: Buffer) => new Blob([new Uint8Array(buffer)]);
const SHARES = 'Date,ShareLink,ShareCommentary\n2024-03-12 10:00:00,https://www.linkedin.com/posts/a,"Hello, world."\n';

describe("readZipEntry", () => {
  it("reads a deflated or stored entry by name", async () => {
    for (const method of [8, 0] as const) {
      const zip = buildZip([
        { name: "Profile.csv", data: "First Name\nAda" },
        { name: "Shares.csv", data: SHARES, method },
      ]);
      expect(await readZipEntry(blob(zip), (n) => n === "Shares.csv")).toEqual({ name: "Shares.csv", text: SHARES });
    }
  });

  it("never decompresses other entries: a corrupt messages.csv does not matter", async () => {
    const zip = buildZip([
      { name: "messages.csv", data: "CONTENT\nPrivate", raw: Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00]) },
      { name: "Shares.csv", data: SHARES },
    ]);
    expect(await readZipEntry(blob(zip), (n) => n === "Shares.csv")).toEqual({ name: "Shares.csv", text: SHARES });
  });

  it("lists file names when the entry is missing, and rejects non-ZIP input", async () => {
    const zip = buildZip([{ name: "Connections.csv", data: "x" }]);
    expect(await readZipEntry(blob(zip), (n) => n === "Shares.csv")).toEqual({
      error: "not found",
      names: ["Connections.csv"],
    });
    expect(await readZipEntry(new Blob(["not a zip"]), () => true)).toEqual({
      error: "This isn't a ZIP file.",
      names: [],
    });
  });

  it("reports a damaged entry instead of throwing", async () => {
    const zip = buildZip([{ name: "Shares.csv", data: SHARES, raw: Buffer.from([0xff, 0xff, 0xff]) }]);
    expect(await readZipEntry(blob(zip), () => true)).toMatchObject({ error: "This ZIP file is damaged." });
  });
});

describe("readPostsFile", () => {
  it("takes Shares.csv from a full archive, in any folder, in any letter case", async () => {
    const zip = buildZip([
      { name: "messages.csv", data: "CONVERSATION ID,FROM,TO,DATE,SUBJECT,CONTENT\n1,A,B,2024-01-01,Hi,Private" },
      { name: "Basic_LinkedInDataExport/SHARES.CSV", data: SHARES },
    ]);
    expect(await readPostsFile(blob(zip))).toEqual({ csv: SHARES });
  });

  it("explains an archive without posts", async () => {
    const zip = buildZip([{ name: "messages.csv", data: "CONTENT\nPrivate" }]);
    expect(await readPostsFile(blob(zip))).toEqual({
      error:
        "This archive has no Shares.csv, so it has no posts to import. LinkedIn leaves it out when the account has never posted.",
    });
  });

  it("reads a CSV file as text", async () => {
    expect(await readPostsFile(new Blob([SHARES]))).toEqual({ csv: SHARES });
  });
});
