package com.mizyun.healthexport

import org.junit.Assert.*
import org.junit.Test

class ExportOperationTest {
  private fun nutrition() = mapOf<String, Any?>(
    "type" to "upsert", "category" to "nutrition",
    "clientId" to "b08ab4a5-46c4-4797-accc-146b707cf88d", "revision" to 1,
    "nutrition" to mapOf("consumedAt" to "2026-10-06T12:34:00.000Z",
      "energyKcal" to 0.0, "proteinG" to null, "carbsG" to 4.5, "fatG" to null)
  )

  @Test fun preservesZeroAndUnknownWithoutNamesOrOtherNutrients() {
    val raw = nutrition() + ("nutrition" to ((nutrition()["nutrition"] as Map<*, *>) +
      mapOf("name" to "private name", "sodium" to 10)))
    val operation = ExportOperation.parse(raw)!!
    assertEquals(0.0, operation.values["energyKcal"]!!, 0.0)
    assertNull(operation.values["proteinG"])
    assertEquals(setOf("energyKcal", "proteinG", "carbsG", "fatG"), operation.values.keys)
    assertEquals(1L, java.time.Duration.between(operation.start, operation.end).toMillis())
  }

  @Test fun rejectsInvalidRevisionIdentityAndUnknownNutrition() {
    for (revision in listOf<Any>(0, -1, 1.5, Double.NaN, Double.POSITIVE_INFINITY, true, 9_007_199_254_740_992.0)) {
      assertNull(ExportOperation.parse(nutrition() + ("revision" to revision)))
    }
    for (id in listOf("source-account-id", "1-1-1-1-1", "")) {
      assertNull(ExportOperation.parse(nutrition() + ("clientId" to id)))
    }
    val unknown = mapOf("consumedAt" to "2026-10-06T12:34:00Z",
      "energyKcal" to null, "proteinG" to null, "carbsG" to null, "fatG" to null)
    assertNull(ExportOperation.parse(nutrition() + ("nutrition" to unknown)))
    assertNotNull(ExportOperation.parse(nutrition() + mapOf("nutrition" to unknown, "type" to "delete")))
  }

  @Test fun stableClientIdIsIndependentOfPayloadRevisionAndDeletion() {
    val first = ExportOperation.parse(nutrition())!!
    val replay = ExportOperation.parse(nutrition())!!
    val deletion = ExportOperation.parse(nutrition() + mapOf("type" to "delete", "revision" to 2))!!
    assertEquals(first.platformClientId, replay.platformClientId)
    assertEquals(first.platformClientId, deletion.platformClientId)
    assertEquals(first.start, deletion.start)
  }

  @Test fun requiresCompletedBoundedWorkoutAndRetainsDeleteInterval() {
    val raw = nutrition() - "nutrition" + mapOf("category" to "workout",
      "workout" to mapOf("startedAt" to "2026-10-06T12:00:00Z", "endedAt" to "2026-10-06T12:30:00Z"))
    val operation = ExportOperation.parse(raw)!!
    assertEquals("workout", operation.category)
    assertTrue(operation.values.isEmpty())
    assertEquals(operation.start, ExportOperation.parse(raw + ("type" to "delete"))!!.start)
    assertNull(ExportOperation.parse(raw + ("workout" to mapOf("startedAt" to "2026-10-06T12:00:00Z",
      "endedAt" to "2026-10-06T12:00:00Z"))))
  }

  @Test fun olderProviderCannotClaimAbsenceForHistoryItMayNotReturn() {
    val operation = ExportOperation.parse(nutrition())!!
    assertTrue(operation.canVerifyDeletionHistory(33, operation.start.plus(java.time.Duration.ofDays(29))))
    assertFalse(operation.canVerifyDeletionHistory(33, operation.start.plus(java.time.Duration.ofDays(31))))
    assertTrue(operation.canVerifyDeletionHistory(34, operation.start.plus(java.time.Duration.ofDays(31))))
  }
}
