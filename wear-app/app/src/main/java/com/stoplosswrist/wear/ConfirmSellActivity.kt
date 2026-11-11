package com.stoplosswrist.wear

import android.app.Activity
import android.app.NotificationManager
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Pantalla mínima de confirmación (sin dependencias de Compose) para evitar toques accidentales. */
class ConfirmSellActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val alertId = intent.getStringExtra("alertId") ?: return finish()
        val nodeId = intent.getStringExtra("nodeId") ?: return finish()
        val symbol = intent.getStringExtra("symbol") ?: ""
        val price = intent.getDoubleExtra("price", 0.0)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            setPadding(24, 24, 24, 24)
        }
        root.addView(TextView(this).apply {
            text = "¿Orden SIMULADA de venta de $symbol a ${"%.2f".format(price)}?"
            setTextColor(Color.WHITE); gravity = Gravity.CENTER
        })
        root.addView(Button(this).apply {
            text = "Confirmar"
            setOnClickListener {
                ActionSender.send(this@ConfirmSellActivity, nodeId, alertId, Protocol.ACTION_SELL)
                getSystemService(NotificationManager::class.java).cancel(intent.getIntExtra("notifId", 0))
                finish()
            }
        })
        root.addView(Button(this).apply { text = "Cancelar"; setOnClickListener { finish() } })
        setContentView(root)
    }
}
