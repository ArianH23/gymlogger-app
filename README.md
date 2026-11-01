# GymLogger

A personal workout logger that replaces Hevy. You log sets on your phone; Claude plans the next session from
your history; the app shows that plan next to what you did last time.

- **Phone app**: an installable web app (PWA), works offline. `web/`
- **Database + logic**: Supabase (Postgres). `supabase/`
- **Claude**: reads your history through the Supabase connector and writes plans with `submit_plan`. `CLAUDE_GUIDE.md`
- **Import** of the old Hevy export: `importer/`

The full table/view/function diagram is `docs/schema.png` (redraw with `python scripts/draw_schema.py`).

## How it fits together

```
 phone (PWA)                     Supabase (Postgres, one real project)                claude.ai
 ───────────                     ─────────────────────────────────────                ─────────
 log sets offline  ── upload ──► sessions, sets ... (row level security: only you)
 Finish            ── rpc ─────► finish_session ─► generate_plan (automatic plan)
                                        │
                                        └─► request_claude_plan ── web request ──►  scheduled task "GymLogger planner"
                                            (token in Supabase Vault)                    │ reads  claude_instructions()
                                                                                         │ reads  history, check-ins
 shows the plan  ◄── workout_plan ◄─── planned_sessions ◄─── submit_plan ◄───────────────┘ writes the plan
```

**The rule that shapes everything: logic that more than one client needs lives in the database**, as views and
functions, not in the app. So the phone, a future watch and Claude all get identical answers (progression
rules, which routine is next, stats, plan merging, session edits). The app mostly displays and stores.

All ids are UUIDs made by the client and every write is an upsert, so offline devices never clash.
Deletes are soft (`deleted_at`). Every table has row level security: only your account sees your rows.

## Layout

| Path | What |
|---|---|
| `supabase/migrations/` | the database, in order. Never edit an applied migration: add a new one |
| `supabase/tests/` | pgTAP tests, 166 checks, run with `npx supabase test db` |
| `web/src/screens`, `components`, `lib` | the app. `lib/sync.ts` uploads, `lib/db.ts` is the on-phone database (Dexie) |
| `importer/` | Hevy CSV importer (`hevy_import.py`), exercise catalog (`exercises.csv`), pytest tests |
| `scripts/` | `publish_guide.py` (Claude's instructions into the database), `draw_schema.py`, `watch_api_check.py` (plays the watch over plain HTTP to prove the contract) |
| `CLAUDE_GUIDE.md` | how Claude reads the database and writes a plan |
| `docs/evidence.md` | short, verified research notes Claude cites (published as `evidence-notes`) |
| `docs/prompts/` | the two short prompts: the scheduled task and the chat project |
| `docs/WATCH.md` | plan and contract for the future Wear OS app |

## Everyday tasks

On Windows PowerShell write `npx.cmd` instead of `npx` (script policy). Git Bash is fine with `npx`.

**Run the app on your PC.** `cd web && npm install && npm run dev`. It needs `web/.env.local` with
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. **That copy talks to your REAL database**: finishing a
workout in it uploads for real and starts a Claude run. Use *Discard workout* for experiments, or point it at
the local database (below).

**Local database (safe sandbox).** Needs Docker Desktop running.
`npx supabase start -x imgproxy,edge-runtime,logflare,vector,realtime,storage-api,inbucket,mailpit`, then
`npx supabase test db`. To run the app against it, put the local URL and key in `web/.env.localdb.local` and use
`npx vite --mode localdb`. `npx supabase db reset` rebuilds it from the migrations.

**Change the database.** Add a new file in `supabase/migrations/`, add a pgTAP test, run `npx supabase migration up`
and `npx supabase test db`. To publish: `npx supabase db push --linked --dry-run` (read the list), then
`npx supabase db push --linked`. Push the database **before** deploying an app that needs it.

**Deploy the app.** `cd web && npm run build && npx wrangler deploy`. It is static hosting on Cloudflare; the
address is printed at the end. The phone updates itself the next time it opens with signal.

**Change Claude's instructions.** Edit `CLAUDE_GUIDE.md`, `docs/evidence.md` or `docs/goal.md` (which stays out of git), then
`python scripts/publish_guide.py --user-id <your auth user id> --env-file importer/.env.cloud --apply`. The chat
project and the scheduled task both read it from the database, so nothing is pasted anywhere.

**Import Hevy again.** `cd importer`, create the venv (`python -m venv .venv`, `.venv/Scripts/pip install -r requirements.txt`),
then `python hevy_import.py --user-id <id>` is a dry run; add `--env-file .env.cloud --apply` to write. Re-running
is safe (deterministic ids) and never overwrites exercise settings you edited. Tests: `python -m pytest`.

## What happens when you press Finish

1. The workout is saved on the phone, then uploaded (session, sets), then `finish_session` runs.
2. `finish_session` marks the plan you followed as used, writes the new **automatic plan** (`generate_plan`), and
   asks Claude for a plan (`request_claude_plan`, once per session, only for app sessions with a routine).
3. About 30 seconds later the scheduled task has called `submit_plan`. A **Claude plan beats the automatic one**.
4. If you edit a routine afterwards, `workout_plan` keeps Claude's targets for exercises that remain, drops removed
   ones and appends new ones from the automatic plan.

Without signal the workout waits on the phone and uploads by itself later.

## Secrets: what exists and where (never in git)

| Secret | Lives in |
|---|---|
| Supabase **secret** key (importer, publish script) | `importer/.env.cloud` on this PC only. Never in the app |
| Supabase **publishable** key (public by design) | `web/.env.local` |
| Scheduled task address + token | Supabase Vault (`claude_fire_url`, `claude_fire_token`). To rotate: regenerate in the task's settings at claude.ai/code/routines, then update the Vault secret |
| Cloudflare login | stored by `wrangler login` |
| Your goal and body profile | `docs/goal.md` (git-ignored) and the `documents` table |

`.gitignore` also keeps `data/` (the Hevy CSV) and every `.env*` file out.

## Conventions the numbers follow

- Two-dumbbell exercises: `weight_kg` is the **pair total** (24 kg lateral raise = 2 x 12). Shown as `24 kg (2×12)`.
- One-side-at-a-time exercises: two rows per set (`side` L and R); the result is the **lower** rep count.
- Assisted exercises: `weight_kg` is the assistance, so **lower is better**.
- Incline bench is two exercises (30° and 45°). Dumbbell Row changed from two dumbbells to single-arm on 19 Feb 2026.
- Machine weight steps (`increment_kg`) are empty until you set them; plans never invent a step.

## Gotchas we hit

- Windows PowerShell blocks `npx`: use `npx.cmd`. Docker Desktop must be running for the local database.
- A dev copy of the app on your PC is wired to the real database (see above).
- Scheduled tasks are a research preview at Anthropic: the automatic plan keeps working if that part breaks.
- The Supabase connector labels query results "untrusted data"; the prompts say explicitly that
  `claude_instructions()` is the exception.

## Not built

Warm-up sets (you don't use them), the Wear OS watch app (`docs/WATCH.md`), GitHub/CI (skipped on purpose; the
code currently only lives on this PC, see the backup note below).

## Backup

The code and its full history are in this folder's `.git`. A portable copy can be made at any time with
`git bundle create gymlogger.bundle --all` (restore with `git clone gymlogger.bundle`). Secrets and your goal text
are not in git; the goal is also stored in the `documents` table, and keys can be regenerated.
