// The draft state machine (PRODUCT_SPEC §7.1), by role. The database
// functions enforce the same table: transition_draft, share_draft,
// schedule_draft, unschedule_draft and record_publication for the admin;
// approve_draft, request_changes, founder_reject_draft and revoke_approval
// for the founder. Scheduling and publishing pass the publish gate
// (PRODUCT_SPEC §8.1): a valid approval of the current version.

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
export type DraftRole = "admin" | "founder";

/** How the founder sees each status they can see. */
export const FOUNDER_STATUS_LABELS: Partial<Record<DraftStatus, string>> = {
  founder_review: "ready for your review",
  changes_requested: "changes requested",
  approved: "approved",
  scheduled: "scheduled",
  published: "published",
};

const ADMIN_NEXT: Partial<Record<DraftStatus, DraftStatus[]>> = {
  drafting: ["admin_review", "rejected", "archived"],
  // Sharing (to founder_review) is its own action: share_draft.
  admin_review: ["drafting", "founder_review", "rejected", "archived"],
  founder_review: ["admin_review", "rejected", "archived"],
  changes_requested: ["admin_review", "founder_review", "rejected", "archived"],
  // Back to admin review withdraws the founder's approval; scheduling and
  // publishing keep it.
  approved: ["admin_review", "scheduled", "published", "rejected", "archived"],
  // Rescheduling stays scheduled; unscheduling goes back to approved.
  scheduled: ["approved", "admin_review", "published", "rejected", "archived"],
  archived: ["admin_review"],
};

const FOUNDER_NEXT: Partial<Record<DraftStatus, DraftStatus[]>> = {
  founder_review: ["approved", "changes_requested", "rejected"],
  changes_requested: ["rejected"],
  // Revoking their approval (which also unschedules).
  approved: ["founder_review"],
  scheduled: ["founder_review"],
};

export function nextStates(status: DraftStatus, role: DraftRole = "admin"): DraftStatus[] {
  return (role === "admin" ? ADMIN_NEXT : FOUNDER_NEXT)[status] ?? [];
}

export function canTransition(role: DraftRole, from: DraftStatus, to: DraftStatus): boolean {
  return nextStates(from, role).includes(to);
}

/** Statuses in which a shared draft is visible to its founder (private.founder_visible). */
export function founderVisible(status: DraftStatus): boolean {
  return status in FOUNDER_STATUS_LABELS;
}

/**
 * Whether the role can save a new version. An edit to an approved or
 * scheduled draft that changes its normalized text withdraws the approval
 * and unschedules it (§7.4).
 */
export function isEditable(status: DraftStatus, role: DraftRole = "admin"): boolean {
  const editable: DraftStatus[] =
    role === "admin"
      ? ["drafting", "admin_review", "founder_review", "changes_requested", "approved", "scheduled"]
      : ["founder_review", "changes_requested", "approved", "scheduled"];
  return editable.includes(status);
}

/**
 * Why the founder can't approve yet, or null when they can. A person must
 * still choose to approve: no open flags is never approval by itself.
 */
export function approvalBlocker(input: {
  status: DraftStatus;
  placeholderCount: number;
  openBlockingFlags: number;
}): string | null {
  if (input.status !== "founder_review") return "Only a draft that is ready for your review can be approved.";
  if (input.placeholderCount > 0)
    return `Replace ${input.placeholderCount === 1 ? "the [FOUNDER TO SUPPLY] placeholder" : `all ${input.placeholderCount} [FOUNDER TO SUPPLY] placeholders`} first.`;
  if (input.openBlockingFlags > 0)
    return `${input.openBlockingFlags === 1 ? "A blocking flag is" : `${input.openBlockingFlags} blocking flags are`} still open. Edit the text, or ask for changes.`;
  return null;
}
