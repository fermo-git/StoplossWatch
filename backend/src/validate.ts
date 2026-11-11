import type { Node, Rule } from "./types.js";

const METRICS = ["dropFromHigh", "changePct", "volumeRatio", "priceZScore", "volumeZScore", "atrMultiple", "trailingStopPct"];
const OPS = [">", ">=", "<", "<="];
const SEVERITIES = ["info", "warning", "critical"];
const MAX_DEPTH = 5;

function checkNode(n: any, path: string, errors: string[], depth = 0): n is Node {
  if (depth > MAX_DEPTH) return errors.push(`${path}: anidación demasiado profunda`), false;
  if (!n || typeof n !== "object") return errors.push(`${path}: debe ser un objeto`), false;
  if (n.type === "cond") {
    if (!METRICS.includes(n.metric)) errors.push(`${path}.metric inválida`);
    if (!OPS.includes(n.op)) errors.push(`${path}.op inválido`);
    if (typeof n.value !== "number" || !Number.isFinite(n.value)) errors.push(`${path}.value debe ser un número`);
    if (n.window !== undefined && (!Number.isInteger(n.window) || n.window < 2 || n.window > 300))
      errors.push(`${path}.window debe ser entero entre 2 y 300`);
    return true;
  }
  if (n.type === "all" || n.type === "any") {
    if (!Array.isArray(n.items) || n.items.length === 0) return errors.push(`${path}.items no puede estar vacío`), false;
    n.items.forEach((it: unknown, i: number) => checkNode(it, `${path}.items[${i}]`, errors, depth + 1));
    return true;
  }
  return errors.push(`${path}.type debe ser cond|all|any`), false;
}

export function validateRules(input: unknown): { ok: true; rules: Rule[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(input)) return { ok: false, errors: ["se esperaba un arreglo de reglas"] };
  const ids = new Set<string>();
  input.forEach((r: any, i: number) => {
    const p = `rules[${i}]`;
    if (typeof r?.id !== "string" || !r.id) errors.push(`${p}.id requerido`);
    else if (ids.has(r.id)) errors.push(`${p}.id duplicado`);
    else ids.add(r.id);
    if (typeof r?.name !== "string") errors.push(`${p}.name requerido`);
    if (typeof r?.symbol !== "string") errors.push(`${p}.symbol requerido`);
    if (!SEVERITIES.includes(r?.severity)) errors.push(`${p}.severity inválida`);
    checkNode(r?.when, `${p}.when`, errors);
  });
  return errors.length ? { ok: false, errors } : { ok: true, rules: input as Rule[] };
}
