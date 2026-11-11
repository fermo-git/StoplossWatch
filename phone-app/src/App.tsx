import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "./api";
import { LineChart, RangeSelector } from "./Chart";
import type { Alert, BinanceUser, ChartData, ChartRange, MarketAsset, MarketSummary, Scenario, WatchAction } from "./types";
import { useBackend } from "./useBackend";
import { WearBridge } from "./WearBridge";

/* ------------------------------------------------------------------ */
/* Sistema de diseño                                                    */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#0A0C10",
  surface: "#12151B",
  surfaceAlt: "#181C24",
  border: "#222731",
  text: "#F4F5F7",
  textDim: "#9BA3AF",
  textMute: "#5F6875",
  green: "#059669",
  greenSoft: "#10B981",
  greenBg: "#0B2A22",
  red: "#DC2626",
  redSoft: "#F87171",
  redBg: "#2A1215",
  amber: "#D97706",
  amberSoft: "#F59E0B",
  amberBg: "#2A1E0C",
};
const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/* ------------------------------------------------------------------ */
/* Perfil de volatilidad por activo: define presets coherentes          */
/* ------------------------------------------------------------------ */
type Profile = { label: string; hint: string; presets: number[] };
const PROFILE_LOW: Profile = {
  label: "Volatilidad baja",
  hint: "Monedas grandes y estables. Un 2-3% ya es un movimiento relevante.",
  presets: [1.5, 2.5, 3.5, 5],
};
const PROFILE_MID: Profile = {
  label: "Volatilidad media",
  hint: "Se mueven más que Bitcoin. Por debajo del 3% recibirías avisos por ruido normal.",
  presets: [3, 4.5, 6, 8],
};
const PROFILE_HIGH: Profile = {
  label: "Volatilidad alta",
  hint: "Monedas especulativas con oscilaciones bruscas. Usa márgenes amplios.",
  presets: [6, 8, 10, 15],
};
function profileFor(symbol: string): Profile {
  if (/^(BTC|ETH)/.test(symbol)) return PROFILE_LOW;
  if (/^(PEPE|SHIB|DOGE|SIM)/.test(symbol)) return PROFILE_HIGH;
  return PROFILE_MID;
}

const fmtPrice = (p: number) =>
  p >= 1 ? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p.toPrecision(4);
const fmtPct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(2)}%`;
const fmtVol = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)} mil M` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)} M` : `$${fmtMoney(v)}`;
const RANGES: { key: ChartRange; label: string }[] = [
  { key: "1D", label: "1 día" },
  { key: "1W", label: "1 semana" },
  { key: "1M", label: "1 mes" },
  { key: "1Y", label: "1 año" },
];
const fmtDate = (t: number, r: ChartRange) => {
  const d = new Date(t);
  return r === "1D"
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short", year: r === "1Y" ? "numeric" : undefined });
};
const fmtMoney = (p: number) => p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_LABEL: Record<string, string> = {
  dismissed: "Descartada",
  bought: "Compraste",
  sold: "Vendiste",
  snoozed: "Pospuesta",
};

type Tab = "market" | "alerts" | "portfolio";

export default function App() {
  const {
    connected,
    price,
    activeSymbol,
    dropPercent,
    alerts,
    archivedAlerts,
    portfolio,
    log,
    removeAlert,
    setDropPercent,
    setActiveSymbol,
    setPortfolio,
  } = useBackend();

  const [tab, setTab] = useState<Tab>("market");
  const [showHistory, setShowHistory] = useState(false);
  const [catalog, setCatalog] = useState<MarketAsset[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [watches, setWatches] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [user, setUser] = useState<BinanceUser>({
    authenticated: false,
    accountId: "",
    accountType: "",
    virtualBalanceUSDT: 10000,
    email: "",
  });
  const [email, setEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [overview, setOverview] = useState<MarketSummary[]>([]);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [range, setRange] = useState<ChartRange>("1D");
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);

  useEffect(() => {
    api.getCatalog().then(setCatalog).catch(() => {});
    api.getOverview().then(setOverview).catch(() => {});
    api.scenarios().then(setScenarios).catch(() => {});
    api.getPortfolio().then(setPortfolio).catch(() => {});
    api.getAuthStatus().then(setUser).catch(() => {});
    WearBridge.watchCount().then(setWatches).catch(() => {});
  }, [connected]);

  useEffect(() => {
    setScrubIdx(null);
    if (activeSymbol === "SIM") {
      setChart(null);
      return;
    }
    api.getChart(activeSymbol, range).then(setChart).catch(() => setChart(null));
  }, [activeSymbol, range, connected]);

  const summaryMap = useMemo(() => new Map(overview.map((o) => [o.symbol, o])), [overview]);

  const categories = useMemo(() => ["Todas", ...Array.from(new Set(catalog.map((a) => a.category)))], [catalog]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter(
      (a) =>
        (category === "Todas" || a.category === category) &&
        (!q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    );
  }, [catalog, query, category]);

  const activeAsset = catalog.find((a) => a.symbol === activeSymbol);
  const profile = profileFor(activeSymbol);
  const position = portfolio?.positions[activeSymbol];
  const cash = portfolio?.cash ?? 10000;
  const positions = portfolio ? Object.values(portfolio.positions) : [];
  const invested = positions.reduce((s, p) => s + (p.currentValue ?? p.amount * p.avgPrice), 0);
  const totalPnl = positions.reduce((s, p) => s + (p.pnl ?? 0), 0);

  const refreshPortfolio = () => api.getPortfolio().then(setPortfolio).catch(() => {});

  const updateThreshold = async (v: number) => {
    const val = Math.max(0.5, Math.min(25, Math.round(v * 10) / 10));
    setDropPercent(val);
    await api.setThreshold(val, activeSymbol).catch(() => {});
    await WearBridge.sendConfig(val, activeSymbol).catch(() => {});
  };

  const act = async (id: string, action: WatchAction) => {
    const map: Record<string, Alert["status"]> = {
      ignore: "dismissed",
      simulate_buy: "bought",
      simulate_sell: "sold",
      snooze: "snoozed",
    };
    removeAlert(id, map[action] ?? "snoozed");
    await api.act(id, action).catch(() => {});
    refreshPortfolio();
  };

  const selectAsset = async (sym: string) => {
    setActiveSymbol(sym);
    await api.startLive([sym]).catch(() => {});
  };

  const order = async (side: "BUY" | "SELL") => {
    await api.manualOrder(activeSymbol, side).catch(() => {});
    refreshPortfolio();
  };

  const login = async () => {
    const res = await api.loginBinance(email, apiKey).catch(() => null);
    if (res?.user) setUser(res.user);
    setAccountOpen(false);
  };
  const logout = async () => {
    await api.logoutBinance().catch(() => {});
    setUser((u) => ({ ...u, authenticated: false }));
    setAccountOpen(false);
  };

  /* ------------------------------ Secciones ------------------------------ */

  const renderMarket = () => {
    const activeSummary = summaryMap.get(activeSymbol);
    const pts = chart?.points ?? [];
    const values = pts.map((p) => p.c);
    const hovered = scrubIdx !== null ? pts[scrubIdx] : null;
    const shownPrice = hovered ? hovered.c : price ?? activeSummary?.price ?? null;
    const changePct = chart ? chart.changePct : activeSummary?.changePct24h ?? 0;
    const isUp = changePct >= 0;
    const stopPrice =
      chart && chart.high > 0 ? chart.high * (1 - dropPercent / 100) : undefined;

    return (
      <>
        {/* Activo seleccionado + Gráfica interactiva */}
        <View style={s.hero}>
          <View style={s.rowBetween}>
            <View>
              <Text style={s.overline}>Siguiendo</Text>
              <Text style={s.heroSymbol}>{activeAsset?.name ?? activeSymbol}</Text>
              <Text style={s.heroPair}>{activeSymbol}</Text>
            </View>
            <View style={[s.tag, position ? s.tagGreen : s.tagNeutral]}>
              <Text style={[s.tagText, { color: position ? C.greenSoft : C.textDim }]}>
                {position ? "En cartera" : "Solo observando"}
              </Text>
            </View>
          </View>

          <View style={[s.rowBetween, { marginTop: SP.lg, alignItems: "baseline" }]}>
            <Text style={[s.heroPrice, { marginTop: 0 }]}>
              {shownPrice !== null ? `$${fmtPrice(shownPrice)}` : "Cargando precio..."}
            </Text>
            {hovered ? (
              <Text style={s.caption}>{fmtDate(hovered.t, range)}</Text>
            ) : (
              <View style={[s.tag, isUp ? s.tagGreen : s.tagRed]}>
                <Text style={[s.tagText, { color: isUp ? C.greenSoft : C.redSoft }]}>{fmtPct(changePct)}</Text>
              </View>
            )}
          </View>

          {/* Gráfica de precio */}
          {values.length > 1 ? (
            <View style={{ marginTop: SP.md }}>
              <LineChart
                values={values}
                height={132}
                color={isUp ? C.greenSoft : C.redSoft}
                referenceValue={range === "1D" ? stopPrice : undefined}
                referenceColor={C.amberSoft}
                onScrub={setScrubIdx}
              />
              {chart && (
                <View style={[s.rowBetween, { marginTop: SP.sm }]}>
                  <Text style={s.caption}>Mín: ${fmtPrice(chart.low)}</Text>
                  {range === "1D" && stopPrice ? (
                    <Text style={[s.caption, { color: C.amberSoft }]}>
                      Aviso (−{dropPercent.toFixed(1)}%): ${fmtPrice(stopPrice)}
                    </Text>
                  ) : null}
                  <Text style={s.caption}>Máx: ${fmtPrice(chart.high)}</Text>
                </View>
              )}
              <View style={{ marginTop: SP.md }}>
                <RangeSelector options={RANGES} value={range} onChange={setRange} />
              </View>
            </View>
          ) : (
            <View style={{ height: 100, justifyContent: "center", alignItems: "center" }}>
              <Text style={s.caption}>
                {activeSymbol === "SIM" ? "Modo simulación activo" : "Cargando gráfica..."}
              </Text>
            </View>
          )}

          {activeSummary && (
            <View style={[s.row, { marginTop: SP.md, gap: SP.sm }]}>
              <View style={s.miniStat}>
                <Text style={s.caption}>Volumen 24h</Text>
                <Text style={s.miniStatVal}>{fmtVol(activeSummary.volumeQuote24h)}</Text>
              </View>
              <View style={s.miniStat}>
                <Text style={s.caption}>Rango 24h</Text>
                <Text style={s.miniStatVal}>
                  ${fmtPrice(activeSummary.low24h)} – ${fmtPrice(activeSummary.high24h)}
                </Text>
              </View>
            </View>
          )}

          <Text style={[s.heroCaption, { marginTop: SP.md }]}>
            {position
              ? `Tienes ${position.amount.toFixed(4)} unidades compradas a $${fmtPrice(position.avgPrice)}.`
              : "Recibirás un aviso en el reloj si el precio cae, aunque no tengas esta moneda."}
          </Text>

          <View style={[s.row, { marginTop: SP.lg, gap: SP.sm }]}>
            <Pressable style={[s.btn, s.btnGreen, { flex: 1 }]} onPress={() => order("BUY")}>
              <Text style={s.btnText}>Comprar</Text>
            </Pressable>
            <Pressable
              style={[s.btn, position ? s.btnRed : s.btnDisabled, { flex: 1 }]}
              disabled={!position}
              onPress={() => order("SELL")}
            >
              <Text style={[s.btnText, !position && { color: C.textMute }]}>Vender</Text>
            </Pressable>
          </View>
        </View>

        {/* Stop-loss */}
        <Text style={s.sectionTitle}>Aviso de caída</Text>
        <View style={s.card}>
          <Text style={s.body}>
            Te avisaremos en el reloj cuando {activeSymbol} baje este porcentaje desde su precio más alto reciente.
          </Text>

          <View style={[s.rowBetween, { marginTop: SP.lg, alignItems: "center" }]}>
            <Pressable style={s.stepper} onPress={() => updateThreshold(dropPercent - 0.5)}>
              <Text style={s.stepperText}>−</Text>
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={s.bigValue}>{dropPercent.toFixed(1)}%</Text>
              <Text style={s.caption}>de caída</Text>
            </View>
            <Pressable style={s.stepper} onPress={() => updateThreshold(dropPercent + 0.5)}>
              <Text style={s.stepperText}>+</Text>
            </Pressable>
          </View>

          <View style={[s.row, { marginTop: SP.lg, gap: SP.sm }]}>
            {profile.presets.map((p) => {
              const on = Math.abs(dropPercent - p) < 0.05;
              return (
                <Pressable key={p} style={[s.preset, on && s.presetOn]} onPress={() => updateThreshold(p)}>
                  <Text style={[s.presetText, on && s.presetTextOn]}>{p}%</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={s.infoBox}>
            <Text style={s.infoTitle}>{profile.label}</Text>
            <Text style={s.caption}>{profile.hint}</Text>
          </View>
        </View>

        {/* Catálogo con mini-gráfica (sparkline) de 24h por moneda */}
        <Text style={s.sectionTitle}>Monedas disponibles</Text>
        <View style={s.card}>
          <TextInput
            style={s.input}
            placeholder="Buscar por nombre o símbolo"
            placeholderTextColor={C.textMute}
            value={query}
            onChangeText={setQuery}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: SP.md }}>
            {categories.map((c) => (
              <Pressable key={c} style={[s.chip, category === c && s.chipOn]} onPress={() => setCategory(c)}>
                <Text style={[s.chipText, category === c && s.chipTextOn]}>{c}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={{ marginTop: SP.md }}>
            {filtered.length === 0 && <Text style={s.empty}>No encontramos monedas con ese nombre.</Text>}
            {filtered.map((a, i) => {
              const on = a.symbol === activeSymbol;
              const sum = summaryMap.get(a.symbol);
              const up = (sum?.changePct24h ?? 0) >= 0;
              return (
                <Pressable
                  key={a.symbol}
                  style={[s.listRow, i > 0 && s.listDivider]}
                  onPress={() => selectAsset(a.symbol)}
                >
                  <View style={[s.avatar, on && { borderColor: C.green }]}>
                    <Text style={[s.avatarText, on && { color: C.greenSoft }]}>
                      {a.symbol.replace("USDT", "").slice(0, 4)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.listTitle, on && { color: C.greenSoft }]}>{a.name}</Text>
                    <Text style={s.caption}>{a.category}</Text>
                  </View>

                  {sum && sum.spark.length > 2 ? (
                    <View style={{ width: 68 }}>
                      <LineChart
                        values={sum.spark}
                        height={28}
                        color={up ? C.greenSoft : C.redSoft}
                        fill={false}
                        strokeWidth={1.6}
                      />
                    </View>
                  ) : null}

                  <View style={{ alignItems: "flex-end", minWidth: 74 }}>
                    {sum ? (
                      <>
                        <Text style={s.listTitle}>${fmtPrice(sum.price)}</Text>
                        <Text style={[s.caption, { color: up ? C.greenSoft : C.redSoft, fontWeight: "600" }]}>
                          {fmtPct(sum.changePct24h)}
                        </Text>
                      </>
                    ) : (
                      <Text style={[s.listAction, on && { color: C.greenSoft }]}>{on ? "Siguiendo" : "Seguir"}</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </>
    );
  };

  const renderAlerts = () => {
    const list = showHistory ? archivedAlerts : alerts;
    return (
      <>
        <View style={s.segment}>
          {[
            { k: false, l: `Pendientes (${alerts.length})` },
            { k: true, l: `Historial (${archivedAlerts.length})` },
          ].map((o) => (
            <Pressable key={o.l} style={[s.segBtn, showHistory === o.k && s.segBtnOn]} onPress={() => setShowHistory(o.k)}>
              <Text style={[s.segText, showHistory === o.k && s.segTextOn]}>{o.l}</Text>
            </Pressable>
          ))}
        </View>

        {list.length === 0 && (
          <View style={[s.card, { alignItems: "center", paddingVertical: SP.xxl }]}>
            <Text style={s.cardTitle}>{showHistory ? "Sin historial" : "Todo en orden"}</Text>
            <Text style={[s.caption, { textAlign: "center", marginTop: SP.sm }]}>
              {showHistory
                ? "Aquí aparecerán los avisos que ya atendiste."
                : `${activeSymbol} no ha caído más de ${dropPercent.toFixed(1)}%. Te avisaremos si ocurre.`}
            </Text>
          </View>
        )}

        {!showHistory &&
          list.map((a) => {
            const crit = a.severity === "critical";
            return (
              <View key={a.id} style={[s.card, s.alertCard, { borderLeftColor: crit ? C.red : C.amber }]}>
                <View style={s.rowBetween}>
                  <View style={[s.tag, crit ? s.tagRed : s.tagAmber]}>
                    <Text style={[s.tagText, { color: crit ? C.redSoft : C.amberSoft }]}>
                      {crit ? "Caída fuerte" : "Caída moderada"}
                    </Text>
                  </View>
                  <Text style={s.caption}>{new Date(a.t).toLocaleTimeString()}</Text>
                </View>

                <View style={[s.rowBetween, { marginTop: SP.md, alignItems: "flex-end" }]}>
                  <View>
                    <Text style={s.cardTitle}>{a.symbol}</Text>
                    <Text style={[s.alertDrop, { color: crit ? C.redSoft : C.amberSoft }]}>
                      −{(a.dropPercent ?? 0).toFixed(2)}%
                    </Text>
                  </View>
                  <Text style={s.alertPrice}>${fmtPrice(a.price)}</Text>
                </View>

                <Text style={[s.body, { marginTop: SP.md }]}>{a.summary || a.reasons.join(". ")}</Text>
                {a.actionHint ? <Text style={[s.caption, { marginTop: SP.sm }]}>{a.actionHint}</Text> : null}

                <View style={[s.row, { marginTop: SP.lg, gap: SP.sm }]}>
                  <Pressable style={[s.btn, s.btnRed, { flex: 1 }]} onPress={() => act(a.id, "simulate_sell")}>
                    <Text style={s.btnText}>Vender</Text>
                  </Pressable>
                  <Pressable style={[s.btn, s.btnGreen, { flex: 1 }]} onPress={() => act(a.id, "simulate_buy")}>
                    <Text style={s.btnText}>Comprar</Text>
                  </Pressable>
                </View>
                <View style={[s.row, { marginTop: SP.sm, gap: SP.sm }]}>
                  <Pressable style={[s.btn, s.btnGhost, { flex: 1 }]} onPress={() => act(a.id, "snooze")}>
                    <Text style={s.btnGhostText}>Recordar luego</Text>
                  </Pressable>
                  <Pressable style={[s.btn, s.btnGhost, { flex: 1 }]} onPress={() => act(a.id, "ignore")}>
                    <Text style={s.btnGhostText}>Descartar</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

        {showHistory && list.length > 0 && (
          <View style={s.card}>
            {list.map((a, i) => (
              <View key={a.id} style={[s.listRow, i > 0 && s.listDivider]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.listTitle}>
                    {a.symbol} · −{(a.dropPercent ?? 0).toFixed(1)}%
                  </Text>
                  <Text style={s.caption}>
                    {new Date(a.t).toLocaleTimeString()} · ${fmtPrice(a.price)}
                  </Text>
                </View>
                <Text style={s.listAction}>{STATUS_LABEL[a.status ?? ""] ?? "Atendida"}</Text>
              </View>
            ))}
          </View>
        )}
      </>
    );
  };

  const renderPortfolio = () => (
    <>
      <View style={s.hero}>
        <Text style={s.overline}>Valor total</Text>
        <Text style={s.heroPrice}>${fmtMoney(cash + invested)}</Text>
        <Text style={[s.caption, { color: totalPnl >= 0 ? C.greenSoft : C.redSoft }]}>
          {totalPnl >= 0 ? "+" : "−"}${fmtMoney(Math.abs(totalPnl))} de ganancia/pérdida abierta
        </Text>
        <View style={[s.row, { marginTop: SP.xl, gap: SP.md }]}>
          <View style={s.stat}>
            <Text style={s.caption}>Disponible</Text>
            <Text style={s.statValue}>${fmtMoney(cash)}</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.caption}>Invertido</Text>
            <Text style={s.statValue}>${fmtMoney(invested)}</Text>
          </View>
        </View>
      </View>

      <Text style={s.sectionTitle}>Tus posiciones</Text>
      <View style={s.card}>
        {positions.length === 0 ? (
          <Text style={s.empty}>Aún no has comprado ninguna moneda. Ve a Mercado para empezar.</Text>
        ) : (
          positions.map((p, i) => {
            const up = (p.pnl ?? 0) >= 0;
            return (
              <View key={p.symbol} style={[s.listRow, i > 0 && s.listDivider]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.listTitle}>{p.symbol}</Text>
                  <Text style={s.caption}>
                    {p.amount.toFixed(4)} a ${fmtPrice(p.avgPrice)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.listTitle, { color: up ? C.greenSoft : C.redSoft }]}>
                    {up ? "+" : "−"}${fmtMoney(Math.abs(p.pnl ?? 0))}
                  </Text>
                  <Text style={[s.caption, { color: up ? C.greenSoft : C.redSoft }]}>
                    {up ? "+" : ""}
                    {(p.pnlPercent ?? 0).toFixed(2)}%
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      {log.length > 0 && (
        <>
          <Text style={s.sectionTitle}>Actividad reciente</Text>
          <View style={s.card}>
            {log.slice(0, 6).map((l, i) => (
              <Text key={i} style={[s.caption, i > 0 && { marginTop: SP.sm }]}>
                {l}
              </Text>
            ))}
          </View>
        </>
      )}
    </>
  );

  /* ------------------------------ Layout ------------------------------ */

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" />

      <View style={s.header}>
        {/* Pulsación larga sobre el logo abre el menú de desarrollador (oculto) */}
        <Pressable onLongPress={() => setDevOpen(true)} delayLongPress={1200}>
          <Text style={s.brand}>StopLoss Wrist</Text>
          <View style={[s.row, { marginTop: 2, alignItems: "center" }]}>
            <View style={[s.dot, { backgroundColor: connected ? C.greenSoft : C.textMute }]} />
            <Text style={s.caption}>
              {connected ? "Conectado" : "Sin conexión"} · {watches > 0 ? "Reloj vinculado" : "Sin reloj"}
            </Text>
          </View>
        </Pressable>
        <Pressable style={s.account} onPress={() => setAccountOpen(true)}>
          <Text style={s.accountLabel}>{user.authenticated ? "Mi cuenta" : "Conectar"}</Text>
          <Text style={s.accountValue}>${fmtMoney(cash)}</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {tab === "market" && renderMarket()}
        {tab === "alerts" && renderAlerts()}
        {tab === "portfolio" && renderPortfolio()}
      </ScrollView>

      {/* Barra de navegación inferior */}
      <View style={s.tabBar}>
        {(
          [
            ["market", "Mercado"],
            ["alerts", "Avisos"],
            ["portfolio", "Cartera"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <Pressable key={k} style={s.tabItem} onPress={() => setTab(k)}>
            <View style={[s.tabIndicator, tab === k && { backgroundColor: C.green }]} />
            <Text style={[s.tabText, tab === k && s.tabTextOn]}>
              {l}
              {k === "alerts" && alerts.length > 0 ? ` (${alerts.length})` : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Cuenta */}
      <Modal visible={accountOpen} transparent animationType="fade" onRequestClose={() => setAccountOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.rowBetween}>
              <Text style={s.sheetTitle}>Cuenta de Binance</Text>
              <Pressable onPress={() => setAccountOpen(false)} hitSlop={12}>
                <Text style={s.close}>Cerrar</Text>
              </Pressable>
            </View>
            {user.authenticated ? (
              <>
                <Text style={[s.body, { marginTop: SP.md }]}>Tu cuenta está vinculada. Las órdenes se registran en ella.</Text>
                <View style={s.infoBox}>
                  <Text style={s.caption}>Cuenta</Text>
                  <Text style={s.listTitle}>{user.accountId}</Text>
                  <Text style={[s.caption, { marginTop: SP.sm }]}>Correo</Text>
                  <Text style={s.listTitle}>{user.email}</Text>
                  <Text style={[s.caption, { marginTop: SP.sm }]}>Saldo disponible</Text>
                  <Text style={[s.listTitle, { color: C.greenSoft }]}>${fmtMoney(cash)} USDT</Text>
                </View>
                <Pressable style={[s.btn, s.btnGhost, { marginTop: SP.lg }]} onPress={logout}>
                  <Text style={[s.btnGhostText, { color: C.redSoft }]}>Desvincular cuenta</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[s.body, { marginTop: SP.md }]}>
                  Vincula tu cuenta para operar desde el teléfono o el reloj. Usamos una clave de API con permiso solo de
                  trading, nunca de retiro.
                </Text>
                <Text style={s.label}>Correo</Text>
                <TextInput style={s.input} placeholder="tu@correo.com" placeholderTextColor={C.textMute} value={email} onChangeText={setEmail} autoCapitalize="none" />
                <Text style={s.label}>Clave de API</Text>
                <TextInput style={s.input} placeholder="Pega tu clave aquí" placeholderTextColor={C.textMute} value={apiKey} onChangeText={setApiKey} secureTextEntry />
                <Pressable style={[s.btn, s.btnGreen, { marginTop: SP.xl }]} onPress={login}>
                  <Text style={s.btnText}>Vincular cuenta</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Menú de desarrollador (oculto: pulsación larga en el logo) */}
      <Modal visible={devOpen} transparent animationType="slide" onRequestClose={() => setDevOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.rowBetween}>
              <Text style={s.sheetTitle}>Opciones de desarrollador</Text>
              <Pressable onPress={() => setDevOpen(false)} hitSlop={12}>
                <Text style={s.close}>Cerrar</Text>
              </Pressable>
            </View>
            <Text style={s.label}>Escenarios de mercado simulados</Text>
            {scenarios.map((sc) => (
              <Pressable
                key={sc.id}
                style={[s.listRow, s.devItem]}
                onPress={async () => {
                  setActiveSymbol("SIM");
                  await api.startSimulation(sc.id, 70).catch(() => {});
                  setDevOpen(false);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.listTitle}>{sc.title}</Text>
                  <Text style={s.caption}>{sc.description}</Text>
                </View>
              </Pressable>
            ))}
            <View style={[s.row, { gap: SP.sm, marginTop: SP.md }]}>
              <Pressable style={[s.btn, s.btnGhost, { flex: 1 }]} onPress={() => api.stopSimulation()}>
                <Text style={s.btnGhostText}>Detener simulación</Text>
              </Pressable>
              <Pressable style={[s.btn, s.btnAmber, { flex: 1 }]} onPress={() => api.triggerTestAlert(activeSymbol).catch(() => {})}>
                <Text style={s.btnText}>Aviso de prueba</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  row: { flexDirection: "row" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between" },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SP.xl,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) + SP.lg : SP.lg,
    paddingBottom: SP.lg,
  },
  brand: { color: C.text, fontSize: 20, fontWeight: "700", letterSpacing: 0.2 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  account: {
    alignItems: "flex-end",
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  accountLabel: { color: C.textDim, fontSize: 11, fontWeight: "600" },
  accountValue: { color: C.text, fontSize: 14, fontWeight: "700", marginTop: 1 },

  scroll: { paddingHorizontal: SP.xl, paddingTop: SP.sm, paddingBottom: SP.xxl },

  overline: { color: C.textMute, fontSize: 11, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" },
  sectionTitle: { color: C.textDim, fontSize: 13, fontWeight: "600", marginTop: SP.xxl, marginBottom: SP.md },
  cardTitle: { color: C.text, fontSize: 17, fontWeight: "700" },
  body: { color: C.textDim, fontSize: 14, lineHeight: 21 },
  caption: { color: C.textMute, fontSize: 12, lineHeight: 17 },
  label: { color: C.textDim, fontSize: 12, fontWeight: "600", marginTop: SP.lg, marginBottom: SP.sm },
  empty: { color: C.textMute, fontSize: 13, textAlign: "center", paddingVertical: SP.lg },

  hero: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: SP.xl,
    borderWidth: 1,
    borderColor: C.border,
  },
  heroSymbol: { color: C.text, fontSize: 18, fontWeight: "700", marginTop: SP.xs },
  heroPair: { color: C.textMute, fontSize: 12, marginTop: 2 },
  heroPrice: { color: C.text, fontSize: 34, fontWeight: "700", marginTop: SP.lg, letterSpacing: -0.5 },
  heroCaption: { color: C.textDim, fontSize: 13, lineHeight: 19, marginTop: SP.xs },

  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: SP.lg + 4,
    borderWidth: 1,
    borderColor: C.border,
  },

  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  tagText: { fontSize: 11, fontWeight: "600" },
  tagGreen: { backgroundColor: C.greenBg },
  tagRed: { backgroundColor: C.redBg },
  tagAmber: { backgroundColor: C.amberBg },
  tagNeutral: { backgroundColor: C.surfaceAlt },

  btn: { height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: SP.lg },
  btnGreen: { backgroundColor: C.green },
  btnRed: { backgroundColor: C.red },
  btnAmber: { backgroundColor: C.amber },
  btnDisabled: { backgroundColor: C.surfaceAlt },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.border },
  btnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  btnGhostText: { color: C.textDim, fontSize: 13, fontWeight: "600" },

  stepper: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: { color: C.text, fontSize: 24, fontWeight: "500" },
  bigValue: { color: C.amberSoft, fontSize: 40, fontWeight: "700", letterSpacing: -1 },

  preset: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: C.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  presetOn: { backgroundColor: C.amberBg, borderWidth: 1, borderColor: C.amber },
  presetText: { color: C.textDim, fontSize: 13, fontWeight: "600" },
  presetTextOn: { color: C.amberSoft },

  infoBox: { marginTop: SP.lg, padding: SP.md + 2, borderRadius: 12, backgroundColor: C.bg },
  infoTitle: { color: C.text, fontSize: 13, fontWeight: "600", marginBottom: 2 },

  input: {
    height: 46,
    backgroundColor: C.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: SP.lg,
    color: C.text,
    fontSize: 14,
  },
  chip: {
    paddingHorizontal: 14,
    height: 32,
    justifyContent: "center",
    borderRadius: 999,
    marginRight: SP.sm,
    backgroundColor: C.surfaceAlt,
  },
  chipOn: { backgroundColor: C.text },
  chipText: { color: C.textDim, fontSize: 12, fontWeight: "600" },
  chipTextOn: { color: C.bg },

  listRow: { flexDirection: "row", alignItems: "center", paddingVertical: SP.md + 2, gap: SP.md },
  listDivider: { borderTopWidth: 1, borderTopColor: C.border },
  listTitle: { color: C.text, fontSize: 15, fontWeight: "600" },
  listAction: { color: C.textMute, fontSize: 12, fontWeight: "600" },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: C.textDim, fontSize: 10, fontWeight: "700" },

  segment: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: SP.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  segBtn: { flex: 1, height: 38, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  segBtnOn: { backgroundColor: C.surfaceAlt },
  segText: { color: C.textMute, fontSize: 13, fontWeight: "600" },
  segTextOn: { color: C.text },

  alertCard: { borderLeftWidth: 3, marginBottom: SP.lg },
  alertDrop: { fontSize: 22, fontWeight: "700", marginTop: 2 },
  alertPrice: { color: C.text, fontSize: 17, fontWeight: "600" },

  stat: { flex: 1, padding: SP.md + 2, borderRadius: 12, backgroundColor: C.bg },
  statValue: { color: C.text, fontSize: 16, fontWeight: "700", marginTop: SP.xs },
  miniStat: { flex: 1, paddingHorizontal: SP.md, paddingVertical: SP.sm + 2, borderRadius: 10, backgroundColor: C.bg },
  miniStatVal: { color: C.text, fontSize: 12, fontWeight: "600", marginTop: 2 },

  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.surface,
    paddingBottom: SP.lg,
  },
  tabItem: { flex: 1, alignItems: "center", paddingTop: 0 },
  tabIndicator: { height: 2, width: 32, borderRadius: 1, marginBottom: SP.md, backgroundColor: "transparent" },
  tabText: { color: C.textMute, fontSize: 13, fontWeight: "600" },
  tabTextOn: { color: C.text },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: SP.xl,
    paddingBottom: SP.xxl + SP.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: "700" },
  close: { color: C.textDim, fontSize: 14, fontWeight: "600" },
  devItem: { borderTopWidth: 1, borderTopColor: C.border },
});
