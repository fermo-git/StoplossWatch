export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Severity = "info" | "warning" | "critical";
export type AlertStatus = "active" | "dismissed" | "snoozed" | "bought" | "sold";

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  symbol: string;
  severity: Severity;
  t: number;
  price: number;
  dropPercent?: number;
  friendlyTitle?: string;
  summary?: string;
  actionHint?: string;
  status?: AlertStatus;
  reasons: string[];
  groupedCount?: number;
}

export type WatchAction = "ignore" | "snooze" | "simulate_sell" | "simulate_buy";

export interface PaperOrder {
  id: string;
  alertId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  amount: number;
  total: number;
  t: number;
}

export interface Position {
  symbol: string;
  amount: number;
  avgPrice: number;
  currentValue?: number;
  pnl?: number;
  pnlPercent?: number;
}

export interface Portfolio {
  cash: number;
  positions: Record<string, Position>;
  orders: PaperOrder[];
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
}

export interface MarketAsset {
  symbol: string;
  name: string;
  network: string;
  category: string;
}

export interface BinanceUser {
  authenticated: boolean;
  accountId: string;
  accountType: string;
  virtualBalanceUSDT: number;
  email: string;
}

export type ServerEvent =
  | {
      type: "hello";
      feed: { mode: string; scenario?: string; symbols?: string[]; activeSymbol?: string };
      activeSymbol?: string;
      dropPercent?: number;
      recentAlerts: Alert[];
      portfolio?: Portfolio;
    }
  | { type: "tick"; symbol: string; candle: Candle }
  | { type: "alert"; alert: Alert }
  | { type: "order"; order: PaperOrder; portfolio?: Portfolio }
  | { type: "action"; alertId: string; action: WatchAction; status: AlertStatus; detail?: string }
  | { type: "config"; dropPercent: number };

export type ChartRange = "1D" | "1W" | "1M" | "1Y";

export interface ChartData {
  symbol: string;
  range: ChartRange;
  points: { t: number; c: number }[];
  high: number;
  low: number;
  changePct: number;
}

export interface MarketSummary {
  symbol: string;
  price: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  volumeQuote24h: number;
  spark: number[];
}
