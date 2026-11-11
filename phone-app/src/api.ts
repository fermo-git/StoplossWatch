import { BASE_URL } from "./config";
import type { Alert, BinanceUser, ChartData, ChartRange, MarketAsset, MarketSummary, Portfolio, Scenario, WatchAction } from "./types";

const req = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
};

export const api = {
  scenarios: (): Promise<Scenario[]> => req("/scenarios"),

  getCatalog: (): Promise<MarketAsset[]> => req("/catalog"),

  getOverview: (): Promise<MarketSummary[]> => req("/market/overview"),

  getChart: (symbol: string, range: ChartRange): Promise<ChartData> =>
    req(`/market/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`),

  startSimulation: (scenario: string, msPerCandle = 90) =>
    req("/simulate/start", { method: "POST", body: JSON.stringify({ scenario, msPerCandle }) }),

  stopSimulation: () => req("/simulate/stop", { method: "POST" }),

  startLive: (symbols: string[] = ["BTCUSDT"]) =>
    req("/live/start", { method: "POST", body: JSON.stringify({ symbols }) }),

  getConfig: () => req("/config"),

  setThreshold: (dropPercent: number, symbol?: string) =>
    req("/config/threshold", { method: "POST", body: JSON.stringify({ dropPercent, symbol }) }),

  getAlerts: (all = false): Promise<Alert[]> => req(`/alerts?all=${all}`),

  getPortfolio: (): Promise<Portfolio> => req("/portfolio"),

  act: (alertId: string, action: WatchAction, snoozeMinutes = 15) =>
    req(`/alerts/${encodeURIComponent(alertId)}/action`, {
      method: "POST",
      body: JSON.stringify({ action, snoozeMinutes }),
    }),

  manualOrder: (symbol: string, side: "BUY" | "SELL", amount?: number) =>
    req("/orders/simulate", { method: "POST", body: JSON.stringify({ symbol, side, amount }) }),

  triggerTestAlert: (symbol = "BTCUSDT", price?: number) =>
    req("/alerts/test", { method: "POST", body: JSON.stringify({ symbol, price }) }),

  getAuthStatus: (): Promise<BinanceUser> => req("/auth/status"),

  loginBinance: (email?: string, apiKey?: string) =>
    req("/auth/binance", { method: "POST", body: JSON.stringify({ email, apiKey }) }),

  logoutBinance: () => req("/auth/logout", { method: "POST" }),
};
