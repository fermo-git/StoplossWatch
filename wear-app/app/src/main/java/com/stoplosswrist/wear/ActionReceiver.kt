package com.stoplosswrist.wear

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val alertId = intent.getStringExtra("alertId") ?: return
        val action = intent.getStringExtra("action") ?: return
        val nodeId = intent.getStringExtra("nodeId")
        val notifId = intent.getIntExtra("notifId", 0)

        // Cancelar notificación activa
        ctx.getSystemService(NotificationManager::class.java).cancel(notifId)

        // Enviar acción vía Data Layer + HTTP
        ActionSender.send(ctx, nodeId, alertId, action)

        // Notificar a MainActivity para actualizar la UI en vivo
        MainActivity.onAlertActionHandled(alertId, action)
    }
}
