import type { Candle, Tick } from "../types.js";
import type { Feed } from "./feed.js";

/** Reproduce velas históricas/sintéticas a una velocidad configurable. */
export class SimulatedFeed implements Feed {
  private timer?: NodeJS.Timeout;
  private i = 0;

  /** @param msPerCandle tiempo real entre velas (p. ej. 150 = ~7 velas/seg). */
  constructor(
    private symbol: string,
    private candles: Candle[],
    private msPerCandle = 150,
    private onDone?: () => void,
  ) {}

  get progress() {
    return { index: this.i, total: this.candles.length };
  }

  start(onTick: (tick: Tick) => void) {
    this.stop();
    this.i = 0;
    this.timer = setInterval(() => {
      if (this.i >= this.candles.length) {
        this.stop();
        this.onDone?.();
        return;
      }
      onTick({ symbol: this.symbol, candle: this.candles[this.i++] });
    }, this.msPerCandle);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
