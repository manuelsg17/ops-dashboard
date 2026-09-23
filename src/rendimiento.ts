//@ts-nocheck
// rendimiento.js — Pestaña Rendimiento

// Núcleo de cálculo compartido (ver domain/metrics.ts).
import { ratio, tasaAcum, sumarTasa, leerTasa } from "./domain/metrics.js";
import { sliceEscala, datasetLinea } from "./shared/escala.js";
import { SIN_KAM } from "./core/config.js";
import { t, kamLabel, mesLabel, getLang } from "./core/i18n";
import { dn } from "./shared/huella";
import { particionarPorKam, ordenarKams } from "./domain/desgloseKam";
import { escalaLista, reintentarCuandoEscalaLista } from "./shared/escalaLista";
import { partesAlcance } from "./shared/alcance";
import { progressBar, segmented, btn, badge, alertBox, emptyState } from "./shared/ui";
import { iconSvg } from "./shared/icons";
import { chartTokens, seriesColor } from "./shared/chartTheme";
import { rendTopPartners, valorMetricaPartner, indiceBase100 } from "./charts.js";
import { metasResumenPais, _metasFechasDelMes, _metasFechasMesCompleto } from "./metas.js";
import { reportYM } from "./shared/mesReporte.js";
import { parseLocalDate } from "./core/dates";
import { opcionesMesMeta, mesNumero } from "./domain/mesesMeta";

// ── LÍNEA DE NEGOCIO (Agregador / Fleet / TukTuk / Combinado) ─────────────────
// Localizado a Rendimiento: NO muta STATE.rawData (el agregador queda intacto para
// Metas/Calculadora/etc). Se filtra el slice de la línea con los MISMOS filtros del
// sidebar (ciudad/fecha/partner). Agregador incluye Fleet (Fleet ⊂ Taxi). Combinado
// = Taxi + TukTuk (conjuntos disjuntos: TukTuk se excluye de rawData al cargar, así
// que el concat no double-cuenta). El diario no trae db_id (sin sub-flota) →
// Fleet/TukTuk/Combinado se deshabilitan y cae a Agregador.
export function _rendLine() {
  // Las 4 líneas funcionan en las 3 escalas. El guard que forzaba "agg" en
  // diario existía porque el export diario no traía db_id — dejó de ser cierto
  // (verificado contra la BD el 2026-07-29: las 5.516 filas de la ventana lo
  // tienen), y ahora loadDiarioIfNeeded construye los slices Fleet/TukTuk.
  return STATE.rendLine || "comb";
}
// Dataset completo (todas las fechas) de la línea activa para la escala actual.
// La resolución por escala vive en shared/escala.ts (con tests): estuvo copiada
// en cuatro archivos y en todos estuvo mal a la vez — un booleano para TRES
// escalas, que en diario devolvía el slice SEMANAL sin decir nada.
const _sliceEscala = base => sliceEscala(STATE, base);

export function _rendLineDataset() {
  return datasetLinea(STATE, _rendLine());
}
// ¿Este partner está incluido en la selección del sidebar?
//
// HISTORIA (importante, tuvo dos versiones incorrectas): los partners solo-TukTuk
// (ej. PIAGGIO) no llegaban al sidebar porque la lista salía del dataset Taxi.
//   v1: `selSet.has(partner)` a secas → nunca aparecían: SUB-conteo.
//   v2: `selSet.has(partner) || !sidebarSet.has(partner)` → aparecían SIEMPRE,
//       incluso al elegir un único partner: SOBRE-conteo (se veía "Perú 145"
//       con un partner de 77 seleccionado, los otros 68 eran PIAGGIO).
// Ninguna de las dos es correcta porque el problema no estaba acá sino en el
// sidebar, que no podía expresar esos partners. Ahora `STATE.sidebarPartners`
// los incluye (ver updateIndexes en data.js), así que la selección alcanza y
// esta función vuelve a ser lo simple que siempre debió ser.
//
// El segundo parámetro se conserva por compatibilidad con los call sites y como
// red de seguridad: si algún partner quedara fuera del sidebar por un camino no
// previsto, se lo sigue incluyendo (preferimos sobre-contar visiblemente antes
// que perder data en silencio).
export function _lineSelHas(selSet, sidebarSet, partner) {
  if (selSet.has(partner)) return true;
  return !!sidebarSet && !sidebarSet.has(partner);
}

// KAM efectivo de una fila. `partners`/`flotas` mandan (getKAMForPartner); el KAM
// que vino en el Excel es solo fallback.
//
// El último fallback es SIN_KAM y no "": una fila sin KAM por ningún lado tiene
// que caer en un grupo REAL para que el filtro pueda alcanzarla. Con "" quedaba
// fuera de todos los grupos y solo se la veía en "Todos", así que sus números
// aparecían en el total del país sin pertenecer a nadie.
export function _lineKamOf(row) {
  const k = (typeof getKAMForPartner === "function" && getKAMForPartner(row.partner)) || "";
  return k || (row.kam || "").trim() || SIN_KAM;
}

// Filas de la línea filtradas por ciudad/fecha/partner/KAM (espeja getFiltered()).
//
// OJO con el filtro de KAM — acá había un sobreconteo real: en Agregador el KAM se
// aplica indirectamente (onKAMChange marca/desmarca los checkboxes del sidebar, así
// que `selected` ya viene acotado), pero los partners solo-TukTuk NO están en el
// sidebar y `_lineSelHas` los da por incluidos SIEMPRE. Resultado: al filtrar por un
// KAM en TukTuk/Combinado se colaban los partners solo-TukTuk de TODOS los demás
// KAMs, inflando los totales. Por eso el KAM se filtra acá de forma EXPLÍCITA en vez
// de confiar en la selección del sidebar.
export function _rendLineFiltered() {
  if (_rendLine() === "agg") return getFiltered();
  const f = getCurrentFilters();
  const selSet = new Set(f.selected);
  const sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  return _rendLineDataset().filter(r =>
    (f.city === "all" || r.city === f.city) &&
    r.date >= f.from && r.date <= f.to &&
    (f.kam === "all" || _lineKamOf(r) === f.kam) &&
    _lineSelHas(selSet, sidebar, r.partner)
  );
}
// Filas de prevDate (fuera del rango) para la línea. Agregador usa el índice _byDate;
// Fleet/TukTuk filtran su slice (arrays pequeños, sin índice dedicado).
// El KAM se aplica por el mismo motivo que arriba: si no, el período anterior de la
// comparación WoW incluiría partners que el período actual ya excluyó → un WoW que
// compara dos universos distintos y siempre da caída.
export function _rendLinePrev(prevDate, city) {
  if (!prevDate) return [];
  if (_rendLine() === "agg") {
    const base = (STATE._byDate && STATE._byDate.get(prevDate))
      || STATE.rawData.filter(r => r.date === prevDate);
    return city ? base.filter(r => r.city === city) : base;
  }
  const kam = (getCurrentFilters().kam) || "all";
  return _rendLineDataset().filter(r =>
    r.date === prevDate &&
    (!city || r.city === city) &&
    (kam === "all" || _lineKamOf(r) === kam)
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// PRESENTACIÓN (Ola 6, sep-2026) — sistema de diseño (ui-*, tokens) + rd-*
// (src/styles/views/rendimiento.css). Reglas de esta vista:
//   · Ningún número cambia: cada cifra conserva su `data-num` (huella) y su
//     formato (fmt / fmtSmart / fmtK). Los deltas de tablas y tarjetas conservan
//     el TEXTO de bdg() ("↑+5.0%", "N/A", "NEW", "--"), porque en la tabla Fleet
//     el badge vive dentro de la celda marcada y entra en la huella.
//   · Color con significado: estados con ok/warn/bad; ciudades y KAMs con la
//     paleta categórica (--cat-N), nunca el rojo de marca.
//   · Sin emojis en la interfaz: iconos de shared/icons.ts.
// ═════════════════════════════════════════════════════════════════════════════

// Etiqueta del periodo del snapshot, segun la escala activa.
export function _rendPeriodLabel() {
  return STATE.curMode === "mensual" ? t("rend.per.ultimoMes")
       : STATE.curMode === "diario"  ? t("rend.per.ultimoDia")
       : t("rend.per.ultimaSemana");
}
function _rdCompLabel() {
  return STATE.curMode === "mensual" ? t("rend.cmp.mesAnterior")
       : STATE.curMode === "diario"  ? t("rend.cmp.diaAnterior")
       : t("rend.cmp.semAnterior");
}
const _rdPrevLbl = () => t("rend.cmp.vs", { p: _rdCompLabel() });

// ── Colores categóricos (tokens) ─────────────────────────────────────────────
// Ciudad: posición fija en CITIES (Lima = cat-1). KAM: posición en la lista
// ORDENADA de KAMs reales (estable mientras no cambie la cartera); "No KAM" va
// en el gris de "Otros". Para el DOM se usa la variable CSS; para ApexCharts el
// valor resuelto (seriesColor lee el mismo token).
function _rdCityIdx(city) { return CITIES.indexOf(city); }
function _rdCityVar(city) {
  const i = _rdCityIdx(city);
  return i >= 0 && i < 9 ? `var(--cat-${i + 1})` : "var(--cat-other)";
}
function _rdKamIdx(kam) {
  if (!kam || kam === SIN_KAM) return -1;
  const kams = Object.keys(STATE.KAM_PARTNERS || {}).filter(k => k && k !== SIN_KAM).sort();
  if (!kams.includes(kam)) kams.push(kam);
  return kams.indexOf(kam) % 9;
}
function _rdKamVar(kam) {
  const i = _rdKamIdx(kam);
  return i >= 0 ? `var(--cat-${i + 1})` : "var(--cat-other)";
}
// Punto de color (dato, no decoración): el color viene de datos/tokens.
function _rdDot(color) {
  return `<span class="rd-dot" style="background:${escapeHTML(color)}" aria-hidden="true"></span>`;
}

// ── Delta vs período anterior ────────────────────────────────────────────────
// Misma semántica y MISMO TEXTO que bdgMode() (data.ts): en diario no se
// compara; sin base "N/A"; base 0 → "NEW"/"--"; si no "↑+5.0%". Lo que cambia es
// el aspecto: el de ui-delta (icono + color), con la flecha de texto solo para
// lectores de pantalla. `invert`: métricas donde bajar es bueno (fraude…).
function _rdDelta(c, p, o = {}) {
  if (STATE.curMode === "diario") return "";
  const comp = _rdCompLabel();
  if (p === null || p === undefined)
    return `<span class="ui-delta ui-delta--na" title="${escapeHTML(t("bdg.sinPrevio"))}">N/A</span>`;
  if (c === null || c === undefined)
    return `<span class="ui-delta ui-delta--na" title="${escapeHTML(t("bdg.sinDato"))}">N/A</span>`;
  if (p === 0)
    return c > 0 ? `<span class="ui-delta ui-delta--good" title="${escapeHTML(t("bdg.primero", { c: comp }))}">NEW</span>`
                 : `<span class="ui-delta ui-delta--flat" title="${escapeHTML(t("bdg.sinMov"))}">--</span>`;
  const v  = ((c - p) / p) * 100;
  const up = v >= 0;
  const s  = up ? "+" : "";
  const tone = Math.abs(v) < 0.05 ? "flat" : (up !== !!o.invert ? "good" : "bad");
  const tip = t("bdg.tip", { a: fmt(c), c: comp, p: fmt(p), v: `${s}${v.toFixed(1)}` });
  return `<span class="ui-delta ui-delta--${tone}" title="${escapeHTML(tip)}">` +
    iconSvg(up ? "arrow-up" : "arrow-down", { size: 12 }) +
    `<span class="ui-sr-only">${up ? "↑" : "↓"}</span><span>${s}${v.toFixed(1)}%</span></span>`;
}

// Tendencia de los últimos períodos (trendI): icono + tono, sin colores hex.
function _rdTrend(vals) {
  const ti = trendI(vals);
  const up = ti.i === "↑", down = ti.i === "↓";
  const cls = up ? "rd-trend--up" : down ? "rd-trend--down" : "rd-trend--flat";
  const lbl = t(up ? "rd.tend.sube" : down ? "rd.tend.baja" : "rd.tend.estable");
  return `<span class="rd-trend ${cls}" title="${escapeHTML(lbl)}">${iconSvg(up ? "trending-up" : down ? "trending-down" : "minus", { size: 14, label: lbl })}</span>`;
}

// ── Tarjeta KPI ──────────────────────────────────────────────────────────────
// Es la tarjeta del sistema de diseño (ui-kpi: valor · delta · avance contra la
// meta, dirección B). No se usa ui.kpiCard() tal cual porque (1) la cifra tiene
// que llevar su `data-num` y (2) el delta sigue la semántica de bdgMode (NEW,
// nada en diario); la barra de avance sí es la de ui.progressBar().
function _rdKpi(o) {
  const d = _rdDelta(o.cur, o.prev, { invert: o.invert });
  return `<div class="ui-kpi rd-kpi">
    <div class="ui-kpi__label">${escapeHTML(o.label)}</div>
    <div class="ui-kpi__row"><span class="ui-kpi__value"${o.numKey ? dn(o.numKey) : ""}>${escapeHTML(o.value)}</span>${
      d ? `<span class="ui-kpi__delta">${d}<span class="ui-kpi__prev">${escapeHTML(_rdPrevLbl())}</span></span>` : ""}</div>
    ${o.sub ? `<div class="ui-kpi__sub">${escapeHTML(o.sub)}</div>` : ""}
    ${o.goal ? progressBar(o.goal) : ""}
  </div>`;
}

// Encabezado de sección (sin icono ni color: el título de la PÁGINA y su
// alcance ya los pinta el shell).
function _rdSec(title, sub = "", right = "") {
  return `<div class="rd-sec"><div class="rd-sec__titles"><h2 class="rd-sec__title">${escapeHTML(title)}</h2>` +
    (sub ? `<div class="rd-sec__sub">${escapeHTML(sub)}</div>` : "") + `</div>${right}</div>`;
}

// Tarjeta de gráfico con botón PNG (dlChart).
function _rdChart(id, title, name, caption = "") {
  return `<div class="ui-card rd-chart">
    <div class="rd-chart__head"><span class="rd-chart__title">${escapeHTML(title)}</span>${
      btn({ label: "PNG", variant: "ghost", size: "sm", icon: "download", act: "dlChart", data: { chart: id, name }, title: t("rd.png") })}</div>
    <div id="${escapeHTML(id)}" class="rd-chart__plot"></div>
    ${caption ? `<div class="rd-chart__caption">${escapeHTML(caption)}</div>` : ""}
  </div>`;
}

function _rdEmpty(title, text) {
  return `<div class="rd-view">${rendLineToggleHTML()}${emptyState({ icon: "filter", title, text })}</div>`;
}

// ── Avance contra la meta del mes (lo que muestra la pestaña Metas) ──────────
// El % y la meta tienen que ser EXACTAMENTE los de Metas para la misma línea,
// filtros y mes: salen de metas.metasResumenPais, la MISMA función con la que
// Metas arma sus tarjetas del resumen (única fuente). La proyección (solo el mes
// en curso, domain/mesEnCurso) se decide dentro de cada llamada — no depende de
// qué se abrió antes en Metas.
//
// OJO al leer la tarjeta: el valor grande de N+R/Horas es el ACUMULADO DEL
// RANGO (puede abarcar varios meses), mientras el avance compara el actual DEL
// MES de la meta. Por eso el caption dice ese actual explícito ("Septiembre:
// 6,371 de 8,758 · 72.7%"): sin él, los dos números no cuadran a simple vista.
export function _rendMetaMes(line, lastDate) {
  if (!lastDate || !(STATE.metasData || []).length) return null;
  const ym = reportYM(lastDate, STATE.curMode, parseLocalDate);
  const op = opcionesMesMeta(STATE.metasData).find(o => mesNumero(o.mes) === ym.m && (o.anio == null || o.anio === ym.y));
  if (!op) return null;
  const f = getCurrentFilters();
  const mesDates = _metasFechasDelMes(op.mes, op.anio, f.from, f.to);
  const total = _metasFechasMesCompleto(op.mes, op.anio, f.to).length;
  if (!mesDates.length) return null;
  let res;
  try {
    res = metasResumenPais({ line, mesName: op.mes, anio: op.anio, fechas: mesDates,
      filtros: { city: f.city, kam: f.kam, selected: f.selected } });
  } catch (e) {
    console.warn("[rend] no se pudo calcular la meta del mes", e);
    return null;
  }
  if (!res || res.sinMetas) return null;
  const kpis = res.kpis || {};
  if (!Object.values(kpis).some(k => k && k.meta != null && k.meta > 0)) return null;
  // Nombre del mes con la mayúscula natural de cada idioma dentro de una frase
  // ("septiembre" / "September" / "сентябрь"); sin Intl, el de mesLabel.
  let mesTxt = mesLabel(op.mes);
  try {
    mesTxt = new Intl.DateTimeFormat(getLang(), { month: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(2000, ym.m - 1, 15)));
  } catch (e) { /* mesLabel */ }
  return {
    mes: op.mes, anio: op.anio,
    mesTxt,                         // dentro de una frase
    mesCap: mesLabel(op.mes),       // al comienzo del caption
    enRango: mesDates.length, total,
    kpis
  };
}
// Cómo se lee el actual de cada KPI contra la meta del mes: nivel del último
// período (snapshots), acumulado del mes (flujos) o tasa del mes (Fleet).
const _RD_META_TIPO = { ad: "nivel", cars: "nivel", nr: "mes", sh: "mes", shCar: "tasa", accept: "tasa" };
function _rdGoal(info, id) {
  if (!info) return undefined;
  const k = info.kpis[id];
  if (!k || !(k.meta > 0)) return { pct: null, caption: t("rd.meta.sinMetaDe", { m: info.mesTxt }) };
  if (k.actual == null || k.pct == null || !Number.isFinite(k.pct))
    return { pct: null, caption: t("rd.meta.soloMeta", { m: info.mesTxt, n: k.F(k.meta) }) };
  const tipo = _RD_META_TIPO[id] || "mes";
  const key = tipo === "nivel" ? "rd.meta.capNivel" : tipo === "tasa" ? "rd.meta.capTasa" : "rd.meta.capMes";
  let caption = t(key, { m: info.mesCap, a: k.F(k.actual), n: k.F(k.meta), p: k.pct.toFixed(1) + "%" });
  let projPct = null;
  // Decisión 4 de Manuel (domain/mesEnCurso): la proyección solo para el mes en
  // curso — ya viene en null si no corresponde.
  if (k.proj != null && Number.isFinite(k.proj)) {
    projPct = (k.proj / k.meta) * 100;
    caption += " · " + t("rd.meta.proy", { p: projPct.toFixed(1) + "%" });
  }
  return { pct: k.pct, caption, projPct };
}
function _rdGoalNota(info) {
  if (!info) return "";
  let txt = t("rd.meta.nota", { m: info.mesTxt, n: info.enRango, t: info.total });
  if (STATE.curMode !== "mensual") txt += " " + t("rd.meta.notaEscala");
  return `<p class="rd-note">${iconSvg("info", { size: 14 })}<span>${escapeHTML(txt)}</span></p>`;
}

// ── Selector de línea ────────────────────────────────────────────────────────
const _RD_LINEAS = [
  { value: "comb",  icon: "activity", label: () => t("rend.linea.comb") },
  { value: "agg",   icon: "taxi",     label: () => t("rend.linea.agg") },
  { value: "fleet", icon: "car",      label: () => "Fleet" },
  { value: "tk",    icon: "tuktuk",   label: () => "TukTuk" }
];
export function rendLineToggleHTML() {
  const line = _rendLine();
  // `data-line` además de `data-value`: el shell (quitar el chip de línea)
  // busca [data-act="setRendLine"][data-line="comb"].
  const seg = String(segmented({
    options: _RD_LINEAS.map(d => ({ value: d.value, label: d.label(), icon: d.icon })),
    value: line, act: "setRendLine", ariaLabel: t("rd.linea.aria")
  })).replace(/data-value="([a-z]+)"/g, 'data-value="$1" data-line="$1"');
  return `<div class="rd-toolbar">${seg}</div>`;
}
export async function setRendLine(line) {
  if (!line) return;
  if ((STATE.rendLine || "comb") === line) return;
  STATE.rendLine = line;
  // El scorecard "Fleet · Calidad y Dependencia" lee 6 columnas que el arranque
  // NO pide (ver TX_DEFERRED_COLS). Sin esperarlas, la tarjeta se pintaría con
  // ceros — que no se distinguen de un negocio con 0% de fraude. La precarga en
  // idle suele haberlas traído ya, así que en la práctica esto no espera nada.
  if (line === "fleet" && typeof ensureFullRendColumns === "function") {
    try { await ensureFullRendColumns(); } catch (e) { /* nunca bloquear el render */ }
    if ((STATE.rendLine || "comb") !== line) return;   // el usuario ya cambió de línea
  }
  renderRend();
}

// Guard de reentrancia: evita que dos renderRend() concurrentes se pisen.
// Si llega un segundo render mientras el primero corre, se descarta.
export let _renderRendBusy  = false;
// Token incremental: la cola de charts diferidos verifica este token. Si llega
// un nuevo renderRend, el pump de charts del render anterior se aborta.
export let _renderRendToken = 0;

export function renderRend() {
  if (_renderRendBusy) return;
  if (!STATE.rawData.length) return;
  // B12: con la escala recién cambiada (o la mensual restaurada al arrancar)
  // curMode ya dice "mensual" pero rawData sigue siendo el semanal hasta que
  // switchMode termina la carga. Pintar en ese hueco mostraba números semanales
  // bajo rótulos mensuales. Se muestra "cargando" y se reintenta solo.
  if (!escalaLista(STATE)) {
    _rendPintarCargandoEscala();
    reintentarCuandoEscalaLista("rend", STATE, renderRend, () => STATE.curTab === "rend");
    return;
  }
  _renderRendBusy  = true;
  _renderRendToken++;
  try {
    _renderRendImpl();
  } finally {
    _renderRendBusy = false;
  }
}

function _rendPintarCargandoEscala() {
  const empty   = document.getElementById("rendEmpty");
  const content = document.getElementById("rendContent");
  if (!content) return;
  if (empty) empty.style.display = "none";
  content.style.display = "";
  destroyAllCharts();
  content.innerHTML = `<div class="rd-view">${rendLineToggleHTML()}${emptyState({
    icon: "refresh", title: t("carga.escala", { e: t("mode." + (STATE.curMode || "semanal")) }) })}</div>`;
}

// Alcance de los filtros activos (I13). Vacío = sin recorte. Hoy el título y
// los chips de alcance los pinta el shell; se conserva para quien lo use.
export function _rendAlcance() {
  const f = getCurrentFilters();
  return partesAlcance({
    city: f.city, kam: kamLabel(f.kam),   // SIN_KAM → etiqueta traducida ("all" pasa igual)
    nSel: (f.selected || []).length,
    nTotal: document.querySelectorAll("#pList input").length
  }, t, cityLabel);
}

// Comparativa entre ciudades: valores absolutos o índice base 100 (ver
// _rdPintarCiudades). Estado de la sesión, no persistido.
let _rdCiudadModo = "indice";
let _rdCiudadData = null;

export function _renderRendImpl() {
  // Garantiza índices secundarios construidos (defensivo contra cache/races)
  ensureIndexes();

  // Destruir charts existentes ANTES de borrar sus DIVs con innerHTML
  // (evita instancias huérfanas y memory leak en cada re-render)
  destroyAllCharts();

  const line      = _rendLine();
  const filtered  = _rendLineFiltered();
  const apd       = aggPDc(filtered);
  const byDate    = aggDatec(filtered);
  const dates     = [...new Set(apd.map(r => r.date))].sort();
  const partners  = getSel();
  const empty     = document.getElementById("rendEmpty");
  const content   = document.getElementById("rendContent");

  // Sin partners seleccionados → empty global (mensaje de carga: aún no hay data en
  // memoria, o el usuario deschequeó todo).
  if (!partners.length) {
    empty.style.display   = "";
    content.style.display = "none";
    return;
  }
  // Agregador con partners seleccionados pero 0 filas en el filtro actual: NO es "falta
  // cargar data" (el empty global mentiría) — casi siempre Ciudad+KAM/partners sin overlap
  // (ej. Ciudad=Arequipa + KAM cuyos partners solo operan en Lima). Mensaje inline nombrando
  // la combinación exacta, mismo patrón que el empty de Fleet/TukTuk de abajo.
  if (!filtered.length && line === "agg") {
    empty.style.display   = "none";
    content.style.display = "";
    const f = getCurrentFilters();
    const partes = [];
    if (f.kam  !== "all") partes.push(t("alcance.kam", { k: kamLabel(f.kam) }));
    if (f.city !== "all") partes.push(cityLabel(f.city));
    content.innerHTML = _rdEmpty(t("rd.sinOverlap.titulo"),
      t("rd.sinOverlap.texto", { a: partes.length ? partes.join(" · ") : t("rd.filtrosActuales") }));
    return;
  }
  // Fleet/TukTuk sin datos para el filtro: mantener el toggle visible (para volver a
  // Agregador) + empty inline. NO usar el empty global (dejaría al usuario atrapado).
  if (!filtered.length) {
    empty.style.display   = "none";
    content.style.display = "";
    const lname = line === "fleet" ? "Fleet" : line === "comb" ? t("rend.lineaCombTxt") : "TukTuk";
    content.innerHTML = _rdEmpty(t("rd.sinDatosLinea.titulo", { l: lname }), t("rd.sinDatosLinea.texto"));
    return;
  }
  empty.style.display   = "none";
  content.style.display = "";

  // Cachear filtered por ciudad (se usa en la tabla por ciudad y en los charts)
  const filteredByCity = {};
  CITIES.forEach(city => {
    filteredByCity[city] = filtered.filter(r => r.city === city);
  });

  // lastDate = fecha "Hasta" del filtro
  const toDate   = document.getElementById("dateTo").value;
  const lastDate = dates.filter(d => d <= toDate).slice(-1)[0] || dates[dates.length - 1] || "";

  // prevDate = semana inmediatamente anterior a lastDate en TODOS los datos
  const allDates = STATE.allDates;
  const lastIdx  = allDates.indexOf(lastDate);
  const prevDate = lastIdx > 0 ? allDates[lastIdx - 1] : "";

  // prevRows: datos de prevDate fuera del rango filtrado
  const cityFilter = document.getElementById("cityFilter").value;
  const selSet     = new Set(getSel());
  const _sidebarSet = new Set(STATE.sidebarPartners || STATE.allPartners);
  // Lookup de la línea activa (agg usa _byDate; fleet/tk/comb filtran su slice).
  const _prevAll = _rendLinePrev(prevDate, null);
  const prevFiltered = _prevAll.filter(r =>
    (cityFilter === "all" || r.city === cityFilter) &&
    _lineSelHas(selSet, _sidebarSet, r.partner)
  );
  const prevAPD = aggPD(prevFiltered);

  // Fleet: vista SOLO de KPIs de flota (columnas fleet-scoped). El AD/SH/N+R a nivel
  // fleetroom mezcla actividad agregador+fleet del MISMO fleetroom → sería un falso
  // negativo. Solo se muestran owned cars / SH-auto interno / aceptación / branded,
  // que sí son columnas propias de la sub-flota. Se corta antes de las secciones
  // genéricas y del pump de charts.
  if (line === "fleet") {
    const fLastRows = filtered.filter(r => r.date === lastDate);
    content.innerHTML = _renderFleetView(fLastRows, prevFiltered, lastDate, prevDate);
    _scheduleFleetCharts(filtered, dates, fLastRows);
    return;
  }

  const lastRows = apd.filter(r => r.date === lastDate);
  const prevRows = prevAPD;

  const tAD = sumR(lastRows, r => r.activeDrivers);
  const pAD = sumR(prevRows, r => r.activeDrivers);
  const tNR = sumR(apd,      r => r.newPartner + r.newService + r.reactivated);
  const lNR = sumR(lastRows, r => r.newPartner + r.newService + r.reactivated);
  const pNR = sumR(prevRows, r => r.newPartner + r.newService + r.reactivated);
  const tSH = sumR(apd,      r => r.supplyHours);
  const lSH = sumR(lastRows, r => r.supplyHours);
  const pSH = sumR(prevRows, r => r.supplyHours);
  const tTR = sumR(apd,      r => r.trips || 0);
  const lTR = sumR(lastRows, r => r.trips || 0);
  const pTR = sumR(prevRows, r => r.trips || 0);

  const periodLabel = _rendPeriodLabel();
  let html = `<div class="rd-view">` + rendLineToggleHTML();

  // ── 1. KPIs del país (o del alcance filtrado) ─────────────────────────────
  // El valor de N+R/Horas/Viajes es el ACUMULADO del rango; el delta compara el
  // último período contra el anterior (igual que antes). El avance contra la meta
  // es el de la pestaña Metas para el mes del último período (ver _rendMetaMes).
  const metaInfo = _rendMetaMes(line, lastDate);
  const acum = t("rend.lbl.acumRango");
  html += _rdSec(t("rd.kpis.titulo"), t("rd.kpis.sub", { p: periodLabel, d: d2s(lastDate) }));
  html += `<div class="rd-kpis">
    ${_rdKpi({ label: t("metric.ad.label"), value: fmt(tAD), numKey: "rend.pais.ad", cur: tAD, prev: pAD, sub: periodLabel, goal: _rdGoal(metaInfo, "ad") })}
    ${_rdKpi({ label: t("metric.nr.label"), value: fmt(tNR), numKey: "rend.pais.nr", cur: lNR, prev: pNR, sub: acum, goal: _rdGoal(metaInfo, "nr") })}
    ${_rdKpi({ label: t("metric.sh.label"), value: fmt(tSH), numKey: "rend.pais.sh", cur: lSH, prev: pSH, sub: acum, goal: _rdGoal(metaInfo, "sh") })}
    ${_rdKpi({ label: t("metric.tr.label"), value: fmt(tTR), numKey: "rend.pais.tr", cur: lTR, prev: pTR, sub: acum,
               goal: metaInfo ? { pct: null, caption: t("rd.meta.sinMetaMensual") } : undefined })}
  </div>`;
  html += _rdGoalNota(metaInfo);

  // ── 1b. KPIs propios de TukTuk (Fleet tiene su vista dedicada arriba) ───────
  if (line === "tk") {
    html += _rendTkKPIs(filtered.filter(r => r.date === lastDate), prevFiltered, metaInfo);
  }

  // ── 2. Por ciudad (tabla compacta) ─────────────────────────────────────────
  const ciudades = [];
  CITIES.forEach(city => {
    const cr = filteredByCity[city];
    if (!cr.length) return;
    const ca   = aggPD(cr);
    const cL   = ca.filter(r => r.date === lastDate);
    // prevDate para ciudad, según la línea activa (agg usa índice; fleet/tk/comb su slice)
    const _cPrev = _rendLinePrev(prevDate, city);
    const cPraw = _cPrev.filter(r => _lineSelHas(selSet, _sidebarSet, r.partner));
    const cP   = aggPD(cPraw);
    ciudades.push({
      city,
      ad:  sumR(cL, r => r.activeDrivers),
      nr:  sumR(cL, r => r.newPartner + r.newService + r.reactivated),
      sh:  sumR(cL, r => r.supplyHours),
      tr:  sumR(cL, r => r.trips || 0),
      pad: sumR(cP, r => r.activeDrivers),
      pnr: sumR(cP, r => r.newPartner + r.newService + r.reactivated),
      psh: sumR(cP, r => r.supplyHours),
      ptr: sumR(cP, r => r.trips || 0)
    });
  });
  if (ciudades.length) {
    html += _rdSec(t("rend.ciudad.titulo"), t("rd.ciudad.sub", { p: periodLabel }));
    html += _rdCiudadTabla(ciudades);
  }

  // ── 3. Quién se movió (lo más accionable: a quién llamar) ──────────────────
  // Los 5 que más subieron y los 5 que más cayeron en Conductores Activos vs el
  // período anterior. Se excluyen los partners sin base previa (no es una caída,
  // es que no había con qué comparar).
  const prevByPartner = new Map();
  prevRows.forEach(r => prevByPartner.set(r.partner, (prevByPartner.get(r.partner) || 0) + r.activeDrivers));
  const nowByPartner = new Map();
  lastRows.forEach(r => nowByPartner.set(r.partner, (nowByPartner.get(r.partner) || 0) + r.activeDrivers));
  // Unión actual ∪ previo: un partner con base previa y SIN fila esta semana
  // (churn total, el caso más urgente de llamar) entra a "bajan" con −100% —
  // antes se iteraba solo lastRows y desaparecer del export lo hacía invisible.
  const movers = [...new Set([...nowByPartner.keys(), ...prevByPartner.keys()])].map(p => {
    const now  = nowByPartner.get(p)  || 0;
    const prev = prevByPartner.get(p) || 0;
    return { partner: p, now, prev, delta: now - prev,
             pct: prev > 0 ? ((now - prev) / prev) * 100 : null };
  }).filter(m => m.pct != null);
  const suben = movers.slice().sort((a, b) => b.delta - a.delta).filter(m => m.delta > 0).slice(0, 5);
  const bajan = movers.slice().sort((a, b) => a.delta - b.delta).filter(m => m.delta < 0).slice(0, 5);
  if (suben.length || bajan.length) {
    html += _rdSec(t("rend.mov.titulo"),
      t("rend.mov.sub", { d: prevDate ? d2s(prevDate) : t("rend.per.periodoAnterior") }));
    html += `<div class="rd-grid-2">
      ${_rdMovers(t("rd.mov.suben"), "trending-up", "good", suben, "+")}
      ${_rdMovers(t("rd.mov.bajan"), "trending-down", "bad", bajan, "−")}
    </div>`;
  }

  // ── 4. Por KAM (tabla: último período + acumulado del rango) ────────────────
  html += _rendKamSeccion(apd, lastRows, prevRows);

  // ── 5. Productividad ──────────────────────────────────────────────────────
  // Ratios, no volúmenes: responden "¿cada conductor rinde más o menos?", que es
  // una pregunta distinta de "¿tenemos más conductores?". Un mes puede crecer en
  // AD y caer en horas por conductor — sin estos ratios eso pasa desapercibido.
  const prodOf = rs => {
    const ad = sumR(rs, r => r.activeDrivers), sh = sumR(rs, r => r.supplyHours), tr = sumR(rs, r => r.trips || 0);
    return { shAd: ratio(sh, ad), trAd: ratio(tr, ad), trSh: ratio(tr, sh) };
  };
  const pNow = prodOf(lastRows), pPrev = prodOf(prevRows);
  html += _rdSec(t("rend.prod.titulo"), t("rend.prod.sub", { d: d2s(lastDate) }));
  html += `<div class="rd-kpis rd-kpis--3">
    ${_rdKpi({ label: t("rend.kpi.horasCond"),  value: fmt(pNow.shAd),        numKey: "rend.prod.shAd", cur: pNow.shAd, prev: pPrev.shAd, sub: t("rend.snapshotUlt") })}
    ${_rdKpi({ label: t("rend.kpi.viajesCond"), value: fmt(pNow.trAd),        numKey: "rend.prod.trAd", cur: pNow.trAd, prev: pPrev.trAd, sub: t("rend.snapshotUlt") })}
    ${_rdKpi({ label: t("rend.kpi.viajesHora"), value: pNow.trSh.toFixed(2),  numKey: "rend.prod.trSh", cur: pNow.trSh, prev: pPrev.trSh, sub: t("rend.snapshotUlt") })}
  </div>`;

  // ── 6. Tendencias ─────────────────────────────────────────────────────────
  // Perú por partner: top 8 por Conductores Activos del último período, sin
  // "Otros" dibujado (ni segundo eje): lo que queda fuera se dice en el pie.
  const partnersConDatos = [...new Set(apd.map(r => r.partner))];
  const top = rendTopPartners(dates, partnersConDatos, byDate);
  const ultima = dates[dates.length - 1];
  const pieTop = metric => {
    if (partnersConDatos.length <= top.length) return t("rd.tend.todos", { n: partnersConDatos.length });
    const topSet = new Set(top);
    const resto = partnersConDatos.filter(p => !topSet.has(p))
      .reduce((s, p) => s + (valorMetricaPartner(byDate, p, ultima, metric) || 0), 0);
    return t("rd.tend.pie", { k: top.length, n: partnersConDatos.length, x: metric === "tr" || metric === "sh" ? fmtSmart(resto) : fmt(resto) });
  };
  html += _rdSec(t("rend.tend.titulo"), t("rd.tend.sub"));
  html += `<div class="rd-grid-2">
    ${_rdChart("chP_ad", t("rend.ch.condActivos"), "AD_Peru", pieTop("ad"))}
    ${_rdChart("chP_nr", t("rend.ch.nuevosReact"), "NR_Peru", pieTop("nr"))}
    ${_rdChart("chP_sh", t("metric.sh.label"),     "SH_Peru", pieTop("sh"))}
    ${_rdChart("chP_tr", t("metric.tr.label"),     "Viajes_Peru", pieTop("tr"))}
  </div>`;

  // Comparativa entre ciudades: UNA gráfica por métrica con una línea por ciudad.
  // Lima es ~7 veces Trujillo/Arequipa: en valores absolutos las dos quedan
  // aplastadas contra el piso. Por defecto se muestra el ÍNDICE (primer período
  // del rango = 100), que compara RITMOS; "Valores" vuelve a las cifras. Se
  // eligió el índice y no small multiples (3 ciudades × 4 métricas = 12 gráficos)
  // porque cada render de ApexCharts bloquea 30-80 ms y la vista ya pasó de 16 a
  // 8 gráficos por eso; además el índice responde directo "¿qué ciudad crece más?".
  const citiesWithData = CITIES.filter(c => (filteredByCity[c] || []).length);
  if (citiesWithData.length) {
    const toggle = String(segmented({
      options: [{ value: "indice", label: t("rd.ciudad.indice") }, { value: "valores", label: t("rd.ciudad.valores") }],
      value: _rdCiudadModo, act: "setRendCiudadModo", ariaLabel: t("rd.ciudad.modoAria")
    }));
    html += _rdSec(t("rend.comparativaCiudad"), "", `<div class="rd-sec__right" id="rdCiudadModo">${toggle}</div>`);
    html += `<p class="rd-note" id="rdCiudadNota">${iconSvg("info", { size: 14 })}<span>${escapeHTML(_rdCiudadNota(dates))}</span></p>`;
    html += `<div class="rd-grid-2">
      ${_rdChart("chC_ad", t("rend.ch.condActivos"), "AD_Ciudades")}
      ${_rdChart("chC_nr", t("rend.ch.nuevosReact"), "NR_Ciudades")}
      ${_rdChart("chC_sh", t("metric.sh.label"),     "SH_Ciudades")}
      ${_rdChart("chC_tr", t("metric.tr.label"),     "Viajes_Ciudades")}
    </div>`;
  }

  // ── 7. Tabla ───────────────────────────────────────────────────────────────
  // Resumen de leads Yango para el encabezado
  const leadsSet  = new Set(apd.filter(r => r.date === lastDate && r.newService > 0).map(r => r.partner));
  const leadsNote = leadsSet.size > 0
    ? `<div class="rd-leads">${badge(t(leadsSet.size > 1 ? "rd.leadsN" : "rd.leads1", { n: leadsSet.size }), "info", { icon: "star" })}</div>`
    : "";
  html += _rdSec(t("rend.tabla.titulo"), t("rd.tabla.sub"), leadsNote);
  html += `<div class="ui-table-wrap ui-table-wrap--scroll rd-tabla-wrap"><div id="tblContainer"></div></div>`;

  // ── 8. Tarjetas por Partner ────────────────────────────────────────────────
  html += _rdSec(t("rend.cards.titulo"), t("rend.cards.sub"));
  html += `<div class="rd-pcards" id="partnerCards"></div>`;
  html += `</div>`;

  content.innerHTML = html;

  // Renders sincronos de tablas (datos, no charts) — relativamente baratos
  buildTable(apd, lastDate, prevDate, partners);
  buildPartnerCards(apd, lastDate, prevDate, partners, partners);

  // ── DIFERIR CHARTS con RAF ─────────────────────────────────────────────────
  // Cada ApexCharts.render() bloquea 30-80ms. Construir 8 en serie congela
  // el main thread ~400ms. Yieldeando entre cada uno: la UI aparece instantanea
  // y los charts pop-in progresivamente sin freezar inputs/scroll del usuario.
  const tokenAtSchedule = _renderRendToken;
  const tabTokenAtSched = STATE._tabRenderId;
  const chartJobs = [
    () => buildMultiLine("chP_ad", dates, partnersConDatos, byDate, "ad"),
    () => buildMultiLine("chP_nr", dates, partnersConDatos, byDate, "nr"),
    () => buildMultiLine("chP_sh", dates, partnersConDatos, byDate, "sh"),
    () => buildMultiLine("chP_tr", dates, partnersConDatos, byDate, "tr"),
  ];
  // Una gráfica por métrica con una serie por ciudad (ver el comentario en la
  // sección de comparativa): 4 renders en vez de 4 × nº de ciudades.
  _rdCiudadData = {
    dates,
    cities: citiesWithData,
    byDate: citiesWithData.map(c => aggCityDatec(filteredByCity[c], c))
  };
  ["ad", "nr", "sh", "tr"].forEach(metric => {
    chartJobs.push(() => _rdPintarCiudad(metric));
  });

  function pumpCharts(i) {
    if (i >= chartJobs.length) return;
    // Abort si otro renderRend arranco, cambio el tab, o salio de "rend"
    if (_renderRendToken !== tokenAtSchedule)   return;
    if (STATE._tabRenderId !== tabTokenAtSched) return;
    if (STATE.curTab !== "rend")                return;
    try { chartJobs[i](); } catch(e) { console.warn("Chart job", i, "failed:", e); }
    requestAnimationFrame(() => pumpCharts(i + 1));
  }
  requestAnimationFrame(() => pumpCharts(0));
}

// ── Comparativa por ciudad: valores / índice base 100 ────────────────────────
function _rdCiudadNota(dates) {
  return _rdCiudadModo === "indice"
    ? t("rd.ciudad.notaIndice", { d: dates && dates.length ? d2s(dates[0]) : "" })
    : t("rd.ciudad.notaValores");
}
function _rdPintarCiudad(metric) {
  const d = _rdCiudadData;
  if (!d || !d.cities.length) return;
  const tk = chartTokens();
  const series = d.cities.map((c, i) => {
    const vals = d.dates.map(dt => (d.byDate[i][dt] || {})[metric] || 0);
    return { name: cityLabel(c), data: _rdCiudadModo === "indice" ? indiceBase100(vals) : vals };
  });
  const colors = d.cities.map(c => seriesColor(_rdCityIdx(c), tk));
  const extra = _rdCiudadModo === "indice"
    ? { yaxis: { labels: { formatter: v => v == null ? "" : Math.round(v) } } }
    : undefined;
  buildLineChart("chC_" + metric, d.dates, series, colors, extra);
}
export function setRendCiudadModo(modo) {
  if (modo !== "indice" && modo !== "valores") return;
  if (_rdCiudadModo === modo) return;
  _rdCiudadModo = modo;
  document.querySelectorAll('#rdCiudadModo [data-act="setRendCiudadModo"]').forEach(b =>
    b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === modo)));
  const nota = document.querySelector("#rdCiudadNota span");
  if (nota && _rdCiudadData) nota.textContent = _rdCiudadNota(_rdCiudadData.dates);
  // Re-crear (no updateOptions): cambia el formato del eje Y.
  ["ad", "nr", "sh", "tr"].forEach(m => {
    const id = "chC_" + m;
    if (STATE.charts[id]) { try { STATE.charts[id].destroy(); } catch (e) {} delete STATE.charts[id]; }
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
    _rdPintarCiudad(m);
  });
}

// ── Tabla por ciudad ─────────────────────────────────────────────────────────
function _rdCiudadTabla(ciudades) {
  const conDelta = STATE.curMode !== "diario";
  const rows = ciudades.slice().sort((a, b) => b.ad - a.ad);
  const cols = [
    { k: "ad", l: t("metric.ad.label"), f: fmt,      p: "pad" },
    { k: "nr", l: t("metric.nr.label"), f: fmt,      p: "pnr" },
    { k: "sh", l: t("metric.sh.label"), f: fmt,      p: "psh" },
    { k: "tr", l: t("metric.tr.label"), f: fmtSmart, p: "ptr" }
  ];
  let h = `<div class="ui-table-wrap rd-tabla-compacta"><table class="ui-table rd-table">
    <thead><tr><th scope="col">${escapeHTML(t("rd.col.ciudad"))}</th>${cols.map(c =>
      `<th scope="col" class="ui-num">${escapeHTML(c.l)}</th>${conDelta ? `<th scope="col" class="rd-dcol"><span class="ui-sr-only">${escapeHTML(t("rd.col.delta", { m: c.l }))}</span>Δ</th>` : ""}`).join("")}</tr></thead><tbody>`;
  rows.forEach(r => {
    h += `<tr><th scope="row" class="rd-rowhead">${_rdDot(_rdCityVar(r.city))}${escapeHTML(cityLabel(r.city))}</th>` +
      cols.map(c => `<td class="ui-num"${dn("rend", "ciudad", c.k, r.city)}>${c.f(r[c.k])}</td>` +
        (conDelta ? `<td class="rd-dcol">${_rdDelta(r[c.k], r[c.p])}</td>` : "")).join("") + `</tr>`;
  });
  return h + `</tbody></table></div>`;
}

// ── Quién se movió ───────────────────────────────────────────────────────────
function _rdMovers(titulo, ico, tono, items, signo) {
  const filas = items.length
    ? items.map(m => `<li class="rd-mov__row">
        <span class="rd-mov__name">${_rdDot(STATE.partnerColors[m.partner] || "var(--cat-other)")}<span>${escapeHTML(m.partner)}</span></span>
        <span class="rd-mov__abs rd-mov__abs--${tono}">${signo}${fmt(Math.abs(m.delta))}</span>
        <span class="rd-mov__pct">${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(1)}%</span>
      </li>`).join("")
    : `<li class="rd-mov__vacio">${escapeHTML(t("rend.mov.sinMov"))}</li>`;
  return `<div class="ui-card rd-mov">
    <div class="rd-mov__head rd-mov__head--${tono}">${iconSvg(ico, { size: 16 })}<span>${escapeHTML(titulo)}</span></div>
    <ul class="rd-mov__list">${filas}</ul>
  </div>`;
}

// ── Por KAM ──────────────────────────────────────────────────────────────────
// Una fila por KAM con dos grupos de columnas:
//   · Último período (AD, N+R, Horas, Viajes + delta vs el anterior) — lo que
//     antes eran las tarjetas "Por KAM" (claves rend.kam.*).
//   · Acumulado del rango (N+R, Horas, Viajes) — el desglose que antes vivía
//     dentro de las tarjetas KPI del país (claves rend.pais-kam.*): suma el
//     valor grande de la tarjeta por construcción (B4, partición por KAM).
// Las dos familias tenían reglas de visibilidad distintas y se conservan tal
// cual: rend.kam.* solo para KAMs con filas en el último período (y respetando
// el filtro de KAM); rend.pais-kam.<m> cuando el valor o su previo no es cero.
// El AD del último período es la misma cifra en las dos familias: la celda lleva
// las dos claves anidadas.
function _rendKamSeccion(apd, lastRows, prevRows) {
  const kamFilterVal = document.getElementById("kamFilter")?.value || "all";
  const kLastBy = particionarPorKam(lastRows, _lineKamOf);
  const kPrevBy = particionarPorKam(prevRows, _lineKamOf);
  const kAllBy  = particionarPorKam(apd, _lineKamOf);
  const gv = (rows, m) =>
    m === "nr" ? sumR(rows, r => r.newPartner + r.newService + r.reactivated)
    : m === "sh" ? sumR(rows, r => r.supplyHours)
    : m === "tr" ? sumR(rows, r => r.trips || 0)
    : sumR(rows, r => r.activeDrivers);
  const kams = ordenarKams([...kLastBy.keys(), ...kAllBy.keys(), ...kPrevBy.keys()], SIN_KAM);
  const filas = [];
  kams.forEach(kam => {
    const kl = kLastBy.get(kam) || [], kp = kPrevBy.get(kam) || [], ka = kAllBy.get(kam) || [];
    const enSeccion = !!kl.length && (kamFilterVal === "all" || kam === kamFilterVal);
    const pais = {};
    if (kl.length || ka.length || kp.length) {
      ["ad", "nr", "sh", "tr"].forEach(m => {
        const kv = gv(m === "ad" ? kl : ka, m), kpv = gv(kp, m);
        pais[m] = !!(kv || kpv);   // un KAM en 0 con previo >0 ES noticia
      });
    }
    if (!enSeccion && !Object.values(pais).some(Boolean)) return;
    filas.push({
      kam, enSeccion, pais,
      ad: gv(kl, "ad"), nr: gv(kl, "nr"), sh: gv(kl, "sh"), tr: gv(kl, "tr"),
      pad: gv(kp, "ad"), pnr: gv(kp, "nr"), psh: gv(kp, "sh"), ptr: gv(kp, "tr"),
      anr: gv(ka, "nr"), ash: gv(ka, "sh"), atr: gv(ka, "tr")
    });
  });
  if (!filas.length) return "";
  filas.sort((a, b) => (a.kam === SIN_KAM) - (b.kam === SIN_KAM) || b.ad - a.ad || a.kam.localeCompare(b.kam));

  // Valor y variación en la MISMA celda (la variación va a la derecha de la
  // cifra): con 12 columnas la tabla no entraba al lado del panel de filtros.
  // El data-num va en el <span> de la cifra, no en la celda.
  let h = _rdSec(t("rend.kam.titulo"), t("rd.kam.sub", { p: _rendPeriodLabel() }));
  h += `<div class="ui-table-wrap rd-tabla-compacta"><table class="ui-table rd-table rd-table--kam">
    <thead>
      <tr class="rd-thgroup"><th></th><th colspan="4" scope="colgroup">${escapeHTML(_rendPeriodLabel())}</th><th colspan="3" scope="colgroup" class="rd-thgroup--acum">${escapeHTML(t("rd.kam.acum"))}</th></tr>
      <tr><th scope="col">KAM</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.ad.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.nr.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.sh.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.tr.short"))}</th>
        <th scope="col" class="ui-num rd-acum">${escapeHTML(t("metric.nr.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.sh.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.tr.short"))}</th>
      </tr>
    </thead><tbody>`;
  filas.forEach(r => {
    const k = r.kam;
    // AD: clave(s) anidadas; la cifra es una sola.
    let adCell = fmt(r.ad);
    if (r.pais.ad) adCell = `<span${dn("rend", "pais-kam", "ad", k)}>${adCell}</span>`;
    if (r.enSeccion) adCell = `<span${dn("rend", "kam", "ad", k)}>${adCell}</span>`;
    const conD = (html, m, p) => {
      const d = _rdDelta(r[m], r[p]);
      return `<td class="ui-num"><span class="rd-vd">${html}${d ? `<span class="rd-vd__d">${d}</span>` : ""}</span></td>`;
    };
    const ult = (m, f) => r.enSeccion ? `<span${dn("rend", "kam", m, k)}>${f(r[m])}</span>` : f(r[m]);
    const acu = (m, v, extra = "") => `<td class="ui-num${extra}"${r.pais[m] ? dn("rend", "pais-kam", m, k) : ""}>${fmt(v)}</td>`;
    h += `<tr><th scope="row" class="rd-rowhead">${_rdDot(_rdKamVar(k))}${escapeHTML(kamLabel(k))}</th>
      ${conD(adCell, "ad", "pad")}
      ${conD(ult("nr", fmt), "nr", "pnr")}
      ${conD(ult("sh", fmt), "sh", "psh")}
      ${conD(ult("tr", fmtSmart), "tr", "ptr")}
      ${acu("nr", r.anr, " rd-acum")}${acu("sh", r.ash)}${acu("tr", r.atr)}
    </tr>`;
  });
  return h + `</tbody></table></div>`;
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
export function buildTable(apd, lastDate, prevDate, sel) {
  const selSet = new Set(sel);
  const lR    = apd.filter(r => r.date === lastDate);
  // El período previo DEBE pasar por el mismo filtro de ciudad que `apd` (que
  // ya viene acotado por el sidebar): sin esto, con Ciudad=Lima la columna WoW
  // comparaba Lima actual vs TODAS las ciudades previo → caídas falsas.
  const _cityF = document.getElementById("cityFilter")?.value || "all";
  const _pAll = _rendLinePrev(prevDate, null);
  const pRraw = _pAll.filter(r =>
    (_cityF === "all" || r.city === _cityF) && selSet.has(r.partner));
  const pR    = aggPD(pRraw);
  // Historia completa (todas las fechas) para detectar declive, ignorando el rango.
  // Agregador cachea en STATE._apdFull; Fleet/TukTuk recomputan del slice (arrays chicos).
  let apdFullBase;
  if (_rendLine() === "agg") {
    if (!STATE._apdFull) STATE._apdFull = aggPD(STATE.rawData);
    apdFullBase = STATE._apdFull;
  } else {
    apdFullBase = aggPD(_rendLineDataset());
  }
  const apdFull = apdFullBase.filter(r => selSet.has(r.partner));
  const partners = [...new Set(apd.map(r => r.partner))];

  // Pre-indexar lR, pR y apd por partner UNA vez. Reemplaza 3 filter()
  // O(n) por partner = O(n × partners) → O(1) lookup por partner.
  const lByPartner    = new Map();
  const prByPartner   = new Map();
  const apdByPartner  = new Map();
  const apdFullByPartner = new Map();
  const push = (m, r) => { let a = m.get(r.partner); if (!a) { a = []; m.set(r.partner, a); } a.push(r); };
  lR.forEach(r => push(lByPartner, r));
  pR.forEach(r => push(prByPartner, r));
  apd.forEach(r => push(apdByPartner, r));
  apdFull.forEach(r => push(apdFullByPartner, r));

  STATE.curSummaries = partners.map(p => {
    const l    = lByPartner.get(p) || [];
    const pr   = prByPartner.get(p) || [];
    const rows = (apdByPartner.get(p) || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    return {
      partner:      p,
      kam:          (l[0] || {}).kam || "",
      ad:           sumR(l,  r => r.activeDrivers),
      nr:           sumR(l,  r => r.newPartner + r.newService + r.reactivated),
      sh:           sumR(l,  r => r.supplyHours),
      tr:           sumR(l,  r => r.trips || 0),
      co:           sumR(l,  r => r.commission),
      ns:           sumR(l,  r => r.newService),
      pad:          sumR(pr, r => r.activeDrivers),
      pnr:          sumR(pr, r => r.newPartner + r.newService + r.reactivated),
      ptr:          sumR(pr, r => r.trips || 0),
      adSerie:      rows.map(r => r.activeDrivers),
      declineAlert: hasConsecutiveDecline(apdFullByPartner, p)
    };
  });
  renderTable();
}

// Columnas ordenables de la tabla de partners. sortTbl mapea por ÍNDICE de <th>
// (colKeys): tiene que seguir este mismo orden.
const _RD_TBL_COLS = [
  { k: "partner", l: () => t("rend.col.partner") },   { k: "kam", l: () => t("sidebar.kam") },
  { k: "ad", l: () => t("metric.ad.short"), num: 1 },  { k: "nr", l: () => t("metric.nr.short"), num: 1 },
  { k: "sh", l: () => t("metric.sh.short"), num: 1 },  { k: "tr", l: () => t("metric.tr.short"), num: 1 },
  { k: "co", l: () => t("rend.col.comision"), num: 1 },{ k: "ns", l: () => t("rend.col.leads"), num: 1 }
];
function _rdSortAttrs(k) {
  const on = STATE.tblSort.col === k;
  const dir = on ? (STATE.tblSort.dir === "asc" ? "ascending" : "descending") : "none";
  return { cls: on ? (STATE.tblSort.dir === "asc" ? "sa" : "sd") : "", aria: dir };
}
export function renderTable() {
  const sorted = STATE.curSummaries.slice().sort((a, b) => {
    const va = a[STATE.tblSort.col], vb = b[STATE.tblSort.col];
    if (typeof va === "string")
      return STATE.tblSort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return STATE.tblSort.dir === "asc" ? va - vb : vb - va;
  });

  let h = `<table class="ui-table ui-table--sticky-first rd-table rd-table--partners"><thead><tr>`;
  _RD_TBL_COLS.forEach(c => {
    const s = _rdSortAttrs(c.k);
    h += `<th scope="col" class="rd-sortable${c.num ? " ui-num" : ""}${s.cls ? " " + s.cls : ""}" aria-sort="${s.aria}" data-act="sortTbl" data-act-keydown="sortTblKey" data-col="${escapeHTML(c.k)}" tabindex="0">` +
      `<span class="rd-th">${escapeHTML(c.l())}${iconSvg("chevron-down", { size: 12, className: "rd-sort-ico" })}</span></th>`;
  });
  h += `<th scope="col" class="rd-dcol">${escapeHTML(t("rd.col.wow"))}</th><th scope="col" class="rd-center">${escapeHTML(t("rd.col.tend"))}</th></tr></thead><tbody>`;

  sorted.forEach(r => {
    const alertBd = r.declineAlert
      ? `<span class="rd-alert" title="${escapeHTML(t("rend.declive", { n: STATE.declineThreshold, m: STATE.declineMetric === "activeDrivers" ? t("rend.lbl.activos") : STATE.declineMetric === "supplyHours" ? t("rend.declive.horas") : "N+R" }))}">${iconSvg("alert-triangle", { size: 14, label: t("rd.declive") })}</span>`
      : "";
    const nsCell  = r.ns > 0
      ? `<span class="ui-badge ui-badge--info rd-leads-badge" title="${escapeHTML(t("rend.recibeLeads"))}">★ ${fmt(r.ns)}</span>`
      : `<span class="rd-muted">${fmt(r.ns)}</span>`;
    h += `<tr data-partner="${escapeHTML(r.partner)}">
      <th scope="row" class="rd-rowhead">${_rdDot(STATE.partnerColors[r.partner] || "var(--cat-other)")}${alertBd}<span>${escapeHTML(r.partner)}</span></th>
      <td class="rd-kamcell">${_rdDot(_rdKamVar(r.kam))}${escapeHTML(kamLabel(r.kam))}</td>
      <td class="ui-num"${dn("rend", "tabla", "ad", r.partner)}>${fmt(r.ad)}</td><td class="ui-num"${dn("rend", "tabla", "nr", r.partner)}>${fmt(r.nr)}</td>
      <td class="ui-num"${dn("rend", "tabla", "sh", r.partner)}>${fmt(r.sh)}</td><td class="ui-num"${dn("rend", "tabla", "tr", r.partner)}>${fmtSmart(r.tr)}</td>
      <td class="ui-num"${dn("rend", "tabla", "co", r.partner)}>${fmtK(r.co)}</td>
      <td class="ui-num"${dn("rend", "tabla", "ns", r.partner)}>${nsCell}</td>
      <td class="rd-dcol">${_rdDelta(r.ad, r.pad)}</td>
      <td class="rd-center">${_rdTrend(r.adSerie || [])}</td>
    </tr>`;
  });
  h += `</tbody></table>`;
  const el = document.getElementById("tblContainer");
  if (el) el.innerHTML = h;
}

export function sortTbl(col) {
  if (STATE.tblSort.col === col)
    STATE.tblSort.dir = STATE.tblSort.dir === "asc" ? "desc" : "asc";
  else { STATE.tblSort.col = col; STATE.tblSort.dir = "desc"; }

  // Intentar reordenar filas existentes sin reconstruir el HTML
  const tbody = document.querySelector("#tblContainer tbody");
  if (!tbody || !STATE.curSummaries.length) { renderTable(); return; }

  const dir = STATE.tblSort.dir === "asc" ? 1 : -1;
  const k   = STATE.tblSort.col;
  const sorted = STATE.curSummaries.slice().sort((a, b) => {
    const av = a[k], bv = b[k];
    return (typeof av === "string" ? av.localeCompare(bv) : (av - bv)) * dir;
  });

  // Actualizar indicadores de orden en cabeceras.
  // Mismo orden que _RD_TBL_COLS en renderTable: se mapea por ÍNDICE de <th>.
  const colKeys = ["partner","kam","ad","nr","sh","tr","co","ns"];
  document.querySelectorAll("#tblContainer thead th").forEach((th, i) => {
    if (i < colKeys.length) {
      const s = _rdSortAttrs(colKeys[i]);
      th.classList.remove("sa", "sd");
      if (s.cls) th.classList.add(s.cls);
      th.setAttribute("aria-sort", s.aria);
    }
  });

  // Reordenar <tr> existentes vía DocumentFragment (cero re-parse de HTML)
  const rowMap = new Map(
    [...tbody.querySelectorAll("tr")].map(tr => [tr.dataset.partner, tr])
  );
  const frag = document.createDocumentFragment();
  sorted.forEach(s => { const tr = rowMap.get(s.partner); if (tr) frag.appendChild(tr); });
  tbody.appendChild(frag);
}

// ── PARTNER CARDS ─────────────────────────────────────────────────────────────
export function buildPartnerCards(apd, lastDate, prevDate, partners, sel) {
  const grid = document.getElementById("partnerCards");
  if (!grid) return;

  const selSet  = new Set(sel);
  // Mismo fix que buildTable: el previo respeta el filtro de ciudad activo,
  // si no los badges WoW de las tarjetas comparan universos distintos.
  const _cityF = document.getElementById("cityFilter")?.value || "all";
  const _pdAll = _rendLinePrev(prevDate, null);
  const prevRaw = _pdAll.filter(r =>
    (_cityF === "all" || r.city === _cityF) && selSet.has(r.partner));
  const prevAPD = aggPD(prevRaw);

  // Pre-indexar apd y prevAPD por partner una sola vez.
  const apdByPartner = new Map();
  const prevByPartner = new Map();
  for (const r of apd) {
    let a = apdByPartner.get(r.partner);
    if (!a) { a = []; apdByPartner.set(r.partner, a); }
    a.push(r);
  }
  for (const r of prevAPD) prevByPartner.set(r.partner, r);

  let html = "";
  partners.forEach(partner => {
    const rows = (apdByPartner.get(partner) || [])
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return;
    // B5 (sep-2026): antes era rows[rows.length - 1] — la ÚLTIMA fila del
    // partner, aunque fuera de un período anterior a lastDate. Un partner que
    // dejó de reportar mostraba un dato viejo rotulado como el del período
    // actual. Ahora es la fila de lastDate; sin ella, "—" (sin dato), no el viejo.
    const last    = rows.find(r => r.date === lastDate) || null;
    const prevRow = prevByPartner.get(partner) || null;
    // KAM efectivo (misma precedencia que el resto de la vista), no el que
    // traía la fila del Excel.
    const kam     = _lineKamOf(rows[rows.length - 1]);
    const v       = k => last ? fmt(last[k]) : "—";
    const cur     = k => last ? last[k] : null;

    const lastNR = last ? last.newPartner + last.newService + last.reactivated : null;
    const prevNR = prevRow ? prevRow.newPartner + prevRow.newService + prevRow.reactivated : null;
    const sub = (lbl, k) => `<div class="rd-pcard__sub">
      <div class="rd-pcard__sublbl">${escapeHTML(lbl)}</div>
      <div class="rd-pcard__subval">${v(k)}</div>${_rdDelta(cur(k), prevRow?.[k] ?? null)}
    </div>`;
    html += `<div class="ui-card rd-pcard">
      <div class="rd-pcard__head">
        <div class="rd-pcard__name">${_rdDot(STATE.partnerColors[partner] || "var(--cat-other)")}<span>${escapeHTML(partner)}</span></div>
        <div class="rd-pcard__meta">${_rdDot(_rdKamVar(kam))}${escapeHTML(kamLabel(kam))} · ${prevRow ? d2s(prevDate) + " → " : ""}${d2s(lastDate)}${last ? "" : ` · <em>${escapeHTML(t("rend.pcard.sinDato"))}</em>`}</div>
      </div>
      <div class="rd-pcard__kpis">
        <div class="rd-pcard__kpi">
          <div class="rd-pcard__lbl">${escapeHTML(t("metric.ad.short"))}</div>
          <div class="rd-pcard__val">${v("activeDrivers")}</div>
          <div class="rd-pcard__foot">${_rdDelta(cur("activeDrivers"), prevRow?.activeDrivers ?? null)}${_rdTrend(rows.map(r => r.activeDrivers))}</div>
        </div>
        <div class="rd-pcard__kpi">
          <div class="rd-pcard__lbl">${escapeHTML(t("metric.sh.short"))}</div>
          <div class="rd-pcard__val">${v("supplyHours")}</div>
          <div class="rd-pcard__foot">${_rdDelta(cur("supplyHours"), prevRow?.supplyHours ?? null)}${_rdTrend(rows.map(r => r.supplyHours))}</div>
        </div>
      </div>
      <div class="rd-pcard__nr">
        <div class="rd-pcard__lbl rd-pcard__lbl--row">${escapeHTML(t("metric.nr.label"))} ${_rdDelta(lastNR, prevNR)}${_rdTrend(rows.map(r => r.newPartner + r.newService + r.reactivated))}</div>
        <div class="rd-pcard__subs">
          ${sub(t("rd.pcard.partner"), "newPartner")}
          ${sub(t("rd.pcard.servicio"), "newService")}
          ${sub(t("rd.pcard.reactivados"), "reactivated")}
        </div>
      </div>
    </div>`;
  });
  grid.innerHTML = html; // un solo reflow al final
}

// Suma/pondera KPIs Fleet sobre filas crudas (una por fleetroom-ciudad de una fecha).
// SH/Auto interno = Σ internalFleetSh / Σ ownedFleetActiveCars; Aceptación = Σ(rate×trips)/Σtrips
// (mismas fórmulas que presentacion2.p2FleetSeries). Cars/Branded = snapshots sumados.
// Revenue/productividad (gmv, comisión, tripsPerHour, moneyPerHour) se recalculan EXACTOS
// desde las sumas crudas (gmv, trips, SH) — no se reusa la columna-ratio precalculada por
// fila, para no perder precisión al agregar varias filas (misma lección que
// excel-upload-full-precision: sumar crudo, no promediar ratios ya redondeados).
// Calidad/riesgo/dependencia (fraude, mal calificados, completion, subsidio, soporte,
// % SH externo) SÍ son shares sin numerador/denominador propio en la BD → se ponderan
// por trips (o por gmv en el caso de subsidio) igual que Aceptación.
export function _rendFleetAgg(rows) {
  let owned = 0, intSh = 0, extSh = 0, trips = 0, branded = 0, actCars = 0,
      gmv = 0, commission = 0;
  // Tasas: una fila sin el dato queda fuera del numerador Y del denominador
  // (ver tasaAcum en domain/metrics) — si no, diluye el promedio hacia 0.
  const acc = tasaAcum(), fraud = tasaAcum(), badRated = tasaAcum(),
        compl = tasaAcum(), support = tasaAcum(), subsidy = tasaAcum();
  rows.forEach(r => {
    owned      += r.ownedFleetActiveCars || 0;
    intSh      += r.internalFleetSh || 0;
    extSh      += r.externalFleetSh || 0;
    trips      += r.trips || 0;
    branded    += r.brandedActiveCars || 0;
    actCars    += r.activeCars || 0;
    gmv        += r.gmv || 0;
    commission += r.commission || 0;
    sumarTasa(acc,      r.acceptanceRate,             r.trips);
    sumarTasa(fraud,    r.fraudTripsShare,            r.trips);
    sumarTasa(badRated, r.badRatedTripsShare,         r.trips);
    sumarTasa(compl,    r.completionRate,             r.trips);
    sumarTasa(support,  r.driverSupportRequestsShare, r.trips);
    sumarTasa(subsidy,  r.driverSubsidiesByGmv,       r.gmv);
  });
  const totalSh = intSh + extSh;
  // Sin base → null ("—" en pantalla), no 0: un 0 se lee como un dato real.
  const div = (n, d) => d > 0 ? n / d : null;
  const pct = a => { const v = leerTasa(a); return v == null ? null : v * 100; };
  return {
    owned, branded, actCars, gmv, commission,
    shCar:            div(intSh, owned),
    accept:           pct(acc),
    pctBranded:       owned > 0 ? (branded / owned) * 100 : null,
    gmvPerCar:        div(gmv, owned),
    commissionPerCar: div(commission, owned),
    tripsPerCar:      div(trips, owned),
    tripsPerHour:     div(trips, totalSh),
    moneyPerHour:     div(gmv, totalSh),
    externalShShare:  totalSh > 0 ? (extSh / totalSh) * 100 : null,
    fraudShare:       pct(fraud),
    badRatedShare:    pct(badRated),
    completionRate:   pct(compl),
    supportReqShare:  pct(support),
    subsidyByGmv:     pct(subsidy)
  };
}
// Agrega KPIs Fleet por fecha (Peru total, todas las ciudades) — mismas fórmulas
// que _rendFleetAgg, indexadas por fecha. Insumo de los charts de Tendencias.
export function _fleetAggByDate(rows) {
  const m = new Map();
  rows.forEach(r => { let a = m.get(r.date); if (!a) { a = []; m.set(r.date, a); } a.push(r); });
  const out = {};
  m.forEach((rs, d) => { out[d] = _rendFleetAgg(rs); });
  return out;
}
// Línea de un KPI de flota (Peru total) a lo largo del rango filtrado (no solo el
// último período — a diferencia de las tarjetas/tabla, que son snapshot).
const _FLEET_TREND_KEY = {
  owned: "rd.fleet.ch.owned", shCar: "rd.fleet.ch.shCar", accept: "rd.fleet.ch.accept",
  branded: "rd.fleet.ch.branded", gmvPerCar: "rd.fleet.ch.gmvCar", externalShShare: "rd.fleet.ch.extSh"
};
export function buildFleetTrendLine(elId, dates, byDate, key, color) {
  // null (tasa sin base) queda como hueco en la línea, no como un punto en 0.
  const data = dates.map(d => { const v = byDate[d] ? byDate[d][key] : 0; return v == null ? null : (v || 0); });
  buildLineChart(elId, dates, [{ name: _FLEET_TREND_KEY[key] ? t(_FLEET_TREND_KEY[key]) : key, data }], [color]);
}
// Donut "Owned Cars por Partner" — snapshot del último período, Top 6 + Otros.
// Parts-of-whole (dónde se concentra la flota) → donut es la elección correcta,
// no una línea (no es serie de tiempo).
export function _buildFleetOwnedDonut(lastRows) {
  const byP = new Map();
  lastRows.forEach(r => {
    const v = r.ownedFleetActiveCars || 0;
    if (!v) return;
    byP.set(r.partner, (byP.get(r.partner) || 0) + v);
  });
  const sorted  = [...byP.entries()].sort((a, b) => b[1] - a[1]);
  const TOP     = 6;
  const top     = sorted.slice(0, TOP);
  const restSum = sumR(sorted.slice(TOP), ([, v]) => v);
  const tk      = chartTokens();
  const labels  = top.map(([p]) => p);
  const series  = top.map(([, v]) => v);
  const colors  = top.map((_, i) => seriesColor(i, tk));
  if (restSum > 0) { labels.push(t("rd.otros")); series.push(restSum); colors.push(tk.other); }
  buildDonutChart("chF_ownedDonut", labels, series, colors);
}
// Donut "Brandeados vs No Brandeados" — snapshot del último período, Peru total.
export function _buildFleetBrandedDonut(lastRows) {
  const agg = _rendFleetAgg(lastRows);
  const noBranded = Math.max(agg.owned - agg.branded, 0);
  const tk = chartTokens();
  buildDonutChart("chF_brandedDonut", [t("rd.fleet.brandeados"), t("rd.fleet.noBrandeados")], [agg.branded, noBranded], [seriesColor(0, tk), tk.other]);
}
// Programa los charts de Fleet (tendencias + composición) diferidos con RAF — mismo
// patrón anti-freeze que pumpCharts() de Agregador. Aborta si cambia filtro/tab/línea
// mientras corre (evita pintar charts sobre un render ya obsoleto).
export function _scheduleFleetCharts(filtered, dates, lastRows) {
  const tokenAtSchedule = _renderRendToken;
  const tabTokenAtSched = STATE._tabRenderId;
  const byDate = _fleetAggByDate(filtered);
  const tk = chartTokens();
  const keys = ["owned", "shCar", "accept", "branded", "gmvPerCar", "externalShShare"];
  const ids  = ["chF_owned", "chF_shcar", "chF_accept", "chF_branded", "chF_gmvcar", "chF_extsh"];
  const jobs = keys.map((k, i) => () => buildFleetTrendLine(ids[i], dates, byDate, k, seriesColor(i, tk)));
  jobs.push(() => _buildFleetOwnedDonut(lastRows), () => _buildFleetBrandedDonut(lastRows));
  function pump(i) {
    if (i >= jobs.length) return;
    if (_renderRendToken !== tokenAtSchedule)   return;
    if (STATE._tabRenderId !== tabTokenAtSched) return;
    if (STATE.curTab !== "rend")                return;
    try { jobs[i](); } catch (e) { console.warn("Fleet chart job", i, "failed:", e); }
    requestAnimationFrame(() => pump(i + 1));
  }
  requestAnimationFrame(() => pump(0));
}
// Vista Fleet completa (SOLO KPIs de flota): Perú general + por ciudad + por partner.
// lastRows/prevRows = filas CRUDAS de sub-flotas Fleet (una por fleetroom-ciudad) del
// último período y del anterior. NO se usan AD/SH/N+R (mezclados a nivel fleetroom).
export function _renderFleetView(lastRows, prevRows, lastDate, _prevDate) {
  const periodLabel = _rendPeriodLabel();
  let html = `<div class="rd-view">` + rendLineToggleHTML();
  const c = _rendFleetAgg(lastRows), p = _rendFleetAgg(prevRows);
  const metaInfo = _rendMetaMes("fleet", lastDate);

  // Perú general (10 KPIs de flota: presencia/calidad + revenue/productividad)
  html += _rdSec(t("rd.fleet.kpis"), t("rend.fleet.peruSub", { p: periodLabel }));
  html += _rdFleetKpis(c, p, metaInfo);
  html += _rdGoalNota(metaInfo);

  // Por ciudad (tabla)
  const ciudades = CITIES.filter(city => lastRows.some(r => r.city === city)).map(city => ({
    city, c: _rendFleetAgg(lastRows.filter(r => r.city === city)),
    p: _rendFleetAgg(prevRows.filter(r => r.city === city))
  }));
  if (ciudades.length) {
    html += _rdSec(t("rend.fleet.ciudad"), t("rend.fleet.ciudadSub"));
    html += _rdFleetCiudadTabla(ciudades);
  }

  // Calidad y dependencia (métricas de riesgo/madurez, secundarias)
  const pct = v => fmt(v) + "%";
  html += _rdSec(t("rend.fleet.calidad"), t("rend.fleet.calidadSub", { p: periodLabel }));
  html += _rendFleetScorecard([
    { label: t("rend.fleet.shExterno"), key: "externalShShare", val: c.externalShShare, prev: p.externalShShare, fmtFn: pct, invert: true },
    { label: t("rend.fleet.fraude"),    key: "fraudShare",      val: c.fraudShare,      prev: p.fraudShare,      fmtFn: pct, invert: true },
    { label: t("rend.fleet.malCalif"),  key: "badRatedShare",   val: c.badRatedShare,   prev: p.badRatedShare,   fmtFn: pct, invert: true },
    { label: t("rd.fleet.completion"),  key: "completionRate",  val: c.completionRate,  prev: p.completionRate,  fmtFn: pct },
    { label: t("rend.fleet.subsidio"),  key: "subsidyByGmv",    val: c.subsidyByGmv,    prev: p.subsidyByGmv,    fmtFn: pct },
    { label: t("rend.fleet.soporte"),   key: "supportReqShare", val: c.supportReqShare, prev: p.supportReqShare, fmtFn: pct, invert: true }
  ]);

  // Tendencias (línea, Perú total, evolución del rango filtrado)
  html += _rdSec(t("rend.fleet.tend"), t("rend.fleet.tendSub"));
  html += `<div class="rd-grid-2">
    ${_rdChart("chF_owned",   t("rd.fleet.ch.owned"),   "Fleet_OwnedCars")}
    ${_rdChart("chF_shcar",   t("rd.fleet.ch.shCar"),   "Fleet_SHAuto")}
    ${_rdChart("chF_accept",  t("rd.fleet.ch.accept"),  "Fleet_Aceptacion")}
    ${_rdChart("chF_branded", t("rd.fleet.ch.branded"), "Fleet_Branded")}
    ${_rdChart("chF_gmvcar",  t("rd.fleet.ch.gmvCar"),  "Fleet_GMVporAuto")}
    ${_rdChart("chF_extsh",   t("rd.fleet.ch.extSh"),   "Fleet_PctSHExterno")}
  </div>`;

  // Composición (donut, snapshot del último período)
  html += _rdSec(t("rend.fleet.comp"), t("rend.fleet.compSub", { d: d2s(lastDate) }));
  html += `<div class="rd-grid-2">
    ${_rdChart("chF_ownedDonut",   t("rend.fleet.ownedDonut"), "Fleet_OwnedPorPartner")}
    ${_rdChart("chF_brandedDonut", t("rend.fleet.brandDonut"), "Fleet_Brandeados")}
  </div>`;

  // Por partner (tabla)
  html += _rdSec(t("rend.fleet.partner"), t("rend.fleet.partnerSub"));
  html += _rendFleetPartnerTable(lastRows, prevRows);
  return html + `</div>`;
}
function _rdFleetKpis(c, p, metaInfo) {
  // Las tasas/ratios pueden venir en null (sin base): "—", nunca "0".
  const num = v => v == null ? "—" : fmt(v);
  const pct = v => v == null ? "—" : fmt(v) + "%";
  const snap = t("rend.snapshotUlt");
  const k = (label, val, prev, f, numKey, goal) => _rdKpi({ label, value: f(val), numKey, cur: val, prev, sub: snap, goal });
  return `<div class="rd-kpis rd-kpis--auto">
    ${k(t("rend.kpi.ownedCars"),   c.owned,            p.owned,            fmt, "rend.fleet.owned")}
    ${k(t("rend.kpi.shAuto"),      c.shCar,            p.shCar,            num, "rend.fleet.shCar", _rdGoal(metaInfo, "shCar"))}
    ${k(t("rend.kpi.aceptacion"),  c.accept,           p.accept,           pct, "rend.fleet.accept", _rdGoal(metaInfo, "accept"))}
    ${k(t("rend.kpi.brandedCars"), c.branded,          p.branded,          fmt, "rend.fleet.branded")}
    ${k(t("rend.kpi.pctBrand"),    c.pctBranded,       p.pctBranded,       pct, "rend.fleet.pctBranded")}
    ${k(t("rend.kpi.gmvAuto"),     c.gmvPerCar,        p.gmvPerCar,        num, "rend.fleet.gmvPerCar")}
    ${k(t("rend.kpi.comAuto"),     c.commissionPerCar, p.commissionPerCar, num, "rend.fleet.commissionPerCar")}
    ${k(t("rend.kpi.viajesAuto"),  c.tripsPerCar,      p.tripsPerCar,      num, "rend.fleet.tripsPerCar")}
    ${k(t("rd.kpi.viajesHora"),    c.tripsPerHour,     p.tripsPerHour,     num, "rend.fleet.tripsPerHour")}
    ${k(t("rend.kpi.gmvHora"),     c.moneyPerHour,     p.moneyPerHour,     num, "rend.fleet.moneyPerHour")}
  </div>`;
}
// Scorecard compacto de calidad/riesgo: una tabla label · valor · delta (se
// leen mejor como checklist que como 6 tarjetas grandes).
export function _rendFleetScorecard(items) {
  return `<div class="ui-table-wrap rd-tabla-compacta rd-score"><table class="ui-table rd-table">
    <thead><tr><th scope="col">${escapeHTML(t("rd.col.metrica"))}</th><th scope="col" class="ui-num">${escapeHTML(_rendPeriodLabel())}</th>${
      STATE.curMode !== "diario" ? `<th scope="col" class="rd-dcol">${escapeHTML(_rdPrevLbl())}</th>` : ""}</tr></thead><tbody>
    ${items.map(it => `<tr>
      <th scope="row" class="rd-rowhead">${escapeHTML(it.label)}</th>
      <td class="ui-num"${it.key ? dn("rend", "fleet-calidad", it.key) : ""}>${it.val == null ? "—" : it.fmtFn(it.val)}</td>
      ${STATE.curMode !== "diario" ? `<td class="rd-dcol">${_rdDelta(it.val, it.prev, { invert: it.invert })}</td>` : ""}
    </tr>`).join("")}
  </tbody></table></div>`;
}
function _rdFleetCiudadTabla(ciudades) {
  const conDelta = STATE.curMode !== "diario";
  const num = v => v == null ? "—" : fmt(v);
  const pct = v => v == null ? "—" : fmt(v) + "%";
  const cols = [
    { k: "owned",      l: t("rend.kpi.ownedCars"),   f: fmt },
    { k: "shCar",      l: t("rend.kpi.shAuto"),      f: num },
    { k: "accept",     l: t("rend.kpi.aceptacion"),  f: pct },
    { k: "branded",    l: t("rend.kpi.brandedCars"), f: fmt },
    { k: "pctBranded", l: t("rend.kpi.pctBrand"),    f: pct }
  ];
  const rows = ciudades.slice().sort((a, b) => b.c.owned - a.c.owned);
  let h = `<div class="ui-table-wrap rd-tabla-compacta"><table class="ui-table rd-table">
    <thead><tr><th scope="col">${escapeHTML(t("rd.col.ciudad"))}</th>${cols.map(c =>
      `<th scope="col" class="ui-num">${escapeHTML(c.l)}</th>${conDelta ? `<th scope="col" class="rd-dcol"><span class="ui-sr-only">${escapeHTML(t("rd.col.delta", { m: c.l }))}</span>Δ</th>` : ""}`).join("")}</tr></thead><tbody>`;
  rows.forEach(r => {
    h += `<tr><th scope="row" class="rd-rowhead">${_rdDot(_rdCityVar(r.city))}${escapeHTML(cityLabel(r.city))}</th>` +
      cols.map(c => `<td class="ui-num"${dn(`rend.fleet-ciudad.${c.k}.${r.city}`)}>${r.c[c.k] == null ? "—" : c.f(r.c[c.k])}</td>` +
        (conDelta ? `<td class="rd-dcol">${_rdDelta(r.c[c.k], r.p[c.k])}</td>` : "")).join("") + `</tr>`;
  });
  return h + `</tbody></table></div>`;
}
export function _rendFleetPartnerTable(lastRows, prevRows) {
  const groupBy = (rows) => {
    const m = new Map();
    rows.forEach(r => { let a = m.get(r.partner); if (!a) { a = []; m.set(r.partner, a); } a.push(r); });
    return m;
  };
  const byP = groupBy(lastRows), prevByP = groupBy(prevRows);
  const rows = [...byP.entries()].map(([p, rs]) => {
    const c  = _rendFleetAgg(rs);
    const pr = _rendFleetAgg(prevByP.get(p) || []);
    return { partner: p, kam: (rs[0] || {}).kam || "", ...c, prev: pr };
  }).sort((a, b) => b.owned - a.owned);
  if (!rows.length) return emptyState({ icon: "car", title: t("rd.fleet.sinPartners") });
  // Delta inline junto al valor: cada métrica trae su propio WoW/MoM. El texto
  // "valor delta" (con el espacio) es el que registra la huella.
  const num = v => v == null ? "—" : fmt(v);
  const pct = v => v == null ? "—" : fmt(v) + "%";
  const cel = (key, partner, txt, d) => `<td class="ui-num"${dn("rend", "fleet-tabla", key, partner)}>${txt}${d ? " " + d : ""}</td>`;
  let h = `<div class="ui-table-wrap ui-table-wrap--scroll rd-tabla-wrap"><table class="ui-table ui-table--sticky-first rd-table rd-table--fleet"><thead><tr>
    <th scope="col">${escapeHTML(t("rend.col.partner"))}</th><th scope="col">KAM</th>
    <th scope="col" class="ui-num">${escapeHTML(t("rend.kpi.ownedCars"))}</th><th scope="col" class="ui-num">${escapeHTML(t("rend.kpi.shAuto"))}</th>
    <th scope="col" class="ui-num">${escapeHTML(t("portal.aceptacion"))}</th><th scope="col" class="ui-num">Branded</th>
    <th scope="col" class="ui-num">${escapeHTML(t("rend.fleet.pctBrandeado"))}</th><th scope="col" class="ui-num">${escapeHTML(t("rend.kpi.gmvAuto"))}</th>
    <th scope="col" class="ui-num">${escapeHTML(t("rend.fleet.comisionAuto"))}</th></tr></thead><tbody>`;
  rows.forEach(r => {
    h += `<tr>
      <th scope="row" class="rd-rowhead">${_rdDot(STATE.partnerColors[r.partner] || "var(--cat-other)")}<span>${escapeHTML(r.partner)}</span></th>
      <td class="rd-kamcell">${_rdDot(_rdKamVar(r.kam))}${escapeHTML(kamLabel(r.kam))}</td>
      ${cel("owned", r.partner, fmt(r.owned), _rdDelta(r.owned, r.prev.owned))}
      ${cel("shCar", r.partner, num(r.shCar), _rdDelta(r.shCar, r.prev.shCar))}
      ${cel("accept", r.partner, pct(r.accept), _rdDelta(r.accept, r.prev.accept))}
      ${cel("branded", r.partner, fmt(r.branded), "")}
      ${cel("pctBranded", r.partner, pct(r.pctBranded), _rdDelta(r.pctBranded, r.prev.pctBranded))}
      ${cel("gmvPerCar", r.partner, num(r.gmvPerCar), _rdDelta(r.gmvPerCar, r.prev.gmvPerCar))}
      ${cel("commissionPerCar", r.partner, num(r.commissionPerCar), _rdDelta(r.commissionPerCar, r.prev.commissionPerCar))}
    </tr>`;
  });
  return h + `</tbody></table></div>`;
}
export function _rendTkKPIs(lastRows, prevRows, metaInfo) {
  const agg = rows => {
    let branded = 0, actCars = 0;
    rows.forEach(r => { branded += r.brandedActiveCars || 0; actCars += r.activeCars || 0; });
    return { branded, actCars };
  };
  const c = agg(lastRows), p = agg(prevRows);
  const snap = t("rend.snapshotUlt");
  return _rdSec(t("rend.tk.autos"), t("rend.tk.autosSub")) +
    `<div class="rd-kpis rd-kpis--2">
      ${_rdKpi({ label: t("rend.kpi.brandeados"), value: fmt(c.branded), numKey: "rend.tk.branded", cur: c.branded, prev: p.branded, sub: snap, goal: _rdGoal(metaInfo, "cars") })}
      ${_rdKpi({ label: t("rend.kpi.activeCars"), value: fmt(c.actCars), numKey: "rend.tk.activeCars", cur: c.actCars, prev: p.actCars, sub: snap })}
    </div>` +
    _rendTkAdquisicion(lastRows, prevRows);
}

// ── TukTuk · Adquisición propia (criterio "Las 6 metas del mes") ──────────────
// Meta del criterio: 100 conductores nuevos al mes de ADQUISICIÓN PROPIA. La
// letra chica importa y define la métrica: "no contempla self-registration", que
// es exactamente la distinción entre las dos columnas de la fuente:
//   new_from_partner  → los trae el partner   (cuentan)
//   new_from_service  → self-registration     (NO cuentan)
// Por eso la tarjeta de self-registration se muestra al lado: deja la definición
// a la vista y auditable, en vez de que el número salga de una caja negra.
export const TK_META_NUEVOS_MES = 100;

// OJO CON LA VENTANA: la meta es de 100 al MES, así que esta sección mide el
// ÚLTIMO PERÍODO, no el acumulado del rango. Con el acumulado, un rango de 3
// meses daba 97,2 contra una meta de 100 y parecía "casi cumplida" cuando en
// realidad el mes cerró en 36 — el mismo error de escala que ya obligó a poner
// un aviso en Metas. Comparar contra el período anterior, no contra el rango.
export function _rendTkAdquisicion(lastRows, prevRows) {
  const sum = (rows, get) => rows.reduce((a, r) => a + (get(r) || 0), 0);
  const propios  = sum(lastRows, r => r.newPartner);
  const self     = sum(lastRows, r => r.newService);
  const pPropios = sum(prevRows, r => r.newPartner);
  const pSelf    = sum(prevRows, r => r.newService);
  const total    = propios + self;
  const pTotal   = pPropios + pSelf;
  const pct      = total  > 0 ? (propios  / total)  * 100 : 0;
  const pPct     = pTotal > 0 ? (pPropios / pTotal) * 100 : 0;

  // Por partner: lo accionable es a quién llamar, no el total país.
  const byPartner = new Map();
  lastRows.forEach(r => {
    byPartner.set(r.partner, (byPartner.get(r.partner) || 0) + (r.newPartner || 0));
  });
  const filas = [...byPartner.entries()].sort((a, b) => b[1] - a[1]);

  // La meta es MENSUAL. En semanal/diario el "último período" es una semana o un
  // día, así que compararlo contra 100 daría un incumplimiento falso → el
  // semáforo queda en gris (mismo criterio que el aviso de escala de Metas).
  const mensual = STATE.curMode === "mensual";
  const rangoTxt = t(mensual ? "rend.tk.ultMes" : "rend.tk.ultPeriodo");

  const filasHTML = filas.length ? filas.map(([partner, n]) => {
    const ok  = n >= TK_META_NUEVOS_MES;
    const tone = !mensual ? "neutral" : ok ? "ok" : n >= TK_META_NUEVOS_MES * 0.5 ? "warn" : "bad";
    const pctMeta = Math.min(100, (n / TK_META_NUEVOS_MES) * 100);
    return `<tr>
      <th scope="row" class="rd-rowhead">${escapeHTML(partner)}</th>
      <td class="ui-num rd-tone rd-tone--${tone}">${fmt(n)}</td>
      <td class="rd-barcell"><div class="ui-progress ${tone === "neutral" ? "rd-progress--neutral" : "ui-progress--" + tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pctMeta)}">` +
        `<div class="ui-progress__bar" style="width:${pctMeta.toFixed(1)}%"></div></div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="3" class="rd-muted">${escapeHTML(t("rend.tk.sinNuevos"))}</td></tr>`;

  return _rdSec(t("rend.tk.adq"), t("rend.tk.adqSub", { n: TK_META_NUEVOS_MES })) +
    `<div class="rd-kpis rd-kpis--3">
      ${_rdKpi({ label: t("rend.kpi.nuevosProp"), value: fmt(propios), cur: propios, prev: pPropios, sub: rangoTxt })}
      ${_rdKpi({ label: t("rend.kpi.selfReg"),    value: fmt(self),    cur: self,    prev: pSelf,    sub: t("rend.tk.noCuenta") })}
      ${_rdKpi({ label: t("rend.kpi.pctAdq"),     value: pct.toFixed(1) + "%", cur: pct, prev: pPct, sub: t("rend.tk.propiosTotal") })}
    </div>
    ${!mensual ? alertBox({ tone: "info", text: t(STATE.curMode === "diario" ? "rd.tk.avisoDiario" : "rd.tk.avisoSemanal", { n: TK_META_NUEVOS_MES }) }) : ""}
    <div class="ui-table-wrap rd-tabla-compacta"><table class="ui-table rd-table rd-table--tkadq">
      <thead><tr>
        <th scope="col">${escapeHTML(t("rend.col.partner"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("rd.tk.thPropios"))}</th>
        <th scope="col">${escapeHTML(t("rd.tk.thVsMeta", { n: TK_META_NUEVOS_MES }))}</th>
      </tr></thead>
      <tbody>${filasHTML}</tbody>
    </table></div>`;
}

// Variante compacta de section header (sin fondo de ícono ni tag) — vivía en
// insights.js (borrado en Fase A0 por no tener ruta de UI propia), pero
// calculator.js/partnerView.js/seguimiento.js seguían usándola como global.
// Restaurada acá al detectar el ReferenceError durante la conversión a módulos ES.
export function _secH(emoji, color, title, subtitle) {
  return `
    <div class="agy-style-532">
      <div class="agy-style-533">${emoji}</div>
      <div class="agy-style-534">
        <div class="agy-style-535">${escapeHTML(title)}</div>
        <div class="agy-style-536">${escapeHTML(subtitle)}</div>
      </div>
    </div>`;
}
// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";

registerActions({
  // data-line (y data-value del control segmentado): el mismo valor.
  setRendLine:       d => setRendLine(d.line || d.value),
  setRendCiudadModo: d => setRendCiudadModo(d.value),
  sortTbl:           d => sortTbl(d.col),
  // Encabezado ordenable con teclado (Enter / Espacio), igual que el click.
  sortTblKey:        (d, _el, e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortTbl(d.col); } },
  dlChart:           d => dlChart(d.chart, d.name)
});
