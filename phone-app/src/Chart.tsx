import React, { useMemo, useState } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Gráfica de línea dibujada solo con View (sin dependencias nativas).
 * Cada tramo entre dos puntos es una barra fina rotada; debajo se dibuja
 * un relleno de columnas semitransparentes para dar sensación de área.
 */

interface LineChartProps {
  values: number[];
  height: number;
  color: string;
  /** Muestra el relleno bajo la línea. */
  fill?: boolean;
  strokeWidth?: number;
  /** Línea horizontal de referencia (por ejemplo, el nivel del stop-loss). */
  referenceValue?: number;
  referenceColor?: string;
  /** Permite tocar la gráfica para ver el valor de un punto. */
  onScrub?: (index: number | null) => void;
}

export function LineChart({
  values,
  height,
  color,
  fill = true,
  strokeWidth = 2,
  referenceValue,
  referenceColor = "#F59E0B",
  onScrub,
}: LineChartProps) {
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (width === 0 || values.length < 2) return null;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (referenceValue !== undefined) {
      min = Math.min(min, referenceValue);
      max = Math.max(max, referenceValue);
    }
    const pad = (max - min) * 0.08 || max * 0.01 || 1;
    min -= pad;
    max += pad;
    const span = max - min;
    const stepX = width / (values.length - 1);
    const y = (v: number) => height - ((v - min) / span) * height;
    const pts = values.map((v, i) => ({ x: i * stepX, y: y(v) }));
    return { pts, stepX, refY: referenceValue !== undefined ? y(referenceValue) : null };
  }, [values, width, height, referenceValue]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const scrub = (x: number) => {
    if (!geo || !onScrub) return;
    const i = Math.max(0, Math.min(values.length - 1, Math.round(x / geo.stepX)));
    setCursor(i);
    onScrub(i);
  };
  const release = () => {
    if (!onScrub) return;
    setCursor(null);
    onScrub(null);
  };

  return (
    <View
      style={{ height, width: "100%" }}
      onLayout={onLayout}
      onStartShouldSetResponder={() => !!onScrub}
      onMoveShouldSetResponder={() => !!onScrub}
      onResponderGrant={(e) => scrub(e.nativeEvent.locationX)}
      onResponderMove={(e) => scrub(e.nativeEvent.locationX)}
      onResponderRelease={release}
      onResponderTerminate={release}
    >
      {geo && (
        <>
          {fill &&
            geo.pts.map((p, i) =>
              i === 0 ? null : (
                <View
                  key={`f${i}`}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: geo.pts[i - 1].x,
                    width: Math.ceil(geo.stepX) + 0.5,
                    top: Math.min(p.y, geo.pts[i - 1].y),
                    bottom: 0,
                    backgroundColor: color,
                    opacity: 0.08,
                  }}
                />
              )
            )}

          {geo.refY !== null && (
            <View
              pointerEvents="none"
              style={[styles.refLine, { top: geo.refY, borderColor: referenceColor }]}
            />
          )}

          {geo.pts.map((p, i) => {
            if (i === 0) return null;
            const a = geo.pts[i - 1];
            const dx = p.x - a.x;
            const dy = p.y - a.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);
            return (
              <View
                key={`l${i}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: (a.x + p.x) / 2 - len / 2,
                  top: (a.y + p.y) / 2 - strokeWidth / 2,
                  width: len + 0.6,
                  height: strokeWidth,
                  borderRadius: strokeWidth / 2,
                  backgroundColor: color,
                  transform: [{ rotate: `${angle}rad` }],
                }}
              />
            );
          })}

          {cursor !== null && (
            <>
              <View pointerEvents="none" style={[styles.cursorLine, { left: geo.pts[cursor].x }]} />
              <View
                pointerEvents="none"
                style={[
                  styles.cursorDot,
                  { left: geo.pts[cursor].x - 5, top: geo.pts[cursor].y - 5, borderColor: color },
                ]}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}

/** Selector de rango temporal (1D / 1S / 1M / 1A). */
export function RangeSelector<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.rangeRow}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} style={[styles.rangeBtn, on && styles.rangeBtnOn]} onPress={() => onChange(o.key)}>
            <Text style={[styles.rangeText, on && styles.rangeTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  refLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
    opacity: 0.7,
  },
  cursorLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "#5F6875" },
  cursorDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    backgroundColor: "#0A0C10",
  },
  rangeRow: { flexDirection: "row", gap: 6 },
  rangeBtn: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rangeBtnOn: { backgroundColor: "#181C24" },
  rangeText: { color: "#5F6875", fontSize: 12, fontWeight: "600" },
  rangeTextOn: { color: "#F4F5F7" },
});

