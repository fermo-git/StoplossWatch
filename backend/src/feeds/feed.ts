import type { Tick } from "../types.js";

/** Cualquier origen de velas cerradas: simulación, Binance, Finnhub... */
export interface Feed {
  start(onTick: (tick: Tick) => void): void;
  stop(): void;
}
