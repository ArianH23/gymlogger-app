# The Wear OS watch app

## The short version

The phone uses a **website** (a PWA). A watch cannot: Wear OS has no usable browser and does not run web apps.
So the watch has a **native app**, written in Kotlin with Jetpack Compose for Wear OS (`watch/`). It is a different
program from the website, but it talks to **the same database with the same rules**. Nothing about your data,
plans or Claude changes: the watch is a second screen that reads the same plan and writes the same sets, and the
workout you are doing is shared live with the phone.

```
 phone website ─┐
                ├──►  Supabase (the same tables, views and functions)  ◄──  Claude (plans)
 watch app ─────┘
```

It was built and tested for a Wear OS watch (Wi-Fi), Wear OS 6 and up (minSdk 33).

## What it does

1. **Routines**, with "Next up" first. With a workout open, "Resume" comes first and the others cannot be started.
2. **Overview**: the exercises of the workout with how many sets are done; Finish and Discard at the bottom.
3. **Sets of one exercise**: one row per set with the plan and last time (`plan 44×7-10 · last 44×6`), logged sets as
   `✓ 44×7`, **+ Set**, and a **Next exercise** button at the end.
4. **Set editor**: a weight wheel and a reps wheel, each showing its unit ("44 kg", "6 reps"). **No typing of numbers, as
   in Hevy:** turn the crown to change the highlighted wheel, tap the other wheel to switch to it, or drag either one with a
   finger. The weight step is the exercise's own `increment_kg` (2.5 kg if none is set), reps step by 1. Both start from the
   plan, so a normal set is one glance and one tap on **Log**. The ‹ › beside the set number step through every set of the
   workout, crossing into the next or previous exercise. Logging moves on to the next empty set (in the next exercise when
   this one is done); the last set brings up **"All sets done: finish the workout?"**.
   **Heavier or lighter?** After a set, the weight of the next set gets a hint from the reps of the set before it against that set's
   plan range: more reps than the top of the range blinks the number **blue** three times and shows a blue **▲** to the left of it
   (go heavier); fewer than the bottom blinks it **red** with a red **▼** (go lighter). Inside the range: nothing. The arrow goes away
   once you move the weight the suggested way. One-sided exercises are judged after both sides, by the lower side; assisted exercises
   are reversed (more reps = less assistance); bodyweight exercises get no hint; with a single target instead of a range the margin is
   two reps. The rule is `hintFor` in `data/WorkoutLogic.kt`, on the watch so it works without signal, and it has unit tests
   (`watchuild.ps1 testDebugUnitTest`).
   For a logged set the buttons are **Save** and **Unlog** (clears it, the row stays); for an empty one **✕** takes the row off.
   Left/right exercises have an L and an R row.
5. **Rest timer** after each completed set (for left/right: after both sides), by the top of the rep range (150 s up to 10,
   90 s up to 15, else 60 s). Tap the rest line for the rest screen: **-15 / +15 / Skip / Alarm on-off**. The vibration is an
   Android alarm, so it goes off on time with the screen asleep. The alarm switch is per device.
6. **Clock**: the time of day and the time since the workout started, at the top of every workout screen.
7. **"Workout going on"** on the watch face (a Wear OS Ongoing Activity): a small dumbbell with a running timer; tapping it
   returns to the app. It needs the notification permission (asked once).
8. **Finish**: "How did it feel?" (1 to 5, optional), then the workout is saved and uploaded; the database marks the plan
   used, makes the next plan and asks Claude, exactly as on the phone.
9. **Offline first**: everything is written to a file on the watch before anything else, and goes out when there is signal.
   A queue of finished workouts waiting to upload is shown on the routine list.

It does not edit routines, show charts or manage check-ins. Those stay on the phone.

## Heart rate

While a workout is open on the watch, `HeartRateService` (a foreground service of type `health`) records heart rate with
Health Services' `ExerciseClient` (exercise type strength training, or generic workout if the watch lacks it; only the heart
rate data type, no GPS). Health Services samples with the screen off and delivers in batches, so nothing special is done
about batching. The service keeps at most one reading every 5 seconds in a small file per workout (`files/hr/<id>.csv`), so
nothing is lost if the app is closed, and the "workout going on" notification is the service's own notification.

- The top of each workout screen shows the latest value next to the clock.
- When the workout is over (finished here or on the phone), the readings are sent with `rpc/submit_session_hr` after the
  workout itself has synced, then the file is deleted. If the server refuses them (the session was deleted) they are dropped.
- Permission: `android.permission.health.READ_HEART_RATE` on Wear OS 6 and later, `BODY_SENSORS` before. Asked once, together
  with the notification permission, when a workout opens. Without it the workout works as before, with no heart rate.
- The watch allows one tracked exercise at a time across all apps. If another app is tracking one when the workout opens,
  this app does not start its own (it would end theirs), so that workout has no heart rate.
- The logic that can be tested without a watch (thinning the readings, building the upload) is in `data/HeartRateStore.kt`,
  with unit tests.

## Machine taken: the backup exercise

`workout_start` gives each exercise its backup when the routine has one (`backup`, in the same shape as an exercise, with
sets that start from what was done last time). While nothing is logged for an exercise, its screen shows **Machine taken?**
with the backup's name: one tap puts the backup in the exercise's place (`Workout.swapToBackup` in `WorkoutLogic.kt`, the same
rule as the phone). The planned exercise is kept as the backup's backup, so the button then reads **Back to planned** and the
same tap undoes it. Sets added to or removed from the old exercise do not carry over. The change travels to the phone like
any other change to the workout's layout. Nothing is offered once a set is logged, or when the backup is already one of the
workout's exercises.

## Signing in on a watch

No typing: the watch is paired with a **6-digit code** made on the phone.

1. Phone (signed in): Body tab, "Pair watch" calls `create_watch_pairing()` and shows the code (valid 10 minutes, works once).
2. Watch: you pick the 6 digits with the wheels.
3. The watch sends the code to the `watch-pair` Edge Function (`supabase/functions/watch-pair`), which asks the database
   (`claim_watch_pairing`) and, if the code is good, returns a normal login (access + refresh token). The watch keeps the
   refresh token and renews it by itself.

A code works once, expires after 10 minutes, only its hash is stored, and every open code dies after 5 wrong guesses
(so guessing is not practical; the price is that wrong guesses also cancel your own code: make a new one).

## Sharing the workout in progress with the phone

The workout you are doing lives in the database, so you can start on the watch and carry on on the phone (or the other way
round). One database function, `sync_workout`, does all the merging; the phone and the watch only send their view of the
workout and adopt the answer. The rules (all in `supabase/migrations/..._live_workout.sql`, with tests):

- **One open workout per user.** Starting a second one returns the open one instead (`other_open`).
- **The same set from two devices is one row:** the newer log wins and the row keeps its first id. A log time in the future (a device
  with a wrong clock) counts as now, so such a device cannot win every later edit.
- **Times are kept sane:** a start in the future is brought back to now; a finish is never in the future and at most 24 hours after the
  start. Sets that arrive after the workout was finished (a device that was offline) make the score and next plan be worked out again.
- **One call at a time per workout** (a lock): two devices or tabs sending the same workout together no longer collide on a duplicate key.
- **A deleted set stays deleted**, even if another device still has it and sends it again.
- **The plan layout** (exercises, added and removed sets) is last-writer-wins.
- **Finishing** saves the feeling, marks the plan used and makes the next plan. A finished or discarded workout disappears
  from the other device within a few seconds.
- **No signal:** everything is saved on the device first (a JSON file on the watch, IndexedDB on the phone) and goes out when
  the connection is back. Starting a workout with no signal cannot know about one open elsewhere; if both end up open, the
  second is kept apart and uploads when it is finished.

Both devices ask every 6 seconds while their app is on screen, and straight after you change something. The watch-face
indicator can linger if the workout is finished on the phone while the watch app is not running; it clears the next time
the app opens.

## The calls the watch makes (REST, all with `apikey: <publishable key>` and `Authorization: Bearer <token>`)

```
POST /functions/v1/watch-pair                  {"code": "123456"}            -> access_token, refresh_token      (once, to pair)
POST /auth/v1/token?grant_type=refresh_token   {"refresh_token"}             -> a new access_token               (when it expires)
GET  /rest/v1/routine_status?select=routine_id,name,is_next,last_started_at&order=position
POST /rest/v1/rpc/workout_start                {"p_routine_id": "..."}       -> routine, plan_by, exercises[sets, last, increment_kg]
POST /rest/v1/rpc/sync_workout                 {"p_workout": {...}}          -> {status, workout}   (start, log, delete, finish, discard)
POST /rest/v1/rpc/open_workout                 {}                            -> the workout open on any device, or null
```

Rules every client follows: ids are UUIDs made on the client; every write is safe to repeat; weights for two-dumbbell
exercises are the pair total; left/right sets are two rows with `side` `L` and `R`.

## How the code is organised (`watch/app/src/main/java/com/gymlogger/watch/`)

| File | What |
|---|---|
| `data/Api.kt` | the HTTP calls, the login and its renewal |
| `data/Models.kt` | the shapes of the workout, the plan and the server's answers |
| `data/WorkoutLogic.kt` | the rules of the workout screens (which rows exist, defaults, rest length, next/previous set), no UI |
| `data/Sync.kt` | building the `sync_workout` request and reconciling the answer (pure functions) |
| `data/WorkoutStore.kt` | the open workout, the upload queue and pending discards, as files |
| `AppViewModel.kt` | what is on screen; every change to the open workout goes through one locked `change()` |
| `ui/` | the screens |
| `RestAlarm.kt`, `OngoingWorkout.kt` | the rest vibration (Android alarm) and the watch-face indicator |

## Building and installing (no Play Store needed)

```powershell
cd watch
.\build.ps1 assembleDebug      # talks to the LOCAL database (the emulator reaches your PC at 10.0.2.2)
.\build.ps1 assembleRelease    # talks to your REAL project: needs supabase.cloud.url / supabase.cloud.key in watch/local.properties
```

On the watch: Settings → System → About → tap Build number 7 times; Developer options → ADB debugging and Wireless debugging;
"Pair new device" shows an address and a code. On the PC: `adb pair <address>` (type the code), `adb connect <the other
address>`, then `adb -s <address> install -r watch/app/build/outputs/apk/release/app-release.apk`. Turn Wireless debugging off
afterwards. Android Studio's Wear OS **emulator** (`watch6`) covers most of the work; it cannot turn a crown, so the crown
only shows on the real watch.

## Tests and checks

- `npx supabase test db`: the database rules (pairing, `sync_workout`, scores, plans...), 523 checks.
- `scripts/watch_pairing_check.py` (needs `npx supabase functions serve --no-verify-jwt`): plays phone and watch over HTTP
  through the whole pairing, including wrong codes and reuse.
- `scripts/watch_api_check.py`: plays an older, simpler watch (plain upserts and `finish_session`) to prove a client other
  than the website can run a whole workout.
- The screens were checked on the emulator and the real Wear OS watch with screenshots (not committed).

## Honest risks and limits

- **It is a second codebase** (Kotlin) next to the website (TypeScript), so any new screen has to be built twice. That is why
  the logic lives in the database.
- **A tiny screen**: entering numbers is the hard part; the wheels and the prefilled values are the answer, and they need real use.
- **Round screen**: content near the edge is clipped, so labels are short and buttons narrow near the top and bottom.
- **The alarm switch** and the rest lengths are per device; the phone has its own.
- Imported Hevy sessions have no plan, so no score.
