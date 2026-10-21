# Phase 3 report: founder voice and writing library

Date: 2026-10-21. Scope:
[PHASES.md, Phase 3](../PHASES.md#phase-3-founder-voice-and-writing-library).
Built and tested locally. It reaches staging when the pull request is merged:
the migration is applied by the "Migrate staging database" workflow, and
Vercel deploys the app.

## What was built

| Area | Where |
|---|---|
| Database: `voice_profiles`, immutable `voice_profile_versions`, `writing_examples` (deduplicated per founder, https-only links, evaluation hold-out), `feedback_signals` with constraints on what can change a profile. RLS on every table; all writes through audited functions | `supabase/migrations/20261021000003_voice_library.sql` |
| Voice profile shape, form parsing, plain-language summary and version diff | `lib/domain/voice.ts` |
| Post formats (one list, matching the database enum) | `lib/domain/formats.ts` |
| Bulk paste of LinkedIn posts (`---` separated, optional `URL:` and `Date:` lines) and tag cleanup | `lib/domain/examples.ts` |
| Retrieval: deterministic ranking of a founder's approved, non-held-out examples | `lib/domain/retrieval.ts` |
| Prompt builder for the voice part of generation (profile plus retrieved examples), for Phase 4 | `lib/prompts/voice-context.v1.ts` |
| Admin, **Voice**: every founder's profile version, example counts and feedback waiting | `app/admin/voice/` |
| Admin, voice profile editor with version history, diff, and applying feedback | `app/admin/voice/[founderId]/` |
| Admin, writing examples: add one, paste many, approve, hold out, set format and topics, delete; and a preview of which examples generation would use | `app/admin/voice/[founderId]/examples/` |
| Admin, **Feedback**: add feedback; reject; accept one-off or editorial feedback; apply stable or format preferences to the profile | `app/admin/feedback/` |
| Founder, **Your voice**: their profile and examples, read-only; share a piece of their own writing | `app/voice/` |
| Local seed: a CEO profile, examples (one held out, one not approved), a COO example, two feedback signals | `supabase/seed.sql` |
| Retrieval fixture explanations | `tests/fixtures/retrieval/README.md` |

## Test results (final run, 2026-10-21)

| Command | Result |
|---|---|
| `npm run check` (typegen + typecheck, ESLint + public-env check, Prettier, Vitest) | pass; **85/85** unit tests (61 before, 24 new) |
| `npm run test:db` (reset, pgTAP, then SQL/TypeScript parity) | pgTAP **208/208** (141 before, 67 new); parity **1/1** |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` | **22/22** (17 before, 5 new) |
| `npm run build` | pass; every route renders per request |
| `npm audit --omit=dev` | 0 vulnerabilities |

Two of my own test expectations were wrong on the first run and were
corrected. The code was not changed for either.

- pgTAP expected 7 audit events; the right count is 6 (three versions, one
  added signal, one accepted, one rejected).
- An e2e check that v1 doesn't mention "synergy" also matched v2's change
  reason in the history sidebar. The reason was reworded.

### Phase 3 acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | The admin creates and edits a profile; every save creates a version | e2e "editing a voice profile creates a new version…"; pgTAP: first save creates v1, later saves v(n+1), a reason is required, earlier versions unchanged |
| 2 | A founder reads their own profile and examples, not other founders' | e2e "a founder reads their own voice…", including through the API with their own token; pgTAP founder A vs B, anonymous, deactivated founder |
| 3 | Retrieval returns only that founder's `approved_for_voice` examples, in the specified order | unit tests in `retrieval.test.ts` (fixtures in `tests/fixtures/retrieval/README.md`); e2e "retrieval uses only the founder's approved examples, never held-out ones" |
| 4 | Accepting a signal needs an admin action and records the profile version it produced | e2e "a stable preference is accepted only by applying it…"; pgTAP: the signal links to the new version and the admin who accepted it |

### Named tests from PHASES.md

| Test | Where |
|---|---|
| Retrieval ranking on fixtures | `lib/domain/retrieval.test.ts` |
| Version immutability | pgTAP: no update or delete even for the table owner; admin cannot write versions directly |
| RLS | pgTAP: anonymous, founder A vs B, founder cannot read signals, admin without MFA, deactivated founder |
| `one_off` and `editorial_correction` can never be applied to a voice profile | pgTAP: the function refuses; the database constraint refuses even the table owner |
| Prompt builder includes the profile and the retrieved examples, never a held-out one | `lib/prompts/voice-context.v1.test.ts` |

## Decisions

- **D-25:** retrieval is pure TypeScript with a published scoring rule; the
  database limits what can be retrieved.
- **D-26:**
  - each founder's style rules live on their voice profile (this settles
    D-15);
  - one list of post formats;
  - founder-shared examples count as approved;
  - how feedback is accepted;
  - the evaluation hold-out.

## Not done, and why

- **`npm run eval:voice`** (model scoring of voice match) and the optional
  **"draft a profile from examples"** AI action. Both need the LLM provider,
  which Phase 4 builds. The evaluation set they will use is in place: examples
  marked "held out for evaluation".
- **Real examples on staging** (the definition of done). This needs each
  founder's consent (assumption A-6). It is a step for you after merging; see
  below.
- **System-proposed feedback** comes in Phase 7, as planned.

## After merging: staging steps

1. Check that the "Migrate staging database" workflow run on `main` is green.
2. **Voice**: open a founder and write their first profile. Include the style
   rules you agree with them, such as "No em-dashes".
3. With the founder's consent, open **Writing examples** and paste their
   LinkedIn posts. Mark a few good ones as "Held out for evaluation" (5–10
   per founder) so Phase 4 can check drafts against them.
4. Use "Which examples would the AI see?" to check the matches look right.
