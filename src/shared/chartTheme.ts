// shared/chartTheme.ts — Tema común de gráficos desde los tokens (Ola 4, sep-2026)
//
// ApexCharts (Rendimiento, Vista Partner) y Chart.js (Presentación) salen de
// LOS MISMOS tokens CSS (src/styles/tokens.css), leídos en tiempo de ejecución
// con getComputedStyle — así el modo oscuro de más adelante se hereda sin
// tocar ningún gráfico. Todavía NO está conectado a ningún gráfico existente
// (eso es Ola 6): hoy solo lo usa el kit (?ui=kit).
//
// Uso previsto:
//   new ApexCharts(el, deepMerge(apexBase(), { series, xaxis: { categories } }))
//   new Chart(ctx, { type: "line", data, options: { ...chartjsBase(), …propias } })
//
// Reglas que este tema fija (skill dataviz):
//   · Paleta categórica en ORDEN FIJO; la serie 10+ no inventa color:
//     seriesColor(i) devuelve el gris de "Otros". Una serie mantiene su color
//     aunque cambie el filtro — asignar por entidad, no por posición en pantalla.
//   · Ninguna letra por debajo de 11px.
//   · Grilla y ejes recesivos; sin marcadores por defecto (solo al hover).

/** Valores de respaldo = los de tokens.css. Un test compara ambos para que no
 *  se desalineen (src/shared/chartTheme.test.ts). */
export const FALLBACK = {
  palette: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#1596a6", "#a0621a"],
  other: "#9ca3af",
  grid: "#e5e7eb",
  axis: "#d1d5db",
  label: "#6b7280",
  text: "#111827",
  textMuted: "#4b5563",
  surface: "#ffffff",
  border: "#e5e7eb",
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
} as const;

/** Lee un custom property del :root; sin DOM (tests, worker) o vacío → fallback. */
export function cssVar(name: string, fallback: string): string {
  try {
    if (typeof document === "undefined" || typeof getComputedStyle !== "function") return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export interface ChartTokens {
  palette: string[];
  other: string;
  grid: string;
  axis: string;
  label: string;
  text: string;
  textMuted: string;
  surface: string;
  border: string;
  font: string;
}

export function chartTokens(): ChartTokens {
  return {
    palette: FALLBACK.palette.map((fb, i) => cssVar(`--cat-${i + 1}`, fb)),
    other: cssVar("--cat-other", FALLBACK.other),
    grid: cssVar("--chart-grid", FALLBACK.grid),
    axis: cssVar("--chart-axis", FALLBACK.axis),
    label: cssVar("--chart-label", FALLBACK.label),
    text: cssVar("--color-text", FALLBACK.text),
    textMuted: cssVar("--color-text-muted", FALLBACK.textMuted),
    surface: cssVar("--color-surface", FALLBACK.surface),
    border: cssVar("--color-border", FALLBACK.border),
    font: cssVar("--font-sans", FALLBACK.font)
  };
}

/** Color de la serie i (0-based). Fuera de la paleta → gris "Otros", nunca
 *  un color reciclado (dos series con el mismo color se leen como la misma). */
export function seriesColor(i: number, tokens: ChartTokens = chartTokens()): string {
  if (!Number.isInteger(i) || i < 0 || i >= tokens.palette.length) return tokens.other;
  return tokens.palette[i];
}

const FONT_XS = 11;
const FONT_SM = 12;

/** Opciones base para ApexCharts. Se combinan con las del gráfico (merge
 *  profundo del lado del llamador). */
export function apexBase(t: ChartTokens = chartTokens()) {
  const axisLabels = { style: { fontSize: `${FONT_XS}px`, fontFamily: t.font, colors: t.label } };
  return {
    chart: {
      fontFamily: t.font,
      foreColor: t.label,
      background: "transparent",
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: true, speed: 250, animateGradually: { enabled: false } }
    },
    colors: [...t.palette],
    dataLabels: { enabled: false },
    stroke: { width: 2, curve: "straight" as const, lineCap: "round" as const },
    markers: { size: 0, strokeWidth: 2, strokeColors: t.surface, hover: { size: 5 } },
    grid: {
      borderColor: t.grid,
      strokeDashArray: 0,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { left: 8, right: 8 }
    },
    xaxis: {
      axisBorder: { show: true, color: t.axis },
      axisTicks: { show: false },
      labels: axisLabels,
      tooltip: { enabled: false }
    },
    yaxis: { labels: axisLabels },
    legend: {
      fontSize: `${FONT_SM}px`,
      fontFamily: t.font,
      labels: { colors: t.textMuted },
      markers: { width: 10, height: 10, radius: 2 },
      itemMargin: { horizontal: 8, vertical: 2 }
    },
    tooltip: {
      theme: "light",
      style: { fontSize: `${FONT_SM}px`, fontFamily: t.font },
      x: { show: true }
    },
    states: { active: { filter: { type: "none" } } }
  };
}

/** Opciones base para Chart.js (v4). Van en `options`. */
export function chartjsBase(t: ChartTokens = chartTokens()) {
  const font = { family: t.font, size: FONT_XS };
  const scale = {
    grid: { color: t.grid, drawTicks: false },
    border: { color: t.axis },
    ticks: { color: t.label, font, padding: 6 }
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    color: t.textMuted,
    font: { family: t.font, size: FONT_SM },
    elements: {
      line: { borderWidth: 2, tension: 0 },
      point: { radius: 0, hoverRadius: 5, hitRadius: 8 },
      bar: { borderRadius: 4 }
    },
    scales: {
      x: { ...scale, grid: { ...scale.grid, display: false } },
      y: { ...scale }
    },
    plugins: {
      legend: {
        labels: { color: t.textMuted, font: { family: t.font, size: FONT_SM }, boxWidth: 10, boxHeight: 10 }
      },
      tooltip: {
        backgroundColor: t.surface,
        titleColor: t.text,
        bodyColor: t.textMuted,
        borderColor: t.border,
        borderWidth: 1,
        titleFont: { family: t.font, size: FONT_SM, weight: "bold" as const },
        bodyFont: { family: t.font, size: FONT_SM },
        padding: 10,
        usePointStyle: true
      }
    }
  };
}
