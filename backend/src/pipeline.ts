import { AlertFatigueFilter } from "./alerts/antifatigue.js";
import { defaultRules } from "./default-rules.js";
import { RuleEngine } from "./rules/engine.js";
import type { Alert, AlertStatus, Candle, PaperOrder, Portfolio, Position, Rule, Tick, WatchAction } from "./types.js";

const MAX_BUFFER = 500;
const INITIAL_CASH = 10000;

export type PipelineEvent =
  | { type: "tick"; symbol: string; candle: Candle }
  | { type: "alert"; alert: Alert }
  | { type: "order"; order: PaperOrder; portfolio: Portfolio }
  | { type: "action"; alertId: string; action: WatchAction; status: AlertStatus; detail?: string }
  | { type: "config"; dropPercent: number };

/**
 * Orquesta una vela entrante: buffer -> reglas -> snooze -> anti-fatiga -> entrega.
 * Maneja además el portafolio simulado (compras/ventas) y el estado de las alertas.
 */
export class Pipeline {
  private engine: RuleEngine;
  private filter = new AlertFatigueFilter();
  private buffers = new Map<string, Candle[]>();
  private alerts: Alert[] = [];
  private orders: PaperOrder[] = [];
  private snoozedUntil = new Map<string, number>();
  private listeners = new Set<(e: PipelineEvent) => void>();

  private cash = INITIAL_CASH;
  private positions: Record<string, Position> = {};
  private currentDropPercent: number;

  constructor(private rules: Rule[] = [], initialDropPercent?: number) {
    if (initialDropPercent !== undefined) {
      this.currentDropPercent = initialDropPercent;
    } else {
      let inferred = 2.5;
      for (const r of rules) {
        if (r.when.type === "all" || r.when.type === "any") {
          const c = r.when.items.find((it) => it.type === "cond" && it.metric === "dropFromHigh");
          if (c && c.type === "cond") {
            inferred = c.value;
            break;
          }
        } else if (r.when.type === "cond" && r.when.metric === "dropFromHigh") {
          inferred = r.when.value;
          break;
        }
      }
      this.currentDropPercent = inferred;
    }
    this.engine = new RuleEngine(rules);
  }

  subscribe(fn: (e: PipelineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: PipelineEvent) {
    for (const l of this.listeners) l(e);
  }

  getRules(): Rule[] {
    return this.rules;
  }

  setRules(rules: Rule[]) {
    this.rules = rules;
    this.engine.setRules(rules);
  }

  getDropPercent(): number {
    return this.currentDropPercent;
  }

  setDropPercent(percent: number, activeSymbol?: string) {
    this.currentDropPercent = Math.max(0.2, Number(percent) || 2.5);
    const sym = activeSymbol ?? this.rules[0]?.symbol ?? "SIM";
    const updated = defaultRules(sym, this.currentDropPercent);
    this.setRules(updated);
    // Actualizar también las alertas activas cuyo porcentaje era menor al nuevo umbral
    for (const a of this.alerts) {
      if (a.status === "active" && (a.dropPercent ?? 0) < this.currentDropPercent) {
        a.status = "dismissed";
      }
    }
    const buf = this.buffers.get(sym);
    if (buf) this.engine.warmup(sym, buf);
    this.emit({ type: "config", dropPercent: this.currentDropPercent });
    return this.currentDropPercent;
  }

  getAlerts(limit = 50, includeArchived = false): Alert[] {
    const list = includeArchived ? this.alerts : this.alerts.filter((a) => a.status === "active");
    return list.slice(-limit).reverse();
  }

  getOrders(): PaperOrder[] {
    return [...this.orders].reverse();
  }

  getPortfolio(): Portfolio {
    // Recalcular valor actual y PnL de posiciones según último precio conocido
    const updatedPos: Record<string, Position> = {};
    for (const [sym, pos] of Object.entries(this.positions)) {
      const lastPrice = this.buffers.get(sym)?.at(-1)?.c ?? pos.avgPrice;
      const currentValue = pos.amount * lastPrice;
      const cost = pos.amount * pos.avgPrice;
      const pnl = currentValue - cost;
      const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
      updatedPos[sym] = {
        ...pos,
        currentValue,
        pnl,
        pnlPercent,
      };
    }
    return {
      cash: this.cash,
      positions: updatedPos,
      orders: [...this.orders].reverse(),
    };
  }

  /** Reinicia estado de mercado (útil al empezar una simulación nueva). */
  resetMarketState() {
    this.buffers.clear();
    this.engine.reset();
    this.filter.reset();
    this.snoozedUntil.clear();
  }

  /** Inyecta velas históricas en lote para calentar indicadores al instante. */
  seedCandles(symbol: string, candles: Candle[]) {
    const sliced = candles.slice(-MAX_BUFFER);
    this.buffers.set(symbol, sliced);
    this.engine.warmup(symbol, sliced);
    const last = sliced.at(-1);
    if (last) this.emit({ type: "tick", symbol, candle: last });
  }

  onTick({ symbol, candle }: Tick) {
    const buf = this.buffers.get(symbol) ?? [];
    const last = buf.at(-1);
    if (last && last.t === candle.t) {
      // Actualización intra-minuto: actualizar vela en curso sin duplicar entradas en el historial
      buf[buf.length - 1] = candle;
    } else {
      buf.push(candle);
      if (buf.length > MAX_BUFFER) buf.shift();
    }
    this.buffers.set(symbol, buf);
    this.emit({ type: "tick", symbol, candle });

    const fired = this.engine
      .evaluate(symbol, buf)
      .filter((a) => candle.t >= (this.snoozedUntil.get(a.ruleId) ?? 0));

    const { deliver } = this.filter.process(fired);
    for (const alert of deliver) {
      alert.status = "active";
      this.alerts.push(alert);
      this.emit({ type: "alert", alert });
    }
  }

  private alertSeq = 0;

  /** Dispara una alerta de prueba inmediata para demos y pruebas rápidas. */
  triggerImmediateTestAlert(symbol = "SIM", customPrice?: number): Alert {
    const lastPrice = customPrice ?? this.buffers.get(symbol)?.at(-1)?.c ?? 64500;
    const dropPct = this.currentDropPercent;
    const alert: Alert = {
      id: `test-${Date.now()}-${this.alertSeq++}`,
      ruleId: `${symbol}-manual-test`,
      ruleName: `Alerta Inmediata: Caída de ${dropPct}%`,
      symbol,
      severity: "critical",
      t: Date.now(),
      price: lastPrice,
      dropPercent: dropPct,
      friendlyTitle: `Caída fuerte en ${symbol} (-${dropPct}%)`,
      summary: `${symbol} bajó ${dropPct}% desde su precio más alto reciente, superando tu límite. Ahora vale $${lastPrice.toFixed(2)}.`,
      actionHint: "Vende si quieres limitar la pérdida, o compra si crees que el precio va a rebotar.",
      status: "active",
      reasons: [
        `Caída repentina de ${dropPct}% desde el máximo de sesión`,
        `Volumen anómalo 2.4x el promedio habitual`,
      ],
    };
    this.alerts.push(alert);
    this.emit({ type: "alert", alert });
    return alert;
  }

  /** Acción elegida desde el teléfono o el reloj. Devuelve false si la alerta no existe. */
  applyAction(alertId: string, action: WatchAction, snoozeMinutes = 15): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert) return false;

    const last = this.buffers.get(alert.symbol)?.at(-1);
    const execPrice = last?.c ?? alert.price;
    const now = last?.t ?? Date.now();

    if (action === "ignore") {
      alert.status = "dismissed";
      this.emit({ type: "action", alertId, action, status: "dismissed", detail: "Alerta ignorada y archivada" });
      return true;
    }

    if (action === "snooze") {
      alert.status = "snoozed";
      this.snoozedUntil.set(alert.ruleId, now + snoozeMinutes * 60_000);
      this.emit({
        type: "action",
        alertId,
        action,
        status: "snoozed",
        detail: `Regla pospuesta por ${snoozeMinutes} minutos`,
      });
      return true;
    }

    if (action === "simulate_buy") {
      alert.status = "bought";
      // Asignar monto simulado (ej. $1000 USDT o 10% del balance disponible)
      const spend = Math.min(this.cash, Math.max(100, this.cash * 0.25));
      const amount = spend / execPrice;
      this.cash -= spend;

      const currentPos = this.positions[alert.symbol];
      if (currentPos) {
        const totalAmount = currentPos.amount + amount;
        const totalCost = currentPos.amount * currentPos.avgPrice + spend;
        this.positions[alert.symbol] = {
          symbol: alert.symbol,
          amount: totalAmount,
          avgPrice: totalCost / totalAmount,
        };
      } else {
        this.positions[alert.symbol] = {
          symbol: alert.symbol,
          amount,
          avgPrice: execPrice,
        };
      }

      const order: PaperOrder = {
        id: `ord-buy-${this.orders.length + 1}`,
        alertId,
        symbol: alert.symbol,
        side: "BUY",
        price: execPrice,
        amount,
        total: spend,
        t: now,
      };
      this.orders.push(order);
      this.emit({ type: "order", order, portfolio: this.getPortfolio() });
      this.emit({
        type: "action",
        alertId,
        action,
        status: "bought",
        detail: `COMPRA SIMULADA: +${amount.toFixed(4)} ${alert.symbol} @ $${execPrice.toFixed(2)} ($${spend.toFixed(2)} USDT)`,
      });
      return true;
    }

    if (action === "simulate_sell") {
      alert.status = "sold";
      const currentPos = this.positions[alert.symbol];
      let amount = currentPos?.amount ?? 1;
      let revenue = amount * execPrice;
      if (currentPos) {
        this.cash += revenue;
        delete this.positions[alert.symbol];
      }

      const order: PaperOrder = {
        id: `ord-sell-${this.orders.length + 1}`,
        alertId,
        symbol: alert.symbol,
        side: "SELL",
        price: execPrice,
        amount,
        total: revenue,
        t: now,
      };
      this.orders.push(order);
      this.emit({ type: "order", order, portfolio: this.getPortfolio() });
      this.emit({
        type: "action",
        alertId,
        action,
        status: "sold",
        detail: `VENTA STOP-LOSS SIMULADA: -${amount.toFixed(4)} ${alert.symbol} @ $${execPrice.toFixed(2)} ($${revenue.toFixed(2)} USDT)`,
      });
      return true;
    }

    return false;
  }

  /** Ejecutar compra o venta manual sin alerta previa */
  manualOrder(symbol: string, side: "BUY" | "SELL", amountOrTotal?: number): PaperOrder | null {
    const lastPrice = this.buffers.get(symbol)?.at(-1)?.c;
    if (!lastPrice || lastPrice <= 0) return null;
    const now = Date.now();

    if (side === "BUY") {
      const spend = amountOrTotal ?? Math.min(this.cash, 1000);
      if (spend > this.cash || spend <= 0) return null;
      const amount = spend / lastPrice;
      this.cash -= spend;

      const currentPos = this.positions[symbol];
      if (currentPos) {
        const totalAmount = currentPos.amount + amount;
        const totalCost = currentPos.amount * currentPos.avgPrice + spend;
        this.positions[symbol] = {
          symbol,
          amount: totalAmount,
          avgPrice: totalCost / totalAmount,
        };
      } else {
        this.positions[symbol] = {
          symbol,
          amount,
          avgPrice: lastPrice,
        };
      }

      const order: PaperOrder = {
        id: `ord-buy-${this.orders.length + 1}`,
        symbol,
        side: "BUY",
        price: lastPrice,
        amount,
        total: spend,
        t: now,
      };
      this.orders.push(order);
      this.emit({ type: "order", order, portfolio: this.getPortfolio() });
      return order;
    } else {
      const currentPos = this.positions[symbol];
      if (!currentPos || currentPos.amount <= 0) return null;
      const amount = currentPos.amount;
      const revenue = amount * lastPrice;
      this.cash += revenue;
      delete this.positions[symbol];

      const order: PaperOrder = {
        id: `ord-sell-${this.orders.length + 1}`,
        symbol,
        side: "SELL",
        price: lastPrice,
        amount,
        total: revenue,
        t: now,
      };
      this.orders.push(order);
      this.emit({ type: "order", order, portfolio: this.getPortfolio() });
      return order;
    }
  }
}
