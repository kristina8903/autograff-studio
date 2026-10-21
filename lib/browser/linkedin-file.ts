// Gets the posts CSV out of whatever the person chose: Shares.csv itself, or
// LinkedIn's export ZIP (posts-only or the full archive). From a ZIP only
// Shares.csv is decompressed; messages and every other file are never read.

import { readZipEntry } from "./zip";

export const POSTS_FILE = "shares.csv";
export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

const basename = (path: string) => path.split("/").pop()?.toLowerCase() ?? "";

async function isZip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

export async function readPostsFile(file: Blob): Promise<{ csv: string } | { error: string }> {
  if (await isZip(file)) {
    if (file.size > MAX_ARCHIVE_BYTES)
      return { error: "That archive is larger than 2 GB. Unzip it and choose Shares.csv." };
    const result = await readZipEntry(file, (name) => basename(name) === POSTS_FILE);
    if ("text" in result) return { csv: result.text };
    if (result.error !== "not found") return { error: result.error };
    return {
      error:
        "This archive has no Shares.csv, so it has no posts to import. LinkedIn leaves it out when the account has never posted.",
    };
  }
  if (file.size > MAX_CSV_BYTES)
    return { error: "That file is larger than 10 MB. Choose Shares.csv or the export ZIP." };
  return { csv: await file.text() };
}
