package com.mizyun.healthsteps

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.time.Instant

private val readStepsPermission: String
  get() = HealthPermission.getReadPermission(StepsRecord::class)

class HealthStepsModule : Module() {
  private lateinit var permissionLauncher: AppContextActivityResultLauncher<HashSet<String>, Set<String>>

  override fun definition() = ModuleDefinition {
    Name("MizyunHealthSteps")

    RegisterActivityContracts {
      permissionLauncher = registerForActivityResult(ReadStepsPermissionContract())
    }

    AsyncFunction("getAvailability") Coroutine { ->
      val context = appContext.reactContext ?: return@Coroutine "unavailable"
      if (Build.VERSION.SDK_INT < 28) return@Coroutine "unavailable"
      when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> "available"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "install_required"
        else -> "unavailable"
      }
    }

    AsyncFunction("requestReadPermission") Coroutine { ->
      val context = appContext.reactContext ?: return@Coroutine false
      if (Build.VERSION.SDK_INT < 28) return@Coroutine false
      if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
        return@Coroutine false
      }
      try {
        val client = HealthConnectClient.getOrCreate(context)
        if (readStepsPermission in client.permissionController.getGrantedPermissions()) {
          return@Coroutine true
        }
        permissionLauncher.launch(hashSetOf(readStepsPermission))
        readStepsPermission in client.permissionController.getGrantedPermissions()
      } catch (_: SecurityException) {
        false
      }
    }

    AsyncFunction("getDailySteps") Coroutine { startEpochMs: Double, endEpochMs: Double ->
      val context = appContext.reactContext ?: return@Coroutine null
      if (Build.VERSION.SDK_INT < 28) return@Coroutine null
      if (!startEpochMs.isFinite() || !endEpochMs.isFinite() || endEpochMs <= startEpochMs) {
        return@Coroutine null
      }
      if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
        return@Coroutine null
      }
      try {
        val client = HealthConnectClient.getOrCreate(context)
        if (readStepsPermission !in client.permissionController.getGrantedPermissions()) {
          return@Coroutine null
        }
        val response = client.aggregate(
          AggregateRequest(
            metrics = setOf(StepsRecord.COUNT_TOTAL),
            timeRangeFilter = TimeRangeFilter.between(
              Instant.ofEpochMilli(startEpochMs.toLong()),
              Instant.ofEpochMilli(endEpochMs.toLong())
            )
          )
        )
        response[StepsRecord.COUNT_TOTAL]?.toDouble()
      } catch (_: SecurityException) {
        // Permission can be revoked between the grant check and the read.
        null
      }
    }
  }
}

private class ReadStepsPermissionContract : AppContextActivityResultContract<HashSet<String>, Set<String>> {
  private val delegate by lazy { PermissionController.createRequestPermissionResultContract() }

  override fun createIntent(context: Context, input: HashSet<String>): Intent =
    delegate.createIntent(context, input)

  override fun parseResult(input: HashSet<String>, resultCode: Int, intent: Intent?): Set<String> =
    delegate.parseResult(resultCode, intent)
}
