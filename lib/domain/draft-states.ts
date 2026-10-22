// Draft states the admin can move to in Phase 4b (PRODUCT_SPEC §7.1). The
// database function transition_draft enforces the same table.

export const DRAFT_STATUS_LABELS = {
  drafting: "drafting",
  admin_review: "in review",
  founder_review: "with founder",
  changes_requested: "changes requested",
  approved: "approved",
  scheduled: "scheduled",
  published: "published",
  rejected: "rejected",
  archived: "archived",
} as const;

export type DraftStatus = keyof typeof DRAFT_STATUS_LABELS;

const NEXT: Partial<Record<DraftStatus, DraftStatus[]>> = {
  drafting: ["admin_review", "rejected", "archived"],
  admin_review: ["drafting", "rejected", "archived"],
  archived: ["admin_review"],
};

export function nextStates(status: DraftStatus): DraftStatus[] {
  return NEXT[status] ?? [];
}

export function isEditable(status: DraftStatus): boolean {
  return status === "drafting" || status === "admin_review";
}
