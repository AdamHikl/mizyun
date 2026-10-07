package com.mizyun.healthconnections

import kotlin.coroutines.Continuation
import kotlin.coroutines.intrinsics.suspendCoroutineUninterceptedOrReturn
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import org.junit.Assert.assertEquals
import org.junit.Test

class HealthConnectionsModuleTest {
  @Test
  fun queuedReadCannotStartNativeAccessAfterClear() = runBlocking {
    val module = HealthConnectionsModule()
    val mutexField = module.javaClass.getDeclaredField("readMutex").apply { isAccessible = true }
    val mutex = mutexField.get(module) as Mutex
    val read = module.javaClass.getDeclaredMethod(
      "readPage", String::class.java, String::class.java, String::class.java,
      String::class.java, Continuation::class.java
    ).apply { isAccessible = true }
    val invalidate = module.javaClass.getDeclaredMethod("invalidate", Boolean::class.javaPrimitiveType)
      .apply { isAccessible = true }

    mutex.lock()
    try {
      val queued = async(start = CoroutineStart.UNDISPATCHED) {
        suspendCoroutineUninterceptedOrReturn<Map<String, Any?>> { continuation ->
          read.invoke(module, "weight", "2026-10-01T00:00:00Z", "2026-10-06T00:00:00Z", null, continuation)
        }
      }
      invalidate.invoke(module, true)
      mutex.unlock()
      val result = queued.await()
      assertEquals("error", result["status"])
      assertEquals("read_invalidated", result["errorCode"])
      assertEquals(emptyList<Map<String, Any?>>(), result["records"])
      // The module has no Expo AppContext in this JVM test. Reaching provider
      // availability/native reads would fail, rather than produce this result.
    } finally {
      if (mutex.isLocked) mutex.unlock()
    }
  }
}
