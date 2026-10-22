// Checks that SQL private.normalize_body() and TypeScript normalizeBody()
// give the same content hash (PRODUCT_SPEC §7.4). A mismatch would make the
// material-edit rule disagree with the database. Local stack only.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { bodyHash } from "@/lib/domain/drafts";

function sqlHash(body: string): string {
  const quoted = `$body$${body}$body$`;
  return execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_autograff-studio",
      "psql",
      "-U",
      "postgres",
      "-tAc",
      `select encode(sha256(convert_to(private.normalize_body(${quoted}), 'UTF8')), 'hex')`,
    ],
    { encoding: "utf8" },
  ).trim();
}

const CASES = [
  "Plain text.",
  "\n\nLeading and trailing blank lines\n\n\n",
  "Windows\r\nline endings\r\n",
  "Old Mac\rline endings",
  "Trailing spaces   \nand tabs\t\t\nkept inside  words",
  "  Leading spaces stay",
  "Paragraphs\n\n\nwith extra blank lines inside",
  "café and café",
  "Emoji 👋🏽 and — dashes",
  "[FOUNDER TO SUPPLY: a story]\n\nWhat would you change?",
  " \n \nWhitespace-only lines \n \n",
];

describe("normalization parity", () => {
  for (const body of CASES)
    it(JSON.stringify(body), () => {
      expect(sqlHash(body)).toBe(bodyHash(body));
    });
});
