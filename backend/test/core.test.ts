import assert from "node:assert/strict";
import { test } from "node:test";
import { AlertFatigueFilter } from "../src/alerts/antifatigue.js";
import { backtest } from "../src/backtest.js";
import { defaultRules } from "../src/default-rules.js";
import { generateCandles, SCENARIOS } from "../src/feeds/scenarios.js";
import { atr, mean, stdev, zScore } from "../src/indicators.js";
import { Pipeline } from "../src/pipeline.js";
import { RuleEngine } from "../src/rules/engine.js";
import { validateRules } from "../src/validate.js";
import type { Alert, Candle, Rule } from "../src/types.js";

const T0 = 1_700_000_000_000;
const candle = (i: number, c: number, v = 100, h = c, l = c, o = c): Candle => ({ t: T0 + i * 60_000, o, h, l, c, v });

test("mean/stdev/zScore", () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.ok(Math.abs(stdev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.01);
  assert.equal(zScore(5, [3, 3, 3]), null); // sin varianza
  assert.ok(Math.abs(zScore(7, [1, 3, 5, 7, 9])! - 0.632) < 0.01);
});

test("ATR sobre rangos constantes", () => {
  const cs = Array.from({ length: 10 }, (_, i) => candle(i, 100, 1, 101, 99));
  assert.equal(atr(cs, 9, 5), 2);
  assert.equal(atr(cs, 3, 5), null); // datos insuficientes
});

test("dropFromHigh + volumeRatio combinados (AND)", () => {
  const rule: Rule = {
    id: "r", name: "x", symbol: "S", severity: "critical", cooldownCandles: 1,
    when: { type: "all", items: [
      { type: "cond", metric: "dropFromHigh", op: ">=", value: 3, window: 10 },
      { type: "cond", metric: "volumeRatio", op: ">=", value: 2, window: 10 },
    ] },
  };
  const engine = new RuleEngine([rule]);
  const cs = Array.from({ length: 12 }, (_, i) => candle(i, 100, 100));
  // Caída de 5% pero con volumen normal: NO debe disparar
  cs.push(candle(12, 95, 100));
  assert.equal(engine.evaluate("S", cs).length, 0);
  // Caída de 5% con volumen 3x: SÍ
  cs.push(candle(13, 95, 300));
  const a = engine.evaluate("S", cs);
  assert.equal(a.length, 1);
  assert.equal(a[0].reasons.length, 2);
});

test("OR solo explica con las condiciones cumplidas", () => {
  const engine = new RuleEngine([{
    id: "r", name: "x", symbol: "S", severity: "warning", cooldownCandles: 1,
    when: { type: "any", items: [
      { type: "cond", metric: "changePct", op: "<=", value: -2, window: 5 },
      { type: "cond", metric: "volumeRatio", op: ">=", value: 10, window: 5 },
    ] },
  }]);
  const cs = Array.from({ length: 6 }, (_, i) => candle(i, 100));
  cs.push(candle(6, 97));
  const a = engine.evaluate("S", cs);
  assert.equal(a.length, 1);
  assert.equal(a[0].reasons.length, 1);
  assert.match(a[0].reasons[0], /changePct/);
});

test("sin datos suficientes no dispara", () => {
  const engine = new RuleEngine([{ id: "r", name: "x", symbol: "S", severity: "info", when: { type: "cond", metric: "dropFromHigh", op: ">=", value: 0, window: 50 } }]);
  assert.equal(engine.evaluate("S", [candle(0, 100), candle(1, 50)]).length, 0);
});

test("trailing stop sigue al máximo y respeta cooldown", () => {
  const engine = new RuleEngine([{ id: "t", name: "t", symbol: "S", severity: "critical", cooldownCandles: 5, when: { type: "cond", metric: "trailingStopPct", op: ">=", value: 4 } }]);
  const cs: Candle[] = [];
  const prices = [100, 105, 110, 108, 105.5, 105, 104];
  const fired: number[] = [];
  prices.forEach((p, i) => {
    cs.push(candle(i, p));
    if (engine.evaluate("S", cs).length) fired.push(i);
  });
  // máximo 110 -> 4% = 105.6; dispara en i=4 (105.5) y el cooldown evita i=5 y i=6
  assert.deepEqual(fired, [4]);
});

test("anti-fatiga agrupa alertas simultáneas y limita la tormenta", () => {
  const mk = (id: string, sev: Alert["severity"], t: number): Alert => ({ id, ruleId: id, ruleName: id, symbol: "S", severity: sev, t, price: 1, reasons: [id] });
  const f = new AlertFatigueFilter({ windowMs: 600_000, maxNonCriticalPerWindow: 1, maxCriticalPerWindow: 2 });
  const r1 = f.process([mk("a", "warning", 0), mk("b", "critical", 0)]);
  assert.equal(r1.deliver.length, 1);
  assert.equal(r1.deliver[0].severity, "critical");
  assert.equal(r1.deliver[0].groupedCount, 2);
  assert.equal(f.process([mk("c", "warning", 60_000)]).deliver.length, 1);
  assert.equal(f.process([mk("d", "warning", 120_000)]).deliver.length, 0); // límite no crítico
  assert.equal(f.process([mk("e", "critical", 180_000)]).deliver.length, 1);
  assert.equal(f.process([mk("f", "critical", 240_000)]).deliver.length, 0); // límite crítico
  assert.equal(f.process([mk("g", "critical", 900_000)]).deliver.length, 1); // ventana expiró
});

test("los escenarios son deterministas", () => {
  const a = generateCandles(SCENARIOS["crash-2020"]);
  const b = generateCandles(SCENARIOS["crash-2020"]);
  assert.deepEqual(a, b);
});

test("backtest: detecta las caídas y el control tranquilo no tiene eventos", () => {
  const crash = backtest(defaultRules("SIM"), "SIM", generateCandles(SCENARIOS["crash-2020"]));
  assert.equal(crash.recall, 1);
  const flash = backtest(defaultRules("SIM"), "SIM", generateCandles(SCENARIOS["flash-crash"]));
  assert.equal(flash.recall, 1);
  const calm = backtest(defaultRules("SIM"), "SIM", generateCandles(SCENARIOS["calm-market"]));
  assert.equal(calm.events.length, 0);
  assert.ok(calm.delivered <= 2, `demasiadas falsas alertas en mercado tranquilo: ${calm.delivered}`);
});

test("el filtro anti-fatiga reduce alertas sin perder el evento", () => {
  const candles = generateCandles(SCENARIOS["crash-2020"]);
  const sin = backtest(defaultRules("SIM"), "SIM", candles, { useFatigueFilter: false });
  const con = backtest(defaultRules("SIM"), "SIM", candles, { useFatigueFilter: true });
  assert.ok(con.delivered <= sin.delivered);
  assert.equal(con.recall, 1);
});

test("pipeline: alerta, snooze y orden simulada", () => {
  const p = new Pipeline(defaultRules("SIM"));
  const events: string[] = [];
  p.subscribe((e) => e.type !== "tick" && events.push(e.type));
  for (const c of generateCandles(SCENARIOS["crash-2020"]).slice(0, 130)) p.onTick({ symbol: "SIM", candle: c });
  const alerts = p.getAlerts();
  assert.ok(alerts.length > 0);
  assert.equal(p.applyAction("no-existe", "ignore"), false);
  assert.equal(p.applyAction(alerts[0].id, "simulate_sell"), true);
  assert.equal(p.getOrders().length, 1);
  assert.equal(p.getOrders()[0].side, "SELL");
  assert.ok(events.includes("order"));
});

test("pipeline: simulate_buy, portfolio tracking y ajuste de umbral", () => {
  const p = new Pipeline(defaultRules("SIM", 2.0));
  assert.equal(p.getDropPercent(), 2.0);
  p.setDropPercent(3.5, "BTCUSDT");
  assert.equal(p.getDropPercent(), 3.5);

  const testAlert = p.triggerImmediateTestAlert("BTCUSDT", 60000);
  assert.equal(testAlert.status, "active");
  assert.equal(testAlert.symbol, "BTCUSDT");

  // Ejecutar compra simulada
  const bought = p.applyAction(testAlert.id, "simulate_buy");
  assert.equal(bought, true);
  assert.equal(testAlert.status, "bought");

  const portfolio = p.getPortfolio();
  assert.ok(portfolio.cash < 10000);
  assert.ok(portfolio.positions["BTCUSDT"]);
  assert.equal(portfolio.orders.length, 1);
  assert.equal(portfolio.orders[0].side, "BUY");

  // Ignorar / archivar alerta
  const secondAlert = p.triggerImmediateTestAlert("BTCUSDT", 59000);
  assert.equal(p.applyAction(secondAlert.id, "ignore"), true);
  assert.equal(secondAlert.status, "dismissed");
  // Alertas activas no debe incluir las archivadas
  assert.equal(p.getAlerts().filter(a => a.id === secondAlert.id).length, 0);
});

test("validateRules rechaza reglas malformadas", () => {
  assert.equal(validateRules("x").ok, false);
  const bad = validateRules([{ id: "a", name: "n", symbol: "S", severity: "boom", when: { type: "cond", metric: "nope", op: "~", value: "x" } }]);
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok && bad.errors.length >= 4);
  assert.equal(validateRules(defaultRules("SIM")).ok, true);
});

test("defaultRules no dispara alertas por caídas de -0.2% cuando el umbral es 4.0%", () => {
  const p = new Pipeline(defaultRules("BTCUSDT", 4.0), 4.0);
  const baseCandles = Array.from({ length: 25 }, (_, i) => candle(i, 70000, 100, 70010, 69990));
  p.seedCandles("BTCUSDT", baseCandles);
  // Simular caída pequeña de -0.2% (70000 -> 69860) que antes disparaba priceZScore
  p.onTick({ symbol: "BTCUSDT", candle: candle(25, 69860, 200, 70000, 69850) });
  assert.equal(p.getAlerts().length, 0);
  // Simular caída real de -4.2% (70000 -> 67060)
  p.onTick({ symbol: "BTCUSDT", candle: candle(26, 67060, 300, 70000, 67000) });
  assert.equal(p.getAlerts().length, 1);
  assert.ok((p.getAlerts()[0].dropPercent ?? 0) >= 4.0);
});
