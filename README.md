# GymLogger

A personal training app that replaces Hevy. You log sets on your phone or your watch; when you ask, Claude plans the
session you are about to do from your history; the app shows that plan next to what you did last time and rates how each
session went. It also keeps your runs, your body measurements and progress photos, which muscles you trained, and your heart
rate during workouts.

- **Phone app**: an installable web app (PWA), works offline. `web/`
- **Watch app**: a native Wear OS app (Kotlin, Compose) for a Pixel Watch. `watch/`
- **Database + logic**: Supabase (Postgres) and one small Edge Function. `supabase/`
- **Claude**: reads your history through the Supabase connector and writes plans with `submit_plan`. `CLAUDE_GUIDE.md`
- **Imports**: the old Hevy history and the Strava runs. `importer/`

Pictures: the tables, views and functions are in `docs/schema.png` (`scripts/draw_schema.py`); the steps from the Plan with
Claude button to a plan showing in the app are in `docs/claude-flow.png` (`scripts/draw_claude_flow.py`); the checks and
deploys are in `docs/cicd.png` (`scripts/draw_cicd.py`). Each script writes an SVG; render it to PNG with a headless browser.

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
is next, stats, plan merging, session edits, the session score, merging a workout done on two devices, the numbers of a
run, the streak). The apps mostly display and store. The one exception is the watch's "go heavier / go lighter" hint after a
set, which has to work with no signal (see `docs/WATCH.md`).

Workouts, sets, routines and check-ins get their ids on the device, and every write is safe to repeat, so offline devices
never clash. What you delete in the app (sessions, sets, routines, exercises, check-ins, runs) is only marked as deleted
(`deleted_at`). Every table has row level security: only your account sees your rows.

## Layout

| Path | What |
|---|---|
| `supabase/migrations/` | the database, in order (38 files). Never edit an applied migration: add a new one |
| `supabase/tests/` | pgTAP tests, 496 checks, run with `npx supabase test db` |
| `supabase/functions/watch-pair/` | the Edge Function that trades a pairing code for a watch login |
| `web/src/screens`, `components`, `lib` | the phone app. `lib/sync.ts` shares the workout, `lib/db.ts` is the on-phone database (Dexie), `lib/tcx.ts` reads a run file, `index.css` holds the design system |
| `web/public/faces/` | the five tier faces shown for the session tiers (cut by `scripts/cut_faces.py`) |
| `.github/workflows/` | CI (`ci.yml`) and the "Update database" button (`update-database.yml`) |
| `watch/` | the Wear OS app: `data/` (API, models, sync, storage), `ui/` (screens, colours), `AppViewModel.kt`, `RestAlarm.kt`, `OngoingWorkout.kt`, `HeartRate.kt` |
| `importer/` | Hevy CSV importer (`hevy_import.py`), Strava runs importer (`strava_import.py`), exercise catalog (`exercises.csv`), pytest tests |
| `scripts/` | `publish_guide.py` (Claude's instructions into the database), the three `draw_*.py` diagram scripts, `draw_shape_mockup.py`, `cut_faces.py`, `md_to_pdf.py`, `watch_pairing_check.py` and `watch_api_check.py` (play the watch over plain HTTP) |
| `CLAUDE_GUIDE.md` | how Claude reads the database and writes a plan |
| `docs/evidence.md` (+ `.pdf`) | short, verified research notes Claude cites (published as `evidence-notes`) |
| `docs/prompts/` | the two short prompts: the scheduled task and the chat project |
| `docs/WATCH.md` | how the watch app works: pairing, the calls it makes, sharing the workout, heart rate |
| `docs/CICD.md` | the automatic checks and deploys: what runs when, the secrets, how to switch it on |

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

## Heart rate during a workout

While a workout is open on the watch, the watch records your heart rate (Wear OS Health Services, in a small foreground
service, so it goes on with the screen off; the readings arrive in batches to save battery). The top of every workout screen
shows the current value. When the workout is over the readings go to the database with `submit_session_hr`, which keeps the
average, the highest and one value every 10 seconds; the session page on the phone shows them with a curve. The watch asks
once for the heart rate permission; without it, or when another app is already tracking a workout (the watch allows one at a
time), the workout simply has no heart rate. A workout done only on the phone has none either.

Per set, the database works out two more numbers from what is already stored (the session's curve and the time each set was
logged), with nothing new recorded: the peak around the set, and how far the heart rate fell in the rest after it (view
`set_heart_rate`). The session page shows them beside each set. The peak is the highest value from 60 seconds before the set
was logged to 20 seconds after; the drop is left empty when the next set followed too soon to tell.

## Backup exercises (machine taken)

In the routine editor each exercise can have one backup: what you do instead when the machine is taken. While nothing is
logged for the planned exercise, the workout offers the backup with one tap, on the phone ("Machine taken? Do ...") and on
the watch ("Machine taken?" on the exercise's screen); the same tap swaps it back. The backup takes the planned exercise's
place with the same number of sets, each starting from what you did last time (`workout_start` and `routine_backups` build it;
it is not planned by Claude). You do not have to search for each backup: **Suggest** under an exercise lists up to four matches, and
**Suggest backups for the rest** fills every exercise that has none; nothing is saved until you save the routine, and each can be
changed or cleared first. `suggest_backups` ranks the exercises that share a primary muscle with the original by how closely their
muscle tags match (the same 1 and 0.5 weights as the muscle views), then prefers ones you have done before (so last time's numbers
are there), then a different kind of equipment (if one machine is taken, another often is too). It needs signal, and an exercise
with no muscle tags gets no suggestions; **Choose** still lists everything. When the session is finished, `finish_session` records the swap in `session_swaps`, so the
planned exercise is left out of the session's score instead of counting as sets not done, and Claude reads it as a swap, not
as a skipped exercise.

**Replace.** To swap an exercise for another for good (not just when a machine is taken), each exercise has **Replace**: in the routine
editor next to its name, and in a workout next to Remove exercise (only while nothing is logged for it). It lists the closest matches
(`suggest_backups`) and a **Search all exercises** link, and the new exercise takes the old one's place with the same number of sets
(`lib/replace.ts`). In a workout its sets start from what you did last time.

## Progress photos

Body tab, **Progress photos**: a front, side and back photo with a date, and the same pose on two dates side by side. The
phone makes each photo smaller (1600 pixels on the longer side) before saving it. The files are in a private storage bucket
(`progress-photos`), each user's in their own folder, and only their owner, signed in, can read, add or delete them; the
table `progress_photos` lists them. One photo per day and pose: a new one replaces it. Claude does not see the photos.
It needs signal (photos are not kept on the phone).

## Runs

Runs are tracked next to the gym sessions, but nothing plans them. History has a switch (All, Workouts, Runs); the Runs view
shows the distance per week, your bests (fastest 5 km, fastest kilometre, longest run) and an **Import run** button. A run page
shows distance, moving time and pace, the route on a real map, the pace of each kilometre, and altitude and heart rate along
the way when the file has them. Runs are on the calendar in blue and count for the week streak and the rest days.

**Pace and climb.** When the run has altitude, the Pace card has two tabs, **Each kilometre** and **Pace and climb** (which replaces the
separate Altitude card). The second tab is two charts one above the other with the same distance axis:
altitude on top, pace below (faster is higher), so a slow stretch lines up with the climb it was on. Touch the charts to read one spot
(distance, pace, altitude, gradient), and under them is your average pace uphill, on the flat and downhill (slopes are steeper than
2 %). It is worked out on the phone from the stored track in 100 m pieces (`lib/paceClimb.ts`), for display only; the run's official
numbers still come from the database. GPS altitude is rough, so short bumps mean little.

**The map** is Leaflet with OpenStreetMap tiles (`RunMap.tsx`, loaded only when a run with a route is opened), shown in the app's
dark colours. The route is cut at every kilometre and each kilometre is coloured by its pace, slow orange through gold to fast
jade, with a number at each kilometre mark and a legend (`lib/routePace.ts`; **Plain colour** turns it off). Your GPS points never leave the app; the map server sees which tiles are requested, which is roughly the area of
the run, and your IP address. Only the tiles on screen are requested, nothing is downloaded ahead, and the credit stays visible:
those are OpenStreetMap's tile rules, so do not add offline map downloads on top of their server. With no signal, or after
tapping **Line only**, the page draws the route as a plain line (`RouteLine.tsx`), which needs nothing from outside. If
OpenStreetMap's server ever blocks the app, change the tile address in `RunMap.tsx` to another provider's.

- **New runs:** in Google Health open the run, More, Export: that gives a TCX file. Pick it with Import run. The app only reads
  the file (`web/src/lib/tcx.ts`, with unit tests: `npm test` in `web/`); the database function `submit_run` computes
  everything, so every source gets the same numbers. A file that says it is a bike ride is refused; heart rates under 30 or over 250 (a sensor
  glitch) are ignored instead of failing the import; and a file with no altitude has no climb at all rather than "0 m".
- **The Strava history:** `importer/strava_import.py` reads an unzipped Strava export in `data/strava/` (git-ignored) and sends
  each run (GPX or TCX; walks and hikes are left out) through the same `submit_run`. Dry run by default; `--user-id <id>
  --env-file .env.cloud --apply` writes. Running it again updates, never duplicates.
- **The rules in `submit_run`:** the source's own distance is the official one and the route is scaled to it; pace is from
  moving time (pauses of more than 30 s and standing still are left out); one split per kilometre; a run that starts within
  two minutes of one you already have is the same run (Strava, then Google Health); when the GPS did not work (no positions, or
  a track more than 20% off the source's distance) the distance is kept and an even pace is assumed.
- Tables `runs` and `run_splits`, views `run_summary`, `weekly_runs`, `monthly_runs`, `run_bests`. The Hevy export stays
  strength-only. Your GPS tracks are stored only in your own rows.

## Calendar and streak

History shows a month calendar with gym days and run days filled in (tap a day to see what you did), and both History and the
Routines home show three numbers: the **week streak** (weeks in a row with at least one finished workout or run), the **rest days**
since your last workout or run, and how many you did this week. Weeks run Monday to Sunday in local time, as in the weekly overview. The
streak stays alive during the current week and only breaks once a whole week has passed with nothing logged. The imported Hevy
history counts. It is all computed in the database (`workout_calendar`, `training_streak`); a workout still waiting to upload
is not counted until it has synced.

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

Under the weekly and monthly muscles, **Balance** compares two sides of the body with the same sets: push against pull, front
against back, upper against lower body, quads against hamstrings (`weekly_balance`, `monthly_balance`; which muscle is on
which side is in `muscle_balance_defs()`). It is a comparison with a tick at the even point, not a target: a muscle on
neither side of a comparison is left out of it.

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
the next empty set; the last set asks whether you are done. After a set, the weight of the next one blinks blue with an up
arrow if you beat the rep range, or red with a down arrow if you fell short. Rest timer (tap it for -15 / +15 / Skip / Alarm
on-off), vibration through an Android alarm so it works with the screen asleep, and a gold pulsing "Rest over" when it ends.
The time, the elapsed time and your heart rate are at the top, and a "workout going on" indicator on the watch face returns you
to the app.

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
workout in it uploads for real, and "Plan with Claude" really asks Claude. Use *Discard workout* for experiments, or point
it at the local database (below).

**Local database (safe sandbox).** Needs Docker Desktop running.
`npx supabase start -x imgproxy,edge-runtime,logflare,vector,realtime,storage-api,inbucket,mailpit`, then
`npx supabase test db` (leave `storage-api` out of that list to try progress photos locally). To run the app against it, put the local URL and key in `web/.env.localdb.local` and use
`npx vite --mode localdb`. `npx supabase db reset` rebuilds it from the migrations. After adding a migration, apply it
locally with `npx supabase migration up` (the tests do not apply migrations).
For the pairing function locally: `npx supabase functions serve --no-verify-jwt`, then `scripts/watch_pairing_check.py`.

**Run every test.** Database: `npx supabase test db` (496 checks). Phone: `cd web && npm test` (the run-file reader, the pace and climb figures, the photo sizes, the set rows, replacing exercises, the set input limits, the upload errors and the saved login),
plus `npx tsc -b` and `npm run lint`. Importers: `cd importer && .venv/Scripts/python -m pytest` (34 tests). Watch:
`cd watch && .\build.ps1 testDebugUnitTest` (25 tests). GitHub runs all of them on every push.

**Change the database.** Add a new file in `supabase/migrations/`, add a pgTAP test, run `npx supabase migration up`
and `npx supabase test db`. Publishing is done from GitHub, not from this PC (next paragraph).

**Going live.** Database first, then the site, then the watch:
1. `git push origin main`. GitHub runs the checks.
2. If a migration is new: on GitHub, Actions, **Update database**. Run it once with "apply" unticked and read the SQL it
   would run; then run it again ticked. It applies the migrations and redeploys the `watch-pair` function, and refuses unless
   the checks for that commit are green.
3. The site deploys by itself once the checks are green and the database is up to date (it stops with "Database changes are
   waiting" otherwise; re-run that job after step 2). The phone updates itself the next time it opens with signal.
4. The watch: `cd watch && .\build.ps1 assembleRelease`, then install with `adb` (see The watch app, above).

An app that needs a new database function must never reach people before that function exists: that is what the order,
and the check in step 3, are for. The same steps can be done by hand from this PC if GitHub is down
(`npx supabase db push --linked --dry-run`, then without `--dry-run`; `cd web && npm run build && npx wrangler deploy`).

**Change Claude's instructions.** Edit `CLAUDE_GUIDE.md`, `docs/evidence.md` or `docs/goal.md` (which stays out of git), then
`python scripts/publish_guide.py --user-id <your auth user id> --env-file importer/.env.cloud --apply` (without `--apply`
it is a dry run). It publishes all three documents. The chat project and the scheduled task both read them from the database,
so the guide itself is never pasted anywhere. Only their two short prompts live at claude.ai: if `docs/prompts/` changes,
paste the new text there.

**Import Hevy again.** `cd importer`, create the venv (`python -m venv .venv`, `.venv/Scripts/pip install -r requirements.txt`),
then `python hevy_import.py --user-id <id>` is a dry run; add `--env-file .env.cloud --apply` to write. Re-running
is safe (deterministic ids) and never overwrites exercise settings you edited. The Strava runs are imported the same way
with `strava_import.py` (see Runs above).

**Change the faces.** Put the new expression sheet in `docs/` and run `python scripts/cut_faces.py "<sheet>.png"`
(needs `pip install pillow numpy scipy`). The order on the sheet is great, good, average, weak, poor.

## CI/CD (automatic checks and deploys)

GitHub runs the checks on every push (database tests; phone app type-check, lint, unit tests and build; importer tests;
watch unit tests and build) and puts the phone app live by itself; the database is updated with a button you click, and the
watch is installed from your PC over Wi-Fi.
Picture: `docs/cicd.png`. Guide, secrets and how to switch it on: `docs/CICD.md`. Files: `.github/workflows/`.

## What happens when you press Finish

1. The workout (with your 1-5 feeling) is saved on the device, then `sync_workout` sends it and finishes the session.
2. `finish_session` marks the plan you followed as used and writes the new **automatic plan** (`generate_plan`). It does not
   ask Claude: that is on demand.
3. On the day you will train a routine you tap **Plan with Claude** on it and confirm. `request_routine_plan` asks the scheduled
   task (a second tap within 2 minutes is ignored). Claude reads your last 6 sessions of any routine, that routine's own
   history, your runs and your check-ins, then calls `submit_plan`. The phone checks every 10 seconds: when the plan is in, the
   button stops saying "Claude is planning..." and the routine shows **Claude plan ready**. If nothing has arrived after 10
   minutes it says so and you can ask again. A **Claude plan beats the automatic one**.
4. If you edit a routine afterwards, `workout_plan` keeps Claude's targets for exercises that remain, drops removed
   ones and appends new ones from the automatic plan.

Without signal the workout waits on the device and uploads by itself later.
The app also **starts with no signal**: the routine, exercise, history and body screens show the last copy saved on the phone within a
fraction of a second, and a workout can be started and finished. Two things make that true (`lib/supabase.ts`, `lib/storedSession.ts`): reads do
not retry (the library's default of 3 retries made each screen wait about 7 seconds), and with no signal an expired login (it lasts an hour)
is answered from the login saved on the phone instead of waiting about 25 seconds for a renewal that cannot happen and then showing the
sign-in screen. When the signal is back the library renews the login by itself and the workout uploads.
The logger refuses reps that are not a whole number from 0 to 500 and a weight outside 0 to 2000 kg (`lib/setInput.ts`), because the database would
refuse them and a refused set stops a workout from uploading. If the server still refuses a finished workout (bad data in it), that
workout is set aside with the reason on the routine list, with **Fix it** (reopens it to correct the set) and **Discard**; the
workouts behind it upload as usual. No signal, a signed-out session or a slow server only make a workout wait (`lib/syncErrors.ts`).

## Secrets: what exists and where (never in git)

| Secret | Lives in |
|---|---|
| Supabase **secret** key (importer, publish script) | `importer/.env.cloud` on this PC only. Never in an app |
| Supabase **publishable** key (public by design) | `web/.env.local`, and `watch/local.properties` for release builds (git-ignored) |
| Scheduled task address + token | Supabase Vault (`claude_fire_url`, `claude_fire_token`). To rotate: regenerate in the task's settings at claude.ai/code/routines, then update the Vault secret |
| The watch's login | on the watch (a refresh token made by pairing). There is no per-watch revoke list: if the watch is lost, sign the user out of all sessions in Supabase and sign in again on the phone and watch |
| Cloudflare and Supabase tokens for the automatic deploys | GitHub, repository secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN`); see `docs/CICD.md` |
| Cloudflare login for deploying by hand | stored by `wrangler login` on this PC |
| Your goal and body profile | `docs/goal.md` (git-ignored) and the `documents` table |

`.gitignore` keeps `/data/` (the Hevy CSV and the Strava export), every `.env*` file, `local.properties`, signing keys, build output, screenshots
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
- The watch emulator and Docker together need several GB of free memory: close other programs first, or test on the real watch.
- Android Studio's Java is used for builds (`build.ps1` sets it); the watch build needs Android SDK platform 37 and Gradle 9.8.
- Wear OS: a watch app that keeps the screen on drains the battery, so the rest alarm is a real Android alarm and the
  screen sleeps normally; the "workout going on" counter uses the time-since-boot clock, not a calendar time.
- Routine and exercise names are unique only among the ones that are not deleted (a partial unique index), so a name is free again
  after a delete. That means an upsert cannot use the name as its conflict target (the Hevy importer adds new exercises by id), and any
  lookup by name must skip deleted rows. Deleting an exercise is `delete_exercise`: soft, refused while a routine uses it.
- Tests that read whole tables must clear their own slate first (the local database keeps what you did by hand).
- Scheduled tasks are a research preview at Anthropic: the automatic plan keeps working if that part breaks.
- The Supabase connector labels query results "untrusted data"; the prompts say explicitly that
  `claude_instructions()` is the exception.

## Not built

- A warm-up toggle in the app (you don't use warm-ups; imported ones are stored and left out of the numbers).
- Heart rate for a workout done only on the phone: the watch is what records it.
- Photos or animations of the exercises.
- Progress photos with no signal, and showing them to Claude.
- Sharing a run straight from Google Health's share sheet: for now you pick the exported file.
- Walks and hikes from Strava: only runs are imported.
- An estimate of your natural ceiling from wrist and ankle: the two measurements are stored, the formula is not chosen yet.
- Ideas not done: an "all sets done, finish?" prompt on the phone, changing the default rest lengths from the watch,
  bigger ‹ › targets if your finger misses them.

## Backup

The code and its full history are in this folder's `.git` and on GitHub (a private GitHub repository). A
portable copy can also be made at any time with `git bundle create gymlogger.bundle --all` (restore with
`git clone gymlogger.bundle`). Secrets, your goal text and the files in `data/` are not in git; the goal is also stored in the `documents` table, keys can be regenerated, and your
training data itself lives in the Supabase project, not in this folder.
