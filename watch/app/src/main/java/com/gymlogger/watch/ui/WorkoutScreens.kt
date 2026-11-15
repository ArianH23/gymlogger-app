package com.gymlogger.watch.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row as LayoutRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
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
import com.gymlogger.watch.data.WeightHint
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
import com.gymlogger.watch.data.weightHint
import com.gymlogger.watch.data.weightOptions
import kotlinx.coroutines.delay

private fun mmss(ms: Long): String {
    val s = (ms + 999) / 1000
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
}

private fun Row.label() = if (side == null) "Set $setNo" else "Set $setNo · $side"

/** The top of the screen during a workout: the time of day, how long the workout has been going, and the heart rate when it is being recorded ("19:42 · 24:10 · ♥ 132"). */
@Composable
fun WorkoutClock(startedAt: String, modifier: Modifier = Modifier) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    val started = remember(startedAt) { java.time.Instant.parse(startedAt).toEpochMilli() }
    val seconds = ((now - started) / 1000).coerceAtLeast(0)
    val elapsed = if (seconds >= 3600) "${seconds / 3600}:${(seconds % 3600 / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}"
    else "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
    val time = java.time.LocalTime.now().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
    val bpm by com.gymlogger.watch.HeartRate.bpm.collectAsState()
    LayoutRow(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(time, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(elapsed, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        bpm?.let { Text("\u2665 $it", style = MaterialTheme.typography.labelSmall, color = Danger) }
    }
}

/** Milliseconds left of the rest, updating four times a second; null when not resting. */
@Composable
private fun restLeft(endsAt: Long?): Long? {
    if (endsAt == null) return null
    var now by remember(endsAt) { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(endsAt) {
        while (true) {
            now = System.currentTimeMillis()
            delay(250)
        }
    }
    return (endsAt - now).coerceAtLeast(0)
}

/** Goes gently between full and dimmed, about once a second: what "rest over" uses to catch the eye. */
@Composable
private fun pulse(): Float {
    val transition = rememberInfiniteTransition(label = "rest over")
    val alpha by transition.animateFloat(1f, 0.72f, infiniteRepeatable(tween(550), RepeatMode.Reverse), label = "pulse")
    return alpha
}

/**
 * "Rest 1:12", counting down in the usual green. When it reaches zero (the watch vibrates then) it turns into a gold
 * pill that says "Rest over" and pulses, so it is hard to miss. Tap it for the rest timer's controls.
 */
@Composable
fun RestChip(endsAt: Long?, onClick: () -> Unit) {
    val left = restLeft(endsAt) ?: return
    if (left == 0L) {
        Text(
            "Rest over",
            color = MaterialTheme.colorScheme.onSecondary,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .clickable(onClick = onClick)
                .background(MaterialTheme.colorScheme.secondary.copy(alpha = pulse()), RoundedCornerShape(50))
                .padding(horizontal = 14.dp, vertical = 5.dp),
        )
    } else {
        Text(
            "Rest ${mmss(left)}",
            color = MaterialTheme.colorScheme.primary,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 4.dp),
        )
    }
}

/** The rest timer: the countdown, -15 / +15, Skip, and whether the watch vibrates at the end. */
@Composable
fun RestScreen(endsAt: Long?, alarmOn: Boolean, onAdjust: (Int) -> Unit, onToggleAlarm: () -> Unit, onSkip: () -> Unit) {
    val left = restLeft(endsAt)
    val over = left == null || left == 0L
    val gold = MaterialTheme.colorScheme.secondary.copy(alpha = if (over) pulse() else 1f)
    Column(Modifier.fillMaxSize().padding(top = 22.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Rest", style = MaterialTheme.typography.labelMedium, color = if (over) gold else MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            if (over) "Over" else mmss(left ?: 0),
            style = MaterialTheme.typography.numeralLarge,
            color = if (over) gold else MaterialTheme.colorScheme.primary, // gold and pulsing once the rest is over
        )
        LayoutRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilledTonalButton(onClick = { onAdjust(-15) }, modifier = Modifier.width(58.dp).height(40.dp)) { Text("-15") }
            Button(onClick = onSkip, modifier = Modifier.width(62.dp).height(40.dp)) { Text("Skip") }
            FilledTonalButton(onClick = { onAdjust(15) }, modifier = Modifier.width(58.dp).height(40.dp)) { Text("+15") }
        }
        OutlinedButton(onClick = onToggleAlarm, modifier = Modifier.width(128.dp).height(40.dp)) { Text(if (alarmOn) "Alarm: on" else "Alarm: off") }
    }
}

/** The exercises of the open workout, with how many sets of each are done. */
@Composable
fun OverviewScreen(workout: Workout, restEndsAt: Long?, onRest: () -> Unit, online: Boolean, onOpen: (PlanExercise) -> Unit, onFinish: () -> Unit, onDiscard: () -> Unit) {
    var confirmDiscard by remember { mutableStateOf(false) }
    ScalingLazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item { ListHeader { Text(workout.title) } }
        item { RestChip(restEndsAt, onRest) }
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
fun ExerciseScreen(workout: Workout, ex: PlanExercise, restEndsAt: Long?, onRest: () -> Unit, nextExercise: PlanExercise?, onNextExercise: () -> Unit, onOpenRow: (Row) -> Unit, onAddSet: () -> Unit) {
    val next = workout.nextOpenRow(ex)
    ScalingLazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item { ListHeader { Text(ex.name, maxLines = 2, overflow = TextOverflow.Ellipsis) } }
        item { RestChip(restEndsAt, onRest) }
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
        if (nextExercise != null) {
            item {
                val done = next == null // this exercise is finished: make the way on obvious
                val label: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = { Text("Next exercise ›") }
                val secondary: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = { Text(nextExercise.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                if (done) Button(onClick = onNextExercise, modifier = Modifier.fillMaxWidth(), label = label, secondaryLabel = secondary)
                else FilledTonalButton(onClick = onNextExercise, modifier = Modifier.fillMaxWidth(), label = label, secondaryLabel = secondary)
            }
        }
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
    onRest: () -> Unit,
    onPrev: (() -> Unit)?,
    onNext: (() -> Unit)?,
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
    val startIndex = remember { weights.closestIndex(startWeight) }
    val weightWheel = rememberPickerState(initialNumberOfOptions = weights.size, initiallySelectedIndex = startIndex, shouldRepeatOptions = false)

    // After a set: should the weight go up (blue) or down (red) for this one? A few blinks, then an arrow beside the number
    // until you move the weight the suggested way.
    val hint = remember { if (hasWeight) workout.weightHint(ex, row) else null }
    var blinkOn by remember { mutableStateOf(false) }
    LaunchedEffect(hint) {
        if (hint != null) repeat(3) {
            blinkOn = true
            delay(380)
            blinkOn = false
            delay(280)
        }
    }
    val moved = weightWheel.selectedOptionIndex - startIndex
    val acted = (hint == WeightHint.UP && moved > 0) || (hint == WeightHint.DOWN && moved < 0)
    val hintColor = if (hint == WeightHint.UP) HintUp else HintDown
    val repsWheel = rememberPickerState(initialNumberOfOptions = MAX_REPS + 1, initiallySelectedIndex = startReps.coerceIn(0, MAX_REPS), shouldRepeatOptions = false)
    var repsFocused by remember { mutableStateOf(!hasWeight) }

    val plan = ex.planSet(row.setNo)?.targetText()
    val last = ex.lastText(row)

    Column(Modifier.fillMaxSize().padding(top = 22.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(ex.name, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 40.dp))
        LayoutRow(verticalAlignment = Alignment.CenterVertically) {
            StepArrow("‹", onPrev)
            Text(row.label(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            StepArrow("›", onNext)
        }
        val info = listOfNotNull(plan?.let { "plan $it" }, last?.let { "last $it" }).joinToString(" · ")
        if (restEndsAt != null) RestChip(restEndsAt, onRest)
        else if (info.isNotEmpty()) Text(info, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 30.dp))

        PickerGroup(selectedPickerState = if (repsFocused) repsWheel else weightWheel, autoCenter = false, modifier = Modifier.weight(1f).padding(vertical = 2.dp)) {
            if (hasWeight) {
                PickerGroupItem(
                    pickerState = weightWheel,
                    selected = !repsFocused,
                    onSelected = { repsFocused = false },
                    contentDescription = { "Weight in kilograms" },
                    option = { index, selected ->
                        val centered = index == weightWheel.selectedOptionIndex
                        WheelNumber(
                            num(weights[index]), selected, width = 116, unit = if (ex.loadType == "assisted") "assist" else "kg",
                            arrow = if (centered && hint != null && !acted) (if (hint == WeightHint.UP) "▲" else "▼") else null,
                            accent = hintColor,
                            tint = if (centered && blinkOn && hint != null) hintColor else null,
                        )
                    },
                )
            }
            PickerGroupItem(
                pickerState = repsWheel,
                selected = repsFocused,
                onSelected = { repsFocused = true },
                contentDescription = { "Reps" },
                option = { index, selected -> WheelNumber(index.toString(), selected, width = 70, unit = "reps") },
            )
        }

        LayoutRow(Modifier.height(42.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(
                onClick = { onLog(if (hasWeight) weights[weightWheel.selectedOptionIndex] else null, repsWheel.selectedOptionIndex) },
                modifier = Modifier.width(70.dp).height(42.dp),
            ) { Text(if (logged != null) "Save" else "Log") }
            FilledTonalButton(
                onClick = if (logged != null) onDelete else onRemove,
                modifier = Modifier.width(if (logged != null) 84.dp else 46.dp).height(42.dp),
            ) { Text(if (logged != null) "Unlog" else "✕") }
        }
    }
}

private const val MAX_REPS = 60

private val HintUp = Color(0xFF5AB0FF) // blue: go heavier
private val HintDown = Color(0xFFFF6B6B) // red: go lighter

/** A "‹" or "›" beside the set number: go to the previous or next set. Dimmed when there is none. */
@Composable
private fun StepArrow(symbol: String, onClick: (() -> Unit)?) {
    Text(
        symbol,
        style = MaterialTheme.typography.titleMedium,
        color = if (onClick != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f),
        modifier = Modifier.clickable(enabled = onClick != null) { onClick?.invoke() }.padding(horizontal = 16.dp, vertical = 2.dp),
    )
}

/** One value of a wheel with its unit beside it ("40 kg", "6 reps"), so it is always clear which wheel is which. */
@Composable
private fun androidx.wear.compose.material3.PickerScope.WheelNumber(
    text: String,
    selected: Boolean,
    width: Int,
    unit: String,
    arrow: String? = null, // a hint arrow to the left of the number
    accent: Color = Color.Unspecified, // the arrow's colour
    tint: Color? = null, // while blinking, the number takes this colour
) {
    val color = tint ?: if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Box(Modifier.height(36.dp).width(width.dp), contentAlignment = Alignment.Center) {
        LayoutRow(verticalAlignment = Alignment.Bottom) {
            if (arrow != null) Text(arrow, style = MaterialTheme.typography.labelMedium, color = accent, modifier = Modifier.padding(end = 5.dp, bottom = 6.dp))
            Text(text, style = MaterialTheme.typography.numeralSmall, color = color)
            Text(" $unit", style = MaterialTheme.typography.labelSmall, color = color, modifier = Modifier.padding(bottom = 5.dp))
        }
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

/** Every set is logged: offer to finish right away (like Hevy), or carry on. */
@Composable
fun AllDoneScreen(onFinish: () -> Unit, onNotYet: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(top = 26.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("All sets done", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
        Text("Finish the workout?", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
        Button(onClick = onFinish, modifier = Modifier.width(150.dp).height(44.dp)) { Text("Finish") }
        FilledTonalButton(onClick = onNotYet, modifier = Modifier.width(150.dp).height(44.dp).padding(top = 6.dp)) { Text("Not yet") }
    }
}
