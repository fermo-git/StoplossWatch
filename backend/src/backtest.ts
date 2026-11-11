import { AlertFatigueFilter, DEFAULT_FATIGUE, type FatigueConfig } from "./alerts/antifatigue.js";
import { RuleEngine } from "./rules/engine.js";
import type { Alert, Candle, Rule } from "./types.js";

export interface BacktestOptions {
  /** Una alerta es "útil" si el precio cae al menos esto (%) más dentro del horizonte. */
  usefulDropPct: number;
  horizonCandles: number;
  /** Un "evento" es una caída >= eventDropPct (%) desde el máximo de las últimas eventLookback velas. */
  eventDropPct: number;
  eventLookback: number;
  fatigue: FatigueConfig;
  useFatigueFilter: boolean;
}

export const DEFAULT_BACKTEST: BacktestOptions = {
  usefulDropPct: 1,
  horizonCandles: 15,
  eventDropPct: 5,
  eventLookback: 60,
  fatigue: DEFAULT_FATIGUE,
  useFatigueFilter: true,
};

export interface EventEpisode {
  startIdx: number;
  endIdx: number;
  detected: boolean;
  /** Velas entre el inicio del evento y la primera alerta; negativo = alerta anticipada (null si no se detectó). */
  firstAlertDelay: number | null;
  /** % que ya había caído el precio desde el máximo previo cuando sonó la primera alerta. */
  dropAlreadyTakenPct: number | null;
}

export interface BacktestReport {
  candles: number;
  rawAlerts: number;
  delivered: number;
  suppressed: number;
  useful: number;
  falseAlerts: number;
  /** useful / delivered. null si no hubo alertas. */
  precision: number | null;
  events: EventEpisode[];
  /** Eventos detectados / eventos totales. null si no hubo eventos. */
  recall: number | null;
  deliveredAlerts: Alert[];
}

export function backtest(
  rules: Rule[],
  symbol: string,
  candles: Candle[],
  opts: Partial<BacktestOptions> = {},
): BacktestReport {
  const o: BacktestOptions = { ...DEFAULT_BACKTEST, ...opts };
  const engine = new RuleEngine(rules);
  const filter = new AlertFatigueFilter(o.fatigue);

  const delivered: Alert[] = [];
  let raw = 0;
  let suppressed = 0;

  for (let i = 0; i < candles.length; i++) {
    const fired = engine.evaluate(symbol, candles, i);
    raw += fired.length;
    if (o.useFatigueFilter) {
      const r = filter.process(fired);
      delivered.push(...r.deliver);
      suppressed += r.suppressed.length;
    } else {
      delivered.push(...fired);
    }
  }

  const idxByT = new Map(candles.map((c, i) => [c.t, i]));
  let useful = 0;
  for (const a of delivered) {
    const i = idxByT.get(a.t)!;
    const end = Math.min(candles.length - 1, i + o.horizonCandles);
    let minLow = Infinity;
    for (let j = i + 1; j <= end; j++) minLow = Math.min(minLow, candles[j].l);
    if (minLow <= a.price * (1 - o.usefulDropPct / 100)) useful++;
  }

  const events = findEvents(candles, o).map((e) => {
    const hit = delivered
      .map((a) => ({ a, i: idxByT.get(a.t)! }))
      // Se acepta una alerta anticipada: hasta `horizonCandles` antes de que la caída cruce el umbral.
      .filter(({ i }) => i >= e.startIdx - o.horizonCandles && i <= e.endIdx)
      .sort((x, y) => x.i - y.i)[0];
    if (!hit) return { ...e, detected: false, firstAlertDelay: null, dropAlreadyTakenPct: null };
    const hi = Math.max(...candles.slice(Math.max(0, hit.i - o.eventLookback), hit.i + 1).map((c) => c.h));
    return {
      ...e,
      detected: true,
      firstAlertDelay: hit.i - e.startIdx,
      dropAlreadyTakenPct: ((hi - hit.a.price) / hi) * 100,
    };
  });

  return {
    candles: candles.length,
    rawAlerts: raw,
    delivered: delivered.length,
    suppressed,
    useful,
    falseAlerts: delivered.length - useful,
    precision: delivered.length ? useful / delivered.length : null,
    events,
    recall: events.length ? events.filter((e) => e.detected).length / events.length : null,
    deliveredAlerts: delivered,
  };
}

function findEvents(candles: Candle[], o: BacktestOptions) {
  const episodes: { startIdx: number; endIdx: number }[] = [];
  let cur: { startIdx: number; endIdx: number } | null = null;
  for (let i = 1; i < candles.length; i++) {
    const from = Math.max(0, i - o.eventLookback);
    let hi = -Infinity;
    for (let j = from; j <= i; j++) hi = Math.max(hi, candles[j].h);
    const dd = ((hi - candles[i].c) / hi) * 100;
    if (dd >= o.eventDropPct) {
      if (!cur) cur = { startIdx: i, endIdx: i };
      else cur.endIdx = i;
    } else if (cur && dd < o.eventDropPct / 2) {
      episodes.push(cur);
      cur = null;
    }
  }
  if (cur) episodes.push(cur);
  return episodes;
}
