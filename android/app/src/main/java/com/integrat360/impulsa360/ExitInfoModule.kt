package com.integrat360.impulsa360

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Arguments

class ExitInfoModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ImpulsaExitInfo"

  private fun mapReason(reason: Int): String {
    return when (reason) {
      4 -> "CRASH"
      5 -> "CRASH_NATIVE"
      6 -> "ANR"
      3 -> "LOW_MEMORY"
      10 -> "USER_REQUESTED"
      else -> "OTHER"
    }
  }

  @ReactMethod
  fun getPreviousExitReason(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < 30) {
        val ok = Arguments.createMap()
        ok.putBoolean("supported", false)
        ok.putString("reason", "UNSUPPORTED")
        ok.putDouble("timestamp", 0.0)
        ok.putString("description", "")
        ok.putInt("pid", 0)
        promise.resolve(ok)
        return
      }
      val am = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val list = try {
        am.getHistoricalProcessExitReasons(reactApplicationContext.packageName, 0, 1)
      } catch (_: Exception) {
        emptyList()
      }
      val first = list.firstOrNull()
      val result = Arguments.createMap()
      if (first == null) {
        result.putBoolean("supported", true)
        result.putString("reason", "OTHER")
        result.putDouble("timestamp", 0.0)
        result.putString("description", "")
        result.putInt("pid", 0)
        promise.resolve(result)
        return
      }
      result.putBoolean("supported", true)
      result.putString("reason", mapReason(first.reason))
      // Correlación temporal: timestamp (epoch ms) del registro para
      // atribuirlo solo al run que estaba vivo en ese momento.
      result.putDouble("timestamp", first.timestamp.toDouble())
      // description = process state summary (best-effort, sin datos sensibles).
      result.putString("description", first.description ?: "")
      result.putInt("pid", first.pid)
      promise.resolve(result)
    } catch (_: Exception) {
      try {
        val fallback = Arguments.createMap()
        fallback.putBoolean("supported", false)
        fallback.putString("reason", "UNSUPPORTED")
        fallback.putDouble("timestamp", 0.0)
        fallback.putString("description", "")
        fallback.putInt("pid", 0)
        promise.resolve(fallback)
      } catch (_: Exception) {
        promise.reject("EXIT_INFO_ERROR", "No se pudo leer exit reason")
      }
    }
  }

  @ReactMethod
  fun setExitSummary(summary: String?, promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < 30) {
        promise.resolve(true)
        return
      }
      val clean = (summary ?: "").take(64)
      if (clean.isEmpty()) {
        promise.resolve(true)
        return
      }
      val am = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      try {
        am.setProcessStateSummary(clean.toByteArray(Charsets.UTF_8))
      } catch (_: Exception) {
        // best-effort: algunos OEM/versiones pueden rechazarlo
      }
      promise.resolve(true)
    } catch (_: Exception) {
      try {
        promise.resolve(false)
      } catch (_: Exception) {
      }
    }
  }
}
