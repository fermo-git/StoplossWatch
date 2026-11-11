package com.stoplosswrist.bridge

import android.content.Context
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Recibe eventos del reloj (Data Layer) y los reenvía al backend por HTTP.
 * Funciona aunque la app React Native esté cerrada o en segundo plano.
 */
class PhoneListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        val base = getSharedPreferences(Protocol.PREFS, Context.MODE_PRIVATE)
            .getString(Protocol.KEY_BASE_URL, null) ?: "http://10.0.2.2:8080"

        when (event.path) {
            Protocol.PATH_ACTION -> {
                val msg = runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull() ?: return
                val alertId = msg.optString("alertId").ifEmpty { return }
                val action = msg.optString("action").ifEmpty { return }

                thread {
                    runCatching {
                        val enc = java.net.URLEncoder.encode(alertId, "UTF-8")
                        val url = URL("$base/alerts/$enc/action")
                        (url.openConnection() as HttpURLConnection).apply {
                            requestMethod = "POST"
                            doOutput = true
                            connectTimeout = 5000; readTimeout = 5000
                            setRequestProperty("Content-Type", "application/json")
                            outputStream.use { it.write(JSONObject().put("action", action).toString().toByteArray()) }
                            responseCode
                            disconnect()
                        }
                    }
                }
            }

            Protocol.PATH_SET_THRESHOLD -> {
                val msg = runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull() ?: return
                val drop = msg.optDouble("dropPercent", 2.5)

                thread {
                    runCatching {
                        val url = URL("$base/config/threshold")
                        (url.openConnection() as HttpURLConnection).apply {
                            requestMethod = "POST"
                            doOutput = true
                            connectTimeout = 5000; readTimeout = 5000
                            setRequestProperty("Content-Type", "application/json")
                            outputStream.use { it.write(JSONObject().put("dropPercent", drop).toString().toByteArray()) }
                            responseCode
                            disconnect()
                        }
                    }
                }
            }
        }
    }
}
