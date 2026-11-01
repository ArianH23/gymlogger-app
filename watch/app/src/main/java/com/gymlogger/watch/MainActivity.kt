package com.gymlogger.watch

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import com.gymlogger.watch.ui.PairScreen
import com.gymlogger.watch.ui.RoutinesScreen

// The phone app's green on near-black, so the watch looks like the same app.
private val Accent = Color(0xFF4CC38A)
private val OnAccent = Color(0xFF08140E)

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = ColorScheme(primary = Accent, onPrimary = OnAccent)) {
                if (!vm.signedIn) {
                    PairScreen(busy = vm.pairBusy, error = vm.pairError, onPair = vm::pair)
                } else {
                    LaunchedEffect(Unit) { vm.loadRoutines() }
                    RoutinesScreen(routines = vm.routines, error = vm.routinesError, onRetry = vm::loadRoutines, onOpen = { /* next step */ })
                }
            }
        }
    }
}
