# Phase 1 report: application foundation

Date: 2026-10-21. Scope: [PHASES.md, Phase 1](../PHASES.md#phase-1-application-foundation).
Built and tested **locally only**, as agreed. Nothing is deployed, no cloud
resources or credentials were created, and no DNS was changed.

## What was built

| Area | Where |
|---|---|
| Next.js 16.4 app (TypeScript strict, Tailwind 4, ESLint, Prettier) | `app/`, `components/`, `lib/` |
| Database: companies, profiles (roles, status), founders, visibility grants, settings, append-only audit log; RLS on every table; SQL functions for sign-in, role change, deactivation and invite provisioning; `@autograff.ai` rule as an Auth hook **and** a trigger on `auth.users` | `supabase/migrations/20261021000001_foundation.sql` |
| Local seed: fake company, admin, three founders | `supabase/seed.sql` |
| Invite-only sign-in by 6-digit email code; invitation links confirmed with a button | `app/sign-in/`, `app/auth/confirm/` |
| Two-factor sign-in (authenticator app): required for the admin, optional for founders, and enforced for anyone who enrolled | `app/mfa/` |
| Admin: founders list, add and edit founder, invite founder, team list, deactivate user | `app/admin/` |
| Founder: dashboard with their own profile | `app/dashboard/` |
| Per-request guards (`requireAdmin`, `requireFounder`) | `lib/auth/dal.ts` |
| Proxy: session refresh, sign-in redirect, nonce CSP and security headers | `proxy.ts` |
| Secret-key client fenced to `lib/server/admin/` by a lint rule | `lib/server/admin/`, `eslint.config.mjs` |
| Public-variable allowlist check | `scripts/check-public-env.mjs` |
| CI workflow running every suite below on each pull request | `.github/workflows/ci.yml` |

## Test results (final run, fresh build, 2026-10-21)

| Command | Result |
|---|---|
| `npm run typecheck` | pass (exit 0) |
| `npm run lint` (ESLint + public-env check) | pass (exit 0), no warnings |
| `npm run format:check` | pass (exit 0) |
| `npm test` (Vitest) | **29/29** passed |
| `npm run test:db` (pgTAP) | **80/80** passed |
| `npm run test:e2e` (Playwright, production build) | **11/11** passed, including zero CSP violations |
| `npm run build` | pass; every route renders per request |
| `npm audit --omit=dev` | 0 vulnerabilities |

`npm audit` including dev dependencies reports 5 "high" findings. They are one
advisory (`braces`, a denial-of-service in glob matching) reached only through
`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob`. That is a lint
tool that never ships or handles user input. It is left for the next Next.js
update rather than forced.

### Phase 1 acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Public sign-up impossible, including by calling the endpoint directly | e2e "public sign-up is impossible" (`signup_disabled`); pgTAP: other domains rejected on every `auth.users` path |
| 2 | Admin invites a founder; the founder accepts, signs in and sees only their own profile | e2e "an admin invites a founder…" |
| 3 | Every page except sign-in and callback redirects anonymous users | e2e "anonymous visitors are sent to sign-in…" |
| 4 | An admin without MFA cannot reach admin pages | e2e "an admin must enroll…"; pgTAP "admin without MFA…" (4 tests) |
| 5 | A founder cannot read other founders, change their role, or read audit or settings, through the UI **or** the API with their own token | e2e "a founder cannot reach admin pages", "a founder's own token…"; pgTAP founder A vs B (22 tests) |
| 6 | Staging preview behind Vercel authentication | **Not done**: local-only by agreement. Needs the Vercel project, a staging Supabase project and an email sender |

Definition of done:

- Restore drill: **not done**. It needs a staging backup to restore.
- Standing requirements: met locally.

## Findings during the build

1. **Supabase `[auth.email] enable_signup` is the email provider's on/off
   switch**, not a sign-up setting. Setting it to false disabled email sign-in
   entirely. Sign-ups are blocked by `[auth] enable_signup = false`. This is
   commented in `supabase/config.toml` and must be mirrored in the hosted
   projects' dashboard.
2. **The before-user-created Auth hook does not run for the admin "create
   user" endpoint.** A `@gmail.com` user could be created that way. The new
   trigger on `auth.users` closes this for every path, and is tested.
3. **Next 16.4 enables Cache Components by default.** It is turned off
   (decision D-22) so that role changes and deactivation apply on the very
   next request.
4. **Static pages cannot carry the CSP nonce**, so the browser would have
   blocked their scripts. Every page now renders per request. Next's default
   404 page also ships an inline `<style>` that the CSP blocks, so it was
   replaced with an app page. The browser tests now fail on any CSP violation.
5. **Test isolation.** The browser tests change the database, so both suites
   reset to the seed before running.

## Not done in Phase 1, and why

- **Staging deployment and the restore drill.** Agreed to stay local. When
  you are ready, a person needs to create:
  - a Vercel project in the existing Pro team;
  - a staging Supabase project (Free plan, D-21);
  - a free-tier SMTP sender.

  In the hosted projects, mirror `supabase/config.toml`'s auth settings:
  sign-ups off, the hook, TOTP and email templates.
- **Role-change UI.** The audited `admin_set_user_role` function exists and is
  tested, but there is no screen for it. With one admin and three founders it
  is not needed yet.
- **Inviting a second admin from the UI.** The provisioning function supports
  it; the screen does not. Add it when a second admin is needed.
- **Founders editing their own founder record.** Admin-managed for now (see
  DATA_MODEL note).

## Open questions and risks

- The Supabase CLI config notes MFA "is available to Supabase Pro plan".
  Whether authenticator-app MFA works on a **Free** staging project is
  unverified [S]. Production is planned on Pro (D-21), so production is not
  affected. If staging Free lacks it, staging admins could not sign in. The
  options would then be a Pro staging project (cost) or a staging-only bypass,
  which needs a decision.
- The CI workflow is untested on GitHub until the first pull request runs
  it.
