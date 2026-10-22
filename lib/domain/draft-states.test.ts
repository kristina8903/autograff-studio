import { describe, expect, it } from "vitest";
import {
  approvalBlocker,
  canTransition,
  DRAFT_STATUS_LABELS,
  founderVisible,
  isEditable,
  type DraftRole,
  type DraftStatus,
} from "./draft-states";
import { isMaterialEdit, type VersionText } from "./drafts";

const STATUSES = Object.keys(DRAFT_STATUS_LABELS) as DraftStatus[];

describe("draft state machine (PRODUCT_SPEC §7.1)", () => {
  // Every allowed move, by role. Everything not listed must be refused.
  const ALLOWED: Record<DraftRole, [DraftStatus, DraftStatus][]> = {
    admin: [
      ["drafting", "admin_review"],
      ["drafting", "rejected"],
      ["drafting", "archived"],
      ["admin_review", "drafting"],
      ["admin_review", "founder_review"],
      ["admin_review", "rejected"],
      ["admin_review", "archived"],
      ["founder_review", "admin_review"],
      ["founder_review", "rejected"],
      ["founder_review", "archived"],
      ["changes_requested", "admin_review"],
      ["changes_requested", "founder_review"],
      ["changes_requested", "rejected"],
      ["changes_requested", "archived"],
      ["approved", "admin_review"],
      ["approved", "rejected"],
      ["approved", "archived"],
      ["archived", "admin_review"],
    ],
    founder: [
      ["founder_review", "approved"],
      ["founder_review", "changes_requested"],
      ["founder_review", "rejected"],
      ["changes_requested", "rejected"],
      ["approved", "founder_review"],
    ],
  };

  for (const role of ["admin", "founder"] as const) {
    it(`allows exactly the listed moves for the ${role}`, () => {
      const allowed = new Set(ALLOWED[role].map(([a, b]) => `${a}>${b}`));
      for (const from of STATUSES)
        for (const to of STATUSES)
          expect(canTransition(role, from, to), `${role}: ${from} → ${to}`).toBe(allowed.has(`${from}>${to}`));
    });
  }

  it("only the founder approves; nobody moves a draft to scheduled or published yet, or out of rejected", () => {
    for (const from of STATUSES) {
      expect(canTransition("admin", from, "approved")).toBe(false);
      for (const role of ["admin", "founder"] as const) {
        expect(canTransition(role, from, "scheduled")).toBe(false);
        expect(canTransition(role, from, "published")).toBe(false);
        expect(canTransition(role, "rejected", from)).toBe(false);
      }
    }
  });

  it("founders see only shared statuses, and edit only what is in front of them", () => {
    expect(STATUSES.filter(founderVisible)).toEqual([
      "founder_review",
      "changes_requested",
      "approved",
      "scheduled",
      "published",
    ]);
    expect(STATUSES.filter((s) => isEditable(s, "founder"))).toEqual([
      "founder_review",
      "changes_requested",
      "approved",
    ]);
    expect(STATUSES.filter((s) => isEditable(s, "admin"))).toEqual([
      "drafting",
      "admin_review",
      "founder_review",
      "changes_requested",
      "approved",
    ]);
  });
});

describe("approvalBlocker (PRODUCT_SPEC §7.3)", () => {
  const ready = { status: "founder_review" as const, placeholderCount: 0, openBlockingFlags: 0 };
  it("allows approval only in founder review with nothing blocking", () => {
    expect(approvalBlocker(ready)).toBeNull();
    expect(approvalBlocker({ ...ready, status: "changes_requested" })).toMatch(/ready for your review/);
    expect(approvalBlocker({ ...ready, placeholderCount: 1 })).toBe(
      "Replace the [FOUNDER TO SUPPLY] placeholder first.",
    );
    expect(approvalBlocker({ ...ready, placeholderCount: 2, openBlockingFlags: 3 })).toMatch(/all 2/);
    expect(approvalBlocker({ ...ready, openBlockingFlags: 1 })).toMatch(/^A blocking flag is still open/);
  });
});

describe("isMaterialEdit (PRODUCT_SPEC §7.4)", () => {
  const base: VersionText = {
    body: "Repairs take time 🚐.\n\nAsk why. #fleet",
    alternativeHooks: ["Who calls the fleet manager?", "Late vans cost money."],
    selectedHookIndex: null,
  };
  const edit = (patch: Partial<VersionText>) => isMaterialEdit(base, { ...base, ...patch });

  it("is not material: line endings, trailing spaces, outer blank lines, NFC, alternative lines", () => {
    expect(edit({ body: base.body.replace(/\n/g, "\r\n") })).toBe(false);
    expect(edit({ body: "Repairs take time 🚐.  \t\n\nAsk why. #fleet" })).toBe(false);
    expect(edit({ body: `\n\n${base.body}\n\n` })).toBe(false);
    expect(isMaterialEdit({ ...base, body: "café" }, { ...base, body: "café" })).toBe(false);
    expect(edit({ alternativeHooks: ["Something else entirely"] })).toBe(false);
  });

  it("is material: a word, punctuation, emoji, hashtag, paragraph break, leading spaces, the selected line", () => {
    for (const body of [
      "Repairs take long 🚐.\n\nAsk why. #fleet",
      "Repairs take time 🚐!\n\nAsk why. #fleet",
      "Repairs take time 🚚.\n\nAsk why. #fleet",
      "Repairs take time 🚐.\n\nAsk why. #fleets",
      "Repairs take time 🚐.\nAsk why. #fleet",
      "  Repairs take time 🚐.\n\nAsk why. #fleet",
    ])
      expect(edit({ body }), body).toBe(true);
    expect(edit({ selectedHookIndex: 0 })).toBe(true);
    expect(
      isMaterialEdit(
        { ...base, selectedHookIndex: 0 },
        { ...base, alternativeHooks: ["Who calls the fleet manager? ", "x"], selectedHookIndex: 0 },
      ),
    ).toBe(false);
    expect(
      isMaterialEdit(
        { ...base, selectedHookIndex: 0 },
        { ...base, alternativeHooks: ["Who phones the fleet manager?"], selectedHookIndex: 0 },
      ),
    ).toBe(true);
  });
});
