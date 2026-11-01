package com.gymlogger.watch.data

import android.content.Context
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Keeps the open workout on the watch as a JSON file (written after every change), and finished workouts that are
 * waiting to be uploaded as one file each. Writes go to a temporary file first, so a power cut can't leave half a file.
 */
class WorkoutStore(context: Context) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val open = File(context.filesDir, "workout.json")
    private val waiting = File(context.filesDir, "waiting").apply { mkdirs() }

    private fun write(file: File, workout: Workout) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(json.encodeToString(workout))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    fun loadOpen(): Workout? = try {
        if (open.exists()) json.decodeFromString<Workout>(open.readText()) else null
    } catch (e: Exception) {
        null // a damaged file must not stop the app from opening
    }

    fun saveOpen(workout: Workout) = write(open, workout)

    fun clearOpen() { open.delete() }

    /** A finished workout: moved out of the open slot into the upload queue. */
    fun queueForUpload(workout: Workout) {
        write(File(waiting, "${workout.id}.json"), workout)
        clearOpen()
    }

    fun waitingCount(): Int = waiting.listFiles { f -> f.name.endsWith(".json") }?.size ?: 0
}
