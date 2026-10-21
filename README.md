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
**$100/month, all in**. Phase 1 has not started. No application code
exists. Nothing is deployed, no credentials have been created, and no DNS has
been changed.

| Area | Status |
|---|---|
| Product spec, architecture, data model, security, integrations, phases, decisions | Drafted, in [`docs/`](docs/) |
| Application, auth, database | **Not started** (Phase 1) |
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

## Intended stack

- Next.js and TypeScript.
- Supabase (Postgres, Auth, Vault).
- Vercel (Autograff's existing Pro team).
- GitHub.
- A server-side AI provider abstraction (Anthropic Claude by default).
- A pluggable web research provider.
- Later: the official Slack API and, if access allows, the LinkedIn API.

## Local setup (planned; available from Phase 1)

Prerequisites: Node.js (LTS), Docker (for the local Supabase stack), and the
Supabase CLI (via `npx supabase`).

```bash
cp .env.example .env.local      # placeholder values; fakes are used for AI/research by default
npm install
npx supabase start              # local Postgres, Auth, mail catcher
npx supabase db reset           # apply migrations + seed fake company, admin and founders
npm run dev                     # http://localhost:3000
```

Tests (planned):

```bash
npm run typecheck && npm run lint && npm run format:check
npm test            # unit tests, no network
npm run test:db     # database/RLS tests against the local Supabase stack
npm run test:e2e    # Playwright end-to-end tests against local app + fakes
```

No real Slack messages, LinkedIn posts or paid API calls are made by ordinary
test runs. Never copy an `.env` file from another machine or project.
