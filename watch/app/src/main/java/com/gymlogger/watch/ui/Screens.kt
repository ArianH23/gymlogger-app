package com.gymlogger.watch.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.PickerGroup
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.rememberPickerState
import com.gymlogger.watch.data.RoutineItem

private val Error = Color(0xFFFF7A7A)

/** The 6 digits made on the phone ("Pair watch" on the Body tab), picked with wheels: crown or finger drag. */
@Composable
fun PairScreen(busy: Boolean, error: String?, onPair: (String) -> Unit) {
    val wheels = List(6) { rememberPickerState(initialNumberOfOptions = 10, initiallySelectedIndex = 0, shouldRepeatOptions = true) }
    var focused by remember { mutableIntStateOf(0) }

    Column(Modifier.fillMaxSize().padding(top = 14.dp, bottom = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(if (error != null) error else "Phone code", color = if (error != null) Error else MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
        PickerGroup(selectedPickerState = wheels[focused], autoCenter = false, modifier = Modifier.weight(1f).padding(vertical = 2.dp)) {
            wheels.forEachIndexed { i, state ->
                PickerGroupItem(
                    pickerState = state,
                    selected = focused == i,
                    onSelected = { focused = i },
                    contentDescription = { "Digit ${i + 1}" },
                    option = { index, selected ->
                        Box(Modifier.height(36.dp).width(22.dp), contentAlignment = Alignment.Center) {
                            Text(
                                index.toString(),
                                style = MaterialTheme.typography.numeralSmall,
                                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    },
                )
            }
        }
        Button(
            onClick = { onPair(wheels.joinToString("") { it.selectedOptionIndex.toString() }) },
            enabled = !busy,
            modifier = Modifier.height(44.dp),
        ) { Text(if (busy) "Pairing…" else "Pair") }
    }
}

@Composable
fun RoutinesScreen(routines: List<RoutineItem>?, error: String?, onRetry: () -> Unit, onOpen: (RoutineItem) -> Unit) {
    ScalingLazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item { ListHeader { Text("Routines") } }
        when {
            error != null -> {
                item { Text(error, color = Error, textAlign = TextAlign.Center) }
                item { FilledTonalButton(onClick = onRetry) { Text("Try again") } }
            }
            routines == null -> item { Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            else -> items(routines) { r ->
                if (r.isNext) {
                    Button(onClick = { onOpen(r) }, modifier = Modifier.fillMaxWidth(), label = { Text(r.name) }, secondaryLabel = { Text("Next up") })
                } else {
                    FilledTonalButton(onClick = { onOpen(r) }, modifier = Modifier.fillMaxWidth(), label = { Text(r.name) })
                }
            }
        }
    }
}
