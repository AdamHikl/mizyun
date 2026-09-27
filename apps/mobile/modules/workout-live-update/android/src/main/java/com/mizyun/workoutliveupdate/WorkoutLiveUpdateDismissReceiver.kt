package com.mizyun.workoutliveupdate

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class WorkoutLiveUpdateDismissReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    synchronized(notificationLock) {
      val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val activeWorkoutId = preferences.getString(ACTIVE_WORKOUT_ID, null) ?: return
      preferences.edit()
        .putString(SUPPRESSED_WORKOUT_ID, activeWorkoutId)
        .remove(ACTIVE_WORKOUT_ID)
        .apply()
    }
  }
}
