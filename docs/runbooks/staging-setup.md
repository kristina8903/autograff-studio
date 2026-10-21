# Staging setup: Vercel + Supabase (free)

Goal: a private, clickable copy of Content Studio for the admin to try. It uses
**staging data only**, and adds no new monthly cost: the existing Vercel Pro
team plus a Supabase Free project (D-21).

Until go-live, the Vercel project's own `*.vercel.app` address **is** staging.
At go-live, production gets its own Supabase project and the
`studio.autograff.ai` domain (ARCHITECTURE §7).

Facts marked [S] about vendor dashboards are unverified. Menus move, so look
for the named setting rather than an exact path.

Time: about 45 minutes. Do the steps in order; later steps need values from
earlier ones.

---

## 0. Merge the Phase 1 pull request

Vercel deploys `main`, and `main` has no app until PR #1 is merged. CI must be
green first.

## 1. Create the staging Supabase project

1. At supabase.com, sign in with your **@autograff.ai** address. Create a new
   organization for Studio on the **Free** plan. Do not use the organization
   or project that runs the marketing-site pipeline (D-02).
2. Create a project named `autograff-studio-staging` in a US region. Save the
   database password in your password manager; step 4 needs it.
3. From the project settings, note these values:
   - **Project ref**: the short id in the project URL.
   - **Project URL**: `https://<ref>.supabase.co`.
   - **API keys**: the *publishable* key (`sb_publishable_…`) and the *secret*
     key (`sb_secret_…`) [S]. The secret key never goes anywhere except
     Vercel's encrypted settings.

## 2. Create the Vercel project

1. In Autograff's existing Vercel Pro team: **Add New → Project → Import**
   `kristina8903/autograff-studio`. If the repository is not listed, give the
   Vercel GitHub app access to it when Vercel asks.
   - The project must live in the **Pro team**, never a personal Hobby
     account: Hobby is for non-commercial use only [S].
   - If your team role can't create projects, either ask the team owner to
     change your role, or create the project in your Hobby account and move it
     with Project → Settings → General → **Transfer** (done this way on
     2026-10-21). Environment variables and the Git connection move with it.
2. Framework: `vercel.json` pins it to Next.js. If the project was created
   before `main` had the app, the dashboard may still say "Other"; the file
   overrides that (without it, builds fail with `No Output Directory named
   "public"`). Leave the build, output and install settings at their defaults.
   The build succeeds without the environment variables. The site then shows
   an error until they are set, because the app refuses to run unconfigured.
3. Add these **Environment Variables**, for both Production and Preview:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_APP_URL` | the project's address, e.g. `https://autograff-studio.vercel.app` (if you don't know it yet, fix it after the first deploy and redeploy) |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_…` key |
   | `SUPABASE_SECRET_KEY` | the `sb_secret_…` key. Mark it **Sensitive/Secret** |
   | `APP_ENV` | `staging` |

4. Deploy. Note the exact production address Vercel assigns (Project →
   Domains). If it differs from what you entered for `NEXT_PUBLIC_APP_URL`,
   correct the variable and redeploy.
5. **Settings → Deployment Protection**: turn on **Vercel Authentication**.
   Choose **All Deployments** if your plan offers it [S]. Only people in the
   Vercel team can then open the site, on top of the app's own sign-in.

## 3. Auth settings in the Supabase dashboard

These mirror `supabase/config.toml`, which the local stack uses. Under
**Authentication**:

- **URL configuration**:
  - Site URL: the Vercel address from step 2.
  - Redirect URLs: add `<Vercel address>/**`.
  - For pull-request previews, also add `https://*-<vercel-team-slug>.vercel.app/**` [S].
- **Sign up**: turn **off** "Allow new users to sign up". Leave the **Email**
  provider **enabled**. Turning email off blocks all sign-in, not just sign-up.
- **Multi-factor**: enable **TOTP (authenticator app)**.
  - It is unverified whether the Free plan allows TOTP [S]. If the option is
    missing or locked, stop and tell me: admins cannot sign in without it.
- **Email templates** (copy the HTML from the repo):

  | Template | Subject | Body |
  |---|---|---|
  | Invite user | `You have been invited to Autograff Content Studio` | `supabase/templates/invite.html` |
  | Magic link | `Your Autograff Content Studio sign-in code` | `supabase/templates/magic_link.html` |

- **Email OTP length** (Sign In / Providers → Email): set it to **6**. The
  app accepts 6–8 digits, but 6 matches the local stack and the email text.
- **Free plan: templates need your own email sender.** New Free projects
  cannot edit email templates until custom SMTP is set up (verified
  2026-10-21). The default templates send links the app deliberately does not
  accept, so set up SMTP (below) **before** the first sign-in or invite.
- **Emails / SMTP**: on Free, required (see above). On other plans you could
  leave the default sender for now.
  - It only delivers to members of your Supabase organization, about 2 emails
    an hour [S].
  - Set up as done on 2026-10-21. In Resend, add the domain
    `studio.autograff.ai`, add its DNS records, and create a *Sending access*
    API key limited to that domain. Then in Supabase use host
    `smtp.resend.com`, port `465`, username `resend`, the API key as password,
    and sender `no-reply@studio.autograff.ai`.

## 4. Create the database tables (GitHub workflow)

In GitHub: **kristina8903/autograff-studio → Settings → Secrets and variables
→ Actions**.

1. **Variables** tab → New variable: `SUPABASE_STAGING_PROJECT_REF` = the
   project ref.
2. **Secrets** tab → New secret:
   - `SUPABASE_ACCESS_TOKEN`: create one at supabase.com → Account →
     Access Tokens. Name it `github-staging-migrations`.
   - `SUPABASE_STAGING_DB_PASSWORD`: the database password from step 1.
3. **Actions → Migrate staging database → Run workflow** (on `main`). It should
   finish green.

From now on, any merged change to `supabase/migrations/` is applied to staging
automatically.

## 5. Auth hook (after step 4)

Under **Authentication → Hooks**, enable **Before User Created** [S]:

- Type: Postgres function.
- Schema: `private`.
- Function: `before_user_created`.

If hooks are unavailable on the Free plan, skip this step. The database
trigger on `auth.users` enforces the same `@autograff.ai` rule anyway.

## 6. Make yourself the first admin

In the Supabase **SQL Editor**, run the following. Replace the placeholder with
your own address. This is data, not schema, so it does not belong in a
migration.

```sql
-- 6a. The company and its allowed email domain (run once).
insert into public.companies (name, slug) values ('Autograff', 'autograff');
insert into public.settings (company_id, allowed_email_domains)
select id, '{autograff.ai}' from public.companies where slug = 'autograff';
```

Next, invite yourself: **Authentication → Users → Invite user**, with your
@autograff.ai address. **Don't open the email yet.** Run step 6b first:

```sql
-- 6b. Give your new login the admin role.
insert into public.profiles (user_id, company_id, role, status, email)
select u.id, c.id, 'admin', 'invited', lower(u.email)
from auth.users u cross join public.companies c
where lower(u.email) = lower('YOUR_EMAIL@autograff.ai') and c.slug = 'autograff';
```

It should report `INSERT 0 1`. If it says `0 0`, the address doesn't match the
one you invited.

## 7. First sign-in

1. Open the invitation email and click **Accept the invitation**.
2. On the page that opens, press **Continue to Content Studio**.
3. Set up your authenticator app when asked; you land on **Founders & team**.
4. Later sign-ins: open `/sign-in`, enter your email, then the 6-digit email
   code, then the authenticator code.

## Afterwards

- **Before inviting founders:** set up custom SMTP (end of step 3). Then add
  founder records in the app and invite them from each founder's page.
- **Founders and Vercel Authentication:** founders don't have Vercel accounts,
  so Vercel Authentication on all deployments would block them. When you want
  founders to try staging, switch protection to previews only. The app's own
  sign-in then protects the main address, and staging holds no real data.
- **Free-plan pausing:** a Free project pauses after about 7 days without
  activity [S]. Resume it from the Supabase dashboard; nothing is lost.
- **Not yet done:** the restore drill from the Phase 1 definition of done. It
  needs this project to exist.
