/**
 * Datos de mercado para gráficas: historial de precios (klines) y resumen 24h.
 * Usa la API REST pública de Binance (no requiere claves) con caché en memoria.
 */

const REST = "https://api.binance.com/api/v3";

export type ChartRange = "1D" | "1W" | "1M" | "1Y";

const RANGE_CFG: Record<ChartRange, { interval: string; limit: number; ttlMs: number }> = {
  "1D": { interval: "15m", limit: 96, ttlMs: 60_000 },
  "1W": { interval: "2h", limit: 84, ttlMs: 5 * 60_000 },
  "1M": { interval: "8h", limit: 90, ttlMs: 15 * 60_000 },
  "1Y": { interval: "1w", limit: 52, ttlMs: 60 * 60_000 },
};

export interface ChartPoint {
  t: number;
  c: number;
}

export interface ChartData {
  symbol: string;
  range: ChartRange;
  points: ChartPoint[];
  high: number;
  low: number;
  changePct: number;
}

export interface MarketSummary {
  symbol: string;
  price: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  volumeQuote24h: number;
  spark: number[];
}

const cache = new Map<string, { at: number; data: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  return (await res.json()) as T;
}

export function isRange(v: string | null): v is ChartRange {
  return v === "1D" || v === "1W" || v === "1M" || v === "1Y";
}

export async function getChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const cfg = RANGE_CFG[range];
  return cached(`chart:${symbol}:${range}`, cfg.ttlMs, async () => {
    const raw = await getJson<unknown[][]>(
      `${REST}/klines?symbol=${encodeURIComponent(symbol)}&interval=${cfg.interval}&limit=${cfg.limit}`
    );
    const points = raw.map((k) => ({ t: Number(k[0]), c: Number(k[4]) }));
    const closes = points.map((p) => p.c);
    const first = closes[0] ?? 0;
    const last = closes[closes.length - 1] ?? 0;
    return {
      symbol,
      range,
      points,
      high: Math.max(...closes),
      low: Math.min(...closes),
      changePct: first ? ((last - first) / first) * 100 : 0,
    };
  });
}

/** Resumen de todas las monedas del catálogo: precio, variación 24h y mini-gráfica. */
export async function getOverview(symbols: string[]): Promise<MarketSummary[]> {
  return cached(`overview:${symbols.join(",")}`, 60_000, async () => {
    type Ticker = {
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      highPrice: string;
      lowPrice: string;
      quoteVolume: string;
    };
    const tickers = await getJson<Ticker[]>(
      `${REST}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
    );
    const sparks = await Promise.all(
      symbols.map((s) =>
        getJson<unknown[][]>(`${REST}/klines?symbol=${s}&interval=1h&limit=24`)
          .then((k) => k.map((x) => Number(x[4])))
          .catch(() => [] as number[])
      )
    );
    const bySym = new Map(tickers.map((t) => [t.symbol, t]));
    return symbols.flatMap((s, i) => {
      const t = bySym.get(s);
      if (!t) return [];
      return [
        {
          symbol: s,
          price: Number(t.lastPrice),
          changePct24h: Number(t.priceChangePercent),
          high24h: Number(t.highPrice),
          low24h: Number(t.lowPrice),
          volumeQuote24h: Number(t.quoteVolume),
          spark: sparks[i],
        },
      ];
    });
  });
}

