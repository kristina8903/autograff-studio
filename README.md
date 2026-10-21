# Autograff Content Studio

A private web application for planning, generating, curating and managing
LinkedIn content for Autograff's founders. The intended production URL is
`https://studio.autograff.ai`.

The marketing admin sets each month's strategy, configures each founder's
publishing cadence, and generates content concepts and drafts. These draw on
the founder's own voice profile, approved writing examples, verified industry
research and, later, approved Slack-derived insights. Drafts go through admin
curation and founder review. Only content the founder has approved, in its
exact approved wording, can be scheduled and published.

## Current status

**Phase 0 (planning) is complete.** The main decisions were made on
2026-10-21 (see [DECISIONS.md](docs/DECISIONS.md)): separate repository and
databases, `@autograff.ai`-only invites, founder approval, and a budget of
**$100/month, all in**.

**Phase 1 (application foundation) is built and running on staging**
(https://autograff-studio.vercel.app): invite-only sign-in, admin and founder
roles, two-factor sign-in for admins, founder profiles, and the database
security rules. See the [Phase 1 report](docs/phase-reports/phase-1.md) and
the [staging runbook](docs/runbooks/staging-setup.md). No production
deployment exists and no DNS has been changed.

**Phase 2 (monthly strategy and cadence) is built and tested**: versioned
monthly briefs, each founder's publishing cadence, the publishing calendar and
slot coverage. See the [Phase 2 report](docs/phase-reports/phase-2.md).

| Area | Status |
|---|---|
| Product spec, architecture, data model, security, integrations, phases, decisions | Drafted, in [`docs/`](docs/) |
| Application, auth, database | **Built** (Phase 1); on staging |
| Briefs, cadence, calendar | **Built** (Phase 2) |
| AI generation | Not started (Phase 4) |
| Web research | Not started (Phase 5); provider not chosen |
| Slack integration | Not started (Phase 6); access and terms **not verified** |
| LinkedIn publishing and analytics | Not started (Phase 10); access and terms **not verified**. Publishing is manual until then |
| Production deployment at studio.autograff.ai | Not configured |

External vendor facts in the docs are marked **[S]** where they could not be
checked against the vendor's own page (see
[INTEGRATIONS.md](docs/INTEGRATIONS.md), "Verification status").

## Where this lives

This repository was split out of `autograff-site` on 2026-10-21 (decision
D-01). The application shares no deployment, database or secrets with the
marketing site or the revenue pipeline.

## Documents

| Document | Contents |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Standing instructions for Claude Code sessions |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Users, workflow, cadence, coverage, generation, review, publishing, acceptance criteria |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack evaluation, components, environments, deployment and DNS plan, costs |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Entities, relationships, RLS, versioning, coverage formulas |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, access control, privacy, secrets, publishing safeguards |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | AI, research, Slack, LinkedIn: permissions, limits, open questions, verification checklist |
| [docs/PHASES.md](docs/PHASES.md) | Implementation phases with acceptance criteria and tests |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Assumptions, decisions, and inputs needed |
| [docs/runbooks/staging-setup.md](docs/runbooks/staging-setup.md) | Step-by-step staging setup (Vercel + Supabase Free) |

## Intended stack

- Next.js and TypeScript.
- Supabase (Postgres, Auth, Vault).
- Vercel (Autograff's existing Pro team).
- GitHub.
- A server-side AI provider abstraction (Anthropic Claude by default).
- A pluggable web research provider.
- Later: the official Slack API and, if access allows, the LinkedIn API.

## Local setup

Prerequisites: Node.js 22+, and Docker (for the local Supabase stack).

```bash
npm install
npm run db:start                # local Postgres, Auth and mail catcher (first run pulls images)
npm run env:local               # writes .env.local from the local stack (local keys only)
npm run dev                     # http://localhost:3000
```

Sign in at http://localhost:3000/sign-in with a seeded address (see
`supabase/seed.sql`): `local-admin@autograff.ai`, `local-ceo@autograff.ai` or
`local-cto@autograff.ai`. Codes and invitation emails land in the local mail
catcher at http://127.0.0.1:54324; nothing is delivered. The admin is asked to
set up an authenticator app on first sign-in.

`npm run db:reset` re-applies migrations and the seed. `npm run db:types`
regenerates `lib/supabase/database.types.ts` after a schema change.

## Tests

```bash
npm run check       # typecheck + lint + format check + unit tests (no network)
npm run test:db     # database access-control tests (pgTAP) against the local stack
npm run test:e2e    # browser tests: production build + local stack; resets the local database
```

The browser tests need Chromium (`npx playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing Chromium). CI runs all of the
above on every pull request (`.github/workflows/ci.yml`).

No real Slack messages, LinkedIn posts or paid API calls are made by ordinary
test runs. Never copy an `.env` file from another machine or project.
