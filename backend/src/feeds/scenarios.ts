import type { Candle } from "../types.js";

/** PRNG determinista para que las simulaciones y pruebas sean reproducibles. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export interface Phase {
  name: string;
  candles: number;
  /** Deriva por vela (fracción). */
  drift: number;
  /** Volatilidad por vela (fracción). */
  vol: number;
  /** Multiplicador de volumen respecto al base. */
  volumeMult: number;
}

export interface ScenarioSpec {
  id: string;
  title: string;
  description: string;
  startPrice: number;
  baseVolume: number;
  startTime: number;
  intervalMs: number;
  seed: number;
  phases: Phase[];
}

export function generateCandles(spec: ScenarioSpec): Candle[] {
  const rand = mulberry32(spec.seed);
  const out: Candle[] = [];
  let price = spec.startPrice;
  let t = spec.startTime;
  for (const ph of spec.phases) {
    for (let i = 0; i < ph.candles; i++) {
      const o = price;
      const ret = ph.drift + ph.vol * gaussian(rand);
      const c = Math.max(0.01, o * (1 + ret));
      const wick = Math.abs(ph.vol * gaussian(rand)) * 0.6;
      const h = Math.max(o, c) * (1 + wick);
      const l = Math.min(o, c) * (1 - wick);
      const v = spec.baseVolume * ph.volumeMult * Math.exp(0.25 * gaussian(rand));
      out.push({ t, o, h, l, c, v });
      price = c;
      t += spec.intervalMs;
    }
  }
  return out;
}

/**
 * IMPORTANTE: son escenarios SINTÉTICOS con la forma de eventos históricos
 * (calma, caída acelerada con pico de volumen, rebote). No son datos reales.
 * Para datos reales, importar velas históricas de la API del proveedor.
 */
export const SCENARIOS: Record<string, ScenarioSpec> = {
  "crash-2020": {
    id: "crash-2020",
    title: "Caída tipo marzo 2020 (sintética)",
    description: "Calma, caída acelerada con volumen explosivo, rebote parcial.",
    startPrice: 100,
    baseVolume: 1000,
    startTime: Date.UTC(2020, 1, 20, 14, 30),
    intervalMs: 60_000,
    seed: 2020,
    phases: [
      { name: "calma", candles: 80, drift: 0.00002, vol: 0.0008, volumeMult: 1 },
      { name: "primer golpe", candles: 25, drift: -0.0030, vol: 0.0030, volumeMult: 2.5 },
      { name: "pausa nerviosa", candles: 15, drift: 0.0003, vol: 0.0035, volumeMult: 2 },
      { name: "caída fuerte", candles: 35, drift: -0.0045, vol: 0.0050, volumeMult: 4.5 },
      { name: "rebote", candles: 45, drift: 0.0030, vol: 0.0035, volumeMult: 2.5 },
    ],
  },
  "flash-crash": {
    id: "flash-crash",
    title: "Flash crash (sintético)",
    description: "Mercado tranquilo, desplome de pocos minutos y recuperación casi total.",
    startPrice: 60000,
    baseVolume: 50,
    startTime: Date.UTC(2021, 4, 19, 8, 0),
    intervalMs: 60_000,
    seed: 519,
    phases: [
      { name: "calma", candles: 70, drift: 0, vol: 0.0006, volumeMult: 1 },
      { name: "desplome", candles: 10, drift: -0.0120, vol: 0.0060, volumeMult: 8 },
      { name: "recuperación", candles: 30, drift: 0.0035, vol: 0.0040, volumeMult: 3 },
      { name: "calma", candles: 30, drift: 0, vol: 0.0007, volumeMult: 1 },
    ],
  },
  "calm-market": {
    id: "calm-market",
    title: "Mercado tranquilo (control, sintético)",
    description: "Sin eventos: sirve para medir falsas alertas.",
    startPrice: 100,
    baseVolume: 1000,
    startTime: Date.UTC(2022, 0, 3, 14, 30),
    intervalMs: 60_000,
    seed: 7,
    phases: [{ name: "calma", candles: 240, drift: 0, vol: 0.0009, volumeMult: 1 }],
  },
};
