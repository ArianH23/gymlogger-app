package com.gymlogger.watch.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The shapes below mirror the phone app (web/src/lib/db.ts) and the JSON of the database function workout_start.
// The open workout is stored on the watch as one JSON file, so a killed app or a dead battery loses nothing.

@Serializable
data class PlanSet(
    @SerialName("set_no") val setNo: Int,
    @SerialName("target_weight_kg") val targetWeightKg: Double? = null,
    @SerialName("target_reps_min") val targetRepsMin: Int? = null,
    @SerialName("target_reps_max") val targetRepsMax: Int? = null,
    val note: String? = null,
)

/** What was done last time for one set number (left and right reps are separate for one-sided exercises). */
@Serializable
data class LastSet(
    @SerialName("set_no") val setNo: Int,
    @SerialName("weight_kg") val weightKg: Double? = null,
    @SerialName("reps_l") val repsL: Int? = null,
    @SerialName("reps_r") val repsR: Int? = null,
    @SerialName("reps_result") val repsResult: Int? = null,
)

@Serializable
data class PlanExercise(
    @SerialName("exercise_id") val exerciseId: String,
    val name: String,
    @SerialName("load_type") val loadType: String, // weighted | bodyweight | assisted
    val unilateral: Boolean = false,
    @SerialName("dumbbell_pair") val dumbbellPair: Boolean = false,
    @SerialName("increment_kg") val incrementKg: Double? = null,
    val sets: List<PlanSet> = emptyList(),
    val last: List<LastSet> = emptyList(),
)

/** The answer of rpc/workout_start. */
@Serializable
data class StartPayload(
    @SerialName("routine_id") val routineId: String,
    @SerialName("routine_name") val routineName: String,
    @SerialName("plan_by") val planBy: String? = null,
    val exercises: List<PlanExercise> = emptyList(),
)

@Serializable
data class LoggedSet(
    val id: String, // becomes sets.id in Supabase
    val exerciseId: String,
    val setNo: Int,
    val side: String? = null, // "L", "R" or null
    val weightKg: Double? = null,
    val reps: Int,
    val loggedAt: String,
)

@Serializable
data class Workout(
    val id: String, // becomes sessions.id in Supabase
    val routineId: String?,
    val title: String,
    val startedAt: String,
    val endedAt: String? = null,
    val plan: List<PlanExercise>,
    val extraSets: Map<String, Int> = emptyMap(), // exerciseId -> sets added with "+ Set"
    val removedSets: Map<String, List<Int>> = emptyMap(), // exerciseId -> set numbers taken off the list
    val sets: List<LoggedSet> = emptyList(),
    val feeling: Int? = null,
)
