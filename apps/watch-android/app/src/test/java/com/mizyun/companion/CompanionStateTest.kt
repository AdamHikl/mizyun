package com.mizyun.companion

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class CompanionStateTest {
  private val now = 1000000L
  private val binding = UUID.randomUUID().toString()
  private val workout = UUID.randomUUID().toString()
  private fun snapshot(state: CompanionState, id: String = binding, revision: Long = 1, expires: Long = now + 60000, nonce: String = state.nonce): String = JSONObject()
    .put("protocolVersion", 1).put("kind", "snapshot").put("watchNonce", nonce).put("bindingId", id).put("workoutId", workout)
    .put("revision", revision).put("issuedAtMs", now).put("expiresAtMs", expires).put("status", "active")
    .put("exercise", JSONObject().put("exerciseId", "planned-squat").put("name", "Squat").put("completedSets", 0).put("targetSets", 3)
      .put("repetitions", 8).put("loadKg", 20).put("setType", "working").put("loadUnit", "kg"))
    .put("restEndsAtMs", now + 30000).put("canLogSet", true).put("canFinish", true).toString()
  @Test fun oldNonceLongLeaseAndExpiryFailClosed() {
    val state = CompanionState {}
    state.receive(snapshot(state, nonce = UUID.randomUUID().toString()), now); assertNull(state.snapshot)
    state.receive(snapshot(state, expires = now + 120001), now); assertNull(state.snapshot)
    state.receive(snapshot(state), now); assertNotNull(state.snapshot)
    state.tick(now + 60000); assertNull(state.snapshot); assertFalse(state.enqueue("finish", 0, 0.0, now + 60000))
  }
  @Test fun immutableOutboxLostReceiptAndLateAck() {
    var disk: JSONObject? = null
    val state = CompanionState { disk = it }
    state.receive(snapshot(state), now)
    assertTrue(state.enqueue("log-set", 9, 22.5, now))
    val exact = disk!!.getString("json")
    assertEquals("planned-squat", JSONObject(exact).getString("exerciseId"))
    assertFalse(state.enqueue("finish", 0, 0.0, now))
    assertEquals(exact, state.nextDelivery(now + 1))
    assertNull(state.nextDelivery(now + 2))
    state.tick(now + 15001)
    assertEquals("uncertain", state.pending!!.getString("phase")); assertNull(state.nextDelivery(now + 15002))
    val ack = JSONObject().put("protocolVersion", 1).put("kind", "ack").put("watchNonce", state.nonce).put("bindingId", UUID.randomUUID().toString())
      .put("operationId", JSONObject(exact).getString("operationId")).put("status", "saved").put("revision", 2)
    state.receive(ack.toString(), now + 16000); assertNotNull(state.pending)
    ack.put("bindingId", binding); state.receive(ack.toString(), now + 16000); assertNull(state.pending); assertNull(disk)
  }
  @Test fun revisionsRetiredBindingsAndReactivationDiscard() {
    var disk: JSONObject? = null
    val state = CompanionState { disk = it }
    state.receive(snapshot(state, revision = 3), now)
    state.receive(snapshot(state, revision = 2), now); assertEquals(3, state.snapshot!!.getLong("revision"))
    assertTrue(state.enqueue("finish", 0, 0.0, now))
    val next = UUID.randomUUID().toString()
    state.receive(snapshot(state, id = next), now); assertNull(state.pending); assertTrue(state.message.contains("discarded"))
    state.receive(snapshot(state, revision = 99), now); assertEquals(next, state.snapshot!!.getString("bindingId"))
    assertTrue(state.enqueue("skip-rest", 0, 0.0, now)); state.suspend(); assertNotNull(disk)
    val nonce = state.nonce
    state.activate(hadOutbox = true); assertNotEquals(nonce, state.nonce); assertNull(disk); assertNull(state.snapshot); assertTrue(state.message.contains("Check phone"))
  }
  @Test fun persistenceFailureNeverSends() {
    val state = CompanionState { throw IllegalStateException("storage unavailable") }
    state.receive(snapshot(state), now); assertFalse(state.enqueue("finish", 0, 0.0, now)); assertNull(state.nextDelivery(now))
  }
}
