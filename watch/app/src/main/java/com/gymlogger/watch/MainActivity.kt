package com.gymlogger.watch

import android.Manifest
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import java.time.Instant
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.wear.compose.material3.MaterialTheme
import com.gymlogger.watch.data.PlanExercise
import com.gymlogger.watch.data.Row
import com.gymlogger.watch.data.canSwap
import com.gymlogger.watch.data.loggedAt
import com.gymlogger.watch.data.nextExercise
import com.gymlogger.watch.data.nextOpenAfter
import com.gymlogger.watch.data.step
import com.gymlogger.watch.ui.AllDoneScreen
import com.gymlogger.watch.ui.EditorScreen
import com.gymlogger.watch.ui.ExerciseScreen
import com.gymlogger.watch.ui.FeelingScreen
import com.gymlogger.watch.ui.OverviewScreen
import com.gymlogger.watch.ui.PairScreen
import com.gymlogger.watch.ui.RestScreen
import com.gymlogger.watch.ui.WorkoutClock
import com.gymlogger.watch.ui.RoutinesScreen
import com.gymlogger.watch.ui.GymColors

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    // Android asks once for permission to show the "workout going on" indicator.
    // and for the heart rate sensor. Both are optional: a workout works without either.
    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        vm.permissionsAnswered()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Keep the watch and the phone in step: now, and every few seconds while the app is on screen.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    vm.syncNow()
                    delay(6000)
                }
            }
        }
        setContent {
            MaterialTheme(colorScheme = GymColors) {
                if (!vm.signedIn) {
                    PairScreen(busy = vm.pairBusy, error = vm.pairError, onPair = vm::pair)
                } else {
                    LaunchedEffect(Unit) { vm.loadRoutines() }
                    BackHandler(enabled = vm.screen != Screen.Routines) { vm.back() }
                    LaunchedEffect(vm.workout != null) {
                        if (vm.workout != null) {
                            val missing = listOfNotNull(
                                Manifest.permission.POST_NOTIFICATIONS.takeIf { !OngoingWorkout.hasPermission(this@MainActivity) },
                                HeartRate.permission.takeIf { !HeartRate.hasPermission(this@MainActivity) },
                            )
                            if (missing.isNotEmpty()) askPermissions.launch(missing.toTypedArray())
                        }
                    }
                    // When the rest has ended and cleared, leave its screen.
                    LaunchedEffect(vm.restEndsAt) { if (vm.restEndsAt == null && vm.screen is Screen.Rest) vm.back() }
                    Box(Modifier.fillMaxSize()) {
                        SignedInContent()
                        // During a workout: the time, how long it has been going and the heart rate, along the top edge of every workout screen.
                        vm.workout?.let { w ->
                            if (vm.screen != Screen.Routines) WorkoutClock(w.startedAt)
                        }
                    }
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun SignedInContent() {
        val w = vm.workout
        when (val s = vm.screen) {
            Screen.Routines -> RoutinesScreen(
                routines = vm.routines,
                error = vm.routinesError,
                openTitle = w?.title,
                startingId = vm.startingId,
                waiting = vm.waiting,
                onRetry = vm::loadRoutines,
                onStart = vm::start,
                onResume = { vm.screen = Screen.Overview },
            )
            Screen.Overview -> if (w != null) OverviewScreen(
                workout = w,
                restEndsAt = vm.restEndsAt,
                onRest = vm::openRest,
                online = vm.online,
                onOpen = { ex -> vm.screen = Screen.Exercise(ex.exerciseId) },
                onFinish = { vm.screen = Screen.Feeling },
                onDiscard = vm::discard,
            )
            Screen.Feeling -> FeelingScreen(onDone = vm::finish)
            Screen.AllDone -> AllDoneScreen(onFinish = { vm.screen = Screen.Feeling }, onNotYet = { vm.screen = Screen.Overview })
            is Screen.Rest -> RestScreen(
                endsAt = vm.restEndsAt,
                alarmOn = vm.alarmOn,
                onAdjust = vm::adjustRest,
                onToggleAlarm = vm::toggleAlarm,
                onSkip = { vm.skipRest(); vm.back() },
            )
            is Screen.Exercise -> {
                val ex = vm.exercise(s.exerciseId)
                if (w != null && ex != null) ExerciseScreen(
                    workout = w,
                    ex = ex,
                    restEndsAt = vm.restEndsAt,
                    onRest = vm::openRest,
                    nextExercise = w.nextExercise(ex.exerciseId),
                    onNextExercise = { w.nextExercise(ex.exerciseId)?.let { vm.screen = Screen.Exercise(it.exerciseId) } },
                    onOpenRow = { row -> vm.screen = Screen.Editor(ex.exerciseId, row) },
                    onAddSet = { vm.addSet(ex) },
                    onSwap = if (w.canSwap(ex)) ({ vm.swapToBackup(ex)?.let { vm.screen = Screen.Exercise(it) } }) else null,
                )
            }
            is Screen.Editor -> {
                val ex = vm.exercise(s.exerciseId)
                if (w != null && ex != null) androidx.compose.runtime.key(s.exerciseId, s.row) {
                    EditorScreen(
                        workout = w,
                        ex = ex,
                        row = s.row,
                        restEndsAt = vm.restEndsAt,
                        onRest = vm::openRest,
                        onPrev = w.step(ex.exerciseId, s.row, -1)?.let { (e, r) -> { vm.screen = Screen.Editor(e.exerciseId, r) } },
                        onNext = w.step(ex.exerciseId, s.row, 1)?.let { (e, r) -> { vm.screen = Screen.Editor(e.exerciseId, r) } },
                        onLog = { weight, reps -> logAndAdvance(ex, s.row, weight, reps) },
                        onDelete = { vm.deleteLogged(ex, s.row); vm.screen = Screen.Exercise(ex.exerciseId) },
                        onRemove = { vm.removeRow(ex, s.row); vm.screen = Screen.Exercise(ex.exerciseId) },
                    )
                }
            }
        }
    }

    /** Logs the set, then moves on to the next empty set of the exercise, or back to its list when it is done. */
    private fun logAndAdvance(ex: PlanExercise, row: Row, weight: Double?, reps: Int) {
        val wasNew = vm.workout?.loggedAt(ex, row) == null
        vm.logSet(ex, row, weight, reps)
        val updated = vm.workout ?: return
        val next = updated.nextOpenAfter(ex.exerciseId, row)
        vm.screen = when {
            !wasNew -> Screen.Exercise(ex.exerciseId) // a change to a set already logged: back to the list
            next != null -> Screen.Editor(next.first.exerciseId, next.second) // on to the next empty set, in the next exercise if this one is done
            else -> Screen.AllDone // that was the last one
        }
    }
}
