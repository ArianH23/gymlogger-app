# The Wear OS watch app: how it will work, and what is already prepared

## The short version

The phone uses a **website** (a PWA). A watch cannot: Wear OS has no usable browser and does not run web apps.
So the watch gets a **native app**, written in Kotlin with Jetpack Compose for Wear OS. It is a different
program from the website, but it talks to **the same database with the same rules**. Nothing about your data,
plans or Claude changes: the watch is just a second screen that reads the same plan and writes the same sets.

```
 phone website ─┐
                ├──►  Supabase (the same tables, views and functions)  ◄──  Claude (plans)
 watch app ─────┘
```

## What the watch app would do

1. **Routine list**, with "Next up" first.
2. **Workout screen**: swipe between exercises; for each set a row with the target and last time, a weight/reps
   stepper (the crown or tap), and one tap to log. Left/right exercises have an L and an R row.
3. **Rest timer** after each set, with a vibration at zero (a watch is better at this than a phone).
4. **Finish**, which uploads and lets the database ask Claude for the next plan, exactly as on the phone.
5. **Offline first**: sets are saved on the watch immediately and uploaded when there is a connection.

It would not edit routines, show charts or manage check-ins. Those stay on the phone.

## Why this is cheap to build now

Everything that is "logic" already lives in the database, so the watch only has to display and send:

| Need | Already exists as |
|---|---|
| Routines and which is next | view `routine_status` |
| Start a workout (exercises, targets, last time) in **one call** | function `workout_start(routine_id)` |
| Save a session and its sets | upserts into `sessions` and `sets` with ids made on the watch |
| Finish (mark plan used, new plan, ask Claude) | function `finish_session(session_id)` |
| Stay signed in | Supabase refresh token |

`scripts/watch_api_check.py` plays the watch with plain HTTP calls against the local database and checks all of
this, including that sending the same sets twice creates no duplicates. It passes. Run it any time:
`importer/.venv/Scripts/python scripts/watch_api_check.py --email <email> --password <password>`.

## The calls the watch would make (REST, all with `apikey: <publishable key>` and `Authorization: Bearer <token>`)

```
POST /auth/v1/token?grant_type=password        {"email", "password"}         -> access_token, refresh_token   (once)
POST /auth/v1/token?grant_type=refresh_token   {"refresh_token"}             -> a new access_token            (when it expires)
GET  /rest/v1/routine_status?select=routine_id,name,is_next,last_started_at&order=position
POST /rest/v1/rpc/workout_start                {"p_routine_id": "..."}       -> routine, plan_by, exercises[sets, last]
POST /rest/v1/sessions?on_conflict=id          Prefer: resolution=merge-duplicates   (id, routine_id, title, started_at, ended_at, source = "app")
POST /rest/v1/sets?on_conflict=id              Prefer: resolution=merge-duplicates   (id, session_id, exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at)
POST /rest/v1/rpc/finish_session               {"p_session_id": "..."}
```

Rules the phone already follows and the watch must too: every id is a UUID created on the client; every write is
an upsert (so a retry is harmless); upload the session, then its sets, **then** call `finish_session`; weights for
two-dumbbell exercises are the pair total; left/right sets are two rows with `side` `L` and `R`.

## Signing in on a watch

Typing a password on a watch is awkward but possible (keyboard or voice), and you only do it **once**: the app
keeps the refresh token on the watch and renews it by itself. That is the plan for version 1. A nicer later option
is pairing with a short code shown by the phone app (needs a small new database piece).

## Installing it (no Play Store needed)

You enable **Developer options** and **ADB debugging over Wi-Fi** on the watch, then Android Studio on your PC
installs the app directly. Android Studio also has a Wear OS **emulator**, so most of the work can be tried before
the watch is even in the loop.

## Network

The watch uses its own Wi-Fi, or (Pixel Watch LTE) cellular, and otherwise the phone's connection through the
Bluetooth link. A normal HTTP call from the app works in all of these. At the gym with bad signal the offline queue
covers it, as on the phone.

## What I need from you before starting

1. **Which watch exactly** (Pixel Watch 1, 2 or 3; Wi-Fi or LTE).
2. **Android Studio installed on this PC** (a few GB). I cannot install it for you without your OK.
3. **A decision on scope:** log sets only (smallest), or also browse plans and last session.

## Proposed steps, each shown to you before the next

1. Create the Android Studio project, sign in, show the routine list (emulator).
2. The workout screen: plan, last time, set rows, one-tap log.
3. Local save (Room) and upload with retry, then `finish_session`.
4. Rest timer with vibration, and an "ongoing activity" so the workout stays on the watch face.
5. Install on your watch and use it for a real session.

## Honest risks

- **It is a second codebase** (Kotlin) next to the website (TypeScript), so any new screen has to be built twice.
  That is why the logic lives in the database.
- **A tiny screen** makes entering numbers slow: the stepper must be good. This is the part that needs real use.
- **Battery**: keeping the screen on for a whole workout costs some; the ongoing-activity feature helps.
