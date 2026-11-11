import type { Rule } from "./types.js";

/** Reglas por defecto configurables con un umbral de caída y trailing stop. */
export function defaultRules(symbol: string, dropPercent = 2.5): Rule[] {
  const drop = Math.max(0.5, Number(dropPercent) || 2.5);

  return [
    {
      id: `${symbol}-panic`,
      name: `Caída abrupta >= ${drop}% con volumen`,
      symbol,
      severity: "critical",
      cooldownCandles: 8,
      when: {
        type: "all",
        items: [
          { type: "cond", metric: "dropFromHigh", op: ">=", value: drop, window: 20 },
          { type: "cond", metric: "volumeRatio", op: ">=", value: 1.5, window: 20 },
        ],
      },
    },
    {
      id: `${symbol}-shock`,
      name: `Vela atípica a la baja (Shock >= ${drop}%)`,
      symbol,
      severity: "warning",
      cooldownCandles: 6,
      when: {
        type: "all",
        items: [
          { type: "cond", metric: "dropFromHigh", op: ">=", value: drop, window: 20 },
          {
            type: "any",
            items: [
              { type: "cond", metric: "priceZScore", op: "<=", value: -2.8, window: 20 },
              { type: "cond", metric: "atrMultiple", op: ">=", value: 3, window: 14 },
            ],
          },
        ],
      },
    },
    {
      id: `${symbol}-trail`,
      name: `Stop-Loss por caída desde máximo (${drop}%)`,
      symbol,
      severity: "critical",
      cooldownCandles: 15,
      when: { type: "cond", metric: "trailingStopPct", op: ">=", value: drop },
    },
  ];
}
