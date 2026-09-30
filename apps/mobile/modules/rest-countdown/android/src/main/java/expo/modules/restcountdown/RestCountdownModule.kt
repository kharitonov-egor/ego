package expo.modules.restcountdown

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.text.format.DateFormat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Date

private const val CHANNEL_ID = "rest-countdown"
private const val NOTIFICATION_ID = 7301

// Notification.EXTRA_REQUEST_PROMOTED_ONGOING from API 36, spelled out so older compile SDKs build.
// Android 16 then shows the countdown as a Live Update chip in the status bar.
private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"

class RestCountdownModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RestCountdown")

    Function("show") { endsAt: Double ->
      show(endsAt.toLong())
    }

    Function("hide") {
      manager.cancel(NOTIFICATION_ID)
    }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  private val manager: NotificationManager
    get() = context.getSystemService(NotificationManager::class.java)

  private fun show(endsAt: Long) {
    val remaining = endsAt - System.currentTimeMillis()
    if (remaining <= 0 || !manager.areNotificationsEnabled()) {
      manager.cancel(NOTIFICATION_ID)
      return
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Default importance keeps it on the lock screen, which hides silent notifications. No sound,
      // no vibration: the "Rest is over" alert on its own channel is the one that makes noise.
      val channel = NotificationChannel(CHANNEL_ID, "Rest countdown", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Shows the rest timer while it runs."
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      manager.createNotificationChannel(channel)
      Notification.Builder(context, CHANNEL_ID).setTimeoutAfter(remaining)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) builder.setCategory(Notification.CATEGORY_STOPWATCH)
    builder
      .setSmallIcon(smallIcon())
      .setContentTitle("Resting")
      .setContentText("Next set at ${DateFormat.getTimeFormat(context).format(Date(endsAt))}")
      .setWhen(endsAt)
      .setShowWhen(true)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .addExtras(Bundle().apply { putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true) })
    openApp()?.let { builder.setContentIntent(it) }
    manager.notify(NOTIFICATION_ID, builder.build())
  }

  /** The white ring the expo-notifications plugin writes, so the status bar shows the Ego mark. */
  private fun smallIcon(): Int {
    val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (icon != 0) icon else context.applicationInfo.icon
  }

  private fun openApp(): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(
      context, NOTIFICATION_ID, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }
}
