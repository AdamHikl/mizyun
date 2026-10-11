package com.mizyun.workoutcompanion

import android.os.Handler
import android.os.Looper
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.UUID

/** No service or storage: incoming commands exist only while the phone UI owns JS authority. */
class WorkoutCompanionModule : Module(), MessageClient.OnMessageReceivedListener {
  private val main = Handler(Looper.getMainLooper())
  private var observing = false
  private var foreground = false
  private var nodeId: String? = null
  private var nonce: String? = null
  private var authority: JSONObject? = null
  private var inFlight: String? = null
  private var registered = false
  private val path = "/mizyun/workout/message"

  override fun definition() = ModuleDefinition {
    Name("MizyunWorkoutCompanion")
    Events("onMessage")
    OnStartObserving("onMessage") { main.post { observing = true; foreground = (appContext.currentActivity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true; start() } }
    OnStopObserving("onMessage") { main.post { observing = false; stop() } }
    OnActivityEntersForeground { main.post { foreground = true; start() } }
    OnActivityEntersBackground { main.post { foreground = false; stop() } }
    OnActivityDestroys { main.post { foreground = false; stop() } }
    OnDestroy { main.post { observing = false; stop() } }
    AsyncFunction("publish") { json: String -> publish(json) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("clear") { clear() }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
  }

  private fun available(): Boolean {
    val context = appContext.reactContext ?: return false
    return context.packageName == "com.mizyun.dev" &&
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
  }
  private fun active() = observing && foreground && available()
  private fun start() {
    val context = appContext.reactContext ?: return
    if (!active() || registered) return
    Wearable.getMessageClient(context).addListener(this)
    registered = true
  }
  private fun stop() {
    clear()
    val context = appContext.reactContext
    if (context != null && registered) Wearable.getMessageClient(context).removeListener(this)
    registered = false
  }
  private fun clear() {
    val target = nodeId
    val context = appContext.reactContext
    authority = null; nodeId = null; nonce = null; inFlight = null
    if (context == null || !available()) return
    val json = JSONObject().put("protocolVersion", 1).put("kind", "clear").put("reason", "inactive").toString()
    if (target != null) Wearable.getMessageClient(context).sendMessage(target, path, json.toByteArray())
    // Persist only a tombstone. Never leave a health snapshot in Data Layer after clearing.
    Wearable.getDataClient(context).putDataItem(PutDataMapRequest.create("/mizyun/workout/snapshot").apply {
      dataMap.putString("json", json)
    }.asPutDataRequest().setUrgent())
  }
  private fun uuid(value: String): Boolean = try { UUID.fromString(value).toString().equals(value, true) } catch (_: Exception) { false }
  private fun fresh(value: JSONObject, issuedKey: String = "issuedAtMs"): Boolean {
    val issued = value.optLong(issuedKey, -1); val expires = value.optLong("expiresAtMs", -1)
    val now = System.currentTimeMillis()
    return issued > 0 && issued <= now + 10000 && expires > now && expires > issued && expires - issued <= 120000
  }
  private fun publish(json: String): Boolean {
    if (!active() || json.toByteArray().size > 16384) return false
    val context = appContext.reactContext ?: return false
    val value = try { JSONObject(json) } catch (_: Exception) { return false }
    if (value.optInt("protocolVersion") != 1) return false
    if (value.optString("kind") == "clear") { clear(); return true }
    val target = nodeId ?: return false
    if (value.optString("watchNonce") != nonce) return false
    when (value.optString("kind")) {
      "snapshot" -> {
        if (!fresh(value) || !uuid(value.optString("bindingId")) || !uuid(value.optString("workoutId"))) return false
        authority = value

      }
      "ack" -> {
        if (value.optString("bindingId") != authority?.optString("bindingId")) return false
        if (value.optString("operationId") == inFlight) inFlight = null
      }
      else -> return false
    }
    Wearable.getMessageClient(context).sendMessage(target, path, json.toByteArray())
    return true
  }
  override fun onMessageReceived(event: MessageEvent) {
    if (event.path != path || event.data.size > 16384) return
    val json = event.data.toString(Charsets.UTF_8)
    main.post {
      if (!active()) return@post
      val value = try { JSONObject(json) } catch (_: Exception) { return@post }
      if (value.optInt("protocolVersion") != 1 || !uuid(value.optString("watchNonce"))) return@post
      if (value.optString("kind") == "hello") {
        if (inFlight != null && (nodeId != event.sourceNodeId || nonce != value.optString("watchNonce"))) return@post
        // Bind exclusively to the node that requested this personalized lease.
        if (nodeId != event.sourceNodeId || nonce != value.optString("watchNonce")) authority = null
        nodeId = event.sourceNodeId; nonce = value.optString("watchNonce")
        sendEvent("onMessage", mapOf("json" to json))
        return@post
      }
      val bound = authority ?: return@post
      if (event.sourceNodeId != nodeId || value.optString("watchNonce") != nonce ||
          value.optString("bindingId") != bound.optString("bindingId") ||
          value.optString("workoutId") != bound.optString("workoutId") ||
          !fresh(bound) || !fresh(value, "createdAtMs") ||
          !uuid(value.optString("operationId")) || value.optString("kind") !in setOf("log-set", "finish", "skip-rest")) return@post
      if (inFlight != null && inFlight != value.optString("operationId")) return@post
      // Completed leases admit receipt replay; JS rejects new completed-workout actions.
      inFlight = value.optString("operationId")
      sendEvent("onMessage", mapOf("json" to json))
    }
  }
}
