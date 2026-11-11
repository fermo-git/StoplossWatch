import type { Candle } from "./types.js";

export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

export const stdev = (xs: number[]): number => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** z-score de `x` respecto a una muestra. Devuelve null si la muestra no tiene varianza. */
export function zScore(x: number, sample: number[]): number | null {
  const sd = stdev(sample);
  if (!Number.isFinite(sd) || sd === 0) return null;
  return (x - mean(sample)) / sd;
}

export function trueRange(cur: Candle, prevClose: number): number {
  return Math.max(cur.h - cur.l, Math.abs(cur.h - prevClose), Math.abs(cur.l - prevClose));
}

/** ATR simple (media de TR) sobre las `n` velas que terminan en `endIdx` (inclusive). */
export function atr(candles: Candle[], endIdx: number, n: number): number | null {
  if (endIdx - n < 0) return null;
  const trs: number[] = [];
  for (let i = endIdx - n + 1; i <= endIdx; i++) {
    trs.push(trueRange(candles[i], candles[i - 1].c));
  }
  return mean(trs);
}

export function returns(candles: Candle[], startIdx: number, endIdx: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(1, startIdx); i <= endIdx; i++) {
    out.push(candles[i].c / candles[i - 1].c - 1);
  }
  return out;
}

export function maxHigh(candles: Candle[], startIdx: number, endIdx: number): number {
  let m = -Infinity;
  for (let i = Math.max(0, startIdx); i <= endIdx; i++) m = Math.max(m, candles[i].h);
  return m;
}
