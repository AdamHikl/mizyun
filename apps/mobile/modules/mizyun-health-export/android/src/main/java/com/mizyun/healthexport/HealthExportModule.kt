package com.mizyun.healthexport

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Mass
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

class HealthExportModule : Module() {
  private lateinit var permissionLauncher: AppContextActivityResultLauncher<HashSet<String>, Set<String>>
  private val stateLock = Any()
  private val operationMutex = Mutex()
  private val mutationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val mutationBusy = AtomicBoolean(false)
  private val generation = AtomicLong(0)
  private val authorizationGeneration = AtomicLong(0)
  private var permissionDeferred: CompletableDeferred<Set<String>>? = null
  private var permissionLaunchId: String? = null
  private val revisions = LinkedHashMap<String, Long>()
  @Volatile private var foreground = true

  override fun definition() = ModuleDefinition {
    Name("MizyunHealthExport")
    RegisterActivityContracts { permissionLauncher = registerForActivityResult(WriteHealthPermissionContract()) }
    AsyncFunction("availabilityAsync") Coroutine { -> availability() }
    AsyncFunction("installationIdAsync") Coroutine { -> installationId() }
    AsyncFunction("requestWritePermissionAsync") Coroutine { category: String -> requestPermission(category) }
    AsyncFunction("applyOperationAsync") Coroutine { raw: Map<String, Any?> -> apply(raw) }
    AsyncFunction("invalidateAsync") Coroutine { -> invalidate() }
    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground { foreground = false; invalidate(cancelPermission = false) }
    OnActivityDestroys { foreground = false; invalidate() }
    OnDestroy { invalidate() }
  }

  private fun result(
    status: String, acknowledged: List<String> = emptyList(), access: String = "unknown", code: String? = null
  ): Map<String, Any?> = buildMap {
    put("status", status); put("acknowledgedComponents", acknowledged); put("writeAccess", access)
    if (code != null) put("errorCode", code)
  }

  private fun availability(): Map<String, Any?> {
    // Resolve neither Health Connect nor java.time below the provider's OS floor.
    if (Build.VERSION.SDK_INT < 28) return result("unavailable")
    val context = appContext.reactContext ?: return result("unavailable")
    return try {
      when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> result("ready")
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> result("install_required")
        else -> result("unavailable")
      }
    } catch (_: Exception) { result("error", code = "availability_failed") }
  }

  private fun permission(category: String): String? = when (category) {
    "nutrition" -> HealthPermission.getWritePermission(NutritionRecord::class)
    "workout" -> HealthPermission.getWritePermission(ExerciseSessionRecord::class)
    else -> null
  }

  private suspend fun isForeground(): Boolean = withContext(Dispatchers.Main.immediate) {
    val activity = appContext.currentActivity
    foreground && activity != null && !activity.isFinishing && !activity.isDestroyed &&
      (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true
  }

  private suspend fun requestPermission(category: String): Map<String, Any?> {
    val requestGeneration = authorizationGeneration.get()
    val available = availability()
    if (available["status"] != "ready") return available
    val required = permission(category) ?: return result("error", code = "invalid_category")
    if (!isForeground()) return result("error", code = "foreground_required")
    val context = appContext.reactContext ?: return result("unavailable")
    var deferred: CompletableDeferred<Set<String>>? = null
    var launchId: String? = null
    var submitted = false
    return try {
      val client = HealthConnectClient.getOrCreate(context)
      val grantedAlready = withTimeout(30_000) { required in client.permissionController.getGrantedPermissions() }
      if (requestGeneration != authorizationGeneration.get()) return result("error", code = "permission_invalidated")
      if (grantedAlready) return result("ready", access = "granted")
      val request = CompletableDeferred<Set<String>>()
      val id = UUID.randomUUID().toString()
      synchronized(stateLock) {
        if (permissionLaunchId != null) return result("error", code = "permission_busy")
        permissionLaunchId = id; permissionDeferred = request
      }
      deferred = request; launchId = id
      withContext(Dispatchers.Main.immediate) {
        if (!::permissionLauncher.isInitialized || !isForeground() || authorizationGeneration.get() != requestGeneration) {
          throw IllegalStateException("permission_invalidated")
        }
        permissionLauncher.launch(hashSetOf(required)) { granted ->
          synchronized(stateLock) {
            if (permissionLaunchId == id) {
              permissionLaunchId = null; permissionDeferred = null
              request.complete(granted)
            }
          }
        }
        submitted = true
      }
      val granted = withTimeout(120_000) { request.await() }
      if (requestGeneration != authorizationGeneration.get()) result("error", code = "permission_invalidated")
      else if (required in granted) result("ready", access = "granted")
      else result("permission_required", access = "denied")
    } catch (_: TimeoutCancellationException) { result("error", code = "permission_timeout") }
    catch (cancelled: CancellationException) { throw cancelled }
    catch (_: SecurityException) { result("permission_required", access = "denied") }
    catch (_: Exception) { result("error", code = "permission_request_failed") }
    finally {
      deferred?.cancel()
      synchronized(stateLock) {
        if (permissionLaunchId == launchId) {
          permissionDeferred = null
          // An outstanding sheet retains the gate until its original callback.
          if (!submitted) permissionLaunchId = null
        }
      }
    }
  }

  private suspend fun apply(raw: Map<String, Any?>): Map<String, Any?> {
    // Capture before queueing; a cleared job must never acquire the new generation.
    val requestGeneration = generation.get()
    if (!mutationBusy.compareAndSet(false, true)) return result("error", code = "operation_busy")
    val retired = AtomicBoolean(false)
    // Health Connect IPC may commit even if its awaiting coroutine is cancelled.
    // The independent task keeps the mutation gate until the provider returns;
    // timing out the JS waiter cannot permit a newer delete to race an old insert.
    val task = mutationScope.async {
      try { perform(raw, requestGeneration, retired) }
      finally { mutationBusy.set(false) }
    }
    return try { withTimeout(30_000) { task.await() } }
    catch (_: TimeoutCancellationException) {
      retired.set(true)
      result("error", code = "operation_timeout")
    } catch (cancelled: CancellationException) {
      retired.set(true)
      throw cancelled
    }
  }

  private suspend fun perform(
    raw: Map<String, Any?>, requestGeneration: Long, retired: AtomicBoolean
  ): Map<String, Any?> {
    return try {
      operationMutex.withLock {
        if (retired.get() || requestGeneration != generation.get()) {
          return@withLock result("error", code = "operation_invalidated")
        }
        val available = availability()
        if (available["status"] != "ready") return@withLock available
        val operation = ExportOperation.parse(raw) ?: return@withLock result("error", code = "invalid_operation")
        if (retired.get() || !isForeground() || requestGeneration != generation.get()) {
          return@withLock result("error", code = "operation_invalidated")
        }
        val required = permission(operation.category) ?: return@withLock result("error", code = "invalid_category")
        val context = appContext.reactContext ?: return@withLock result("unavailable")
        val client = HealthConnectClient.getOrCreate(context)
        if (required !in client.permissionController.getGrantedPermissions()) {
          return@withLock result("permission_required", access = "denied")
        }
        val prior = revisions[operation.platformClientId]
        if (prior != null && prior > operation.revision) return@withLock result("error", code = "stale_revision")
        if (revisions.size >= 512) revisions.remove(revisions.keys.first())
        revisions[operation.platformClientId] = operation.revision
        if (operation.type == "delete") {
          if (!operation.canVerifyDeletionHistory(Build.VERSION.SDK_INT, Instant.now())) {
            return@withLock result("error", code = "deletion_history_limited")
          }
          // Read only current-package records in this exact projection's
          // interval. WRITE permits own-origin reads; never request READ.
          val existing = ownedRecords(client, context.packageName, operation, requestGeneration, retired)
          if (existing.any { it.metadata.clientRecordVersion > operation.revision }) {
            return@withLock result("error", code = "stale_revision")
          }
          if (retired.get() || !isForeground() || requestGeneration != generation.get()) {
            return@withLock result("error", code = "operation_invalidated")
          }
          if (required !in client.permissionController.getGrantedPermissions()) {
            return@withLock result("permission_required", access = "denied")
          }
          if (existing.isNotEmpty()) {
            val ids = existing.map { it.metadata.id }
            if (operation.category == "nutrition") client.deleteRecords(NutritionRecord::class, ids, emptyList())
            else client.deleteRecords(ExerciseSessionRecord::class, ids, emptyList())
          }
          // Successful scoped absence also acknowledges lost-response replay.
        } else {
          if (retired.get() || !isForeground() || requestGeneration != generation.get()) {
            return@withLock result("error", code = "operation_invalidated")
          }
          val metadata = Metadata.manualEntry(
            clientRecordId = operation.platformClientId, clientRecordVersion = operation.revision
          )
          val record: Record = if (operation.category == "nutrition") NutritionRecord(
            startTime = operation.start, endTime = operation.end,
            startZoneOffset = null, endZoneOffset = null, metadata = metadata,
            energy = operation.values["energyKcal"]?.let { Energy.kilocalories(it) },
            protein = operation.values["proteinG"]?.let { Mass.grams(it) },
            totalCarbohydrate = operation.values["carbsG"]?.let { Mass.grams(it) },
            totalFat = operation.values["fatG"]?.let { Mass.grams(it) }
          ) else ExerciseSessionRecord(
            startTime = operation.start, endTime = operation.end,
            startZoneOffset = null, endZoneOffset = null, metadata = metadata,
            exerciseType = ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING
          )
          // Package-scoped client ID + revision provides replacement/replay.
          client.insertRecords(listOf(record))
        }
        if (retired.get() || !isForeground() || generation.get() != requestGeneration) {
          return@withLock result("error", code = "operation_invalidated")
        }
        if (required !in client.permissionController.getGrantedPermissions()) {
          return@withLock result("permission_required", access = "denied")
        }
        result("ready", acknowledged = listOf(operation.category), access = "granted")
      }
    } catch (cancelled: CancellationException) { throw cancelled }
    catch (_: SecurityException) { result("permission_required", access = "denied") }
    catch (_: Exception) { result("error", code = "operation_unverified") }
  }

  private suspend fun ownedRecords(
    client: HealthConnectClient, packageName: String, operation: ExportOperation, requestGeneration: Long,
    retired: AtomicBoolean
  ): List<Record> {
    val matching = mutableListOf<Record>()
    var token: String? = null
    var pages = 0
    do {
      if (retired.get() || !isForeground() || generation.get() != requestGeneration) {
        throw IllegalStateException("operation_invalidated")
      }
      val origin = setOf(DataOrigin(packageName))
      val range = TimeRangeFilter.between(operation.start, operation.end)
      val records: List<Record>
      if (operation.category == "nutrition") {
        val response = client.readRecords(ReadRecordsRequest(
          recordType = NutritionRecord::class, timeRangeFilter = range,
          dataOriginFilter = origin, pageSize = 100, pageToken = token
        ))
        records = response.records; token = response.pageToken?.takeIf { it.isNotEmpty() }
      } else {
        val response = client.readRecords(ReadRecordsRequest(
          recordType = ExerciseSessionRecord::class, timeRangeFilter = range,
          dataOriginFilter = origin, pageSize = 100, pageToken = token
        ))
        records = response.records; token = response.pageToken?.takeIf { it.isNotEmpty() }
      }
      matching += records.filter { record: Record ->
        record.metadata.dataOrigin.packageName == packageName && record.metadata.clientRecordId == operation.platformClientId
      }
      pages += 1
      if (pages >= 10 && token != null) throw IllegalStateException("owned_record_limit")
    } while (token != null)
    return matching
  }

  private fun installationId(): String? = synchronized(stateLock) {
    val context = appContext.reactContext ?: return@synchronized null
    try {
      val file = File(context.noBackupFilesDir, "mizyun-health-export-install-id")
      if (file.exists()) {
        val value = file.readText().trim()
        if (value.length == 36 && UUID.fromString(value).toString() == value) return@synchronized value
        return@synchronized null
      }
      val value = UUID.randomUUID().toString()
      val temporary = File(context.noBackupFilesDir, "mizyun-health-export-install-id.tmp")
      temporary.writeText(value)
      if (!temporary.renameTo(file)) { temporary.delete(); return@synchronized null }
      value
    } catch (_: Exception) { null }
  }

  private fun invalidate(cancelPermission: Boolean = true) {
    synchronized(stateLock) {
      generation.incrementAndGet()
      if (cancelPermission) {
        authorizationGeneration.incrementAndGet()
        permissionDeferred?.completeExceptionally(IllegalStateException("permission_invalidated"))
        permissionDeferred = null
      }
    }
  }
}

private class WriteHealthPermissionContract : AppContextActivityResultContract<HashSet<String>, Set<String>> {
  private val delegate by lazy { PermissionController.createRequestPermissionResultContract() }
  override fun createIntent(context: Context, input: HashSet<String>): Intent = delegate.createIntent(context, input)
  override fun parseResult(input: HashSet<String>, resultCode: Int, intent: Intent?): Set<String> =
    delegate.parseResult(resultCode, intent)
}
