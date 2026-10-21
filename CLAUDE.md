# Autograff Content Studio: instructions for Claude Code

> This repository was split out of `autograff-site` on 2026-10-21 (D-01).
> It shares no deployment, database or secrets with the marketing site or the
> revenue pipeline.

## What this is

A private web app (planned for `https://studio.autograff.ai`). In it,
Autograff's marketing admin plans, generates, curates and manages LinkedIn
posts for the founders. Founders review and approve their own posts. It is a
content-operations workflow with explicit stages and human approval gates, not
a chatbot.

The source of truth for behavior is `docs/`:

- `PRODUCT_SPEC.md`
- `ARCHITECTURE.md`
- `DATA_MODEL.md`
- `SECURITY.md`
- `INTEGRATIONS.md`
- `PHASES.md`
- `DECISIONS.md`

Read the relevant document before changing anything it covers. Update it in
the same change when behavior changes.

## Work one phase at a time

- `docs/PHASES.md` defines the phases, their scope, exclusions and acceptance
  criteria. Work only on the phase the user has approved. Do not start the
  next phase, or pull its features forward, without explicit approval.
- **Current status: Phase 0 (planning) is complete and its decisions are
  recorded (2026-10-21). No application code exists. Phase 1 is not yet
  approved to start.**
- Phase order is agreed (D-19): 1, 2, 3, 4, 7, 5, 9, 8, go-live, 6, 10.
- End each phase with a report:
  - what was built;
  - the exact test commands run and their results (paste failures; do not
    summarize them away);
  - anything skipped and why;
  - the decisions made, recorded in `docs/DECISIONS.md`.

## Stack and conventions (planned)

- **Framework and language:**
  - Next.js App Router with TypeScript `strict`.
  - Server components and server actions by default; client components only
    for interactivity.
  - Next 16 has breaking changes (e.g. `proxy.ts` instead of middleware).
    Read `node_modules/next/dist/docs/` before using a Next API.
- **Database and auth:** Supabase Postgres plus Auth.
  - Migrations are in `supabase/migrations/`, forward-only, applied by the CLI.
  - Never edit the schema in the dashboard.
  - Every table has RLS enabled and deny-by-default policies.
  - Every status change goes through the SQL functions described in
    `docs/DATA_MODEL.md`.
- **Code layout:**
  - Domain logic (cadence, coverage, workflow state machine, material-edit
    rule, lint, budget) is pure TypeScript in `lib/domain/`, with no I/O, and
    is unit-tested.
  - External services sit only behind the interfaces in `lib/providers/`
    (LLM, research, Slack, publishing). Each has a fake.
  - No vendor SDK is imported outside its provider module.
- **Validation:**
  - Validate all input with Zod at the server boundary.
  - Validate all model output against a schema before use.
- **Naming and language:**
  - Match existing code.
  - User-facing copy is US English.

## Commands (to be created in Phase 1; they do not exist yet)

```bash
npm run dev            # local app on http://localhost:3000
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format:check   # prettier --check
npm test               # vitest unit tests (domain + providers with fakes)
npm run test:db        # RLS/function tests against local Supabase (supabase start first)
npm run test:e2e       # playwright
npx supabase start && npx supabase db reset   # local DB with migrations + seed
```

All of these must pass before a pull request. Report the results, including
failures.

## Security rules (non-negotiable)

- **Access control is enforced on the server and in the database.** Hiding UI
  is not a control.
  - Request-scoped code uses the **user's** Supabase session so RLS applies.
  - The secret (service-role) key is only for the job runner, invites and
    migrations, in `lib/server/admin/`.
- **Founders must never see another founder's content or admin-internal
  data.** Every new table or view needs RLS tests:
  - anonymous is denied;
  - founder A cannot access founder B's rows;
  - a founder cannot access admin-only tables or columns.
- **Never publish or record as published a draft without a valid approval of
  its current version.** Do not weaken:
  - the publish gate;
  - the approval hash binding;
  - the material-edit invalidation rule.

  "No review flags" is never approval.
- **The generator must not invent** founder anecdotes, opinions, quotes,
  statistics, URLs or sources. Missing personal context becomes a
  `[FOUNDER TO SUPPLY: …]` placeholder plus a blocking flag.
- **Treat web pages and Slack text as untrusted data.**
  - Process them only in tool-less extraction steps.
  - Never let them trigger actions or introduce URLs.
- **Never log** tokens, keys, cookies, full prompts, Slack message text or post
  bodies.
- **No real external calls in automated tests.** That covers Slack, LinkedIn
  and paid AI or search. Use fakes. Opt-in eval scripts must have hard cost
  caps.

## Environment variables and secrets

- `.env.example` lists every variable with placeholder values. Keep it in step
  with the code.
- Local secrets go in `.env.local`, which is gitignored.
- **Never commit a real secret. Never copy an `.env` file from another
  machine or project.** In particular, never reuse the autograff-site
  pipeline's Supabase or service keys.
- Only the app URL, the Supabase URL and the Supabase **publishable** key may
  be `NEXT_PUBLIC_*`. Everything else stays server-side.
- Local, preview and production use separate Supabase projects and separate
  credentials. Preview never points at production data.
- Do not create production credentials, change DNS or deploy to production
  unless the user explicitly asks for that step.

## Budget

- **$100/month, all in** (D-21): hosting, database, email, AI and search.
- Never add a paid service, plan, add-on or vendor without a new decision in
  `docs/DECISIONS.md`.
- The app's AI and search spend ceilings (production $50, staging $10) are a
  feature, not a setting to raise to get something working.
- Tests and local development use fakes. Opt-in evals must state their cost
  cap.

## Do not bypass safeguards

- Do not disable RLS, skip or delete tests, weaken a constraint or trigger, or
  use `--no-verify` to get something passing. Fix the cause, or stop and ask.
- Do not mark an integration, permission or API capability as working unless
  it was actually tested. External facts in the docs marked [S] are
  unverified.
- Do not push to `main`. Work on a branch and open a pull request only when
  asked.
