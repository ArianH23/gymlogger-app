package com.gymlogger.watch

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.concurrent.futures.await
import androidx.core.app.ServiceCompat
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseTrackedStatus
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import com.gymlogger.watch.data.HeartRateStore
import com.gymlogger.watch.data.HrSample
import com.gymlogger.watch.data.thinHr
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import kotlin.math.roundToInt

/**
 * Heart rate during a workout. While a workout is open on the watch, [HeartRateService] records it with Wear OS Health
 * Services (which keeps sampling with the screen off and hands the readings over in batches, to save battery) and keeps
 * it in [HeartRateStore] until the workout is uploaded.
 */
object HeartRate {
    /** The latest reading, for the screen; null when not recording or not found yet. */
    val bpm = MutableStateFlow<Int?>(null)

    /** The workout being recorded right now, if any. Its file is still growing, so it is not uploaded yet. */
    @Volatile
    var activeId: String? = null

    /** Called when a recording has ended and its last readings are saved (the app then uploads them). */
    @Volatile
    var onStopped: (() -> Unit)? = null

    /** Wear OS 6 has its own heart rate permission; before that it was the general body sensors one. */
    val permission: String
        get() = if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS

    fun hasPermission(context: Context) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    /** Starts recording for a workout (or carries on, if it is already running). Does nothing without the permission. */
    fun start(context: Context, workoutId: String, title: String, startedAtMs: Long) {
        if (!hasPermission(context) || activeId == workoutId) return
        val intent = Intent(context, HeartRateService::class.java)
            .setAction(HeartRateService.START)
            .putExtra("id", workoutId).putExtra("title", title).putExtra("startedAt", startedAtMs)
        try {
            context.startForegroundService(intent)
        } catch (e: Exception) {
            // not allowed right now (the app is not on screen): the workout goes on without heart rate
        }
    }

    /** Ends the recording: the service saves what the sensor still holds, then stops. */
    fun stop(context: Context) {
        if (activeId == null) return
        try {
            context.startService(Intent(context, HeartRateService::class.java).setAction(HeartRateService.STOP))
        } catch (e: Exception) {
            // the service is already gone
        }
    }
}

class HeartRateService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val store by lazy { HeartRateStore(this) }
    private val client: ExerciseClient by lazy { HealthServices.getClient(this).exerciseClient }
    private var workoutId: String? = null
    private var lastKeptMs = 0L
    private var stopping = false
    private var owned = false // true once the Health Services exercise is ours (only then may we end it)

    private val callback = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            val id = workoutId ?: return
            // Readings are stamped with the time since the watch booted: turn that into a calendar time.
            val boot = Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())
            val readings = update.latestMetrics.getData(DataType.HEART_RATE_BPM)
                .map { HrSample(it.getTimeInstant(boot).toEpochMilli(), it.value.roundToInt()) }
            val kept = thinHr(readings, lastKeptMs)
            if (kept.isNotEmpty()) {
                lastKeptMs = kept.last().atMs
                store.append(id, kept)
            }
            readings.lastOrNull { it.bpm in 30..250 }?.let { HeartRate.bpm.value = it.bpm }
        }

        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) {}
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            finish()
            return START_NOT_STICKY
        }
        val id = intent?.getStringExtra("id")
        if (id == null) { // nothing to record
            stopSelf()
            return START_NOT_STICKY
        }
        val startedAt = intent.getLongExtra("startedAt", System.currentTimeMillis())
        // A foreground service must show a notification: it is the same "workout going on" one, not a second one.
        val notification = OngoingWorkout.notification(this, intent.getStringExtra("title") ?: "Workout", startedAt)
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH else 0
        try {
            ServiceCompat.startForeground(this, OngoingWorkout.ID, notification, type)
        } catch (e: Exception) { // the permission was taken away, or the system refuses right now
            stopSelf()
            return START_NOT_STICKY
        }
        if (workoutId != id) {
            workoutId = id
            stopping = false
            owned = false
            HeartRate.activeId = id
            store.begin(id, startedAt)
            lastKeptMs = store.lastAt(id)
            scope.launch { record() }
        }
        return START_REDELIVER_INTENT // if the system restarts the service, it carries on with the same workout
    }

    /** Starts the heart rate "exercise" in Health Services, or picks up one of ours that is still running. */
    private suspend fun record() {
        try {
            client.setUpdateCallback(callback)
            when (client.getCurrentExerciseInfoAsync().await().exerciseTrackedStatus) {
                ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS -> {
                    owned = true // ours, from before a restart: the callback is enough
                    return
                }
                ExerciseTrackedStatus.OTHER_APP_IN_PROGRESS -> {
                    // Another app (Google Health, say) is tracking a workout and only one can at a time. Starting ours
                    // would end theirs, so this workout goes without heart rate.
                    finish()
                    return
                }
                else -> {}
            }
            val capabilities = client.getCapabilitiesAsync().await()
            val type = listOf(ExerciseType.STRENGTH_TRAINING, ExerciseType.WORKOUT).firstOrNull {
                it in capabilities.supportedExerciseTypes &&
                    DataType.HEART_RATE_BPM in capabilities.getExerciseTypeCapabilities(it).supportedDataTypes
            }
            if (type == null) { // this watch cannot give heart rate for a workout
                finish()
                return
            }
            client.startExerciseAsync(
                ExerciseConfig(
                    exerciseType = type,
                    dataTypes = setOf(DataType.HEART_RATE_BPM),
                    isAutoPauseAndResumeEnabled = false,
                    isGpsEnabled = false,
                ),
            ).await()
            owned = true
        } catch (e: Exception) {
            finish() // Health Services is not available or refused: no heart rate, the workout itself is unaffected
        }
    }

    /** Asks the sensor for the readings it still holds, ends the exercise and stops. */
    private fun finish() {
        if (stopping) return
        stopping = true
        scope.launch {
            if (owned) {
                try { client.flushAsync().await() } catch (e: Exception) {}
                try { client.endExerciseAsync().await() } catch (e: Exception) {}
            }
            try { client.clearUpdateCallbackAsync(callback).await() } catch (e: Exception) {}
            stopSelf()
        }
    }

    override fun onDestroy() {
        scope.cancel()
        workoutId = null
        HeartRate.activeId = null
        HeartRate.bpm.value = null
        HeartRate.onStopped?.invoke()
        super.onDestroy()
    }

    companion object {
        const val START = "com.gymlogger.watch.hr.START"
        const val STOP = "com.gymlogger.watch.hr.STOP"
    }
}
