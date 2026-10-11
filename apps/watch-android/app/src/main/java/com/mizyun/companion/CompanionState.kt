package com.mizyun.companion

import org.json.JSONObject
import java.util.UUID

/** Memory-only snapshots; one bounded immutable command persisted by the owner. */
class CompanionState(private val persist: (JSONObject?) -> Unit) {
  var nonce: String = UUID.randomUUID().toString(); private set
  var snapshot: JSONObject? = null; private set
  var pending: JSONObject? = null; private set
  var message = "Open Mizyun Dev on your phone"; private set
  private var lastBinding: String? = null
  private var highRevision = -1L
  private val retired = mutableSetOf<String>()
  fun activate(hadOutbox: Boolean = false) {
    val unresolved = pending != null || hadOutbox
    lastBinding?.let { retired.add(it) }
    nonce = UUID.randomUUID().toString(); snapshot = null; pending = null; lastBinding = null; highRevision = -1
    try { persist(null); message = if (unresolved) "Previous request discarded · Check phone" else "Open Mizyun Dev on your phone" }
    catch (_: Exception) { message = "Check phone · local storage unavailable" }
  }
  fun suspend() { snapshot = null; if (pending?.optString("phase") == "awaiting") uncertain() }
  fun clear() {
    lastBinding?.let { retired.add(it) }
    snapshot = null; pending = null; lastBinding = null; highRevision = -1
    try { persist(null); message = "Open Mizyun Dev on your phone" }
    catch (_: Exception) { message = "Check phone · local storage unavailable" }
  }
  fun hello(): String = JSONObject().put("protocolVersion", 1).put("kind", "hello").put("watchNonce", nonce).toString()
  private fun uuid(value: String): Boolean = try { UUID.fromString(value).toString().equals(value, true) } catch (_: Exception) { false }
  private fun valid(value: JSONObject, now: Long): Boolean {
    val issued = value.optLong("issuedAtMs", -1); val expires = value.optLong("expiresAtMs", -1)
    return value.optInt("protocolVersion") == 1 && value.optString("kind") == "snapshot" && value.optString("watchNonce") == nonce &&
      uuid(value.optString("bindingId")) && uuid(value.optString("workoutId")) && value.optLong("revision", -1) >= 0 &&
      issued > 0 && issued <= now + 10000 && expires > now && expires > issued && expires - issued <= 120000 &&
      value.optString("status") in setOf("active", "completed", "unavailable")
  }
  fun receive(json: String, now: Long) {
    if (json.toByteArray().size > 16384) return
    val value = try { JSONObject(json) } catch (_: Exception) { return }
    if (value.optInt("protocolVersion") != 1) return
    if (value.optString("kind") == "clear") {
      if (value.has("watchNonce") && value.optString("watchNonce") != nonce) return
      clear(); return
    }
    val queued = pending
    if (value.optString("kind") == "ack" && queued != null) {
      val command = JSONObject(queued.getString("json"))
      if (value.optString("watchNonce") != nonce || value.optString("bindingId") != command.optString("bindingId") ||
          value.optString("operationId") != command.optString("operationId") || value.optLong("revision", -1) < command.optLong("baseRevision")) return
      when (value.optString("status")) {
        "saved", "rejected" -> {
          try { persist(null); pending = null; message = if (value.optString("status") == "saved") "Saved on phone" else "Request rejected · Check phone" }
          catch (_: Exception) { uncertain() }
        }
        "uncertain" -> uncertain()
      }
      return
    }
    if (!valid(value, now) || retired.contains(value.optString("bindingId"))) return
    if (lastBinding == value.optString("bindingId")) {
      if (value.optLong("revision") < highRevision) return
      if (value.optLong("revision") == highRevision && value.optLong("issuedAtMs") < (snapshot?.optLong("issuedAtMs") ?: 0)) return
    } else {
      lastBinding?.let { retired.add(it) }
      if (pending != null) {
        try { persist(null); pending = null; message = "Workout changed · request discarded · Check phone" }
        catch (_: Exception) { uncertain(); return }
      }
      lastBinding = value.optString("bindingId"); highRevision = -1
    }
    highRevision = value.optLong("revision"); snapshot = value
    if (value.optString("status") != "active") message = if (pending != null) "Workout ended · Check phone" else if (value.optString("status") == "completed") "Workout completed" else "Open workout on phone"
  }
  fun tick(now: Long) {
    if ((snapshot?.optLong("expiresAtMs") ?: Long.MAX_VALUE) <= now) { snapshot = null; message = "Snapshot expired · Open phone" }
    pending?.let { item ->
      if (JSONObject(item.getString("json")).optLong("expiresAtMs") <= now ||
          item.optString("phase") == "awaiting" && now - item.optLong("sentAtMs") >= 15000) uncertain()
    }
  }
  fun enqueue(kind: String, reps: Int, loadKg: Double, now: Long): Boolean {
    tick(now)
    val current = snapshot ?: return false
    if (pending != null || current.optString("status") != "active") return false
    val allowed = when (kind) {
      "log-set" -> current.optBoolean("canLogSet")
      "finish" -> current.optBoolean("canFinish")
      "skip-rest" -> current.optLong("restEndsAtMs") > now
      else -> false
    }
    if (!allowed) return false
    val exercise = current.optJSONObject("exercise")
    if (kind == "log-set" && (reps !in 1..1000 || !loadKg.isFinite() || loadKg < 0 || loadKg > 2000 ||
        exercise == null || exercise.optString("exerciseId").isBlank() || exercise.optString("exerciseId").length > 100 || exercise.optString("setType") !in setOf("warmup", "working", "drop", "failure"))) return false
    val command = JSONObject().put("protocolVersion", 1).put("kind", kind).put("watchNonce", nonce)
      .put("bindingId", current.getString("bindingId")).put("workoutId", current.getString("workoutId"))
      .put("operationId", UUID.randomUUID().toString()).put("baseRevision", current.getLong("revision"))
      .put("createdAtMs", now).put("expiresAtMs", minOf(current.getLong("expiresAtMs"), now + 120000))
    if (kind == "log-set") command.put("exerciseId", exercise!!.getString("exerciseId")).put("repetitions", reps).put("loadKg", loadKg).put("setType", exercise.getString("setType"))
    val item = JSONObject().put("json", command.toString()).put("phase", "queued")
    return try { persist(item); pending = item; message = "Waiting for phone"; true }
    catch (_: Exception) { message = "Check phone · local storage unavailable"; false }
  }
  fun nextDelivery(now: Long): String? {
    tick(now)
    val item = pending ?: return null
    val current = snapshot ?: return null
    val command = JSONObject(item.getString("json"))
    if (item.optString("phase") != "queued" || command.optString("watchNonce") != nonce || command.optString("bindingId") != current.optString("bindingId") || current.optString("status") != "active" || command.optLong("expiresAtMs") <= now) return null
    val attempted = JSONObject(item.toString()).put("phase", "awaiting").put("sentAtMs", now)
    return try { persist(attempted); pending = attempted; message = "Saving on phone…"; attempted.getString("json") }
    catch (_: Exception) { uncertain(); null }
  }
  fun uncertain() {
    pending?.let { item -> pending = JSONObject(item.toString()).put("phase", "uncertain"); try { persist(pending) } catch (_: Exception) {} }
    message = "Check phone · save not confirmed"
  }
}
