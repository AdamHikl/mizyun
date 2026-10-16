package com.mizyun.healthconnections

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

class HealthConnectionsModule : Module() {
  private lateinit var permissionLauncher: AppContextActivityResultLauncher<HashSet<String>, Set<String>>
  private val stateLock = Any()
  private val readMutex = Mutex()
  private val generation = AtomicLong(0)
  private val bindings = LinkedHashMap<String, PageBinding>()
  private var permissionDeferred: CompletableDeferred<Set<String>>? = null
  private var permissionLaunchId: String? = null
  @Volatile private var foreground = true
  private val ownSources = setOf("com.mizyun.app", "com.mizyun.development", "com.mizyun.dev")

  override fun definition() = ModuleDefinition {
    Name("MizyunHealthConnections")

    RegisterActivityContracts {
      permissionLauncher = registerForActivityResult(ReadHealthPermissionContract())
    }

    AsyncFunction("availabilityAsync") Coroutine { -> availability() }
    AsyncFunction("requestReadPermissionAsync") Coroutine { kind: String -> requestPermission(kind) }
    AsyncFunction("readPageAsync") Coroutine { kind: String, fromISO: String, toISO: String, token: String? ->
      readPage(kind, fromISO, toISO, token)
    }
    AsyncFunction("invalidateAsync") Coroutine { -> invalidate() }

    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground {
      foreground = false
      invalidate(cancelPermissionWait = false)
    }
    OnActivityDestroys {
      foreground = false
      invalidate()
      // An old system sheet may outlive Activity destruction. Do not allow a
      // second launch through the same registry key until that result arrives.
      cancelPermission(releaseLaunchGate = false)
    }
    OnDestroy {
      invalidate()
      cancelPermission(releaseLaunchGate = true)
    }
  }

  private fun result(
    status: String,
    records: List<Map<String, Any?>> = emptyList(),
    token: String? = null,
    access: String = "unknown",
    code: String? = null
  ): Map<String, Any?> = buildMap {
    put("status", status)
    put("records", records)
    put("nextPageToken", token)
    put("readAccess", access)
    if (code != null) put("errorCode", code)
  }

  /** The permission without which a kind cannot return any record. */
  private fun permission(kind: String): String? = when (kind) {
    "weight" -> HealthPermission.getReadPermission(WeightRecord::class)
    "workout", "run" -> HealthPermission.getReadPermission(ExerciseSessionRecord::class)
    else -> null
  }

  /** Every permission requested for a kind. Runs add only distance (no routes/heart rate/calories). */
  private fun requestedPermissions(kind: String): Set<String> {
    val required = permission(kind) ?: return emptySet()
    return if (kind == "run") setOf(required, HealthPermission.getReadPermission(DistanceRecord::class))
    else setOf(required)
  }

  private fun availability(): Map<String, Any?> {
    // Do not resolve Health Connect types/provider below its supported API floor.
    if (Build.VERSION.SDK_INT < 28) return result("unavailable")
    val context = appContext.reactContext ?: return result("unavailable")
    return try {
      when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> result("ready")
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> result("install_required")
        else -> result("unavailable")
      }
    } catch (_: Exception) {
      result("error", code = "availability_failed")
    }
  }

  private suspend fun isForeground(): Boolean = withContext(Dispatchers.Main.immediate) {
    val activity = appContext.currentActivity
    foreground && activity != null && !activity.isFinishing && !activity.isDestroyed &&
      (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true
  }

  private suspend fun requestPermission(kind: String): Map<String, Any?> {
    val requestGeneration = generation.get()
    val available = availability()
    if (available["status"] != "ready") return available
    val required = permission(kind) ?: return result("error", code = "invalid_kind")
    val requested = requestedPermissions(kind)
    if (!isForeground()) return result("error", code = "foreground_required")
    val context = appContext.reactContext ?: return result("unavailable")
    var deferred: CompletableDeferred<Set<String>>? = null
    var launchId: String? = null
    var launchSubmitted = false
    return try {
      val client = HealthConnectClient.getOrCreate(context)
      val grantedBefore = withTimeout(30_000) {
        client.permissionController.getGrantedPermissions()
      }
      if (generation.get() != requestGeneration) return result("error", code = "permission_invalidated")
      if (grantedBefore.containsAll(requested)) {
        return result("ready", access = "granted")
      }
      val request = CompletableDeferred<Set<String>>()
      val id = UUID.randomUUID().toString()
      synchronized(stateLock) {
        if (permissionLaunchId != null) return result("error", code = "permission_busy")
        permissionDeferred = request
        permissionLaunchId = id
      }
      deferred = request
      launchId = id
      withContext(Dispatchers.Main.immediate) {
        if (!::permissionLauncher.isInitialized || !isForeground() || generation.get() != requestGeneration) {
          synchronized(stateLock) {
            if (permissionLaunchId == id) {
              permissionLaunchId = null
              permissionDeferred = null
            }
          }
          throw IllegalStateException("permission_unavailable")
        }
        permissionLauncher.launch(HashSet(requested)) { granted ->
          synchronized(stateLock) {
            if (permissionLaunchId == id) {
              permissionLaunchId = null
              permissionDeferred = null
              request.complete(granted)
            }
          }
        }
        launchSubmitted = true
      }
      // Timeout cancels the waiting continuation. An outstanding system sheet
      // retains its launch gate until its callback/destruction, avoiding late-result reuse.
      // Earlier grants remain valid even if the sheet result lists only new grants.
      val granted = withTimeout(120_000) { request.await() } + grantedBefore
      if (granted.containsAll(requested)) result("ready", access = "granted")
      // Runs remain readable without distance; access is not reported as granted.
      else if (required in granted) result("ready")
      else result("permission_required")
    } catch (_: TimeoutCancellationException) {
      result("error", code = "permission_timeout")
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: SecurityException) {
      result("permission_required")
    } catch (_: Exception) {
      result("error", code = "permission_request_failed")
    } finally {
      deferred?.cancel()
      synchronized(stateLock) {
        if (permissionLaunchId == launchId) {
          permissionDeferred = null
          if (!launchSubmitted) permissionLaunchId = null
        }
      }
    }
  }

  private suspend fun readPage(
    kind: String, fromISO: String, toISO: String, token: String?
  ): Map<String, Any?> {
    // Capture before joining the queue: a queued caller must not acquire a new
    // generation after Clear/account change and resume native access.
    val requestGeneration = generation.get()
    return readMutex.withLock {
      if (generation.get() != requestGeneration) return@withLock result("error", code = "read_invalidated")
      val available = availability()
      if (available["status"] != "ready") return@withLock available
      val required = permission(kind) ?: return@withLock result("error", code = "invalid_kind")
      val requested = requestedPermissions(kind)
      val from: Instant
      val to: Instant
      try {
        if (fromISO.length > 40 || toISO.length > 40) return@withLock result("error", code = "invalid_range")
        from = Instant.parse(fromISO)
        to = Instant.parse(toISO)
        if (from >= to || Duration.between(from, to) > Duration.ofDays(30)) {
          return@withLock result("error", code = "invalid_range")
        }
      } catch (_: Exception) {
        return@withLock result("error", code = "invalid_range")
      }
      if (!isForeground()) return@withLock result("error", code = "foreground_required")
      if (generation.get() != requestGeneration) return@withLock result("error", code = "read_invalidated")
      val now = System.currentTimeMillis()
      val binding = synchronized(stateLock) {
        bindings.entries.removeAll { it.value.expiresAt <= now }
        token?.let { bindings.remove(it) }
      }
      if (token != null && (token.length > 64 || binding == null ||
          binding.kind != kind || binding.from != from || binding.to != to)) {
        return@withLock result("error", code = "invalid_page_token")
      }
      val context = appContext.reactContext ?: return@withLock result("unavailable")
      try {
        withTimeout(30_000) {
          val client = HealthConnectClient.getOrCreate(context)
          val grantedBefore = client.permissionController.getGrantedPermissions()
          if (required !in grantedBefore) {
            return@withTimeout result("permission_required")
          }
          // Distance is optional for runs: without it sessions are returned with null distance.
          val distanceReadable = kind == "run" && grantedBefore.containsAll(requested)
          if (!isForeground() || generation.get() != requestGeneration) {
            return@withTimeout result("error", code = "read_invalidated")
          }
          val records: List<Map<String, Any?>>
          val providerToken: String?
          if (kind == "weight") {
            val response = client.readRecords(ReadRecordsRequest(
              recordType = WeightRecord::class,
              timeRangeFilter = TimeRangeFilter.between(from, to),
              ascendingOrder = false, pageSize = 100, pageToken = binding?.providerToken
            ))
            records = response.records.mapNotNull { weight(it, from, to) }
            providerToken = response.pageToken?.takeIf { it.isNotEmpty() }
          } else {
            val response = client.readRecords(ReadRecordsRequest(
              recordType = ExerciseSessionRecord::class,
              timeRangeFilter = TimeRangeFilter.between(from, to),
              ascendingOrder = false, pageSize = 100, pageToken = binding?.providerToken
            ))
            records = if (kind == "run") {
              response.records.mapNotNull { runSession(client, it, from, to, distanceReadable) }
            } else {
              response.records.mapNotNull { workout(it, from, to) }
            }
            providerToken = response.pageToken?.takeIf { it.isNotEmpty() }
          }
          if (!isForeground() || generation.get() != requestGeneration) {
            return@withTimeout result("error", code = "read_invalidated")
          }
          // Recheck revocation before delivering this page, including cached tokens.
          val grantedAfter = client.permissionController.getGrantedPermissions()
          if (required !in grantedAfter) {
            return@withTimeout result("permission_required")
          }
          val access = if (grantedAfter.containsAll(requested) && (kind != "run" || distanceReadable)) {
            "granted"
          } else "unknown"
          synchronized(stateLock) {
            if (generation.get() != requestGeneration) return@synchronized result("error", code = "read_invalidated")
            val next = providerToken?.let {
              if (bindings.size >= 8) bindings.remove(bindings.keys.first())
              UUID.randomUUID().toString().also { opaque ->
                bindings[opaque] = PageBinding(kind, from, to, it, now + 300_000)
              }
            }
            result("ready", records, next, access)
          }
        }
      } catch (_: TimeoutCancellationException) {
        result("error", code = "read_timeout")
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (_: SecurityException) {
        result("permission_required")
      } catch (_: Exception) {
        // No platform exception text (which may contain health metadata) crosses JS.
        result("error", code = "read_failed")
      }
    }
  }

  private fun source(id: String, appId: String, zone: String?): MutableMap<String, Any?>? {
    if (id.isBlank() || appId.isBlank() || appId in ownSources) return null
    return mutableMapOf(
      "provider" to "health_connect", "externalId" to id,
      "sourceAppId" to appId, "sourceAppName" to null, "sourceTimeZone" to zone
    )
  }

  private fun weight(record: WeightRecord, from: Instant, to: Instant): Map<String, Any?>? {
    val kg = record.weight.inKilograms
    if (record.time < from || record.time >= to || !kg.isFinite() || kg <= 0) return null
    return source(record.metadata.id, record.metadata.dataOrigin.packageName, record.zoneOffset?.id)?.apply {
      put("kind", "weight")
      put("measuredAt", record.time.toString())
      put("weightKg", kg)
    }
  }

  /** Shared completed-session fields; null when outside the window or from an excluded source. */
  private fun session(record: ExerciseSessionRecord, kind: String, from: Instant, to: Instant): MutableMap<String, Any?>? {
    if (record.startTime < from || record.startTime >= to || record.endTime > to || record.endTime <= record.startTime) return null
    val seconds = Duration.between(record.startTime, record.endTime).toMillis() / 1_000.0
    if (!seconds.isFinite() || seconds <= 0) return null
    return source(record.metadata.id, record.metadata.dataOrigin.packageName, record.startZoneOffset?.id)?.apply {
      put("kind", kind)
      put("startedAt", record.startTime.toString())
      put("endedAt", record.endTime.toString())
      put("durationSeconds", seconds)
    }
  }

  private fun workout(record: ExerciseSessionRecord, from: Instant, to: Instant): Map<String, Any?>? =
    session(record, "workout", from, to)?.apply { put("activityType", activityName(record.exerciseType)) }

  private suspend fun runSession(
    client: HealthConnectClient, record: ExerciseSessionRecord,
    from: Instant, to: Instant, distanceReadable: Boolean
  ): Map<String, Any?>? {
    val indoor: Boolean? = when (record.exerciseType) {
      ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> true
      ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> null
      else -> return null
    }
    val value = session(record, "run", from, to) ?: return null
    value["durationBasis"] = "elapsed"
    value["distanceMeters"] = if (distanceReadable) distanceMeters(client, record) else null
    value["indoor"] = indoor
    return value
  }

  /**
   * Distance is stored as separate records. Aggregate only the session's own data
   * origin over [start, end) so other apps' or unrelated samples are not summed.
   * Missing data, a non-positive total or revoked distance access stay unavailable (null).
   * Other provider failures propagate so a transient failure is not reported as "no distance".
   */
  private suspend fun distanceMeters(client: HealthConnectClient, record: ExerciseSessionRecord): Double? = try {
    client.aggregate(AggregateRequest(
      metrics = setOf(DistanceRecord.DISTANCE_TOTAL),
      timeRangeFilter = TimeRangeFilter.between(record.startTime, record.endTime),
      dataOriginFilter = setOf(DataOrigin(record.metadata.dataOrigin.packageName))
    ))[DistanceRecord.DISTANCE_TOTAL]?.inMeters?.takeIf { it.isFinite() && it > 0 }
  } catch (_: SecurityException) {
    null
  }

  private fun activityName(type: Int): String = when (type) {
    ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "Walking"
    ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,
    ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "Running"
    ExerciseSessionRecord.EXERCISE_TYPE_BIKING,
    ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "Cycling"
    ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER,
    ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "Swimming"
    ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
    ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "Strength training"
    ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "Yoga"
    ExerciseSessionRecord.EXERCISE_TYPE_PILATES -> "Pilates"
    ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "Hiking"
    ExerciseSessionRecord.EXERCISE_TYPE_ROWING,
    ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "Rowing"
    ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "Elliptical"
    ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING,
    ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE -> "Stair climbing"
    ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "Interval training"
    ExerciseSessionRecord.EXERCISE_TYPE_DANCING -> "Dance"
    ExerciseSessionRecord.EXERCISE_TYPE_TENNIS -> "Tennis"
    ExerciseSessionRecord.EXERCISE_TYPE_BASKETBALL -> "Basketball"
    ExerciseSessionRecord.EXERCISE_TYPE_SOCCER -> "Soccer"
    else -> "Other workout"
  }

  private fun invalidate(cancelPermissionWait: Boolean = true) {
    synchronized(stateLock) {
      generation.incrementAndGet()
      bindings.clear()
      if (cancelPermissionWait) {
        permissionDeferred?.completeExceptionally(IllegalStateException("permission_invalidated"))
        permissionDeferred = null
      }
    }
  }

  private fun cancelPermission(releaseLaunchGate: Boolean) {
    synchronized(stateLock) {
      permissionDeferred?.completeExceptionally(IllegalStateException("permission_invalidated"))
      permissionDeferred = null
      if (releaseLaunchGate) permissionLaunchId = null
    }
  }
}

private data class PageBinding(
  val kind: String, val from: Instant, val to: Instant,
  val providerToken: String, val expiresAt: Long
)

private class ReadHealthPermissionContract : AppContextActivityResultContract<HashSet<String>, Set<String>> {
  private val delegate by lazy { PermissionController.createRequestPermissionResultContract() }
  override fun createIntent(context: Context, input: HashSet<String>): Intent = delegate.createIntent(context, input)
  override fun parseResult(input: HashSet<String>, resultCode: Int, intent: Intent?): Set<String> =
    delegate.parseResult(resultCode, intent)
}
