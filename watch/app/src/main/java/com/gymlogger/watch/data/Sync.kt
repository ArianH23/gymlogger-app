package com.gymlogger.watch.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.OffsetDateTime

// One database function, sync_workout, does all the merging between devices. The watch only sends its view of the workout and
// adopts the answer, exactly as the phone does (web/src/lib/sync.ts). Everything is safe to repeat.

private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

/** What a request carried, so the answer can be reconciled with changes made while it was in flight. */
data class Sent(val setIds: Set<String>, val deleted: List<String>, val rev: Int, val sentLive: Boolean)

fun Workout.liveChanged(): Boolean = liveRev > liveSyncedRev || liveSeenAt == null

fun Workout.toLive(): Live = Live(plan = plan, extraSets = extraSets, removedSets = removedSets)

/** The request body for rpc/sync_workout. Live is sent only when it changed here; ended_at and feeling when finished. */
fun Workout.syncPayload(sendLive: Boolean): String {
    val body: JsonObject = buildJsonObject {
        put("id", id)
        put("routine_id", routineId)
        put("title", title)
        put("started_at", startedAt)
        put("sets", buildJsonArray {
            sets.forEach { s ->
                add(buildJsonObject {
                    put("id", s.id)
                    put("exercise_id", s.exerciseId)
                    put("set_no", s.setNo)
                    put("side", s.side)
                    put("weight_kg", s.weightKg)
                    put("reps", s.reps)
                    put("is_warmup", false)
                    put("logged_at", s.loggedAt)
                })
            }
        })
        put("deleted_set_ids", buildJsonArray { deletedSetIds.forEach { add(json.encodeToJsonElement(it)) } })
        if (sendLive && endedAt == null) put("live", json.encodeToJsonElement(toLive()))
        if (endedAt != null) {
            put("ended_at", endedAt)
            put("feeling", feeling)
        }
    }
    return body.toString()
}

fun Api.syncWorkout(payload: String): SyncResult = json.decodeFromString(post("rpc/sync_workout", """{"p_workout":$payload}"""))

fun Api.syncDiscard(id: String): SyncResult = json.decodeFromString(post("rpc/sync_workout", """{"p_workout":{"id":"$id","discard":true}}"""))

/** The workout open on any device, or null. */
fun Api.openWorkout(): ServerWorkout? {
    val text = post("rpc/open_workout", "{}").trim()
    return if (text == "null" || text.isEmpty()) null else json.decodeFromString<ServerWorkout>(text)
}

private fun key(exerciseId: String, setNo: Int, side: String?) = "$exerciseId|$setNo|${side ?: ""}"

private fun instant(text: String): Instant = OffsetDateTime.parse(text).toInstant()

private fun ServerSet.toLogged() = LoggedSet(id, exerciseId, setNo, side, weightKg, reps, loggedAt, synced = true)

/**
 * Makes the local workout match the server's merged answer, keeping anything the user did while the call was in flight.
 * Pure (no I/O), so it behaves the same however it is called. Mirrors reconcile() in the phone's sync.ts.
 */
fun reconcile(w: Workout, server: ServerWorkout, sent: Sent, now: String): Workout {
    val serverByKey = server.sets.associateBy { key(it.exerciseId, it.setNo, it.side) }
    val pendingDeleted = w.deletedSetIds.filter { it !in sent.deleted }.toSet()
    val matched = mutableSetOf<String>()
    val kept = mutableListOf<LoggedSet>()

    for (local in w.sets) {
        val k = key(local.exerciseId, local.setNo, local.side)
        val s = serverByKey[k]
        if (s == null) {
            // Synced before but gone from the server, or just sent and refused (deleted wins): drop it here too.
            // A set logged during the call is kept; it goes out next time.
            if (!local.synced && local.id !in sent.setIds) kept += local
            continue
        }
        matched += k
        // The server's row wins unless this set was edited here while the call was in flight.
        kept += if (local.synced || instant(s.loggedAt) >= instant(local.loggedAt)) s.toLogged() else local
    }
    for ((k, s) in serverByKey) {
        if (k !in matched && s.id !in pendingDeleted) kept += s.toLogged() // logged on another device
    }

    var result = w.copy(sets = kept, deletedSetIds = pendingDeleted.toList())
    val live = server.live
    if (sent.sentLive) {
        result = result.copy(liveSeenAt = server.liveUpdatedAt, liveSyncedRev = sent.rev)
    } else if (live != null && server.liveUpdatedAt != w.liveSeenAt && w.liveRev == sent.rev) {
        // The plan layout changed on another device.
        result = result.copy(
            plan = live.plan, extraSets = live.extraSets, removedSets = live.removedSets,
            liveSeenAt = server.liveUpdatedAt, liveSyncedRev = w.liveRev,
        )
    }
    if (server.endedAt != null) {
        result = result.copy(endedAt = w.endedAt ?: server.endedAt, feeling = w.feeling ?: server.feeling, syncedAt = now)
    }
    return result
}

/** A workout started on another device, as the open workout here. Null if it cannot be shown (no plan layout stored). */
fun adoptRemote(server: ServerWorkout): Workout? {
    val live = server.live ?: return null
    if (server.endedAt != null) return null
    return Workout(
        id = server.id,
        routineId = server.routineId,
        title = server.title,
        startedAt = server.startedAt,
        plan = live.plan,
        extraSets = live.extraSets,
        removedSets = live.removedSets,
        sets = server.sets.map { it.toLogged() },
        feeling = server.feeling,
        liveRev = 0,
        liveSyncedRev = 0,
        liveSeenAt = server.liveUpdatedAt,
    )
}
