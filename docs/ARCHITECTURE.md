# Architecture

Status: **Phase 0 proposal**, 2026-10-21. Nothing is built or deployed.

Throughout this document:

- **[V]** marks a fact verified against primary documentation in this session.
- **[S]** marks a fact taken from search-engine summaries of the vendor's
  official pages. The pages themselves could not be opened from this
  environment because the network policy blocked them. Each [S] fact must be
  confirmed before it is relied on (checklist in
  [INTEGRATIONS.md §8](INTEGRATIONS.md)).
- **[A]** marks an assumption or recommendation.

---

## 1. Repository state found in Phase 0 [V]

Content Studio was planned inside the existing `autograff-site` repository,
which is **not empty**. It holds:

- the public marketing site at autograff.ai: Next.js 16, React 19,
  Tailwind 4, deployed by Vercel on merge to `main`;
- the revenue-operations pipeline: call capture, Attio CRM sync, Instantly,
  Vercel cron jobs, Slack incoming-webhook reports, and gated decks and videos;
- one Supabase project for the pipeline, with about 50 migrations, RLS on
  deck tables, a service-role data path, and `@supabase/ssr` for auth;
- repo rules in `AGENTS.md` and `CLAUDE.md`, and owner-gated paths in
  `.github/CODEOWNERS` (`/CLAUDE.md`, `/docs/`, `/supabase/`, `/app/api/`,
  `/package.json` and others).

Consequences for Phase 0:

- The requested `CLAUDE.md`, `README.md` and `docs/` could not be written at
  the repo root without overwriting the site's instructions and writing into
  the owner-gated `docs/`. They live in **`studio/`** instead, a
  self-contained folder that does not touch the site build.
- No site code, config, dependency or migration was changed.
- Where Studio should live long term is decision **D-01**. The recommendation
  is a new repository.

---

## 2. Recommended architecture at a glance [A]

```
                    studio.autograff.ai  (Vercel project "autograff-studio", existing Pro team)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ Next.js (App Router, TypeScript, server components)                       │
 │                                                                           │
 │  UI (admin + founder)  ──server actions / route handlers──▶ Domain layer   │
 │                                                     │ (pure TS: cadence,  │
 │                                                     │  coverage, state    │
 │                                                     │  machine, material- │
 │                                                     │  edit rule, lint)   │
 │                                                     ▼                     │
 │  Auth guard (proxy + per-request)       Data access (Supabase client with │
 │                                          the USER's session → RLS applies)│
 │                                                     │                     │
 │  Job runner (route handler, cron-triggered) ─ service key, fixed paths ─┐ │
 │       │                                                                 │ │
 │       ├─ LlmProvider  ──────────▶ Anthropic API (default)               │ │
 │       ├─ ResearchProvider ──────▶ Claude web search / Brave / Exa …     │ │
 │       ├─ SlackProvider (Ph. 6) ─▶ Slack Web API                         │ │
 │       └─ PublishingProvider ────▶ Manual (MVP) / LinkedIn (Ph. 10)      │ │
 └───────────────────────────────────────────────────────────────────────┬──┘
                                                                         ▼
                 Supabase project "autograff-studio-prod" (Postgres + Auth + Vault)
                 RLS on every table · SQL functions for every state change
```

Separate from the marketing site: own repository (D-01), own Vercel project, own
Supabase projects (D-02). Nothing is shared with the revenue pipeline's
database or secrets.

---

## 3. Stack evaluation

| Layer | Proposed | Verdict | Why / alternatives |
|---|---|---|---|
| App framework | Next.js + TypeScript | **Keep** | The team already runs Next 16 on Vercel. Server components and server actions keep secrets and data access server-side. One codebase serves UI and API. Alternatives such as Remix/React Router, or a SPA plus a separate API, add a second deployable and buy nothing here. |
| Database | Supabase Postgres | **Keep** | Relational model with strong constraints, RLS, `pg_trgm`, optional `pgvector` [S], Vault [S], CLI migrations and local Docker stack. Already familiar to the team. Neon plus a separate auth service is the alternative. It means more vendors for the same result. |
| Auth | Supabase Auth | **Keep, with conditions** | Invite-only is supported. You disable "Allow new users to sign up" and invite server-side with `auth.admin.inviteUserByEmail` [S]. Auth and the database share one identity (`auth.uid()` in RLS), which is the main reason to keep it. Conditions: (1) custom SMTP is required, because the default sender only reaches project-org members at about 2 emails/hour [S]; (2) MFA (TOTP) required for the admin role, decision D-04; (3) the role is stored in `profiles`, never in user-editable metadata. Alternatives: Clerk or Auth.js. Both add a second identity to map into RLS. |
| Hosting | Vercel | **Keep, existing Pro team** | See §8. Hobby is non-commercial only [S]; Autograff already has Pro, so Studio is one more project at no extra plan cost. |
| Source control | GitHub | **Keep** | New repository recommended (D-01). |
| AI | Server-side provider abstraction, Anthropic Claude as default | **Keep** | §5. |
| Research | Pluggable provider, default Claude web search tool | **Recommend** | Fewest vendors. URLs and `page_age` come back with each result [S]. Brave Search API is the main alternative, with explicit `page_age` and separate per-request billing [S]. D-06. |
| Background work | Postgres job table plus a Vercel Cron-triggered runner | **Recommend** | Volumes are small, tens of runs a day. Queue services (Inngest, Trigger.dev, QStash) are reasonable later if runs outgrow function time limits. D-03. |
| Email | Transactional provider for auth email only (e.g. Postmark or Resend) | **Add** | Needed for invites [S]. Any SMTP-capable provider works. D-04. |
| Embeddings | None in the MVP | **Defer** | Anthropic does not offer an embeddings model, so adopting embeddings adds a vendor. The corpus is small (about 25–30 posts a month). Trigram plus a model-judged comparison is enough to start. D-07. |
| Testing | Vitest (unit and integration), pgTAP or SQL tests via Vitest against local Supabase, Playwright (E2E) | **Add** | Playwright and Chromium are already common in this team's tooling. |
| Lint / format | ESLint (Next config) plus Prettier, `tsc --noEmit` strict | **Add** | |

### 3.1 Next.js specifics to verify in Phase 1 [A]

The repo's `AGENTS.md` warns that this Next.js major has breaking changes
(e.g. Middleware is renamed `proxy.ts` in Next 16 [V: seen in this repo]).
Before Phase 1 code is written, the bundled docs in
`node_modules/next/dist/docs/` must be read. Pay particular attention to
`proxy.ts`, server actions, `after()` (post-response work), route segment
config for `maxDuration`, and caching defaults.

---

## 4. Components

### 4.1 Web app (Next.js)

- **Route groups:** `(auth)` for sign-in and invite acceptance, `(admin)` and
  `(founder)` for the two experiences. There are no public pages besides
  sign-in.
- **Proxy (`proxy.ts`):** refreshes the Supabase session cookie and redirects
  unauthenticated requests to sign-in. Every route except `/sign-in`,
  `/auth/callback` and health checks requires a session. It also sets
  `X-Robots-Tag: noindex` and security headers. The proxy is a convenience,
  not the boundary: every server action, route handler and server component
  re-checks the session and role.
- **Server actions and route handlers:** validate input with Zod, call the
  domain layer, then persist through the user-scoped Supabase client. All
  state changes go through SQL functions (DATA_MODEL §14).
- **No client-side data access with privileged keys.** The browser receives
  only the publishable key, used for the auth session. Data fetches happen in
  server components.

### 4.2 Domain layer (pure TypeScript, no I/O)

Unit-tested in isolation:

- `cadence/`: slot generation per rule and month (time zones, boundaries).
- `coverage/`: mirrors the SQL view and is tested against the same fixtures,
  so the two cannot drift.
- `workflow/`: the draft state machine (allowed transitions, roles,
  preconditions).
- `content/`: body normalization, the material-edit rule, placeholder
  detection, and the post-generation lint (banned phrases, metadata leaking
  into the body, paragraph-shape heuristics).
- `repetition/`: fingerprint comparison and the candidate shortlist.
- `budget/`: cost estimation and ceilings.

### 4.3 Job runner

- AI and integration work runs as **generation runs** or **sync jobs**: rows
  in a `jobs` or `generation_runs` table with `status`, `idempotency_key`,
  `attempt` and `run_after`.
- When a user triggers work, the server action inserts the job. It then starts
  processing straight after the response (`after()`, to verify) or the job is
  picked up by a Vercel Cron call to `/api/jobs/tick` every minute [S: Pro
  allows per-minute cron]. The tick endpoint requires `CRON_SECRET`, the same
  pattern as the site.
- Each job claims itself with `UPDATE … WHERE status='queued' … RETURNING`
  (`FOR UPDATE SKIP LOCKED`), so concurrent ticks never double-process.
- Jobs are bounded to fit the function duration limit [S: Pro default 300 s,
  configurable up to 800 s]. A concept batch is one model call. Drafts are one
  per job. Long research is split per query.
- Retries: exponential backoff on 429, 5xx and network errors, at most 3
  attempts. Validation failures and 4xx errors other than 429 are not
  retried. The run is marked failed with a sanitized error the admin can see.
- **Batch API** (50% price, asynchronous) is an option for large concept
  batches that are not urgent [V: from the Claude API reference loaded this
  session]. It is not needed at MVP volumes.

### 4.4 Provider interfaces

```ts
interface LlmProvider {
  generateStructured<T>(req: {
    task: LlmTask;                    // 'concepts' | 'draft' | 'extract_findings' | ...
    system: string;                   // trusted instructions only
    trustedContext: ContextBlock[];   // brief, voice profile, approved examples
    untrustedContext: ContextBlock[]; // web excerpts, Slack text — delimited & labelled
    schema: ZodSchema<T>;
    budget: { maxOutputTokens: number; maxCostUsd: number };
    idempotencyKey: string;
  }): Promise<{ data: T; usage: Usage; model: string; raw?: unknown }>;
}

interface ResearchProvider {
  search(q: ResearchQuery): Promise<SearchResult[]>;  // url, title, publisher?, publishedAt?, snippet
  fetch?(url: string): Promise<FetchedDocument>;      // optional; excerpts only stored
}

interface PublishingProvider {
  kind: 'manual' | 'linkedin';
  publish(p: ApprovedPost, idempotencyKey: string): Promise<PublishResult>;
}

interface SlackSource { listChannels(); history(channel, cursor); replies(channel, ts); permalink(channel, ts); }
```

Provider choice comes from configuration (`settings` table plus env). Code
outside `lib/providers/*` never imports a vendor SDK. Every implementation has
a **fake** used by tests and by local development without keys.

---

## 5. AI usage design

### 5.1 Default provider and models [A]

The default provider is Anthropic. Model IDs and list prices below come from
the Claude API reference available in this session (cached 2026-10-06) [V].
Re-check prices at
https://platform.claude.com/docs/en/about-claude/pricing before budgeting.

| Task | Suggested default | List price (input / output per 1M tokens) |
|---|---|---|
| Drafts, rewrites, concept batches | `claude-opus-5-5` | $4 / $20 |
| Finding extraction, fingerprints, feedback classification, repetition judge | `claude-sonnet-5-5` (or `claude-haiku-5-5` once evaluated) | $2 / $10 (Haiku: $0.10 / $0.50 up to 100K-token prompts) |

Models are configured per task in `settings`, not hard-coded. Which model
writes founder drafts is a quality decision for the admin (D-06b).

### 5.2 Request shape

- **Structured outputs** (JSON schema) for every task, validated again with
  Zod on receipt. The post body is one field among several, which is what
  keeps rationale and flags out of the body.
- **Prompt caching** for the stable prefix (system prompt, voice profile,
  examples) when generating several drafts for the same founder.
- **Prompt templates** are versioned files in the repo
  (`lib/prompts/<task>.v<N>.ts`). Their version is stored on each run.
- Responses are checked for `stop_reason` (including `refusal` and
  `max_tokens`) before use.
- **Two-step research processing.** Untrusted web text is processed in an
  extraction call that has **no tools and no write capability** and returns
  only structured findings. The drafting call sees findings, not raw pages
  (SECURITY §6).

### 5.3 Cost controls

Before each run, cost is estimated from token counts and the price table and
checked against two ceilings: per run and per month (`settings`). Runs that
would exceed either are refused, with an explanation. Actual usage is recorded
from the API response. The dashboard shows month-to-date spend.

---

## 6. Environments [A]

| | Local | Preview | Production |
|---|---|---|---|
| URL | `http://localhost:3000` | `*.vercel.app` per branch, protected | `https://studio.autograff.ai` |
| Supabase | Local stack via `supabase start` (Docker) | **Staging project** (separate from prod) | **Prod project** |
| Data | `seed.sql` fake founders and posts | Synthetic or seeded only. **Never a copy of production** | Real |
| AI / research | Fakes by default; real keys optional (dev budget) | Real keys with a **low** budget ceiling, or fakes | Real keys, production budget |
| Slack / LinkedIn | Fakes | Fakes, or a sandbox workspace and test app | Real (after approval) |
| Auth email | Supabase local Inbucket/Mailpit | Staging SMTP sender | Production SMTP sender |
| Access | Developer | Vercel Deployment Protection **and** app login | App login (plus optional Vercel protection) |

Separation rules:

- Production secrets are scoped to the Vercel **Production** environment only.
  Preview has its own staging values [S: per-environment scoping and
  write-only "secret" variables].
- Preview deployments never connect to the production database.
- The Supabase redirect allow list for **prod** contains only
  `https://studio.autograff.ai/**`. The **staging** project allows the team's
  preview pattern (`https://*-<team>.vercel.app/**`) and localhost [S:
  wildcard syntax].
- Supabase Branching (per-preview databases) exists on paid plans and bills
  per branch-hour [S]. It is not needed at first, because one shared staging
  project is simpler. D-02.

---

## 7. Production deployment plan (documented, not executed)

Phase 0 changes no DNS, creates no credentials and deploys nothing.

### 7.1 Domain

1. In Vercel, create the project `autograff-studio`, connect the repo and
   choose Autograff's existing Pro team.
2. Add the domain `studio.autograff.ai` to the project. Vercel shows the exact
   DNS record on the domain card.
3. At the DNS host for `autograff.ai`, add **one CNAME record**:
   `studio` → the target shown on the Vercel domain card. Current Vercel
   targets are project-specific (`…vercel-dns-0xx.com`). Older docs say
   `cname.vercel-dns.com`. Use whatever the card shows [S].
   - The apex `autograff.ai` and the marketing site's records are **not
     touched**.
   - If the DNS host is Cloudflare, set the record to **DNS only** (grey cloud).
     Proxied records break Vercel's certificate issuance [S].
   - If the domain has CAA records, make sure they allow Vercel's certificate
     authority (Let's Encrypt) [S].
4. Vercel issues the TLS certificate automatically once DNS resolves [S].
   HTTPS is enforced, HTTP redirects to HTTPS. Add
   `Strict-Transport-Security` from the app.
5. The user makes these DNS changes at go-live (D-14).

### 7.2 Authentication settings (production Supabase project)

- Site URL: `https://studio.autograff.ai`.
- Redirect URLs: `https://studio.autograff.ai/auth/callback` (exact path).
- "Allow new users to sign up": **off**.
- Custom SMTP: production sender, e.g. `studio@autograff.ai`, with SPF, DKIM
  and DMARC for that sender, added to DNS by whoever owns it.
- Email OTP or link expiry: short (e.g. 1 hour) [S: default].
- MFA: TOTP enabled, required for admin (enforced in app by checking the
  session's AAL).

### 7.3 Deploy and rollback

- Merge to `main` → Vercel production deployment. Migrations run in CI before
  the deploy step, and the deploy is blocked if they fail.
- Rollback:
  - App: Vercel Instant Rollback. On Pro you can return to any previous
    production deployment [S].
  - Database: forward-only migrations, so rolling back means a new migration.
    Every migration must be backward-compatible with the previous app version
    (expand/contract, DATA_MODEL §15). That makes an app rollback always safe.
- **Backups:** Supabase Pro includes daily backups with 7-day retention [S].
  Point-in-time recovery is a paid add-on [S] and is **not** bought, because of
  the budget (D-16, D-21). In addition, a weekly
  logical export (`pg_dump` of the studio schema) goes to an
  access-controlled storage bucket. This is the restore path that does not
  depend on the plan.
  Restore is tested once before go-live and then quarterly (PHASES Phase 1 and
  Phase 9).

---

## 8. Is Vercel the right host?

**Recommendation: yes, as its own project in Autograff's existing Vercel Pro team.** [A]

For:

- The team already deploys a Next.js 16 app there.
- Preview deployments per pull request.
- Per-environment variables and secrets [S].
- Managed TLS and domains [S].
- Cron [S].
- Instant Rollback [S].
- There is no infrastructure to run.

Against, with mitigations:

- **Function time limits** (Pro: 300 s default, up to 800 s [S]). Jobs are
  bounded and resumable (§4.3). A queue service can be added if needed.
- **Preview exposure.** Use Deployment Protection with Vercel Authentication
  on previews, available on all plans [S]. Previews also use staging data only.
- **Cost** is per seat on Pro. Only people who deploy need seats; founders do
  not.

Alternatives considered:

- Netlify: equivalent, with no advantage for this team.
- Fly.io, Render or Railway: long-running workers, but more operations work.
- Self-hosting Next on a VM: not justified.

---

## 9. Local development (Phase 1 target)

```bash
git clone … && cd autograff-studio
cp .env.example .env.local             # placeholders; app runs with fakes
npm install
npx supabase start                     # local Postgres/Auth/Studio in Docker
npx supabase db reset                  # migrations + seed (fake founders/content)
npm run dev                            # http://localhost:3000
```

With no AI keys set, `LLM_PROVIDER=fake` returns deterministic fixtures. That
means the whole workflow, from concept to publication record, can be run and
tested offline. Local login uses the seeded admin and founder users. Invite
emails are caught by the local mail catcher.

---

## 10. Costs

**Budget: $100/month, all in (D-21).** The full allocation and enforcement are
in DECISIONS.md D-21. Prices are **[S] (unverified) or estimates**; confirm them
in Phase 1.

| Item | Plan | Monthly |
|---|---|---|
| Vercel | Existing Pro team, one more project | $0 extra [A] |
| Supabase production | Paid project | ~$25 [S] |
| Supabase staging | Free project (pauses after about 7 days idle [S]) | $0 |
| PITR | Not purchased | $0 |
| Auth email | Free tier of a transactional provider | $0 |
| AI + web search, production | App-enforced ceiling | $50 |
| AI + web search, staging and local | App-enforced ceiling | $10 |
| Headroom | | ~$15 |

Search prices for reference [S]: Claude web search $10 per 1,000 searches plus
tokens; Brave $5 per 1,000.

**AI usage estimate** [A]. Assumptions: about 45 approved posts a month, about
3 draft versions generated per post, about 20k input and 2k output tokens per
draft call, plus concept batches, extraction and fingerprinting.

- Drafts on Opus 5.5: 135 × (20k × $4/M + 2k × $20/M) ≈ 135 × $0.12 ≈ **$16**.
- Concepts, extraction and judges add perhaps the same again.
- Research at about 100–300 searches a month adds a few dollars.

That is roughly $35–45 a month, inside the $50 production ceiling. If spend
runs high, the levers in order are: prompt caching, fewer regenerations, a
cheaper model for concept batches, and the Batch API for non-urgent batches.

## 11. Lock-in

| Dependency | Lock-in | Mitigation |
|---|---|---|
| Supabase | Low to moderate. It is plain Postgres; Auth and RLS helpers are Supabase-flavored | Standard SQL migrations. Auth is wrapped in one module. `pg_dump` exports |
| Vercel | Low | Standard Next.js. Cron is one endpoint that any scheduler can call |
| Anthropic | Low | `LlmProvider` interface. Prompts are plain text. Structured output is validated with Zod independently |
| Research provider | Low | `ResearchProvider` interface. Sources are stored in our schema |
| LinkedIn | High, but unavoidable | Manual publishing is always available as the fallback |
