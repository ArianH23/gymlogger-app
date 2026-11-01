package com.gymlogger.watch

import android.app.Application
import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.gymlogger.watch.data.Api
import com.gymlogger.watch.data.LoggedSet
import com.gymlogger.watch.data.PairResult
import com.gymlogger.watch.data.PlanExercise
import com.gymlogger.watch.data.Row
import com.gymlogger.watch.data.RoutineItem
import com.gymlogger.watch.data.Workout
import com.gymlogger.watch.data.WorkoutStore
import com.gymlogger.watch.data.exercise
import com.gymlogger.watch.data.loggedAt
import com.gymlogger.watch.data.planSet
import com.gymlogger.watch.data.restSeconds
import com.gymlogger.watch.data.routines
import com.gymlogger.watch.data.workoutStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException
import java.time.Instant
import java.util.UUID

/** Where you are in the app. Back goes one level up: set -> exercise -> workout -> routines. */
sealed interface Screen {
    data object Routines : Screen
    data object Overview : Screen
    data class Exercise(val exerciseId: String) : Screen
    data class Editor(val exerciseId: String, val row: Row) : Screen
}

/** What the screens show. The data lives in [Api], the database and the on-watch [WorkoutStore]; this holds what is on screen. */
class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val api = Api(app)
    private val store = WorkoutStore(app)

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

    /** When the rest after the last set ends (ms since 1970), shown as a countdown; null when not resting. */
    var restEndsAt by mutableStateOf<Long?>(null)
        private set
    private var restJob: Job? = null

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

    // ---- the workout

    private fun update(w: Workout) {
        store.saveOpen(w) // on disk before anything else, so nothing logged can be lost
        workout = w
    }

    /** Starts a workout on a routine. Only one can be open at a time: with one open, this just returns to it. */
    fun start(routine: RoutineItem) {
        if (workout != null) {
            screen = Screen.Overview
            return
        }
        startingId = routine.id
        routinesError = null
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val plan = api.workoutStart(routine.id)
                update(
                    Workout(
                        id = UUID.randomUUID().toString(),
                        routineId = routine.id,
                        title = plan.routineName,
                        startedAt = Instant.now().toString(),
                        plan = plan.exercises,
                    ),
                )
                screen = Screen.Overview
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

    /** Logs (or, for a row that already has a set, replaces) one set. Returns false if there was nothing to log. */
    fun logSet(ex: PlanExercise, row: Row, weight: Double?, reps: Int) {
        val w = workout ?: return
        val existing = w.loggedAt(ex, row)
        val set = LoggedSet(
            id = existing?.id ?: UUID.randomUUID().toString(),
            exerciseId = ex.exerciseId,
            setNo = row.setNo,
            side = row.side,
            weightKg = weight,
            reps = reps,
            loggedAt = existing?.loggedAt ?: Instant.now().toString(),
        )
        update(w.copy(sets = w.sets.filter { it.id != set.id } + set))
        // Rest starts once the whole set is done (for left/right: after both sides), only for a new set.
        val other = if (row.side == "L") "R" else if (row.side == "R") "L" else null
        val complete = other == null || w.loggedAt(ex, Row(row.setNo, other)) != null
        if (existing == null && complete) startRest(restSeconds(ex.planSet(row.setNo)?.targetRepsMax))
    }

    /** Deletes what was logged for a row (the row stays, empty). */
    fun deleteLogged(ex: PlanExercise, row: Row) {
        val w = workout ?: return
        val existing = w.loggedAt(ex, row) ?: return
        update(w.copy(sets = w.sets.filter { it.id != existing.id }))
    }

    /** Takes an empty row off the list (both sides of a left/right set). */
    fun removeRow(ex: PlanExercise, row: Row) {
        val w = workout ?: return
        if (w.sets.any { it.exerciseId == ex.exerciseId && it.setNo == row.setNo }) return // something is logged: delete that first
        val extra = w.extraSets[ex.exerciseId] ?: 0
        val planned = ex.sets.map { it.setNo }
        val isLastExtra = extra > 0 && row.setNo == (planned.maxOrNull() ?: 0) + extra
        update(
            if (isLastExtra) w.copy(extraSets = w.extraSets + (ex.exerciseId to extra - 1))
            else w.copy(removedSets = w.removedSets + (ex.exerciseId to (w.removedSets[ex.exerciseId].orEmpty() + row.setNo))),
        )
    }

    fun addSet(ex: PlanExercise) {
        val w = workout ?: return
        update(w.copy(extraSets = w.extraSets + (ex.exerciseId to (w.extraSets[ex.exerciseId] ?: 0) + 1)))
    }

    /** Ends the workout and puts it in the upload queue (uploading comes in the next step). */
    fun finish() {
        val w = workout ?: return
        store.queueForUpload(w.copy(endedAt = Instant.now().toString()))
        cancelRest()
        workout = null
        screen = Screen.Routines
    }

    fun discard() {
        store.clearOpen()
        cancelRest()
        workout = null
        screen = Screen.Routines
    }

    fun exercise(id: String): PlanExercise? = workout?.exercise(id)

    /** One level up. Returns false at the top (routines), where the app should close. */
    fun back(): Boolean {
        screen = when (val s = screen) {
            Screen.Routines -> return false
            Screen.Overview -> Screen.Routines
            is Screen.Exercise -> Screen.Overview
            is Screen.Editor -> Screen.Exercise(s.exerciseId)
        }
        return true
    }

    // ---- rest timer

    private fun startRest(seconds: Int) {
        restJob?.cancel()
        restEndsAt = System.currentTimeMillis() + seconds * 1000L
        restJob = viewModelScope.launch {
            delay(seconds * 1000L)
            vibrate()
            delay(10_000) // "rest over" stays for a few seconds, then disappears
            restEndsAt = null
        }
    }

    fun cancelRest() {
        restJob?.cancel()
        restEndsAt = null
    }

    private fun vibrate() {
        val vibrator: Vibrator = getApplication<Application>().getSystemService(VibratorManager::class.java).defaultVibrator
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 400, 150, 400), -1))
    }
}
