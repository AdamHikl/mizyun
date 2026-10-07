package com.mizyun.healthexport

import kotlin.coroutines.Continuation
import kotlin.coroutines.intrinsics.suspendCoroutineUninterceptedOrReturn
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.atomic.AtomicLong
import org.junit.Assert.assertEquals
import org.junit.Test

class HealthExportModuleTest {
  @Test fun permissionSheetBackgroundRetiresMutationsButPreservesDeliberateAuthorization() {
    val module = HealthExportModule()
    val mutations = module.javaClass.getDeclaredField("generation").apply { isAccessible = true }.get(module) as AtomicLong
    val authorization = module.javaClass.getDeclaredField("authorizationGeneration").apply { isAccessible = true }.get(module) as AtomicLong
    val invalidate = module.javaClass.getDeclaredMethod("invalidate", Boolean::class.javaPrimitiveType)
      .apply { isAccessible = true }
    val promptGeneration = authorization.get()
    invalidate.invoke(module, false)
    assertEquals(1L, mutations.get())
    assertEquals(promptGeneration, authorization.get())
    // Clear/logout must still reject that same prompt's late grant.
    invalidate.invoke(module, true)
    assertEquals(2L, mutations.get())
    assertEquals(promptGeneration + 1, authorization.get())
  }

  @Test fun clearRetiresQueuedMutationBeforeAvailabilityOrNativeAccess() = runBlocking {
    val module = HealthExportModule()
    val mutex = module.javaClass.getDeclaredField("operationMutex").apply { isAccessible = true }.get(module) as Mutex
    val apply = module.javaClass.getDeclaredMethod("apply", Map::class.java, Continuation::class.java)
      .apply { isAccessible = true }
    val invalidate = module.javaClass.getDeclaredMethod("invalidate", Boolean::class.javaPrimitiveType)
      .apply { isAccessible = true }
    mutex.lock()
    try {
      val waiting = async(start = CoroutineStart.UNDISPATCHED) {
        suspendCoroutineUninterceptedOrReturn<Map<String, Any?>> { continuation ->
          apply.invoke(module, emptyMap<String, Any?>(), continuation)
        }
      }
      val busy = suspendCoroutineUninterceptedOrReturn<Map<String, Any?>> { continuation ->
        apply.invoke(module, emptyMap<String, Any?>(), continuation)
      }
      assertEquals("operation_busy", busy["errorCode"])
      invalidate.invoke(module, true)
      mutex.unlock()
      val result = waiting.await()
      assertEquals("error", result["status"])
      assertEquals("operation_invalidated", result["errorCode"])
      assertEquals(emptyList<String>(), result["acknowledgedComponents"])
      // The Expo scaffold has no AppContext. Native availability would produce
      // unavailable, so this exercises retirement before platform access.
    } finally {
      if (mutex.isLocked) mutex.unlock()
    }
  }
}
