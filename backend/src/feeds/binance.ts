import WebSocket from "ws";
import type { Candle, Tick } from "../types.js";
import type { Feed } from "./feed.js";

/**
 * Feed real de criptomonedas usando Binance WebSocket y REST API pública (sin API key).
 * 1. Precarga historial reciente de velas para que los indicadores no empiecen vacíos.
 * 2. Emite actualizaciones en tiempo real (cada segundo) para detectar caídas al instante.
 */
export class BinanceFeed implements Feed {
  private ws?: WebSocket;
  private stopped = false;
  private retry = 0;
  private lastCandles = new Map<string, Candle>();
  private lastMiniEmit = new Map<string, number>();

  constructor(private symbols: string[]) {}

  async start(
    onTick: (tick: Tick) => void,
    onHistory?: (symbol: string, candles: Candle[]) => void
  ) {
    this.stopped = false;

    // 1. Precargar historial por REST para cada símbolo (sin evaluar alertas ni sobrescribir cada tick)
    for (const sym of this.symbols) {
      await this.preloadHistoricalCandles(sym, onTick, onHistory).catch(() => {});
    }

    // 2. Conectar stream de WebSockets en tiempo real
    const streams = this.symbols
      .flatMap((s) => [`${s.toLowerCase()}@kline_1m`, `${s.toLowerCase()}@miniTicker`])
      .join("/");

    const connect = () => {
      if (this.stopped) return;
      try {
        this.ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
      } catch (err) {
        this.scheduleReconnect(connect);
        return;
      }

      this.ws.on("open", () => {
        this.retry = 0;
      });

      this.ws.on("message", (raw) => {
        try {
          const payload = JSON.parse(raw.toString());
          const stream = payload.stream as string;
          const data = payload.data;

          if (stream?.includes("@kline_1m")) {
            const k = data?.k;
            if (!k) return;
            const symbol = String(k.s);
            const candle: Candle = {
              t: k.t,
              o: +k.o,
              h: +k.h,
              l: +k.l,
              c: +k.c,
              v: +k.v,
            };
            this.lastCandles.set(symbol, candle);
            onTick({ symbol, candle });
          } else if (stream?.includes("@miniTicker")) {
            const symbol = String(data?.s);
            const currentPrice = +data?.c;
            const existing = this.lastCandles.get(symbol);
            const now = Date.now();
            if (existing && now - (this.lastMiniEmit.get(symbol) ?? 0) >= 2000) {
              this.lastMiniEmit.set(symbol, now);
              const updated: Candle = {
                ...existing,
                h: Math.max(existing.h, currentPrice),
                l: Math.min(existing.l, currentPrice),
                c: currentPrice,
              };
              this.lastCandles.set(symbol, updated);
              onTick({ symbol, candle: updated });
            }
          }
        } catch {
          /* mensaje malformado: se ignora */
        }
      });

      this.ws.on("close", () => {
        if (this.stopped) return;
        this.scheduleReconnect(connect);
      });

      this.ws.on("error", () => {
        this.ws?.close();
      });
    };

    connect();
  }

  private scheduleReconnect(connectFn: () => void) {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    setTimeout(connectFn, delay);
  }

  private async preloadHistoricalCandles(
    symbol: string,
    onTick: (tick: Tick) => void,
    onHistory?: (symbol: string, candles: Candle[]) => void
  ) {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=40`);
      if (!res.ok) return;
      const data = (await res.json()) as any[];
      const candles: Candle[] = [];
      for (const row of data) {
        const candle: Candle = {
          t: Number(row[0]),
          o: parseFloat(row[1]),
          h: parseFloat(row[2]),
          l: parseFloat(row[3]),
          c: parseFloat(row[4]),
          v: parseFloat(row[5]),
        };
        this.lastCandles.set(symbol, candle);
        candles.push(candle);
      }
      if (onHistory && candles.length > 0) {
        onHistory(symbol, candles);
      } else {
        for (const candle of candles) onTick({ symbol, candle });
      }
    } catch {
      // Ignorar si no hay internet: WebSocket intentará conectar
    }
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }
}
