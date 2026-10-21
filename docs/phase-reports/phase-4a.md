# Phase 4a report: AI runs, cost ceilings and concepts

Date: 2026-10-21. Scope: the first half of
[PHASES.md, Phase 4](../PHASES.md#phase-4-content-concepts-and-generation).
Drafts, the post-generation lint and repetition checks are Phase 4b. This
report covers what 4a built; the Phase 4 report follows 4b.

Built and tested locally against the **fake** AI provider: no real AI call was
made. Staging keeps using the fake until the API key is added (runbook step 8).

## What was built

| Area | Where |
|---|---|
| Database: `generation_runs` (job table with idempotency key, attempts, retry time, tokens, estimated and actual cost), `concepts`, spend ceilings on `settings`. RLS: admin-only; founders see no runs, costs or concepts | `supabase/migrations/20261021000004_generation_concepts.sql` |
| Budget check before any call, atomically in `request_generation`; refused runs recorded with the reason | same |
| Job runner functions for the secret key only: claim (`FOR UPDATE SKIP LOCKED`), fail or retry, requeue stale runs, store a concept batch in one transaction | same |
| AI provider interface; Anthropic implementation (structured outputs validated again on arrival, refusal fallback, per-model pricing); fake implementation for tests | `lib/providers/llm/` |
| Pricing, upper-bound estimate, 80% warning | `lib/domain/pricing.ts` |
| Retry rules: 429, 5xx and network only, backoff with jitter, honoring retry-after, 3 attempts | `lib/domain/retry.ts` |
| Versioned concept prompt and output schema | `lib/prompts/concepts.v1.ts` |
| Runner (provider-agnostic, unit-tested) and its database store | `lib/server/generation/runner.ts`, `lib/server/admin/generation.ts` |
| Run inputs: current brief and voice versions and retrieved examples are recorded as ids, then read back at run time | `lib/server/generation/context.ts` |
| Cron tick, protected by `CRON_SECRET`; Vercel Cron every minute | `app/api/jobs/tick/route.ts`, `vercel.json` |
| Admin, **Concepts**: per founder and month, generate a batch, select, reject, restore, edit, or regenerate one concept with guidance; live progress | `app/admin/concepts/` |
| Admin, **AI usage**: month-to-date spend against the ceilings, and every run with its inputs, model, tokens, cost and errors | `app/admin/ai/` |
| ESLint: only `lib/providers/llm/anthropic.ts` may import the Anthropic SDK | `eslint.config.mjs` |
| Runbook step 8: turning on the real AI for staging | `docs/runbooks/staging-setup.md` |

## Test results (final run, 2026-10-21)

| Command | Result |
|---|---|
| `npm run check` (typegen + typecheck, ESLint + public-env check, Prettier, Vitest) | pass; **126/126** unit tests (99 before, 27 new) |
| `npm run test:db` | pgTAP **263/263** (208 before, 55 new); parity **1/1** |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` | **36/36** (25 before, 11 new), zero CSP violations |
| `npm run build` | pass |
| `npm audit --omit=dev` | 0 vulnerabilities (with `@anthropic-ai/sdk` 1.0.0 added) |

Problems found during the build, all fixed before the final run:

1. **A real bug, caught by pgTAP:** in `request_generation`, the duplicate
   check's `SELECT … INTO` set the status variable to null when no earlier run
   existed. Every request then failed. It now uses separate variables.
2. **A gap closed:** the Phase 1 policy let the admin update any `settings`
   column, which would have let the budget be raised through the API. The
   admin can now update only the email domains. A pgTAP test proves the
   budget can't be raised.
3. **Test-order dependency:** `foundation.spec.ts` assumed it ran first, on
   a fresh database. The new `concepts.spec.ts` sorts before it, so it now
   resets the database itself, like the other spec files.
4. My own e2e expectations were wrong three times. None of these was a code
   change:
   - counting nested bullet points as concepts;
   - the default batch size (8, not 1);
   - the fake reusing titles across runs.

### Phase 4 acceptance criteria covered by 4a

| # | Criterion | Evidence |
|---|---|---|
| 1 | A concept batch records the brief version, voice version, examples used, model and cost | e2e "a concept batch is generated and records…"; pgTAP: each concept stores its brief and voice versions, the run its model, tokens and cost |
| 2 | Regenerating one concept leaves all others untouched; previous versions remain | e2e "selecting, rejecting and regenerating one concept…"; pgTAP: the old concept is archived and linked, others unchanged, a regeneration must return exactly one concept |
| 7 | A run over the per-run or monthly ceiling is refused before calling the API; the dashboard shows month-to-date spend and warns at 80% | e2e "a run over the per-run ceiling is refused…" and "the spend panel warns…"; pgTAP: per-run and monthly refusals recorded with reasons; unit tests for the 80% rule |
| 8 | Double-submitting the same generation creates one run | e2e "submitting the same request twice creates one run"; pgTAP: the same key returns the same run |

Criteria 3–6 (post body lint, placeholders, claim flags, repetition) are drafts: Phase 4b.

### Named tests from PHASES.md (4a part)

| Test | Where |
|---|---|
| Structured-output validation and rejection paths | `tests/unit/runner.test.ts`: wrong shape, over-long fields, empty batch, extra concepts trimmed |
| Idempotency | pgTAP and e2e (above) |
| Retry on 429/5xx, no retry on 400 | `tests/unit/runner.test.ts`, `lib/domain/pricing.test.ts`; pgTAP: retry time respected, attempt 3 fails |
| Budget refusal | pgTAP and e2e (above) |

## Decisions

- **D-28: how runs execute and what they may spend.**
  - Ceilings live in the database, and the app can't raise them.
  - Every run is checked before any call.
  - A run starts with `after()`; the cron tick picks up retries.
  - Retries follow the rules above.
  - Requests use the refusal fallback.
  - Answers are validated twice.
- **D-29: concepts.**
  - Founders don't see them.
  - Regeneration archives and links.
  - Edits are in place and audited.
  - `concept_evidence` waits for Phase 5.
  - Batch sizing follows the cadence's candidate targets.

## Not done yet, and why

- **No real AI call has been made.** That needs the staging API key (runbook
  step 8). The first real batch is the first test of prompt quality, and of
  the Anthropic implementation against the live API.
- **The Anthropic implementation has no automated test.** By the project's
  rule, tests make no paid calls. The opt-in `npm run eval:generation`, with
  a hard cost cap, comes with 4b.
- **Phase 4b:** drafts, the post lint, placeholders and claim flags,
  repetition checks, the draft state machine, version history,
  `eval:generation` and `eval:voice`.
