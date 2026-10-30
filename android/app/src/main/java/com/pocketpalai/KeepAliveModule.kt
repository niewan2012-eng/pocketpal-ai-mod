package com.pocketpal

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeKeepAliveSpec

/**
 * Controls the foreground service that keeps the app running with the screen off.
 *
 * Deliberately a plain start/stop: the locks and the notification live in
 * `KeepAliveService`, and whether it should be running is a user preference the
 * JS layer persists.
 */
@ReactModule(name = NativeKeepAliveSpec.NAME)
class KeepAliveModule(reactContext: ReactApplicationContext) :
    NativeKeepAliveSpec(reactContext) {

  companion object {
    private const val TAG = "KeepAlive"
  }

  override fun start(promise: Promise) {
    try {
      val context = reactApplicationContext
      val intent = KeepAliveService.intent(context)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      // Android 12+ refuses a foreground service start from the background; the
      // UI can only start it while visible, and says so when it fails.
      Log.w(TAG, "start failed", e)
      promise.reject("E_KEEPALIVE_START", e.message, e)
    }
  }

  override fun stop(promise: Promise) {
    try {
      reactApplicationContext.stopService(KeepAliveService.intent(reactApplicationContext))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_KEEPALIVE_STOP", e.message, e)
    }
  }

  /** Whitelisted against Doze. Best-effort: a missing permission reads as false. */
  override fun isIgnoringBatteryOptimizations(promise: Promise) {
    try {
      val power =
        reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(power.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  /** Opens the system dialog; the user decides. Nothing is granted silently. */
  override fun requestIgnoreBatteryOptimizations(promise: Promise) {
    try {
      val intent = Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:" + reactApplicationContext.packageName),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      // Some ROMs do not ship that dialog; fall back to the battery-optimisation
      // list so the user can still find this app.
      try {
        reactApplicationContext.startActivity(
          Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        promise.resolve(true)
      } catch (fallbackError: Exception) {
        promise.reject("E_BATTERY_SETTINGS", fallbackError.message, fallbackError)
      }
    }
  }
}
