# GymLogger

A personal workout logger that replaces Hevy. You log sets on your phone or your watch; Claude plans the next session
from your history; the app shows that plan next to what you did last time, and rates how each session went.

- **Phone app**: an installable web app (PWA), works offline. `web/`
- **Watch app**: a native Wear OS app (Kotlin, Compose) for a Pixel Watch. `watch/`
- **Database + logic**: Supabase (Postgres) and one small Edge Function. `supabase/`
- **Claude**: reads your history through the Supabase connector and writes plans with `submit_plan`. `CLAUDE_GUIDE.md`
- **Import** of the old Hevy export: `importer/`

The full table/view/function diagram is `docs/schema.png` (redraw with `python scripts/draw_schema.py`, then render
the SVG to PNG with a headless browser).
The step-by-step flow from tapping Finish to a plan made by Claude is `docs/claude-flow.png` (`scripts/draw_claude_flow.py`).

## How it fits together

```
 phone (PWA)  ─┐                    Supabase (Postgres, one real project)                      claude.ai
               ├─ sync_workout ──►  sessions, sets, live workout ... (row level security: only you)
 watch (Wear) ─┘                                │ Finish
                                                └─► finish_session ─► generate_plan (automatic plan)

 watch pairing: phone makes a code ─► watch-pair function ─► a login

 "Plan with Claude" button ─► request_routine_plan ────────────────────────►  scheduled task "GymLogger planner"
                                                                                                         │ reads  claude_instructions(), history, check-ins
 shows the plan  ◄── workout_plan / workout_start ◄── planned_sessions ◄── submit_plan ◄────────────────┘ writes the plan
```

**The rule that shapes everything: logic that more than one client needs lives in the database**, as views and
functions, not in the app. So the phone, the watch and Claude get identical answers (progression rules, which routine
is next, stats, plan merging, session edits, the session score, merging a workout done on two devices). The apps mostly
display and store.

All ids are UUIDs made by the client and every write is safe to repeat, so offline devices never clash.
Deletes are soft (`deleted_at`). Every table has row level security: only your account sees your rows.

## Layout

| Path | What |
|---|---|
| `supabase/migrations/` | the database, in order (26 files). Never edit an applied migration: add a new one |
| `supabase/tests/` | pgTAP tests, 335 checks, run with `npx supabase test db` |
| `supabase/functions/watch-pair/` | the Edge Function that trades a pairing code for a watch login |
| `web/src/screens`, `components`, `lib` | the phone app. `lib/sync.ts` shares the workout, `lib/db.ts` is the on-phone database (Dexie), `lib/score.ts` the session score |
| `web/public/faces/` | the five tier faces shown for the session tiers (cut by `scripts/cut_faces.py`) |
| `.github/workflows/` | CI (`ci.yml`) and the "Update database" button (`update-database.yml`) |
| `watch/` | the Wear OS app: `data/` (API, models, sync, storage), `ui/` (screens), `AppViewModel.kt`, `RestAlarm.kt`, `OngoingWorkout.kt` |
| `importer/` | Hevy CSV importer (`hevy_import.py`), exercise catalog (`exercises.csv`), pytest tests |
| `scripts/` | `publish_guide.py` (Claude's instructions into the database), `draw_schema.py`, `cut_faces.py`, `md_to_pdf.py`, `watch_pairing_check.py` and `watch_api_check.py` (play the watch over plain HTTP) |
| `CLAUDE_GUIDE.md` | how Claude reads the database and writes a plan |
| `docs/evidence.md` (+ `.pdf`) | short, verified research notes Claude cites (published as `evidence-notes`) |
| `docs/prompts/` | the two short prompts: the scheduled task and the chat project |
| `docs/WATCH.md` | how the watch app works: pairing, the calls it makes, sharing the workout |

## The session score and the faces

Every session that followed a plan gets a score: the share of the **planned sets that were met** (planned reps at the
planned weight or better; sets you didn't log count as not met). One database function, `session_tier`, turns it into a tier:

| Met | Tier | Face |
|---|---|---|
| 90% and up | great | the grin |
| 70-89% | good | calm, eyes closed |
| 50-69% | average | neutral |
| 30-49% | weak | side-eye |
| under 30% | poor | the scowl |

At the end you can also tap a **feeling** from 1 (awful) to 5 (great). Claude reads both next to each other: a high score
with a low feeling means the session cost a lot of recovery; a low score with a high feeling means the plan was too heavy.
Imported Hevy sessions followed no plan, so they have no score. View: `session_scores`.

## Look and feel

The design system ("Dark") lives at the top of `web/src/index.css` as variables: near-black surfaces, jade for actions, gold
only for highlights (next routine, Claude's plans), a type scale, one radius and shadow set. Headings and big numbers use the
Outfit font, bundled with the app (`@fontsource-variable/outfit`) and saved for offline use; body text is the system font. Tab
icons are drawn in `web/src/components/Icons.tsx` (no icon library). Motion (page slide, button press, the tick when a set is
logged) switches off when the phone asks for reduced motion. The chart and figure colours (blue, orange, chart green) are data
colours chosen for colour-blind safety: do not restyle them by eye. The watch uses the same palette (`watch/.../ui/Theme.kt`).
The body figures are drawn in `web/src/lib/shapeGeometry.ts` (silhouette from tape measurements) and
`web/src/lib/muscleFigure.ts` (muscle outlines).

## Body measurements

The Body tab and the check-in form cover what Hevy tracks and more: bodyweight, body fat, waist, neck, shoulders, chest,
abdomen, hips, left and right biceps, forearms, thighs and calves, plus sleep, resting heart rate and the daily averages of
calories, protein and steps. Every number is optional (empty means "not measured"; the form shows your last value as a grey
hint, never filled in for you). Height is stored once (Body tab, "Measurements"). The database calculates shoulders / waist
(your V-taper), waist / height, lean mass and a body fat estimate from the tape (US Navy formula, rough), and shows each
measurement against about four weeks earlier (`body_metrics`, `body_latest`). Claude reads the same views.

**Shape vs target** (Body tab, once your height is set): a front-view figure drawn from your tape measurements, with a target
figure on top, and a table of the gap for each part of the body. The target is a model, not anyone's real numbers: each
measurement as a share of your height (shoulders 72%, waist 44%, thighs 34%...), computed in the database (`shape_defaults()`,
`body_target_values`, `body_shape`). You can set your own target for any measurement (`body_targets`). A part you grow is
closer the nearer you are to it, a part you shrink (waist, abdomen) the other way round, capped at 100%. Wrist and ankle
are stored too, for a future estimate of your natural ceiling.

## Muscles

Every exercise is tagged with the muscles it works, 16 in all (chest, three parts of the shoulder, lats, upper and lower back,
biceps, triceps, forearms, abs, glutes, quads, hamstrings, adductors, calves): main muscles and helping ones (`exercise_muscles`;
the standard tags are in `exercise_muscle_defaults()`, and a new exercise with a catalog name is tagged automatically). A working
set counts 1 for each main muscle and 0.5 for each helping one (warm-ups do not count; a left/right pair is one set). The
database sums that per session, per week and per month (`session_muscles`, `weekly_muscles`, `monthly_muscles`). The phone shows
it as bars plus a front and back figure with the worked muscles painted in: on each session, on the Body tab by week and by
month, and as tags under each exercise (in the workout and on its page).

## Export to Hevy

Body tab, "Export": downloads your workouts as a CSV for Hevy, one row per set. Hevy can only import files in the format of the
Strong app (it cannot read its own export), so that is the format written: `Date, Workout Name, Duration, Exercise Name, Set Order,
Weight, Reps, Distance, Seconds, Notes, Workout Notes, RPE`, weights in kg, dates in local time. The file is built in the database
(`export_hevy_csv`, from the view `hevy_export_rows`). The incline bench angles and the single-arm row go back to Hevy's one
incline bench and one dumbbell row (the angle is kept in the notes), left/right sets are separate rows with the side in the
notes, and warm-ups are left out because the format has no warm-up type. "Logged here" exports only workouts made in this app;
"Everything" also includes the imported Hevy history, which Hevy already has. Hevy does not publish the format and allows one
import at a time, so try a small file first. In Hevy: Profile, Settings, Export & Import Data, Import Data, Import Strong CSV.

## One workout, two devices

The workout in progress lives in the database, so you can start on the watch and carry on on the phone (or the other
way round). One function, `sync_workout`, does all the merging; each device saves everything locally first and sends its
view every few seconds. Rules: one open workout per user; the same set logged on both devices is one row (the newer log
wins); a deleted set stays deleted; finishing runs `finish_session`. Details: `docs/WATCH.md`.

## The watch app

**Pairing (no typing).** Phone: Body tab, **Pair watch**, a 6-digit code (valid 10 minutes, works once). Watch: pick the
digits with the crown or by dragging, tap Pair. The code is checked by the `watch-pair` function and the database
(`claim_watch_pairing`); after 5 wrong guesses every open code is cancelled.

**On the watch.** Routines (Next up first) → exercises → sets → a set editor with a weight wheel and a reps wheel (crown or
drag; the step is the exercise's `increment_kg`, or 2.5 kg). ‹ › step between sets and across exercises; logging moves to
the next empty set; the last set asks whether you are done. Rest timer (tap it for -15 / +15 / Skip / Alarm on-off), vibration
through an Android alarm so it works with the screen asleep, the time and elapsed time at the top, and a "workout going on"
indicator on the watch face that returns you to the app.

**Build and install** (Windows; Android Studio provides Java and the SDK, nothing else to install):

```powershell
cd watch
.\build.ps1 assembleDebug      # talks to the LOCAL database (the emulator reaches your PC at 10.0.2.2)
.\build.ps1 assembleRelease    # talks to your REAL project: needs supabase.cloud.url / supabase.cloud.key in watch/local.properties
```

Outputs: `watch/app/build/outputs/apk/{debug,release}/`. To install on the real watch: Settings → System → About → tap
Build number 7 times; Developer options → ADB debugging and Wireless debugging; "Pair new device" shows an address and code:
`adb pair <address>`, then `adb connect <the other address>`, then `adb -s <address> install -r app-release.apk`. Turn Wireless
debugging off afterwards. Emulator: `emulator -avd watch6 -no-window -no-audio -no-snapshot -gpu swiftshader_indirect`; if a
"Hello" screen covers the app, wake it and start the app again.

## Everyday tasks

On Windows PowerShell write `npx.cmd` instead of `npx` (script policy). Git Bash is fine with `npx`.

**Run the app on your PC.** `cd web && npm install && npm run dev`. It needs `web/.env.local` with
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. **That copy talks to your REAL database**: finishing a
workout in it uploads for real and starts a Claude run. Use *Discard workout* for experiments, or point it at
the local database (below).

**Local database (safe sandbox).** Needs Docker Desktop running.
`npx supabase start -x imgproxy,edge-runtime,logflare,vector,realtime,storage-api,inbucket,mailpit`, then
`npx supabase test db`. To run the app against it, put the local URL and key in `web/.env.localdb.local` and use
`npx vite --mode localdb`. `npx supabase db reset` rebuilds it from the migrations. After adding a migration, apply it
locally with `npx supabase migration up` (the tests do not apply migrations).
For the pairing function locally: `npx supabase functions serve --no-verify-jwt`, then `scripts/watch_pairing_check.py`.

**Change the database.** Add a new file in `supabase/migrations/`, add a pgTAP test, run `npx supabase migration up`
and `npx supabase test db`. To publish: `npx supabase db push --linked --dry-run` (read the list), then
`npx supabase db push --linked`.

**Release order when several parts change.** Database first, then the function, then the site, then the watch:
1. `npx supabase db push --linked` (after the dry run)
2. `npx supabase functions deploy watch-pair --project-ref <ref> --no-verify-jwt`
3. `cd web && npm run build && npx wrangler deploy` (static hosting on Cloudflare; the phone updates itself the next time it opens with signal)
4. `cd watch && .\build.ps1 assembleRelease`, then install with `adb`.

An app that needs a new database function must never reach people before that function exists.

**Change Claude's instructions.** Edit `CLAUDE_GUIDE.md`, `docs/evidence.md` or `docs/goal.md` (which stays out of git), then
`python scripts/publish_guide.py --user-id <your auth user id> --env-file importer/.env.cloud --apply`. The chat
project and the scheduled task both read it from the database, so nothing is pasted anywhere.

**Import Hevy again.** `cd importer`, create the venv (`python -m venv .venv`, `.venv/Scripts/pip install -r requirements.txt`),
then `python hevy_import.py --user-id <id>` is a dry run; add `--env-file .env.cloud --apply` to write. Re-running
is safe (deterministic ids) and never overwrites exercise settings you edited. Tests: `python -m pytest`.

**Change the faces.** Put the new expression sheet in `docs/` and run `python scripts/cut_faces.py "<sheet>.png"`
(needs `pip install pillow numpy scipy`). The order on the sheet is great, good, average, weak, poor.

## CI/CD (automatic checks and deploys)

GitHub runs the checks on every push (database tests, phone app, importer, watch compiles) and can put the phone app live
by itself; the database is updated with a button you click, and the watch is installed from your PC over Wi-Fi.
Picture: `docs/cicd.png`. Guide, secrets and how to switch it on: `docs/CICD.md`. Files: `.github/workflows/`.

## What happens when you press Finish

1. The workout (with your 1-5 feeling) is saved on the device, then `sync_workout` sends it and finishes the session.
2. `finish_session` marks the plan you followed as used and writes the new **automatic plan** (`generate_plan`). It does not
   ask Claude: that is on demand.
3. On the day you will train a routine you tap **Plan with Claude** on it and confirm. `request_routine_plan` asks the scheduled
   task (a second tap within 2 minutes is ignored). Claude reads your last 6 sessions of any routine, that routine's own
   history and your check-ins, then calls `submit_plan`. About 30 seconds later the button stops saying "Claude is planning..."
   and the routine shows **Claude plan ready**. A **Claude plan beats the automatic one**.
4. If you edit a routine afterwards, `workout_plan` keeps Claude's targets for exercises that remain, drops removed
   ones and appends new ones from the automatic plan.

Without signal the workout waits on the device and uploads by itself later.

## Secrets: what exists and where (never in git)

| Secret | Lives in |
|---|---|
| Supabase **secret** key (importer, publish script) | `importer/.env.cloud` on this PC only. Never in an app |
| Supabase **publishable** key (public by design) | `web/.env.local`, and `watch/local.properties` for release builds (git-ignored) |
| Scheduled task address + token | Supabase Vault (`claude_fire_url`, `claude_fire_token`). To rotate: regenerate in the task's settings at claude.ai/code/routines, then update the Vault secret |
| The watch's login | on the watch (a refresh token made by pairing). There is no per-watch revoke list: if the watch is lost, sign the user out of all sessions in Supabase and sign in again on the phone and watch |
| Cloudflare login | stored by `wrangler login` |
| Your goal and body profile | `docs/goal.md` (git-ignored) and the `documents` table |

`.gitignore` keeps `/data/` (the Hevy CSV), every `.env*` file, `local.properties`, signing keys, build output, screenshots
and scratch files out. Comments in it must be on their own line (a `#` after a pattern becomes part of the pattern).

## Conventions the numbers follow

- Two-dumbbell exercises: `weight_kg` is the **pair total** (24 kg lateral raise = 2 x 12). Shown as `24 kg (2×12)`.
- One-side-at-a-time exercises: two rows per set (`side` L and R); the result is the **lower** rep count.
- Assisted exercises: `weight_kg` is the assistance, so **lower is better**.
- Incline bench is two exercises (30° and 45°). Dumbbell Row changed from two dumbbells to single-arm on 19 Feb 2026.
- Machine weight steps (`increment_kg`) are empty until you set them; plans never invent a step (the watch wheel uses 2.5 kg).
- A set is "met" when the planned reps were reached at the planned weight or heavier (assisted: the same or less help).

## Gotchas we hit

- Windows PowerShell blocks `npx`: use `npx.cmd`. Docker Desktop must be running for the local database.
- A dev copy of the app on your PC is wired to the real database (see above).
- The `data/` rule in `.gitignore` is `/data/` on purpose: the watch app has a code package called `data`.
- Big multi-line shell commands are unreliable in Git Bash on this machine: write files, then run short commands.
- Android Studio's Java is used for builds (`build.ps1` sets it); the watch build needs Android SDK platform 37 and Gradle 9.8.
- Wear OS: a watch app that keeps the screen on drains the battery, so the rest alarm is a real Android alarm and the
  screen sleeps normally; the "workout going on" counter uses the time-since-boot clock, not a calendar time.
- Tests that read whole tables must clear their own slate first (the local database keeps what you did by hand).
- Scheduled tasks are a research preview at Anthropic: the automatic plan keeps working if that part breaks.
- The Supabase connector labels query results "untrusted data"; the prompts say explicitly that
  `claude_instructions()` is the exception.

## Not built

Warm-up sets (you don't use them), GitHub/CI (skipped on purpose; the code lives on this PC plus a backup bundle).
Ideas not done: an "all sets done, finish?" prompt on the phone, changing the default rest lengths from the watch,
bigger ‹ › targets if your finger misses them.

## Backup

The code and its full history are in this folder's `.git`. A portable copy can be made at any time with
`git bundle create gymlogger.bundle --all` (restore with `git clone gymlogger.bundle`); the last one is kept in
`Documents\GymLogger_backups\`. Secrets and your goal text are not in git; the goal is also stored in the
`documents` table, and keys can be regenerated.
