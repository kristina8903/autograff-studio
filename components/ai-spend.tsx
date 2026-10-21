import { Alert, Card } from "@/components/ui";
import { spendStatus, usd } from "@/lib/domain/pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Month-to-date AI spend against the ceilings (PHASES Phase 4, criterion 7). */
export async function AiSpendCard() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("ai_spend_summary");
  const row = data?.[0];
  if (!row) return null;
  const status = spendStatus(Number(row.spent_usd), Number(row.monthly_budget_usd));
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">AI spend this month</h2>
        <p className="text-sm" aria-label="AI spend">
          <span className="font-semibold">{usd(status.spent)}</span>{" "}
          <span className="text-muted">
            of {usd(status.budget)} · up to {usd(Number(row.per_run_ceiling_usd))} per run
          </span>
        </p>
      </div>
      {/* A native meter: no inline style, which the Content Security Policy forbids. */}
      <meter
        className="mt-2 h-2 w-full"
        min={0}
        max={status.budget || 1}
        low={status.budget * 0.8}
        high={status.budget * 0.8}
        optimum={0}
        value={Math.min(status.spent, status.budget)}
        aria-label="Share of the monthly AI budget used"
      />
      {status.exhausted ? (
        <div className="mt-3">
          <Alert tone="error">The monthly AI budget is used up. New runs are refused until next month.</Alert>
        </div>
      ) : status.warn ? (
        <div className="mt-3">
          <Alert tone="error">Over 80% of this month&apos;s AI budget is used.</Alert>
        </div>
      ) : null}
    </Card>
  );
}
