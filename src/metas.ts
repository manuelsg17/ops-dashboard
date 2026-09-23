//@ts-nocheck
import { ensurePdfLibs } from "./shared/lazyLibs.js";
import { opcionesCapturaClara } from "./shared/exportClaro";
import { t, mesLabel, kamLabel } from "./core/i18n";
import { dn } from "./shared/huella";
import { logAccess } from "./shared/accessLog.js";
// Núcleo de cálculo compartido (snapshot vs flujo, proyecciones, ponderados).
// Import explícito y no global: es el módulo que define QUÉ significa cada
// número, y tiene tests — que se vea de dónde sale.
import {
  snapshotValue, seriesByDate, projectSnapshot, projectFlow,
  weightedAvg, ratio, sumKpis, tasaAcum, sumarTasa, leerTasa
} from "./domain/metrics.js";
import { reportYM, diasMesReporte } from "./shared/mesReporte.js";
import { SIN_KAM } from "./core/config.js";
import { parseLocalDate } from "./core/dates";
import { esMesEnCurso } from "./domain/mesEnCurso";
import { estadoMetaFila } from "./domain/estadoMeta";
import { ordenarKams } from "./domain/desgloseKam";
import { escalaLista, reintentarCuandoEscalaLista } from "./shared/escalaLista";
import { partesAlcance } from "./shared/alcance";
// Sistema de diseño (Ola 6): componentes ui-* + diálogos en página.
import { btn, delta as uiDelta, alertBox, emptyState, icon, goalTone, segmented } from "./shared/ui";
import { confirmDialog, alertDialog } from "./shared/confirmDialog";
import { MES_NOMBRES } from "./core/meses";

// ── KAM EFECTIVO DE UNA FILA DE META (B9, sep-2026) ──────────────────────────
// El loader arma `m.kam = KAM_MAP[clid] || m.kam || ""`: cuando el partner tiene
// el KAM VACÍO en `partners`, cae al kam guardado en la propia fila de meta (el
// KAM viejo) o a "". Resultado: con el filtro "No KAM" esas metas no aparecían
// (su kam era "Carla" o ""), y sin filtro se agrupaban bajo el KAM viejo
// mientras Rendimiento y el sidebar las ponían en "No KAM" — el mismo partner en
// dos grupos según la pantalla. Misma precedencia que el resto de la app
// (_lineKamOf / _buildPartnerKAM): partners → flotas/filas → la propia meta.
export function _metasKamDe(m) {
  const k = (m && typeof getKAMForPartner === "function" && getKAMForPartner(m.partner)) || "";
  return k || ((m && m.kam) || "").trim() || SIN_KAM;
}

// ── PROYECCIÓN SOLO PARA EL MES EN CURSO (decisión 4 de Manuel, 23-sep-2026) ──
// "en meses pasados ya en el filtro mensual no hace sentido seguirla mostrando,
// porque no logrará más avances en ese mes porque ya cerró". La regla vive en
// domain/mesEnCurso.ts (la misma que usan el portal y el deck); acá solo se
// decide UNA vez por render y la leen los cuatro helpers que dibujan barras.
// Vale SOLO durante un render de esta pestaña: fuera de ella (Rendimiento) se
// usa metasResumenPais, que decide la proyección en cada llamada.
let _metasProyOn = true;
function _metasCalcProyOn(mesName, mesYearSel, mesDates) {
  const ord = _metasMesOrden(mesName);
  if (!ord) return false;
  let mes, anio = mesYearSel;
  if (ord >= 100000) { mes = ord % 100; anio = Math.floor(ord / 100); }
  else mes = ord - 2000;
  // Sin año en las metas: el año de los períodos del mes que se están mirando.
  if (anio == null && mesDates && mesDates.length) {
    anio = reportYM(mesDates[mesDates.length - 1], STATE.curMode, parseLocalDate).y;
  }
  return esMesEnCurso(mes, anio);
}
import { ordenMes, opcionesMesMeta, mesPorDefecto, claveMes, parseClaveMes } from "./domain/mesesMeta";
// metas.js — Pestaña Metas

// B1 (sep-2026): la regla vive en domain/mesesMeta.ordenMes — año*100 + mes.
// Con `anio` (metas.mes_year) el orden es real: ENERO 2027 > DICIEMBRE 2026.
// Sin año (llamadores que solo tienen el nombre) devuelve el 2000+mes de
// siempre, que es lo que distingue "nombre" (2001..2012) de "YYYY-MM" (≥100000)
// en _metasFechasDelMes y en el deck.
export function _metasMesOrden(mes, anio = null) {
  return ordenMes(mes, anio);
}

// Mes (y AÑO) que muestra la pestaña: la selección manual si sigue existiendo;
// si no, el ÚLTIMO MES CON DATOS (domain/mesesMeta.mesPorDefecto), no la meta
// más nueva. Antes: orden 2000+mes → en enero abría DICIEMBRE, y con metas
// cargadas por adelantado abría un mes sin ningún dato (pantalla vacía).
export function _metasMesElegido() {
  const ops = opcionesMesMeta(STATE.metasData || []);
  if (!ops.length) return null;
  if (STATE.metasMesSel) {
    const selY = STATE.metasMesSelYear ?? null;
    const hit = ops.find(o => o.mes === STATE.metasMesSel && (selY == null || o.anio === selY));
    if (hit) return hit;
  }
  let ultimo = "";
  for (const d of STATE.allDates || []) if (d > ultimo) ultimo = d;
  const ym = ultimo ? reportYM(ultimo, STATE.curMode, parseLocalDate) : null;
  return mesPorDefecto(ops, ym);
}

// BUG REAL (encontrado en auditoria ago 2026): metas.mes es NOMBRE sin año
// ("AGOSTO") y aunque el loader ya expone mes_year (STATE.metasData[].mYear),
// nada lo usaba — todo el matcheo era por nombre de mes a secas. Con metas de
// AGOSTO 2025 (partner A) y AGOSTO 2026 (partner B) conviviendo en la tabla
// (la UNIQUE es clid,city,mes — distinto clid/city sí coexiste cross-year),
// el tab colapsaba ambos años en una sola opcion "AGOSTO" y SUMABA las metas
// de los dos años. Mismo tipo de bug que ya se arreglo en Presentacion 2.0.
//
// Fix: la seleccion de "mes actual" ahora es (mes, año) compuesta. Legacy: una
// fila con mYear null (uploads viejos sin año) matchea cualquier año — no hay
// forma de saber a cual pertenece, y no vale la pena bloquear data vieja por
// esto.
export function _metasMesActualYear(mesName) {
  // El año ELEGIDO (selector o default por datos) manda: con ENERO 2026 y ENERO
  // 2027 cargados, el máximo a secas hacía imposible ver el 2026.
  const el = _metasMesElegido();
  if (el && el.mes === mesName && el.anio != null) return el.anio;
  const anios = STATE.metasData
    .filter(m => m.mes === mesName && m.mYear != null)
    .map(m => m.mYear);
  return anios.length ? Math.max(...anios) : null;
}
export function _metasMatchMes(m, mesName, mesYearSel) {
  if (m.mes !== mesName) return false;
  if (mesYearSel == null || m.mYear == null) return true; // sin año conocido: no se puede descartar
  return m.mYear === mesYearSel;
}

// ── RANGO DEL SIDEBAR vs MES DE LA META ──────────────────────────────────────
//
// La meta es MENSUAL. El FACT salía del rango del sidebar TAL CUAL, sin recortarlo
// al mes de la meta, así que por defecto (la ventana entera cargada: 16 semanas /
// 6 meses / 90 días) se comparaban VARIOS meses de N+R y horas contra el objetivo
// de UNO. Medido contra producción el 05-sep-2026, rango por defecto 11-may→24-ago
// vs AGOSTO: N+R 64.851 en vez de 11.348 (5,7×) y horas 6,3× — un ~570% de
// cumplimiento que no significaba nada. Y la proyección lo empeoraba: proyectFlow
// extrapola ese total como si se hubiera acumulado en los días transcurridos de UN
// mes (visto: 632% de plan).
//
// Ahora el FACT es la INTERSECCIÓN rango ∩ mes de la meta — la misma regla que ya
// usan el deck (p2DatesMetaEnRango) y el portal del partner. El filtro se sigue
// respetando: si el KAM mira una sola semana, ve esa semana; lo que ya no pasa es
// mezclar meses bajo la etiqueta de uno.
//
// El bucketing es por mes de REPORTE (en semanal, el mes donde cae el jueves),
// igual que el deck y el portal: la semana del Lun 29-jun cuenta en JULIO.
export function _metasFechasDelMes(mesName, mesYearSel, from, to) {
  const ord = mesName ? _metasMesOrden(mesName) : 0;
  if (!ord) return [];
  const todas = (STATE.allDates || []).filter(d => (!from || d >= from) && (!to || d <= to));
  const ym = d => reportYM(d, STATE.curMode, parseLocalDate);
  if (ord >= 100000) {                                   // mes ISO "YYYY-MM"
    const yy = Math.floor(ord / 100), mm = ord % 100;
    return todas.filter(d => { const r = ym(d); return r.y === yy && r.m === mm; });
  }
  const mn = ord - 2000;                                 // nombre de mes sin año
  const cand = todas.filter(d => ym(d).m === mn);
  if (mesYearSel != null) return cand.filter(d => ym(d).y === mesYearSel);
  // Sin año en las metas (uploads viejos): el año más reciente presente en el
  // rango, nunca la mezcla de dos años bajo el mismo nombre de mes.
  const anios = [...new Set(cand.map(d => ym(d).y))].sort();
  const ultimo = anios[anios.length - 1];
  return ultimo == null ? [] : cand.filter(d => ym(d).y === ultimo);
}
// Todos los períodos de ese mes que EXISTEN (ignorando el "Desde" del sidebar,
// pero sin pasar del "Hasta"): el denominador del aviso de cobertura.
export function _metasFechasMesCompleto(mesName, mesYearSel, to) {
  return _metasFechasDelMes(mesName, mesYearSel, "", to);
}

// Handler del selector de mes. Cambia el mes activo y re-renderiza.
// Valida contra los meses realmente disponibles en STATE.metasData.
export function setMetasMes(clave) {
  // El valor del <select> es "MES|AÑO" (claveMes): el mismo nombre de mes puede
  // existir en dos años.
  const { mes, anio } = parseClaveMes(clave);
  const disp = opcionesMesMeta(STATE.metasData || []);
  if (!disp.some(o => o.mes === mes && o.anio === anio)) {
    if (DEBUG) console.warn("setMetasMes: mes no disponible", clave, "disp:", disp.map(o => o.clave));
    return;
  }
  STATE.metasMesSel = mes;
  STATE.metasMesSelYear = anio;
  if (STATE.curTab === "metas") renderMetas();
}

// ── LÍNEA DE NEGOCIO EN METAS (Agregador / Fleet / TukTuk) — Fase 3 ────────────
// Independiente de Rendimiento (STATE.metasLine propio). Diario no trae db_id → cae
// a Agregador. Actuales de Fleet/TukTuk salen de los slices materializados (Fase 2).
export function _metasLine() {
  // Ver la nota en rendimiento._rendLine: el diario ya trae db_id, así que las
  // 4 líneas funcionan en las 3 escalas.
  return STATE.metasLine || "comb";
}
export async function setMetasLine(line) {
  if ((STATE.metasLine || "comb") === line) return;
  STATE.metasLine = line;
  // Cada línea tiene KPIs distintos: el orden de la tabla de partners vuelve al
  // de por defecto (peor cumplimiento primero).
  _MT.sort = { key: "worst", dir: "asc" };
  // Ver el comentario gemelo en setRendLine: _metasFleetActuals pondera por
  // acceptance_rate, que es una columna diferida.
  if (line === "fleet" && typeof ensureFullRendColumns === "function") {
    try { await ensureFullRendColumns(); } catch (e) { /* nunca bloquear el render */ }
    if ((STATE.metasLine || "comb") !== line) return;
  }
  if (STATE.curTab === "metas") renderMetas();
}
// Selector de línea: control segmentado del sistema de diseño (Ola 6). Se arma a
// mano (y no con ui.segmented) porque el botón tiene que conservar `data-line`:
// shell.quitarChipAlcance("linea") y huella.js lo buscan por ese atributo.
export function metasLineToggleHTML() {
  const line = _metasLine();
  const defs = [
    { k: "comb",  ic: "activity", label: t("rend.linea.comb"), tip: t("metas.linea.combTip") },
    { k: "agg",   ic: "taxi",     label: t("rend.linea.agg"),  tip: t("metas.linea.aggTip") },
    { k: "fleet", ic: "car",      label: "Fleet",              tip: t("metas.linea.fleetTip") },
    { k: "tk",    ic: "tuktuk",   label: "TukTuk",             tip: t("metas.linea.tkTip") }
  ];
  const btns = defs.map(d =>
    `<button type="button" class="ui-segmented__btn" aria-pressed="${line === d.k}" title="${escapeHTML(d.tip)}"` +
    ` data-act="setMetasLine" data-line="${escapeHTML(d.k)}">${icon(d.ic, { size: 14 })}<span>${escapeHTML(d.label)}</span></button>`
  ).join("");
  return `<div class="ui-segmented mt-lines" role="group" aria-label="${escapeHTML(t("mt.linea.aria"))}">${btns}</div>`;
}

// Slice de performance de la línea para la escala actual (Fase 2).
// "comb" = Taxi + TukTuk (disjuntos: TukTuk se excluye de rawData al cargar → sin doble conteo).
export function _metasLineDataset(line) {
  const slice = base => {
    const m = STATE.curMode;
    if (m === "mensual") return STATE["rawDataMensual" + base] || [];
    if (m === "diario")  return STATE["rawDataDiario"  + base] || [];
    return STATE["rawData" + base] || [];
  };
  if (line === "fleet") return slice("Fleet");
  if (line === "tk")    return slice("Tuktuk");
  if (line === "comb")  return STATE.rawData.concat(slice("Tuktuk"));
  return STATE.rawData;
}
// Actuales Fleet por (partner|||city) en [from,to]: SH/auto interno y aceptación
// ponderados (Σ internalFleetSh / Σ ownedCars; Σ(rate×trips)/Σtrips) — igual que
// presentacion2.p2FleetSeries / rendimiento._rendFleetAgg.
//
// Se conservan los NUMERADORES Y DENOMINADORES crudos (intSh, owned, accTrips, trips)
// además de las tasas ya calculadas: son imprescindibles para poder re-ponderar
// al agregar por ciudad/KAM/país. Promediar las tasas ya calculadas de varios
// partners daría un número sin significado (un partner con 3 autos pesaría igual
// que uno con 300).
export function _metasFleetActuals(fechas, selSet, cityFilter) {
  const by = new Map();
  let _snap = "";   // último período con dato (B10): "autos propios hoy"
  const _sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  _metasLineDataset("fleet").forEach(r => {
    if (!fechas.has(r.date)) return;
    if (r.date > _snap) _snap = r.date;
    if (cityFilter !== "all" && r.city !== cityFilter) return;
    if (selSet.size && !_lineSelHas(selSet, _sidebar, r.partner)) return;
    const k = `${r.partner}|||${r.city}`;
    let e = by.get(k);
    if (!e) { e = { owned: 0, intSh: 0, trips: 0, _acc: tasaAcum(), branded: 0, _owned: {} }; by.set(k, e); }
    e.owned   += r.ownedFleetActiveCars || 0;
    e.intSh   += r.internalFleetSh || 0;
    e.trips   += r.trips || 0;
    sumarTasa(e._acc, r.acceptanceRate, r.trips);   // sin tasa → fuera de num y den
    e.branded += r.brandedActiveCars || 0;
    // Autos propios por fecha: `owned` de arriba acumula auto-períodos (es el
    // denominador correcto de SH/auto), pero para MOSTRAR "cuántos autos tiene"
    // hace falta el nivel del último período, no la suma sobre el tiempo.
    e._owned[r.date] = (e._owned[r.date] || 0) + (r.ownedFleetActiveCars || 0);
  });
  by.forEach(e => {
    e.shCar     = ratio(e.intSh, e.owned);
    const acc   = leerTasa(e._acc);
    e.accept    = acc == null ? null : acc * 100;
    // Peso de la aceptación al re-ponderar por ciudad/KAM: los viajes de las
    // filas que SÍ traían la tasa, no todos (`trips`).
    e.accTrips  = e._acc.den;
    e.ownedNow  = _snap ? (e._owned[_snap] || 0) : snapshotValue(seriesByDate(e._owned));
    delete e._owned; delete e._acc;
  });
  return by;
}
// Actuales TukTuk por (partner|||city): AD y Brandeados son SNAPSHOT (último
// período); N+R y SH son FLUJO (Σ del rango). Se guardan también las SERIES por
// período: sin ellas no se puede proyectar (la de AD alimenta la proyección plana y las
// de flujo el ritmo lineal). Ver src/domain/metrics.ts.
export function _metasTkActuals(fechas, selSet, cityFilter) {
  const by = new Map();
  let _snap = "";   // último período con dato de la línea en el mes (B10)
  const _sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  _metasLineDataset("tk").forEach(r => {
    if (!fechas.has(r.date)) return;
    if (r.date > _snap) _snap = r.date;
    if (cityFilter !== "all" && r.city !== cityFilter) return;
    if (selSet.size && !_lineSelHas(selSet, _sidebar, r.partner)) return;
    const k = `${r.partner}|||${r.city}`;
    let e = by.get(k);
    if (!e) { e = { _ad: {}, _cars: {}, _nr: {}, _sh: {}, nr: 0, sh: 0 }; by.set(k, e); }
    e._ad[r.date]   = (e._ad[r.date]   || 0) + (r.activeDrivers || 0);
    e._cars[r.date] = (e._cars[r.date] || 0) + (r.brandedActiveCars || 0);
    const nr = (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0);
    e._nr[r.date] = (e._nr[r.date] || 0) + nr;
    e._sh[r.date] = (e._sh[r.date] || 0) + (r.supplyHours || 0);
    e.nr += nr;
    e.sh += r.supplyHours || 0;   // acumulado del rango, igual que N+R (no es snapshot)
  });
  const _ult = [...fechas].sort().at(-1);
  by.forEach(e => _finishSeries(e, _ult, _snap));
  return by;
}
// Actuales COMBINADOS (Taxi+TukTuk) por (partner|||city): AD = snapshot del ÚLTIMO
// período (misma convención que la slide "Avance Combinado" del deck), N+R y SH = Σ
// del rango. Opera sobre el dataset concat — las filas de ambas líneas de una misma
// fecha se suman antes de tomar el snapshot.
export function _metasCombActuals(fechas, selSet, cityFilter) {
  const by = new Map();
  let _snap = "";   // último período con dato de la línea en el mes (B10)
  const _sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  _metasLineDataset("comb").forEach(r => {
    if (!fechas.has(r.date)) return;
    if (r.date > _snap) _snap = r.date;
    if (cityFilter !== "all" && r.city !== cityFilter) return;
    if (selSet.size && !_lineSelHas(selSet, _sidebar, r.partner)) return;
    const k = `${r.partner}|||${r.city}`;
    let e = by.get(k);
    if (!e) { e = { _ad: {}, _cars: {}, _nr: {}, _sh: {}, nr: 0, sh: 0 }; by.set(k, e); }
    e._ad[r.date] = (e._ad[r.date] || 0) + (r.activeDrivers || 0);
    const nr = (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0);
    e._nr[r.date] = (e._nr[r.date] || 0) + nr;
    e._sh[r.date] = (e._sh[r.date] || 0) + (r.supplyHours || 0);
    e.nr += nr;
    e.sh += r.supplyHours || 0;
  });
  const _ult = [...fechas].sort().at(-1);
  by.forEach(e => _finishSeries(e, _ult, _snap));
  return by;
}

// Cierra una entrada de actuals: convierte los mapas fecha→valor en series
// ordenadas, saca los snapshots y calcula las proyecciones. Compartido por
// TukTuk y Combinado para que las dos líneas no puedan divergir.
// `snapDate` (B10, sep-2026): el SNAPSHOT (AD, brandeados) se toma en el último
// período del RANGO con dato en la línea, no en el último período de CADA
// partner. Antes, un partner que dejó de operar a mitad de mes seguía aportando
// su último AD (p.ej. el de 3 semanas atrás) al total y a su ciudad — un nivel
// que ya no existe, y que no cuadraba con Rendimiento (que mira la última fecha).
function _finishSeries(e, lastDate, snapDate) {
  const { daysElapsed, daysRemaining } = _metasProjDays(lastDate);
  const adS = seriesByDate(e._ad);
  e.ad     = snapDate ? (e._ad[snapDate] || 0) : snapshotValue(adS);
  e.cars   = e._cars ? (snapDate ? (e._cars[snapDate] || 0) : snapshotValue(seriesByDate(e._cars))) : 0;
  e.projAd = projADbyDate(e._ad);
  e.projNr = projectFlow(e.nr, daysElapsed, daysRemaining);
  e.projSh = projectFlow(e.sh, daysElapsed, daysRemaining);
  // La serie por fecha SE CONSERVA (no se borra) porque la proyección de un
  // SNAPSHOT no se puede sumar hacia arriba: ver _metasAggKpi.
  e.adByDate   = e._ad;
  e.carsByDate = e._cars || {};
  delete e._ad; delete e._cars; delete e._nr; delete e._sh;
}

// Días transcurridos/restantes del mes de referencia, tomando la última fecha
// realmente visible en el filtro. Se calcula una vez por render (cachear acá
// evitaría recalcularlo por cada partner, pero el costo es despreciable frente
// a la claridad de no tener estado suelto).
function _metasProjDays(lastDate) {
  if (lastDate) return diasMesReporte(lastDate, STATE.curMode, parseLocalDate);
  const to = document.getElementById("dateTo")?.value || "";
  const dates = (STATE.allDates || []).filter(d => !to || d <= to);
  return diasMesReporte(dates[dates.length - 1] || to, STATE.curMode, parseLocalDate);
}

// ── PRESENTACIÓN (Ola 6, sep-2026) ───────────────────────────────────────────
// Todo lo que pinta Metas sale de acá: tarjetas KPI (ui-kpi), tablas compactas
// por ciudad/KAM, tabla (o tarjetas) por partner y la barra de controles.
//
// REGLA DE LA HUELLA (scripts/huella): cada cifra conserva su `data-num` y el
// MISMO texto que antes (p.ej. "77.0%", "37,248", "1.7M"). El rediseño mueve
// las cifras de lugar, nunca cambia cómo se formatean.
//
// Colores: solo tokens semánticos. El % de cumplimiento usa los MISMOS cortes
// que pColor()/pEstado() vía ui.goalTone (<80 bad · 80–94 warn · 95–150 ok ·
// >150 over). Ciudades y KAMs llevan la paleta categórica (--cat-N), nunca el
// rojo de marca; el color de hash del partner queda solo como un puntito.

// Estado de UI de la sección de partners (no se persiste: cada sesión arranca
// en tabla, "Todos" y peor cumplimiento primero — que es lo que lee la huella).
const _MT = { vista: "tabla", filtro: "todos", sort: { key: "worst", dir: "asc" } };
// Último contexto pintado de la sección de partners: ordenar/filtrar/cambiar de
// vista repinta SOLO esa sección (no recalcula la pestaña entera).
let _mtPartnersCtx = null;

const _E = s => escapeHTML(s == null ? "" : String(s));
// data-num opcional: sin clave no se emite nada (dn() sin partes daría data-num="real").
const _dn = (numKey, suf) => numKey ? dn(numKey, suf) : "";

// Tono semántico de un % de cumplimiento. Sin meta (>0) no hay semáforo.
function _mtTone(p, meta) {
  return meta > 0 ? (goalTone(p) || "bad") : "neutral";
}
function _mtPctBadge(p, meta, numKey) {
  return `<span class="ui-badge ui-badge--${_mtTone(p, meta)} mt-pct"${_dn(numKey, "pct")}>${p.toFixed(1)}%</span>`;
}
// Barra de avance (ui-progress). `pp` = % proyectado (franja translúcida detrás).
function _mtBar(p, pp, meta, extraCls = "") {
  const clamp = n => Math.max(0, Math.min(100, n));
  const proj = pp != null && isFinite(pp) && pp > p
    ? `<div class="ui-progress__proj" style="width:${clamp(pp).toFixed(1)}%"></div>` : "";
  return `<div class="ui-progress ui-progress--${_mtTone(p, meta)} mt-bar${extraCls ? " " + extraCls : ""}">` +
    `${proj}<div class="ui-progress__bar" style="width:${clamp(p).toFixed(1)}%"></div></div>`;
}
// Puntitos de color: paleta categórica de los tokens para ciudades y KAMs.
function _mtCatCity(city) {
  const i = CITIES.indexOf(city);
  return i >= 0 ? `var(--cat-${(i % 9) + 1})` : "var(--cat-other)";
}
function _mtCatKam(kam) {
  if (!kam || kam === SIN_KAM) return "var(--cat-other)";
  let h = 0;
  for (const c of String(kam)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--cat-${(h % 9) + 1})`;
}
function _mtDot(color) {
  return `<span class="mt-dot" style="background:${color}" aria-hidden="true"></span>`;
}
function _mtCuentas(n) {
  return t(n === 1 ? "mt.cuentas1" : "mt.cuentasN", { n });
}
// Encabezado de sección (sin emoji ni "Perú": el encabezado de página ya dice
// el alcance). `info` = descripción larga de la línea, en tooltip.
function _mtH2(title, info) {
  const i = info
    ? ` <span class="mt-info" title="${_E(info)}" aria-label="${_E(info)}" role="img">${icon("info", { size: 14 })}</span>`
    : "";
  return `<h2 class="mt-h2">${_E(title)}${i}</h2>`;
}
function _mtAlerts(html) {
  return html ? `<div class="mt-alerts">${html}</div>` : "";
}

// Celdas actual / meta / % (+ proyección) de una fila de las tablas por ciudad y
// por KAM. MISMA lógica de casos que el viejo miniBar: sin meta (>0) solo se
// muestra el actual; sin actual medible, solo la meta.
function _mtKpiTds(real, meta, proj, F, numKey, showProj) {
  if (!_metasProyOn) proj = null;
  const dash = `<td class="ui-num mt-muted">—</td>`;
  if (real != null && !(meta > 0)) {
    return `<td class="ui-num"><span${_dn(numKey, "real")}>${F(real || 0)}</span></td>${dash}` +
      `<td class="mt-pctcell"><span class="mt-note">${_E(t("metas.sinMetaCargada"))}</span></td>${showProj ? dash : ""}`;
  }
  if (real == null) {
    return `${dash}<td class="ui-num"><span${_dn(numKey, "meta")}>${F(meta || 0)}</span></td>` +
      `<td class="mt-pctcell"><span class="mt-note">${_E(t("metas.metaSinActual"))}</span></td>${showProj ? dash : ""}`;
  }
  const p  = meta > 0 ? (real / meta) * 100 : 0;
  const pp = meta > 0 && proj != null ? (proj / meta) * 100 : 0;
  const projTd = !showProj ? "" : proj == null ? dash
    : `<td class="ui-num"><span${_dn(numKey, "proj")}>${F(proj)}</span> <span class="mt-sub">(${pp.toFixed(1)}%)</span></td>`;
  return `<td class="ui-num"><span${_dn(numKey, "real")}>${F(real)}</span></td>` +
    `<td class="ui-num"><span${_dn(numKey, "meta")}>${F(meta)}</span></td>` +
    `<td class="mt-pctcell"><div class="mt-pctwrap">${_mtPctBadge(p, meta, numKey)}${_mtBar(p, proj == null ? null : pp, meta)}</div></td>` +
    projTd;
}

// Tabla compacta por ciudad / por KAM: una fila por KPI, la entidad agrupada.
// groups: [{ name, dot, count, extra, rows: [{ label, real, meta, proj, F, numKey }] }]
function _mtGroupTable(entLabel, groups) {
  // Columna de proyección solo si el mes está en curso Y algún KPI proyecta
  // (las tasas de Fleet no se proyectan: sería una columna de guiones).
  const showProj = _metasProyOn && groups.some(g => g.rows.some(r => r && r.proj != null));
  const head = `<tr><th scope="col">${_E(entLabel)}</th><th scope="col">${_E(t("mt.col.kpi"))}</th>` +
    `<th scope="col" class="ui-num">${_E(t("mt.col.actual"))}</th><th scope="col" class="ui-num">${_E(t("mt.col.meta"))}</th>` +
    `<th scope="col">${_E(t("mt.col.pct"))}</th>` +
    (showProj ? `<th scope="col" class="ui-num">${_E(t("mt.col.proy"))}</th>` : "") + `</tr>`;
  let body = "";
  groups.forEach(g => {
    const rows = g.rows.filter(Boolean);
    if (!rows.length) return;
    rows.forEach((r, i) => {
      body += `<tr class="${i === 0 ? "mt-grp-first" : ""}">` +
        (i === 0
          ? `<th scope="rowgroup" rowspan="${rows.length}" class="mt-ent"><div class="mt-ent__name">${_mtDot(g.dot)}${_E(g.name)}</div>` +
            `<div class="mt-sub">${_E(_mtCuentas(g.count))}</div>${g.extra || ""}</th>`
          : "") +
        `<td class="mt-kpiname">${_E(r.label)}</td>` +
        _mtKpiTds(r.real, r.meta, r.proj, r.F || fmt, r.numKey, showProj) + `</tr>`;
    });
  });
  if (!body) return "";
  return `<div class="ui-table-wrap"><table class="ui-table mt-gtable"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// ── Sección por partner: tabla ordenable (default) o tarjetas ────────────────
// Modelo de fila (lo arman el agregador y las vistas de línea):
//   { partner, cityDisp, kamDisp, kamRaw, sinMeta, color, tip, note,
//     cells: [{ id, label, mode: "both"|"real"|"meta"|"none",
//               real, meta, pct, proj, F, numKey, note }] }
// Estado de la fila (filtros): sin meta · na (nada medible contra meta) ·
// bajo (algún % < 95) · sobre (todos ≥100) · en (el resto). La regla vive en
// domain/estadoMeta.ts (decisión de Manuel, 24-sep-2026); los colores no cambian.
function _mtRowStatus(r) {
  return estadoMetaFila(r.cells.filter(c => c.mode === "both" && c.meta > 0).map(c => c.pct), !!r.sinMeta);
}
function _mtWorst(r) {
  if (r._st === "sin") return 1e12 + 1;
  if (r._st === "na")  return 1e12;
  return Math.min(...r.cells.filter(c => c.mode === "both" && c.meta > 0).map(c => c.pct));
}
function _mtSortVal(r, key) {
  if (key === "worst")   return _mtWorst(r);
  if (key === "partner") return r.partner;
  if (key === "city")    return r.cityDisp;
  if (key === "kam")     return r.kamDisp;
  const [id, f] = key.split(".");
  const c = r.cells.find(x => x.id === id);
  if (!c) return null;
  if (f === "pct")  return c.mode === "both" && c.meta > 0 ? c.pct : null;
  if (f === "real") return c.mode === "both" || c.mode === "real" ? c.real : null;
  return c.mode === "both" || c.mode === "meta" ? c.meta : null;
}
function _mtSortRows(rows) {
  const { key, dir } = _MT.sort;
  const mul = dir === "desc" ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const va = _mtSortVal(a, key), vb = _mtSortVal(b, key);
    if (va == null && vb == null) return a.partner.localeCompare(b.partner);
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return c * mul || a.partner.localeCompare(b.partner) || String(a.cityDisp).localeCompare(String(b.cityDisp));
  });
}
function _mtSortTh(key, label, cls = "", attrs = "") {
  const on = _MT.sort.key === key;
  const aria = on ? (_MT.sort.dir === "desc" ? "descending" : "ascending") : "none";
  const arrow = on ? icon(_MT.sort.dir === "desc" ? "arrow-down" : "arrow-up", { size: 12 }) : "";
  return `<th scope="col" class="${cls}" aria-sort="${aria}"${attrs}><button type="button" class="mt-sortbtn"` +
    ` data-act="metasSort" data-key="${_E(key)}" title="${_E(t("mt.ordenar", { c: label }))}">${_E(label)}${arrow}</button></th>`;
}

// Celdas de una fila de partner en la TABLA (actual · meta · % con badge).
function _mtPartnerTds(c) {
  const F = c.F || fmt;
  const dash = `<td class="ui-num mt-muted">—</td>`;
  if (c.mode === "none") return dash + dash + `<td class="mt-muted">—</td>`;
  if (c.mode === "real") {
    return `<td class="ui-num"><span${_dn(c.numKey, "real")}>${F(c.real)}</span></td>${dash}<td class="mt-muted">—</td>`;
  }
  if (c.mode === "meta") {
    return `${dash}<td class="ui-num"><span${_dn(c.numKey, "meta")}>${F(c.meta)}</span></td>` +
      `<td class="mt-pctcell"><span class="mt-note">${_E(c.note || t("metas.sinActual"))}</span></td>`;
  }
  const proj = c.proj != null && _metasProyOn
    ? `<div class="mt-sub mt-projline">${t("mt.proyCorta", { v: `<span${_dn(c.numKey, "proj")}>${F(c.proj)}</span>` })}</div>` : "";
  return `<td class="ui-num"><span${_dn(c.numKey, "real")}>${F(c.real)}</span></td>` +
    `<td class="ui-num"><span${_dn(c.numKey, "meta")}>${F(c.meta)}</span></td>` +
    `<td class="mt-pctcell">${_mtPctBadge(c.pct, c.meta, c.numKey)}${proj}</td>`;
}

// Bloque de un KPI en la TARJETA de partner (vista opcional).
function _mtCardKpi(c) {
  const F = c.F || fmt;
  if (c.mode === "none") return "";
  if (c.mode === "real") {
    return `<div class="mt-pk"><div class="mt-pk__top"><span class="mt-pk__label">${_E(c.label)}</span>` +
      `<span class="mt-pk__val"><span${_dn(c.numKey, "real")}>${F(c.real)}</span> · <em>${_E(t("metas.sinMetaSello"))}</em></span></div></div>`;
  }
  if (c.mode === "meta") {
    return `<div class="mt-pk"><div class="mt-pk__top"><span class="mt-pk__label">${_E(c.label)}</span>` +
      `<span class="mt-pk__val"><strong${_dn(c.numKey, "meta")}>${F(c.meta)}</strong> <span class="mt-note">${_E(t("metas.metaMin"))}${c.note ? " · " + _E(c.note) : ""}</span></span></div></div>`;
  }
  const on = c.proj != null && _metasProyOn;
  const pp = on && c.meta > 0 ? (c.proj / c.meta) * 100 : 0;
  return `<div class="mt-pk"><div class="mt-pk__top"><span class="mt-pk__label">${_E(c.label)}</span>${_mtPctBadge(c.pct, c.meta, c.numKey)}</div>` +
    _mtBar(c.pct, on ? pp : null, c.meta) +
    `<div class="mt-pk__nums">${_E(t("mt.col.actual"))} <strong${_dn(c.numKey, "real")}>${F(c.real)}</strong> · ${_E(t("mt.col.meta"))} <strong${_dn(c.numKey, "meta")}>${F(c.meta)}</strong></div>` +
    (on ? `<div class="mt-pk__proj">${_E(t("metas.proyeccion"))}: <strong${_dn(c.numKey, "proj")}>${F(c.proj)}</strong> (${pp.toFixed(1)}%)</div>` : "") +
    `</div>`;
}

const _MT_FILTROS = ["todos", "bajo", "en", "sobre", "sin"];
function _mtPartnersHTML(ctx) {
  const { rows, kpis } = ctx;
  rows.forEach(r => { r._st = _mtRowStatus(r); });
  const cnt = { todos: rows.length, bajo: 0, en: 0, sobre: 0, sin: 0 };
  rows.forEach(r => { if (cnt[r._st] != null) cnt[r._st]++; });
  if (!_MT_FILTROS.includes(_MT.filtro)) _MT.filtro = "todos";
  const chips = _MT_FILTROS.map(k =>
    `<button type="button" class="mt-fchip mt-fchip--${k}" aria-pressed="${_MT.filtro === k}" data-act="metasSetFiltro" data-value="${k}"` +
    (k === "todos" ? "" : ` title="${_E(t(`mt.filtro.${k}Tip`))}"`) +
    `>${k === "todos" ? "" : `<span class="mt-fchip__dot" aria-hidden="true"></span>`}${_E(t(`mt.filtro.${k}`))} <span class="mt-fchip__n">${cnt[k]}</span></button>`
  ).join("");
  const vista = segmented({
    options: [{ value: "tabla", label: t("mt.vista.tabla"), icon: "table" },
              { value: "tarjetas", label: t("mt.vista.tarjetas"), icon: "copy" }],
    value: _MT.vista, act: "metasSetVista", ariaLabel: t("mt.vista.aria")
  });
  const tools = `<div class="mt-ptools" data-html2canvas-ignore="true"><div class="mt-fchips" role="group" aria-label="${_E(t("mt.filtro.aria"))}">${chips}</div>${vista}</div>`;

  const vis = _mtSortRows(_MT.filtro === "todos" ? rows : rows.filter(r => r._st === _MT.filtro));
  if (!vis.length) return tools + `<div class="mt-filtro-vacio">${_E(t("mt.filtroVacio"))}</div>`;

  const nameCell = (r, tag, attrs = "", cls = "") => {
    const tip = r.tip ? ` <span class="mt-info" title="${_E(r.tip)}" aria-label="${_E(t("mt.detalle") + ": " + r.tip)}" role="img">${icon("info", { size: 13 })}</span>` : "";
    const sm = r.sinMeta ? ` <span class="ui-badge ui-badge--neutral">${_E(t("mt.sinMeta"))}</span>` : "";
    return `<${tag}${attrs} class="mt-pname${cls}">${_mtDot(r.color)}<span class="mt-pname__txt">${_E(r.partner)}</span>${sm}${tip}</${tag}>`;
  };

  if (_MT.vista === "tarjetas") {
    const cards = vis.map(r =>
      `<article class="mt-pcard${r.sinMeta ? " mt-pcard--sinmeta" : ""}">${nameCell(r, "header")}` +
      `<div class="mt-pcard__sub">${_mtDot(_mtCatKam(r.kamRaw))}${_E(r.kamDisp)} · ${_E(r.cityDisp)}</div>` +
      r.cells.map(_mtCardKpi).join("") +
      (r.note ? `<div class="mt-pcard__note">${_E(r.note)}</div>` : "") + `</article>`
    ).join("");
    return tools + `<div class="mt-pgrid">${cards}</div>`;
  }

  const h1 = _mtSortTh("partner", t("mt.col.partner"), "mt-sticky", ` rowspan="2"`) +
    _mtSortTh("city", t("mt.col.ciudad"), "", ` rowspan="2"`) +
    _mtSortTh("kam", t("mt.col.kam"), "", ` rowspan="2"`) +
    kpis.map(k => `<th scope="colgroup" colspan="3" class="mt-grp">${_E(k.label)}</th>`).join("");
  const h2 = kpis.map(k =>
    _mtSortTh(`${k.id}.real`, t("mt.col.actual"), "ui-num mt-grp-start") +
    _mtSortTh(`${k.id}.meta`, t("mt.col.meta"), "ui-num") +
    _mtSortTh(`${k.id}.pct`, t("mt.col.pct"), "")
  ).join("");
  const body = vis.map(r =>
    `<tr class="${r.sinMeta ? "mt-row--sinmeta" : ""}">` +
    nameCell(r, "th", ` scope="row"`, " mt-sticky") +
    `<td class="mt-nowrap">${_E(r.cityDisp)}</td><td class="mt-nowrap">${_E(r.kamDisp)}</td>` +
    kpis.map(k => {
      const c = r.cells.find(x => x.id === k.id) || { mode: "none" };
      return _mtPartnerTds(c);
    }).join("") + `</tr>`
  ).join("");
  return tools + `<div class="ui-table-wrap mt-ptable-wrap"><table class="ui-table mt-ptable">` +
    `<thead><tr>${h1}</tr><tr>${h2}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function _mtPartnersSection(ctx) {
  _mtPartnersCtx = ctx;
  return `<section class="mt-sec">${_mtH2(t("mt.porPartner"))}<div id="mtPartners">${_mtPartnersHTML(ctx)}</div></section>`;
}
function _mtRepintarPartners() {
  const el = document.getElementById("mtPartners");
  if (!el || !_mtPartnersCtx) return;
  el.innerHTML = _mtPartnersHTML(_mtPartnersCtx);
}
export function metasSort(key) {
  if (!key) return;
  if (_MT.sort.key === key) _MT.sort.dir = _MT.sort.dir === "asc" ? "desc" : "asc";
  else {
    // Texto A→Z; % del peor al mejor; actual/meta del más grande al más chico.
    const numDesc = /\.(real|meta)$/.test(key);
    _MT.sort = { key, dir: numDesc ? "desc" : "asc" };
  }
  _mtRepintarPartners();
}
export function metasSetFiltro(v) {
  if (!_MT_FILTROS.includes(v)) return;
  _MT.filtro = v;
  _mtRepintarPartners();
}
export function metasSetVista(v) {
  if (v !== "tabla" && v !== "tarjetas") return;
  _MT.vista = v;
  _mtRepintarPartners();
}

// Fila meta-vs-actual para un KPI de tasa/valor (sin proyección). meta null → oculta.
// numKey (opcional): clave de la huella de números. (Se conserva la firma; ahora
// devuelve el bloque de KPI de la tarjeta de partner del sistema de diseño.)
export function _metaLineRow(label, actual, meta, fmtFn, metaOnlyNote, numKey) {
  if (meta == null && actual == null) return "";
  const mode = meta == null ? "real" : actual == null ? "meta" : "both";
  const pct = mode === "both" ? (meta > 0 ? (actual / meta) * 100 : 0) : null;
  return _mtCardKpi({ label, mode, real: actual, meta, pct, proj: null, F: fmtFn, numKey, note: metaOnlyNote });
}

// Celda de partner a partir de un KPI de línea: misma regla que tenía la tarjeta
// (`(m._sinMeta || mv != null) ? av : null`) — no mostrar el actual de un KPI
// que el partner no tiene en esta línea, salvo en las cuentas SIN ninguna meta.
function _mtLineCell(k, m, a, numKey) {
  const mv = k.meta(m);
  const av0 = a ? k.act(a) : null;
  const av = (m._sinMeta || mv != null) ? av0 : null;
  const base = { id: k.id, label: k.label, F: k.fmtFn || fmt, numKey, note: k.note, proj: null };
  if (mv == null && av == null) return { ...base, mode: "none" };
  if (mv == null) return { ...base, mode: "real", real: av };
  if (av == null) return { ...base, mode: "meta", meta: mv };
  return { ...base, mode: "both", real: av, meta: mv, pct: mv > 0 ? (av / mv) * 100 : 0 };
}

// ── VISTAS DE LÍNEA (Fleet / TukTuk / Combinado) ─────────────────────────────
//
// Las tres comparten EXACTAMENTE la misma estructura que Agregador —
// General (Perú) → Ciudad → KAM → Partner — porque el usuario navega entre
// líneas con el toggle y saltar de un layout a otro hace que se pierda: antes
// Fleet arrancaba directo en tarjetas de partner y TukTuk/Combinado mostraban
// un resumen país y nada más.
//
// El renderer es uno solo (`_renderMetasLineView`); cada línea solo aporta su
// descriptor de KPIs. Así, un arreglo en cómo se agrega o proyecta un número
// vale para las tres a la vez.

// Descriptor de un KPI de línea:
//   label   → texto visible
//   meta(m) → valor de meta de una fila de `metas` (null = ese partner no tiene
//             esta meta; NO es lo mismo que meta 0)
//   act(a)  → valor actual de una entrada de actuals (null = sin actual medible)
//   proj(a) → proyección al cierre (null = no aplica, ej. tasas)
//   fmtFn   → formateo del número
//   weight(a) → SOLO para KPIs de TASA. Al agregar por ciudad/KAM/país la tasa
//             se re-pondera por este denominador en vez de sumarse. Sin esto,
//             un partner con 3 autos pesaría lo mismo que uno con 300.
//   actWeight(a) → opcional: peso del ACTUAL si difiere del de la meta (la
//             aceptación pesa solo los viajes de filas que traían la tasa).
//   note    → nota al pie cuando el KPI es solo-meta

// Agrega un KPI sobre un conjunto de unidades (partner-ciudad).
// Devuelve null en `actual`/`meta` cuando NINGUNA unidad aportó el dato — eso
// es lo que permite distinguir "sin meta cargada" de "meta cero", que se ven
// igual si se colapsa todo a 0.
function _metasAggKpi(kpi, units) {
  if (kpi.weight) {
    const aw = [], mw = [];
    units.forEach(u => {
      // u.a puede ser null (hay META cargada pero NINGUN actual en el rango:
      // un partner que dejo de operar, o un filtro de fechas que lo deja fuera).
      // La linea de abajo ya lo contemplaba con el ternario, esta no: llamaba
      // kpi.weight(null) y `a.owned` reventaba la pestana ENTERA con un
      // TypeError. Encontrado al sembrar metas Fleet en local para poder
      // verificar la traduccion.
      const w  = u.a ? (kpi.weight(u.a) || 0) : 0;
      const wa = u.a && kpi.actWeight ? (kpi.actWeight(u.a) || 0) : w;
      const av = u.a ? kpi.act(u.a)  : null;
      const mv = u.m ? kpi.meta(u.m) : null;
      if (av != null) aw.push([av, wa]);
      if (mv != null) mw.push([mv, w]);
    });
    return {
      actual: aw.length ? weightedAvg(aw) : null,
      meta:   mw.length ? weightedAvg(mw) : null,
      proj:   null
    };
  }
  let a = 0, m = 0, p = 0, hasA = false, hasM = false, hasP = false;
  // Proyección de un SNAPSHOT (Active Drivers): NO se suman las proyecciones de
  // cada unidad — se reconstruye la serie del NIVEL que se está mostrando y se
  // toma su máximo.
  //
  // POR QUÉ IMPORTA (caso real, Lizzo): Lima pico 2.490 en una semana y Arequipa
  // 229 en OTRA. Sumar los máximos da 2.769, un número que nunca ocurrió; el
  // máximo de la serie total es 2.762, que sí es una semana real. La regla de
  // negocio dice "la semana con el número más alto de AD", así que la única
  // lectura fiel es la segunda. Sumar hacia arriba asumía que todas las ciudades
  // (y todos los partners) picaban el mismo día, y sobre-estimaba siempre.
  const serieAgregada = kpi.snapSeries ? {} : null;
  units.forEach(u => {
    const av = u.a ? kpi.act(u.a) : null;
    if (av != null) { a += av; hasA = true; }
    const mv = u.m ? kpi.meta(u.m) : null;
    if (mv != null) { m += mv; hasM = true; }
    if (serieAgregada) {
      const byDate = u.a ? kpi.snapSeries(u.a) : null;
      if (byDate) {
        Object.keys(byDate).forEach(d => { serieAgregada[d] = (serieAgregada[d] || 0) + byDate[d]; });
        hasP = true;
      }
      return;
    }
    const pv = (u.a && kpi.proj) ? kpi.proj(u.a) : null;
    if (pv != null) { p += pv; hasP = true; }
  });
  if (serieAgregada && hasP) p = projADbyDate(serieAgregada);
  return {
    actual: hasA ? a : null,
    meta:   hasM ? m : null,
    // Sin proyección propia, la mejor estimación es el actual (no 0, que
    // dibujaría una barra de proyección vacía y se leería como "no va a llegar").
    proj:   hasP ? p : (hasA ? a : null)
  };
}

// Aviso de escala: la META es MENSUAL, así que el % de cumplimiento solo se lee
// derecho en escala mensual. En diario y semanal el FACT de Active Drivers es un
// SNAPSHOT del período (los activos de UN día / de UNA semana) contra un
// objetivo de MES entero — comparación que da un porcentaje bajo por
// construcción, aunque el mes vaya perfecto.
//
// Caso real que motivó esto (jul 2026): el mismo negocio mostraba 25,6% en
// diario y 54,9% en semanal. Ninguno de los dos era el cumplimiento real.
function _metasEscalaAviso() {
  const m = STATE.curMode;
  if (m === "mensual") return "";
  const unidad = m === "diario" ? t("metas.aviso.unDia") : t("metas.aviso.unaSemana");
  return alertBox({ tone: "warn", title: t("mt.aviso.escala.titulo"), text: t("mt.aviso.escala.texto", { u: unidad }) });
}

// Aviso de COBERTURA: el rango del sidebar no cubre el mes entero de la meta.
// Los FLUJOS (N+R, horas) acumulan solo los períodos filtrados, así que su % va
// a quedar corto por el recorte, no por desempeño — y el snapshot (Active
// Drivers) no se ve afectado. Es el gemelo del aviso que ya tiene el deck; sin
// él, filtrar una semana se leía como incumplimiento.
export function _metasCoberturaAviso(cob, mesName) {
  if (!cob || cob.enRango === 0 || cob.enRango >= cob.total) return "";
  return alertBox({
    tone: "warn",
    title: t("mt.aviso.cob.titulo", { m: mesLabel(mesName) }),
    text: t("mt.aviso.cob.texto", { n: cob.enRango, total: cob.total })
  });
}
// Aviso de cuentas con actividad y SIN meta cargada. Su actual sí se cuenta en
// los agregados (para que el total cuadre con Rendimiento), pero no aportan
// meta — así que el % de cumplimiento queda algo inflado y hay que decirlo:
// ese % es justo lo que se presenta.
export function _metasSinMetaAviso(n, mesName) {
  if (!n) return "";
  return alertBox({
    tone: "info",
    title: t(n === 1 ? "mt.aviso.sinMeta.titulo1" : "mt.aviso.sinMeta.tituloN", { n, m: mesLabel(mesName) }),
    text: t("mt.aviso.sinMeta.texto")
  });
}
export function _metasSinPeriodosHTML(mesName) {
  return emptyState({ icon: "calendar", title: t("mt.sinPeriodos.titulo", { m: mesLabel(mesName) }), text: t("mt.sinPeriodos.texto") });
}

// I13: los filtros del sidebar se restauran de la sesión anterior sin ningún
// indicador. El encabezado de página (shell) ya los muestra como chips; acá
// queda un aviso breve dentro del contenido para que también salga en el PDF.
function _metasAlcance() {
  const f = getCurrentFilters();
  return partesAlcance({
    city: f.city, kam: kamLabel(f.kam),   // SIN_KAM → etiqueta traducida ("all" pasa igual)
    nSel: (f.selected || []).length,
    nTotal: document.querySelectorAll("#pList input").length
  }, t, cityLabel);
}
function _metasAlcanceHTML() {
  const a = _metasAlcance();
  if (!a.length) return "";
  return alertBox({ tone: "info", text: t("metas.alcance", { a: a.join(" · ") }) });
}

// Mes (con año) de la meta mostrada, para textos: "Septiembre 2026".
function _mtMesTxt(mesName) {
  const y = _metasMesActualYear(mesName);
  return mesLabel(mesName) + (y != null ? " " + y : "");
}

// "Mismo punto del mes anterior" para el delta de las tarjetas del resumen: los
// períodos del mes previo en las MISMAS posiciones que ocupan los del mes de la
// meta dentro de su mes (semana 1-2-3 contra semana 1-2-3; en mensual, el mes
// anterior entero). Si el mes previo no tiene esos períodos, o no están
// CARGADOS en la ventana (antes de la primera fecha de STATE.rawData), no hay
// delta: mejor no mostrarlo que compararlo contra ceros.
function _metasPrevFechas(mesDates) {
  if (!mesDates || !mesDates.length) return null;
  // En mensual el período ES el mes: con el mes en curso (parcial) contra el mes
  // anterior completo no hay "mismo punto" — el delta de N+R/horas diría −25%
  // por construcción. Solo se compara un mes cerrado contra el anterior.
  const mensual = STATE.curMode === "mensual";
  if (mensual && _metasProyOn) return null;
  const ym = d => reportYM(d, STATE.curMode, parseLocalDate);
  const r0 = ym(mesDates[0]);
  const todas = [...(STATE.allDates || [])].sort();
  const full = todas.filter(d => { const r = ym(d); return r.y === r0.y && r.m === r0.m; });
  const pos = mesDates.map(d => full.indexOf(d));
  if (pos.some(p => p < 0)) return null;
  const pm = r0.m === 1 ? 12 : r0.m - 1, py = r0.m === 1 ? r0.y - 1 : r0.y;
  const prevAll = todas.filter(d => { const r = ym(d); return r.y === py && r.m === pm; });
  if (pos.some(p => p >= prevAll.length)) return null;
  const prev = pos.map(p => prevAll[p]);
  let minCargada = "";
  for (const r of STATE.rawData || []) if (!minCargada || r.date < minCargada) minCargada = r.date;
  if (!minCargada || prev[0] < minCargada) return null;
  return { fechas: new Set(prev), label: t(mensual ? "mt.vsPrevMes" : "mt.vsPrev", { m: mesLabel(MES_NOMBRES[pm - 1]) }) };
}
function _mtDelta(actual, prev) {
  if (actual == null || prev == null || !(prev > 0)) return null;
  return ((actual - prev) / prev) * 100;
}

// Barra de controles de Metas: línea · mes · PDF (acción principal) · menú ⋯
// con el borrado (admin). Vive acá porque la usan TANTO el agregador como las
// vistas de línea. Las acciones quedan fuera del PDF (data-html2canvas-ignore).
function _metasControlsHTML(mesName) {
  // Una opción por (mes, AÑO): ENERO 2026 y ENERO 2027 son opciones distintas (B1).
  const _ops = opcionesMesMeta(STATE.metasData || []);
  const _sel = _metasMesElegido();
  const _selClave = _sel && _sel.mes === mesName ? _sel.clave : claveMes(mesName, _metasMesActualYear(mesName));
  const mesSel = _ops.length > 1
    ? `<label class="mt-field"><span class="mt-field__label">${escapeHTML(t("mt.mes"))}</span>` +
      `<select class="ui-select ui-select--sm" data-act-change="setMetasMes">` +
      _ops.map(o => `<option value="${escapeHTML(o.clave)}" ${o.clave === _selClave ? "selected" : ""}>${escapeHTML(mesLabel(o.mes) + (o.anio != null ? " " + o.anio : ""))}</option>`).join("") +
      `</select></label>`
    : `<span class="mt-field"><span class="mt-field__label">${escapeHTML(t("mt.mes"))}</span><strong>${escapeHTML(_mtMesTxt(mesName))}</strong></span>`;
  // Borrado (solo admin): elimina TODAS las metas del mes mostrado para poder
  // re-subir el Excel. El enforcement real es RLS (is_admin()); esto solo oculta
  // el menú. data-year: sin él, borrar "AGOSTO" borraría todos los años.
  const _delYear = _metasMesActualYear(mesName);
  const menu = STATE.isAdmin
    ? `<div class="mt-menu-wrap">` +
      `<button type="button" class="ui-btn ui-btn--ghost ui-btn--icon mt-menu-btn" aria-haspopup="menu" aria-expanded="false"` +
      ` aria-label="${escapeHTML(t("mt.masAcciones"))}" title="${escapeHTML(t("mt.masAcciones"))}" data-act="metasMenuToggle">` +
      `<span aria-hidden="true">⋯</span></button>` +
      `<div class="mt-menu" role="menu" hidden>` +
      `<button type="button" role="menuitem" class="mt-menu__item mt-menu__item--danger" data-act="deleteMetasMes"` +
      ` data-mes="${escapeHTML(mesName)}" data-year="${_delYear ?? ""}" title="${escapeHTML(t("metas.borrarMesTip", { m: mesLabel(mesName) }))}">` +
      `${icon("trash", { size: 14 })}<span>${escapeHTML(t("mt.borrarMes", { m: _mtMesTxt(mesName) }))}</span></button>` +
      `</div></div>`
    : "";
  return `<div class="mt-controls">` +
    `<div class="mt-controls__left">${metasLineToggleHTML()}${mesSel}</div>` +
    `<div class="mt-controls__right" data-html2canvas-ignore="true">` +
    btn({ label: t("mt.pdf"), variant: "primary", icon: "download", act: "downloadMetasPDF", id: "metasPdfBtn" }) +
    menu + `</div></div>`;
}

// Menú ⋯: abre/cierra; se cierra al hacer clic afuera o con Escape.
function _mtCerrarMenus(excepto) {
  document.querySelectorAll(".mt-menu-wrap").forEach(w => {
    if (w === excepto) return;
    const m = w.querySelector(".mt-menu"), b = w.querySelector(".mt-menu-btn");
    if (m) m.hidden = true;
    if (b) b.setAttribute("aria-expanded", "false");
  });
}
export function metasMenuToggle(el) {
  const w = el && el.closest(".mt-menu-wrap");
  if (!w) return;
  const m = w.querySelector(".mt-menu");
  const abrir = m.hidden;
  _mtCerrarMenus(w);
  m.hidden = !abrir;
  el.setAttribute("aria-expanded", String(abrir));
  if (abrir) m.querySelector("button")?.focus();
}
if (typeof document !== "undefined") {
  document.addEventListener("click", e => {
    const w = e.target && e.target.closest ? e.target.closest(".mt-menu-wrap") : null;
    _mtCerrarMenus(w);
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const abierto = document.querySelector(".mt-menu:not([hidden])");
    if (!abierto) return;
    const b = abierto.closest(".mt-menu-wrap")?.querySelector(".mt-menu-btn");
    _mtCerrarMenus(null);
    b?.focus();
  });
}

// Universo de unidades de una línea (Fleet / TukTuk / Combinado) — la misma
// para la pestaña y para el resumen país (metasResumenPais).
function _metasLineUnits(metaRows, act) {
  // Universo de unidades a mostrar: toda fila de meta de esta línea, más su
  // actual si existe. Se indexa por (partner, ciudad) — la misma granularidad
  // en la que se cargan las metas.
  const units = metaRows.map(m => ({ m, a: act.get(`${m.partner}|||${m.city}`) || null }));

  // …Y TAMBIÉN las cuentas que tienen ACTIVIDAD pero NINGUNA meta cargada este
  // mes. Antes quedaban fuera por completo, y por eso el "actual" de Metas no
  // cuadraba con el de Rendimiento (reportado por Manuel, sep-2026: 27.200 acá
  // vs 27.324 allá, −124 conductores; N+R 5.608 vs 5.632). Rendimiento parte de
  // la actividad real, Metas partía del plan: dos universos distintos mostrando
  // cifras que se leen como si fueran la misma.
  //
  // `m` sintético (sin ninguna m* de meta) en vez de `m: null`: así las cuatro
  // secciones de abajo —que agrupan por m.city / m.kam y pintan m.partner— siguen
  // funcionando sin tocarlas, y `_metasAggKpi` ya descarta las metas con su
  // `mv != null` (un campo ausente da undefined, que no pasa ese filtro).
  // Resultado: SUMAN al actual, NO suman a la meta.
  const conMeta = new Set(metaRows.map(m => `${m.partner}|||${m.city}`));
  act.forEach((a, key) => {
    if (conMeta.has(key)) return;
    const sep     = key.lastIndexOf("|||");
    const partner = key.slice(0, sep);
    const city    = key.slice(sep + 3);
    units.push({ m: { partner, city, kam: getKAMForPartner(partner) || SIN_KAM, _sinMeta: true }, a });
  });
  return units;
}

// Renderer común de una línea. `cfg`:
//   line/title/info       → id de la línea (huella), título, descripción (tooltip)
//   metaRows              → filas de STATE.metasData del mes/filtros, ya acotadas
//   act                   → Map "partner|||city" → actual
//   actFn(fechasSet)      → recalcula `act` para otro juego de fechas (delta)
//   kpis                  → descriptores (arriba)
//   emptyTitle            → título del estado vacío si no hay metas de la línea
function _renderMetasLineView(cfg) {
  const { mesName, metaRows, act, kpis } = cfg;
  const _nk = (...partes) => ["metas", cfg.line, ...partes].join(".");   // huella de números

  let html = _metasControlsHTML(mesName);
  // Los avisos de escala y de cobertura hablan de Conductores activos (snapshot)
  // y de N+R/Horas (flujos) contra una meta mensual: no aplican a Fleet, cuyos
  // KPIs son tasas que no dependen del largo del período.
  const tasas = cfg.line === "fleet";
  let alerts = _metasAlcanceHTML() + (tasas ? "" : _metasEscalaAviso() + _metasCoberturaAviso(cfg.cobertura, mesName));
  if (cfg.cobertura && cfg.cobertura.enRango === 0) {
    return html + _mtAlerts(alerts) + _metasSinPeriodosHTML(mesName);
  }
  if (!metaRows.length) {
    return html + _mtAlerts(alerts) + emptyState({
      icon: "target", title: cfg.emptyTitle, text: t("mt.vacio.texto"),
      action: btn({ label: t("mt.irCalculadora"), variant: "secondary", icon: "calculator", act: "switchTab", data: { tab: "calculator" } })
    });
  }

  const units = _metasLineUnits(metaRows, act);
  const nSinMeta = units.length - metaRows.length;
  alerts += _metasSinMetaAviso(nSinMeta, mesName);
  html += _mtAlerts(alerts);

  // Delta de las tarjetas: mismo cálculo (actFn) sobre los períodos equivalentes
  // del mes anterior. El total de actual = agregado de TODAS las entradas de
  // actuals (las filas de meta sin actual no aportan), así que el anterior se
  // agrega igual para que sean comparables.
  const prev = cfg.actFn ? _metasPrevFechas(cfg.mesDates) : null;
  const prevUnits = prev ? [...cfg.actFn(prev.fechas).values()].map(a => ({ m: null, a })) : null;
  const mesTxt = mesLabel(mesName);

  // ── 1. Resumen ────────────────────────────────────────────────────────────
  html += `<section class="mt-sec">${_mtH2(t("mt.resumen", { m: _mtMesTxt(mesName) }), cfg.info)}<div class="ui-kpi-grid mt-kpis">`;
  // Actual / meta / proyección: los de metasResumenPais (misma función que usa
  // Rendimiento para su barra de avance), no un cálculo propio.
  const resumen = _metasResumenDeUnits(kpis, units, _metasProyOn);
  kpis.forEach(k => {
    const g = resumen[k.id];
    if (g.meta == null && g.actual == null) return;
    const dlt = prevUnits ? _mtDelta(g.actual, _metasAggKpi(k, prevUnits).actual) : undefined;
    html += metaResCard(k.label, k.sub || "", g.actual, g.meta, g.proj, null, k.fmtFn, _nk("pais", k.id),
      g.actual != null ? dlt : undefined, prev ? prev.label : "", mesTxt);
  });
  html += `</div></section>`;

  const rowsDe = (us, nk) => kpis.map(k => {
    const g = _metasAggKpi(k, us);
    if (g.meta == null && g.actual == null) return null;
    return { label: k.label, real: g.actual, meta: g.meta, proj: g.proj, F: k.fmtFn, numKey: nk(k) };
  });

  // ── 2. Por Ciudad ─────────────────────────────────────────────────────────
  const byCity = new Map();
  units.forEach(u => {
    const c = u.m.city || "";
    if (!c) return;
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(u);
  });
  if (byCity.size) {
    // Orden: CITIES primero (orden canónico del dashboard), después cualquier
    // ciudad que aparezca en metas y no esté en esa lista — que existan es un
    // dato de la BD, no un motivo para esconderlas.
    const cityOrder = [...CITIES.filter(c => byCity.has(c)),
                       ...[...byCity.keys()].filter(c => !CITIES.includes(c)).sort()];
    const groups = cityOrder.map(city => {
      const us = byCity.get(city) || [];
      return { name: cityLabel(city), dot: _mtCatCity(city), count: us.length,
               rows: rowsDe(us, k => _nk("ciudad", k.id, city)) };
    });
    html += `<section class="mt-sec">${_mtH2(t("mt.porCiudad"))}${_mtGroupTable(t("mt.col.ciudad"), groups)}</section>`;
  }

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  const byKam = new Map();
  units.forEach(u => {
    const k = _metasKamDe(u.m);
    if (!byKam.has(k)) byKam.set(k, []);
    byKam.get(k).push(u);
  });
  if (byKam.size) {
    const groups = [...byKam.keys()].sort().map(kam => {
      const us = byKam.get(kam) || [];
      return { name: kamLabel(kam), dot: _mtCatKam(kam), count: us.length,
               rows: rowsDe(us, k => _nk("kam", k.id, kam)) };
    });
    html += `<section class="mt-sec">${_mtH2(t("mt.porKam"))}${_mtGroupTable(t("mt.col.kam"), groups)}</section>`;
  }

  // ── 4. Por Partner ────────────────────────────────────────────────────────
  const rows = units.map(u => {
    const m = u.m, a = u.a, kam = _metasKamDe(m);
    return {
      partner: m.partner, cityDisp: cityLabel(m.city), kamDisp: kamLabel(kam), kamRaw: kam,
      sinMeta: !!m._sinMeta, color: STATE.partnerColors[m.partner] || "var(--cat-other)",
      tip:  cfg.partnerTip && !m._sinMeta ? cfg.partnerTip(m, a) : "",
      note: cfg.partnerNote ? cfg.partnerNote(m, a) : "",
      cells: kpis.map(k => _mtLineCell(k, m, a, _nk("partner", k.id, `${m.partner}@${m.city}`)))
    };
  });
  html += _mtPartnersSection({ rows, kpis: kpis.map(k => ({ id: k.id, label: k.label })) });
  return html;
}

// Filtro común de filas de meta de una línea. `mesYearSel` explícito (y no
// leído de la selección de la pestaña): así el resumen que usa Rendimiento no
// depende de qué mes quedó elegido en Metas.
function _metasLineRows(mesName, mesYearSel, hasLineMeta, selSet, cityFilter, kamFilter) {
  return STATE.metasData.filter(m =>
    _metasMatchMes(m, mesName, mesYearSel) &&
    hasLineMeta(m) &&
    (kamFilter === "all" || _metasKamDe(m) === kamFilter) &&
    (!selSet.size || _lineSelHas(selSet, new Set(STATE.sidebarPartners || STATE.allPartners), m.partner)) &&
    (cityFilter === "all" || m.city === cityFilter)
  ).sort((a, b) => a.partner.localeCompare(b.partner));
}

// Descriptor completo de una línea (Fleet / TukTuk / Combinado): actuales,
// filas de meta y KPIs. Lo usan el renderer de la pestaña (_renderMetasLineView)
// y el resumen país (metasResumenPais) — un único armado para los dos.
function _metasLineCfg(line, mesName, mesYearSel, fechas, selSet, cityFilter, kamFilter) {
  const base = { line, mesDates: [...fechas].sort() };
  // Vista Metas Fleet. Sus KPIs son TASAS (SH/auto, aceptación), no cantidades:
  // por eso llevan `weight` y NO llevan proyección — proyectar una tasa al cierre
  // del mes por ritmo lineal no significa nada (una tasa no se acumula).
  if (line === "fleet") return {
    ...base, info: t("metas.fleetSub"),
    act: _metasFleetActuals(fechas, selSet, cityFilter),
    actFn: f => _metasFleetActuals(f, selSet, cityFilter),
    metaRows: _metasLineRows(mesName, mesYearSel,
      m => m.mSHcar != null || m.mAcc != null || m.mUtil != null,
      selSet, cityFilter, kamFilter),
    kpis: [
      { id: "shCar", label: t("metas.kpi.shAuto"), sub: t("metas.pond"),
        meta: m => m.mSHcar, act: a => a.shCar, proj: null,
        weight: a => a.owned, fmtFn: v => fmt(v) },
      { id: "accept", label: t("metas.kpi.aceptacion"), sub: t("metas.pondViajes"),
        meta: m => m.mAcc, act: a => a.accept, proj: null,
        weight: a => a.trips, actWeight: a => a.accTrips, fmtFn: v => fmt(v) + "%" },
      { id: "util", label: t("metas.kpi.utilizacion"), sub: t("metas.soloMeta"),
        meta: m => m.mUtil, act: () => null, proj: null,
        weight: a => a.owned, fmtFn: v => fmt(v) + "%", note: t("metas.sinActual") }
    ],
    // Autos propios: dato de contexto, no un KPI contra meta → en la tarjeta como
    // nota y en la tabla como tooltip del partner.
    partnerNote: (m, a) => a ? t("metas.autosPropios", { n: fmt(a.ownedNow || 0), b: fmt(a.branded || 0) }) : "",
    partnerTip:  (m, a) => a ? t("metas.autosPropios", { n: fmt(a.ownedNow || 0), b: fmt(a.branded || 0) }) : "",
    emptyTitle: t("mt.vacio.fleet", { m: mesLabel(mesName) })
  };
  // Vista Metas TukTuk: KPIs aditivos (AD/N+R/Brandeados/Horas).
  if (line === "tk") return {
    ...base, info: t("metas.tkSub"),
    act: _metasTkActuals(fechas, selSet, cityFilter),
    actFn: f => _metasTkActuals(f, selSet, cityFilter),
    metaRows: _metasLineRows(mesName, mesYearSel,
      m => m.mtkAD != null || m.mtkNR != null || m.mtkCars != null || m.mtkSH != null,
      selSet, cityFilter, kamFilter),
    kpis: [
      { id: "ad", label: t("metas.activeDrivers"), sub: t("metas.ultimoPeriodo"),
        meta: m => m.mtkAD, act: a => a.ad, proj: a => a.projAd,
        snapSeries: a => a.adByDate, fmtFn: v => fmt(v) },
      { id: "nr", label: t("metas.nuevosReact"), sub: t("metas.acumulado"),
        meta: m => m.mtkNR, act: a => a.nr, proj: a => a.projNr, fmtFn: v => fmt(v) },
      { id: "cars", label: t("metas.brandeados"), sub: t("metas.ultimoPeriodo"),
        // Brandeados NO lleva snapSeries: su proyección es PLANA (= nivel
        // actual), igual que AD desde ago 2026 — la nota histórica del ×1.4 vive en
        // Active Drivers, no de cualquier snapshot.
        meta: m => m.mtkCars, act: a => a.cars, proj: a => a.cars, fmtFn: v => fmt(v) },
      { id: "sh", label: t("metas.horasConexion"), sub: t("metas.acumulado"),
        meta: m => m.mtkSH, act: a => a.sh, proj: a => a.projSh, fmtFn: v => fmtSmart(v) }
    ],
    emptyTitle: t("mt.vacio.tk", { m: mesLabel(mesName) })
  };
  // Vista Metas COMBINADO (Taxi+TukTuk): actuales sumados de ambas líneas vs meta
  // combinada. Misma fórmula que la slide "Avance Combinado" de Presentación 2.0
  // — si el partner se enfoca en TukTuk, ese avance también cuenta para su meta.
  //
  // META PARAGUAS: mA/mNR/mH YA cubren Taxi + TukTuk juntos (decisión ago 2026,
  // verificada contra la proporción real de cada línea). Sumarles meta_tk_* era
  // contar el objetivo de TukTuk DOS veces: en agosto-2026 TRANSPOTAXI Lima
  // pasaba de 2.661 a 3.785 AD de plan (+42%) y de 651 a 1.015 de N+R (+56%),
  // así que la misma cuenta mostraba ~60% acá y ~86% en el deck. El deck ya usa
  // el paraguas; esta vista y el portal se quedaron atrás.
  //
  // meta_tk_* NO es basura: `meta_tk_nr` sigue siendo la meta del CRITERIO
  // TukTuk (nuevos + reactivados del mes) y se muestra en la vista TukTuk y en
  // el Resumen del deck. Lo que no se puede es sumarla al paraguas.
  const umbrella = v => (v == null || v === 0) ? null : v;
  return {
    ...base, line: "comb", info: t("metas.combSub"),
    act: _metasCombActuals(fechas, selSet, cityFilter),
    actFn: f => _metasCombActuals(f, selSet, cityFilter),
    metaRows: _metasLineRows(mesName, mesYearSel,
      m => (m.mA || 0) > 0 || (m.mNR || 0) > 0 || (m.mH || 0) > 0 ||
           m.mtkAD != null || m.mtkNR != null || m.mtkSH != null,
      selSet, cityFilter, kamFilter),
    kpis: [
      { id: "ad", label: t("metas.activeDrivers"), sub: t("metas.ultimoPeriodo"),
        meta: m => umbrella(m.mA), act: a => a.ad, proj: a => a.projAd,
        snapSeries: a => a.adByDate, fmtFn: v => fmt(v) },
      { id: "nr", label: t("metas.nuevosReact"), sub: t("metas.acumulado"),
        meta: m => umbrella(m.mNR), act: a => a.nr, proj: a => a.projNr, fmtFn: v => fmt(v) },
      { id: "sh", label: t("metas.horasConexion"), sub: t("metas.acumulado"),
        meta: m => umbrella(m.mH), act: a => a.sh, proj: a => a.projSh, fmtFn: v => fmtSmart(v) }
    ],
    // Aclaración de la meta paraguas: detalle para quien lo busca (tooltip), no
    // jerga en la tarjeta ("criterio TukTuk aparte: 28 N+R").
    partnerTip: m => m.mtkNR != null ? t("mt.pieCombTk", { n: fmt(m.mtkNR) }) : "",
    emptyTitle: t("mt.vacio.comb", { m: mesLabel(mesName) })
  };
}

export function _renderMetasFleet(mesName, fechas, selSet, cityFilter, kamFilter, mesesDisponibles, cobertura) {
  return _renderMetasLineView({ mesName, mesesDisponibles, cobertura,
    ..._metasLineCfg("fleet", mesName, _metasMesActualYear(mesName), fechas, selSet, cityFilter, kamFilter) });
}
export function _renderMetasTk(mesName, fechas, selSet, cityFilter, kamFilter, mesesDisponibles, cobertura) {
  return _renderMetasLineView({ mesName, mesesDisponibles, cobertura,
    ..._metasLineCfg("tk", mesName, _metasMesActualYear(mesName), fechas, selSet, cityFilter, kamFilter) });
}
export function _renderMetasComb(mesName, fechas, selSet, cityFilter, kamFilter, mesesDisponibles, cobertura) {
  return _renderMetasLineView({ mesName, mesesDisponibles, cobertura,
    ..._metasLineCfg("comb", mesName, _metasMesActualYear(mesName), fechas, selSet, cityFilter, kamFilter) });
}

// ── AGREGADOR: metas y FACT por partner (compartido por la pestaña y el resumen) ──
// Filas de meta del agregador para el mes/filtros.
function _metasAggMetas(mesName, mesYearSel, sel, selSet, cityFilter, kamFilter) {
  return STATE.metasData.filter(m => {
    if (!_metasMatchMes(m, mesName, mesYearSel))    return false;
    if (kamFilter !== "all" && _metasKamDe(m) !== kamFilter) return false;
    // Mismo recorte de ciudad que el FACT: sin esto, con Ciudad=Arequipa los
    // totales de plan (Perú y por KAM) sumaban las metas de TODAS las ciudades
    // contra un FACT solo-Arequipa → % de cumplimiento hundido artificialmente.
    if (cityFilter !== "all" && m.city !== cityFilter) return false;
    if (sel.length && !selSet.has(m.partner))     return false;
    return true;
  });
}
// Proyección de AD del NIVEL (no la suma de las de cada partner): se juntan
// las series por fecha y se toma el máximo del total. Sumar los máximos
// individuales asume que todos los partners picaron la misma semana y
// sobre-estima siempre. Ver la nota en _metasAggKpi.
function _metasProjADde(arr) {
  const merged = {};
  arr.forEach(c => {
    const m = c.adByDate || {};
    Object.keys(m).forEach(d => { merged[d] = (merged[d] || 0) + m[d]; });
  });
  return projADbyDate(merged);
}
// FACT por partner (con y sin meta) sobre un juego de fechas: el del mes de la
// meta y, para el delta de las tarjetas, el de los períodos equivalentes del mes
// anterior.
function _metasAggCombos(metas, fechasX, desde, hasta, conDiag, selSet, cityFilter, kamFilter) {
  const perfF  = getFilteredByDateRange(desde, hasta).filter(r => fechasX.has(r.date));
  const cpMap  = {};
  // Diagnostico: trackear breakdown de los 3 componentes de N+R
  let _diagNP = 0, _diagNS = 0, _diagRE = 0;
  perfF.forEach(r => {
    const k = `${r.partner}|||${r.city}|||${r.date}`;
    if (!cpMap[k]) cpMap[k] = { partner: r.partner, city: r.city, date: r.date, ad: 0, nr: 0, sh: 0 };
    cpMap[k].ad += r.activeDrivers;
    cpMap[k].nr += r.newPartner + r.newService + r.reactivated;
    cpMap[k].sh += r.supplyHours;
    _diagNP += r.newPartner   || 0;
    _diagNS += r.newService   || 0;
    _diagRE += r.reactivated  || 0;
  });
  const cpRows = Object.values(cpMap);

  // Diagnostico de N+R: imprime breakdown y advierte si solo hay reactivados
  // (sintoma de que el upload no capturo new_from_partner / new_from_service)
  if (conDiag && perfF.length) {
    if (DEBUG) console.log(`[METAS ${STATE.curMode}] Breakdown N+R en rango ${desde} → ${hasta}:`,
      { newPartner: _diagNP, newService: _diagNS, reactivated: _diagRE,
        total: _diagNP + _diagNS + _diagRE });
    if ((_diagNP + _diagNS) === 0 && _diagRE > 0) {
      console.warn(
        "[METAS] new_from_partner y new_from_service son 0 en la BD. " +
        "El upload del Excel no capturo esas columnas. " +
        "Verifica los nombres de columna en el Excel (deben contener 'from partner', " +
        "'from service' o 'new drivers')."
      );
    }
  }

  // Proyección al cierre: días transcurridos del MES DE LA META (no del mes
  // calendario de la última fecha — en semanal la del 29-jun reporta en julio).
  const maxDate = cpRows.length ? cpRows.map(r => r.date).sort().at(-1) : ([...fechasX].sort().at(-1) || hasta);
  const { daysElapsed, daysRemaining } = diasMesReporte(maxDate, STATE.curMode, parseLocalDate);

  // Pre-indexar cpRows por partner y por partner+city UNA vez.
  // Antes getRPC hacia cpRows.filter() ~550 veces (O(n) por call).
  // Ahora es O(1) lookup. Reduce ~150-300ms en datasets grandes.
  const cpByPartnerAll  = new Map(); // partner → rows[]   (todas las ciudades)
  const cpByPartnerCity = new Map(); // "partner|||city" → rows[]
  cpRows.forEach(r => {
    let a = cpByPartnerAll.get(r.partner);
    if (!a) { a = []; cpByPartnerAll.set(r.partner, a); }
    a.push(r);
    const k = `${r.partner}|||${r.city}`;
    let b = cpByPartnerCity.get(k);
    if (!b) { b = []; cpByPartnerCity.set(k, b); }
    b.push(r);
  });

  function getRPC(partner, city) {
    const rows = (city === "" || city === "all")
      ? (cpByPartnerAll.get(partner) || [])
      : (cpByPartnerCity.get(`${partner}|||${city}`) || []);
    if (!rows.length) return { ad: 0, nr: 0, sh: 0, lastAD: 0, nrV: [], shV: [], adV: [], adByDate: {} };
    // Agregar por fecha (sumando ciudades cuando city = "all")
    const bd = {};
    rows.forEach(r => {
      if (!bd[r.date]) bd[r.date] = { ad: 0, nr: 0, sh: 0 };
      bd[r.date].ad += r.ad; bd[r.date].nr += r.nr; bd[r.date].sh += r.sh;
    });
    const sortedDates = Object.keys(bd).sort();
    const sorted = sortedDates.map(d => bd[d]);
    // Mapa fecha -> AD: hace falta para proyectar a nivel ciudad/KAM/país sobre
    // la serie AGREGADA de ese nivel, en vez de sumar proyecciones por partner
    // (ver la nota larga en _metasAggKpi).
    const adByDate = {};
    sortedDates.forEach(d => { adByDate[d] = bd[d].ad; });
    // Calcular max/sum en una sola pasada en lugar de 3 pasadas
    let adMax = 0, nrSum = 0, shSum = 0;
    const nrV = [], shV = [], adV = [];
    for (const v of sorted) {
      if (v.ad > adMax) adMax = v.ad;
      nrSum += v.nr;
      shSum += v.sh;
      nrV.push(v.nr);
      shV.push(v.sh);
      adV.push(v.ad);
    }
    return {
      ad:     adMax,
      nr:     nrSum,
      sh:     shSum,
      // B10 (sep-2026): el snapshot es el del ÚLTIMO PERÍODO DEL RANGO (maxDate),
      // no el último período con dato de ESTE partner. Con el segundo, un
      // partner que dejó de operar a mitad de mes seguía sumando su último AD
      // al país pero no a su ciudad (que ya miraba la última fecha): en semanal
      // AGOSTO, PUENTE PIEDRA (último dato el 10-ago) inflaba Perú en 166 y
      // Perú ≠ Σ ciudades.
      lastAD: bd[maxDate]?.ad || 0,
      nrV,
      shV,
      adV,      // serie por periodo: alimenta projectSnapshot (proyeccion plana)
      adByDate  // misma serie keyed por fecha, para re-agregar por nivel
    };
  }

  // Build combos (partner+city)
  let combos = [];
  if (cityFilter === "all") {
    const pm = {};
    metas.forEach(m => {
      if (!pm[m.partner]) pm[m.partner] = { partner: m.partner, kam: _metasKamDe(m), mA: 0, mNR: 0, mH: 0 };
      pm[m.partner].mA  += m.mA;
      pm[m.partner].mNR += m.mNR;
      pm[m.partner].mH  += m.mH;
    });
    Object.values(pm).forEach(p => {
      const r = getRPC(p.partner, "all");
      combos.push({ partner: p.partner, kam: p.kam, city: "Todas",
        mA: p.mA, mNR: p.mNR, mH: p.mH,
        ad: r.lastAD, nr: r.nr, sh: r.sh,
        projAD: projADbyDate(r.adByDate),
        adByDate: r.adByDate,
        projNR: projA(r.nrV, daysElapsed, daysRemaining),
        projSH: projA(r.shV, daysElapsed, daysRemaining) });
    });
  } else {
    metas.filter(m => m.city === cityFilter).forEach(m => {
      const r = getRPC(m.partner, m.city);
      combos.push({ partner: m.partner, kam: _metasKamDe(m), city: m.city,
        mA: m.mA, mNR: m.mNR, mH: m.mH,
        ad: r.lastAD, nr: r.nr, sh: r.sh,
        projAD: projADbyDate(r.adByDate),
        adByDate: r.adByDate,
        projNR: projA(r.nrV, daysElapsed, daysRemaining),
        projSH: projA(r.shV, daysElapsed, daysRemaining) });
    });
  }

  // Agregar partners CON performance pero SIN meta. Su FACT y proyección
  // suman al KAM/Ciudad/Peru aunque no tengan plan asignado. Plan = 0.
  const partnersWithMetaSet = new Set(combos.map(c => c.partner));
  const partnersInPerf = [...new Set(cpRows.map(r => r.partner))]
    .filter(p => selSet.has(p) && !partnersWithMetaSet.has(p));

  partnersInPerf.forEach(p => {
    const partnerKam = getKAMForPartner(p) || SIN_KAM;
    // Si el usuario filtra por KAM, excluir partners sin meta de otros KAMs
    if (kamFilter !== "all" && partnerKam !== kamFilter) return;
    const r = getRPC(p, cityFilter === "all" ? "all" : cityFilter);
    if (r.ad === 0 && r.nr === 0 && r.sh === 0) return;
    combos.push({
      partner: p,
      kam: partnerKam,
      city: cityFilter === "all" ? t("metas.sinPlan") : cityFilter,
      mA: 0, mNR: 0, mH: 0,
      ad: r.lastAD, nr: r.nr, sh: r.sh,
      projAD: projADbyDate(r.adByDate),
      adByDate: r.adByDate,
      projNR: projA(r.nrV, daysElapsed, daysRemaining),
      projSH: projA(r.shV, daysElapsed, daysRemaining),
      noMeta: true
    });
  });
  return { perfF, combos, maxDate, daysElapsed, daysRemaining };
}

// Totales país del agregador (tarjetas del resumen).
function _metasAggTotales(metas, combos) {
  return {
    tMA:  metas.reduce((s, m) => s + m.mA,  0),
    tMNR: metas.reduce((s, m) => s + m.mNR, 0),
    tMH:  metas.reduce((s, m) => s + m.mH,  0),
    tAD:  combos.reduce((s, c) => s + c.ad,  0),
    tNR:  combos.reduce((s, c) => s + c.nr,  0),
    tSH:  combos.reduce((s, c) => s + c.sh,  0),
    tPAD: _metasProjADde(combos),
    tPNR: combos.reduce((s, c) => s + c.projNR, 0),
    tPSH: combos.reduce((s, c) => s + c.projSH, 0)
  };
}

// ── RESUMEN PAÍS (única fuente de las tarjetas del resumen) ──────────────────
// Lo usan las tarjetas "Resumen" de esta pestaña Y la barra de avance contra la
// meta de Rendimiento (metasResumenPais). Antes Rendimiento pintaba los
// renderers de Metas fuera de pantalla y leía las cifras del HTML, y la
// proyección dependía de un estado de módulo que dejaba el último render de
// Metas: la barra de Rendimiento mostraba (o no) la proyección según qué se
// hubiera abierto antes en Metas.
function _metasKpiResumen(actual, meta, proj, proyOn, F) {
  return {
    actual, meta,
    pct: actual != null && meta > 0 ? (actual / meta) * 100 : null,
    proj: proyOn ? (proj ?? null) : null,
    F: F || fmt
  };
}
function _metasResumenDeUnits(kpis, units, proyOn) {
  const out = {};
  kpis.forEach(k => {
    const g = _metasAggKpi(k, units);
    out[k.id] = _metasKpiResumen(g.actual, g.meta, g.proj, proyOn, k.fmtFn);
  });
  return out;
}
function _metasAggResumen(metas, combos, proyOn) {
  const T = _metasAggTotales(metas, combos);
  return {
    ad: _metasKpiResumen(T.tAD, T.tMA,  T.tPAD, proyOn, fmt),
    nr: _metasKpiResumen(T.tNR, T.tMNR, T.tPNR, proyOn, fmt),
    sh: _metasKpiResumen(T.tSH, T.tMH,  T.tPSH, proyOn, fmt)
  };
}

/**
 * Resumen país de una línea para un mes: por KPI `{ actual, meta, pct, proj, F }`
 * — exactamente las cifras de las tarjetas "Resumen" de la pestaña Metas con
 * los mismos filtros. Sin estado de módulo: la proyección (solo mes en curso,
 * domain/mesEnCurso) se decide en cada llamada.
 *
 *   line     "comb" | "agg" | "fleet" | "tk"
 *   mesName  nombre del mes de la meta ("SEPTIEMBRE") o "YYYY-MM"
 *   anio     año de la meta (metas.mes_year); null = sin año; undefined = el
 *            que elegiría la pestaña Metas
 *   fechas   períodos del mes DENTRO del rango (ver _metasFechasDelMes)
 *   filtros  { city, kam, selected } — los del panel (getCurrentFilters)
 *
 * Devuelve null si no hay metas o no hay períodos; `sinMetas: true` (kpis
 * vacíos) si la línea no tiene ninguna fila de meta ese mes — la pestaña Metas
 * muestra en ese caso el estado vacío, sin tarjetas.
 */
export function metasResumenPais({ line, mesName, anio, fechas, filtros = {} }) {
  if (!mesName || !(STATE.metasData || []).length) return null;
  const mesDates = [...(fechas || [])].sort();
  if (!mesDates.length) return null;
  const mesYearSel = anio !== undefined ? anio : _metasMesActualYear(mesName);
  const fset = new Set(mesDates);
  const cityFilter = filtros.city || "all";
  const kamFilter  = filtros.kam  || "all";
  const sel    = filtros.selected || [];
  const selSet = new Set(sel);
  const proyOn = _metasCalcProyOn(mesName, mesYearSel, mesDates);
  const base = { line, mes: mesName, anio: mesYearSel, proyOn, mesLabel: mesLabel(mesName) };
  if (line === "agg") {
    const metas = _metasAggMetas(mesName, mesYearSel, sel, selSet, cityFilter, kamFilter);
    const { combos } = _metasAggCombos(metas, fset, mesDates[0], mesDates[mesDates.length - 1], false, selSet, cityFilter, kamFilter);
    return { ...base, sinMetas: !metas.length, kpis: _metasAggResumen(metas, combos, proyOn) };
  }
  const cfg = _metasLineCfg(line, mesName, mesYearSel, fset, selSet, cityFilter, kamFilter);
  if (!cfg.metaRows.length) return { ...base, sinMetas: true, kpis: {} };
  return { ...base, sinMetas: false, kpis: _metasResumenDeUnits(cfg.kpis, _metasLineUnits(cfg.metaRows, cfg.act), proyOn) };
}

// Guard de reentrancia: doble-click o filtros solapados no deben lanzar dos
// renders concurrentes (mismo patron que rendimiento.js).
export let _renderMetasBusy = false;
export function renderMetas() {
  if (_renderMetasBusy) return;
  if (!STATE.metasData.length) return;
  // B12: ver renderRend — no pintar el FACT de otra escala bajo el rótulo de esta.
  if (!escalaLista(STATE)) {
    const c = document.getElementById("metasContent");
    const e = document.getElementById("metasEmpty");
    if (c) {
      if (e) e.style.display = "none";
      c.style.display = "";
      c.innerHTML = alertBox({ tone: "info", text: t("carga.escala", { e: t("mode." + (STATE.curMode || "semanal")) }) });
    }
    reintentarCuandoEscalaLista("metas", STATE, renderMetas, () => STATE.curTab === "metas");
    return;
  }
  _renderMetasBusy = true;
  try {
    _renderMetasImpl();
  } finally {
    _renderMetasBusy = false;
  }
}

export function _renderMetasImpl() {
  // Garantiza índices secundarios construidos antes de cualquier lookup
  ensureIndexes();

  const cityFilter = document.getElementById("cityFilter").value;
  const kamFilter  = document.getElementById("kamFilter").value;
  const sel        = getSel();
  const from       = document.getElementById("dateFrom").value;
  const to         = document.getElementById("dateTo").value;
  const selSet     = new Set(sel);

  // Detectar el mes MAS RECIENTE de metasData y limitar el render a ese mes.
  // Antes: mostraba metasData[0].mes (primer registro = mes mas antiguo) y
  // sumaba metas de TODOS los meses, inflando %% de cumplimiento.
  // Mes elegido = selección manual o, por defecto, el último mes CON DATOS
  // (_metasMesElegido). Orden por año*100+mes (B1): en enero, ENERO 2027 va
  // antes que DICIEMBRE 2026.
  const _mesElegido = _metasMesElegido();
  const mesesDisponibles = [...new Set(opcionesMesMeta(STATE.metasData || []).map(o => o.mes))];
  const mesName = _mesElegido ? _mesElegido.mes : "";
  // Año del mes seleccionado (el más reciente si hay más de uno) — ver
  // _metasMatchMes. Sin esto, AGOSTO-2025 y AGOSTO-2026 se sumaban juntos.
  const mesYearSel = _metasMesActualYear(mesName);

  // El FACT se acota al MES DE LA META dentro del rango elegido (ver
  // _metasFechasDelMes): la meta es mensual, así que comparar contra un rango que
  // abarca otros meses da un % que no significa nada.
  const mesDates   = _metasFechasDelMes(mesName, mesYearSel, from, to);
  const fechas     = new Set(mesDates);
  const cobertura  = { enRango: mesDates.length,
                       total: _metasFechasMesCompleto(mesName, mesYearSel, to).length };
  // Decisión 4: la proyección al cierre solo se dibuja para el mes en curso.
  _metasProyOn = _metasCalcProyOn(mesName, mesYearSel, mesDates);

  // Fase 3: líneas Fleet / TukTuk. Vista dedicada (meta vs actual de la línea) que
  // reemplaza el cuerpo de Metas. El agregador sigue con el flujo de abajo intacto.
  if (_metasLine() !== "agg") {
    document.getElementById("metasEmpty").style.display   = "none";
    document.getElementById("metasContent").style.display = "";
    const _line = _metasLine();
    document.getElementById("metasContent").innerHTML =
        _line === "fleet" ? _renderMetasFleet(mesName, fechas, selSet, cityFilter, kamFilter, mesesDisponibles, cobertura)
      : _line === "comb"  ? _renderMetasComb(mesName, fechas, selSet, cityFilter, kamFilter, mesesDisponibles, cobertura)
      :                     _renderMetasTk(mesName, fechas, selSet, cityFilter, kamFilter, mesesDisponibles, cobertura);
    return;
  }

  const metas = _metasAggMetas(mesName, mesYearSel, sel, selSet, cityFilter, kamFilter);

  // Build performance data by partner+city+date (full precision).
  // Acotado al MES DE LA META dentro del rango: ver _metasFechasDelMes.
  //
  // Ola 6: el armado de `combos` (FACT por partner con y sin meta) se envolvió en
  // una función para poder correrlo también sobre los períodos equivalentes del
  // mes anterior (delta de las tarjetas del resumen). Para el mes de la meta es
  // EXACTAMENTE el mismo código de antes, con las mismas fechas.
  const _combosPara = (fechasX, desde, hasta, conDiag) =>
    _metasAggCombos(metas, fechasX, desde, hasta, conDiag, selSet, cityFilter, kamFilter);

  const { perfF, combos, maxDate, daysElapsed, daysRemaining } = _combosPara(fechas, from, to, true);

  // Totales país: los de metasResumenPais (la misma función que usa
  // Rendimiento para su barra de avance), no un cálculo propio.
  const _projADde = _metasProjADde;
  const resumen = _metasAggResumen(metas, combos, _metasProyOn);

  document.getElementById("metasEmpty").style.display   = "none";
  document.getElementById("metasContent").style.display = "";

  let html = _metasControlsHTML(mesName);
  let alerts = _metasAlcanceHTML() + _metasEscalaAviso() + _metasCoberturaAviso(cobertura, mesName);
  if (cobertura.enRango === 0) {
    document.getElementById("metasContent").innerHTML = html + _mtAlerts(alerts) + _metasSinPeriodosHTML(mesName);
    return;
  }

  // ── 1. Resumen ────────────────────────────────────────────────────────────
  // Partners en perf SIN meta asignada: su FACT suma al total pero no tienen
  // plan → el % puede verse alto sin contexto. Mismo aviso que las líneas.
  const noMetaCount = combos.filter(c => c.noMeta).length;
  alerts += _metasSinMetaAviso(noMetaCount, mesName);
  html += _mtAlerts(alerts);

  // Delta vs los períodos equivalentes del mes anterior (mismo _combosPara).
  const prev = _metasPrevFechas(mesDates);
  let pAD = null, pNR = null, pSH = null;
  if (prev) {
    const pf = [...prev.fechas].sort();
    const pc = _combosPara(prev.fechas, pf[0], pf[pf.length - 1], false).combos;
    pAD = pc.reduce((s, c) => s + c.ad, 0);
    pNR = pc.reduce((s, c) => s + c.nr, 0);
    pSH = pc.reduce((s, c) => s + c.sh, 0);
  }
  const _dl = (a, p) => prev ? _mtDelta(a, p) : undefined;
  const _pl = prev ? prev.label : "";
  const mesTxt = mesLabel(mesName);
  html += `<section class="mt-sec">${_mtH2(t("mt.resumen", { m: _mtMesTxt(mesName) }))}<div class="ui-kpi-grid mt-kpis">
    ${metaResCard(t("metric.ad.label"), t("rend.per.ultimaSemana"),  resumen.ad.actual, resumen.ad.meta, resumen.ad.proj, null, undefined, "metas.agg.pais.ad", _dl(resumen.ad.actual, pAD), _pl, mesTxt)}
    ${metaResCard(t("metric.nr.label"), t("metas.acumMesSub"),  resumen.nr.actual, resumen.nr.meta, resumen.nr.proj, null, undefined, "metas.agg.pais.nr", _dl(resumen.nr.actual, pNR), _pl, mesTxt)}
    ${metaResCard(t("metric.sh.label"), t("metas.acumMesSub"),  resumen.sh.actual, resumen.sh.meta, resumen.sh.proj, null, undefined, "metas.agg.pais.sh", _dl(resumen.sh.actual, pSH), _pl, mesTxt)}
  </div></section>`;

  // ── 2. Por Ciudad ─────────────────────────────────────────────────────────
  const cityGroups = [];
  CITIES.forEach(city => {
    // Use all metas for this city (ignore cityFilter here to always show all cities)
    const cm = STATE.metasData.filter(m => {
      if (!_metasMatchMes(m, mesName, mesYearSel))    return false;
      if (kamFilter !== "all" && _metasKamDe(m) !== kamFilter) return false;
      if (sel.length && !selSet.has(m.partner))     return false;
      return m.city === city;
    });
    if (!cm.length) return;

    // Build city combos: reusa perfF (ya filtrado por rango de fechas).
    // No dependemos de STATE._byCity para que funcione aunque el indice no este
    // construido (cache stale, race condition al cargar diario/mensual).
    const cityPerfRows = perfF.filter(r =>
      r.city === city && selSet.has(r.partner)
    );
    const cityPerfMap = {};
    cityPerfRows.forEach(r => {
      const k = `${r.partner}|||${r.date}`;
      if (!cityPerfMap[k]) cityPerfMap[k] = { date: r.date, ad: 0, nr: 0, sh: 0 };
      cityPerfMap[k].ad += r.activeDrivers;
      cityPerfMap[k].nr += r.newPartner + r.newService + r.reactivated;
      cityPerfMap[k].sh += r.supplyHours;
    });
    const cityPerf = Object.values(cityPerfMap);
    const cityDates = [...new Set(cityPerf.map(r => r.date))].sort();
    const byDate = {};
    cityPerf.forEach(r => {
      if (!byDate[r.date]) byDate[r.date] = { ad: 0, nr: 0, sh: 0 };
      byDate[r.date].ad += r.ad;
      byDate[r.date].nr += r.nr;
      byDate[r.date].sh += r.sh;
    });
    const sorted = cityDates.map(d => byDate[d]);
    // AD = SNAPSHOT: el FACT es el ÚLTIMO período (nivel actual), no el máx del
    // rango — así cuadra con la slide del deck y con KPIs por Nivel. La
    // PROYECCIÓN es máx del rango × 1.4 (restaurada 29-ago-2026, ver
    // domain/metrics.ts) — potencial del mes, siempre visible sobre el FACT.
    // N+R/SH son flujos: se acumulan y se proyectan por ritmo lineal.
    // Misma fecha de snapshot que el país y los partners (B10): el último
    // período del rango, no el último de la ciudad.
    const lastAD = byDate[maxDate]?.ad || 0;
    const crAD = lastAD;
    const crNR = sorted.reduce((s, v) => s + v.nr, 0);
    const crSH = sorted.reduce((s, v) => s + v.sh, 0);
    const nrV = sorted.map(v => v.nr);
    const shV = sorted.map(v => v.sh);
    const cpAD = projAD(sorted.map(v => v.ad), cityDates[cityDates.length - 1]);
    const cpNR = projA(nrV, daysElapsed, daysRemaining);
    const cpSH = projA(shV, daysElapsed, daysRemaining);

    const cmA  = cm.reduce((s, m) => s + m.mA,  0);
    const cmNR = cm.reduce((s, m) => s + m.mNR, 0);
    const cmH  = cm.reduce((s, m) => s + m.mH,  0);
    cityGroups.push({ name: cityLabel(city), dot: _mtCatCity(city), count: cm.length, rows: [
      { label: t("metric.ad.short"), real: crAD, meta: cmA,  proj: cpAD, numKey: `metas.agg.ciudad.ad.${city}` },
      { label: t("metric.nr.short"), real: crNR, meta: cmNR, proj: cpNR, numKey: `metas.agg.ciudad.nr.${city}` },
      { label: t("metric.sh.short"), real: crSH, meta: cmH,  proj: cpSH, numKey: `metas.agg.ciudad.sh.${city}` }
    ] });
  });
  html += `<section class="mt-sec">${_mtH2(t("mt.porCiudad"))}${_mtGroupTable(t("mt.col.ciudad"), cityGroups)}</section>`;

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  // Partners sin meta ya estan dentro de combos con noMeta=true,
  // suman al FACT del KAM pero no al plan.
  // Los grupos salen de las cuentas mostradas (con y sin meta), con "No KAM"
  // al final. Antes se mezclaban los valores crudos de KAM_MAP, que traen ""
  // y nunca "No KAM" (B9).
  const allKAMs = ordenarKams(combos.map(c => c.kam), SIN_KAM)
    .filter(k => kamFilter === "all" || k === kamFilter);
  const kamGroups = [];
  allKAMs.forEach(kam => {
    const kc   = combos.filter(c => c.kam === kam);
    const km   = metas.filter(m => _metasKamDe(m) === kam);
    if (!kc.length) return;

    // Partners sin meta de este KAM: ya estan dentro de kc con noMeta=true
    const noGoalPartners = kc.filter(c => c.noMeta).map(c => c.partner);

    const kmA  = km.reduce((s, m) => s + m.mA,  0);
    const kmNR = km.reduce((s, m) => s + m.mNR, 0);
    const kmH  = km.reduce((s, m) => s + m.mH,  0);
    // FACT y proyeccion incluyen partners con y sin meta (todos en kc)
    const krAD = kc.reduce((s, c) => s + c.ad,  0);
    const krNR = kc.reduce((s, c) => s + c.nr,  0);
    const krSH = kc.reduce((s, c) => s + c.sh,  0);
    const kpAD = _projADde(kc);
    const kpNR = kc.reduce((s, c) => s + c.projNR, 0);
    const kpSH = kc.reduce((s, c) => s + c.projSH, 0);
    const extra = noGoalPartners.length
      ? `<span class="ui-badge ui-badge--neutral mt-ent__badge" title="${escapeHTML(noGoalPartners.join(", "))}">${escapeHTML(t("mt.sinMetaN", { n: noGoalPartners.length }))}</span>`
      : "";
    kamGroups.push({ name: kamLabel(kam), dot: _mtCatKam(kam), count: kc.length, extra, rows: [
      { label: t("metric.ad.short"), real: krAD, meta: kmA,  proj: kpAD, numKey: `metas.agg.kam.ad.${kam}` },
      { label: t("metric.nr.short"), real: krNR, meta: kmNR, proj: kpNR, numKey: `metas.agg.kam.nr.${kam}` },
      { label: t("metric.sh.short"), real: krSH, meta: kmH,  proj: kpSH, numKey: `metas.agg.kam.sh.${kam}` }
    ] });
  });
  html += `<section class="mt-sec">${_mtH2(t("mt.porKam"))}${_mtGroupTable(t("mt.col.kam"), kamGroups)}</section>`;

  // ── 4. Por Partner ────────────────────────────────────────────────────────
  const aggKpis = [
    { id: "ad", label: t("metric.ad.short") },
    { id: "nr", label: t("metric.nr.short") },
    { id: "sh", label: t("metric.sh.short") }
  ];
  const rows = combos.map(c => {
    // Huella de números: la entidad es partner@ciudad; sin meta y sin filtro de
    // ciudad la "ciudad" es un rótulo traducido (metas.sinPlan) → solo el partner.
    const _pk = m => `metas.agg.partner.${m}.` + (c.noMeta && cityFilter === "all" ? c.partner : `${c.partner}@${c.city}`);
    const vals = { ad: [c.ad, c.mA, c.projAD], nr: [c.nr, c.mNR, c.projNR], sh: [c.sh, c.mH, c.projSH] };
    return {
      partner: c.partner,
      cityDisp: cityFilter === "all" ? t("metas.todas") : cityLabel(c.city),
      kamDisp: kamLabel(c.kam), kamRaw: c.kam,
      sinMeta: !!c.noMeta, color: STATE.partnerColors[c.partner] || "var(--cat-other)",
      tip: "", note: "",
      // Partners CON meta: siempre actual / meta / % (misma regla que el viejo
      // miniBarFull, que pintaba "0.0%" con meta 0). SIN meta: solo el actual.
      cells: aggKpis.map(k => {
        const [real, meta, proj] = vals[k.id];
        return c.noMeta
          ? { id: k.id, label: k.label, mode: "real", real, F: fmt, numKey: _pk(k.id) }
          : { id: k.id, label: k.label, mode: "both", real, meta, proj, F: fmt, numKey: _pk(k.id),
              pct: meta > 0 ? (real / meta) * 100 : 0 };
      })
    };
  });
  html += _mtPartnersSection({ rows, kpis: aggKpis });

  document.getElementById("metasContent").innerHTML = html;
}
// ── HELPERS ───────────────────────────────────────────────────────────────────
// fmtFn opcional: Fleet muestra TASAS (%, SH/auto), no cantidades — con fmt()
// a secas "88.4%" se veria como "88". Default fmt() para no tocar los callers
// del agregador.
// numKey (opcional): clave de la huella de números (shared/huella.ts).
//
// Ola 6: tarjeta KPI del sistema de diseño (dirección B): valor · delta vs el
// mismo punto del mes anterior · barra de avance contra la meta con el caption
// "77.0% de la meta de Septiembre (37,248)" · proyección solo en el mes en curso.
// `color` se conserva en la firma por compatibilidad y ya no se usa (sin
// arcoíris: el color lo pone el estado del cumplimiento). Los tres últimos
// parámetros son nuevos y opcionales.
export function metaResCard(label, sub, real, meta, proj, color, fmtFn, numKey, dlt, prevLabel, mesTxt) {
  const F   = fmtFn || fmt;
  if (!_metasProyOn) proj = null;   // mes cerrado: sin proyección (decisión 4)
  const lab = `<div class="ui-kpi__label">${_E(label)}${sub ? ` <span class="mt-kpi__sub">· ${_E(sub)}</span>` : ""}</div>`;
  const dHtml = dlt !== undefined && real != null
    ? `<span class="ui-kpi__delta"><span${_dn(numKey, "delta")}>${uiDelta(dlt)}</span>` +
      (prevLabel ? `<span class="ui-kpi__prev">${_E(prevLabel)}</span>` : "") + `</span>`
    : "";
  // KPI SIN META cargada (ej. un partner con actividad TukTuk pero sin metas
  // TukTuk del mes). El camino normal daría "0.0% de plan 0" en rojo — se lee
  // como incumplimiento grave cuando no hay plan contra qué medir. Se muestra
  // el valor y se dice.
  if (real != null && !(meta > 0)) {
    return `<div class="ui-kpi mt-kpi">${lab}
      <div class="ui-kpi__row"><span class="ui-kpi__value"${_dn(numKey, "real")}>${F(real || 0)}</span>${dHtml}</div>
      <div class="ui-kpi__goal"><div class="ui-kpi__caption ui-kpi__caption--none">${_E(t("metas.sinMetaMes"))}</div>
      ${proj == null ? "" : `<div class="ui-kpi__caption mt-proj">${_E(t("metas.proyeccion"))}: <strong${_dn(numKey, "proj")}>${F(proj)}</strong></div>`}</div>
    </div>`;
  }
  // KPI solo-meta (ej. Utilización de Fleet: hay objetivo pero el dato real no
  // llega en el export). Mostrarlo con el camino normal daría "0.0% de plan",
  // que se lee como "no estamos llegando" cuando en realidad no se está
  // midiendo. Se muestra el plan y se dice explícitamente que no hay actual.
  if (real == null) {
    return `<div class="ui-kpi mt-kpi">${lab}
      <div class="ui-kpi__row"><span class="ui-kpi__value mt-kpi__value--meta"${_dn(numKey, "meta")}>${F(meta || 0)}</span></div>
      <div class="ui-kpi__goal"><div class="ui-kpi__caption ui-kpi__caption--none">${_E(t("metas.metaSinActual"))}</div></div>
    </div>`;
  }
  const p  = meta > 0 ? (real / meta) * 100 : 0;
  const pp = meta > 0 && proj != null ? (proj / meta) * 100 : 0;
  const tone = _mtTone(p, meta);
  const cumplTip = t("metas.cumplTip", { f: F(real), p: F(meta) });
  // Dos reglas distintas y a propósito: los FLUJOS (N+R, horas) se extrapolan
  // por ritmo del mes; los SNAPSHOTS (Active Drivers) proyectan máx del rango
  // × 1.4 (POTENCIAL — regla de negocio restaurada el 29-ago-2026, historial
  // completo en domain/metrics.ts).
  // El texto del tooltip TIENE que decir lo que el código hace: una vez se
  // "corrigió" el cálculo para que coincidiera con un tooltip impreciso, al
  // revés de lo que correspondía.
  const projTip = t(STATE.curMode === "mensual" ? "metas.projTipMensual" : "metas.projTip");
  const caption = t("mt.captionMeta", {
    p: `<span class="mt-tone mt-tone--${tone}"${_dn(numKey, "pct")}>${p.toFixed(1)}%</span>`,
    m: _E(mesTxt || ""),
    n: `<span${_dn(numKey, "meta")}>${F(meta)}</span>`
  });
  return `<div class="ui-kpi mt-kpi">${lab}
    <div class="ui-kpi__row"><span class="ui-kpi__value"${_dn(numKey, "real")}>${F(real)}</span>${dHtml}</div>
    <div class="ui-kpi__goal">
      ${_mtBar(p, proj == null ? null : pp, meta)}
      <div class="ui-kpi__caption" title="${_E(cumplTip)}">${caption}</div>
      ${proj == null ? "" : `<div class="ui-kpi__caption mt-proj" title="${_E(projTip)}">${t("mt.proyCierre", {
        v: `<strong${_dn(numKey, "proj")}>${F(proj)}</strong>`, p: `<span class="mt-tone mt-tone--${_mtTone(pp, meta)}">${pp.toFixed(1)}%</span>` })}</div>`}
    </div>
  </div>`;
}

// Bloque compacto meta-vs-actual (se conserva la firma exportada). Misma lógica
// de casos que las tablas por ciudad/KAM.
export function miniBar(label, real, meta, proj, fmtFn, numKey) {
  const F = fmtFn || fmt;
  if (!_metasProyOn) proj = null;   // mes cerrado: sin proyección (decisión 4)
  return _mtCardKpi(real != null && !(meta > 0)
    ? { label, mode: "real", real: real || 0, F, numKey }
    : real == null
      ? { label, mode: "meta", meta: meta || 0, F, numKey, note: t("metas.sinActual") }
      : { label, mode: "both", real, meta, proj, F, numKey, pct: meta > 0 ? (real / meta) * 100 : 0 });
}

export function miniBarFull(label, real, meta, proj, fmtFn, numKey) {
  const F = fmtFn || fmt;
  if (!_metasProyOn) proj = null;   // mes cerrado: sin proyección (decisión 4)
  return _mtCardKpi({ label, mode: "both", real, meta, proj, F, numKey, pct: meta > 0 ? (real / meta) * 100 : 0 });
}

// Barra de avance real + proyección (pR/pP en %). Se conserva la firma.
export function barProj(pR, pP) {
  return _mtBar(pR, pP, 1);
}

export async function downloadMetasPDF() {
  logAccess("download_pdf", "metas");
  const content = document.getElementById("metasContent");
  if (!content) return;
  const btnEl = document.getElementById("metasPdfBtn");
  const btnTxt = btnEl && btnEl.querySelector("span");
  if (btnEl) { btnEl.disabled = true; if (btnTxt) btnTxt.textContent = t("metas.generandoPDF"); }
  _mtCerrarMenus(null);

  // Las tablas anchas viven en un contenedor con scroll horizontal: html2canvas
  // solo captura lo visible de un scroll. Mientras se exporta, el contenido se
  // despliega entero (.mt-exporting) y se captura su ancho real.
  content.classList.add("mt-exporting");
  try {
    await ensurePdfLibs();
    const { jsPDF } = window.jspdf;
    const totalH  = content.scrollHeight;
    const scale   = 1.5;
    const width   = Math.max(content.offsetWidth, content.scrollWidth);
    // Siempre claro (Ola 7): el PDF no depende del tema de quien exporta.
    const canvas  = await html2canvas(content, opcionesCapturaClara({
      width,
      height: totalH,
      windowWidth: Math.max(document.documentElement.clientWidth, width),
      scale,
      useCORS: true,
      logging: false,
      scrollY: -window.scrollY,
      backgroundColor: "#ffffff"
    }));

    const imgData   = canvas.toDataURL("image/jpeg", 0.90);
    const imgW      = canvas.width;
    const imgH      = canvas.height;
    // Fit into landscape A4-ish pages
    const pdfPageW  = 841.89; // A4 landscape pt
    const pdfPageH  = 595.28;
    const ratio     = pdfPageW / imgW;
    const scaledH   = imgH * ratio;
    const pdf       = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    let offsetY     = 0;
    let pageNum     = 0;
    while (offsetY < scaledH) {
      if (pageNum > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, -offsetY, pdfPageW, scaledH);
      offsetY += pdfPageH;
      pageNum++;
    }
    // Usar el mismo mes que muestra renderMetas (mas reciente o seleccion manual)
    const _el = _metasMesElegido();
    const mes = _el ? `${_el.mes}${_el.anio != null ? "_" + _el.anio : ""}` : "metas";
    stampPDF(pdf, `Metas — ${mes.replace("_", " ")}`);
    pdf.save(`Metas_${mes}.pdf`);
  } catch(err) {
    await alertDialog({ title: t("mt.pdfError"), body: t("metas.err.pdf") + (err && err.message || err), tone: "bad" });
  } finally {
    content.classList.remove("mt-exporting");
    if (btnEl) { btnEl.disabled = false; if (btnTxt) btnTxt.textContent = t("mt.pdf"); }
  }
}

// ── ELIMINAR METAS DEL MES MOSTRADO ───────────────────────────────────────────
// Borra TODAS las metas del mes que se está viendo (para re-subir el Excel).
// Usa `ilike` sin comodines = igualdad case-insensitive, así cubre el casing
// mixto de uploads viejos ("JUNIO"/"Junio"/"junio") que el loader normaliza a
// UPPERCASE en cliente. Guard de admin defensivo; el enforcement real es RLS.
export async function deleteMetasMes(mes, year) {
  _mtCerrarMenus(null);
  if (!STATE.isAdmin) {
    showBanner(false, t("metas.err.admin"));
    return;
  }
  const mesU = (mes || "").trim();
  if (!mesU) return;
  // año del mes que se está viendo — sin esto, borrar "AGOSTO" borraría TODOS
  // los años con ese nombre si algún día conviven (metas.mYear).
  const yearN = year !== undefined && year !== "" && year != null ? +year : null;

  // Conteo estricto por año (no el "no se puede descartar" de _metasMatchMes):
  // el DELETE de abajo con .eq("mes_year", yearN) tampoco matchea filas con
  // mes_year NULL en Postgres — el conteo mostrado al confirmar debe coincidir
  // con lo que realmente se va a borrar.
  const n = STATE.metasData.filter(m =>
    m.mes === mesU.toUpperCase() && (yearN == null || m.mYear === yearN)
  ).length;
  const mesTxt = mesLabel(mesU) + (yearN ? " " + yearN : "");
  // Confirmación en la página (no confirm()): se ve el conteo exacto y hay que
  // teclear el nombre del mes — lo irreversible no se acepta por reflejo.
  const ok = await confirmDialog({
    title: t("mt.borrar.titulo", { m: mesTxt }),
    body: t(n === 1 ? "mt.borrar.cuerpo1" : "mt.borrar.cuerpoN", { m: mesTxt, n }),
    confirmLabel: t("mt.borrar.ok"),
    danger: true,
    requireText: mesLabel(mesU)
  });
  if (!ok) return;

  showLoad(true, t("metas.borrando", { m: mesTxt }));
  try {
    // count:"exact" → PostgREST devuelve cuántas filas borró DE VERDAD (RLS
    // incluido): el aviso informa ese número, no el conteo local.
    let q = sb.from("metas").delete({ count: "exact" }).ilike("mes", mesU);
    if (yearN != null) q = q.eq("mes_year", yearN);
    const { error, count } = await q;
    if (error) throw error;

    // Si el mes borrado era la selección manual del selector, limpiarla para que
    // renderMetas (vía loadFromSupabase) caiga al mes más reciente que quede.
    if (STATE.metasMesSel && STATE.metasMesSel.toUpperCase() === mesU.toUpperCase()) {
      STATE.metasMesSel = null;
      STATE.metasMesSelYear = null;
    }

    showBanner(true, t("mt.borradas", { m: mesTxt, n: count ?? n }));
    await loadFromSupabase();   // refresca STATE.metasData + re-renderiza el tab activo

    // loadFromSupabase solo re-renderiza Metas si quedan filas; si ya no quedan,
    // mostramos el estado vacío explícitamente (si no, queda contenido stale).
    if (STATE.curTab === "metas" && !STATE.metasData.length) {
      const empty = document.getElementById("metasEmpty");
      const cont  = document.getElementById("metasContent");
      if (empty) empty.style.display = "";
      if (cont)  cont.style.display  = "none";
    }
  } catch (err) {
    showBanner(false, t("metas.errBorrar") + err.message);
    console.error("deleteMetasMes:", err.message);
  } finally {
    showLoad(false);
  }
}

// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";
import { stampPDF } from "./shared/pdfmeta.js";

registerActions({
  setMetasLine:    d => setMetasLine(d.line),
  setMetasMes:     (d, el) => setMetasMes(el.value),
  deleteMetasMes:  d => deleteMetasMes(d.mes, d.year),
  metasMenuToggle: (d, el) => metasMenuToggle(el),
  metasSort:       d => metasSort(d.key),
  metasSetFiltro:  d => metasSetFiltro(d.value),
  metasSetVista:   d => metasSetVista(d.value),
  downloadMetasPDF
});
