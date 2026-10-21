# Integrations

Status: **Phase 0 research**, 2026-10-21.

**Read this first: verification status.** On 2026-10-21 this session's network
policy blocked direct access to Slack, LinkedIn/Microsoft Learn, Vercel and
Supabase documentation. The requests failed with DNS errors and proxy 403s.
So every vendor fact below marked **[S]** was taken from search-engine
summaries of the vendor's **official** pages, at the URLs given, and the pages
themselves were **not opened**. Those facts are leads, not verified facts.
Nothing in this document has been tested against a live API. §8 is the
checklist to verify before each phase starts. **[V]** marks facts read
directly from a source available in this session (the Claude API reference
bundled with Claude Code, cached 2026-10-06). **[A]** marks assumptions and
recommendations.

---

## 1. Integration principles

- Every external system sits behind an interface in `lib/providers/` (see
  ARCHITECTURE §4.4), with a fake used in tests and local development.
- No integration is required for the MVP. Writing examples, research notes and
  insights can all be entered by hand, and publishing is assisted manual
  publishing.
- Every integration has a visible health state (`connected`, `error`,
  `revoked`, `disconnected`), the last sync time and the last error.
- Ordinary automated tests make no real Slack, LinkedIn or paid API calls.

---

## 2. AI provider

| Item | Detail |
|---|---|
| Default | Anthropic Claude API via `@anthropic-ai/sdk`, server-side only |
| Models | `claude-opus-5-5` for drafting ($4 / $20 per 1M input/output tokens); `claude-sonnet-5-5` ($2 / $10) or `claude-haiku-5-5` ($0.10 / $0.50 for prompts up to 100K tokens) for extraction and classification **[V, cached 2026-10-06]** |
| Features used | Structured outputs (`output_config.format`), prompt caching, token counting for cost estimates, optional Message Batches (about 50% cost, asynchronous) **[V]** |
| Behaviors to handle | `stop_reason` values `refusal` and `max_tokens`. On Opus 5.5, thinking cannot be disabled; effort (`low` to `max`, default `medium`) is the depth control. Forced `tool_choice` is rejected on current models, so use structured outputs instead **[V]** |
| Data handling | Check the organization's data-retention terms before sending Slack-derived text (D-10) |
| Fallback | A second provider can be added behind `LlmProvider`. If the API is down, generation jobs queue and retry; the rest of the app keeps working |
| Cost | ARCHITECTURE §10; tens of dollars a month at the expected volume **[A]** |

Pricing source to re-check: https://platform.claude.com/docs/en/about-claude/pricing

---

## 3. Research provider

### 3.1 Requirements

- Search the web for a query and return each result's URL, title and snippet,
  plus a publication date when the provider has one.
- Fetch a page's text for excerpting (optional).
- Domain allow and block lists (e.g. prefer associations, regulators and
  trade publications; block content farms and competitors' marketing pages
  as *sources of fact*).
- Return results in a form we store as `research_sources` and
  `research_findings`, with provenance.

### 3.2 Candidates (all [S]: from official pricing and doc pages via search summaries)

| Provider | Headline price | Dates in results | Notes |
|---|---|---|---|
| Claude web search tool (`web_search_20260209`) | $10 per 1,000 searches plus tokens for the results; failed searches not billed | `page_age` per result | Results come back inside the model call, with citations (URL, title, cited text). Tool type and domain filters **[V]**; price and fields **[S]**. Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool |
| Brave Search API | $5 per 1,000 requests, $5 of free credit per month | `page_age`, `age` | Plain search API. We control fetching and excerpting. https://api-dashboard.search.brave.com/documentation/pricing |
| Exa | $4–7 per 1,000 searches; contents $1 per 1,000 pages | Supports published-date filters; response field not confirmed | Good at semantic, recent-content search. https://exa.ai/docs/reference/pricing |
| Tavily | About $0.008 per credit (basic search = 1 credit, advanced = 2); 1,000 free credits per month | Not confirmed | Built for LLM use. https://docs.tavily.com/documentation/api-credits |
| Perplexity Sonar / Search API | Search API $5 per 1,000; Sonar charges per request plus tokens | `date`, `last_updated` | Returns synthesized answers. We would still store and verify each source. https://docs.perplexity.ai/docs/getting-started/pricing |

### 3.3 Recommendation [A]

Start with the **Claude web search tool**, with `allowed_domains` or
`blocked_domains` set per brief. It adds no new vendor, and its citations map
directly to stored sources.

Keep **Brave Search** as the drop-in second implementation. With Brave, search
is separated from the model, so we fetch and excerpt pages ourselves. That
gives tighter control over what text reaches a model.

The choice is D-06, and it can change later without schema changes.

### 3.4 Research pipeline

1. The admin, or concept generation, proposes queries from the brief and the
   concept's evidence requirements.
2. The provider returns results. We store the source metadata (URL, title,
   publisher, `published_at` if given, `retrieved_at` = now) and a short
   excerpt.
3. A **tool-less** extraction call turns each excerpt into findings: claim,
   data point, event date and any verbatim quote. Validation rejects quotes and
   numbers that are not in the excerpt, and any URL the provider did not
   return (SECURITY §6).
4. The admin reviews sources and findings and sets `human_verified`,
   `disputed` or `rejected`. Conflicting findings are linked.
5. Drafts cite findings, and claims without one are flagged.

**Limitations [A]:**

- Paywalled trade publications return snippets only.
- Publication dates are often missing or wrong. When that happens we store
  `published_at_precision = 'unknown'` and flag the source.
- Search results change over time, so we keep the excerpt we relied on.

We store excerpts, not full articles. Posts must be original commentary, never
republished articles.

---

## 4. Slack (Phase 6)

### 4.1 Purpose

A source of **ideas and authentic founder perspective** from channels the admin
selects. It is not a source of publishable text, and not a workspace-wide
ingest.

### 4.2 App type and scopes [S]

- **Internal, single-workspace ("undistributed") app.** It is installed only
  in Autograff's workspace and does not need Marketplace review.
  https://docs.slack.dev/app-management/distribution/
- **Bot token** recommended. A bot reads only conversations it is a member of
  and otherwise gets `not_in_channel`. Channel membership is therefore the
  allow-list mechanism: a private channel requires someone to invite the bot.
  https://docs.slack.dev/reference/methods/conversations.history/
- Minimum bot scopes:

  | Scope | Purpose |
  |---|---|
  | `channels:read` | List public channels for the picker |
  | `channels:history` | Read messages in public channels the bot is in |
  | `groups:read`, `groups:history` | **Only if** private channels are approved (decision in Phase 6) |
  | `users:read` | Map Slack users to founders (scope taken from the legacy scopes page; confirm) |
  | `channels:join` | Optional; lets the app join an enabled public channel itself. Otherwise an admin invites the bot |
  | `chat.getPermalink` | Reportedly needs no scope |

- **Not requested:** `im:*`, `mpim:*`, any `*:write`, `search:read`, user
  tokens, `files:read` (unless later justified).
- **Conflict to resolve:** search summaries disagreed on whether bot tokens can
  call `conversations.replies` on public and private channels. The current page
  reportedly lists the `channels:history` and `groups:history` scopes for bots.
  **This must be tested with a real installation before Phase 6 is planned in
  detail.** https://docs.slack.dev/reference/methods/conversations.replies/
- Workspace owners may require **admin approval for app installs**. Who
  approves the installation in Autograff's workspace is an open question.
  https://slack.com/help/articles/222386767-Manage-app-installation-settings-for-your-workspace

### 4.3 Rate limits [S]

- From 2025-05-29, `conversations.history` and `conversations.replies` were cut
  to **1 request per minute with up to 15 messages** for *new commercially
  distributed, non-Marketplace apps*.
- A 2025-06-03 clarification says **internal, customer-built apps keep their
  existing (Tier 3) limits**.
- Studio should qualify as internal. Confirm the definition before building,
  because the 1-per-minute limit would make thread retrieval impractically
  slow.

Sources:

- https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/
- https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity/

### 4.4 Data terms [S]: legal review recommended

- The Slack API Terms (effective 2025-10-10, per the summary) restrict using API
  data to train LLMs and restrict bulk export for apps offered outside the
  developer's own organization. https://slack.com/terms-of-service/api
- The App Developer Policy reportedly forbids LLM training on Slack data.
  https://api.slack.com/developer-policy-updated
- Studio does **not** train models. It sends selected message excerpts to an
  LLM at runtime for extraction. Whether that is permitted for an internal app,
  and what storage limits apply, was **not confirmed**. Someone must read both
  documents in full before Phase 6 (D-17).

### 4.5 Sync design [A]

- **Manual "sync now"** plus a scheduled sync (e.g. daily) per enabled channel.
  Each channel uses a `oldest` cursor, and the first sync looks back a bounded
  window (default 30 days).
- Events API (`message.channels`, `message_changed`, `message_deleted` [S]) is
  optional later. Polling is simpler and enough for idea mining. On a
  `message_deleted` event, or when a message is missing on refetch, the stored
  text is purged and any insight sourced from it is flagged.
- Threads are fetched only for messages that pass the pre-filter and look
  relevant, which keeps API calls low.
- Pipeline:
  1. fetch;
  2. deterministic sensitivity pre-filter (drop secrets and PII patterns);
  3. tool-less extraction into candidate insights, with sensitivity
     classification;
  4. admin review (approve, exclude, edit);
  5. approved insights become available to concept generation.
- Provenance stored per insight: channel, `ts`, permalink, author. A
  permalink opens in Slack, where Slack's own permissions apply.
- Token handling, revocation, retention and deletion: SECURITY §5, §7 and §9.
- Health: last sync, messages scanned, messages dropped by filter, insights
  proposed, last error (`not_in_channel`, `missing_scope`, `ratelimited`,
  `invalid_auth`, `token_revoked`).

### 4.6 Fallback

There is no Slack dependency for the MVP. Admins add **manual insights**
(meeting notes, founder voice memos transcribed by hand, pasted excerpts with
the founder's consent). They follow the same review flow.

### 4.7 Open questions

1. Does Autograff's workspace require app-install approval, and who approves
   it?
2. Which channels may be read? Should private channels be read at all?
3. Do the Slack API Terms allow runtime LLM processing for this internal app?
4. Does the app qualify for internal-app rate limits?
5. Can bot tokens call `conversations.replies` (test it)?
6. Is token rotation worth enabling?

---

## 5. LinkedIn (Phase 10, and not promised)

### 5.1 What appears possible [S]

| Capability | Product / permission | Access | Source |
|---|---|---|---|
| Sign in and get a member's Person URN | Sign In with LinkedIn using OpenID Connect (`openid`, `profile`, `email`) | Self-serve | https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2 |
| Post as a member | Share on LinkedIn: `w_member_social` | Self-serve, "available to all developers" | https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin, https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access |
| API for posting | Posts API `POST https://api.linkedin.com/rest/posts`, headers `Linkedin-Version: YYYYMM` and `X-Restli-Protocol-Version: 2.0.0`; replaces ugcPosts | — | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api |
| Analytics for a member's own posts | `memberCreatorPostAnalytics` with `r_member_postAnalytics` (Community Management API, version 202506+): impressions, members reached, reactions, comments, reshares and more, per post or aggregated, "best-effort" | **Vetted**: registered legal organization, verified Company Page, app review; Development tier limited; Community Management must be the only product on its app | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics, https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review |
| Read a member's posts | `r_member_social` | **Closed**: "not accepting access requests" | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/social-metadata-api |

### 5.2 Constraints [S]

- **Token lifetime.** Access tokens last 60 days. Programmatic refresh tokens
  are for approved Marketing Developer Platform partners, so each founder will
  probably need to re-authorize about every 60 days.
  https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
- **No scheduling field.** Create accepts `lifecycleState: PUBLISHED`, so
  Studio would hold the post and call the API at the scheduled time.
- **No idempotency key was found.** Duplicate detection is not guaranteed.
  Studio must prevent double-posting itself: one publication per draft, and
  `unknown` outcomes need manual reconciliation.
- **Rate limits.** Per-app and per-member daily limits are not published; they
  show in the developer portal.
  https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits
- **Terms that bear directly on this product:**
  - The API Terms of Use (snippet possibly stale) prohibit using the APIs "to
    automate posting on the LinkedIn Services."
    https://www.linkedin.com/legal/l/api-terms-of-use
  - The LinkedIn Developer AI Policy says to restrict automated posting of
    AI-generated content without the end user's involvement, and to let the
    user edit content before it is posted.
    https://learn.microsoft.com/en-us/linkedin/marketing/developer-ai-policy
  - **Interpretation [A]:** a founder-reviewed, founder-approved post published
    at the founder's explicit instruction may be acceptable. A cron job
    publishing at a scheduled time might count as "automated posting." This
    needs a legal or terms review (D-18) **before** any Phase 10 work. The
    safest reading is "publish now, confirmed by the founder or admin in the
    UI," not unattended scheduled posting.
- **Version sunset.** Versions are sunset regularly (e.g. 202510 on
  2026-10-15). Version pinning needs maintenance.
  https://learn.microsoft.com/en-us/linkedin/marketing/integrations/recent-changes

### 5.3 Proposed approach [A]

1. **MVP:** assisted manual publishing (PRODUCT_SPEC §8.2). This works
   regardless of anything below.
2. **Phase 10a, verify:**
   - read the API Terms and the AI Policy in full;
   - create a LinkedIn developer app under the Autograff Company Page;
   - add Share on LinkedIn and Sign In with LinkedIn;
   - with one founder's test consent, post to a test-visibility audience if
     possible (otherwise one real, approved post);
   - confirm token lifetime and refresh behavior.
3. **Phase 10b, publish:** "Publish now" from the approved post, with
   per-founder OAuth and the gates in SECURITY §11. Store the returned post
   URN and URL.
4. **Phase 10c, analytics:** apply for Community Management API access
   (separate app). If granted, pull `memberCreatorPostAnalytics`. If not,
   metrics stay **manual entry**.

### 5.4 Fallbacks

- Manual publishing and manual metrics entry are permanent fallbacks, not
  temporary ones.
- If the API is unavailable, tokens have expired or a publish fails, the post
  stays `scheduled` and the admin is shown "publish manually."

### 5.5 Open questions

1. Do LinkedIn's terms allow publishing AI-assisted, human-approved posts via
   the API? Do they allow it at a scheduled time?
2. Is Autograff able (and willing) to go through Community Management vetting
   for analytics?
3. Will each founder accept a 60-day re-consent cycle?
4. Are any founders' accounts unusual (Creator mode, restricted, Premium) in
   ways that change API behavior?

---

## 6. Email (auth only)

Custom SMTP is required for invites and sign-in emails. Supabase's default
sender only delivers to project-organization members, at about 2 emails/hour
[S]. https://supabase.com/docs/guides/auth/auth-smtp

Any transactional provider works. It needs a sending domain with SPF, DKIM and
DMARC on `autograff.ai` (or a subdomain). A free tier is enough for the volume (D-04, D-21); the provider is chosen in Phase 1.

---

## 7. Future: embeddings (optional)

Not in the MVP (D-07). If repetition detection proves too weak, add an
`EmbeddingProvider` (e.g. Voyage AI or OpenAI embeddings) and `pgvector`
columns [S: available as a Supabase extension]. The schema leaves room for it.

---

## 8. Verification checklist (before each dependent phase)

Each item should be checked against the official page, with the date and the
person who checked it recorded in DECISIONS.md.

| # | Fact to verify | Needed before | Source |
|---|---|---|---|
| 1 | Adding a project to the existing Vercel Pro team adds no plan cost at this usage | Phase 1 deploy | https://vercel.com/docs/limits/fair-use-guidelines, https://vercel.com/pricing |
| 2 | Deployment Protection on previews (Vercel Authentication) on our plan | Phase 1 deploy | https://vercel.com/docs/deployment-protection |
| 3 | Subdomain CNAME target and TLS behavior; DNS host for autograff.ai | Go-live | https://vercel.com/docs/domains/set-up-custom-domain |
| 4 | Pro function max duration and cron frequency | Phase 4 | https://vercel.com/docs/functions/limitations, https://vercel.com/docs/cron-jobs/usage-and-pricing |
| 5 | Supabase signup disable, invite API, redirect wildcard syntax | Phase 1 | https://supabase.com/docs/guides/auth/general-configuration, https://supabase.com/docs/guides/auth/redirect-urls |
| 6 | Supabase new API keys (`sb_publishable_`, `sb_secret_`) and legacy deprecation timing | Phase 1 | https://supabase.com/docs/guides/getting-started/api-keys |
| 7 | Supabase production price (new org vs project in an existing paid org); backups per plan; Free pausing | Phase 1 | https://supabase.com/docs/guides/platform/backups |
| 8 | Supabase custom SMTP and auth email rate limits | Phase 1 | https://supabase.com/docs/guides/auth/auth-smtp |
| 9 | Supabase Vault usage from SQL functions | Phase 6 | https://supabase.com/docs/guides/database/vault |
| 10 | Anthropic model prices and web search price | Phase 4 / 5 | https://platform.claude.com/docs/en/about-claude/pricing |
| 11 | Research provider fields (published date) and price, for whichever is chosen | Phase 5 | §3.2 links |
| 12 | Slack scopes; bot access to `conversations.replies`; internal-app rate limits; API Terms on LLM processing | Phase 6 | §4 links |
| 13 | LinkedIn API Terms and AI policy on API publishing; token refresh; Community Management eligibility | Phase 10 | §5 links |
