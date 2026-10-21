// Reads ONE file out of a ZIP archive in the browser, without unpacking the
// rest. Only the archive's directory (file names and offsets) and the chosen
// entry's bytes are read; every other entry is never decompressed. Used so a
// founder's full LinkedIn archive can be imported without its private
// messages ever being read (decision D-27).
//
// Supports stored and deflated entries (the two methods ZIP tools use), via
// the platform's DecompressionStream. Not supported: ZIP64 (archives over
// 4 GB) and encrypted entries; those return an error.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

export type ZipEntryResult = { name: string; text: string } | { error: string; names: string[] };

type Entry = { name: string; method: number; flags: number; compressedSize: number; localOffset: number };

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

async function centralDirectory(file: Blob): Promise<Entry[] | string> {
  const tailStart = Math.max(0, file.size - EOCD_MIN - MAX_COMMENT);
  const tail = await bytes(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - EOCD_MIN; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return "This isn't a ZIP file.";
  const count = tail.getUint16(eocd + 10, true);
  const size = tail.getUint32(eocd + 12, true);
  const offset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff)
    return "This archive is too large to read here. Unzip it and choose Shares.csv instead.";
  if (offset + size > file.size) return "This ZIP file is damaged.";

  const dir = await bytes(file, offset, offset + size);
  const decoder = new TextDecoder();
  const entries: Entry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.byteLength || dir.getUint32(p, true) !== CENTRAL_SIGNATURE) return "This ZIP file is damaged.";
    const nameLength = dir.getUint16(p + 28, true);
    const extraLength = dir.getUint16(p + 30, true);
    const commentLength = dir.getUint16(p + 32, true);
    entries.push({
      flags: dir.getUint16(p + 8, true),
      method: dir.getUint16(p + 10, true),
      compressedSize: dir.getUint32(p + 20, true),
      localOffset: dir.getUint32(p + 42, true),
      name: decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength)),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The text of the first entry whose name matches, or an error with the archive's file names. */
export async function readZipEntry(file: Blob, matches: (name: string) => boolean): Promise<ZipEntryResult> {
  const entries = await centralDirectory(file);
  if (typeof entries === "string") return { error: entries, names: [] };
  const names = entries.map((e) => e.name).filter((name) => !name.endsWith("/"));
  const entry = entries.find((e) => !e.name.endsWith("/") && matches(e.name));
  if (!entry) return { error: "not found", names };
  if (entry.flags & 1) return { error: "That file is encrypted in the archive.", names };

  const local = await bytes(file, entry.localOffset, entry.localOffset + 30);
  if (local.getUint32(0, true) !== LOCAL_SIGNATURE) return { error: "This ZIP file is damaged.", names };
  const dataStart = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const data = file.slice(dataStart, dataStart + entry.compressedSize);

  let stream: ReadableStream<Uint8Array>;
  if (entry.method === 0) stream = data.stream();
  else if (entry.method === 8) stream = data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  else return { error: "That file uses a compression method this page can't read.", names };
  try {
    return { name: entry.name, text: await new Response(stream).text() };
  } catch {
    return { error: "This ZIP file is damaged.", names };
  }
}
