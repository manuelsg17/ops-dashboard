// core/format.js — Formateadores de display puros (Fase A2: módulo ES)
// Puros = no leen STATE. bdg()/bdgMode() (dependen de STATE.curMode) se quedan
// en data.js por ahora.

// Display formatters — max 2 decimal places
export function fmt(n) {
  return (n || 0).toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Alta precisión (hasta 5 decimales) — SOLO para Data Raw/Conciliación, donde se
// cuadra contra Excel. El resto del dashboard usa fmt() (2 decimales).
export function fmt5(n) {
  return (n || 0).toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 5 });
}

export function fmtK(n) {
  return "$" + ((n || 0) / 1000).toLocaleString("es-PE",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "K";
}

// fmtSmart: compresion automatica K/M con 1 decimal fijo.
// Usar para metricas grandes (Supply Hours, Trips, Commission) donde el numero
// completo no entra en charts/KPI cards. Mantiene 1 decimal siempre para no
// hacer redondeos fuertes (12,500 -> "12.5K" en vez de "13K").
// Para Conductores Activos NO usar — el numero exacto es sensible.
export function fmtSmart(n) {
  if (n === null || n === undefined || isNaN(n)) return "0";
  const neg = n < 0;
  const abs = Math.abs(n);
  let out;
  if (abs >= 1_000_000) {
    out = (abs / 1_000_000).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "M";
  } else if (abs >= 1_000) {
    out = (abs / 1_000).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "K";
  } else {
    out = fmt(abs);
  }
  return neg ? "-" + out : out;
}

export function d2s(d) { return d ? d.split("-").reverse().join("/") : "--"; }

// Semaphore
export function semCls(p) { return p > 100 ? "sem-g" : p >= 80 ? "sem-g" : p >= 50 ? "sem-y" : "sem-r"; }
export function pColor(p) { return p > 100 ? "#8b5cf6" : p >= 80 ? "#10b981" : p >= 50 ? "#f59e0b" : "#FF0000"; }

// Trend over last 3 periods
export function trendI(vals) {
  const v = vals.filter(x => x > 0);
  if (v.length < 2) return { i: "→", c: "" };
  const l = v.slice(-3);
  let u = 0, d = 0;
  for (let i = 1; i < l.length; i++) {
    if (l[i] > l[i - 1]) u++;
    else if (l[i] < l[i - 1]) d++;
  }
  if (u > d) return { i: "↑", c: "color:#10b981" };
  if (d > u) return { i: "↓", c: "color:#FF0000" };
  return { i: "→", c: "color:#888" };
}
