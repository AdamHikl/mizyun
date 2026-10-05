package com.mizyun.workoutliveupdate

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CHANNEL_ID = "workout-live-update"
private const val NOTIFICATION_ID = 12601
internal const val PREFS_NAME = "workout-live-update"
internal const val ACTIVE_WORKOUT_ID = "active-workout-id"
internal const val SUPPRESSED_WORKOUT_ID = "suppressed-workout-id"
internal val notificationLock = Any()

class WorkoutLiveUpdateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WorkoutLiveUpdate")

    AsyncFunction("updateWorkoutLiveUpdate") { input: Map<String, Any?> ->
      val context = appContext.reactContext ?: return@AsyncFunction "fallback"
      synchronized(notificationLock) { postWorkoutNotification(context, input) }
    }

    AsyncFunction("dismissWorkoutLiveUpdate") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      synchronized(notificationLock) {
        val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        preferences.edit()
          .remove(ACTIVE_WORKOUT_ID)
          .apply()
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        true
      }
    }
  }

  private fun postWorkoutNotification(context: Context, input: Map<String, Any?>): String {
    if (Build.VERSION.SDK_INT < 36) return "fallback"
    // Each installed app can open only its own workout link scheme.
    val expectedScheme = when (context.packageName) {
      "com.mizyun.dev" -> "mizyun-dev"
      "com.mizyun.app" -> "mizyun"
      else -> return "fallback"
    }

    val workoutId = (input["workoutId"] as? String)?.takeIf { it.isNotBlank() } ?: return "fallback"
    val workoutName = (input["workoutName"] as? String)?.takeIf { it.isNotBlank() } ?: return "fallback"
    val deepLink = (input["deepLinkUrl"] as? String)?.let(Uri::parse) ?: return "fallback"
    val route = deepLink.path?.trim('/') ?: ""
    if (
      deepLink.scheme != expectedScheme ||
      (route != "log-workout" && deepLink.host != "log-workout") ||
      deepLink.getQueryParameter("workoutId") != workoutId
    ) return "fallback"

    val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    if (input["allowReshow"] == true) {
      preferences.edit().remove(SUPPRESSED_WORKOUT_ID).apply()
    } else if (preferences.getString(SUPPRESSED_WORKOUT_ID, null) == workoutId) {
      return "suppressed"
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return "fallback"
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return "fallback"

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Workout progress", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Active workout progress and rest countdown"
          setShowBadge(false)
        }
      )
      // Respect channel opt-outs, including the ordinary status channel used
      // by older app builds. A fallback on another channel would bypass them.
      if (manager.getNotificationChannel(CHANNEL_ID)?.importance == NotificationManager.IMPORTANCE_NONE ||
        manager.getNotificationChannel("active-workout-session")?.importance == NotificationManager.IMPORTANCE_NONE
      ) return "suppressed"
    }

    val contentIntent = PendingIntent.getActivity(
      context,
      NOTIFICATION_ID,
      Intent(Intent.ACTION_VIEW, deepLink).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val dismissIntent = PendingIntent.getBroadcast(
      context,
      NOTIFICATION_ID,
      Intent(context, WorkoutLiveUpdateDismissReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val exercise = (input["currentExerciseName"] as? String)?.takeIf { it.isNotBlank() }
    val nextSet = (input["nextSetSummary"] as? String)?.takeIf { it.isNotBlank() }
    val allCompleted = input["allPlannedSetsCompleted"] as? Boolean ?: false
    val completed = (input["completedSetsCount"] as? Number)?.toInt()?.coerceAtLeast(0) ?: 0
    val total = (input["totalPlannedSetsCount"] as? Number)?.toInt()?.takeIf { it > 0 }
    val summary = when {
      allCompleted -> "All planned sets completed"
      exercise != null && nextSet != null -> "$exercise · $nextSet"
      exercise != null -> exercise
      else -> "Workout in progress"
    }
    val progress = if (total != null) "$completed/$total sets" else "$completed sets"
    val restEndsAt = (input["restEndsAt"] as? Number)?.toLong()?.takeIf { it > System.currentTimeMillis() }

    val publicVersion = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_workout_status)
      .setContentTitle("Workout in progress")
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .build()

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_workout_status)
      .setContentTitle(workoutName)
      .setContentText(summary)
      .setSubText(progress)
      .setContentIntent(contentIntent)
      .setDeleteIntent(dismissIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion)

    if (restEndsAt != null) {
      builder.setWhen(restEndsAt)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
    } else {
      builder.setShowWhen(false)
      if (Build.VERSION.SDK_INT >= 36) builder.setShortCriticalText("Active")
    }

    if (Build.VERSION.SDK_INT >= 36 && manager.canPostPromotedNotifications()) {
      builder.setRequestPromotedOngoing(true)
    }

    return try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build())
      preferences.edit().putString(ACTIVE_WORKOUT_ID, workoutId).apply()
      "posted"
    } catch (_: SecurityException) {
      "fallback"
    }
  }
}
