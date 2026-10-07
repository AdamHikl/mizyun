package com.mizyun.healthexport

import java.time.Duration
import java.time.Instant
import java.util.UUID

internal data class ExportOperation(
  val type: String, val category: String, val clientId: String, val revision: Long,
  val start: Instant, val end: Instant, val values: Map<String, Double?>
) {
  val platformClientId: String get() = "mizyun.export.v1.$clientId.$category"

  // Older providers may silently omit out-of-window own data. We do not know
  // the first-grant date, so use the conservative guaranteed recent window.
  fun canVerifyDeletionHistory(apiLevel: Int, now: Instant): Boolean =
    apiLevel >= 34 || start >= now.minus(Duration.ofDays(30))

  companion object {
    fun parse(raw: Map<String, Any?>): ExportOperation? {
      return try {
        val type = raw["type"] as? String
        val category = raw["category"] as? String
        val clientId = raw["clientId"] as? String
        val revision = (raw["revision"] as? Number)?.toDouble()
        if (type !in setOf("upsert", "delete") || category !in setOf("nutrition", "workout") ||
            clientId == null || clientId.length != 36 || UUID.fromString(clientId).toString() != clientId.lowercase() ||
            revision == null || !revision.isFinite() || revision < 1 || revision > 9_007_199_254_740_991.0 ||
            revision % 1.0 != 0.0) null
        else {
          val payload = raw[category] as? Map<*, *> ?: return null
          val start: Instant
          val end: Instant
          val values = LinkedHashMap<String, Double?>()
          if (category == "nutrition") {
            start = date(payload["consumedAt"]) ?: return null
            // Health Connect requires a positive interval; a one-millisecond
            // point interval preserves the confirmed consumedAt timestamp.
            end = start.plusMillis(1)
            for (field in listOf("energyKcal", "proteinG", "carbsG", "fatG")) {
              if (!payload.containsKey(field)) return null
              val rawValue = payload[field]
              val value = (rawValue as? Number)?.toDouble()
              if (rawValue != null && (value == null || !value.isFinite() || value < 0 ||
                  value > if (field == "energyKcal") 100_000 else 10_000)) return null
              values[field] = value
            }
            if (type == "upsert" && values.values.all { it == null }) return null
          } else {
            start = date(payload["startedAt"]) ?: return null
            end = date(payload["endedAt"]) ?: return null
            if (start >= end || Duration.between(start, end) > Duration.ofDays(1)) return null
          }
          ExportOperation(type!!, category!!, clientId.lowercase(), revision.toLong(), start, end, values)
        }
      } catch (_: Exception) { null }
    }

    private fun date(raw: Any?): Instant? {
      val text = raw as? String ?: return null
      if (text.length > 40) return null
      return Instant.parse(text)
    }
  }
}
