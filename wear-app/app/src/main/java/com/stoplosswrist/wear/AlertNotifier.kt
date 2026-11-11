package com.stoplosswrist.wear

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import org.json.JSONObject

object AlertNotifier {
    private const val CHANNEL = "stoploss_alerts_pro"

    private fun vibration(severity: String) = when (severity) {
        "critical" -> longArrayOf(0, 450, 150, 450, 150, 450)
        "warning" -> longArrayOf(0, 300, 200, 300)
        else -> longArrayOf(0, 150)
    }

    fun show(ctx: Context, alert: JSONObject, phoneNodeId: String?) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val channel = NotificationChannel(
                CHANNEL,
                "Alertas StopLoss",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                enableVibration(true)
                description = "Notificaciones de volatilidad y caídas de mercado"
            }
            nm.createNotificationChannel(channel)
        }

        val id = alert.optString("id", "alert-${System.currentTimeMillis()}")
        val severity = alert.optString("severity", "critical")
        val symbol = alert.optString("symbol", "BTCUSDT")
        val price = alert.optDouble("price", 0.0)
        val dropPct = alert.optDouble("dropPercent", 0.0)
        val title = alert.optString("friendlyTitle", "Caída de Precio en $symbol")
        val summary = alert.optString("summary", "El activo registró una variación de precio significativa.")

        val notifId = id.hashCode()

        fun makeAction(action: String, label: String, code: Int): NotificationCompat.Action {
            val intent = Intent(ctx, ActionReceiver::class.java).apply {
                putExtra("alertId", id)
                putExtra("action", action)
                putExtra("nodeId", phoneNodeId ?: "")
                putExtra("notifId", notifId)
            }
            val pending = PendingIntent.getBroadcast(
                ctx,
                notifId + code,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            return NotificationCompat.Action.Builder(0, label, pending).build()
        }

        val contentIntent = PendingIntent.getActivity(
            ctx,
            notifId,
            Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("view_section", "alerts")
                putExtra("latest_alert", alert.toString())
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val priceStr = if (price >= 100) "%.2f".format(price) else "%.4f".format(price)
        val dropStr = if (dropPct > 0) " (-%.1f%%)".format(dropPct) else ""

        val builder = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle("$symbol $priceStr$dropStr")
            .setContentText(summary)
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .setBigContentTitle(title)
                    .bigText("$summary\nElige qué hacer:")
            )
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(vibration(severity))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .addAction(makeAction(Protocol.ACTION_BUY, "Comprar", 1))
            .addAction(makeAction(Protocol.ACTION_SELL, "Vender", 2))
            .addAction(makeAction(Protocol.ACTION_SNOOZE, "Luego", 3))
            .addAction(makeAction(Protocol.ACTION_IGNORE, "Ignorar", 4))

        nm.notify(notifId, builder.build())
    }
}
