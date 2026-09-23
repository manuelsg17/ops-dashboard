//@ts-nocheck
// charts.js — Toda la lógica de ApexCharts
import { escapeHTML } from "./core/security";
import { fechaLocalISO } from "./shared/fechaLocal";
import { MAX_SERIES_CON_MARCADORES } from "./shared/topSeries";
import { apexBase, chartTokens, seriesColor } from "./shared/chartTheme";
import { t } from "./core/i18n";

// ── TOOLTIP FLOTANTE ──────────────────────────────────────────────────────────
// El listener de mousemove se agrega solo cuando el tooltip está visible y se
// remueve al ocultarlo, evitando disparos en cada pixel cuando no hay tooltip.
export function _onTipMouseMove(e) {
  const ft = document.getElementById("floatTip");
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX + 16, y = e.clientY - 16;
  if (x + 260 > vw) x = e.clientX - 265;
  if (y + ft.offsetHeight > vh) y = vh - ft.offsetHeight - 10;
  ft.style.left = x + "px";
  ft.style.top  = y + "px";
}

export function showFloatTip(date, rows) {
  const ft = document.getElementById("floatTip");
  document.getElementById("ftDate").textContent = date;
  const container = document.getElementById("ftRows");
  container.innerHTML = rows.length
    ? rows.map(r =>
        `<div class="ft-r">
           <span class="ft-dot" style="background:${r.color}"></span>
           <span class="ft-n">${escapeHTML(r.name)}</span>
           <span class="ft-v">${fmt(r.val)}</span>
         </div>`).join("")
    : `<div class="agy-style-54">Sin datos</div>`;
  if (ft.style.display !== "block") {
    document.addEventListener("mousemove", _onTipMouseMove);
  }
  ft.style.display = "block";
}

export function hideFloatTip() {
  document.getElementById("floatTip").style.display = "none";
  document.removeEventListener("mousemove", _onTipMouseMove);
}

// ── MULTI-LINE CHART (one series per partner) ─────────────────────────────────
// Ola 6: los 8 partners más grandes por Active Drivers del último período, SIN
// la serie "Otros". La Ola 2 la dibujaba en un segundo eje Y (a la derecha) y
// se prestaba a confusión: dos escalas en el mismo gráfico se leen como una.
// Ahora lo que queda fuera se dice en el pie del gráfico (lo arma rendimiento.ts
// con rendTopPartners: "8 de N partners…; el resto suma X"). Colores de la
// paleta categórica por posición en el ranking (el orden es el mismo en los
// cuatro gráficos, así que un color significa el mismo partner en todos).
export const TOP_PARTNERS_TENDENCIA = 8;
export function rendTopPartners(dates, partners, byDate) {
  const ultima = dates[dates.length - 1];
  const peso = p => byDate[ultima]?.[p]?.activeDrivers || 0;
  return partners.slice()
    .sort((a, b) => peso(b) - peso(a) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, TOP_PARTNERS_TENDENCIA);
}
export function valorMetricaPartner(byDate, p, d, metric) {
  const dp = byDate[d]?.[p];
  if (!dp) return 0;
  if (metric === "nr") return dp.newPartner + dp.newService + dp.reactivated;
  if (metric === "sh") return dp.supplyHours;
  if (metric === "tr") return dp.trips || 0;
  return dp.activeDrivers;
}
export function buildMultiLine(elId, dates, partners, byDate, metric, _fallbackColor) {
  const top = rendTopPartners(dates, partners, byDate);
  const tk = chartTokens();
  const series = top.map(p => ({ name: p, data: dates.map(d => valorMetricaPartner(byDate, p, d, metric)) }));
  buildLineChart(elId, dates, series, top.map((_, i) => seriesColor(i, tk)), { chart: { height: 330 } });
}

// Índice base 100 (comparativa por ciudad de Rendimiento): cada serie dividida
// por su PRIMER valor > 0 del rango. Los puntos anteriores a esa base (serie en
// 0 al inicio) quedan como hueco (null), no en 0: no hay contra qué indexarlos.
// Un decimal. Puro.
export function indiceBase100(data) {
  const i0 = data.findIndex(v => v > 0);
  if (i0 < 0) return data.map(() => null);
  const base = data[i0];
  return data.map((v, i) => (i < i0 || v == null || !Number.isFinite(v)) ? null : Math.round((v / base) * 1000) / 10);
}

// ── SINGLE-LINE CHART (one series for a city aggregate) ──────────────────────
export function buildSingleLine(elId, dates, cityByDate, metric, color, label) {
  const data = dates.map(d => {
    const r = cityByDate[d];
    return r ? r[metric] : 0;
  });
  buildLineChart(elId, dates, [{ name: label, data }], [color]);
}

import { ChartRegistry } from "./core/chartRegistry.js";

// ── ApexCharts bajo demanda ───────────────────────────────────────────────────
// ApexCharts pesa 510 kB (133 kB gzip) y era el chunk EAGER más grande: se
// descargaba y parseaba antes de la pantalla de login, aunque solo lo usan las
// gráficas de Rendimiento/Metas/Vista Partner. Sacarlo del arranque es la
// mayor mordida al tiempo de primer pintado.
//
// Se mantiene la API SÍNCRONA de buildLineChart/buildDonutChart a propósito
// (las llaman ~20 sitios dentro de renders que arman HTML): si la librería
// todavía no está, la llamada se re-encola cuando termina de cargar. Las
// gráficas son lo último que el usuario mira, así que ese diferimiento no se
// nota — y a esa altura el prefetch de abajo casi siempre ya la trajo.
let _apexPromise = null;
export function ensureApex() {
  if (window.ApexCharts) return Promise.resolve(window.ApexCharts);
  if (!_apexPromise) {
    _apexPromise = import("apexcharts").then(m => {
      window.ApexCharts = m.default || m;
      return window.ApexCharts;
    });
  }
  return _apexPromise;
}

// Destruye todas las instancias ApexCharts en STATE.charts y ChartRegistry.
export function destroyAllCharts() {
  ChartRegistry.destroyAll();
  if (!STATE.charts) return;
  Object.keys(STATE.charts).forEach(id => {
    try { STATE.charts[id].destroy(); } catch(e) {}
    delete STATE.charts[id];
  });
}

// Merge profundo mínimo para combinar el tema (chartTheme.apexBase) con las
// opciones de cada gráfico. Los arrays se reemplazan, no se mezclan.
function _merge(base, over) {
  if (Array.isArray(over) || over === null || typeof over !== "object") return over;
  const out = { ...(base && typeof base === "object" && !Array.isArray(base) ? base : {}) };
  Object.keys(over).forEach(k => {
    const v = over[k];
    out[k] = (v && typeof v === "object" && !Array.isArray(v) && typeof v !== "function")
      ? _merge(out[k], v) : v;
  });
  return out;
}

// ── BASE LINE CHART ───────────────────────────────────────────────────────────
// `extra` (opcional): opciones propias de un gráfico, mezcladas al final (p.ej.
// el formato del eje Y del índice base 100 de Rendimiento).
export function buildLineChart(elId, dates, series, colors, extra) {
  if (!window.ApexCharts) { ensureApex().then(() => buildLineChart(elId, dates, series, colors, extra)); return; }
  // Tema común (Ola 6): tipografía ≥11 px, grilla y ejes recesivos, paleta y
  // leyenda desde los tokens (shared/chartTheme.ts). Un solo eje Y siempre.
  const opts = _merge(apexBase(), {
    series,
    chart: {
      type:       "line",
      height:     220,
      animations: { enabled: false },
      events: {
        mouseLeave: () => hideFloatTip()
      }
    },
    stroke:  { curve: "straight", width: 2 },
    colors,
    xaxis: {
      categories: dates.map(d2s),
      labels:     { rotate: -45, hideOverlappingLabels: true, trim: false }
    },
    yaxis: { forceNiceScale: true, labels: { formatter: v => fmt(v) } },
    grid:  { padding: { left: 16, right: 12 } },
    legend: {
      show:         series.length > 1 && series.length <= MAX_SERIES_CON_MARCADORES + 1,
      position:     "bottom"
    },
    // Con más de 8 series, sin marcadores (cientos de círculos SVG que se
    // repintan en cada hover); con pocas, un punto chico por período.
    markers: { size: series.length > MAX_SERIES_CON_MARCADORES ? 0 : 3, strokeWidth: 0, hover: { size: 5 } },
    tooltip: {
      custom({ series: s, dataPointIndex: di, w }) {
        const date = w.globals.labels[di];
        const rows = series
          .map((sr, i) => ({ name: sr.name, val: s[i][di] || 0, color: colors[i] }))
          .filter(r => r.val > 0)
          .sort((a, b) => b.val - a.val);
        showFloatTip(date, rows);
        return "<div style='display:none'></div>";
      }
    }
  });
  if (extra) Object.assign(opts, _merge(opts, extra));

  const prev = STATE.charts[elId];
  if (prev) {
    // Si el elemento sigue en DOM, actualizar series sin recrear el chart (mucho más rápido)
    if (prev.el && document.body.contains(prev.el)) {
      prev.updateOptions({ series, colors: opts.colors, markers: opts.markers, legend: opts.legend, yaxis: opts.yaxis, stroke: opts.stroke, xaxis: opts.xaxis }, false, false, false);
      return;
    }
    // Elemento fue destruido por innerHTML — el chart quedo huerfano con su
    // ResizeObserver/listeners vivos. Forzar destroy() para liberarlos (NO es
    // gratis: si no llamamos destroy, el observer sigue disparando en window.resize).
    try { prev.destroy(); } catch(e) {}
    delete STATE.charts[elId];
  }

  const el = document.getElementById(elId);
  if (!el) return;
  _prepararContenedor(el);

  const ch = new ApexCharts(el, opts);
  ch.render();
  STATE.charts[elId] = ch;
  ChartRegistry.register(elId, ch);
}

// ── AJUSTE DE ANCHO (I5, sep-2026) ────────────────────────────────────────────
// Al abrir la barra lateral los gráficos se salían del contenedor (123 px de
// desborde medido a 1440 px). Dos causas, las dos resueltas acá sin tocar app.ts:
//
// 1. Las grillas de gráficos son `repeat(N, 1fr)`, y `1fr` es minmax(auto, 1fr):
//    el mínimo de cada celda es el ancho de su CONTENIDO — el SVG ya dibujado.
//    Aunque ApexCharts re-midiera, el padre seguía sosteniendo el ancho viejo y
//    medía eso. `min-width: 0` en la tarjeta y en el contenedor suelta la celda.
// 2. El único disparador era un `resize` a los 220 ms del toggle, que switchTab
//    cancela y que no cubre otros cambios de ancho. Un ResizeObserver sobre
//    `.main` reacciona a CUALQUIER cambio de ancho del área de contenido
//    (toggle, rotación del iPad, ventana), con debounce para no redibujar en
//    cada frame de la transición.
function _prepararContenedor(el) {
  el.style.minWidth = "0";
  const card = el.closest && el.closest(".chart-card, .rd-chart");
  if (card) card.style.minWidth = "0";
  _observarAnchoMain();
}

let _roMain = null, _roTimer = null, _anchoMain = 0;
function _observarAnchoMain() {
  if (_roMain || typeof ResizeObserver === "undefined") return;
  const main = document.querySelector(".main");
  if (!main) return;
  _anchoMain = main.clientWidth;
  _roMain = new ResizeObserver(entries => {
    const w = Math.round(entries[0]?.contentRect?.width || 0);
    if (!w || Math.abs(w - _anchoMain) < 2) return;   // solo cambios de ANCHO
    _anchoMain = w;
    clearTimeout(_roTimer);
    _roTimer = setTimeout(() => {
      // ApexCharts re-mide en `resize` de window (redrawOnWindowResize, default).
      if (STATE.charts && Object.keys(STATE.charts).length) window.dispatchEvent(new Event("resize"));
    }, 160);
  });
  _roMain.observe(main);
}

// ── DONUT CHART (composición / parts-of-whole, snapshot — NO serie de tiempo) ─
// Genérico: cualquier módulo lo puede usar para "qué tan grande es cada parte de
// un total en un momento dado" (ej. Fleet: owned cars por partner, brandeados vs
// no). Comparte STATE.charts con las líneas → destroyAllCharts()/dlChart() ya
// funcionan sin cambios.
export function buildDonutChart(elId, labels, series, colors) {
  if (!window.ApexCharts) { ensureApex().then(() => buildDonutChart(elId, labels, series, colors)); return; }
  const total = series.reduce((a, b) => a + b, 0);
  const tk = chartTokens();
  const opts = _merge(apexBase(tk), {
    series,
    labels,
    colors,
    chart: {
      type:       "donut",
      height:     240,
      animations: { enabled: false }
    },
    stroke: { width: 1, colors: [tk.surface] },
    dataLabels: {
      enabled:   true,
      style:     { fontSize: "11px" },
      formatter: (_, o) => fmt(o.w.globals.series[o.seriesIndex])
    },
    legend: {
      show:       labels.length <= 8,
      position:   "bottom"
    },
    plotOptions: {
      pie: {
        donut: {
          size: "62%",
          labels: {
            show: true,
            total: { show: true, label: t("rend.ch.total"), formatter: () => fmt(total) },
            value: { formatter: v => fmt(Number(v)) }
          }
        }
      }
    },
    tooltip: { y: { formatter: v => fmt(v) } }
  });

  const prev = STATE.charts[elId];
  if (prev) {
    if (prev.el && document.body.contains(prev.el)) {
      prev.updateOptions({ series, labels, colors }, false, false, false);
      return;
    }
    try { prev.destroy(); } catch(e) {}
    delete STATE.charts[elId];
  }

  const el = document.getElementById(elId);
  if (!el) return;
  _prepararContenedor(el);

  const ch = new ApexCharts(el, opts);
  ch.render();
  STATE.charts[elId] = ch;
  ChartRegistry.register(elId, ch);
}

// ── DOWNLOAD CHART AS PNG ─────────────────────────────────────────────────────
export function dlChart(chartId, name) {
  const ch = STATE.charts[chartId];
  if (!ch) return;
  ch.dataURI().then(({ imgURI }) => {
    const a = document.createElement("a");
    a.href     = imgURI;
    a.download = `yango_${name}_${fechaLocalISO()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}
