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
