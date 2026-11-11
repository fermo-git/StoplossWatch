package com.stoplosswrist.bridge

object Protocol {
    const val PATH_ALERT = "/stoploss/alert"
    const val PATH_ACTION = "/stoploss/action"
    const val PATH_CONFIG = "/stoploss/config"
    const val PATH_SET_THRESHOLD = "/stoploss/set_threshold"

    const val PREFS = "stoploss_prefs"
    const val KEY_BASE_URL = "base_url"

    const val ACTION_IGNORE = "ignore"
    const val ACTION_SNOOZE = "snooze"
    const val ACTION_SELL = "simulate_sell"
    const val ACTION_BUY = "simulate_buy"
}
