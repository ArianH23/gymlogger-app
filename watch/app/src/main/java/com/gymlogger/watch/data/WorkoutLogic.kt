package com.gymlogger.watch.data

import kotlin.math.abs
import kotlin.math.roundToInt

// The rules of a workout screen, kept free of any UI. They mirror the phone app (ActiveWorkout.tsx) so both behave the same.

/** One line of an exercise: a set number, and a side for one-sided exercises. */
data class Row(val setNo: Int, val side: String?)

const val DEFAULT_STEP_KG = 2.5

/** The sets of an exercise as they are listed: the plan's, plus the ones added, minus the ones removed. */
fun Workout.rows(ex: PlanExercise): List<Row> {
    val planned = ex.sets.map { it.setNo }
    val next = (planned.maxOrNull() ?: 0) + 1
    val extra = (0 until (extraSets[ex.exerciseId] ?: 0)).map { next + it }
    val removed = removedSets[ex.exerciseId].orEmpty().toSet()
    val sides = if (ex.unilateral) listOf("L", "R") else listOf(null)
    return (planned + extra).filter { it !in removed }.distinct().sorted().flatMap { n -> sides.map { Row(n, it) } }
}

/**
 * "+ Set": a set that was taken off comes back first (the lowest number), with its plan (the weight and reps to aim for), because a
 * plain extra set has no plan. With nothing taken off, one extra set is added at the end. The same as the phone's addSetRow.
 */
fun Workout.addSetRow(exerciseId: String): Workout {
    val removed = removedSets[exerciseId].orEmpty()
    if (removed.isNotEmpty()) {
        val back = removed.min()
        val rest = removed.filter { it != back }
        val next = if (rest.isEmpty()) removedSets - exerciseId else removedSets + (exerciseId to rest)
        return copy(removedSets = next, liveRev = liveRev + 1)
    }
    return copy(extraSets = extraSets + (exerciseId to (extraSets[exerciseId] ?: 0) + 1), liveRev = liveRev + 1)
}

fun Workout.loggedAt(ex: PlanExercise, row: Row): LoggedSet? =
    sets.firstOrNull { it.exerciseId == ex.exerciseId && it.setNo == row.setNo && it.side == row.side }

fun Workout.exercise(id: String): PlanExercise? = plan.firstOrNull { it.exerciseId == id }

/** The next row that has nothing logged yet, looking after [after] first and then from the top. */
fun Workout.nextOpenRow(ex: PlanExercise, after: Row? = null): Row? {
    val rows = rows(ex)
    val start = if (after == null) 0 else rows.indexOf(after) + 1
    return (rows.drop(start) + rows.take(start)).firstOrNull { loggedAt(ex, it) == null }
}

/** How many of this exercise's rows are logged, and how many there are. */
fun Workout.progress(ex: PlanExercise): Pair<Int, Int> {
    val rows = rows(ex)
    return rows.count { loggedAt(ex, it) != null } to rows.size
}

fun PlanExercise.planSet(setNo: Int): PlanSet? = sets.firstOrNull { it.setNo == setNo }

/** "Machine taken?" is offered while nothing is logged for the exercise, it has a backup, and the backup is not in the workout already. */
fun Workout.canSwap(ex: PlanExercise): Boolean {
    val backup = ex.backup ?: return false
    return sets.none { it.exerciseId == ex.exerciseId } && plan.none { it.exerciseId == backup.exerciseId }
}

/**
 * The workout with the exercise's backup in its place (the same rule as the phone). The planned exercise becomes the
 * backup's backup, so the same tap swaps it back. Sets added to or removed from the old exercise do not carry over.
 * Null when it cannot be swapped.
 */
fun Workout.swapToBackup(exerciseId: String): Workout? {
    val ex = exercise(exerciseId) ?: return null
    if (!canSwap(ex)) return null
    val backup = ex.backup ?: return null
    val swapped = backup.copy(backup = ex.copy(backup = null, swapped = false), swapped = !ex.swapped)
    return copy(
        plan = plan.map { if (it.exerciseId == exerciseId) swapped else it },
        extraSets = extraSets - exerciseId,
        removedSets = removedSets - exerciseId,
        liveRev = liveRev + 1,
    )
}

/** The step of the weight wheel: the exercise's own increment, or 2.5 kg when none is set. */
fun PlanExercise.stepKg(): Double = incrementKg?.takeIf { it > 0 } ?: DEFAULT_STEP_KG

/** Where the wheels start, as on the phone: the plan's weight and bottom of the rep range, else last time's. */
fun Workout.defaults(ex: PlanExercise, row: Row): Pair<Double?, Int> {
    val plan = ex.planSet(row.setNo)
    val lastPlannedWeight = ex.sets.lastOrNull { it.targetWeightKg != null }?.targetWeightKg
    val last = ex.last.firstOrNull { it.setNo == row.setNo } ?: ex.last.lastOrNull()
    var weight = plan?.targetWeightKg ?: lastPlannedWeight ?: last?.weightKg
    if (row.side == "R") loggedAt(ex, Row(row.setNo, "L"))?.let { weight = it.weightKg ?: weight } // same weight as the left side
    val lastReps = when (row.side) { "L" -> last?.repsL; "R" -> last?.repsR; else -> last?.repsResult }
    val reps = plan?.targetRepsMin ?: lastReps ?: 10
    return (if (ex.loadType == "bodyweight") null else weight) to reps
}

/** Values the weight wheel offers: [center] and steps of [step] around it, never below zero. */
fun weightOptions(center: Double?, step: Double): List<Double> {
    val c = center ?: 0.0
    return (-40..80).map { c + it * step }.filter { it >= 0 }.map { (it * 100).roundToInt() / 100.0 }.distinct().sorted()
}

fun List<Double>.closestIndex(value: Double?): Int =
    if (value == null) 0 else indices.minByOrNull { abs(this[it] - value) } ?: 0

/** How long to rest after a set, by the top of its rep range (the same rule as the phone). */
fun restSeconds(repsMax: Int?): Int = when {
    repsMax == null -> 90
    repsMax <= 10 -> 150
    repsMax <= 15 -> 90
    else -> 60
}

/** "44" or "7.5": a number without trailing zeros. */
fun num(n: Double?): String = if (n == null) "" else if (n % 1.0 == 0.0) n.toLong().toString() else n.toString().trimEnd('0').trimEnd('.')

/** "44×8" or "8" (bodyweight). */
fun setText(weight: Double?, reps: Int?): String = (if (weight == null) "" else num(weight) + "×") + (reps?.toString() ?: "–")

/** What was done last time for this row, e.g. "44×8", or null if there is no history. */
fun PlanExercise.lastText(row: Row): String? {
    val last = last.firstOrNull { it.setNo == row.setNo } ?: last.lastOrNull() ?: return null
    val reps = when (row.side) { "L" -> last.repsL; "R" -> last.repsR; else -> last.repsResult } ?: return null
    return setText(last.weightKg, reps)
}

/** The plan's target for a set, e.g. "44×6-10". */
fun PlanSet.targetText(): String? {
    val reps = when {
        targetRepsMin == null -> null
        targetRepsMax == null || targetRepsMax == targetRepsMin -> "$targetRepsMin"
        else -> "$targetRepsMin-$targetRepsMax"
    }
    if (targetWeightKg == null && reps == null) return null
    return (if (targetWeightKg == null) "" else num(targetWeightKg) + "×") + (reps ?: "")
}

/** Every set row of the workout in order: exercise by exercise, set by set. */
fun Workout.flatRows(): List<Pair<PlanExercise, Row>> = plan.flatMap { ex -> rows(ex).map { ex to it } }

private fun Workout.indexOfRow(exerciseId: String, row: Row): Int = flatRows().indexOfFirst { it.first.exerciseId == exerciseId && it.second == row }

/** The set [delta] places away (-1 = the one before, 1 = the one after), crossing into the next or previous exercise. Null at the ends. */
fun Workout.step(exerciseId: String, row: Row, delta: Int): Pair<PlanExercise, Row>? {
    val i = indexOfRow(exerciseId, row)
    return if (i < 0) null else flatRows().getOrNull(i + delta)
}

/** The next set with nothing logged, looking after this one first (across exercises) and then from the top. Null when every set is logged. */
fun Workout.nextOpenAfter(exerciseId: String, row: Row): Pair<PlanExercise, Row>? {
    val all = flatRows()
    val i = indexOfRow(exerciseId, row)
    val ordered = if (i < 0) all else all.drop(i + 1) + all.take(i)
    return ordered.firstOrNull { loggedAt(it.first, it.second) == null }
}

/** The exercise after this one, if any. */
fun Workout.nextExercise(exerciseId: String): PlanExercise? {
    val i = plan.indexOfFirst { it.exerciseId == exerciseId }
    return if (i < 0) null else plan.getOrNull(i + 1)
}

/** Which way the number on the weight wheel should move for the next set. For assisted exercises it is still the number: less assistance = a lower number. */
enum class WeightHint { UP, DOWN }

/**
 * Whether the next set should be heavier or lighter, judged by the reps of the set just done against its rep range:
 *  - more reps than the top of the range: the weight was too light, go up;
 *  - fewer than the bottom of the range: too heavy, go down;
 *  - inside the range, nothing.
 * With a single target number instead of a range (say 12), two reps above it means up and two below means down.
 * Assisted exercises are reversed: the same reps mean the opposite change of the number (more reps = less assistance).
 */
fun hintFor(loadType: String, reps: Int, repsMin: Int?, repsMax: Int?): WeightHint? {
    val lo = repsMin ?: return null
    val hi = repsMax ?: lo
    val raw = if (hi > lo) {
        when {
            reps > hi -> WeightHint.UP
            reps < lo -> WeightHint.DOWN
            else -> null
        }
    } else {
        when {
            reps >= lo + 2 -> WeightHint.UP
            reps <= lo - 2 -> WeightHint.DOWN
            else -> null
        }
    }
    return if (loadType == "assisted") raw?.let { if (it == WeightHint.UP) WeightHint.DOWN else WeightHint.UP } else raw
}

/**
 * The hint for a set that is still to do: from the nearest earlier set of this exercise that is completely logged
 * (both sides for a one-sided exercise, using the lower side). Null for bodyweight work, for a set already logged,
 * and when there is no earlier set to judge by.
 */
fun Workout.weightHint(ex: PlanExercise, row: Row): WeightHint? {
    if (ex.loadType == "bodyweight" || loggedAt(ex, row) != null) return null
    val sides: List<String?> = if (ex.unilateral) listOf("L", "R") else listOf(null)
    val previous = rows(ex).map { it.setNo }.distinct().filter { it < row.setNo }
        .lastOrNull { n -> sides.all { s -> loggedAt(ex, Row(n, s)) != null } } ?: return null
    val reps = sides.mapNotNull { s -> loggedAt(ex, Row(previous, s))?.reps }.minOrNull() ?: return null
    val target = ex.planSet(previous) ?: ex.sets.lastOrNull() ?: return null
    return hintFor(ex.loadType, reps, target.targetRepsMin, target.targetRepsMax)
}
