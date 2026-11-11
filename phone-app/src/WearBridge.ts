import { NativeModules } from "react-native";
import { BASE_URL } from "./config";
import type { Alert } from "./types";

interface WearBridgeNative {
  configure(baseUrl: string): void;
  sendAlert(json: string): Promise<number>;
  sendConfig?(json: string): Promise<number>;
  connectedWatchCount(): Promise<number>;
}

const native: WearBridgeNative | undefined = NativeModules.WearBridge;

export const WearBridge = {
  init() {
    native?.configure(BASE_URL);
  },
  /** Devuelve cuántos relojes recibieron la alerta (0 si no hay reloj emparejado). */
  async sendAlert(alert: Alert): Promise<number> {
    if (!native) return 0;
    try {
      return await native.sendAlert(JSON.stringify(alert));
    } catch {
      return 0;
    }
  },
  /** Envía configuración del umbral de stop-loss al reloj vía Data Layer. */
  async sendConfig(dropPercent: number, symbol: string): Promise<number> {
    if (!native || !native.sendConfig) return 0;
    try {
      return await native.sendConfig(JSON.stringify({ dropPercent, symbol }));
    } catch {
      return 0;
    }
  },
  async watchCount(): Promise<number> {
    try {
      return native ? await native.connectedWatchCount() : 0;
    } catch {
      return 0;
    }
  },
};
