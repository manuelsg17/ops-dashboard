//@ts-nocheck
// charts.js — Toda la lógica de ApexCharts
import { escapeHTML } from "./core/security";
import { fechaLocalISO } from "./shared/fechaLocal";
import { topNMasOtros, MAX_SERIES_CON_MARCADORES } from "./shared/topSeries";
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
// V6 (Ola 2): top 8 por Active Drivers del último período + "Otros" (ver
// shared/topSeries.ts). Antes una serie por partner: ~70 en producción.
const _COLOR_OTROS = "#9ca3af";
export function buildMultiLine(elId, dates, partners, byDate, metric, fallbackColor) {
  const valor = (p, d) => {
    const dp = byDate[d]?.[p];
    if (!dp) return 0;
    if (metric === "nr") return dp.newPartner + dp.newService + dp.reactivated;
    if (metric === "sh") return dp.supplyHours;
    if (metric === "tr") return dp.trips || 0;
    return dp.activeDrivers;
  };
  const ultima = dates[dates.length - 1];
  const peso = p => byDate[ultima]?.[p]?.activeDrivers || 0;
  const { series: top, resto } = topNMasOtros(partners, dates, valor, peso, 8);
  const series = top.map(s => s.otros ? { name: t("rend.tend.otros", { n: resto }), data: s.data, _ejeAparte: true } : s);
  const colors = top.map(s => s.otros ? _COLOR_OTROS : (STATE.partnerColors[s.name] || fallbackColor));
  buildLineChart(elId, dates, series, colors);
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

// Eje Y. Con una serie "Otros" (V6, marcada `_ejeAparte`) esa serie va en su
// PROPIO eje, a la derecha: es la suma de decenas de partners y en el mismo eje
// aplastaba a las 8 líneas del top contra el piso del gráfico (medido: ~14.000
// contra ~3.000 del partner más grande en el seed local).
function _ejesY(series) {
  const etiquetas = color => ({ formatter: v => fmt(v), style: { fontSize: "10px", ...(color ? { colors: color } : {}) } });
  const iOtros = series.findIndex(sr => sr._ejeAparte);
  if (iOtros < 0) return { labels: etiquetas() };
  const primera = series.find(sr => !sr._ejeAparte);
  return series.map((sr, i) => i === iOtros
    ? { seriesName: sr.name, opposite: true, labels: etiquetas("#9ca3af") }
    : { seriesName: primera ? primera.name : sr.name, show: sr === primera, labels: etiquetas() });
}

// ── BASE LINE CHART ───────────────────────────────────────────────────────────
export function buildLineChart(elId, dates, series, colors) {
  if (!window.ApexCharts) { ensureApex().then(() => buildLineChart(elId, dates, series, colors)); return; }
  const opts = {
    series,
    chart: {
      type:       "line",
      height:     200,
      toolbar:    { show: false },
      zoom:       { enabled: false },
      fontFamily: "inherit",
      animations: { enabled: false },
      events: {
        mouseLeave: () => hideFloatTip()
      }
    },
    // "Otros" (V6) punteada: es una suma, no un partner más.
    stroke:  { curve: "smooth", width: 2, dashArray: series.map(sr => (sr._ejeAparte ? 4 : 0)) },
    colors,
    xaxis: {
      categories: dates.map(d2s),
      labels:     { style: { fontSize: "10px" }, rotate: -30 },
      axisBorder: { show: false },
      axisTicks:  { show: false }
    },
    yaxis: _ejesY(series),
    legend: {
      // 9 = top 8 + "Otros" de buildMultiLine: la leyenda vuelve a ser legible.
      show:         series.length <= MAX_SERIES_CON_MARCADORES + 1,
      position:     "bottom",
      fontSize:     "10px",
      itemMargin:   { horizontal: 4, vertical: 2 }
    },
    grid:    { borderColor: "#f0f0f0", strokeDashArray: 4 },
    // Con más de 8 series, sin marcadores (cientos de círculos SVG que se
    // repintan en cada hover); el punto sigue apareciendo al pasar el mouse.
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
  };

  const prev = STATE.charts[elId];
  if (prev) {
    // Si el elemento sigue en DOM, actualizar series sin recrear el chart (mucho más rápido)
    if (prev.el && document.body.contains(prev.el)) {
      prev.updateOptions({ series, colors: opts.colors, markers: opts.markers, legend: opts.legend, yaxis: opts.yaxis, stroke: opts.stroke }, false, false, false);
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
  const card = el.closest && el.closest(".chart-card");
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
  const opts = {
    series,
    labels,
    colors,
    chart: {
      type:       "donut",
      height:     220,
      fontFamily: "inherit",
      animations: { enabled: false }
    },
    stroke: { width: 1, colors: ["#fff"] },
    dataLabels: {
      enabled:   true,
      formatter: (_, o) => fmt(o.w.globals.series[o.seriesIndex])
    },
    legend: {
      show:       labels.length <= 8,
      position:   "bottom",
      fontSize:   "10px",
      itemMargin: { horizontal: 4, vertical: 2 }
    },
    plotOptions: {
      pie: {
        donut: {
          size: "62%",
          labels: {
            show: true,
            total: { show: true, label: "Total", formatter: () => fmt(total) },
            value: { formatter: v => fmt(Number(v)) }
          }
        }
      }
    },
    tooltip: { y: { formatter: v => fmt(v) } }
  };

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
