package com.gymlogger.watch

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.gymlogger.watch.data.Api
import com.gymlogger.watch.data.HeartRateStore
import com.gymlogger.watch.data.hrSamplesJson
import com.gymlogger.watch.data.submitSessionHr
import com.gymlogger.watch.data.LoggedSet
import com.gymlogger.watch.data.PairResult
import com.gymlogger.watch.data.PlanExercise
import com.gymlogger.watch.data.RoutineItem
import com.gymlogger.watch.data.Row
import com.gymlogger.watch.data.Sent
import com.gymlogger.watch.data.Workout
import com.gymlogger.watch.data.WorkoutStore
import com.gymlogger.watch.data.addSetRow
import com.gymlogger.watch.data.adoptRemote
import com.gymlogger.watch.data.exercise
import com.gymlogger.watch.data.liveChanged
import com.gymlogger.watch.data.loggedAt
import com.gymlogger.watch.data.openWorkout
import com.gymlogger.watch.data.planSet
import com.gymlogger.watch.data.reconcile
import com.gymlogger.watch.data.restIsOver
import com.gymlogger.watch.data.restSeconds
import com.gymlogger.watch.data.swapToBackup
import com.gymlogger.watch.data.routines
import com.gymlogger.watch.data.syncDiscard
import com.gymlogger.watch.data.syncPayload
import com.gymlogger.watch.data.syncWorkout
import com.gymlogger.watch.data.workoutStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.time.Instant
import java.util.UUID

/** Where you are in the app. Back goes one level up: set -> exercise -> workout -> routines. */
sealed interface Screen {
    data object Routines : Screen
    data object Overview : Screen
    data object Feeling : Screen // "how did it feel?", on finishing
    data object AllDone : Screen // every set is logged: "finish the workout?"
    data class Exercise(val exerciseId: String) : Screen
    data class Editor(val exerciseId: String, val row: Row) : Screen
    data class Rest(val from: Screen) : Screen // the rest timer's own screen; back returns to where you were
}

/** What the screens show. The data lives in [Api], the database and the on-watch [WorkoutStore]; this holds what is on screen. */
class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val api = Api(app)
    private val store = WorkoutStore(app)
    private val hrStore = HeartRateStore(app)

    var signedIn by mutableStateOf(api.signedIn)
        private set

    var pairBusy by mutableStateOf(false)
        private set
    var pairError by mutableStateOf<String?>(null)
        private set

    var routines by mutableStateOf<List<RoutineItem>?>(null)
        private set
    var routinesError by mutableStateOf<String?>(null)
        private set
    var startingId by mutableStateOf<String?>(null)
        private set

    /** The one open workout, if any. Reopening the app mid-workout takes you straight back to it. */
    var workout by mutableStateOf(store.loadOpen())
        private set
    var screen by mutableStateOf<Screen>(if (workout != null) Screen.Overview else Screen.Routines)

    /** Finished workouts saved on the watch that the server has not confirmed yet. */
    var waiting by mutableIntStateOf(store.waitingCount())
        private set

    /** False while the last sync failed (no signal): everything is still saved on the watch. */
    var online by mutableStateOf(true)
        private set

    /** When the rest after the last set ends (ms since 1970), shown as a countdown; null when not resting. */
    var restEndsAt by mutableStateOf<Long?>(null)
        private set
    private var restJob: Job? = null

    private val prefs = app.getSharedPreferences("settings", Context.MODE_PRIVATE)

    /** Whether the watch vibrates when the rest ends. Kept on this device (the phone has its own switch). */
    var alarmOn by mutableStateOf(prefs.getBoolean("restAlarm", true))
        private set

    fun toggleAlarm() {
        alarmOn = !alarmOn
        prefs.edit().putBoolean("restAlarm", alarmOn).apply()
    }

    init {
        // The indicator on the watch face follows the open workout: on while one is open, gone when it ends.
        viewModelScope.launch {
            snapshotFlow { workout?.let { Triple(it.id, it.title, it.startedAt) } }.collect { w ->
                if (w == null) {
                    HeartRate.stop(app)
                    OngoingWorkout.hide(app)
                } else {
                    val startedAt = Instant.parse(w.third).toEpochMilli()
                    OngoingWorkout.show(app, w.second, startedAt)
                    HeartRate.start(app, w.first, w.second, startedAt) // records heart rate while the workout is open here
                }
            }
        }
        // When a recording has ended and saved its last readings, send them.
        HeartRate.onStopped = { scheduleSync(0) }
    }

    /** After the permission dialogs: show the indicator and start the heart rate, if they are now allowed. */
    fun permissionsAnswered() {
        val w = workout ?: return
        val startedAt = Instant.parse(w.startedAt).toEpochMilli()
        OngoingWorkout.show(getApplication(), w.title, startedAt)
        HeartRate.start(getApplication(), w.id, w.title, startedAt)
    }

    override fun onCleared() {
        HeartRate.onStopped = null
        super.onCleared()
    }

    // All changes to the open workout go through [change], one at a time, so a reply from the server can never
    // overwrite something just tapped (and the file on the watch is always the latest state).
    private val lock = Any()

    private fun now() = Instant.now().toString()

    private fun change(f: (Workout) -> Workout?) {
        synchronized(lock) {
            val w = workout ?: return
            val n = f(w) ?: return
            store.saveOpen(n)
            workout = n
        }
        scheduleSync()
    }

    // ---- signing in and the routine list

    fun pair(code: String) {
        pairBusy = true
        pairError = null
        viewModelScope.launch(Dispatchers.IO) {
            val result = api.pair(code)
            pairBusy = false
            when (result) {
                PairResult.Ok -> signedIn = true
                PairResult.WrongCode -> pairError = "Wrong or expired code"
                is PairResult.Failed -> pairError = result.message
            }
        }
    }

    fun loadRoutines() {
        routinesError = null
        viewModelScope.launch(Dispatchers.IO) {
            try {
                routines = api.routines()
            } catch (e: Api.SignedOut) {
                signedIn = false // the login was revoked: pair again
            } catch (e: IOException) {
                routinesError = "No connection"
            } catch (e: Exception) {
                routinesError = "Could not load"
            }
        }
    }

    fun signOut() {
        api.signOut()
        routines = null
        signedIn = false
    }

    // ---- sharing the workout with the phone (the server merges; see Sync.kt)

    private val syncMutex = Mutex()
    private var syncAgain = false
    private var syncJob: Job? = null

    /** Syncs shortly from now, so several taps in a row become one call. */
    fun scheduleSync(delayMs: Long = 600) {
        syncJob?.cancel()
        syncJob = viewModelScope.launch { delay(delayMs); syncNow() }
    }

    /** Syncs everything now: discards, finished workouts, the open workout (or one started on the phone). */
    suspend fun syncNow() {
        if (!signedIn) return
        if (!syncMutex.tryLock()) { // already running: it will go round once more
            syncAgain = true
            return
        }
        try {
            withContext(Dispatchers.IO) {
                do {
                    syncAgain = false
                    syncOnce()
                } while (syncAgain)
            }
            online = true
        } catch (e: Api.SignedOut) {
            signedIn = false
        } catch (e: Exception) {
            online = false // no signal or a server error: everything stays saved here and goes out next time
        } finally {
            syncMutex.unlock()
        }
    }

    private fun syncOnce() {
        for (id in store.discardIds()) {
            api.syncDiscard(id)
            store.removeDiscard(id)
        }
        for (w in store.waitingWorkouts()) {
            api.syncWorkout(w.syncPayload(sendLive = false)) // finished (or already gone): either way the server has dealt with it
            store.removeWaiting(w.id)
        }
        waiting = store.waitingCount()
        uploadHeartRate()

        val open = workout
        if (open == null) {
            val remote = api.openWorkout() ?: return
            val adopted = adoptRemote(remote) ?: return
            synchronized(lock) {
                if (workout == null) { // (still nothing open here)
                    store.saveOpen(adopted)
                    workout = adopted
                }
            }
        } else if (!open.detached) {
            syncOpen(open)
        }
    }

    /**
     * Sends the heart rate of workouts that are over (finished here just above, or finished on the phone). The one still
     * being recorded waits. If the server refuses it (the session was deleted), it is dropped, so it cannot block the queue.
     */
    private fun uploadHeartRate() {
        for (id in hrStore.ids()) {
            if (id == workout?.id || id == HeartRate.activeId) continue
            val data = hrStore.read(id)
            if (data == null) { // a damaged file: nothing to send
                hrStore.delete(id)
                continue
            }
            val (startedAt, samples) = data
            if (samples.isNotEmpty()) {
                try {
                    api.submitSessionHr(id, hrSamplesJson(samples, startedAt))
                } catch (e: Api.HttpError) {
                    if (e.code !in 400..499) throw e // a server hiccup: try again next time
                }
            }
            hrStore.delete(id)
        }
    }

    private fun syncOpen(w: Workout) {
        val sent = Sent(w.sets.map { it.id }.toSet(), w.deletedSetIds, w.liveRev, sentLive = w.liveChanged())
        val result = api.syncWorkout(w.syncPayload(sent.sentLive))
        synchronized(lock) {
            val cur = workout
            if (cur == null || cur.id != w.id) return
            when (result.status) {
                "deleted" -> dropOpen() // thrown away on another device
                "other_open" -> {
                    // A different workout is already open on the phone. If this one is still empty, switch to that one.
                    if (cur.sets.isEmpty()) {
                        dropOpen()
                        result.workout?.let { adoptRemote(it) }?.let { store.saveOpen(it); workout = it }
                    } else {
                        val n = cur.copy(detached = true)
                        store.saveOpen(n)
                        workout = n
                    }
                }
                else -> {
                    val server = result.workout ?: return
                    val r = reconcile(cur, server, sent, now())
                    if (cur.endedAt == null && r.endedAt != null) dropOpen() // finished on the phone
                    else {
                        store.saveOpen(r)
                        workout = r
                    }
                }
            }
        }
    }

    /** Closes the open workout here (it was finished or thrown away elsewhere). */
    private fun dropOpen() {
        store.clearOpen()
        cancelRest()
        workout = null
        screen = Screen.Routines
    }

    // ---- the workout

    /** Starts a workout on a routine. Only one can be open at a time, here or on the phone. */
    fun start(routine: RoutineItem) {
        if (workout != null) {
            screen = Screen.Overview
            return
        }
        startingId = routine.id
        routinesError = null
        viewModelScope.launch(Dispatchers.IO) {
            try {
                withTimeoutOrNull(4000) { syncNow() } // look first for a workout open on the phone: it is picked up here
                if (workout != null) {
                    screen = Screen.Overview
                } else {
                    val plan = api.workoutStart(routine.id)
                    synchronized(lock) {
                        val w = Workout(
                            id = UUID.randomUUID().toString(),
                            routineId = routine.id,
                            title = plan.routineName,
                            startedAt = now(),
                            plan = plan.exercises,
                            liveRev = 1,
                        )
                        store.saveOpen(w)
                        workout = w
                    }
                    screen = Screen.Overview
                    scheduleSync(0)
                }
            } catch (e: Api.SignedOut) {
                signedIn = false
            } catch (e: IOException) {
                routinesError = "No connection"
            } catch (e: Exception) {
                routinesError = "Could not start"
            }
            startingId = null
        }
    }

    /** Logs (or, for a row that already has a set, changes) one set. */
    fun logSet(ex: PlanExercise, row: Row, weight: Double?, reps: Int) {
        var startRest = false
        change { w ->
            val existing = w.loggedAt(ex, row)
            val set = LoggedSet(
                id = existing?.id ?: UUID.randomUUID().toString(),
                exerciseId = ex.exerciseId,
                setNo = row.setNo,
                side = row.side,
                weightKg = weight,
                reps = reps,
                loggedAt = now(), // a change counts as a newer log, so it wins when the sets are merged
                synced = false,
            )
            // Rest starts once the whole set is done (for left/right: after both sides), only for a new set.
            val other = if (row.side == "L") "R" else if (row.side == "R") "L" else null
            startRest = existing == null && (other == null || w.loggedAt(ex, Row(row.setNo, other)) != null)
            w.copy(sets = w.sets.filter { it.id != set.id } + set)
        }
        if (startRest) startRest(restSeconds(ex.planSet(row.setNo)?.targetRepsMax))
    }

    /** Deletes what was logged for a row (the row stays, empty). */
    fun deleteLogged(ex: PlanExercise, row: Row) {
        change { w ->
            val existing = w.loggedAt(ex, row) ?: return@change null
            w.copy(sets = w.sets.filter { it.id != existing.id }, deletedSetIds = w.deletedSetIds + existing.id)
        }
    }

    /** Takes an empty row off the list (both sides of a left/right set). */
    fun removeRow(ex: PlanExercise, row: Row) {
        change { w ->
            if (w.sets.any { it.exerciseId == ex.exerciseId && it.setNo == row.setNo }) return@change null // something is logged: delete that first
            val extra = w.extraSets[ex.exerciseId] ?: 0
            val planned = ex.sets.map { it.setNo }
            val isLastExtra = extra > 0 && row.setNo == (planned.maxOrNull() ?: 0) + extra
            if (isLastExtra) w.copy(extraSets = w.extraSets + (ex.exerciseId to extra - 1), liveRev = w.liveRev + 1)
            else w.copy(removedSets = w.removedSets + (ex.exerciseId to (w.removedSets[ex.exerciseId].orEmpty() + row.setNo)), liveRev = w.liveRev + 1)
        }
    }

    /** Machine taken: puts the exercise's backup in its place. Returns the id of the exercise now shown there, or null if nothing changed. */
    fun swapToBackup(ex: PlanExercise): String? {
        var now: String? = null
        change { w -> w.swapToBackup(ex.exerciseId)?.also { now = ex.backup?.exerciseId } }
        return now
    }

    fun addSet(ex: PlanExercise) {
        change { w -> w.addSetRow(ex.exerciseId) }
    }

    /** Ends the workout (with how it felt, 1 to 5, or null) and queues it for the server. It stays saved here until the server confirms. */
    fun finish(feeling: Int?) {
        synchronized(lock) {
            val w = workout ?: return
            store.queueForUpload(w.copy(endedAt = now(), feeling = feeling))
            cancelRest()
            workout = null
            screen = Screen.Routines
        }
        waiting = store.waitingCount()
        scheduleSync(0)
    }

    /** Throws the workout away here and, as soon as there is signal, everywhere. */
    fun discard() {
        synchronized(lock) {
            val w = workout ?: return
            store.addDiscard(w.id)
            hrStore.delete(w.id) // a workout thrown away has no heart rate to keep
            dropOpen()
        }
        scheduleSync(0)
    }

    fun exercise(id: String): PlanExercise? = workout?.exercise(id)

    /** One level up. Returns false at the top (routines), where the app should close. */
    fun back(): Boolean {
        screen = when (val s = screen) {
            Screen.Routines -> return false
            Screen.Overview -> Screen.Routines
            Screen.Feeling -> Screen.Overview
            Screen.AllDone -> Screen.Overview
            is Screen.Exercise -> Screen.Overview
            is Screen.Editor -> Screen.Exercise(s.exerciseId)
            is Screen.Rest -> s.from
        }
        return true
    }

    // ---- rest timer

    private fun startRest(seconds: Int) = runRest(System.currentTimeMillis() + seconds * 1000L)

    private fun runRest(endsAt: Long) {
        restJob?.cancel()
        restEndsAt = endsAt
        RestAlarm.schedule(getApplication(), endsAt) // vibrates on time even if the screen sleeps and the app is paused
        restJob = viewModelScope.launch {
            delay((endsAt - System.currentTimeMillis()).coerceAtLeast(0))
            delay(10_000) // "rest over" stays for a few seconds, then disappears (the vibration comes from RestAlarm, not from here)
            restEndsAt = null
        }
    }

    /** Adds or takes off seconds on the running rest (the phone's -15 and +15). */
    fun adjustRest(deltaSeconds: Int) {
        val ends = restEndsAt ?: return
        val now = System.currentTimeMillis()
        if (ends <= now && deltaSeconds < 0) return // already over: nothing to shorten
        runRest(maxOf(ends + deltaSeconds * 1000L, now))
    }

    fun skipRest() = cancelRest()

    /**
     * A tap on the rest chip. While the rest runs it opens the timer's screen. Once the rest is over (the gold "Rest over") there is
     * nothing left to control, so the tap just clears the chip and the plan and last-time numbers it was covering come back.
     */
    fun restChipTapped() {
        if (restIsOver(restEndsAt, System.currentTimeMillis())) cancelRest() else openRest()
    }

    /** Opens the rest timer's screen (only while resting). */
    fun openRest() {
        if (restEndsAt != null && screen !is Screen.Rest) screen = Screen.Rest(screen)
    }

    fun cancelRest() {
        restJob?.cancel()
        RestAlarm.cancel(getApplication())
        restEndsAt = null
    }
}
