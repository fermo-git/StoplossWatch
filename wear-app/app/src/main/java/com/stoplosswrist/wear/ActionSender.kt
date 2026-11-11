package com.stoplosswrist.wear

import android.content.Context
import com.google.android.gms.wearable.Wearable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

object ActionSender {
    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .build()

    fun getBaseUrl(ctx: Context): String {
        return ctx.getSharedPreferences(Protocol.PREFS, Context.MODE_PRIVATE)
            .getString(Protocol.KEY_BASE_URL, Protocol.DEFAULT_BASE_URL) ?: Protocol.DEFAULT_BASE_URL
    }

    fun setBaseUrl(ctx: Context, url: String) {
        ctx.getSharedPreferences(Protocol.PREFS, Context.MODE_PRIVATE).edit()
            .putString(Protocol.KEY_BASE_URL, url)
            .apply()
    }

    /** Envía acción elegida (ignorar, posponer, vender sim, comprar sim) tanto por Data Layer como por HTTP. */
    fun send(ctx: Context, nodeId: String?, alertId: String, action: String, onDone: (() -> Unit)? = null) {
        val payloadObj = JSONObject().put("alertId", alertId).put("action", action)
        val payloadBytes = payloadObj.toString().toByteArray(Charsets.UTF_8)

        // 1. Wearable Data Layer al teléfono
        runCatching {
            val msgClient = Wearable.getMessageClient(ctx)
            if (!nodeId.isNullOrEmpty()) {
                msgClient.sendMessage(nodeId, Protocol.PATH_ACTION, payloadBytes)
            } else {
                Wearable.getNodeClient(ctx).connectedNodes.addOnSuccessListener { nodes ->
                    nodes.forEach { msgClient.sendMessage(it.id, Protocol.PATH_ACTION, payloadBytes) }
                }
            }
        }

        // 2. Envío HTTP directo al backend (fallback de alta disponibilidad)
        thread {
            val base = getBaseUrl(ctx)
            val jsonMedia = "application/json; charset=utf-8".toMediaType()
            val body = payloadObj.toString().toRequestBody(jsonMedia)
            val encId = java.net.URLEncoder.encode(alertId, "UTF-8")
            val req = Request.Builder()
                .url("$base/alerts/$encId/action")
                .post(body)
                .build()

            runCatching {
                http.newCall(req).execute().use { }
            }
            onDone?.invoke()
        }
    }

    /** Envía nuevo umbral de caída (% stop-loss) al teléfono y al backend. */
    fun sendThreshold(ctx: Context, dropPercent: Double, onDone: (() -> Unit)? = null) {
        ctx.getSharedPreferences(Protocol.PREFS, Context.MODE_PRIVATE).edit()
            .putFloat(Protocol.KEY_DROP_PERCENT, dropPercent.toFloat())
            .apply()

        val payloadObj = JSONObject().put("dropPercent", dropPercent)
        val payloadBytes = payloadObj.toString().toByteArray(Charsets.UTF_8)

        // 1. Wearable Data Layer
        runCatching {
            val msgClient = Wearable.getMessageClient(ctx)
            Wearable.getNodeClient(ctx).connectedNodes.addOnSuccessListener { nodes ->
                nodes.forEach { msgClient.sendMessage(it.id, Protocol.PATH_SET_THRESHOLD, payloadBytes) }
            }
        }

        // 2. HTTP directo
        thread {
            val base = getBaseUrl(ctx)
            val jsonMedia = "application/json; charset=utf-8".toMediaType()
            val body = payloadObj.toString().toRequestBody(jsonMedia)
            val req = Request.Builder()
                .url("$base/config/threshold")
                .post(body)
                .build()

            runCatching {
                http.newCall(req).execute().use { }
            }
            onDone?.invoke()
        }
    }
}
