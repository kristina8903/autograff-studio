# Security, Privacy and Reliability

Status: **Phase 0 proposal**, 2026-10-21. Markers: **[S]** means the vendor
behavior came from search summaries of official pages that could not be
opened here, so it is unverified. **[A]** means assumption or recommendation.
Decisions that need human approval are listed in §16.

---

## 1. What we protect

| Asset | Why it matters |
|---|---|
| Unpublished founder drafts and comments | Reputational; founders' private views |
| Voice profiles and writing examples | Personal writing; could be used to impersonate a founder |
| Slack-derived text and insights | Internal discussion, possibly customer or personal data |
| Integration tokens (Slack, later LinkedIn) | Read access to Slack; **posting as a founder** on LinkedIn |
| AI, research and email API keys | Cost abuse |
| The publishing action itself | A wrong post under a founder's name is the worst outcome |
| Audit trail | Needed to show who approved what |

## 2. Threat model (main threats and mitigations)

| # | Threat | Mitigations (sections) |
|---|---|---|
| T1 | An unauthenticated person reads drafts through a URL, a preview deployment or an API | Auth required everywhere (§3). RLS deny by default (§4). Previews protected and using staging data only (§13). Unguessable IDs are never the control |
| T2 | Founder A reads founder B's drafts or admin notes | RLS on `founder_id`, `shared_with_founder_at` and visibility. Internal fields served through views. Tests per table (§4) |
| T3 | A founder escalates to admin | Role stored in `profiles`, with no self-update; not in `user_metadata`. Role changes go through an admin-only function and are audited |
| T4 | Unapproved or altered text gets published | Database-enforced publish gate, hash-bound approvals, invalidation trigger, no auto-publish (§11) |
| T5 | Prompt injection from web pages or Slack | Untrusted-content handling, a tool-less extraction step, no actions taken on model output without a person (§6) |
| T6 | Sensitive Slack content leaks into drafts or logs | Channel allow-list, sensitivity filtering, admin approval of insights, minimization, log hygiene (§7, §9) |
| T7 | Token theft (Slack, LinkedIn) | Vault storage, server-only access, least scopes, rotation and revocation (§5) |
| T8 | Secret leakage to the browser or the repo | Only `NEXT_PUBLIC_` publishable values reach the client. Lint rule. `.env*` gitignored. Secret scanning (§8) |
| T9 | Cost runaway (loop, abuse, retries) | Per-run and per-month ceilings, idempotency keys, bounded retries, admin-only generation (§10) |
| T10 | Data loss | Backups, an independent weekly export, tested restore, immutable versions (§12) |
| T11 | Compromised admin account | MFA for admin, short sessions, audit log, invite-only (§3) |
| T12 | Hallucinated facts or invented anecdotes published under a founder's name | Claims metadata, blocking flags, placeholder rule, human approval (§11; PRODUCT_SPEC §5.6) |

## 3. Authentication and sessions

- Supabase Auth. **Sign-ups disabled** [S: "Allow new users to sign up" off].
  Accounts are created only by an admin invite, which calls
  `auth.admin.inviteUserByEmail` server-side with the secret key [S].
- Sign-in method: email magic link or OTP. **Only `@autograff.ai` addresses**
  can be invited, enforced in the invite function and again in a Supabase
  "before user created" hook [S] (D-04).
- **MFA (TOTP) required for admins.** The app checks the session's assurance
  level (AAL2) on every admin action, not only on page load. Founders are
  are offered MFA but not required at launch (D-04); revisit before Phase 10.
- Sessions: HTTP-only, `Secure`, `SameSite=Lax` cookies managed by
  `@supabase/ssr`. Access-token lifetime stays at the Supabase default.
  Inactivity timeout is enforced by the refresh-token settings (D-04).
- Deactivating a user sets `profiles.status = 'deactivated'`, which fails every
  RLS check immediately. It also bans the user in Auth so refresh fails.
- Auth emails are sent through custom SMTP (§7.2 of ARCHITECTURE) with
  SPF, DKIM and DMARC.

### 3.1 As built in Phase 1 (verified locally, 2026-10-21)

- Sign-in uses a 6-digit email code. Email links open a confirmation page and
  are spent only when the person presses Continue (a POST), so link-scanning
  email filters cannot use them up.
- The sign-in form gives the same response whether or not an address has an
  account.
- Public sign-up is refused by Auth (`signup_disabled`). The domain rule is
  enforced in three places: the invite code, the Auth hook, and a trigger on
  `auth.users` that covers every creation path.
- Admin rights in the database require `aal2`. An admin who has not completed
  the MFA challenge has no admin access, even through the API.
- Pages send a per-request nonce CSP with no `unsafe-inline` for scripts or
  styles. The browser tests fail on any CSP violation. Other headers sent:
  - `frame-ancestors 'none'` / `X-Frame-Options: DENY`;
  - `X-Robots-Tag: noindex, nofollow`;
  - `Cache-Control: private, no-store`;
  - HSTS and `upgrade-insecure-requests` when the app URL is HTTPS.
- Error pages never show error details.

## 4. Authorization: server and database

There are two independent layers, and both must agree:

1. **Server.** Every server action and route handler does three things:
   - calls `requireUser()` and checks the role for that action;
   - validates input with Zod;
   - calls the database with the **user's own session**, so RLS applies.

   Admin pages also check AAL2. There is no "trust the client" path. UI
   visibility is cosmetic.
2. **Database.** RLS is enabled on every table, deny by default (policies in
   DATA_MODEL §14). Status changes, approvals, publication records, channel
   enablement and invites all go through `security definer` functions. These
   check `auth.uid()` and the role themselves and use `search_path = ''`. Direct
   `UPDATE` of status columns is revoked.

Further rules:

- The **secret (service-role) key** is used only in:
  - the job runner (cron-triggered, no user);
  - the invite function;
  - migrations.

  It never touches a request-scoped code path that takes user input without
  going through the same SQL functions. A lint rule restricts the import of the
  admin client to `lib/server/admin/*`.
- Founder views omit internal columns (`rationale`, admin comments, cost) at
  the **view** level, not in the UI.
- **Tests.** For every table there are three tests:
  - an anonymous request is denied;
  - founder A cannot read or modify founder B's rows;
  - a founder cannot read admin-only tables or columns.

  These run against a real local Postgres in CI (PHASES Phase 1 and every
  later phase).

## 5. OAuth flows and token storage (Slack, LinkedIn)

- Authorization-code flow, server-side, with a `state` parameter bound to the
  admin's session (and PKCE where the provider supports it). Redirect URIs are
  registered exactly. There are no wildcards in production.
- Request **minimum scopes** (INTEGRATIONS §4.2, §5.2). Store the scopes
  actually granted and check them before each call.
- Tokens are stored in **Supabase Vault** [S: encrypted secrets readable via
  SQL]. Business tables hold only a reference. Only `security definer`
  functions used by the job runner can read them. API roles have no grant, and
  tokens are never returned to the browser.
- Slack: enable **token rotation** (12-hour access tokens with refresh) [S]
  unless it complicates the internal app unduly (decision in Phase 6).
  LinkedIn access tokens last 60 days. Refresh tokens appear to be available
  only to approved partners [S], so plan for re-authorization.
- Revocation:
  - Disconnecting in the UI calls the provider's revoke (Slack `auth.revoke`
    or `apps.uninstall` [S]), deletes the Vault secret, marks the connection
    `revoked` and audits it.
  - The system handles `app_uninstalled` and `tokens_revoked` events [S] by
    marking the connection revoked and stopping sync.
- Never log tokens, authorization codes or full callback URLs.

## 6. Prompt injection and untrusted content

All retrieved web pages and Slack messages are **untrusted data**.

1. **Separation.** Untrusted text is passed only in clearly delimited,
   labeled blocks, e.g. `<untrusted_source id=…>…</untrusted_source>`. The
   system prompt states that their contents are material to analyze, never
   instructions.
2. **Tool-less extraction.** Untrusted text is processed by an extraction call
   that has no tools, no web access, no database access and no secrets in its
   context. It returns schema-validated findings only. Drafting calls receive
   those findings, not raw pages.
3. **Validation of outputs:**
   - Quotes must appear verbatim in the stored excerpt.
   - URLs in findings must equal the URL the provider actually returned.
     **The model cannot introduce a new URL.**
   - Numbers in a claim must appear in the excerpt, or the finding is
     rejected (Phase 5: a finding containing any web address is rejected too).
   - **The search step** (Phase 5) reads pages through the Claude web search
     tool. It has that tool only, called directly (no code execution), and a
     cap of 5 searches. Its own prose is thrown away: only the pages the tool
     returned and the passages the API cited from them are kept, and a
     citation of a URL the search did not return is dropped.
4. **No autonomous actions.** No model output can trigger publishing, sending,
   integration changes, or new outbound requests to URLs it chose. Server-side
   web fetch, if used, is limited to URLs returned by the search provider.
   Domain block lists are supported [S: Claude web tools support
   `allowed_domains` / `blocked_domains`].
5. **No secrets in prompts.** API keys, tokens and other users' data never
   enter a model context.
6. **Output treated as data.** Generated text is rendered as text, never as
   HTML. Markdown rendering, if any, is sanitized.

## 7. Sensitive Slack content

- **Off by default.** Nothing is read until an admin connects Slack **and**
  enables specific channels. DMs and group DMs are never requested, so `im:*`
  and `mpim:*` scopes are not requested (INTEGRATIONS §4).
- Before storage, messages go through a **pre-filter**: regex and
  deterministic rules for credentials, keys, emails, phone numbers and card
  numbers, plus channel-level rules. Matching messages are dropped and only
  counted.
- The extraction step classifies sensitivity. Anything classed
  `customer_confidential`, `personal`, `hr` or `credential` **cannot be
  approved** for generation (enforced by a constraint).
- Every insight needs **admin approval** before any generation uses it.
  Quoting a founder's Slack words verbatim also requires `quote_approved`.
- **Minimization:** raw message text is kept only for a short working window
  (default 30 days, D-09) and then purged. Insights keep a summary plus a
  permalink back to Slack, which itself enforces who can view the original.
- HR channels, customer-specific channels and private founder channels are
  excluded unless the admin enables them deliberately, and that action is
  audited. A warning prompt is shown for channel names matching sensitive
  patterns.

## 8. Secrets management

- All secrets live in Vercel environment variables, scoped per environment.
  Production secrets are marked "secret" (write-only) [S]. Locally they go in
  `.env.local`, which is gitignored and never copied between machines (repo
  rule).
- Only these may be `NEXT_PUBLIC_`:
  - the app URL;
  - the Supabase URL;
  - the Supabase **publishable** key.

  A CI check fails the build if any other `NEXT_PUBLIC_` variable is added.
  The new Supabase `sb_publishable_` / `sb_secret_` keys are preferred over
  legacy anon/service_role. Secret keys are rejected when used from a browser
  [S].
- `.env.example` contains names and placeholders only.
- GitHub secret scanning and push protection are turned on for the repo.
- Keys are rotated when someone with access leaves, or on suspicion of leak.
  The procedure is documented in the README runbook (Phase 1).

## 9. Logging, retention and deletion

- **Logs never contain:**
  - tokens, keys, cookies or authorization headers;
  - full prompts;
  - Slack message text;
  - post bodies.

  They contain ids, status, durations, token counts and sanitized error codes.
  A logger wrapper redacts known secret patterns.
- Full prompts and responses are **not** stored by default. Storing them for
  debugging is an explicit setting with a short TTL (D-10).
- Default retention (all configurable, D-09):

  | Data | Retention |
  |---|---|
  | `slack_messages` | 30 days |
  | Rejected or archived drafts | Indefinitely (for learning), deletable by admin |
  | Generation run metadata | 24 months |
  | Audit events | Indefinitely |
  | Research excerpts | Indefinitely |

- **Deletion:**
  - An admin can delete a founder's data, in which case drafts, versions,
    examples and voice profile cascade. Published records are anonymized only
    if requested.
  - Slack disconnection purges stored message text immediately.
  - Erasure requests are handled by an admin runbook.
- Model provider data handling: check the Anthropic account's retention and
  zero-data-retention terms before Slack text is sent (D-10).

## 10. Rate limits, cost controls, errors and retries

- **Only admins** can trigger generation and research. Founders' rewrite
  requests are limited (e.g. 10 per day per founder).
- Budget ceilings per run and per month (ARCHITECTURE §5.3). Refused runs are
  visible and are not retried silently.
- Every job carries an `idempotency_key` derived from
  `(kind, subject id, input version ids, user action id)`. A double-click or
  retry cannot create a second run.
- Retries happen only on transient errors (429, 5xx, network): exponential
  backoff with jitter, at most 3 attempts, honoring `retry-after`. Provider
  rate limits are respected by a per-provider concurrency limit (default 2).
- Slack sync respects per-method rate limits and the 2025 limits for
  non-Marketplace apps (INTEGRATIONS §4.3).
- Failures are recorded on the run or connection with a sanitized message and
  shown on an integration-health panel. Failures do not block unrelated work.

## 11. Protection against accidental publication

1. **No automatic publishing in the MVP.** Publishing is done by a person on
   LinkedIn and recorded afterwards.
2. **Publish gate in the database** (PRODUCT_SPEC §8.1). It is enforced by
   `app.record_publication()` and, later, by the LinkedIn job. Both require a
   valid approval whose content hash equals the current version's hash.
3. **Approval is bound to an exact version.** Any material edit invalidates
   it in the same transaction (DATA_MODEL §8).
4. **Blocking flags and placeholders** prevent approval (database constraint
   via the approve function).
5. **Clean flags are not approval.** There is no path from "no flags" to
   `approved` without a person.
6. **Copy-to-clipboard** copies the approved version's text from the server,
   not the editor's current state.
7. **Phase 10 extra gates:**
   - publishing is enabled per founder by that founder's explicit OAuth
     consent;
   - a final "publish now" confirmation in the UI;
   - a kill switch setting (`publishing_enabled=false`);
   - a one-publication-per-draft unique constraint;
   - `unknown` outcomes need manual reconciliation before any retry.

## 12. Backup and recovery

- Supabase daily backups (Pro: 7 days [S]). PITR is not purchased, because
  of the budget (D-16, D-21).
- Independent **weekly logical export** of the studio schema to a private
  bucket with 90-day retention, encrypted at rest.
- **Restore drill** before go-live and quarterly. The target is a restore to
  staging within 1 hour.
- Immutable versions and append-only audit mean most mistakes are fixed by
  restoring a previous version in-app, not by restoring the database.

## 13. Environment separation

- Separate Supabase projects for production and staging/preview. Local runs on
  Docker. No production data outside production, and no copying production
  into staging.
- Separate integration apps or credentials per environment: a test Slack
  workspace and a LinkedIn development app if available.
- Preview deployments use **Vercel Deployment Protection** (Vercel
  Authentication) [S] **and** the app's own login. Production relies on app
  login. Vercel protection on production is optional.
- Every response carries `X-Robots-Tag: noindex` and `robots.txt` disallows
  all.
- Security headers:
  - CSP: no inline scripts beyond Next's nonce; `frame-ancestors 'none'`;
  - HSTS;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy` minimal.

## 14. Audit trail

Append-only `audit_events` (DATA_MODEL §11). Events recorded:

- sign-ins and invites;
- role changes;
- brief versions;
- voice profile changes;
- draft transitions;
- approvals and invalidations;
- flag overrides and repetition overrides;
- publication records;
- channel enablement;
- integration connect and disconnect;
- settings changes;
- budget refusals.

## 15. Dependency and supply-chain hygiene

- Lockfile committed.
- Dependabot or Renovate.
- `npm audit` in CI (non-blocking at first).
- Minimal dependencies.
- No `postinstall` scripts from unknown packages.

## 16. Security decisions

Decided on 2026-10-21 (DECISIONS.md):

- **D-01 / D-02:** separate repository and Supabase projects.
- **D-04:** magic link or OTP, `@autograff.ai` only, MFA required for the
  admin.
- **D-09 / D-10:** retention defaults; full prompts not stored (7-day debug
  mode only).
- **D-11:** founder approval required and sufficient.
- **D-12:** founders do not record publications in the MVP.
- **D-13:** each founder sees only their own content.
- **D-16:** no PITR.

Still open:

| Ref | Decision |
|---|---|
| Phase 6 / D-17 | Slack terms review; which channels are allowed; private channels at all; token rotation |
| Phase 10 / D-18 | Whether to allow API publishing at all, given LinkedIn's terms (INTEGRATIONS §5) |
| Before Phase 10 | Whether founder MFA becomes required once founders connect LinkedIn |
