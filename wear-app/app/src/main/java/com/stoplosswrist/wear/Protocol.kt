package com.stoplosswrist.wear

/** Protocolo de comunicación Wearable Data Layer y endpoints. */
object Protocol {
    const val PATH_ALERT = "/stoploss/alert"
    const val PATH_ACTION = "/stoploss/action"
    const val PATH_CONFIG = "/stoploss/config"
    const val PATH_SET_THRESHOLD = "/stoploss/set_threshold"

    const val ACTION_IGNORE = "ignore"
    const val ACTION_SNOOZE = "snooze"
    const val ACTION_SELL = "simulate_sell"
    const val ACTION_BUY = "simulate_buy"

    const val PREFS = "stoploss_wear_prefs"
    const val KEY_BASE_URL = "base_url"
    const val KEY_DROP_PERCENT = "drop_percent"
    const val DEFAULT_BASE_URL = "http://10.0.2.2:8080"
}
