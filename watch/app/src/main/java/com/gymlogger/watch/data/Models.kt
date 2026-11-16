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
    // What to do instead when the machine is taken (set on the routine). Swapping puts it in this place, with this one as its backup.
    val backup: PlanExercise? = null,
    val swapped: Boolean = false, // true = this is the backup, standing in for the planned exercise (now in [backup])
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
    val synced: Boolean = false, // true once the server has this set (and it matches)
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
    // Sharing the open workout with the phone (see Sync.kt and the database function sync_workout):
    val deletedSetIds: List<String> = emptyList(), // sets deleted here that the server may still have
    val liveRev: Int = 0, // bumped when the plan layout (extra and removed sets) changes here
    val liveSyncedRev: Int = 0, // the liveRev the server has seen
    val liveSeenAt: String? = null, // the server's live_updated_at we last adopted
    val detached: Boolean = false, // another workout was already open elsewhere: this one uploads when it is finished
    val syncedAt: String? = null,
)

/** The plan layout of the open workout, as the server stores it in sessions.live. */
@Serializable
data class Live(
    val plan: List<PlanExercise> = emptyList(),
    @SerialName("extra_sets") val extraSets: Map<String, Int> = emptyMap(),
    @SerialName("removed_sets") val removedSets: Map<String, List<Int>> = emptyMap(),
)

@Serializable
data class ServerSet(
    val id: String,
    @SerialName("exercise_id") val exerciseId: String,
    @SerialName("set_no") val setNo: Int,
    val side: String? = null,
    @SerialName("weight_kg") val weightKg: Double? = null,
    val reps: Int = 0,
    @SerialName("logged_at") val loggedAt: String,
)

@Serializable
data class ServerWorkout(
    val id: String,
    @SerialName("routine_id") val routineId: String? = null,
    val title: String,
    @SerialName("started_at") val startedAt: String,
    @SerialName("ended_at") val endedAt: String? = null,
    val feeling: Int? = null,
    val live: Live? = null,
    @SerialName("live_updated_at") val liveUpdatedAt: String? = null,
    val sets: List<ServerSet> = emptyList(),
)

/** The answer of rpc/sync_workout: ok, finished, deleted, or other_open (a different workout is already open). */
@Serializable
data class SyncResult(val status: String, val workout: ServerWorkout? = null)
