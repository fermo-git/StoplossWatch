package com.stoplosswrist.wear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/** Recibe mensajes del teléfono mediante Wearable Data Layer. */
class AlertListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            Protocol.PATH_ALERT -> {
                val alert = runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull() ?: return
                AlertNotifier.show(this, alert, event.sourceNodeId)
                MainActivity.onAlertReceived(alert)
            }
            Protocol.PATH_CONFIG -> {
                val cfg = runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull() ?: return
                val drop = cfg.optDouble("dropPercent", 2.5)
                val sym = cfg.optString("symbol", "SIM")
                MainActivity.onConfigReceived(drop, sym)
            }
        }
    }
}
