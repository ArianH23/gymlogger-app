package com.gymlogger.watch.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row as LayoutRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.OutlinedButton
import androidx.wear.compose.material3.PickerGroup
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.rememberPickerState
import com.gymlogger.watch.data.PlanExercise
import com.gymlogger.watch.data.Row
import com.gymlogger.watch.data.Workout
import com.gymlogger.watch.data.closestIndex
import com.gymlogger.watch.data.defaults
import com.gymlogger.watch.data.lastText
import com.gymlogger.watch.data.loggedAt
import com.gymlogger.watch.data.nextOpenRow
import com.gymlogger.watch.data.num
import com.gymlogger.watch.data.planSet
import com.gymlogger.watch.data.progress
import com.gymlogger.watch.data.rows
import com.gymlogger.watch.data.setText
import com.gymlogger.watch.data.stepKg
import com.gymlogger.watch.data.targetText
import com.gymlogger.watch.data.weightOptions
import kotlinx.coroutines.delay

private fun mmss(ms: Long): String {
    val s = (ms + 999) / 1000
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
}

private fun Row.label() = if (side == null) "Set $setNo" else "Set $setNo · $side"

/** "Rest 1:12", counting down; "Rest over" when it reaches zero (the watch vibrates then). Nothing when not resting. */
@Composable
fun RestChip(endsAt: Long?) {
    if (endsAt == null) return
    var now by remember(endsAt) { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(endsAt) {
        while (true) {
            now = System.currentTimeMillis()
            delay(250)
        }
    }
    val left = (endsAt - now).coerceAtLeast(0)
    Text(
        if (left == 0L) "Rest over" else "Rest ${mmss(left)}",
        color = MaterialTheme.colorScheme.primary,
        style = MaterialTheme.typography.labelMedium,
    )
}

/** The exercises of the open workout, with how many sets of each are done. */
@Composable
fun OverviewScreen(workout: Workout, restEndsAt: Long?, online: Boolean, onOpen: (PlanExercise) -> Unit, onFinish: () -> Unit, onDiscard: () -> Unit) {
    var confirmDiscard by remember { mutableStateOf(false) }
    ScalingLazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item { ListHeader { Text(workout.title) } }
        item { RestChip(restEndsAt) }
        if (!online) item { Text("Offline: saved on the watch", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        val current = workout.plan.firstOrNull { workout.progress(it).let { (d, t) -> d < t } }
        items(workout.plan) { ex ->
            val (done, total) = workout.progress(ex)
            val all = done == total && total > 0
            val label: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = { Text(ex.name, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            val secondary: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = { Text(if (all) "✓ $done sets" else "$done / $total sets") }
            if (ex != current) FilledTonalButton(onClick = { onOpen(ex) }, modifier = Modifier.fillMaxWidth(), label = label, secondaryLabel = secondary)
            else Button(onClick = { onOpen(ex) }, modifier = Modifier.fillMaxWidth(), label = label, secondaryLabel = secondary)
        }
        item { OutlinedButton(onClick = onFinish, modifier = Modifier.fillMaxWidth()) { Text("Finish workout") } }
        item {
            OutlinedButton(onClick = { if (confirmDiscard) onDiscard() else confirmDiscard = true }, modifier = Modifier.fillMaxWidth()) {
                Text(if (confirmDiscard) "Tap again to discard" else "Discard")
            }
        }
    }
}

/** The sets of one exercise: tap one to log or change it. */
@Composable
fun ExerciseScreen(workout: Workout, ex: PlanExercise, restEndsAt: Long?, onOpenRow: (Row) -> Unit, onAddSet: () -> Unit) {
    val next = workout.nextOpenRow(ex)
    ScalingLazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item { ListHeader { Text(ex.name, maxLines = 2, overflow = TextOverflow.Ellipsis) } }
        item { RestChip(restEndsAt) }
        items(workout.rows(ex)) { row ->
            val logged = workout.loggedAt(ex, row)
            val plan = ex.planSet(row.setNo)?.targetText()
            val last = ex.lastText(row)
            val secondary = when {
                logged != null -> "✓ ${setText(logged.weightKg, logged.reps)}"
                else -> listOfNotNull(plan?.let { "plan $it" }, last?.let { "last $it" }).joinToString(" · ").ifEmpty { "no target" }
            }
            val label: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = { Text(row.label()) }
            val sec: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = { Text(secondary, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            if (logged == null && row == next) Button(onClick = { onOpenRow(row) }, modifier = Modifier.fillMaxWidth(), label = label, secondaryLabel = sec)
            else FilledTonalButton(onClick = { onOpenRow(row) }, modifier = Modifier.fillMaxWidth(), label = label, secondaryLabel = sec)
        }
        item { OutlinedButton(onClick = onAddSet, modifier = Modifier.fillMaxWidth()) { Text("+ Set") } }
    }
}

/**
 * The set editor: a weight wheel and a reps wheel, both started at the plan (or last time). Turn the crown to change
 * the focused wheel, tap the other wheel to switch to it, or drag either one with a finger. There is no keyboard.
 */
@Composable
fun EditorScreen(
    workout: Workout,
    ex: PlanExercise,
    row: Row,
    restEndsAt: Long?,
    onLog: (weight: Double?, reps: Int) -> Unit,
    onDelete: () -> Unit,
    onRemove: () -> Unit,
) {
    val logged = workout.loggedAt(ex, row)
    val (planWeight, planReps) = workout.defaults(ex, row)
    val startWeight = logged?.weightKg ?: planWeight
    val startReps = logged?.reps ?: planReps
    val hasWeight = ex.loadType != "bodyweight"
    val weights = remember { weightOptions(startWeight, ex.stepKg()) }
    val weightWheel = rememberPickerState(initialNumberOfOptions = weights.size, initiallySelectedIndex = weights.closestIndex(startWeight), shouldRepeatOptions = false)
    val repsWheel = rememberPickerState(initialNumberOfOptions = MAX_REPS + 1, initiallySelectedIndex = startReps.coerceIn(0, MAX_REPS), shouldRepeatOptions = false)
    var repsFocused by remember { mutableStateOf(!hasWeight) }

    val plan = ex.planSet(row.setNo)?.targetText()
    val last = ex.lastText(row)

    Column(Modifier.fillMaxSize().padding(top = 22.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(ex.name, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 40.dp))
        Text(
            row.label() + (last?.let { " · last $it" } ?: ""),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 32.dp),
        )
        if (restEndsAt != null) RestChip(restEndsAt)
        else if (plan != null) Text("plan $plan", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

        PickerGroup(selectedPickerState = if (repsFocused) repsWheel else weightWheel, autoCenter = false, modifier = Modifier.weight(1f).padding(vertical = 2.dp)) {
            if (hasWeight) {
                PickerGroupItem(
                    pickerState = weightWheel,
                    selected = !repsFocused,
                    onSelected = { repsFocused = false },
                    contentDescription = { "Weight in kilograms" },
                    option = { index, selected -> WheelNumber(num(weights[index]), selected, width = 76) },
                )
            }
            PickerGroupItem(
                pickerState = repsWheel,
                selected = repsFocused,
                onSelected = { repsFocused = true },
                contentDescription = { "Reps" },
                option = { index, selected -> WheelNumber(index.toString(), selected, width = 52) },
            )
        }

        LayoutRow(Modifier.height(42.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(
                onClick = { onLog(if (hasWeight) weights[weightWheel.selectedOptionIndex] else null, repsWheel.selectedOptionIndex) },
                modifier = Modifier.width(86.dp).height(42.dp),
            ) { Text(if (logged != null) "Save" else "Log") }
            FilledTonalButton(
                onClick = if (logged != null) onDelete else onRemove,
                modifier = Modifier.width(46.dp).height(42.dp),
            ) { Text("✕") }
        }
    }
}

private const val MAX_REPS = 60

@Composable
private fun androidx.wear.compose.material3.PickerScope.WheelNumber(text: String, selected: Boolean, width: Int) {
    Box(Modifier.height(36.dp).width(width.dp), contentAlignment = Alignment.Center) {
        Text(
            text,
            style = MaterialTheme.typography.numeralSmall,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private val FEELINGS = listOf("Awful", "Rough", "Normal", "Good", "Great")

/** Shown when you finish: how did the session feel, 1 to 5 (optional). Claude reads it next to the score when planning. */
@Composable
fun FeelingScreen(onDone: (Int?) -> Unit) {
    val wheel = rememberPickerState(initialNumberOfOptions = FEELINGS.size, initiallySelectedIndex = 2, shouldRepeatOptions = false)
    Column(Modifier.fillMaxSize().padding(top = 22.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("How did it feel?", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        PickerGroup(selectedPickerState = wheel, autoCenter = false, modifier = Modifier.weight(1f).padding(vertical = 2.dp)) {
            PickerGroupItem(
                pickerState = wheel,
                selected = true,
                onSelected = {},
                contentDescription = { "Feeling from 1 to 5" },
                option = { index, selected ->
                    Box(Modifier.height(36.dp).width(130.dp), contentAlignment = Alignment.Center) {
                        Text(
                            "${index + 1} · ${FEELINGS[index]}",
                            style = MaterialTheme.typography.titleMedium,
                            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
            )
        }
        LayoutRow(Modifier.height(42.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(onClick = { onDone(wheel.selectedOptionIndex + 1) }, modifier = Modifier.width(86.dp).height(42.dp)) { Text("Finish") }
            FilledTonalButton(onClick = { onDone(null) }, modifier = Modifier.width(66.dp).height(42.dp)) { Text("Skip") }
        }
    }
}
