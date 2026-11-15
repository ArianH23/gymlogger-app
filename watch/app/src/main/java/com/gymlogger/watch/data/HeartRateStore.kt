package com.gymlogger.watch.data

import android.content.Context
import java.io.File

/** One heart rate reading: when (milliseconds since 1970) and how many beats per minute. */
data class HrSample(val atMs: Long, val bpm: Int)

/**
 * Of the new readings, the ones worth keeping: at most one every [everyMs] (the sensor gives one a second, which is far
 * more than a chart needs), counting from the last one kept before, [lastKeptMs]. Readings that are not a real heart
 * rate (0 while the sensor is still searching) are dropped.
 */
fun thinHr(readings: List<HrSample>, lastKeptMs: Long, everyMs: Long = 5000): List<HrSample> {
    var last = lastKeptMs
    val kept = mutableListOf<HrSample>()
    for (r in readings.sortedBy { it.atMs }) {
        if (r.bpm !in 30..250 || r.atMs - last < everyMs) continue
        kept += r
        last = r.atMs
    }
    return kept
}

/** The readings as the database wants them: [[seconds from the start of the session, bpm], ...]. Readings from before the start are left out. */
fun hrSamplesJson(samples: List<HrSample>, startedAtMs: Long): String =
    samples.filter { it.atMs >= startedAtMs }
        .joinToString(",", "[", "]") { "[${(it.atMs - startedAtMs) / 1000},${it.bpm}]" }

/**
 * The heart rate of each workout, kept on the watch as a small text file until the server has it: the first line is
 * when the workout started, then one "time,bpm" line per reading. Appending a line at a time means a power cut loses
 * at most the last reading.
 */
class HeartRateStore(context: Context) {
    private val dir = File(context.filesDir, "hr").apply { mkdirs() }
    private fun file(id: String) = File(dir, "$id.csv")

    /** Starts the file of a workout (does nothing if it is already there, so recording can resume after a restart). */
    @Synchronized
    fun begin(id: String, startedAtMs: Long) {
        val f = file(id)
        if (!f.exists()) f.writeText("start,$startedAtMs\n")
    }

    @Synchronized
    fun append(id: String, samples: List<HrSample>) {
        if (samples.isEmpty()) return
        val f = file(id)
        if (!f.exists()) return // the workout was thrown away meanwhile
        f.appendText(samples.joinToString("") { "${it.atMs},${it.bpm}\n" })
    }

    /** When the workout started and its readings, or null if there is no usable file. */
    @Synchronized
    fun read(id: String): Pair<Long, List<HrSample>>? {
        val lines = try { file(id).readLines() } catch (e: Exception) { return null }
        val start = lines.firstOrNull()?.removePrefix("start,")?.toLongOrNull() ?: return null
        val samples = lines.drop(1).mapNotNull { line ->
            val parts = line.split(",")
            val at = parts.getOrNull(0)?.toLongOrNull()
            val bpm = parts.getOrNull(1)?.toIntOrNull()
            if (at != null && bpm != null) HrSample(at, bpm) else null
        }
        return start to samples
    }

    /** The time of the last reading kept for a workout (0 if none), so thinning carries on after a restart. */
    fun lastAt(id: String): Long = read(id)?.second?.lastOrNull()?.atMs ?: 0

    /** The workouts that have heart rate waiting here. */
    fun ids(): List<String> = dir.listFiles { f -> f.name.endsWith(".csv") }.orEmpty().map { it.name.removeSuffix(".csv") }

    @Synchronized
    fun delete(id: String) { file(id).delete() }
}
