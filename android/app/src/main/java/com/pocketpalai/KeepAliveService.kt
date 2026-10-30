package com.pocketpal

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/**
 * Keeps the process alive with the screen off.
 *
 * Three things are needed on Android, and a JS timer is none of them:
 * - a foreground service, otherwise Doze/App Standby freezes the process once the
 *   app is not visible (Android 8+ also kills plain background work)
 * - a partial wake lock, otherwise the CPU sleeps and inference stalls
 * - a high-performance Wi-Fi lock, otherwise the radio drops to power save and
 *   the LAN API server's connections time out
 *
 * The notification is the price of the foreground service, and it is also the
 * honest signal that the app is holding the device awake.
 */
class KeepAliveService : Service() {

  companion object {
    private const val TAG = "KeepAlive"
    private const val CHANNEL_ID = "pocketpal-keepalive"
    private const val NOTIFICATION_ID = 4201
    private const val WAKE_TAG = "pocketpal:keepalive"
    private const val WIFI_TAG = "pocketpal:keepalive:wifi"

    fun intent(context: Context): Intent =
      Intent(context, KeepAliveService::class.java)
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    acquireLocks()
    startForegroundWithType()
    Log.d(TAG, "keep-alive started")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // START_STICKY: if the system kills us for memory, come back.
    return START_STICKY
  }

  override fun onDestroy() {
    releaseLocks()
    Log.d(TAG, "keep-alive stopped")
    super.onDestroy()
  }

  private fun acquireLocks() {
    try {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = power
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_TAG)
        .apply { setReferenceCounted(false); acquire() }
    } catch (e: Exception) {
      Log.w(TAG, "wake lock failed", e)
    }
    try {
      val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      wifiLock = wifi
        .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, WIFI_TAG)
        .apply {
          setReferenceCounted(false)
          acquire()
        }
    } catch (e: Exception) {
      // Devices without Wi-Fi (or with the API removed) simply skip this.
      Log.w(TAG, "wifi lock failed", e)
    }
  }

  private fun releaseLocks() {
    try {
      wakeLock?.takeIf { it.isHeld }?.release()
    } catch (_: Exception) {
    }
    wakeLock = null
    try {
      wifiLock?.takeIf { it.isHeld }?.release()
    } catch (_: Exception) {
    }
    wifiLock = null
  }

  private fun startForegroundWithType() {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Android 14+ requires the type at start time; must match the manifest.
      startForeground(
        NOTIFICATION_ID,
        notification,
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) {
      return
    }
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        getString(com.pocketpal.R.string.keepalive_channel_name),
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = getString(com.pocketpal.R.string.keepalive_channel_description)
        setShowBadge(false)
      },
    )
  }

  private fun buildNotification(): Notification {
    val openApp = PendingIntent.getActivity(
      this,
      0,
      packageManager.getLaunchIntentForPackage(packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setSmallIcon(com.pocketpal.R.mipmap.ic_launcher)
      .setContentTitle(getString(com.pocketpal.R.string.keepalive_title))
      .setContentText(getString(com.pocketpal.R.string.keepalive_text))
      .setContentIntent(openApp)
      .setOngoing(true)
      .setShowWhen(false)
      .build()
  }
}
