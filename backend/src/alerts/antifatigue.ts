import type { Alert, Severity } from "../types.js";

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export interface FatigueConfig {
  /** Ventana (ms de tiempo de mercado) para el límite de alertas no críticas. */
  windowMs: number;
  /** Máximo de alertas info/warning por símbolo dentro de la ventana. */
  maxNonCriticalPerWindow: number;
  /** Máximo de alertas críticas por símbolo dentro de la ventana (evita tormentas). */
  maxCriticalPerWindow: number;
}

export const DEFAULT_FATIGUE: FatigueConfig = {
  windowMs: 15 * 60_000,
  maxNonCriticalPerWindow: 2,
  maxCriticalPerWindow: 4,
};

export interface FatigueOutput {
  deliver: Alert[];
  suppressed: Alert[];
}

/**
 * Anti-fatiga: (1) agrupa alertas simultáneas del mismo símbolo en una sola
 * con la mayor severidad, (2) limita cuántas llegan al reloj por ventana.
 * Usa el tiempo de las velas (no el reloj de pared), así funciona igual en
 * simulación acelerada y en backtesting.
 */
export class AlertFatigueFilter {
  private history = new Map<string, { t: number; severity: Severity }[]>();

  constructor(private cfg: FatigueConfig = DEFAULT_FATIGUE) {}

  reset() {
    this.history.clear();
  }

  process(alerts: Alert[]): FatigueOutput {
    const deliver: Alert[] = [];
    const suppressed: Alert[] = [];

    for (const group of this.groupBySymbolAndTime(alerts)) {
      const merged = this.merge(group);
      const hist = (this.history.get(merged.symbol) ?? []).filter(
        (h) => merged.t - h.t < this.cfg.windowMs,
      );
      const critical = hist.filter((h) => h.severity === "critical").length;
      const nonCritical = hist.length - critical;

      const allowed =
        merged.severity === "critical"
          ? critical < this.cfg.maxCriticalPerWindow
          : nonCritical < this.cfg.maxNonCriticalPerWindow;

      if (allowed) {
        hist.push({ t: merged.t, severity: merged.severity });
        deliver.push(merged);
      } else {
        suppressed.push(...group);
      }
      this.history.set(merged.symbol, hist);
    }
    return { deliver, suppressed };
  }

  private groupBySymbolAndTime(alerts: Alert[]): Alert[][] {
    const map = new Map<string, Alert[]>();
    for (const a of alerts) {
      const key = `${a.symbol}|${a.t}`;
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return [...map.values()];
  }

  private merge(group: Alert[]): Alert {
    if (group.length === 1) return group[0];
    const top = group.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a));
    return {
      ...top,
      ruleName: group.length > 1 ? `${top.ruleName} (+${group.length - 1} más)` : top.ruleName,
      reasons: [...new Set(group.flatMap((g) => g.reasons))],
      groupedCount: group.length,
    };
  }
}
