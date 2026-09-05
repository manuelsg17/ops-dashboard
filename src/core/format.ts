// core/format.js — Formateadores de display puros (Fase A2: módulo ES)
// Puros = no leen STATE. bdg()/bdgMode() (dependen de STATE.curMode) se quedan
// en data.js por ahora.

export function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},62%,46%)`;
}

// Normaliza ciudad: trim + UPPERCASE. Llamar SIEMPRE al leer/escribir ciudad
// (BD, uploads, comparaciones). Evita fragmentacion "Lima"/"lima"/"LIMA".
export function normCity(c) {
  return String(c || "").trim().toUpperCase();
}
// Para display amigable: "LIMA" -> "Lima". Usar al renderizar en UI.
export function cityLabel(c) {
  const s = String(c || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Display formatters — max 2 decimal places
export function fmt(n) {
  // Arriba de 10.000 los decimales son ruido: "3.305.781,38" horas no aporta
  // nada sobre "3.305.782" y alarga la cifra lo suficiente como para apretar
  // las tarjetas de KPI. Debajo del corte se conservan (tasas, ratios, montos
  // chicos), que es donde el decimal sí cambia la lectura.
  const abs = Math.abs(n || 0);
  return (n || 0).toLocaleString("es-PE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: abs >= 10000 ? 0 : 2,
  });
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

// Semaforo. MISMO corte que pColor/pEstado (ver abajo): antes daba verde desde
// 80% y contradecia al color de la barra que estaba al lado.
// Color de un % de cumplimiento. Escala revisada (ago 2026) porque la anterior
// (>100 morado · >=80 verde · >=50 ambar · <50 rojo) desinformaba en los dos
// extremos, y estos informes los lee la gerencia del partner:
//
//   - 80% pintaba VERDE. Un partner 20% corto se leia como cumplido: falso
//     positivo justo en la zona donde hay que actuar. Ahora verde = CUMPLIO,
//     y CUMPLIO arranca en 95% — es el umbral que usa el negocio.
//   - 101% y 208% pintaban IGUAL (morado). Duplicar la meta no es un triunfo,
//     es una meta mal calibrada, y el informe la celebraba en vez de
//     señalarla. Ahora el morado empieza en 150% y significa "revisar meta".
//
// Cuatro estados con significado propio:
//   morado >150  meta desalineada (revisar con el KAM)
//   verde  >=95  cumplio (umbral de negocio de Manuel, no 100)
//   ambar  >=80  cerca, falta poco
//   rojo   <80   atrasado
export function pColor(p) { return p > 150 ? "#8b5cf6" : p >= 95 ? "#10b981" : p >= 80 ? "#f59e0b" : "#FF0000"; }

// Etiqueta del estado de cumplimiento, en el MISMO corte que pColor — asi el
// color y la palabra nunca pueden contradecirse.
export function pEstado(p) {
  return p > 150 ? "meta_desalineada" : p >= 95 ? "cumplio" : p >= 80 ? "cerca" : "atrasado";
}

export function semCls(p) { return p >= 95 ? "sem-g" : p >= 80 ? "sem-y" : "sem-r"; }

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
