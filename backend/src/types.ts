/** Una vela (OHLCV). `t` en milisegundos epoch. */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Metric =
  | "dropFromHigh"     // % caída desde el máximo de las últimas N velas (valor positivo = caída)
  | "changePct"        // % de cambio sobre las últimas N velas (negativo = caída)
  | "volumeRatio"      // volumen actual / promedio de las últimas N velas
  | "priceZScore"      // z-score del retorno de la última vela vs. ventana de N velas
  | "volumeZScore"     // z-score del volumen vs. ventana de N velas
  | "atrMultiple"      // caída de la vela actual medida en múltiplos de ATR(N)
  | "trailingStopPct"; // % caída desde el máximo desde que se armó la regla

export type Op = ">" | ">=" | "<" | "<=";

export interface Condition {
  type: "cond";
  metric: Metric;
  op: Op;
  value: number;
  /** Ventana en velas (por defecto 20). */
  window?: number;
}

export interface Group {
  type: "all" | "any";
  items: Node[];
}

export type Node = Condition | Group;

export type Severity = "info" | "warning" | "critical";

export interface Rule {
  id: string;
  name: string;
  symbol: string;
  severity: Severity;
  when: Node;
  /** Velas mínimas entre dos disparos de la misma regla. */
  cooldownCandles?: number;
  enabled?: boolean;
}

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
  /** Valores de las métricas que se evaluaron al disparar, para explicar la alerta. */
  reasons: string[];
  /** Cuando hay agrupación, cuántas alertas colapsó. */
  groupedCount?: number;
}

export interface Tick {
  symbol: string;
  candle: Candle;
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
