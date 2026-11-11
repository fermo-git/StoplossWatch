import { useEffect, useRef, useState } from "react";
import { WS_URL } from "./config";
import type { Alert, BinanceUser, Portfolio, ServerEvent } from "./types";
import { WearBridge } from "./WearBridge";

export function useBackend() {
  const [connected, setConnected] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [activeSymbol, setActiveSymbol] = useState("SIM");
  const [dropPercent, setDropPercent] = useState(2.5);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [archivedAlerts, setArchivedAlerts] = useState<Alert[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [user, setUser] = useState<BinanceUser | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const seen = useRef(new Set<string>());
  const symbolRef = useRef(activeSymbol);
  symbolRef.current = activeSymbol;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (m) => {
        try {
          const e: ServerEvent = JSON.parse(String(m.data));
          if (e.type === "hello") {
            setAlerts(e.recentAlerts.filter((a) => a.status === "active" || !a.status));
            setArchivedAlerts(e.recentAlerts.filter((a) => a.status && a.status !== "active"));
            if (e.dropPercent) setDropPercent(e.dropPercent);
            if (e.activeSymbol) setActiveSymbol(e.activeSymbol);
            if (e.portfolio) setPortfolio(e.portfolio);
          }
          if (e.type === "tick") {
            setPrice(e.candle.c);
            setActiveSymbol(e.symbol);
          }
          if (e.type === "alert") {
            if (!seen.current.has(e.alert.id)) {
              seen.current.add(e.alert.id);
              setAlerts((prev) => [e.alert, ...prev.filter((a) => a.id !== e.alert.id)]);
              WearBridge.sendAlert(e.alert).catch(() => {});
            }
          }
          if (e.type === "action") {
            // Remover de alertas activas y pasar a archivadas
            setAlerts((prev) => {
              const target = prev.find((a) => a.id === e.alertId);
              if (target) {
                const updated: Alert = { ...target, status: e.status };
                setArchivedAlerts((arch) => [updated, ...arch.filter((a) => a.id !== e.alertId)].slice(0, 30));
              }
              return prev.filter((a) => a.id !== e.alertId);
            });
            const text = e.detail || `Acción: ${e.action}`;
            setLog((l) => [text, ...l].slice(0, 20));
          }
          if (e.type === "order") {
            if (e.portfolio) setPortfolio(e.portfolio);
            const sideLabel = e.order.side === "BUY" ? "COMPRA" : "VENTA";
            setLog((l) => [`${sideLabel} ${e.order.symbol} @ $${e.order.price.toFixed(2)} ($${e.order.total.toFixed(2)})`, ...l].slice(0, 20));
          }
          if (e.type === "config") {
            setDropPercent(e.dropPercent);
            WearBridge.sendConfig(e.dropPercent, symbolRef.current).catch(() => {});
          }
        } catch {
          /* ignorar mensajes malformados */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
      ws.onerror = () => ws?.close();
    };

    WearBridge.init();
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, []);

  // Remover alerta localmente tras acción optimista
  const removeAlert = (alertId: string, status: Alert["status"] = "dismissed") => {
    setAlerts((prev) => {
      const target = prev.find((a) => a.id === alertId);
      if (target) {
        setArchivedAlerts((arch) => [{ ...target, status }, ...arch].slice(0, 30));
      }
      return prev.filter((a) => a.id !== alertId);
    });
  };

  return {
    connected,
    price,
    activeSymbol,
    dropPercent,
    alerts,
    archivedAlerts,
    portfolio,
    user,
    log,
    removeAlert,
    setDropPercent,
    setActiveSymbol,
    setPortfolio,
    setUser,
  };
}
