package com.gymlogger.watch

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status

/**
 * The "workout going on" indicator on the watch face (a Wear OS Ongoing Activity), like other workout apps have.
 * It shows while a workout is open, counts the time since it started, and tapping it returns to the app.
 */
object OngoingWorkout {
    private const val CHANNEL = "workout"
    private const val ID = 7

    fun hasPermission(context: Context) =
        Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun show(context: Context, title: String, startedAtMs: Long) {
        if (!hasPermission(context)) return
        val notifications = NotificationManagerCompat.from(context)
        notifications.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW).setName("Workout in progress").build(),
        )
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_workout)
            .setContentTitle(title)
            .setContentText("Workout going on")
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
        // The stopwatch counts from a moment on the "time since boot" clock, not from a calendar time: convert the start.
        val sinceStartMs = (System.currentTimeMillis() - startedAtMs).coerceAtLeast(0)
        val status = Status.Builder()
            .addTemplate("Workout #time#")
            .addPart("time", Status.StopwatchPart(SystemClock.elapsedRealtime() - sinceStartMs))
            .build()
        OngoingActivity.Builder(context, ID, builder)
            .setStaticIcon(R.drawable.ic_workout)
            .setTouchIntent(open)
            .setStatus(status)
            .build()
            .apply(context)
        notifications.notify(ID, builder.build())
    }

    fun hide(context: Context) = NotificationManagerCompat.from(context).cancel(ID)
}
