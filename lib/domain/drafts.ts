// Draft text rules shared by the server and the tests. The SQL twin of
// normalizeBody is private.normalize_body(); a database test checks they agree.

import { createHash } from "node:crypto";

/**
 * PRODUCT_SPEC §7.4: line endings to \n, trailing spaces and tabs removed from
 * each line, leading and trailing blank lines removed, Unicode NFC. Any other
 * difference is a material change.
 */
export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
    .normalize("NFC");
}

/** sha256 of the normalized body, hex. Equal hashes mean no material change. */
export function bodyHash(body: string): string {
  return createHash("sha256").update(normalizeBody(body), "utf8").digest("hex");
}

export const PLACEHOLDER_PATTERN = /\[FOUNDER TO SUPPLY:\s*([^\]]*)\]/g;

export type Span = { start: number; end: number };

export function findPlaceholders(body: string): (Span & { request: string })[] {
  return [...body.matchAll(PLACEHOLDER_PATTERN)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    request: m[1].trim(),
  }));
}

export const LINKEDIN_MAX_CHARACTERS = 3000;

export type VersionText = { body: string; alternativeHooks: string[]; selectedHookIndex: number | null };

/** The selected opening line, normalized like the body, or null (SQL: private.selected_hook). */
export function selectedHook(version: VersionText): string | null {
  if (version.selectedHookIndex === null) return null;
  return normalizeBody(version.alternativeHooks[version.selectedHookIndex] ?? "");
}

/**
 * PRODUCT_SPEC §7.4: an edit is material if it changes the normalized body or
 * the selected opening line. Unselected alternative lines are suggestions.
 * The database trigger private.invalidate_on_material_edit applies the same rule.
 */
export function isMaterialEdit(before: VersionText, after: VersionText): boolean {
  return bodyHash(before.body) !== bodyHash(after.body) || selectedHook(before) !== selectedHook(after);
}
