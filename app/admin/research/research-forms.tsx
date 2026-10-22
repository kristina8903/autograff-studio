"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  linkFindingsAction,
  requestResearchAction,
  reviewFindingAction,
  reviewSourceAction,
  saveDomainsAction,
  type ActionState,
} from "../research-actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function ResearchForm({
  month,
  nonce,
  concepts,
  defaultQuery,
  defaultConcept,
}: {
  month: string;
  nonce: string;
  concepts: { id: string; label: string }[];
  defaultQuery: string;
  defaultConcept: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestResearchAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="nonce" value={nonce} />
      <Field
        label="Research question"
        hint="What evidence do the posts need? e.g. average repair cycle time for fleets in 2026"
      >
        <Input name="query" required minLength={3} maxLength={300} defaultValue={defaultQuery} />
      </Field>
      <Field
        label="For a concept (optional)"
        hint="Findings for a concept are offered only to its drafts; others to every draft this month."
      >
        <Select name="concept_id" defaultValue={defaultConcept}>
          <option value="">Any post this month</option>
          {concepts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Requesting…" : "Run research"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function DomainsForm({ allowed, blocked }: { allowed: string[]; blocked: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveDomainsAction, {});
  return (
    <form action={action} className="space-y-3">
      <Field
        label="Only these domains"
        hint="One per line. When set, sources come only from these (and their subdomains)."
      >
        <Textarea name="allowed" rows={3} defaultValue={allowed.join("\n")} />
      </Field>
      <Field label="Never these domains" hint="One per line, e.g. content farms or competitors' marketing sites.">
        <Textarea name="blocked" rows={3} defaultValue={blocked.join("\n")} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Save domain lists
      </Button>
      <Result state={state} />
    </form>
  );
}

const TIER_LABELS = {
  primary: "Primary (official data, the study itself)",
  reputable_publication: "Reputable publication",
  secondary: "Secondary (reports on others' data)",
  discussion: "Discussion or opinion",
  unknown: "Not yet rated",
} as const;

export function SourceReviewForm({ sourceId, tier, status }: { sourceId: string; tier: string; status: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewSourceAction, {});
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="source_id" value={sourceId} />
      <Field label="Source type">
        <Select name="tier" defaultValue={tier} className="h-8 w-64 text-xs">
          {Object.entries(TIER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Input
        name="note"
        maxLength={500}
        placeholder="Note (optional)"
        aria-label="Source note"
        className="h-8 w-56 text-xs"
      />
      {status !== "accepted" ? (
        <Button name="status" value="accepted" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
          Accept source
        </Button>
      ) : (
        <Button name="status" value="accepted" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
          Save type
        </Button>
      )}
      {status !== "rejected" ? (
        <Button name="status" value="rejected" variant="danger" disabled={pending} className="h-8 px-2 text-xs">
          Reject source
        </Button>
      ) : null}
      {state.error ? <span className="w-full text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

export function FindingReviewForm({
  findingId,
  status,
  sourceAccepted,
}: {
  findingId: string;
  status: string;
  sourceAccepted: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewFindingAction, {});
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="finding_id" value={findingId} />
      <Input name="note" maxLength={500} placeholder="Note" aria-label="Finding note" className="h-8 w-56 text-xs" />
      {status !== "human_verified" ? (
        <Button
          name="status"
          value="human_verified"
          variant="secondary"
          disabled={pending || !sourceAccepted}
          title={sourceAccepted ? undefined : "Accept the source first"}
          className="h-8 px-2 text-xs"
        >
          Verify
        </Button>
      ) : null}
      {status !== "disputed" ? (
        <Button name="status" value="disputed" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
          Dispute
        </Button>
      ) : null}
      {status !== "rejected" ? (
        <Button name="status" value="rejected" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
          Reject
        </Button>
      ) : null}
      {status === "human_verified" || status === "disputed" || status === "rejected" ? (
        <Button name="status" value="unverified" variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
          Reopen
        </Button>
      ) : null}
      {!sourceAccepted && status !== "human_verified" ? (
        <span className="text-xs text-muted">Accept the source to verify its findings.</span>
      ) : null}
      {state.error ? <span className="w-full text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

export function ConflictForm({ findingId, others }: { findingId: string; others: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(linkFindingsAction, {});
  if (!others.length) return null;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="finding_id" value={findingId} />
      <Select name="other_id" aria-label="Conflicting finding" className="h-8 w-72 text-xs" defaultValue="">
        <option value="" disabled>
          Disagrees with…
        </option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label.slice(0, 90)}
          </option>
        ))}
      </Select>
      <Button variant="secondary" disabled={pending} className="h-8 px-2 text-xs">
        Link as conflicting
      </Button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

export function UnlinkButton({ findingId, otherId }: { findingId: string; otherId: string }) {
  const [, action, pending] = useActionState<ActionState, FormData>(linkFindingsAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="finding_id" value={findingId} />
      <input type="hidden" name="other_id" value={otherId} />
      <input type="hidden" name="conflict" value="false" />
      <button disabled={pending} className="text-xs text-muted underline hover:text-foreground">
        unlink
      </button>
    </form>
  );
}
