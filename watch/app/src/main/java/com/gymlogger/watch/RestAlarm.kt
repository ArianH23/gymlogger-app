package com.gymlogger.watch

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.VibrationEffect
import android.os.VibratorManager

/**
 * The rest timer's vibration, handed to Android's alarm service. The screen can sleep and the app can be paused while you rest;
 * the alarm still goes off on time, which an ordinary in-app timer would not (the watch stops its processor to save battery).
 */
object RestAlarm {
    private fun pending(context: Context): PendingIntent =
        PendingIntent.getBroadcast(context, 1, Intent(context, RestAlarmReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun schedule(context: Context, endsAtMs: Long) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        try {
            if (alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAtMs, pending(context))
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAtMs, pending(context)) // a little late at worst, never a crash
        } catch (e: SecurityException) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAtMs, pending(context))
        }
    }

    fun cancel(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(pending(context))
    }

    fun vibrate(context: Context) {
        val vibrator = context.getSystemService(VibratorManager::class.java).defaultVibrator
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 400, 150, 400), -1))
    }
}

/** Runs when the rest ends. Vibrates unless the alarm switch (on the rest screen) is off. */
class RestAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val on = context.getSharedPreferences("settings", Context.MODE_PRIVATE).getBoolean("restAlarm", true)
        if (on) RestAlarm.vibrate(context)
    }
}
