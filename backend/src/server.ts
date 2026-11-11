import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { backtest } from "./backtest.js";
import { defaultRules } from "./default-rules.js";
import { BinanceFeed } from "./feeds/binance.js";
import type { Feed } from "./feeds/feed.js";
import { generateCandles, SCENARIOS } from "./feeds/scenarios.js";
import { SimulatedFeed } from "./feeds/simulated.js";
import { Pipeline, type PipelineEvent } from "./pipeline.js";
import type { Rule, WatchAction } from "./types.js";
import { validateRules } from "./validate.js";
import { getChart, getOverview, isRange } from "./market.js";

const PORT = Number(process.env.PORT ?? 8080);
const SIM_SYMBOL = "SIM";

const pipeline = new Pipeline(defaultRules(SIM_SYMBOL, 2.5));
let feed: Feed | null = null;
let currentSymbol = SIM_SYMBOL;
let feedInfo: Record<string, unknown> = { mode: "idle", activeSymbol: currentSymbol };

// Estado simulado de Binance Auth
let binanceUser = {
  authenticated: true,
  accountId: "BINANCE_PRO_7749",
  accountType: "Spot Paper Trading",
  virtualBalanceUSDT: 10000.0,
  email: "trader.demo@binance.com",
};

// ---------- helpers HTTP ----------
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

function stopFeed() {
  feed?.stop();
  feed = null;
  feedInfo = { mode: "idle", activeSymbol: currentSymbol };
}

export const MARKET_CATALOG = [
  { symbol: "BTCUSDT", name: "Bitcoin", network: "BTC", category: "Layer 1" },
  { symbol: "ETHUSDT", name: "Ethereum", network: "ETH", category: "Layer 1" },
  { symbol: "SOLUSDT", name: "Solana", network: "SOL", category: "Layer 1" },
  { symbol: "BNBUSDT", name: "BNB", network: "BSC", category: "Exchange" },
  { symbol: "XRPUSDT", name: "Ripple", network: "XRP", category: "Pagos" },
  { symbol: "DOGEUSDT", name: "Dogecoin", network: "DOGE", category: "Memecoins" },
  { symbol: "ADAUSDT", name: "Cardano", network: "ADA", category: "Layer 1" },
  { symbol: "AVAXUSDT", name: "Avalanche", network: "AVAX", category: "Layer 1" },
  { symbol: "LINKUSDT", name: "Chainlink", network: "ETH", category: "DeFi" },
  { symbol: "SUIUSDT", name: "Sui", network: "SUI", category: "Layer 1" },
  { symbol: "NEARUSDT", name: "Near Protocol", network: "NEAR", category: "Layer 1" },
  { symbol: "DOTUSDT", name: "Polkadot", network: "DOT", category: "Layer 1" },
  { symbol: "POLUSDT", name: "Polygon", network: "POL", category: "Layer 2" },
  { symbol: "LTCUSDT", name: "Litecoin", network: "LTC", category: "Pagos" },
  { symbol: "UNIUSDT", name: "Uniswap", network: "ETH", category: "DeFi" },
  { symbol: "PEPEUSDT", name: "Pepe", network: "ETH", category: "Memecoins" },
  { symbol: "SHIBUSDT", name: "Shiba Inu", network: "ETH", category: "Memecoins" },
  { symbol: "APTUSDT", name: "Aptos", network: "APT", category: "Layer 1" },
  { symbol: "ARBUSDT", name: "Arbitrum", network: "ARB", category: "Layer 2" },
  { symbol: "OPUSDT", name: "Optimism", network: "OP", category: "Layer 2" },
];

// ---------- rutas ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      });
      return res.end();
    }

    if (route === "GET /health") {
      return json(res, 200, {
        ok: true,
        feed: feedInfo,
        activeSymbol: currentSymbol,
        dropPercent: pipeline.getDropPercent(),
        portfolio: pipeline.getPortfolio(),
      });
    }

    if (route === "GET /catalog") return json(res, 200, MARKET_CATALOG);

    if (route === "GET /market/overview") {
      const data = await getOverview(MARKET_CATALOG.map((a) => a.symbol)).catch(() => []);
      return json(res, 200, data);
    }

    if (route === "GET /market/chart") {
      const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();
      const r = url.searchParams.get("range");
      const range = isRange(r) ? r : "1D";
      if (!MARKET_CATALOG.some((a) => a.symbol === symbol)) return json(res, 404, { error: "moneda no disponible" });
      try {
        return json(res, 200, await getChart(symbol, range));
      } catch {
        return json(res, 502, { error: "no se pudo obtener el historial" });
      }
    }

    if (route === "GET /config") {
      return json(res, 200, {
        dropPercent: pipeline.getDropPercent(),
        activeSymbol: currentSymbol,
        user: binanceUser,
      });
    }

    if (route === "POST /config/threshold") {
      const { dropPercent, symbol } = await readBody(req);
      if (symbol) currentSymbol = symbol;
      const updated = pipeline.setDropPercent(dropPercent, currentSymbol);
      return json(res, 200, { ok: true, dropPercent: updated, symbol: currentSymbol });
    }

    if (route === "GET /scenarios") {
      return json(
        res,
        200,
        Object.values(SCENARIOS).map(({ id, title, description }) => ({ id, title, description }))
      );
    }

    if (route === "GET /rules") return json(res, 200, pipeline.getRules());

    if (route === "PUT /rules") {
      const body = await readBody(req);
      const v = validateRules(body);
      if (!v.ok) return json(res, 400, { error: "reglas inválidas", details: v.errors });
      pipeline.setRules(v.rules);
      return json(res, 200, v.rules);
    }

    if (route === "GET /alerts") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const includeAll = url.searchParams.get("all") === "true";
      return json(res, 200, pipeline.getAlerts(limit, includeAll));
    }

    if (route === "GET /portfolio") return json(res, 200, pipeline.getPortfolio());

    if (route === "GET /orders") return json(res, 200, pipeline.getOrders());

    if (route === "POST /orders/simulate") {
      const { symbol = currentSymbol, side = "BUY", amount } = await readBody(req);
      const order = pipeline.manualOrder(symbol, side, amount);
      if (!order) return json(res, 400, { error: "No se pudo ejecutar la orden simulada (saldo o precio insuficiente)" });
      return json(res, 200, { ok: true, order, portfolio: pipeline.getPortfolio() });
    }

    // Login simulado de Binance
    if (route === "GET /auth/status") return json(res, 200, binanceUser);

    if (route === "POST /auth/binance") {
      const { email = "trader@binance.com", apiKey } = await readBody(req);
      binanceUser = {
        authenticated: true,
        accountId: `BINANCE_${Math.floor(1000 + Math.random() * 9000)}`,
        accountType: "Spot Paper Trading (Simulado)",
        virtualBalanceUSDT: 10000.0,
        email: email || "usuario.demo@binance.com",
      };
      return json(res, 200, { ok: true, user: binanceUser });
    }

    if (route === "POST /auth/logout") {
      binanceUser.authenticated = false;
      return json(res, 200, { ok: true, authenticated: false });
    }

    // Disparar alerta inmediata para pruebas rápidas en demo
    if (route === "POST /alerts/test") {
      const { symbol = currentSymbol, price } = await readBody(req);
      const alert = pipeline.triggerImmediateTestAlert(symbol, price);
      return json(res, 200, { ok: true, alert });
    }

    if (route === "POST /simulate/start") {
      const { scenario = "crash-2020", msPerCandle = 90 } = await readBody(req);
      const spec = SCENARIOS[scenario];
      if (!spec) return json(res, 404, { error: "escenario desconocido" });
      stopFeed();
      currentSymbol = SIM_SYMBOL;
      pipeline.resetMarketState();
      pipeline.setRules(defaultRules(SIM_SYMBOL, pipeline.getDropPercent()));
      const candles = generateCandles(spec);
      const sim = new SimulatedFeed(SIM_SYMBOL, candles, Number(msPerCandle), () => {
        feedInfo = { mode: "idle", lastScenario: scenario, finished: true, activeSymbol: currentSymbol };
      });
      feed = sim;
      feedInfo = { mode: "simulation", scenario, msPerCandle, totalCandles: candles.length, activeSymbol: currentSymbol };
      sim.start((t) => pipeline.onTick(t));
      return json(res, 200, feedInfo);
    }

    if (route === "POST /simulate/stop") {
      stopFeed();
      return json(res, 200, feedInfo);
    }

    if (route === "POST /live/start") {
      const { symbols = ["BTCUSDT"] } = await readBody(req);
      stopFeed();
      currentSymbol = symbols[0];
      pipeline.resetMarketState();
      pipeline.setRules(symbols.flatMap((s: string) => defaultRules(s, pipeline.getDropPercent())));
      const binance = new BinanceFeed(symbols);
      feed = binance;
      feedInfo = { mode: "live", provider: "binance", symbols, activeSymbol: currentSymbol };
      binance.start(
        (t) => pipeline.onTick(t),
        (sym, history) => pipeline.seedCandles(sym, history)
      );
      return json(res, 200, feedInfo);
    }

    if (route === "POST /backtest") {
      const { scenario = "crash-2020", rules } = await readBody(req);
      const spec = SCENARIOS[scenario];
      if (!spec) return json(res, 404, { error: "escenario desconocido" });
      let used: Rule[] = pipeline.getRules();
      if (rules) {
        const v = validateRules(rules);
        if (!v.ok) return json(res, 400, { error: "reglas inválidas", details: v.errors });
        used = v.rules;
      }
      const sym = used[0]?.symbol ?? SIM_SYMBOL;
      const { deliveredAlerts, ...summary } = backtest(used, sym, generateCandles(spec));
      return json(res, 200, { scenario, ...summary, alerts: deliveredAlerts });
    }

    const m = url.pathname.match(/^\/alerts\/([^/]+)\/action$/);
    if (req.method === "POST" && m) {
      const { action, snoozeMinutes } = await readBody(req);
      if (!["ignore", "snooze", "simulate_sell", "simulate_buy"].includes(action)) {
        return json(res, 400, { error: "acción inválida" });
      }
      const ok = pipeline.applyAction(decodeURIComponent(m[1]), action as WatchAction, snoozeMinutes);
      return json(res, ok ? 200 : 404, ok ? { ok, action } : { error: "alerta no encontrada" });
    }

    json(res, 404, { error: "no encontrado" });
  } catch (e) {
    json(res, 400, { error: e instanceof Error ? e.message : "solicitud inválida" });
  }
});

// ---------- WebSocket: teléfono y reloj ----------
const wss = new WebSocketServer({ server, path: "/ws" });
const send = (ws: WebSocket, e: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(e));

wss.on("connection", (ws) => {
  send(ws, {
    type: "hello",
    feed: feedInfo,
    activeSymbol: currentSymbol,
    dropPercent: pipeline.getDropPercent(),
    recentAlerts: pipeline.getAlerts(15),
    portfolio: pipeline.getPortfolio(),
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "action") {
        pipeline.applyAction(msg.alertId, msg.action, msg.snoozeMinutes);
      } else if (msg.type === "set_threshold") {
        pipeline.setDropPercent(msg.dropPercent, msg.symbol);
      } else if (msg.type === "order") {
        pipeline.manualOrder(msg.symbol, msg.side, msg.amount);
      }
    } catch {
      /* ignorar mensajes malformados */
    }
  });
});

pipeline.subscribe((e: PipelineEvent) => {
  for (const c of wss.clients) send(c, e);
});

server.listen(PORT, () => console.log(`StopLoss Wrist backend en http://localhost:${PORT}  (ws: /ws)`));
