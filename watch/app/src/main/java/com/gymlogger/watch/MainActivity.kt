package com.gymlogger.watch

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import com.gymlogger.watch.data.PlanExercise
import com.gymlogger.watch.data.Row
import com.gymlogger.watch.data.nextOpenRow
import com.gymlogger.watch.ui.EditorScreen
import com.gymlogger.watch.ui.ExerciseScreen
import com.gymlogger.watch.ui.FeelingScreen
import com.gymlogger.watch.ui.OverviewScreen
import com.gymlogger.watch.ui.PairScreen
import com.gymlogger.watch.ui.RoutinesScreen

// The phone app's green on near-black, so the watch looks like the same app.
private val Accent = Color(0xFF4CC38A)
private val OnAccent = Color(0xFF08140E)

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

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
            MaterialTheme(colorScheme = ColorScheme(primary = Accent, onPrimary = OnAccent)) {
                if (!vm.signedIn) {
                    PairScreen(busy = vm.pairBusy, error = vm.pairError, onPair = vm::pair)
                } else {
                    LaunchedEffect(Unit) { vm.loadRoutines() }
                    // The screen stays on while a workout is open, so the numbers are there when you look at your wrist.
                    LaunchedEffect(vm.workout != null) {
                        if (vm.workout != null) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                    BackHandler(enabled = vm.screen != Screen.Routines) { vm.back() }
                    SignedInContent()
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
                online = vm.online,
                onOpen = { ex -> vm.screen = Screen.Exercise(ex.exerciseId) },
                onFinish = { vm.screen = Screen.Feeling },
                onDiscard = vm::discard,
            )
            Screen.Feeling -> FeelingScreen(onDone = vm::finish)
            is Screen.Exercise -> {
                val ex = vm.exercise(s.exerciseId)
                if (w != null && ex != null) ExerciseScreen(
                    workout = w,
                    ex = ex,
                    restEndsAt = vm.restEndsAt,
                    onOpenRow = { row -> vm.screen = Screen.Editor(ex.exerciseId, row) },
                    onAddSet = { vm.addSet(ex) },
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
        vm.logSet(ex, row, weight, reps)
        val updated = vm.workout ?: return
        val next = updated.nextOpenRow(ex, after = row)
        vm.screen = if (next != null) Screen.Editor(ex.exerciseId, next) else Screen.Exercise(ex.exerciseId)
    }
}
