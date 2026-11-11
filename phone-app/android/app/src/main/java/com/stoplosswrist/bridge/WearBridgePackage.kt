package com.stoplosswrist.bridge

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class WearBridgePackage : ReactPackage {
    override fun createNativeModules(c: ReactApplicationContext): List<NativeModule> = listOf(WearBridgeModule(c))
    override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
