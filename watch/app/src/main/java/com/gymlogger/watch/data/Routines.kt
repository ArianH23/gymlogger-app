package com.gymlogger.watch.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class RoutineItem(
    @SerialName("routine_id") val id: String,
    val name: String,
    @SerialName("is_next") val isNext: Boolean = false,
    @SerialName("last_started_at") val lastStartedAt: String? = null,
)

private val json = Json { ignoreUnknownKeys = true }

/** Everything needed to start a workout on a routine, in one call (exercises, targets, last time). */
fun Api.workoutStart(routineId: String): StartPayload =
    json.decodeFromString(post("rpc/workout_start", """{"p_routine_id":"$routineId"}"""))

/** The routines, "Next up" first, then in the order you set on the phone. */
fun Api.routines(): List<RoutineItem> {
    val text = get("routine_status?select=routine_id,name,is_next,last_started_at&order=position")
    return json.decodeFromString<List<RoutineItem>>(text).sortedByDescending { it.isNext }
}
