import { atr, maxHigh, mean, returns, zScore } from "../indicators.js";
import type { Alert, Candle, Condition, Node, Op, Rule } from "../types.js";

const DEFAULT_WINDOW = 20;

interface RuleState {
  /** Máximo desde que la regla empezó a evaluarse (para trailing stop). */
  peak: number;
  lastFiredIdx: number;
  /** Timestamp de la última vela en que disparó (para evitar re-disparo intra-vela). */
  lastFiredCandleT: number;
}

interface EvalResult {
  ok: boolean;
  reasons: string[];
  dropPct?: number;
}

const cmp = (a: number, op: Op, b: number): boolean =>
  op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;

function formatReason(metric: string, value: number, op: Op, threshold: number): string {
  let human = "";
  switch (metric) {
    case "dropFromHigh":
      human = `caída de ${value.toFixed(2)}% desde máx`;
      break;
    case "changePct":
      human = `variación de ${value.toFixed(2)}%`;
      break;
    case "volumeRatio":
      human = `volumen ${value.toFixed(1)}x promedio`;
      break;
    case "volumeZScore":
      human = `volumen anómalo Z=${value.toFixed(2)}`;
      break;
    case "priceZScore":
      human = `caída atípica Z=${value.toFixed(2)}`;
      break;
    case "atrMultiple":
      human = `${value.toFixed(1)}x ATR`;
      break;
    case "trailingStopPct":
      human = `trailing stop ${value.toFixed(2)}%`;
      break;
  }
  return human
    ? `${metric}=${value.toFixed(2)} ${op} ${threshold} (${human})`
    : `${metric}=${value.toFixed(2)} ${op} ${threshold}`;
}

/**
 * Evalúa reglas sobre un historial de velas. Es puro respecto al mercado:
 * la misma instancia sirve para tiempo real, simulación y backtesting.
 */
export class RuleEngine {
  private state = new Map<string, RuleState>();
  private seq = 0;

  constructor(private rules: Rule[]) {}

  setRules(rules: Rule[]) {
    this.rules = rules;
  }

  reset() {
    this.state.clear();
  }

  /** Inicializa el pico histórico de las reglas sin disparar alertas pasadas. */
  warmup(symbol: string, candles: Candle[]) {
    if (candles.length === 0) return;
    const peak = Math.max(...candles.map((c) => c.h));
    for (const rule of this.rules) {
      if (rule.symbol !== symbol) continue;
      this.state.set(rule.id, { peak, lastFiredIdx: -Infinity, lastFiredCandleT: -Infinity });
    }
  }

  /** Llamar tras agregar cada vela cerrada. `idx` es el índice de la última vela. */
  evaluate(symbol: string, candles: Candle[], idx = candles.length - 1): Alert[] {
    const alerts: Alert[] = [];
    for (const rule of this.rules) {
      if (rule.symbol !== symbol || rule.enabled === false) continue;

      const st = this.state.get(rule.id) ?? {
        peak: candles[idx].h,
        lastFiredIdx: -Infinity,
        lastFiredCandleT: -Infinity,
      };
      st.peak = Math.max(st.peak, candles[idx].h);
      this.state.set(rule.id, st);

      const cooldown = rule.cooldownCandles ?? 10;
      const cooldownMs = cooldown * 60_000;
      if (idx - st.lastFiredIdx < cooldown && candles[idx].t - st.lastFiredCandleT < cooldownMs) continue;

      const res = this.evalNode(rule.when, candles, idx, st);
      if (!res.ok) continue;

      st.lastFiredIdx = idx;
      st.lastFiredCandleT = candles[idx].t;
      const currentPrice = candles[idx].c;
      const drop = res.dropPct ?? ((st.peak - currentPrice) / (st.peak || 1)) * 100;

      const prefix = rule.severity === "critical" ? "Caída fuerte" : "Caída moderada";
      const friendlyTitle = `${prefix} en ${symbol}${drop > 0 ? ` (-${drop.toFixed(1)}%)` : ""}`;
      const summary =
        drop > 0
          ? `${symbol} bajó ${drop.toFixed(2)}% desde su precio más alto reciente ($${st.peak.toFixed(2)}). Ahora vale $${currentPrice.toFixed(2)}.`
          : `${symbol} tuvo un movimiento brusco fuera de lo normal. Ahora vale $${currentPrice.toFixed(2)}.`;
      const actionHint = "Vende si quieres limitar la pérdida, o compra si crees que el precio va a rebotar.";

      alerts.push({
        id: `${rule.id}-${candles[idx].t}-${this.seq++}`,
        ruleId: rule.id,
        ruleName: rule.name,
        symbol,
        severity: rule.severity,
        t: candles[idx].t,
        price: currentPrice,
        dropPercent: Math.max(0, drop),
        friendlyTitle,
        summary,
        actionHint,
        status: "active",
        reasons: res.reasons,
      });
    }
    return alerts;
  }

  private evalNode(node: Node, c: Candle[], idx: number, st: RuleState): EvalResult {
    if (node.type === "cond") return this.evalCond(node, c, idx, st);
    const results = node.items.map((n) => this.evalNode(n, c, idx, st));
    const ok = node.type === "all" ? results.every((r) => r.ok) : results.some((r) => r.ok);
    const dropPct = results.find((r) => r.dropPct !== undefined)?.dropPct;
    // Solo explicamos con las condiciones que realmente se cumplieron.
    return { ok, reasons: ok ? results.filter((r) => r.ok).flatMap((r) => r.reasons) : [], dropPct };
  }

  private evalCond(cond: Condition, c: Candle[], idx: number, st: RuleState): EvalResult {
    const value = this.metric(cond, c, idx, st);
    if (value === null || !Number.isFinite(value)) return { ok: false, reasons: [] };
    const ok = cmp(value, cond.op, cond.value);
    const dropPct = cond.metric === "dropFromHigh" || cond.metric === "trailingStopPct" ? value : undefined;
    return {
      ok,
      reasons: ok ? [formatReason(cond.metric, value, cond.op, cond.value)] : [],
      dropPct,
    };
  }

  /** Devuelve null si no hay suficientes datos (la condición se considera falsa). */
  metric(cond: Condition, c: Candle[], idx: number, st: RuleState): number | null {
    const w = cond.window ?? DEFAULT_WINDOW;
    const cur = c[idx];
    switch (cond.metric) {
      case "dropFromHigh": {
        if (idx - w + 1 < 0) return null;
        const hi = maxHigh(c, idx - w + 1, idx);
        return ((hi - cur.c) / hi) * 100;
      }
      case "changePct": {
        if (idx - w < 0) return null;
        const base = c[idx - w].c;
        return ((cur.c - base) / base) * 100;
      }
      case "volumeRatio": {
        if (idx - w < 0) return null;
        const avg = mean(c.slice(idx - w, idx).map((x) => x.v));
        return avg > 0 ? cur.v / avg : null;
      }
      case "volumeZScore": {
        if (idx - w < 0) return null;
        return zScore(cur.v, c.slice(idx - w, idx).map((x) => x.v));
      }
      case "priceZScore": {
        if (idx - w < 1) return null;
        const hist = returns(c, idx - w + 1, idx - 1);
        return zScore(cur.c / c[idx - 1].c - 1, hist);
      }
      case "atrMultiple": {
        const a = atr(c, idx - 1, w);
        if (a === null || a === 0) return null;
        return (c[idx - 1].c - cur.c) / a;
      }
      case "trailingStopPct":
        return ((st.peak - cur.c) / st.peak) * 100;
    }
  }
}
