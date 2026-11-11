package com.stoplosswrist.wear

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Interfaz del reloj para pantallas circulares.
 *
 * Tres pantallas independientes:
 *   1. Inicio: precio en vivo y accesos a Avisos y Límite.
 *   2. Aviso: qué pasó, explicado en una frase, y botones de acción.
 *   3. Límite: ajuste del porcentaje de caída que dispara el aviso.
 *
 * Todos los márgenes se calculan en dp y como porcentaje del diámetro de
 * la pantalla, de modo que el contenido nunca toca el borde redondo.
 */
class MainActivity : Activity() {

    enum class Section { HOME, ALERT, THRESHOLD }

    companion object {
        private var instance: MainActivity? = null

        fun onAlertReceived(alert: JSONObject) {
            instance?.runOnUiThread { instance?.handleIncomingAlert(alert) }
        }

        fun onConfigReceived(dropPercent: Double, symbol: String) {
            instance?.runOnUiThread { instance?.updateConfigFromExternal(dropPercent, symbol) }
        }

        fun onAlertActionHandled(alertId: String, action: String) {
            instance?.runOnUiThread { instance?.clearActiveAlert() }
        }
    }

    // Paleta
    private val cBg = Color.parseColor("#000000")
    private val cSurface = Color.parseColor("#16191F")
    private val cText = Color.parseColor("#F4F5F7")
    private val cDim = Color.parseColor("#9BA3AF")
    private val cMute = Color.parseColor("#5F6875")
    private val cGreen = Color.parseColor("#059669")
    private val cGreenSoft = Color.parseColor("#10B981")
    private val cRed = Color.parseColor("#DC2626")
    private val cRedSoft = Color.parseColor("#F87171")
    private val cAmber = Color.parseColor("#F59E0B")

    private val mainHandler = Handler(Looper.getMainLooper())
    private var dropPercent = 3.0
    private var symbol = "BTCUSDT"
    private var price = 0.0
    private var connected = false
    private var currentAlert: JSONObject? = null
    private var ws: WebSocket? = null
    private var section = Section.HOME

    private lateinit var scroll: ScrollView
    private lateinit var content: LinearLayout
    private var priceView: TextView? = null
    private var statusView: TextView? = null

    private fun dp(v: Number): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        instance = this

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
        }

        dropPercent = getSharedPreferences(Protocol.PREFS, Context.MODE_PRIVATE)
            .getFloat(Protocol.KEY_DROP_PERCENT, 3.0f).toDouble()

        setContentView(buildRoot())

        intent?.getStringExtra("latest_alert")?.let { raw ->
            runCatching { JSONObject(raw) }.getOrNull()?.let {
                currentAlert = it
                section = Section.ALERT
            }
        }

        render()
        connectBackendWebSocket()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) instance = null
        ws?.cancel()
    }

    private fun buildRoot(): View {
        val w = resources.displayMetrics.widthPixels
        // En un círculo, el cuadrado inscrito deja ~14.6% de margen por lado.
        val side = (w * 0.13).toInt()
        val top = (w * 0.14).toInt()
        val bottom = (w * 0.24).toInt()

        scroll = ScrollView(this).apply {
            setBackgroundColor(cBg)
            isVerticalScrollBarEnabled = false
            isFillViewport = true
        }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(side, top, side, bottom)
        }
        scroll.addView(content)
        return scroll
    }

    private fun render() {
        content.removeAllViews()
        priceView = null
        statusView = null
        when (section) {
            Section.HOME -> renderHome()
            Section.ALERT -> renderAlert()
            Section.THRESHOLD -> renderThreshold()
        }
        scroll.scrollTo(0, 0)
    }

    private fun go(s: Section) {
        section = s
        render()
    }

    // ------------------------------------------------------------------
    // 1. INICIO
    // ------------------------------------------------------------------
    private fun renderHome() {
        statusView = label(statusText(), 11f, if (connected) cGreenSoft else cMute, bold = true)
        content.addView(statusView)

        content.addView(label(symbol.replace("USDT", " / USDT"), 13f, cDim, top = 10))
        priceView = label(formatPrice(price), 26f, cText, bold = true, top = 2)
        content.addView(priceView)

        content.addView(
            label("Aviso si cae ${"%.1f".format(dropPercent)}%", 12f, cAmber, top = 4)
        )

        val hasAlert = currentAlert != null
        content.addView(
            button(
                if (hasAlert) "Ver aviso pendiente" else "Sin avisos",
                if (hasAlert) cRed else cSurface,
                textColor = if (hasAlert) Color.WHITE else cDim,
                top = 16,
            ) { go(Section.ALERT) }
        )
        content.addView(button("Ajustar límite", cSurface, top = 8) { go(Section.THRESHOLD) })
    }

    // ------------------------------------------------------------------
    // 2. AVISO
    // ------------------------------------------------------------------
    private fun renderAlert() {
        val alert = currentAlert
        if (alert == null) {
            content.addView(label("Todo en orden", 15f, cGreenSoft, bold = true, top = 24))
            content.addView(
                label(
                    "No hay caídas mayores a ${"%.1f".format(dropPercent)}% en $symbol.",
                    12f, cDim, top = 8
                )
            )
            content.addView(button("Volver", cSurface, top = 20) { go(Section.HOME) })
            return
        }

        val sym = alert.optString("symbol", symbol)
        val p = alert.optDouble("price", price)
        val drop = alert.optDouble("dropPercent", dropPercent)
        val critical = alert.optString("severity") == "critical"

        content.addView(
            label(if (critical) "CAÍDA FUERTE" else "CAÍDA MODERADA", 11f,
                if (critical) cRedSoft else cAmber, bold = true)
        )
        content.addView(label(sym.replace("USDT", ""), 14f, cDim, top = 6))
        content.addView(label("−${"%.1f".format(drop)}%", 30f, cText, bold = true))
        content.addView(label("Ahora ${formatPrice(p)}", 12f, cDim, top = 2))

        content.addView(button("Vender", cRed, top = 16) { handleAction(Protocol.ACTION_SELL) })
        content.addView(button("Comprar", cGreen, top = 8) { handleAction(Protocol.ACTION_BUY) })

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }
        row.addView(button("Luego", cSurface, weight = true, textSize = 12f) { handleAction(Protocol.ACTION_SNOOZE) })
        row.addView(View(this), LinearLayout.LayoutParams(dp(6), 1))
        row.addView(button("Ignorar", cSurface, weight = true, textSize = 12f) { handleAction(Protocol.ACTION_IGNORE) })
        content.addView(row)

        content.addView(textLink("Volver") { go(Section.HOME) })
    }

    // ------------------------------------------------------------------
    // 3. LÍMITE
    // ------------------------------------------------------------------
    private fun renderThreshold() {
        content.addView(label("LÍMITE DE CAÍDA", 11f, cAmber, bold = true))

        val valueView = label("%.1f%%".format(dropPercent), 34f, cText, bold = true, top = 6)
        val hintView = label(profileHint(), 11f, cMute, top = 2)

        fun update(v: Double) {
            dropPercent = (Math.round(v.coerceIn(0.5, 25.0) * 10.0) / 10.0)
            valueView.text = "%.1f%%".format(dropPercent)
            hintView.text = profileHint()
        }

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(6) }
        }
        row.addView(circle("−") { update(dropPercent - 0.5) })
        row.addView(valueView.apply {
            layoutParams = LinearLayout.LayoutParams(dp(92), LinearLayout.LayoutParams.WRAP_CONTENT)
            setPadding(0, 0, 0, 0)
        })
        row.addView(circle("+") { update(dropPercent + 0.5) })
        content.addView(row)
        content.addView(hintView)

        content.addView(button("Guardar", cGreen, top = 16) {
            ActionSender.sendThreshold(this, dropPercent) {
                mainHandler.post { go(Section.HOME) }
            }
        })
        content.addView(textLink("Cancelar") { go(Section.HOME) })
    }

    private fun profileHint(): String = when {
        dropPercent < 2.0 -> "Muy sensible"
        dropPercent < 4.0 -> "Equilibrado"
        dropPercent < 7.0 -> "Tolerante"
        else -> "Solo caídas grandes"
    }

    // ------------------------------------------------------------------
    // Estado
    // ------------------------------------------------------------------
    private fun handleIncomingAlert(alert: JSONObject) {
        currentAlert = alert
        go(Section.ALERT)
    }

    private fun clearActiveAlert() {
        currentAlert = null
        go(Section.HOME)
    }

    private fun updateConfigFromExternal(drop: Double, sym: String) {
        dropPercent = drop
        symbol = sym
        if (section != Section.THRESHOLD) render()
    }

    private fun handleAction(action: String) {
        val alert = currentAlert ?: return
        ActionSender.send(this, null, alert.optString("id"), action) {
            mainHandler.post { clearActiveAlert() }
        }
    }

    private fun statusText() = if (connected) "● En vivo" else "● Sin conexión"

    private fun setConnected(v: Boolean) {
        connected = v
        statusView?.apply {
            text = statusText()
            setTextColor(if (v) cGreenSoft else cMute)
        }
    }

    private fun formatPrice(p: Double): String = when {
        p <= 0 -> "—"
        p >= 1000 -> "$" + "%,.2f".format(p)
        p >= 1 -> "$" + "%.2f".format(p)
        else -> "$" + "%.5f".format(p)
    }

    private fun connectBackendWebSocket() {
        val base = ActionSender.getBaseUrl(this)
        val wsUrl = base.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
        val client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()

        ws = client.newWebSocket(Request.Builder().url(wsUrl).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                mainHandler.post { setConnected(true) }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val msg = JSONObject(text)
                    when (msg.optString("type")) {
                        "hello" -> {
                            val d = msg.optDouble("dropPercent", dropPercent)
                            val s = msg.optString("activeSymbol", symbol)
                            mainHandler.post { updateConfigFromExternal(d, s) }
                        }
                        "tick" -> {
                            val p = msg.optJSONObject("candle")?.optDouble("c") ?: 0.0
                            val s = msg.optString("symbol", symbol)
                            mainHandler.post {
                                val changed = s != symbol
                                price = p
                                symbol = s
                                if (section == Section.HOME) {
                                    if (changed) render() else priceView?.text = formatPrice(p)
                                }
                            }
                        }
                        "alert" -> msg.optJSONObject("alert")?.let { a ->
                            mainHandler.post {
                                AlertNotifier.show(this@MainActivity, a, null)
                                handleIncomingAlert(a)
                            }
                        }
                        "action" -> mainHandler.post { clearActiveAlert() }
                        "config" -> {
                            val d = msg.optDouble("dropPercent", dropPercent)
                            mainHandler.post { updateConfigFromExternal(d, symbol) }
                        }
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                mainHandler.post { setConnected(false) }
                mainHandler.postDelayed({ connectBackendWebSocket() }, 4000)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                mainHandler.post { setConnected(false) }
                mainHandler.postDelayed({ connectBackendWebSocket() }, 5000)
            }
        })
    }

    // ------------------------------------------------------------------
    // Componentes
    // ------------------------------------------------------------------
    private fun label(
        text: String, size: Float, color: Int, bold: Boolean = false, top: Int = 0,
    ) = TextView(this).apply {
        this.text = text
        textSize = size
        setTextColor(color)
        gravity = Gravity.CENTER
        typeface = if (bold) Typeface.create("sans-serif-medium", Typeface.BOLD) else Typeface.create("sans-serif", Typeface.NORMAL)
        includeFontPadding = false
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(top) }
    }

    private fun button(
        text: String, bg: Int, textColor: Int = Color.WHITE, top: Int = 0,
        weight: Boolean = false, textSize: Float = 14f, onClick: () -> Unit,
    ) = TextView(this).apply {
        this.text = text
        this.textSize = textSize
        setTextColor(textColor)
        gravity = Gravity.CENTER
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        background = GradientDrawable().apply {
            setColor(bg)
            cornerRadius = dp(24).toFloat()
        }
        isClickable = true
        setOnClickListener { onClick() }
        layoutParams = if (weight)
            LinearLayout.LayoutParams(0, dp(40), 1f)
        else
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply { topMargin = dp(top) }
    }

    private fun circle(text: String, onClick: () -> Unit) = TextView(this).apply {
        this.text = text
        textSize = 22f
        setTextColor(cText)
        gravity = Gravity.CENTER
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(cSurface)
        }
        isClickable = true
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(dp(40), dp(40))
    }

    private fun textLink(text: String, onClick: () -> Unit) = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(cDim)
        gravity = Gravity.CENTER
        setPadding(0, dp(12), 0, dp(4))
        isClickable = true
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        )
    }
}
