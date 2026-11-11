package com.stoplosswrist.bridge

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.wearable.Wearable

/** Puente React Native -> Wearable Data Layer. Expuesto en JS como NativeModules.WearBridge. */
class WearBridgeModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "WearBridge"

    /** Guarda la URL del backend para que PhoneListenerService pueda reenviar acciones aunque RN esté cerrado. */
    @ReactMethod
    fun configure(baseUrl: String) {
        ctx.getSharedPreferences(Protocol.PREFS, Context.MODE_PRIVATE).edit().putString(Protocol.KEY_BASE_URL, baseUrl).apply()
    }

    /** Envía el JSON de una alerta a todos los relojes conectados. Resuelve con cuántos nodos la recibieron. */
    @ReactMethod
    fun sendAlert(json: String, promise: Promise) {
        val bytes = json.toByteArray(Charsets.UTF_8)
        Wearable.getNodeClient(ctx).connectedNodes
            .addOnSuccessListener { nodes ->
                nodes.forEach { Wearable.getMessageClient(ctx).sendMessage(it.id, Protocol.PATH_ALERT, bytes) }
                promise.resolve(nodes.size)
            }
            .addOnFailureListener { promise.reject("WEAR_NODES", it) }
    }

    @ReactMethod
    fun connectedWatchCount(promise: Promise) {
        Wearable.getNodeClient(ctx).connectedNodes
            .addOnSuccessListener { promise.resolve(it.size) }
            .addOnFailureListener { promise.reject("WEAR_NODES", it) }
    }

    /** Envía configuración de umbral y activo al reloj vía Data Layer. */
    @ReactMethod
    fun sendConfig(json: String, promise: Promise) {
        val bytes = json.toByteArray(Charsets.UTF_8)
        Wearable.getNodeClient(ctx).connectedNodes
            .addOnSuccessListener { nodes ->
                nodes.forEach { Wearable.getMessageClient(ctx).sendMessage(it.id, Protocol.PATH_CONFIG, bytes) }
                promise.resolve(nodes.size)
            }
            .addOnFailureListener { promise.reject("WEAR_NODES", it) }
    }

    // Requeridos por NativeEventEmitter aunque no emitamos eventos desde aquí.
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
