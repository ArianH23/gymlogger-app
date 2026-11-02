# CI/CD: automatic checks and deploys

The picture is `docs/cicd.png` (redraw with `python scripts/draw_cicd.py`). The files are in `.github/workflows/`.

## What runs when

| What | When | Does |
|---|---|---|
| **CI** (`ci.yml`) | every push and pull request | database tests (240 checks on a temporary database), phone app (type-check, lint, build), importer tests, watch app compiles. Deploys nothing. Needs no secrets |
| **Deploy the site** (last job of `ci.yml`) | a push to `main`, all four checks green, and `DEPLOY_ENABLED` = `true` | first checks that production's database has no migration waiting (if it has, it stops with a message), then builds the phone app for production and deploys it to Cloudflare |
| **Update database** (`update-database.yml`) | only when you click it | "apply" **unticked**: dry run, shows the SQL of every migration that would run, changes nothing. "apply" **ticked**: refuses unless it runs on `main` and the four checks for that exact commit are green, then applies the migrations and deploys the `watch-pair` function |
| **Watch app** | never in GitHub | built on your PC (`watch/build.ps1 assembleRelease`) and installed over Wi-Fi with `adb`. GitHub cannot reach your watch, and an app built by GitHub is signed with a different key, so Android would refuse to update over yours |

Why the database is by hand: a migration cannot be undone and the tests never see your real data. The site check keeps "database first, site second" without you remembering it.

## The secrets and variables (set them in GitHub, never in the chat)

Repo, **Settings, Secrets and variables, Actions**. Names are case-sensitive.

**Secrets** (tab *Secrets*, New repository secret):

| Name | What it is | Where you get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | lets GitHub deploy your site | Cloudflare, steps below |
| `CLOUDFLARE_ACCOUNT_ID` | which Cloudflare account | Cloudflare, steps below |
| `SUPABASE_ACCESS_TOKEN` | lets GitHub check and update your database | Supabase, steps below |

**Variables** (tab *Variables*, New repository variable). These are public values, not secrets:

| Name | Value | Where |
|---|---|---|
| `SUPABASE_PROJECT_REF` | `<your-project-ref>` | the project reference you already know |
| `VITE_SUPABASE_URL` | the project address, `https://<ref>.supabase.co` | the line `VITE_SUPABASE_URL` in `web/.env.local` on your PC |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_...` key | the line `VITE_SUPABASE_PUBLISHABLE_KEY` in `web/.env.local` |
| `DEPLOY_ENABLED` | `true` | the switch: set it last; set it to anything else to pause automatic deploys |

### Cloudflare account ID
Log in at dash.cloudflare.com. After the login the address bar reads `dash.cloudflare.com/<a long code>/...`: that code is the account ID. It is also in **Workers & Pages**, on the right, under *Account ID*.

### Cloudflare API token
1. dash.cloudflare.com, top right profile picture, **My Profile**, **API Tokens**, **Create Token**.
2. Next to the **Edit Cloudflare Workers** template click **Use template**.
3. Under *Account Resources* keep **Include** and pick your account. Under *Zone Resources* you may leave the default.
4. **Continue to summary**, **Create Token**, and copy the token now: Cloudflare shows it once. If you lose it, create another and delete the old one.

### Supabase access token
1. supabase.com/dashboard/account/tokens (profile picture, **Access Tokens**), **Generate new token**.
2. Name it `github-actions-gymlogger`. If the page offers an expiry or a narrower scope, choose the narrowest that still works.
3. Copy it now (it starts with `sbp_`); Supabase shows it once.
4. Be aware: this kind of token can manage all your Supabase projects. That is why it lives only as a GitHub secret. If it ever leaks, delete it on the same page.

No database password is needed: the Supabase tool signs in with the access token alone (as your own `db push` did).

## Turning it on, in this order
1. **Push the workflow files.** CI starts running right away and needs nothing. The deploy job is skipped because `DEPLOY_ENABLED` is not set yet.
2. **Add the three secrets and the three public variables.** Do not set `DEPLOY_ENABLED` yet.
3. **Try the safe button:** Actions, **Update database**, Run workflow, branch `main`, leave "apply" unticked. It only shows what is waiting (nothing right now) and proves the Supabase token works.
4. **Set `DEPLOY_ENABLED` to `true`**, then push a small change (for example a comment in the README) and watch the site job deploy.

## Everyday use
- Push code: CI runs; if green, the site updates itself a few minutes later.
- Changed the database (a new file in `supabase/migrations/`): push it, wait for green. The site job stops with "Database changes are waiting". Run **Update database** unticked, read the SQL on the run's *Summary* page, run it again **ticked**, then on the stopped CI run click **Re-run failed jobs**.
- Watch app: build and install on your PC as before; CI only checks that it compiles.

## If something fails
- **Site job red, "Database changes are waiting":** that is the safety check, not a bug. Do the database steps above.
- **Watch job red:** open the run, the failing step shows the error. A missing Android SDK piece is the likeliest cause; paste the error to me.
- **Update database red at "Require green checks":** the checks for that commit are still running or failed. Wait or fix, then run again.
- **Pause everything automatic:** set `DEPLOY_ENABLED` to `false`. **Revoke access:** delete the Cloudflare token or the Supabase token on their own pages.

## What was and was not tested before the first run
Tested here: the YAML is valid, and every check was run from a fresh clone of the repository (phone app, importer, watch app build, database tests). Not testable here: the GitHub-only steps (installing the Supabase tool, the Android SDK setup, the deploy commands against your accounts). The first run on GitHub may need a small fix; send me the error.
