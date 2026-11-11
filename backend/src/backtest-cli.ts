import { backtest } from "./backtest.js";
import { defaultRules } from "./default-rules.js";
import { generateCandles, SCENARIOS } from "./feeds/scenarios.js";

for (const spec of Object.values(SCENARIOS)) {
  const candles = generateCandles(spec);
  const r = backtest(defaultRules("SIM"), "SIM", candles);
  console.log(`\n== ${spec.title} (${r.candles} velas)`);
  console.log(
    `alertas crudas ${r.rawAlerts} | entregadas ${r.delivered} | suprimidas ${r.suppressed} | útiles ${r.useful} | falsas ${r.falseAlerts}`,
  );
  console.log(
    `precisión ${r.precision === null ? "n/a" : (r.precision * 100).toFixed(0) + "%"} | eventos ${r.events.length} | recall ${r.recall === null ? "n/a" : (r.recall * 100).toFixed(0) + "%"}`,
  );
  for (const e of r.events) {
    console.log(
      `  evento @${e.startIdx}-${e.endIdx}: ${e.detected ? `detectado tras ${e.firstAlertDelay} velas (ya había caído ${e.dropAlreadyTakenPct!.toFixed(1)}%)` : "NO detectado"}`,
    );
  }
}
