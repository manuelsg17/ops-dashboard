//@ts-nocheck
// presentacion2.js — "Presentación 2.0" (Fase 1a)
// Presentación semanal estandarizada para enviar al partner. Sección NUEVA e
// independiente: no toca "Vista Partner" (partnerView.js). Reusa helpers
// globales (fmt, fmtSmart, d2s, CITY_COLORS, cityLabel, escapeHTML,
// ensureIndexes) y define abajo los helpers de presentación (getPartnerVals,
// getCityVals, getSelectedDates, _presOrderCities, getWoW, wowColor) que
// heredó de la Presentación v1 al retirarse esta (Fase 7 → borrada).
//
// Fase 1a incluye: selector de partner + idioma + comparativas (vs Top-N / vs
// ciudad), slide de MATRIZ (Perú + ciudades × AD, N+R, SH, Comisión, Viajes,
// Retención), slides de DATA RAW numérica y porcentual (WoW), y export a PDF.

// Chart.js vive ACÁ (no en vendor.js) a propósito: es la única vista que lo usa,
// y este módulo entero ya es un chunk lazy (loadViewModule) — al importarlo acá,
// Vite lo empaqueta en ESE chunk en vez de en el bundle eager que paga todo el
// mundo, incluida la pantalla de login.
import Chart from "chart.js/auto";
import { logAccess } from "./shared/accessLog.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { ensurePdfLibs } from "./shared/lazyLibs.js";
Chart.register(ChartDataLabels);
window.Chart = Chart;

// forecast.js (funciones fc*) también vive acá por el mismo motivo: SOLO lo usa
// el slide de Proyección de esta vista — antes vivía eager en vendor.js
// (~250 líneas pagadas por toda sesión, incluido el login) sin necesidad.
// Núcleo de cálculo compartido con Metas y Rendimiento. El deck es lo que ve el
// PARTNER, así que es justo donde menos puede haber una fórmula propia: si Metas
// dice "proyectamos 210" y el deck dice 120 para el mismo partner y el mismo mes,
// el problema no es cosmético, es de credibilidad delante del cliente.
import { projectFlow, retentionSeries, seriesByDate, snapshotValue,
         horasPorConductorBase, TK_HORAS_BASE_MIN, TK_MIN_ACTIVOS,
         pacingFlujo, median, fechasEnRango } from "./domain/metrics.js";
import { p2Lectura, p2Accion, META_CUMPLIDA_PCT } from "./domain/lectura.js";
import { reportYM, diasMesReporte, MES_NOMBRES } from "./shared/mesReporte.js";
import * as forecast from "./forecast.js";
Object.assign(window, forecast);

// ── Helpers de presentación (ex-presentacion.js) ──────────────────────────────
export const PRES_CITY_ORDER = ["LIMA", "AREQUIPA", "TRUJILLO"];

export function _presOrderCities(cities) {
  const rank = c => {
    const i = PRES_CITY_ORDER.indexOf(String(c).toUpperCase());
    return i === -1 ? PRES_CITY_ORDER.length : i;
  };
  return [...cities].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

export function getSelectedDates(from, to, mode) {
  const all = STATE.allDates;
  if (mode === "mensual") {
    const idx = all.findIndex(d => d > to);
    const end = idx === -1 ? all.length - 1 : idx - 1;
    return all.slice(Math.max(0, end - 3), end + 1);
  }
  const datesInRange = all.filter(d => d >= from && d <= to);
  if (datesInRange.length > 0) return datesInRange;
  const idx = all.findIndex(d => d > to);
  const end = idx === -1 ? all.length - 1 : idx - 1;
  return all.slice(Math.max(0, end - 3), end + 1);
}

export function getWoW(vals) {
  // Returns array of WoW % for each index (null for first)
  return vals.map((v, i) => {
    if (i === 0) return null;
    const prev = vals[i-1];
    if (!prev) return null;
    return ((v - prev) / prev * 100);
  });
}

export function wowColor(pct) {
  if (pct === null) return "#aaa";
  return pct >= 0 ? "#10b981" : "#FF0000";
}

export function getPartnerVals(partner, city, dates, metricFn) {
  return dates.map(d => {
    const rows = STATE._byCityDate?.get(`${city}|||${d}`) || [];
    let s = 0;
    for (const r of rows) {
      if (r.partner === partner) s += metricFn(r);
    }
    return s;
  });
}

export function getCityVals(city, dates, metricFn) {
  return dates.map(d => {
    const rows = STATE._byCityDate?.get(`${city}|||${d}`) || [];
    let s = 0;
    for (const r of rows) s += metricFn(r);
    return s;
  });
}

export let PRESENT2_STATE = {
  partner:  null,
  lang:     "es",       // es | en | ru
  slide:    0,          // 0=Matriz, 1=Data Raw #, 2=Data Raw %
  cohort:   {},         // { t1, t23, t45, t610, t5 } activados
  cmpCity:  true,       // mostrar tendencia de ciudad
  fleetMode: "auto",    // "auto" | "fleet" | "taxi" — auto = según is_fleet del partner
  dataset:  "taxi",     // "taxi" | "tuktuk" — qué slice de partners/datos se muestra
  avanceMesSel: null,   // mes META de "Avance vs Meta": null = auto (según "Hasta")
  // Hojas EXCLUIDAS del PDF (claves de p2SlideKey). Vacío = va todo el deck.
  // Por qué existe: el deck se arma por VERTICAL, así que un partner con 1-2
  // conductores en Delivery/Cargo igual recibía dos hojas por cada una. No se
  // resuelve con un umbral automático (¿2 conductores? ¿5?): la decisión de qué
  // le sirve a ESE partner es del KAM, y cambia según la conversación.
  pdfOff:   new Set(),
  pdfPanel: false,      // panel de selección abierto
  charts:   [],
  _renderId: 0
};
// Clave estable de una hoja del deck: la etiqueta ES + su vertical. Sirve entre
// partners a propósito — "nunca mandes las hojas de Cargo" se mantiene al
// cambiar de partner, que es como se usa.
export function p2SlideKey(entry) {
  return `${entry.ds}|${entry.def.es}`;
}

// Texto del deck en el idioma ELEGIDO PARA EL PARTNER, que es independiente del
// idioma de la app: el KAM navega en español y exporta el PDF en ruso.
//
// No usa t() de core/i18n a propósito: ese lee un idioma GLOBAL (`_lang`) y acá
// hacen falta dos idiomas vivos a la vez. El precio es tener las cadenas del
// deck en el sitio donde se usan; a cambio, cada frase se lee junto a su cálculo
// (y son frases de negocio, no etiquetas de UI: cambian con el contenido).
//
// `ru` opcional → cae a inglés, que es el idioma puente del equipo. Nunca cae a
// español: un texto en español dentro de un deck ruso parece un error de datos.
export function P2T(es, en, ru) {
  const l = PRESENT2_STATE.lang;
  return l === "en" ? en : l === "ru" ? (ru || en) : es;
}
// Nombre del mes en el idioma del DECK. metas.mes viene de la BD como nombre en
// español ("JULIO"), así que sin esto un deck en ruso mostraba "JULIO" en el
// encabezado de la hoja que recibe el partner.
const P2_MES_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь",
                   "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const P2_MES_EN = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"];
export function p2MesLabel(mesName) {
  if (!mesName) return "—";
  const i = P2_MES_NOMBRES.indexOf(String(mesName).trim().toUpperCase());
  if (i < 0) return mesName;                 // ISO "2026-07" u otro: se deja tal cual
  const l = PRESENT2_STATE.lang;
  return l === "en" ? P2_MES_EN[i] : l === "ru" ? P2_MES_RU[i]
       : mesName.charAt(0) + mesName.slice(1).toLowerCase();
}
export const P2_LANGS = [
  { k: "es", lbl: "ES" }, { k: "en", lbl: "EN" }, { k: "ru", lbl: "RU" }
];

// Re-exportados desde shared/mesReporte.js (única fuente de verdad — usada
// también por partnerPortal.ts, que no puede importar de acá directo sin
// arrastrar el chunk de Chart.js a su bundle).
export const P2_MES_NOMBRES = MES_NOMBRES;
// Mes de REPORTE al que pertenece una fecha (para "Avance vs Meta"). En SEMANAL, una
// semana Lun–Dom pertenece al mes donde cae su JUEVES (inicio+3 = día mediano) — así la
// semana que arranca el Lun 29-jun (Jun 29 → Dom 05-jul, 5 de 7 días en julio) cuenta como
// PRIMERA semana de JULIO, no como última de junio: el avance MTD y la meta caen en el mes
// correcto y cuadran con "KPIs por Nivel" (que muestra la semana tal cual). En MENSUAL/DIARIO
// el mes es el de la fecha misma. Devuelve { y: año, m: 1-12 }.
export function p2ReportYM(dateStr) {
  return reportYM(dateStr, STATE.curMode, parseLocalDate);
}
// Días transcurridos / restantes del MES DE REPORTE. El deck NO puede usar
// calcProjectionDays (data.ts): ésa mide el mes CALENDARIO de la fecha y con una
// semana que arranca el 29/30/31 devuelve los días del mes ANTERIOR al que el
// slide dice estar mostrando. Detalle en diasMesReporte.
export function p2DiasMes(lastDate) {
  return diasMesReporte(lastDate, STATE.curMode, parseLocalDate);
}

// Resuelve si el partner se muestra con KPIs Fleet (SH/Auto Activo, Acceptance,
// Carros Fleet) o Taxi (SH, Viajes). "auto" respeta el flag is_fleet de Config.
export function p2IsFleetMode(partner) {
  if (PRESENT2_STATE.dataset === "tuktuk") return false;   // TukTuk usa los 4 KPIs Taxi (Fase 6)
  if (PRESENT2_STATE.fleetMode === "fleet") return true;
  if (PRESENT2_STATE.fleetMode === "taxi") return false;
  return typeof isFleetPartner === "function" && isFleetPartner(partner);
}

// Registro ÚNICO de slides: de aquí derivan el nav, el bound de navegación, el
// render EN VIVO y el PDF (una sola fuente → no divergen). build(partner,dates)
// → HTML; charts=true + chartFn(partner,dates,root) para slides con Chart.js.
export const P2_SLIDES = [
  { es: "Carátula",   en: "Cover",     ru: "Обложка",  charts: false, build: (p, d, i) => buildSlide2Cover(p, d) },
  { es: "Ejecutivo",  en: "Executive", ru: "Сводка",   charts: false, build: (p, d, i) => buildSlide2Portada(p, d, i) },
  { es: "Resumen",    en: "Summary",   ru: "Итоги",    charts: false, build: (p, d, i) => buildSlide2Resumen(p, d, i) },
  // Proyección: SOLO PANTALLA (noPdf) — herramienta del KAM, no entra al deck
  // que recibe el partner. Decisión de Manuel, ago 2026.
  { es: "Proyección", en: "Forecast",  ru: "Прогноз",  charts: true, noPdf: true, build: (p, d, i) => buildSlide2Forecast(p, d, i), chartFn: (p, d, root) => buildSlide2ForecastCharts(p, d, root) }
];


// Slides que se repiten POR VERTICAL (Taxi / TukTuk / Delivery / Cargo). El
// mecanismo de secciones (PRESENT2_STATE.dataset) hace que cada uno lea el
// slice correcto sin duplicar código.
export const P2_POR_VERTICAL = [
  { es: "KPIs por Nivel", en: "KPIs by Level", ru: "KPI по уровням", charts: true, build: (p, d, i) => buildSlide2Matrix(p, d, i), chartFn: (p, d, root) => buildSlide2MatrixCharts(p, d, root) }
];
// Anexo por vertical, al final del deck.
export const P2_ANEXO_VERTICAL = [
  { es: "Data Raw (#)", en: "Data Raw (#)", ru: "Данные (#)", charts: false, build: (p, d, i) => buildSlide2Raw(p, d, false, i) },
  { es: "Data Raw (%)", en: "Data Raw (%)", ru: "Данные (%)", charts: false, build: (p, d, i) => buildSlide2Raw(p, d, true, i) }
];

// ── DECK COMBINADO Taxi + TukTuk (Fase 6) ─────────────────────────────────────
// Un partner puede tener sección Taxi y sección TukTuk en la MISMA presentación.
// El deck lista los slides con un tag `ds` ("taxi"|"tuktuk"); render/PDF fijan
// PRESENT2_STATE.dataset = entry.ds antes de build/chartFn (los accesores leen ese
// global) → cada slide dibuja del dataset correcto sin cambiar firmas.
// Partners tuktuk = unión de las TRES escalas: así el selector ofrece al partner
// aunque la escala activa no sea la que tiene sus datos.
export function _p2TkPartnersAll() {
  return [...new Set([...(STATE._tuktukPartners || []), ...(STATE._tuktukMensualPartners || []),
                      ...(STATE._tuktukDiarioPartners || [])])];
}
export function p2HasTuktuk(partner) { return _p2TkPartnersAll().includes(partner); }
// ¿Se muestra la SECCIÓN TukTuk en la escala activa? Distinto de p2HasTuktuk,
// que solo dice "existen datos tuktuk en alguna escala".
//
// Antes esto era `curMode !== "diario"`, porque el export diario no traía db_id
// y no había slice TukTuk diario. Eso dejó de ser cierto en jul-2026
// (rawDataDiarioTuktuk + sus índices ya se construyen), así que el guard hoy
// escondía una sección que SÍ tiene datos. Ahora se pregunta por el slice de la
// escala activa — misma regla que p2TieneVertical para delivery/cargo.
export function p2TuktukSectionVisible(partner) {
  return (STATE[_p2TkKey("Partners")] || []).includes(partner);
}
export function p2HasTaxi(partner)   { return (STATE.allPartners   || []).includes(partner); }
// Lista del SELECTOR: unión taxi + tuktuk (un partner tuktuk-only debe poder elegirse).
export function p2PartnerList() {
  return [...new Set([...(STATE.allPartners || []), ..._p2TkPartnersAll()])].sort();
}
// Portada divisoria de sección (se inserta antes de la sección TukTuk).
export const P2_DIVIDER = { es: "TukTuk", en: "TukTuk", ru: "ТукТук", charts: false, build: (p) => buildSlide2SectionCover(p, "tuktuk") };
// Slide de Seguimiento (Fase 3, render-only): solo si el partner tiene tareas cargadas.
// Va al final del deck y entra al PDF automáticamente (no es noPdf). Definida en seguimiento.js.
export const P2_SEG_SLIDE = { es: "Seguimiento", en: "Follow-up", ru: "Сопровождение", charts: false, build: (p, d, i) => buildSlide2Seguimiento(p, i) };
// Avance vs Meta Combinado (Taxi+TukTuk): NO vive en P2_SLIDES a propósito — ese
// array se re-ejecuta completo para la sección Taxi Y para la TukTuk (ver body.forEach
// más abajo); si el combinado estuviera ahí, se duplicaría (una vez por sección). Se
// inserta a mano en p2Deck(), UNA sola vez, justo después de la carátula — es la vista
// rápida "cómo va TODO mi negocio", va primero, antes del detalle Taxi/TukTuk individual.
// Alertas: UNA hoja con las 4 categorías adentro (antes se repetía por sección).
export const P2_ALERTAS_SLIDE = { es: "Alertas", en: "Alerts", ru: "Сигналы", charts: false, build: (p, d, i) => buildSlide2Alertas(p, d, i) };
// Deck por partner: carátula + [Combinado si hay TukTuk] + [sección Taxi] + [divisor + sección TukTuk].
export function p2Deck(partner) {
  const hasTaxi = p2HasTaxi(partner);
  const showTk  = p2TuktukSectionVisible(partner);   // datos existen Y la escala los soporta (no Diario)
  const hasDl   = p2TieneVertical(partner, "delivery");
  const hasCg   = p2TieneVertical(partner, "cargo");
  // Cover/Ejecutivo/Resumen van a "taxi" salvo que el partner sea tuktuk-only:
  // así nunca quedan en un dataset distinto al del cuerpo.
  const base = hasTaxi || !showTk ? "taxi" : "tuktuk";

  // 1. Carátula → 2. Ejecutivo → 3. Resumen (los tres, una vez, con TODO adentro)
  const deck = P2_SLIDES.filter(d => !d.noPdf || true).slice(0, 3).map(def => ({ def, ds: base }));

  // 4. Una sección de gráficas POR VERTICAL que el partner realmente opere.
  const verticales = [];
  if (hasTaxi) verticales.push({ ds: "taxi",     et: "Taxi" });
  if (showTk)  verticales.push({ ds: "tuktuk",   et: "TukTuk" });
  if (hasDl)   verticales.push({ ds: "delivery", et: "Delivery" });
  if (hasCg)   verticales.push({ ds: "cargo",    et: "Cargo" });
  verticales.forEach(v => P2_POR_VERTICAL.forEach(def =>
    deck.push({ def: { ...def, es: `${def.es} · ${v.et}`, en: `${def.en} · ${v.et}`, ru: `${def.ru || def.en} · ${v.et}` }, ds: v.ds })));

  // 5. Alertas: UNA hoja con todas las categorías adentro (una por vertical
  //    volvía a inflar el deck). El embudo de captación NO es una hoja propia:
  //    vive DENTRO del Ejecutivo (pedido de Manuel, sep 2026) — una hoja entera
  //    para cuatro porcentajes alargaba el deck justo cuando se venía de
  //    acortarlo, y ahí abajo compite mejor con la lectura y la acción.
  deck.push({ def: P2_ALERTAS_SLIDE, ds: base });

  // 6. Proyección: solo pantalla, al final del cuerpo.
  deck.push({ def: P2_SLIDES[3], ds: base });

  // 7. Anexo Data Raw, una hoja por vertical (conserva el corte por ciudad).
  verticales.forEach(v => P2_ANEXO_VERTICAL.forEach(def =>
    deck.push({ def: { ...def, es: `${def.es} · ${v.et}`, en: `${def.en} · ${v.et}`, ru: `${def.ru || def.en} · ${v.et}` }, ds: v.ds })));

  // Seguimiento: solo si el partner tiene tareas cargadas.
  if (typeof p2PartnerHasSeguimiento === "function" && p2PartnerHasSeguimiento(partner))
    deck.push({ def: P2_SEG_SLIDE, ds: base });
  return deck;
}
// HTML del nav (prev/next + un botón por slide del deck; sección TukTuk tintada ámbar).
export function p2NavHTML() {
  const deck = p2Deck(PRESENT2_STATE.partner);
  const btns = deck.map((entry, i) => {
    const label = p2SlideLabel(entry.def);
    const on = PRESENT2_STATE.slide === i, tk = entry.ds === "tuktuk";
    const fuera = !p2SlideEnPdf(entry);
    const activeBg = tk ? "#f59e0b" : "#FF0000";
    const bd = on ? activeBg : (tk ? "#fde68a" : "#e5e5e5");
    const bg = on ? activeBg : (tk ? "#fffbeb" : "#fff");
    const co = on ? "#fff" : (tk ? "#b45309" : "#555");
    // Las hojas excluidas del PDF se ven atenuadas y con ⃠: la exclusión tiene
    // que notarse SIN abrir el panel, o el KAM manda un PDF incompleto sin darse
    // cuenta de que lo había recortado en otra sesión.
    const off = fuera ? "opacity:.45;text-decoration:line-through" : "";
    return `<button data-slide2="${i}" data-act="goSlide2" data-i="${i}" title="${fuera ? escapeHTML(P2T("Fuera del PDF", "Excluded from PDF", "Не входит в PDF")) : ""}" style="padding:6px 14px;border-radius:6px;font-size:.78rem;font-weight:600;border:2px solid ${bd};background:${bg};color:${co};cursor:pointer;${off}">${tk ? "🛺 " : ""}${escapeHTML(label)}</button>`;
  }).join("");
  return `<button class="png-btn" data-act="prevSlide2" class="agy-style-329">◀</button>${btns}<button class="png-btn" data-act="nextSlide2" class="agy-style-329">▶</button>`;
}
// Etiqueta de una hoja en el idioma del deck.
export function p2SlideLabel(def) {
  return P2T(def.es, def.en, def.ru);
}
// ¿Esta hoja entra al PDF? `noPdf` es del código (Proyección: solo pantalla);
// `pdfOff` es del KAM.
export function p2SlideEnPdf(entry) {
  return !entry.def.noPdf && !PRESENT2_STATE.pdfOff.has(p2SlideKey(entry));
}
// "12/17" para el botón. Se muestra SIEMPRE (no solo cuando hay exclusiones):
// es el recordatorio de que el deck y el PDF pueden diferir.
export function _p2PdfCount() {
  const deck = p2Deck(PRESENT2_STATE.partner);
  const total = deck.filter(e => !e.def.noPdf).length;
  return `${deck.filter(p2SlideEnPdf).length}/${total}`;
}
// Panel de selección de hojas. Se abre desde el botón "Hojas del PDF".
export function p2PdfPanelHTML() {
  if (!PRESENT2_STATE.pdfPanel) return "";
  const deck = p2Deck(PRESENT2_STATE.partner);
  const filas = deck.map(entry => {
    const k = p2SlideKey(entry);
    if (entry.def.noPdf) {
      return `<label class="p2pdf-row p2pdf-na" title="${escapeHTML(P2T("Esta hoja es solo de pantalla", "Screen-only sheet", "Только для экрана"))}">
        <input type="checkbox" disabled><span>${escapeHTML(p2SlideLabel(entry.def))}</span>
        <em>${escapeHTML(P2T("solo pantalla", "screen only", "только экран"))}</em></label>`;
    }
    const on = !PRESENT2_STATE.pdfOff.has(k);
    return `<label class="p2pdf-row">
      <input type="checkbox" ${on ? "checked" : ""} data-act-change="present2TogglePdfSlide" data-key="${escapeHTML(k)}">
      <span>${entry.ds === "tuktuk" ? "🛺 " : ""}${escapeHTML(p2SlideLabel(entry.def))}</span></label>`;
  }).join("");
  const n = deck.filter(p2SlideEnPdf).length;
  return `<div class="p2pdf-panel">
    <div class="p2pdf-h">
      <strong>${escapeHTML(P2T("Hojas que entran al PDF", "Sheets included in the PDF", "Страницы, входящие в PDF"))}</strong>
      <span>${n} / ${deck.filter(e => !e.def.noPdf).length}</span>
      <button class="png-btn" data-act="present2PdfAll" data-on="1">${escapeHTML(P2T("Todas", "All", "Все"))}</button>
      <button class="png-btn" data-act="present2PdfAll" data-on="0">${escapeHTML(P2T("Ninguna", "None", "Ни одной"))}</button>
    </div>
    <div class="p2pdf-list">${filas}</div>
  </div>`;
}

// Logo de marca (inline SVG, mismo ícono que la app). P2_LOGO_MARK = versión chica
// para el header de cada slide.
export const P2_LOGO_SVG  = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="26" height="26"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
export const P2_LOGO_MARK = `<span class="agy-style-330"><span class="agy-style-331"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" width="10" height="10"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span><span class="agy-style-332">YANGO <span class="agy-style-51">Partners</span></span></span>`;

// Info del modo/escala activa (mensual/semanal/diario) para rótulos consistentes
// en TODA la presentación: badge visible, unidad de columna, sufijo de racha y
// abreviatura período-sobre-período (WoW/MoM/DoD). Así la deck "dice" en qué escala
// estás y ningún texto queda hablando de "semana" cuando ves meses.
export function p2ModeInfo() {
  const m = STATE.curMode;
  // `ult` = "últimos/últimas" YA CONCORDADO. En español el género lo fija la
  // unidad (los meses, los días, las semanas) y armar el título por
  // concatenación daba "ÚLTIMAS 4 MESES".
  if (m === "mensual") return { label: P2T("Mensual", "Monthly", "Ежемесячно"), unit: P2T("Mes", "Month", "Месяц"), units: P2T("meses", "months", "мес."), ult: P2T("últimos", "last", "последние"), seg: P2T("seguidos", "in a row", "подряд"), pop: "MoM", color: "#0284c7" };
  if (m === "diario")  return { label: P2T("Diario", "Daily", "Ежедневно"),   unit: P2T("Día", "Day", "День"),   units: P2T("días", "days", "дней"),    ult: P2T("últimos", "last", "последние"), seg: P2T("seguidos", "in a row", "подряд"), pop: "DoD", color: "#a855f7" };
  return                       { label: P2T("Semanal", "Weekly", "Еженедельно"),  unit: P2T("Semana", "Week", "Неделя"), units: P2T("semanas", "weeks", "нед."), ult: P2T("últimas", "last", "последние"), seg: P2T("seguidas", "in a row", "подряд"), pop: "WoW", color: "#2563eb" };
}

// Alerta de FRESCURA de datos (para el KAM — se pinta en el tab, NO va al PDF).
// Si en la escala activa el último período de Taxi y TukTuk no
// coinciden, casi siempre significa que faltó subir uno de los dos datasets (el
// KAM suele actualizar todo junto). Compara solo dentro de la misma granularidad.
export function p2FreshnessWarn() {
  const es = PRESENT2_STATE.lang === "es";
  const taxiDates = STATE.allDates || [];
  const tkDates   = STATE[_p2TkKey("Dates")] || [];   // slice de la escala activa (las 3)
  if (!taxiDates.length || !tkDates.length) return "";   // un lado no existe → no comparo
  const taxiMax = taxiDates[taxiDates.length - 1], tkMax = tkDates[tkDates.length - 1];
  if (taxiMax === tkMax) return "";   // en sync → sin alerta
  const tkBehind = tkMax < taxiMax;
  const ahead    = tkBehind ? "Taxi" : "TukTuk",   aheadMax  = tkBehind ? taxiMax : tkMax;
  const behind   = tkBehind ? "TukTuk" : "Taxi",   behindMax = tkBehind ? tkMax : taxiMax;
  const mi = p2ModeInfo();
  const msg = es
    ? `Posible dato faltante (${mi.label}): <b>${escapeHTML(ahead)}</b> llega a <b>${d2s(aheadMax)}</b> pero <b>${escapeHTML(behind)}</b> solo a <b>${d2s(behindMax)}</b>. Si actualizas todo junto, revisa si falta subir el <b>${escapeHTML(behind)}</b> de <b>${d2s(aheadMax)}</b>.`
    : `Possible missing data (${mi.label}): <b>${escapeHTML(ahead)}</b> reaches <b>${d2s(aheadMax)}</b> but <b>${escapeHTML(behind)}</b> only <b>${d2s(behindMax)}</b>. If you upload everything together, check whether <b>${escapeHTML(behind)}</b> for <b>${d2s(aheadMax)}</b> is missing.`;
  return `<div class="agy-style-333">
    <span class="agy-style-334">⚠️</span><span class="agy-style-335">${msg}</span></div>`;
}

// Header de marca compartido: partner + contexto (izq) · logo + título de slide (der)
// + línea de acento roja. Reemplaza los headers ad-hoc de cada slide.
// badgeOverride opcional {text, color}: para slides que no son ni Taxi ni TukTuk
// puros (ej. Avance Combinado) — evita que el badge automático lea
// PRESENT2_STATE.dataset (que en esos slides no representa una sola línea).
export function p2BrandHeader(partner, title, sub, badgeOverride) {
  const mi = p2ModeInfo();
  const modeChip = `<span style="display:inline-block;font-size:.6rem;font-weight:800;padding:2px 9px;border-radius:10px;color:#fff;background:${mi.color};margin-top:4px;letter-spacing:.3px">📅 ${mi.label.toUpperCase()}</span>`;
  // Badge Taxi/TukTuk: solo cuando el partner tiene AMBAS secciones (si no, no hay
  // ambigüedad). El acento del header también cambia a ámbar en la sección TukTuk.
  const tk = PRESENT2_STATE.dataset === "tuktuk";
  const showBadge = badgeOverride ? true : PRESENT2_STATE._showDsBadge;
  const accent = badgeOverride ? badgeOverride.color : ((showBadge && tk) ? "#f59e0b" : "#FF0000");
  const badge = badgeOverride
    ? `<span style="display:inline-block;font-size:.58rem;font-weight:800;padding:2px 8px;border-radius:10px;margin-bottom:3px;color:#fff;background:${badgeOverride.color}">${escapeHTML(badgeOverride.text)}</span><br>`
    : (showBadge
      ? `<span style="display:inline-block;font-size:.58rem;font-weight:800;padding:2px 8px;border-radius:10px;margin-bottom:3px;color:#fff;background:${tk ? "#f59e0b" : "#FF0000"}">${tk ? "🛺 TUKTUK" : "🚕 TAXI"}</span><br>`
      : "");
  return `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border-bottom:2px solid ${accent};padding-bottom:7px;margin-bottom:10px;flex:0 0 auto">
    <div class="agy-style-336">
      ${badge}
      <div class="agy-style-337">${escapeHTML(partner)}</div>
      ${sub ? `<div class="agy-style-338">${escapeHTML(sub)}</div>` : ""}
    </div>
    <div class="agy-style-339">
      ${P2_LOGO_MARK}
      <div class="agy-style-340">${escapeHTML(title)}</div>
      <div>${modeChip}</div>
    </div>
  </div>`;
}
// Footer de marca: confidencialidad + número de página (total = tamaño del deck).
export function p2BrandFooter(idx) {
  const total = PRESENT2_STATE._deckLen || P2_SLIDES.length;
  return `<div class="agy-style-341">
    <span>YANGO Partners · ${P2T("Confidencial", "Confidential", "Конфиденциально")}</span>
    <span>${P2T("pág", "page", "стр.")} ${(idx || 0) + 1}/${total}</span>
  </div>`;
}

// ── SLIDE: CARÁTULA (branded, oscura) ─────────────────────────────────────────
// Slot del LOGO del partner en la carátula. Hoy nadie carga logos, así que se
// dibuja un monograma (iniciales en el color del partner) — el espacio ya está
// reservado y maquetado. Cuando haya logos reales: poblar STATE.partnerLogos
// (partner → dataURL o ruta same-origin; la CSP admite 'self', data: y blob:)
// y esta función los usa sola, sin tocar el layout.
export function p2CoverLogo(partner, col) {
  const url = (STATE.partnerLogos || {})[partner];
  if (url) return `<img class="p2-cover-logo" src="${escapeHTML(url)}" alt="">`;
  const ini = String(partner || "").trim().split(/\s+/).slice(0, 2)
    .map(w => w[0] || "").join("").toUpperCase();
  return `<div class="p2-cover-logo p2-cover-monogram" style="color:${col};border-color:${col}33;background:${col}0d">${escapeHTML(ini)}</div>`;
}

export function buildSlide2Cover(partner, dates) {
  const col = (STATE.partnerColors && STATE.partnerColors[partner]) || "#FF0000";
  const kam = (typeof getKAMForPartner === "function" ? getKAMForPartner(partner) : "") || "";
  const cities = p2PartnerCities(partner).map(cityLabel).join(" · ");
  // Ventana REAL que muestran las demás slides (p2SelectedDates: en mensual = tail4,
  // ignora el "Desde" crudo) — NUNCA leer #dateFrom/#dateTo directo aquí: la carátula
  // rotulaba un período distinto al que cubren KPIs por Nivel/Data Raw (bug de auditoría).
  const from = (dates && dates[0]) || (document.getElementById("dateFrom") ? document.getElementById("dateFrom").value : (p2AllDates() || [])[0]);
  const to   = (dates && dates[dates.length - 1]) || (document.getElementById("dateTo") ? document.getElementById("dateTo").value : (p2AllDates() || []).slice(-1)[0]);
  const modeLabel = P2T(`Avance ${p2ModeInfo().label}`, `${p2ModeInfo().label} Update`, `Обновление · ${p2ModeInfo().label}`);
  const period = `${d2s(from)} → ${d2s(to)}`;
  return `
    <div class="agy-style-342">
      <div style="position:absolute;top:-80px;right:-80px;width:320px;height:320px;border-radius:50%;background:${col};opacity:.08"></div>
      <div class="agy-style-343"></div>
      <div class="agy-style-344">
        <div class="agy-style-345">${P2_LOGO_SVG}</div>
        <div class="agy-style-346">YANGO <span class="agy-style-51">Partners</span></div>
      </div>
      ${p2CoverLogo(partner, col)}
      <div class="agy-style-175">
        <div style="width:14px;height:14px;border-radius:50%;background:${col}"></div>
        <div class="agy-style-347">${escapeHTML(partner)}</div>
      </div>
      <div class="agy-style-348">${modeLabel} · ${period}</div>
      ${cities ? `<div class="agy-style-349">${escapeHTML(cities)}</div>` : `<div class="agy-style-350"></div>`}
      ${kam ? `<div class="agy-style-351">${P2T("Ejecutivo de Cuenta", "Account Manager", "Менеджер по работе с партнёром")}: <strong class="agy-style-352">${escapeHTML(kam)}</strong></div>` : ""}
    </div>`;
}

// ── SLIDE: PORTADA DIVISORIA DE SECCIÓN (Taxi / TukTuk) ────────────────────────
// Separador visual antes de la sección TukTuk: deja claro en el PDF que las
// diapositivas siguientes son de otra flota.
export function buildSlide2SectionCover(partner, ds) {
  const tk = ds === "tuktuk";
  const accent = tk ? "#f59e0b" : "#FF0000";
  const emoji  = tk ? "🛺" : "🚕";
  const title  = tk ? (P2T("Sección TukTuk", "TukTuk Section", "Раздел ТукТук")) : (P2T("Sección Taxi", "Taxi Section", "Раздел Такси"));
  const sub    = P2T("Las métricas a continuación corresponden a", "The metrics below correspond to", "Метрики ниже относятся к");
  return `
    <div class="agy-style-342">
      <div style="position:absolute;top:-80px;right:-80px;width:320px;height:320px;border-radius:50%;background:${accent};opacity:.12"></div>
      <div style="position:absolute;bottom:-60px;left:-60px;width:240px;height:240px;border-radius:50%;background:${accent};opacity:.07"></div>
      <div class="agy-style-353">${emoji}</div>
      <div class="agy-style-354">${title}</div>
      <div style="color:${accent};font-weight:800;font-size:1.1rem;margin-top:6px">${escapeHTML(partner)}</div>
      <div class="agy-style-355">${sub} <strong class="agy-style-352">${tk ? "TukTuk" : "Taxi"}</strong></div>
    </div>`;
}
export function destroyPresent2Charts() {
  PRESENT2_STATE.charts.forEach(c => { try { c.destroy(); } catch (e) {} });
  PRESENT2_STATE.charts = [];
}

// Dataset activo (Fase 3): "taxi" = STATE.rawData/_byCityDate (comportamiento
// idéntico a Fases 1-2); "tuktuk" = el slice paralelo (STATE.rawDataTuktuk,
// separado por el flag manual is_tuktuk, excluido del resto del dashboard).
// Índices tuktuk por ESCALA (sufijo `_p2Suf`): mensual → _tuktukMensual*,
// diario → _tuktukDiario*, semanal → _tuktuk*. Antes leía siempre el semanal →
// tuktuk salía en BLANCO en mensual (claves "YYYY-MM" en un índice de semanas).
// (Taxi ya es mode-aware porque _byCityDate/rawData/allDates se reconstruyen en switchMode.)
// Bandas de cohorte para comparar al partner contra su grupo de tamaño.
export const P2_BANDS = [
  { key: "t1",   range: [0, 1],  color: "#dc2626", es: "Top 1",       en: "Top 1" },
  { key: "t23",  range: [1, 3],  color: "#f59e0b", es: "Top 2-3",     en: "Top 2-3" },
  { key: "t45",  range: [3, 5],  color: "#0284c7", es: "Top 4-5",     en: "Top 4-5" },
  { key: "t610", range: [5, 10], color: "#a855f7", es: "Top 6-10",    en: "Top 6-10" },
  { key: "t5",   range: [0, 5],  color: "#10b981", es: "Prom. Top 5", en: "Avg Top 5" }
];

// Conservada solo por compatibilidad con quien la importe: los accesores del
// dataset ya NO la usan (era el booleano-para-tres-escalas que dejaba TukTuk
// leyendo el slice SEMANAL estando en diario). Ver _p2Suf.
export function _p2TkMensual() { return STATE.curMode === "mensual"; }

// Sufijo de escala para las claves de STATE de las verticales nuevas. El
// dataset "taxi" NO lo necesita: STATE.rawData/_byCityDate ya apuntan a la
// escala activa. TukTuk y las verticales viven en slices paralelos, asi que si
// no se elige el sufijo el deck lee el slice SEMANAL estando en mensual, en
// silencio (mismo bug que ya se arreglo en los selectores de linea).
function _p2Suf() { return STATE.curMode === "mensual" ? "Mensual" : STATE.curMode === "diario" ? "Diario" : ""; }
// TukTuk vive en slices paralelos igual que las verticales nuevas, con la misma
// convención de nombres (semanal sin sufijo). Antes se resolvía con un BOOLEANO
// (`mensual ? mensualX : semanalX`) para TRES escalas, así que en DIARIO leía el
// slice SEMANAL en silencio: el Ejecutivo sumaba al total diario de Taxi la
// última semana de TukTuk que cayera dentro del rango (medido: +70 AD, +7 N+R,
// +700 h sobre el valor correcto). Los slices diarios existen desde jul-2026.
function _p2TkKey(base) { return `_tuktuk${_p2Suf()}${base}`; }
// Verticales que viven en un slice propio (todas menos taxi, que es el dataset base).
const P2_VERT = { delivery: 1, cargo: 1 };

export function p2CityDateIndex() {
  const ds = PRESENT2_STATE.dataset;
  if (ds === "tuktuk") return STATE[_p2TkKey("ByCityDate")] || new Map();
  if (P2_VERT[ds])     return STATE[`_${ds}${_p2Suf()}ByCityDate`] || new Map();
  return STATE._byCityDate;
}
export function p2RawDataset() {
  const ds = PRESENT2_STATE.dataset, suf = _p2Suf();
  if (ds === "tuktuk") return STATE[`rawData${suf}Tuktuk`] || [];
  if (P2_VERT[ds])     return STATE[`rawData${suf}${ds[0].toUpperCase()}${ds.slice(1)}`] || [];
  return STATE.rawData || [];
}
export function p2ActivePartners() {
  const ds = PRESENT2_STATE.dataset;
  if (ds === "tuktuk") return STATE[_p2TkKey("Partners")] || [];
  if (P2_VERT[ds])     return STATE[`_${ds}${_p2Suf()}Partners`] || [];
  return STATE.allPartners || [];
}
export function p2AllDates() {
  const ds = PRESENT2_STATE.dataset;
  if (ds === "tuktuk") return STATE[_p2TkKey("Dates")] || [];
  if (P2_VERT[ds])     return STATE[`_${ds}${_p2Suf()}Dates`] || [];
  return STATE.allDates || [];
}
// ¿El partner opera esta vertical en la escala activa?
export function p2TieneVertical(partner, vert) {
  const suf = _p2Suf();
  return (STATE[`_${vert}${suf}Partners`] || []).includes(partner);
}

// Espejo local de getPartnerVals/getCityVals (presentacion.js), pero acotado al
// índice del dataset activo — así taxi se comporta IDÉNTICO a antes (misma
// STATE._byCityDate) y tuktuk lee su propio índice sin forkear presentacion.js.
export function p2GetPartnerVals(partner, city, dates, fn) {
  const idx = p2CityDateIndex();
  return dates.map(d => {
    const rows = (idx && idx.get(`${city}|||${d}`)) || [];
    let s = 0;
    for (const r of rows) if (r.partner === partner) s += fn(r);
    return s;
  });
}
// ¿El partner tiene AL MENOS una fila esa fecha, en esa ciudad (o en alguna de
// las suyas si scope=null)? Distinto de "el valor es 0" — un partner sin fila
// ese período no reportó, no es que hizo cero. Usado por p2CohortAvg para no
// contar ausentes como 0 (mismo criterio `_present` de Vista Partner,
// _pvScopeSeries) — sin esto, un miembro del cohorte que no reportó un período
// hundía el promedio "Prom. Top 5" del deck contra lo que muestra Vista
// Partner para el mismo cohorte y período.
function p2Present(partner, city, dates) {
  const idx = p2CityDateIndex();
  const cities = city ? [city] : p2PartnerCities(partner);
  return dates.map(d => cities.some(c => {
    const rows = (idx && idx.get(`${c}|||${d}`)) || [];
    return rows.some(r => r.partner === partner);
  }));
}
export function p2GetCityVals(city, dates, fn) {
  const idx = p2CityDateIndex();
  return dates.map(d => {
    const rows = (idx && idx.get(`${city}|||${d}`)) || [];
    let s = 0;
    for (const r of rows) s += fn(r);
    return s;
  });
}

// Ciudades del partner en orden canónico (Lima → Arequipa → Trujillo → resto).
export function p2PartnerCities(partner) {
  const rows = p2RawDataset().filter(r => r.partner === partner);
  return _presOrderCities([...new Set(rows.map(r => r.city).filter(Boolean))]);
}

// Valores por fecha de una métrica para un nivel: scope=null → Perú (suma de las
// ciudades del partner); scope="LIMA" → esa ciudad.
export function p2Vals(partner, scope, dates, fn) {
  if (scope) return p2GetPartnerVals(partner, scope, dates, fn);
  const cities = p2PartnerCities(partner);
  const per = cities.map(c => p2GetPartnerVals(partner, c, dates, fn));
  return dates.map((_, i) => per.reduce((s, a) => s + (a[i] || 0), 0));
}

// Tendencia de ciudad (total de TODOS los partners) para comparar. scope=null →
// suma de las ciudades del partner.
export function p2CityVals(partner, scope, dates, fn) {
  if (scope) return p2GetCityVals(scope, dates, fn);
  const cities = p2PartnerCities(partner);
  const per = cities.map(c => p2GetCityVals(c, dates, fn));
  return dates.map((_, i) => per.reduce((s, a) => s + (a[i] || 0), 0));
}

// Getters de métricas base.
export const P2_GET = {
  ad:    r => r.activeDrivers,
  newd:  r => r.newPartner + r.newService,
  react: r => r.reactivated,
  sh:    r => r.supplyHours,
  trips: r => r.trips || 0,
  comm:  r => r.commission || 0
};

// Todas las métricas (base + derivadas: N+R, Retención, Trips/SH, Trips/AD, SH/AD) por nivel.
// Retención[i] = (AD[i] − Nuevos[i] − Reactivados[i]) / AD[i−1]  (null si i=0 o AD prev=0).
export function p2Metrics(partner, scope, dates) {
  const ad    = p2Vals(partner, scope, dates, P2_GET.ad);
  const newd  = p2Vals(partner, scope, dates, P2_GET.newd);
  const react = p2Vals(partner, scope, dates, P2_GET.react);
  const sh    = p2Vals(partner, scope, dates, P2_GET.sh);
  const trips = p2Vals(partner, scope, dates, P2_GET.trips);
  const comm  = p2Vals(partner, scope, dates, P2_GET.comm);
  const nr    = dates.map((_, i) => (newd[i] || 0) + (react[i] || 0));
  const ret   = retentionSeries(ad, newd, react);   // ver domain/metrics.ts
  const tripsPerSh = dates.map((_, i) => sh[i] ? trips[i] / sh[i] : null);   // Trips/SH
  const tripsPerAd = dates.map((_, i) => ad[i] ? trips[i] / ad[i] : null);   // Trips/AD
  const shPerAd    = dates.map((_, i) => ad[i] ? sh[i] / ad[i] : null);      // SH/AD
  return { ad, newd, react, sh, trips, comm, nr, ret, tripsPerSh, tripsPerAd, shPerAd };
}

// Retención a nivel ciudad (todos los partners) para la tendencia de comparación.
export function p2CityRet(partner, scope, dates) {
  const ad    = p2CityVals(partner, scope, dates, P2_GET.ad);
  const newd  = p2CityVals(partner, scope, dates, P2_GET.newd);
  const react = p2CityVals(partner, scope, dates, P2_GET.react);
  // MISMA fórmula que p2Metrics — antes estaba escrita dos veces en este mismo
  // archivo, así que la retención del partner y la de su ciudad podían quedar
  // definidas distinto sin que nadie lo notara.
  return retentionSeries(ad, newd, react);
}

// ── SERIE FLEET (ponderada) ───────────────────────────────────────────────────
// p2Vals hace SUMA simple (correcto para ad/nr/sh/trips/comm) pero sería
// incorrecto para ratios de flota: shCarInt y accept deben ir PONDERADOS, no
// promediados. Campos EXACTOS del reporte del partner (confirmados en BD):
//   ownedFleetActiveCars = Σ owned_fleet_active_cars
//   shCarInt = Σ(internalFleetSh) / Σ(ownedFleetActiveCars)   — NO usar el ratio
//     precalculado internal_fleet_sh_per_active_car para agregar entre CLIDs/
//     ciudades: se reconstruye desde el numerador (internalFleetSh) y el
//     denominador (ownedFleetActiveCars), ambos disponibles en cada fila.
//   accept = Σ(acceptanceRate × trips) / Σ trips   (no hay numerador propio;
//     acceptance_rate ya es 0–1, se pondera por trips como mejor proxy)
// AD/N+R se reusan de p2Metrics (misma función que el path taxi) para que la
// matriz Fleet SIEMPRE coincida con la matriz Taxi; aquí solo lo fleet-específico.
export function p2FleetSeries(partner, scope, dates) {
  const cities = scope ? [scope] : p2PartnerCities(partner);
  const cars = dates.map(() => 0), internalShW = dates.map(() => 0);
  const tripsSum = dates.map(() => 0), acceptW = dates.map(() => 0);
  dates.forEach((d, i) => {
    cities.forEach(c => {
      const rows = (p2CityDateIndex() && p2CityDateIndex().get(`${c}|||${d}`)) || [];
      rows.forEach(r => {
        if (r.partner !== partner) return;
        // Solo sub-flotas Fleet (por db_id; fallback CLID legacy). Evita diluir
        // Acceptance con trips de fleetrooms no-fleet del mismo partner.
        if (typeof rowIsFleet === "function" && !rowIsFleet(r)) return;
        cars[i]       += r.ownedFleetActiveCars || 0;
        internalShW[i]+= r.internalFleetSh || 0;
        tripsSum[i]   += r.trips || 0;
        acceptW[i]    += (r.acceptanceRate || 0) * (r.trips || 0);
      });
    });
  });
  return {
    ownedFleetActiveCars: cars,
    shCarInt: dates.map((_, i) => cars[i] > 0 ? internalShW[i] / cars[i] : null),
    accept:   dates.map((_, i) => tripsSum[i] > 0 ? acceptW[i] / tripsSum[i] : null)
  };
}
// Tendencia de ciudad ponderada (TODOS los partners de la ciudad) para ratios fleet.
export function p2CityFleetSeries(scope, dates) {
  const cities = scope ? [scope] : [];   // Perú-general: sin trend de ciudad única
  if (!cities.length) return { ownedFleetActiveCars: dates.map(() => null), shCarInt: dates.map(() => null), accept: dates.map(() => null) };
  const cars = dates.map(() => 0), internalShW = dates.map(() => 0);
  const tripsSum = dates.map(() => 0), acceptW = dates.map(() => 0);
  dates.forEach((d, i) => {
    cities.forEach(c => {
      const rows = (p2CityDateIndex() && p2CityDateIndex().get(`${c}|||${d}`)) || [];
      rows.forEach(r => {
        if (typeof rowIsFleet === "function" && !rowIsFleet(r)) return;   // solo fleetrooms Fleet
        cars[i]       += r.ownedFleetActiveCars || 0;
        internalShW[i]+= r.internalFleetSh || 0;
        tripsSum[i]   += r.trips || 0;
        acceptW[i]    += (r.acceptanceRate || 0) * (r.trips || 0);
      });
    });
  });
  return {
    ownedFleetActiveCars: cars,
    shCarInt: dates.map((_, i) => cars[i] > 0 ? internalShW[i] / cars[i] : null),
    accept:   dates.map((_, i) => tripsSum[i] > 0 ? acceptW[i] / tripsSum[i] : null)
  };
}

// Ranking de partners por AD del último período dentro del scope (para cohortes).
export function p2Ranked(scope, dates) {
  const lastDate = dates[dates.length - 1];
  const rows = p2RawDataset().filter(r => r.date === lastDate && (!scope || r.city === scope));
  const byP = {};
  rows.forEach(r => { byP[r.partner] = (byP[r.partner] || 0) + (r.activeDrivers || 0); });
  return Object.entries(byP).sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

// Promedio del cohorte para un KPI (kpiKey). Para retención promedia las series
// de retención de cada miembro; para el resto promedia la métrica directa.
export function p2CohortAvg(members, scope, dates, kpiKey) {
  if (!members.length) return dates.map(() => 0);
  let arrs;
  if (kpiKey === "ret") {
    arrs = members.map(p => {
      const ad = p2Vals(p, scope, dates, P2_GET.ad);
      const nd = p2Vals(p, scope, dates, P2_GET.newd);
      const rc = p2Vals(p, scope, dates, P2_GET.react);
      // Tercera copia de la misma fórmula que había en este archivo: la del
      // partner, la de su ciudad y la del cohorte. Si el promedio del cohorte se
      // calculara distinto que la línea del partner, el gráfico compararía dos
      // cosas que no son comparables — y es exactamente lo que el partner mira.
      return retentionSeries(ad, nd, rc);
    });
  } else {
    const fn = kpiKey === "nr" ? (r => r.newPartner + r.newService + r.reactivated) : P2_GET[kpiKey];
    arrs = members.map(p => p2Vals(p, scope, dates, fn));
  }
  // Presencia por miembro/fecha — SOLO para kpiKey !== "ret": p2Vals nunca
  // devuelve null (siempre 0 si no hay fila), así que sin esto un miembro
  // ausente ese período contaba como 0 y hundía el promedio del cohorte
  // (misma línea "Prom. Top 5" daba distinto en el deck vs Vista Partner,
  // que sí excluye ausentes vía _present). "ret" ya excluye null por su
  // propia regla de negocio (retentionSeries).
  const presArrs = kpiKey === "ret" ? null : members.map(p => p2Present(p, scope, dates));
  return dates.map((_, i) => {
    let s = 0, n = 0;
    arrs.forEach((a, mi) => {
      if (presArrs && !presArrs[mi][i]) return;   // ausente esa fecha: no cuenta
      if (a[i] != null && !isNaN(a[i])) { s += a[i]; n++; }
    });
    return n ? s / n : null;
  });
}

// Líneas de cohorte activas para un KPI en un scope.
export function p2CohortLines(scope, dates, kpiKey) {
  const tog = PRESENT2_STATE.cohort || {};
  if (!P2_BANDS.some(b => tog[b.key])) return [];
  const ranked = p2Ranked(scope, dates);
  const out = [];
  P2_BANDS.forEach(b => {
    if (!tog[b.key]) return;
    const members = ranked.slice(b.range[0], b.range[1]);
    if (!members.length) return;
    out.push({ label: P2T(b.es, b.en, b.ru || b.en), data: p2CohortAvg(members, scope, dates, kpiKey), color: b.color });
  });
  return out;
}

// html2canvas (downloadPresent2PDF) captura la página a este `scale`. El
// devicePixelRatio del canvas de Chart.js DEBE ser >= este número: si el canvas
// fuente tiene menos resolución que la que pide el destino, el navegador lo
// escala hacia arriba al capturar y el gráfico sale borroso — pasó exactamente
// eso con devicePixelRatio:3 vs scale:4 (desajuste de 1x). Una sola constante
// para ambos evita que se vuelvan a desalinear.
export const P2_EXPORT_SCALE = 4;

// ── CHART (Chart.js, registro propio) ─────────────────────────────────────────
// Línea del partner (con puntos WoW) + tendencia de ciudad (opcional, gris punteada)
// + líneas de cohorte (opcional, punteadas de color). isPct=true → formatea %.
export function p2Chart(canvasId, dates, partnerVals, cityVals, cohortLines, color, isPct, root) {
  const canvas = root ? root.querySelector(`#${canvasId}`) : document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  const pWoW = getWoW(partnerVals);   // % relativo — solo para colorear el punto por signo (mismo signo que pp)
  // Datalabel de variacion: para series de PROPORCION (isPct, ej. Acceptance Rate) debe ir en
  // PUNTOS (pp), igual que el badge de la tarjeta (buildSlide2Matrix) y Data Raw (%) — NO el %
  // relativo de getWoW, que para el mismo cambio da un numero distinto (bug de auditoria).
  const pWoWLabel = isPct
    ? partnerVals.map((v, i) => (i === 0 || v == null || partnerVals[i - 1] == null) ? null : (v - partnerVals[i - 1]) * 100)
    : pWoW;
  const fmtV = v => isPct ? (v == null ? "" : (v * 100).toFixed(1) + "%") : fmt(v);
  // Marca Yango: la línea del partner SIEMPRE en rojo Yango; el color del KPI
  // (`color`) se usa como acento sutil en el relleno del área.
  // GROSORES (ago 2026): la matriz muestra hasta 4 niveles × 4 KPIs = 16
  // gráficas chicas en una misma slide. Con línea de 2.5px y puntos de 3.5 el
  // conjunto se veía tosco y las etiquetas de variación se encimaban — Manuel
  // pidió afinarlo. Los valores de abajo son para ESA densidad; el relleno
  // también se aclara (18 -> 10 en alfa) para que la línea no compita con su
  // propia área.
  const datasets = [{
    label: "Partner", data: partnerVals, borderColor: "#FF0000", backgroundColor: color + "10",
    borderWidth: 1.6, pointRadius: 2.2, pointHoverRadius: 4,
    pointBackgroundColor: pWoW.map(w => wowColor(w)),
    pointBorderColor: pWoW.map(w => wowColor(w)), pointBorderWidth: 0,
    tension: 0.3, fill: true, spanGaps: true
  }];
  if (PRESENT2_STATE.cmpCity && cityVals) {
    // Normaliza la tendencia de ciudad a la escala del partner para que se vea la FORMA.
    const pMax = Math.max(1, ...partnerVals.filter(v => v != null));
    const cMax = Math.max(1, ...cityVals.filter(v => v != null));
    const cNorm = cityVals.map(v => v == null ? null : (v / cMax) * pMax);
    datasets.push({
      label: PRESENT2_STATE.lang === "es" ? "Ciudad" : "City", data: cNorm,
      borderColor: "#c4c4c4", borderWidth: 1, borderDash: [3, 3], pointRadius: 1.5,
      pointBorderWidth: 0, tension: 0.3, fill: false, spanGaps: true, _raw: cityVals
    });
  }
  (cohortLines || []).forEach(l => {
    const cMax = Math.max(1, ...l.data.filter(v => v != null));
    const pMax = Math.max(1, ...partnerVals.filter(v => v != null));
    const norm = l.data.map(v => v == null ? null : (v / cMax) * pMax);
    datasets.push({
      label: l.label, data: norm, borderColor: l.color, borderWidth: 1,
      borderDash: [5, 3], pointRadius: 1.5, pointBorderWidth: 0, tension: 0.3,
      fill: false, spanGaps: true, _raw: l.data
    });
  });
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: dates.map(d2s), datasets },
    options: {
      // devicePixelRatio fijo (no el del monitor): html2canvas copia el canvas de
      // Chart.js TAL CUAL para el PDF (no lo re-renderiza a partir de los datos), así
      // que su nitidez tiene techo en la resolución interna del canvas. Tiene que
      // ser >= P2_EXPORT_SCALE (el scale de html2canvas) — un valor MENOR seguía
      // saliendo borroso porque el navegador upscalea igual al capturar (esto pasó
      // con devicePixelRatio:3 vs scale:4, un desajuste de 1x que Manuel encontró
      // al revisar un PDF real).
      devicePixelRatio: P2_EXPORT_SCALE,
      responsive: true, maintainAspectRatio: false, animation: false,
      // Aire ARRIBA para las etiquetas de variacion (+11.3%, +1.9%...): van
      // ancladas al punto con align "top", asi que un punto cerca del techo del
      // area dejaba la etiqueta cortada por el borde de la tarjeta — se veia en
      // las capturas de Manuel en Peru/Lima. Dos medidas complementarias:
      //   · layout.padding.top reserva pixeles DENTRO del canvas;
      //   · scales.y.grace estira el eje un 15% mas alla del maximo, para que
      //     la linea no toque el techo (mismo recurso que ya usa Vista Partner).
      layout: { padding: { top: 14, right: 4, left: 2, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => {
          const raw = ctx.dataset._raw ? ctx.dataset._raw[ctx.dataIndex] : ctx.raw;
          return `${ctx.dataset.label}: ${fmtV(raw)}`;
        } } },
        datalabels: {
          // "auto" (no true): con 6+ periodos en una tarjeta angosta las
          // etiquetas se superponian y quedaban ilegibles ("+2.9%+2.1%"). Con
          // "auto" el plugin dibuja las que caben y descarta las que chocarian
          // con otra ya dibujada — la ultima variacion, que es la que se mira,
          // siempre entra porque se dibujan en orden.
          display: ctx => (ctx.datasetIndex === 0 && ctx.dataIndex > 0 && pWoWLabel[ctx.dataIndex] != null) ? "auto" : false,
          // Margen entre etiquetas para que "auto" no las pegue una contra otra.
          padding: { top: 1, bottom: 1, left: 2, right: 2 },
          clamp: true,
          formatter: (_, ctx) => { const w = pWoWLabel[ctx.dataIndex]; return (w >= 0 ? "+" : "") + w.toFixed(1) + (isPct ? "pp" : "%"); },
          color: ctx => wowColor(pWoW[ctx.dataIndex]),
          font: { size: 7, weight: "bold" }, anchor: "end", align: "top", offset: 3
        }
      },
      scales: {
        x: { ticks: { font: { size: 7 }, maxRotation: 0, color: "#9ca3af" }, grid: { display: false },
             border: { color: "#e5e7eb" } },
        y: { beginAtZero: false, grace: "15%",
             ticks: { font: { size: 7 }, color: "#9ca3af", maxTicksLimit: 5,
             callback: v => fmtV(v) },
             grid: { color: "#f3f4f6", lineWidth: 0.5 }, border: { display: false } }
      }
    }
  });
  PRESENT2_STATE.charts.push(chart);
}

// ── KPIs de la matriz ─────────────────────────────────────────────────────────
// Matriz: 4 KPIs (los que el KAM revisa de un vistazo). Comisión y Retención se
// quitaron de los gráficos por densidad; siguen en el Data Raw.
export function p2KpiDefs(es) {
  return [
    { key: "ad",    label: P2T("Conductores Activos", "Active Drivers", "Активные водители"),   color: "#FF0000", kind: "num" },
    { key: "nr",    label: P2T("Nuevos + Reactivados", "New + Reactivated", "Новые + реактивированные"), color: "#f97316", kind: "num" },
    { key: "sh",    label: P2T("Horas de Conexión", "Supply Hours", "Часы на линии"),        color: "#8b5cf6", kind: "num" },
    { key: "trips", label: P2T("Viajes", "Trips", "Поездки"),                          color: "#10b981", kind: "num" }
  ];
}
// Variante Fleet: los 4 KPIs EXACTOS del reporte real del partner (confirmado
// por captura del usuario) — N+R, Acceptance Rate, Owned Fleet Active Cars,
// Internal Fleet SH/Auto Activo. Se QUITA AD de la matriz en modo Fleet (info
// de agregador completa sigue disponible en Data Raw y Avance).
export function p2KpiDefsFleet(es) {
  return [
    { key: "nr",                   label: P2T("Nuevos + Reactivados", "New + Reactivated", "Новые + реактивированные"), color: "#f97316", kind: "num" },
    { key: "accept",               label: "Acceptance Rate",                                 color: "#10b981", kind: "pct" },
    { key: "ownedFleetActiveCars", label: P2T("Owned Fleet Active Cars", "Owned Fleet Active Cars", "Активные авто собственного автопарка"), color: "#0284c7", kind: "num" },
    { key: "shCarInt",             label: P2T("Internal Fleet SH/Auto", "Internal Fleet SH/Car", "Часы внутреннего автопарка / авто"),     color: "#8b5cf6", kind: "ratio1" }
  ];
}

// Niveles a mostrar: Perú + ciudades del partner (si tiene >1 ciudad, se agrega Perú).
export function p2Levels(partner) {
  const cities = p2PartnerCities(partner);
  const levels = cities.length > 1
    ? [{ id: "PE", city: null, label: "Perú", color: "#111" }]
    : [];
  cities.forEach(c => levels.push({ id: c.toLowerCase().replace(/[^a-z0-9]/g, ""), city: c, label: cityLabel(c), color: CITY_COLORS[c] || "#888" }));
  return levels;
}

export function p2FmtVal(kind, v) {
  if (v == null || isNaN(v)) return (kind === "pct" || kind === "ratio1") ? "—" : "0";
  if (kind === "pct")    return (v * 100).toFixed(1) + "%";
  if (kind === "money")  return "$" + fmtSmart(v);
  if (kind === "ratio1") return v.toFixed(1);
  return fmt(v);
}

// ── SLIDE 0: MATRIZ (niveles × KPIs) ──────────────────────────────────────────
export function buildSlide2Matrix(partner, dates, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const fleetMode = p2IsFleetMode(partner);
  const kpis = fleetMode ? p2KpiDefsFleet(es) : p2KpiDefs(es);
  const levels = p2Levels(partner);
  const from = dates[0], to = dates[dates.length - 1];
  const rows = levels.map(lv => {
    // Fusiona ad/nr/... (p2Metrics, igual que en taxi) con shCar/accept/activeCars
    // (p2FleetSeries, ponderados) — sin colisión de keys, se pueden mezclar.
    const m = fleetMode
      ? Object.assign({}, p2Metrics(partner, lv.city, dates), p2FleetSeries(partner, lv.city, dates))
      : p2Metrics(partner, lv.city, dates);
    const cards = kpis.map(k => {
      const arr = m[k.key];
      const last = arr[arr.length - 1];
      const prev = arr.length > 1 ? arr[arr.length - 2] : null;
      let badge = "", bColor = "#aaa";
      if (k.kind === "pct") {
        if (last != null && prev != null) { const d = (last - prev) * 100; bColor = d >= 0 ? "#10b981" : "#FF0000"; badge = (d >= 0 ? "+" : "") + d.toFixed(1) + "pp"; }
      } else if (last != null && prev != null && prev !== 0) {
        // last != null: si el ultimo periodo no trae autos de flota (shCarInt=null), NO
        // mostrar un badge "-100%" fantasma — debe quedar "—" (mismo guard que la rama pct).
        const w = (last - prev) / prev * 100; bColor = w >= 0 ? "#10b981" : "#FF0000"; badge = (w >= 0 ? "+" : "") + w.toFixed(1) + "%";
      }
      return `
        <div class="agy-style-356">
          <div class="agy-style-357">
            <span class="agy-style-358"><span style="width:6px;height:6px;border-radius:50%;background:${k.color};flex-shrink:0"></span><span class="agy-style-359">${escapeHTML(k.label)}</span></span>
            <span style="font-size:.64rem;font-weight:700;color:${bColor};background:${bColor}18;padding:1px 5px;border-radius:6px">${badge || "—"}</span>
          </div>
          <div class="agy-style-360">${p2FmtVal(k.kind, last)}</div>
          <div class="agy-style-361"><canvas id="p2_${lv.id}_${k.key}" class="agy-style-362"></canvas></div>
        </div>`;
    }).join("");
    return `
      <div style="display:flex;gap:6px;flex:1 1 0;min-height:0;max-height:270px;border-left:3px solid ${lv.color};padding-left:6px">
        <div class="agy-style-363"><span style="font-weight:800;font-size:.78rem;color:${lv.color};line-height:1.1">${escapeHTML(lv.label)}</span></div>
        <div class="agy-style-364">${cards}</div>
      </div>`;
  }).join("");
  const sub = P2T("Línea = partner (rojo) · gris = tendencia ciudad · punteadas = cohortes", "Line = partner (red) · grey = city trend · dashed = cohorts", "Линия = партнёр (красная) · серая = тренд города · пунктир = когорты");
  return `
    <div class="agy-style-365">
      ${p2BrandHeader(partner, (P2T("KPIs por Nivel", "KPIs by Level", "KPI по уровням")) + " · " + d2s(from) + " → " + d2s(to), sub)}
      <div class="agy-style-366">${rows}</div>
      ${p2BrandFooter(idx)}
    </div>`;
}

export function buildSlide2MatrixCharts(partner, dates, root) {
  const fleetMode = p2IsFleetMode(partner);
  const kpis = fleetMode ? p2KpiDefsFleet(PRESENT2_STATE.lang === "es") : p2KpiDefs(PRESENT2_STATE.lang === "es");
  const FLEET_KEYS = { shCarInt: 1, accept: 1, ownedFleetActiveCars: 1 };   // sin cohorte v1; trend ponderado
  const levels = p2Levels(partner);
  levels.forEach(lv => {
    const m = fleetMode
      ? Object.assign({}, p2Metrics(partner, lv.city, dates), p2FleetSeries(partner, lv.city, dates))
      : p2Metrics(partner, lv.city, dates);
    kpis.forEach(k => {
      let cityVals, cohortLines;
      if (FLEET_KEYS[k.key]) {
        cityVals = lv.city ? p2CityFleetSeries(lv.city, dates)[k.key] : null;
        cohortLines = [];   // v1: sin cohortes ponderadas para KPIs fleet (abierto)
      } else {
        cityVals = k.key === "ret"
          ? p2CityRet(partner, lv.city, dates)
          : p2CityVals(partner, lv.city, dates, k.key === "nr" ? (r => r.newPartner + r.newService + r.reactivated) : P2_GET[k.key]);
        cohortLines = p2CohortLines(lv.city, dates, k.key);
      }
      p2Chart(`p2_${lv.id}_${k.key}`, dates, m[k.key], cityVals, cohortLines, k.color, k.kind === "pct", root);
    });
  });
}

// ── SLIDES 1 y 2: DATA RAW numérico / porcentual ──────────────────────────────
// Columnas (formato de referencia): Trips · Supply Hours · Active Drivers ·
// New Drivers · Reactivated · Partner Commission · N+R · Retención · Trips/SH · Trips/AD · SH/AD.
// Labels espejados al ES/EN de p2KpiDefs (matriz) — la MISMA métrica
// debe llamarse igual en todo el deck. Antes solo "Retención" traducía; el resto quedaba en
// inglés fijo aun con lang=es (inconsistente con KPIs por Nivel/Avance, que sí traducen).
// `grp` agrupa las columnas bajo una cabecera de sección (Volumen / Eficiencia
// / Flota) — misma información, pero la tabla deja de ser una tira de 15
// columnas indistintas: el ojo encuentra primero el bloque y después el dato.
// Pedido de Manuel (ago 2026): agrupar, NO recortar — el partner no tiene
// acceso al CSV y esta tabla es su única fuente.
export function p2RawCols(es) {
  return [
    { key: "trips", label: P2T("Viajes", "Trips", "Поездки"),                 kind: "num", grp: "vol" },
    { key: "sh",    label: P2T("Horas de Conexión", "Supply Hours", "Часы на линии"), kind: "num", grp: "vol" },
    { key: "ad",    label: P2T("Conductores Activos", "Active Drivers", "Активные водители"), kind: "num", grp: "vol" },
    { key: "newd",  label: P2T("Nuevos", "New Drivers", "Новые водители"),           kind: "num", grp: "vol" },
    { key: "react", label: P2T("Reactivados", "Reactivated", "Реактивированные"),      kind: "num", grp: "vol" },
    { key: "nr",    label: "N+R",              kind: "num", grp: "vol" },
    { key: "comm",  label: P2T("Comisión Partner", "Partner Commission", "Комиссия партнёра"), kind: "money", grp: "vol" },
    { key: "ret",   label: P2T("Retención", "Retention", "Удержание"), kind: "pct", grp: "efi" },
    { key: "tripsPerSh", label: "Trips/SH",    kind: "ratio", grp: "efi" },
    { key: "tripsPerAd", label: "Trips/AD",    kind: "ratio", grp: "efi" },
    { key: "shPerAd",    label: "SH/AD",       kind: "ratio", grp: "efi" }
  ];
}
// Fleet: TODAS las columnas de agregador (p2RawCols, sin quitar nada — incluye
// Trips/SH, Trips/AD, SH/AD) + 3 fleet-específicas al final (aditivo, no reemplaza; el
// partner Fleet quiere ver info de agregador Y de fleet juntas).
export function p2RawColsFleet(es) {
  return [
    ...p2RawCols(es),
    { key: "ownedFleetActiveCars", label: "Owned Fleet Active Cars", kind: "num", grp: "fleet" },
    { key: "shCarInt",             label: P2T("Internal Fleet SH/Auto", "Internal Fleet SH/Car", "Часы внутреннего автопарка / авто"),     kind: "ratio1", grp: "fleet" },
    { key: "accept",               label: "Acceptance Rate", kind: "pct", grp: "fleet" }
  ];
}
export function p2FmtRaw(kind, v) {
  if (v == null || isNaN(v)) return "—";
  if (kind === "pct")    return (v * 100).toFixed(1) + "%";
  if (kind === "money")  return "$" + fmt(v);
  if (kind === "ratio")  return v.toFixed(2);
  // ratio1: MISMA precisión que KPIs por Nivel/Avance (p2FmtVal, toFixed(1)) — antes
  // Internal Fleet SH/Auto salía con 2 decimales acá y 1 decimal en el resto del deck
  // para el mismo período (inconsistencia de auditoría).
  if (kind === "ratio1") return v.toFixed(1);
  return fmt(v);
}

export function buildSlide2Raw(partner, dates, pct, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const fleetMode = p2IsFleetMode(partner);
  const cols = fleetMode ? p2RawColsFleet(es) : p2RawCols(es);
  const levels = p2Levels(partner);
  const from = dates[0], to = dates[dates.length - 1];
  const tables = levels.map(lv => {
    const m = fleetMode
      ? Object.assign({}, p2Metrics(partner, lv.city, dates), p2FleetSeries(partner, lv.city, dates))
      : p2Metrics(partner, lv.city, dates);
    // Filas = semanas. En % arrancan desde la 2da semana (WoW).
    const idxs = pct ? dates.map((_, i) => i).slice(1) : dates.map((_, i) => i);
    // Fila de GRUPOS encima de las columnas (Volumen / Eficiencia / Flota):
    // colspan por grupo + borde izquierdo en la primera columna de cada uno.
    const GRP_LBL = { vol: P2T("Volumen", "Volume", "Объём"), efi: P2T("Eficiencia", "Efficiency", "Эффективность"), fleet: P2T("Flota", "Fleet", "Автопарк") };
    const grpStart = new Set();
    let grpRow = `<th class="p2-grp-th" style="border-bottom:none"></th>`;
    for (let gi = 0; gi < cols.length; ) {
      const g = cols[gi].grp; let n = 0;
      grpStart.add(gi);
      while (gi + n < cols.length && cols[gi + n].grp === g) n++;
      grpRow += `<th class="p2-grp-th p2-grp-start" colspan="${n}">${GRP_LBL[g] || ""}</th>`;
      gi += n;
    }
    const head = `<th class="agy-style-367">${p2ModeInfo().unit}</th>` +
      cols.map((c, ci) => `<th class="agy-style-368${grpStart.has(ci) ? " p2-grp-start" : ""}">${escapeHTML(c.label)}</th>`).join("");
    const body = idxs.map(i => {
      const cells = cols.map((c, ci) => {
        const cur = m[c.key][i];
        const gs = grpStart.has(ci) ? " p2-grp-start" : "";
        if (!pct) {
          return `<td class="agy-style-369${gs}">${p2FmtRaw(c.kind, cur)}</td>`;
        }
        // Variación WoW: para % (retención) diferencia en puntos; para el resto % relativo.
        const prev = m[c.key][i - 1];
        let txt = "—", bg = "#fafafa", col = "#888";
        if (cur != null && prev != null) {
          if (c.kind === "pct") { const d = (cur - prev) * 100; col = d >= 0 ? "#065f46" : "#7f1d1d"; bg = d >= 0 ? "#d1fae5" : "#fee2e2"; txt = (d >= 0 ? "+" : "") + d.toFixed(1) + "pp"; }
          else if (prev !== 0)  { const w = (cur - prev) / prev * 100; col = w >= 0 ? "#065f46" : "#7f1d1d"; bg = w >= 0 ? "#d1fae5" : "#fee2e2"; txt = (w >= 0 ? "+" : "") + w.toFixed(1) + "%"; }
        }
        return `<td class="${gs.trim()}" style="text-align:right;padding:3px 6px;font-size:.64rem;background:${bg};color:${col};font-weight:600;border-bottom:1px solid #fff">${txt}</td>`;
      }).join("");
      return `<tr><td class="agy-style-370">${d2s(dates[i])}</td>${cells}</tr>`;
    }).join("");
    return `
      <div class="agy-style-371">
        <div class="agy-style-372">
          <span style="width:10px;height:10px;border-radius:2px;background:${lv.color};display:inline-block"></span>
          <span style="font-weight:800;font-size:.82rem;color:${lv.color}">${escapeHTML(lv.label)}</span>
        </div>
        <div class="agy-style-321"><table class="agy-style-373">
          <thead><tr>${grpRow}</tr><tr class="agy-style-374">${head}</tr></thead><tbody>${body}</tbody></table></div>
      </div>`;
  }).join("");
  const _mi = p2ModeInfo();
  const title = pct ? P2T(`Data Raw · Variación % (${_mi.pop})`, `Data Raw · % change (${_mi.pop})`, `Исходные данные · изменение % (${_mi.pop})`) : (P2T("Data Raw · Valores", "Data Raw · Values", "Исходные данные · значения"));
  return `
    <div class="agy-style-365">
      ${p2BrandHeader(partner, title + " · " + d2s(from) + " → " + d2s(to), "")}
      <div class="agy-style-375">${tables}</div>
      ${p2BrandFooter(idx)}
    </div>`;
}

// ── SLIDE: AVANCE VS META DEL MES ─────────────────────────────────────────────
// Reusa la lógica de metas.js/data.js: actuals month-to-date (AD=max, N+R/SH=sum)
// vs meta (STATE.metasData) + proyección a fin de mes (calcProjectionDays/projA).
// El avance es SIEMPRE del mes seleccionado (no del rango del sidebar).
// Meses META disponibles (nombres, más reciente primero).
export function p2MetaMeses() {
  return [...new Set((STATE.metasData || []).map(m => m.mes))].filter(Boolean)
    .sort((a, b) => _metasMesOrden(b) - _metasMesOrden(a));
}
// Mes META de "Avance vs Meta". Prioridad:
//   1) selección manual (PRESENT2_STATE.avanceMesSel), si tiene metas.
//   2) AUTO: el mes del "Hasta" (el dato que se está viendo) → si estás en junio,
//      compara vs la meta de JUNIO, no vs la más reciente (julio).
//   3) fallback: la meta más reciente.
export function p2AvanceMes() {
  const meses = p2MetaMeses();
  if (!meses.length) return "";
  if (PRESENT2_STATE.avanceMesSel && meses.includes(PRESENT2_STATE.avanceMesSel))
    return PRESENT2_STATE.avanceMesSel;
  const to = (typeof document !== "undefined") && document.getElementById("dateTo")
    ? document.getElementById("dateTo").value : "";
  if (to) {
    // Mes de REPORTE del "Hasta" (en semanal, el mes del jueves de esa semana): ver 29-jun → JULIO.
    const mn = p2ReportYM(to).m;
    const name = P2_MES_NOMBRES[mn - 1];
    if (name && meses.includes(name)) return name;
  }
  return meses[0];
}
// Fechas del MES META `mesName` dentro del dataset activo, ancladas al año del "Hasta"
// y capadas MTD en el "Hasta". SIN fallback a otro mes: si el mes pedido no tiene datos
// (≤ Hasta), devuelve [] y el slide muestra "sin datos de ese mes" (nunca actuals de un
// mes/año bajo la etiqueta+meta de otro). Ver auditoría present2 (hallazgos mes-crossyear).
export function p2MonthDates(mesName) {
  const ord = mesName ? _metasMesOrden(mesName) : 0;   // 2000+m (nombre) o YYYYMM (iso)
  const allDates = p2AllDates();                       // dataset-scoped (tuktuk usa sus fechas)
  const to = (typeof document !== "undefined") && document.getElementById("dateTo")
    ? document.getElementById("dateTo").value : "";
  // Bucketing por mes de REPORTE (p2ReportYM): en semanal la semana cuenta en el mes de su
  // jueves → la semana del 29-jun pertenece a JULIO. En mensual/diario = el mes de la fecha.
  let out = [];
  if (ord >= 100000) {                                 // mes ISO explícito "YYYY-MM"
    const yy = Math.floor(ord / 100), mm = ord % 100;
    out = allDates.filter(d => { const r = p2ReportYM(d); return r.y === yy && r.m === mm; });
  } else if (ord > 2000 && ord < 3000) {               // nombre de mes sin año
    const mn = ord - 2000;
    const matches = allDates.filter(d => p2ReportYM(d).m === mn);
    // Cross-year: elegir el año del "Hasta" (el que el KAM está viendo), no el más
    // reciente del dataset. Se ancla al pool de fechas ≤ Hasta; si el Hasta es anterior
    // a TODAS las coincidencias, se usan todas (selección manual retrospectiva válida).
    // El AÑO también sale del mes de reporte (una semana de dic→ene pertenece al año del ene).
    const pool = to ? matches.filter(d => d <= to) : matches;
    const use = pool.length ? pool : matches;
    const years = [...new Set(use.map(d => String(p2ReportYM(d).y)))].sort();
    const lastYear = years[years.length - 1];
    out = lastYear ? use.filter(d => String(p2ReportYM(d).y) === lastYear) : [];
  }
  // Cap MTD en el "Hasta" (progreso acumulado hasta la fecha vista). SIN rescate: si el
  // Hasta es anterior al mes, out queda [] → el slide muestra "sin datos" (no otro mes).
  if (to && out.length) out = out.filter(d => d <= to);
  return out;
}
// RANGO DEL DECK vs MES DE LA META.
//
// `dates` (lo que renderSlide2 le pasa a cada slide via p2SelectedDates) SI
// respeta el "Desde" y el "Hasta" del sidebar. p2MonthDates NO: devuelve todo el
// mes de la meta hasta el "Hasta", ignorando el "Desde".
//
// El Ejecutivo y el Resumen usaban p2MonthDates y por eso mostraban el mes
// entero aunque el KAM filtrara una sola semana: con el filtro en la semana del
// 24-ago, Metas mostraba N+R 276 y el deck 1.187 para el MISMO partner. Dos
// pantallas, dos numeros — y el deck es el que ve el partner.
//
// Ahora ambos usan la INTERSECCION: las fechas del rango filtrado que ademas
// caen en el mes de la meta. El deck obedece el filtro y sigue sin mezclar
// meses. Cuando el rango no cubre el mes entero, el % contra una meta MENSUAL
// deja de ser comparable — por eso el aviso de cobertura es obligatorio y no
// decorativo (misma logica que el banner que ya tiene la pestana Metas).
export function p2DatesMetaEnRango(mesName, dates) {
  return fechasEnRango(p2MonthDates(mesName), dates);
}

export function p2MetaFor(partner, scopeCity, mes) {
  return (STATE.metasData || []).reduce((o, m) => {
    if (m.partner === partner && m.mes === mes && (!scopeCity || m.city === scopeCity)) {
      // Agregador + TukTuk son aditivos (se suman entre ciudades).
      o.mA += m.mA || 0; o.mNR += m.mNR || 0; o.mH += m.mH || 0;
      o.mtkAD += m.mtkAD || 0; o.mtkNR += m.mtkNR || 0; o.mtkCars += m.mtkCars || 0; o.mtkSH += m.mtkSH || 0;
      // Fleet son TASAS (no se suman): último no-nulo. Con scopeCity=ciudad hay una
      // sola fila; en Perú-general multi-ciudad toma una (referencia, no exacto).
      if (m.mSHcar != null) o.mSHcar = m.mSHcar;
      if (m.mAcc   != null) o.mAcc   = m.mAcc;
      if (m.mUtil  != null) o.mUtil  = m.mUtil;
    }
    return o;
  }, { mA: 0, mNR: 0, mH: 0, mtkAD: 0, mtkNR: 0, mtkCars: 0, mtkSH: 0, mSHcar: null, mAcc: null, mUtil: null });
}
// Actuals: AD = máx sobre fechas de (Σciudades) — MISMO criterio que getRPC/metas.js:
// suma las ciudades POR FECHA y LUEGO toma el máximo. NO Σciudades(máx del mes), que
// sobre-cuenta a los partners multi-ciudad (suma el pico de cada ciudad aunque ocurran
// en semanas distintas). N+R y SH = suma (invariantes al orden). p2GetPartnerVals es
// dataset-scoped (taxi usa STATE._byCityDate; tuktuk STATE._tuktukByCityDate).
export function p2ActualsMTD(partner, scopeCity, monthDates) {
  const cities = scopeCity ? [scopeCity] : p2PartnerCities(partner);
  const adPer = cities.map(c => p2GetPartnerVals(partner, c, monthDates, P2_GET.ad));
  const ndPer = cities.map(c => p2GetPartnerVals(partner, c, monthDates, P2_GET.newd));
  const rcPer = cities.map(c => p2GetPartnerVals(partner, c, monthDates, P2_GET.react));
  const shPer = cities.map(c => p2GetPartnerVals(partner, c, monthDates, P2_GET.sh));
  // Serie por fecha sumando ciudades (Σciudades por fecha).
  const adTot = monthDates.map((_, i) => cities.reduce((s, _c, ci) => s + (adPer[ci][i] || 0), 0));
  const nrV   = monthDates.map((_, i) => cities.reduce((s, _c, ci) => s + (ndPer[ci][i] || 0) + (rcPer[ci][i] || 0), 0));
  const shV   = monthDates.map((_, i) => cities.reduce((s, _c, ci) => s + (shPer[ci][i] || 0), 0));
  const ad     = adTot.length ? Math.max(...adTot) : 0;        // máx de (Σciudades por fecha)
  const nr     = nrV.reduce((s, v) => s + v, 0);
  const sh     = shV.reduce((s, v) => s + v, 0);
  const lastAD = adTot.length ? adTot[adTot.length - 1] : 0;   // Σciudades en la última fecha (el FACT que se muestra)
  // adV (serie por período) va en el return porque la proyección de AD necesita
  // el MÁXIMO del rango, no solo el último valor. Ver p2ProjMTD.
  return { ad, nr, sh, nrV, shV, adV: adTot, lastAD };
}
export function p2ProjMTD(act, lastDate) {
  const { daysElapsed, daysRemaining } = p2DiasMes(lastDate);
  // AD es SNAPSHOT (nivel), no un flujo acumulado, así que NO se extrapola por
  // días restantes como N+R y las horas. Su proyección es máx del rango × 1.4
  // (POTENCIAL, regla de negocio restaurada 29-ago-2026 — historial en
  // domain/metrics.ts). La regla vive en UN solo lugar (projectSnapshot); si
  // hay que discutirla, se discute allá, no se bifurca acá — bifurcarla ya
  // causó una vez que el deck y Metas dieran números distintos.
  return {
    ad: projAD(act.adV || [], lastDate),
    nr: projectFlow(act.nr, daysElapsed, daysRemaining),
    sh: projectFlow(act.sh, daysElapsed, daysRemaining)
  };
}
// Delega en pColor() (core/format), la MISMA escala que Metas, Rendimiento y el
// portal — para que un 86% no signifique una cosa acá y otra allá. Los cortes
// vigentes y el porqué de cada uno están documentados en pColor.
export function p2AvanceColor(pct) { return pColor(pct); }

// Tarjeta "Referencia" (sin meta en BD, ej. Fleet): valor actual + badge WoW,
// estilo visualmente distinto (fondo celeste) de las tarjetas con meta real.
export function p2RefCard(label, arr, kind, es) {
  const last = arr[arr.length - 1], prev = arr.length > 1 ? arr[arr.length - 2] : null;
  const fmtN = kind === "pct" ? (v => v == null ? "—" : (v * 100).toFixed(1) + "%")
             : kind === "ratio1" ? (v => v == null ? "—" : v.toFixed(1))
             : fmt;
  let badge = "", bColor = "#aaa";
  if (kind === "pct") {
    if (last != null && prev != null) { const d = (last - prev) * 100; bColor = d >= 0 ? "#10b981" : "#FF0000"; badge = (d >= 0 ? "+" : "") + d.toFixed(1) + "pp"; }
  } else if (last != null && prev != null && prev !== 0) {
    const w = (last - prev) / prev * 100; bColor = w >= 0 ? "#10b981" : "#FF0000"; badge = (w >= 0 ? "+" : "") + w.toFixed(1) + "%";
  }
  return `<div class="agy-style-376">
    <div class="agy-style-377">
      <span class="agy-style-378">${escapeHTML(label)}</span>
      <span style="font-size:.62rem;font-weight:700;color:${bColor}">${badge}</span>
    </div>
    <div class="agy-style-379">${fmtN(last)}</div>
    <div class="agy-style-380">${P2T("Referencia (sin meta)", "Reference (no target)", "Справочно (без цели)")}</div>
  </div>`;
}

// Tarjeta meta-vs-actual reutilizable (Fleet/TukTuk): actual/goal + % + barra.
// projV null → sin línea de proyección (KPIs de tasa/snapshot no proyectan).
export function _p2MetaCard(label, real, goal, projV, fmtN, es) {
  const pct = goal > 0 ? (real / goal) * 100 : 0;
  const col = p2AvanceColor(pct);
  const ppct = (projV != null && goal > 0) ? (projV / goal) * 100 : null;
  return `<div class="agy-style-381">
    <div class="agy-style-382">
      <span class="agy-style-383">${escapeHTML(label)}</span>
      <span style="font-size:.74rem;font-weight:800;color:${col}">${pct.toFixed(0)}%</span>
    </div>
    <div class="agy-style-384">
      <span class="agy-style-385">${fmtN(real)}</span>
      <span class="agy-style-386">/ ${fmtN(goal)}</span>
    </div>
    <div class="agy-style-387">
      ${ppct != null && ppct > pct ? `<div style="position:absolute;top:0;left:0;height:100%;width:${Math.min(Math.max(ppct, 0), 100).toFixed(1)}%;background:${p2AvanceColor(ppct)};opacity:.35;border-radius:5px"></div>` : ""}
      <div style="position:absolute;top:0;left:0;height:100%;width:${Math.min(pct, 100).toFixed(1)}%;background:${col};border-radius:5px"></div>
      ${ppct != null ? `<div class="p2-proj-tick" style="left:calc(${Math.min(Math.max(ppct, 0), 100).toFixed(1)}% - 1px)"></div>` : ""}
    </div>
    ${ppct != null ? `<div class="agy-style-388">${P2T("proy", "proj", "прогн.")} ${fmtN(projV)} (${ppct.toFixed(0)}%)</div>` : ""}
  </div>`;
}
// Tarjeta solo-meta (sin actual medible, ej. Utilización Fleet).
export function _p2MetaOnlyCard(label, goal, fmtN, note, es) {
  return `<div class="agy-style-389">
    <span class="agy-style-390">${escapeHTML(label)}</span>
    <div class="agy-style-379">${fmtN(goal)}</div>
    <div class="agy-style-391">${P2T("meta", "target", "цель")}${note ? " · " + note : ""}</div>
  </div>`;
}

// % honesto: NO redondear 99.5-99.99 a "100%" (parecería meta cumplida sin estarlo).
// <100 → 1 decimal (99.6%); ≥100 → entero (106%). Espeja el criterio de la pestaña Metas.
export function _p2PctTxt(pct) { return (pct >= 100 ? pct.toFixed(0) : Math.min(pct, 99.9).toFixed(1)) + "%"; }
// ── SLIDE: RESUMEN / SCORECARD (ago 2026) ─────────────────────────────────────
// Consolida en UNA hoja lo que hoy toma tres (Avance Combinado + Avance vs Meta
// + 🛺 Avance vs Meta). Responde de un vistazo: ¿cómo voy, en qué ciudad, y en
// qué categoría?
//
// Dos zonas separadas A PROPÓSITO, porque no todo se mide igual:
//   1. CUMPLIMIENTO — solo donde hay meta. La meta paraguas (mA/mNR/mH) cubre
//      Taxi + TukTuk juntos, así que el actual que se compara es la SUMA de
//      ambos. No se le suma meta_tk_* (obsoleta desde ago 2026).
//   2. COMPOSICIÓN — las 4 verticales con su actual y su crecimiento. Sin meta
//      para Delivery/Cargo (aún no definidas): se muestran como referencia.
// Mezclar las dos zonas sería fingir que Delivery tiene cumplimiento cuando no
// tiene meta contra la cual medirlo.

// Totales {ad, nr, sh} de un slice crudo para (partner, ciudad, fechas).
// AD es SNAPSHOT: se agrega por fecha y se toma el último período, nunca la
// suma. Sirve para cualquier vertical porque opera sobre el slice que reciba.
export function p2VerticalTotals(rows, partner, city, dates) {
  const dset = new Set(dates || []);
  const adByDate = {};
  let nr = 0, sh = 0, presente = false;
  for (const r of (rows || [])) {
    if (r.partner !== partner) continue;
    if (city && r.city !== city) continue;
    if (!dset.has(r.date)) continue;
    presente = true;
    adByDate[r.date] = (adByDate[r.date] || 0) + (r.activeDrivers || 0);
    nr += (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0);
    sh += (r.supplyHours || 0);
  }
  const serie = seriesByDate(adByDate);
  return { ad: snapshotValue(serie), adV: serie, nr, sh, presente };
}

// Slices Delivery/Cargo de la escala activa. Espeja _sliceEscala de
// rendimiento/metas: un booleano no alcanza para TRES escalas — en diario caía
// al slice semanal en silencio (bug real de jul 2026).
export function p2SliceVertical(vertical) {
  const m = STATE.curMode;
  if (vertical === "delivery") {
    return (m === "mensual" ? STATE.rawDataMensualDelivery
          : m === "diario"  ? STATE.rawDataDiarioDelivery
          : STATE.rawDataDelivery) || [];
  }
  return (m === "mensual" ? STATE.rawDataMensualCargo
        : m === "diario"  ? STATE.rawDataDiarioCargo
        : STATE.rawDataCargo) || [];
}

// Celda de cumplimiento: actual / meta + % coloreado. Sin meta → guion, NUNCA
// 0% (un 0% se lee como incumplimiento cuando en realidad no se mide).
function _scCell(real, meta, fmtN) {
  if (!meta) return `<td class="sc-num sc-nometa">${fmtN(real)}<span class="sc-sub">sin meta</span></td>`;
  const pct = (real / meta) * 100;
  return `<td class="sc-num">
    <span class="sc-val">${fmtN(real)}</span><span class="sc-meta">/ ${fmtN(meta)}</span>
    <span class="sc-pct" style="color:${p2AvanceColor(pct)}">${_p2PctTxt(pct)}</span>
  </td>`;
}

export function buildSlide2Resumen(partner, dates, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const savedDs = PRESENT2_STATE.dataset;
  const mesName = p2AvanceMes();

  // Fechas y actuales por vertical. Taxi/TukTuk salen de los accesores del deck
  // (mismo camino que el resto de las slides → los números deben coincidir);
  // Delivery/Cargo de sus slices, ya indexados por escala.
  PRESENT2_STATE.dataset = "taxi";
  const taxiDates = p2DatesMetaEnRango(mesName, dates);
  const levels = p2Levels(partner);
  PRESENT2_STATE.dataset = "tuktuk";
  const tkDates = p2DatesMetaEnRango(mesName, dates);
  PRESENT2_STATE.dataset = savedDs;

  // Fechas efectivas del slide = las del mes de la meta DENTRO del rango filtrado.
  const mesDates = taxiDates.length ? taxiDates : tkDates;
  // Mismo aviso que el Ejecutivo: con el rango recortado los FLUJOS acumulan
  // menos y su % contra una meta MENSUAL deja de ser comparable.
  PRESENT2_STATE.dataset = taxiDates.length ? "taxi" : "tuktuk";
  const todasDelMes = p2MonthDates(mesName);
  PRESENT2_STATE.dataset = savedDs;
  const rangoParcial = todasDelMes.length > mesDates.length;
  const metasLoaded = !!(STATE.metasData || []).length;
  if (!mesDates.length || !metasLoaded) {
    return `<div class="agy-style-365">
      ${p2BrandHeader(partner, (P2T("Resumen", "Summary", "Итоги")) + " · " + p2MesLabel(mesName), "")}
      <div class="agy-style-396">${P2T("Sin datos o metas del mes.", "No data or targets.", "Нет данных или целей.")}</div>
      ${p2BrandFooter(idx)}</div>`;
  }

  // ── Zona 1: cumplimiento por ciudad (paraguas Taxi + TukTuk) ──────────────
  // Cada celda lleva su barra: el subrayado da el "cuán lleno" de un vistazo
  // sin costar una fila entera de alto.
  const celda = (real, meta, f) => {
    if (!meta) return `<td class="rs-c rs-nm">${f(real)}<i>${P2T("sin meta", "no target", "без цели")}</i></td>`;
    const pct = (real / meta) * 100, col = pColor(pct);
    return `<td class="rs-c">
      <span class="rs-v">${f(real)}</span><span class="rs-m">/ ${f(meta)}</span>
      <span class="rs-p" style="color:${col}">${_p2PctTxt(pct)}</span>
      <span class="rs-bar"><i style="width:${Math.min(pct,100).toFixed(1)}%;background:${col}"></i></span>
    </td>`;
  };
  const filasCumpl = levels.map(lv => {
    PRESENT2_STATE.dataset = "taxi";  const a = p2ActualsMTD(partner, lv.city, taxiDates);
    PRESENT2_STATE.dataset = "tuktuk"; const b = p2ActualsMTD(partner, lv.city, tkDates);
    PRESENT2_STATE.dataset = savedDs;
    const m = p2MetaFor(partner, lv.city, mesName);
    return `<tr>
      <td class="rs-l"><span class="rs-d" style="background:${lv.color}"></span>${escapeHTML(lv.label)}</td>
      ${celda((a.lastAD||0)+(b.lastAD||0), m.mA||0, fmt)}
      ${celda((a.nr||0)+(b.nr||0),         m.mNR||0, fmt)}
      ${celda((a.sh||0)+(b.sh||0),         m.mH||0, fmtSmart)}
    </tr>`;
  }).join("");

  // ── Zona 2: composición por vertical ─────────────────────────────────────
  // PARTICIÓN: las 4 suman el total. Fleet NO va acá — sus autos hacen viajes
  // de Taxi, así que es un subconjunto, no una quinta categoría: ponerlo como
  // fila contaría esos conductores dos veces. Va en su propio bloque.
  const VERTS = [
    { k: "taxi",     lbl: "Taxi",     col: "#FF0000" },
    { k: "tuktuk",   lbl: "TukTuk",   col: "#f59e0b" },
    { k: "delivery", lbl: "Delivery", col: "#0284c7" },
    { k: "cargo",    lbl: "Cargo",    col: "#8b5cf6" }
  ];
  const comp = VERTS.map(v => {
    let t;
    if (v.k === "taxi" || v.k === "tuktuk") {
      PRESENT2_STATE.dataset = v.k;
      t = p2ActualsMTD(partner, null, v.k === "taxi" ? taxiDates : tkDates);
      t.ad = t.lastAD;
      // "Hay" = ESTE partner opera la vertical, no "el dataset tiene fechas".
      // Con lo segundo, un partner sin TukTuk igual recibía una fila "TukTuk
      // 0 / 0 / 0" (las fechas del slice son globales, de todos los partners) —
      // y una fila de ceros no se lee como "no aplica", se lee como una
      // operación muerta.
      t.hay = p2ActivePartners().includes(partner);
      PRESENT2_STATE.dataset = savedDs;
    } else {
      t = p2VerticalTotals(p2SliceVertical(v.k), partner, null, mesDates);
      t.hay = t.presente;
    }
    return { ...v, ad: t.ad || 0, nr: t.nr || 0, sh: t.sh || 0, hay: t.hay };
  }).filter(v => v.hay || v.ad || v.nr || v.sh);
  const totAD = comp.reduce((s, v) => s + v.ad, 0) || 1;
  const filasComp = comp.map(v => `<tr>
      <td class="rs-l"><span class="rs-d" style="background:${v.col}"></span>${v.lbl}</td>
      <td class="rs-c"><span class="rs-v">${fmt(v.ad)}</span><span class="rs-p rs-share">${(v.ad/totAD*100).toFixed(0)}%</span></td>
      <td class="rs-c"><span class="rs-v">${fmt(v.nr)}</span></td>
      <td class="rs-c"><span class="rs-v">${fmtSmart(v.sh)}</span></td>
    </tr>`).join("");

  // ── Zona 3: Fleet — lente sobre Taxi, no una vertical ────────────────────
  // Fleet se muestra SIEMPRE que el partner tenga autos propios, sin importar
  // el selector Auto/Taxi/Fleet de la barra de filtros: ese selector cambia la
  // VISTA del KAM, y el Resumen es una foto completa del partner que no debe
  // moverse segun donde quedo un toggle.
  let fleetHTML = "";
  {
    PRESENT2_STATE.dataset = "taxi";
    const fs = p2FleetSeries(partner, null, taxiDates);
    PRESENT2_STATE.dataset = savedDs;
    const ult = arr => (arr && arr.length) ? arr[arr.length - 1] : null;
    const tieneFleet = (fs.ownedFleetActiveCars || []).some(v => v > 0);
    const m = p2MetaFor(partner, null, mesName);
    const chips = [
      { l: P2T("Autos propios", "Owned cars", "Собственные авто"), v: ult(fs.ownedFleetActiveCars), f: v => v == null ? "—" : fmt(v) },
      { l: P2T("SH / auto", "SH / car", "Часы / авто"),       v: ult(fs.shCarInt),            f: v => v == null ? "—" : v.toFixed(1), meta: m.mSHcar },
      { l: P2T("Aceptación", "Acceptance", "Принятие"),    v: ult(fs.accept),              f: v => v == null ? "—" : (v*100).toFixed(1)+"%", meta: m.mAcc, esPct: true },
      { l: P2T("Utilización", "Utilization", "Загрузка"),  v: null,                        f: () => m.mUtil != null ? fmt(m.mUtil)+"%" : "—", soloMeta: true }
    ];
    if (tieneFleet) fleetHTML = `<div class="rs-card rs-fleet">
      <div class="rs-h"><span class="rs-n">#</span>Fleet <span class="rs-sub">${P2T("dentro de Taxi", "within Taxi", "внутри Такси")}</span></div>
      <div class="rs-chips">${chips.map(c => {
        const val = c.f(c.v);
        let cmp = "";
        if (c.meta != null && c.v != null) {
          const real = c.esPct ? c.v * 100 : c.v;
          const pct = (real / c.meta) * 100;
          cmp = `<i style="color:${pColor(pct)}">${_p2PctTxt(pct)} ${P2T("de meta", "of target", "от цели")}</i>`;
        } else if (c.soloMeta) cmp = `<i>${P2T("meta · sin actual", "target · no actual", "цель · факта нет")}</i>`;
        return `<div class="rs-chip"><span>${escapeHTML(c.l)}</span><b>${val}</b>${cmp}</div>`;
      }).join("")}</div>
    </div>`;
  }

  // ── Zona 4: criterios TukTuk, lo esencial ────────────────────────────────
  let tkHTML = "";
  if (p2TuktukSectionVisible(partner)) {
    const ym = p2TkCriteriosYM(mesName);   // MISMO mes que la meta de abajo
    const d = p2TkCriteriosDatos(partner, null, ym);
    if (d.hay) {
      const h = horasPorConductorBase(d.sh, d.ad, d.nuevos, d.react);
      const meta = p2MetaFor(partner, null, mesName);
      const mNuevos = meta.mtkNR || 0;
      const naTxt = h.estado === "pocos_activos"
        ? P2T(`no aplica · menos de ${TK_MIN_ACTIVOS} activos`, `n/a · under ${TK_MIN_ACTIVOS} active`, `не применимо · меньше ${TK_MIN_ACTIVOS} активных`)
        : (P2T("no medible · sin base", "n/a · no base", "не измеримо · нет базы"));
      const col1 = h.valor == null ? "#888" : (h.estado === "cumple" ? "#10b981" : "#FF0000");
      const pct2 = mNuevos > 0 ? (d.nr / mNuevos) * 100 : null;
      tkHTML = `<div class="rs-card rs-tk">
        <div class="rs-h"><span class="rs-n">#</span>${P2T("Criterios TukTuk", "TukTuk criteria", "Критерии ТукТук")}
          <span class="rs-sub">${P2T("lo que te pedimos cada mes", "what we ask each month", "что мы просим каждый месяц")}</span></div>
        <div class="rs-chips">
          <div class="rs-chip"><span>${P2T("Horas / conductor base", "Hours / base driver", "Часов / базовый водитель")}</span>
            <b style="color:${col1}">${h.valor == null ? "—" : h.valor.toFixed(1) + " h"}</b>
            <i style="color:${col1}">${h.valor == null ? naTxt
              : (h.estado === "cumple" ? (P2T("✓ cumple", "✓ meets", "✓ соответствует")) : (P2T("✗ no cumple", "✗ below", "✗ не соответствует"))) + ` · mín ${TK_HORAS_BASE_MIN} h`}</i></div>
          <div class="rs-chip"><span>${P2T("Nuevos + Reactivados", "New + Reactivated", "Новые + реактивированные")}</span>
            <b>${fmt(d.nr)}</b>
            <i${pct2 != null ? ` style="color:${pColor(pct2)}"` : ""}>${pct2 != null
              ? `${_p2PctTxt(pct2)} ${P2T("de meta", "of target", "от цели")} (${fmt(mNuevos)})`
              : (P2T("sin meta cargada", "no target", "цель не загружена"))}</i></div>
        </div>
      </div>`;
    }
  }

  // colgroup + table-layout:fixed (styles.css): las dos tablas comparten grilla,
  // así los encabezados de una caen exactamente sobre los de la otra.
  const cols = `<colgroup><col class="rs-c1"><col class="rs-cm"><col class="rs-cm"><col class="rs-cm"></colgroup>`;
  const th = (a, b, c) => `<tr><th></th><th>${a}</th><th>${b}</th><th>${c}</th></tr>`;
  const L = { ad: P2T("Conductores Activos", "Active Drivers", "Активные водители"),
              nr: P2T("Nuevos + Reactivados", "New + React", "Новые + реакт."),
              sh: P2T("Horas de Conexión", "Supply Hours", "Часы на линии") };

  // Numeración de las zonas: CORRELATIVA sobre las que de verdad se muestran, y
  // en el ORDEN EN QUE APARECEN. Estaba fija (1,2,3,4) y un partner sin Fleet
  // recibía "1, 2, 4" — se lee como que falta un bloque, no como que no aplica.
  // Se renumera sobre el HTML ya armado y no con un contador al construir cada
  // bloque, porque Fleet y TukTuk se arman ANTES que las dos zonas de arriba: un
  // contador les habría dado 1 y 2.
  let _z = 0;
  const numerar = html => html.replace(/<span class="rs-n">#<\/span>/g, () => `<span class="rs-n">${++_z}</span>`);

  return numerar(`<div class="agy-style-365 p2-hoja-cards">
    ${p2BrandHeader(partner, (P2T("Resumen", "Summary", "Итоги")) + " · " + p2MesLabel(mesName),
      P2T("Cumplimiento del mes y de dónde viene", "Monthly attainment and where it comes from", "Выполнение месяца и его источники"))}
    <div class="rs-wrap">
      ${rangoParcial ? `<div class="px-aviso">${es
        ? `El rango filtrado cubre <b>${mesDates.length} de ${todasDelMes.length}</b> períodos del mes: <b>Nuevos + Reactivados</b> y <b>Horas de Conexión</b> acumulan solo esos, así que su % contra la meta <b>mensual</b> queda corto por el recorte del rango, no por desempeño.`
        : `The filtered range covers <b>${mesDates.length} of ${todasDelMes.length}</b> periods of the month: <b>New + Reactivated</b> and <b>Supply Hours</b> accumulate only those, so their % against a <b>monthly</b> target falls short due to the range cut, not performance.`}</div>` : ""}
      <div class="rs-card">
        <div class="rs-h"><span class="rs-n">#</span>${P2T("¿Cumplo la meta del mes?", "Am I meeting the target?", "Выполняю ли я цель месяца?")}
          <span class="rs-sub">${P2T("Taxi + TukTuk — la meta cubre las dos", "Taxi + TukTuk", "Такси + ТукТук — цель покрывает обе линии")}</span></div>
        <table class="rs-t">${cols}<thead>${th(L.ad, L.nr, L.sh)}</thead><tbody>${filasCumpl}</tbody></table>
      </div>
      <div class="rs-card rs-comp">
        <div class="rs-h"><span class="rs-n">#</span>${P2T("¿De dónde viene?", "Where does it come from?", "Откуда это берётся?")}
          <span class="rs-sub">${P2T(`Perú · ${comp.length === 1 ? "la vertical que operás" : `las ${comp.length} suman el total`}`,
            `Peru · ${comp.length === 1 ? "the vertical you operate" : `the ${comp.length} sum to total`}`,
            `Перу · ${comp.length === 1 ? "ваша вертикаль" : `${comp.length} в сумме дают итог`}`)}</span></div>
        <table class="rs-t">${cols}<thead>${th(L.ad, L.nr, L.sh)}</thead><tbody>${filasComp}</tbody></table>
      </div>
      ${fleetHTML || tkHTML ? `<div class="rs-dos">${fleetHTML}${tkHTML}</div>` : ""}
    </div>
    ${p2BrandFooter(idx)}
  </div>`);
}
// ── SLIDE: CRITERIOS TUKTUK (ago 2026) ────────────────────────────────────────
// Reemplaza el formato viejo de "Criterios del mes" (que medía adquisición
// propia contra un 100 hardcodeado). Los criterios nuevos son dos:
//   1. Horas por conductor BASE >= 24h  (umbral fijo, igual para todos)
//   2. Nuevos + Reactivados vs la meta que el KAM carga (meta_tk_nr)
//
// SIEMPRE se calcula sobre datos MENSUALES, sea cual sea la escala en la que el
// KAM esté navegando: en semanal el AD es un snapshot y N+R acumula, así que la
// base (activos - nuevos - reactivados) se va a negativo — verificado contra
// producción (YevoGo -6, PIAGGIO -65). Por eso se lee rawDataMensualTuktuk y no
// el dataset activo.
export function p2TkCriteriosDatos(partner, city, ym) {
  const rows = (STATE.rawDataMensualTuktuk || []).filter(r =>
    r.partner === partner && (!city || r.city === city) && (!ym || String(r.date).slice(0, 7) === ym));
  let ad = 0, nuevos = 0, react = 0, sh = 0;
  for (const r of rows) {
    ad     += r.activeDrivers || 0;
    nuevos += (r.newPartner || 0) + (r.newService || 0);
    react  += r.reactivated || 0;
    sh     += r.supplyHours || 0;
  }
  return { ad, nuevos, react, sh, nr: nuevos + react, hay: rows.length > 0 };
}

// Mes (YYYY-MM) sobre el que se evalúan los criterios. Sale del MES DE LA META
// que el slide está mostrando (`mesName`, = p2AvanceMes), no del mes calendario
// del "Hasta".
//
// Antes devolvía `to.slice(0,7)` y eso rompía dos veces: (1) con una semana que
// arranca el 29/30/31 el mes de reporte es el SIGUIENTE (jueves) — el chip sumaba
// el N+R de junio y lo dividía por la meta de julio, bajo un encabezado que dice
// JULIO; (2) con el selector manual "Mes meta" el chip ignoraba la selección y
// seguía en el mes del "Hasta". El actual y la meta tienen que salir del MISMO
// mes o el % no significa nada.
export function p2TkCriteriosYM(mesName) {
  const ord = mesName ? _metasMesOrden(mesName) : 0;
  const to = (typeof document !== "undefined") && document.getElementById("dateTo")
    ? document.getElementById("dateTo").value : "";
  const ym = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
  if (ord >= 100000) return ym(Math.floor(ord / 100), ord % 100);   // mes ISO "YYYY-MM"
  const mn = (ord > 2000 && ord < 3000) ? ord - 2000 : 0;           // nombre de mes sin año
  if (mn) {
    // Año: el del "Hasta" leído como mes de REPORTE (misma regla que p2MonthDates).
    if (to) {
      const r = p2ReportYM(to);
      if (r.m === mn) return ym(r.y, mn);
    }
    // Selección manual de un mes distinto al del "Hasta": el año más reciente con
    // datos mensuales de TukTuk para ese mes.
    const pool = (STATE._tuktukMensualDates || [])
      .filter(d => parseInt(String(d).slice(5, 7), 10) === mn).sort();
    return pool.length ? String(pool[pool.length - 1]).slice(0, 7) : "";
  }
  // Sin mes de meta (no hay metas cargadas): último mes con datos.
  const ds = (STATE._tuktukMensualDates || []);
  return ds.length ? String(ds[ds.length - 1]).slice(0, 7) : "";
}
// ── SLIDE: BENCHMARK OPERACIONAL (ago 2026) ───────────────────────────────────
// Las 4 métricas de operación que más separan a un partner de otro y que hoy no
// aparecen en el deck para nadie que no sea Fleet. Verificado sobre la última
// semana con partners de >=50 activos: aceptación va de 43,8% a 76,5%, USD/hora
// de 4,48 a 7,50, viajes/hora de 1,12 a 4,32.
//
// OJO — son TASAS: se ponderan por su denominador real (aceptación por viajes,
// USD/hora por horas). Promediarlas a secas entre períodos o ciudades da un
// número que no significa nada. Ver weightedAvg en domain/metrics.
//
// NO se presenta como causa de la pérdida de conductores: se probó partiendo
// los partners en cuartiles por USD/hora y la variación de AD fue igual en
// todos (+1,9% / +2,9% / +1,1% / +1,8%). Es diagnóstico y comparación, no
// predicción.
// OJO con el 0 vs null: el denominador de cada tasa es el peso de las filas que
// TRAÍAN el dato, no el total de viajes/horas. Con `trips > 0 ? accW/trips : null`
// un partner sin ninguna acceptance_rate cargada devolvía 0 (no null) y entraba
// al cohorte como si aceptara el 0% de los viajes, hundiendo la mediana de todos
// los demás. Hoy producción trae las 41 columnas al 100%, así que no se ve; se
// vio en local con un partner sembrado sin tasas, y volvería a aparecer con
// cualquier escala o vertical nueva que no traiga la columna.
export function p2OpsMetrics(rows) {
  let trips = 0, horas = 0, accW = 0, badW = 0, mphW = 0, cmpW = 0;
  let accD = 0, badD = 0, mphD = 0, cmpD = 0;   // denominadores CON dato
  // AD es SNAPSHOT: el nivel es el máximo por FECHA (Σ ciudades), nunca la suma
  // de filas — con 3 ciudades × 4 semanas, Math.max sobre filas sueltas devuelve
  // el pico de UNA ciudad y hunde el ratio horas/conductor.
  const adPorFecha = {};
  for (const r of rows) {
    const t = r.trips || 0, h = r.supplyHours || 0;
    trips += t; horas += h;
    adPorFecha[r.date] = (adPorFecha[r.date] || 0) + (r.activeDrivers || 0);
    if (r.acceptanceRate      != null) { accW += r.acceptanceRate * t;     accD += t; }
    if (r.badRatedTripsShare  != null) { badW += r.badRatedTripsShare * t; badD += t; }
    if (r.completionRate      != null) { cmpW += r.completionRate * t;     cmpD += t; }
    if (r.moneyPerHour        != null) { mphW += r.moneyPerHour * h;       mphD += h; }
  }
  const ad = Math.max(0, ...Object.values(adPorFecha));
  return {
    accept:   accD > 0 ? accW / accD : null,
    bad:      badD > 0 ? badW / badD : null,
    completion: cmpD > 0 ? cmpW / cmpD : null,
    mph:      mphD > 0 ? mphW / mphD : null,
    tripsHr:  horas > 0 ? trips / horas : null,
    // Horas por conductor en el RANGO (no por semana): crece con el rango, pero
    // el cohorte se calcula sobre el mismo rango, así que la comparación es
    // justa. Mide intensidad de uso: dos partners con el mismo AD pueden tener
    // la mitad de horas cada uno.
    hrsDriver: ad > 0 ? horas / ad : null,
    ad
  };
}
// Embudo de ACTIVACIÓN de los perfiles que registra el PARTNER (no los que trae
// el servicio): de cada 100 perfiles creados, cuántos llegan a 1 / 10 / 50 / 100
// viajes. Las columnas new_profiles_partner_reg* de taxiparks ya vienen como
// PROPORCIÓN (verificado contra producción: Yego 73 perfiles → 0.2099 / 0.1235 /
// 0.0741 / 0.0123), así que al agregar se ponderan por new_profiles_partner —
// promediarlas a secas le daría el mismo peso a una semana de 2 perfiles que a
// una de 90.
//
// Devuelve null (no 0) cuando el partner no registró perfiles propios en el
// rango: 0% se leería como "no activás a nadie" cuando en realidad no hubo a
// quién activar. En producción 6 de 86 partners comparables están en ese caso.
export function p2FunnelMetrics(rows) {
  let np = 0, w1 = 0, w10 = 0, w50 = 0, w100 = 0;
  for (const r of rows) {
    const n = r.newProfilesPartner || 0;
    if (!n) continue;
    np += n;
    w1   += (r.newProfilesPartnerReg1   || 0) * n;
    w10  += (r.newProfilesPartnerReg10  || 0) * n;
    w50  += (r.newProfilesPartnerReg50  || 0) * n;
    w100 += (r.newProfilesPartnerReg100 || 0) * n;
  }
  if (!np) return { perfiles: 0, r1: null, r10: null, r50: null, r100: null };
  return { perfiles: np, r1: w1 / np, r10: w10 / np, r50: w50 / np, r100: w100 / np };
}
// ── SLIDE: PORTADA EJECUTIVA (ago 2026) ───────────────────────────────────────
// La lee la GERENCIA DEL PARTNER. Si solo leen esta hoja, tiene que alcanzar:
// veredicto arriba, los 3 KPIs con su brecha, la lectura en frases con números,
// y UNA acción.
//
// El gráfico es un BULLET CHART (barra de avance + marca de meta + marca de
// calendario), no una torta ni columnas: es el formato que responde "¿cuánto
// llevo, cuánto me falta y voy a tiempo?" en un solo golpe de vista y sin
// leyenda. Cuatro barras apiladas se comparan entre sí de inmediato; cuatro
// gráficos distintos, no.
// Tira de benchmark para el pie del Ejecutivo. Antes era una hoja entera y tenía
// poca información para ocuparla; acá cumple mejor su función porque EXPLICA el
// veredicto: "vas al 86% y además tu aceptación está 28% bajo la mediana" es una
// historia, los dos datos separados son dos números sueltos.
// COHORTE ACOTADO A LAS CIUDADES DEL PARTNER. Antes comparaba contra todos los
// partners del país y eso hacía trampa en las dos direcciones: medido en
// producción (últimas 4 semanas, 86 partners con ≥50 activos), la mediana de
// viajes/hora es 1,56 en Lima, 2,14 en Arequipa y 2,37 en Trujillo, y la tarifa
// media 4,14 vs 3,29 vs 2,51. Contra la mediana nacional (1,99) un partner de
// Trujillo salía "mejor que el mercado" por estar en Trujillo, y uno de Lima
// salía "peor" por estar en Lima. Son mercados distintos, no operaciones
// distintas.
//
// Cada partner del cohorte se mide SOLO en las ciudades donde opera el partner
// que estamos mirando, así que la comparación es sobre el mismo terreno.
export function p2BenchCohorte(partner, dates) {
  const dset = new Set(dates || []);
  const enRango = (STATE.rawData || []).filter(r => dset.has(r.date));
  const mias = enRango.filter(r => r.partner === partner);
  if (!mias.length) return null;
  const ciudades = new Set(mias.map(r => r.city));
  const mismas = enRango.filter(r => ciudades.has(r.city));
  const porPartner = new Map();
  mismas.forEach(r => { let a = porPartner.get(r.partner); if (!a) { a = []; porPartner.set(r.partner, a); } a.push(r); });
  return { mias: mismas.filter(r => r.partner === partner), grupos: [...porPartner.values()],
           ciudades: [...ciudades] };
}
export function p2BenchStrip(partner, dates) {
  const C = p2BenchCohorte(partner, dates);
  if (!C) return "";
  const yo = p2OpsMetrics(C.mias);
  // Umbral de comparabilidad: 50 activos. Abajo de eso las tasas se disparan con
  // 2 conductores raros y la mediana dejaría de describir a un par real.
  const coh = C.grupos.map(p2OpsMetrics).filter(m => m.ad >= 50);
  if (coh.length < 3) return "";   // con menos de 3 pares la mediana no dice nada
  const med = {};
  const D = [
    { k: "accept",    l: P2T("Aceptación", "Acceptance", "Принятие"),        f: v => (v * 100).toFixed(1) + "%", alto: true },
    { k: "tripsHr",   l: P2T("Viajes / hora", "Trips / hour", "Поездок / час"), f: v => v.toFixed(2),            alto: true },
    { k: "hrsDriver", l: P2T("Horas / conductor", "Hours / driver", "Часов / водитель"), f: v => fmt(Math.round(v)), alto: true },
    { k: "mph",       l: P2T("USD / hora", "USD / hour", "USD / час"),       f: v => "$" + v.toFixed(2),         alto: true },
    { k: "bad",       l: P2T("% mal calif.", "% badly rated", "% плохих оценок"), f: v => (v * 100).toFixed(1) + "%", alto: false }
  ];
  D.forEach(d => { med[d.k] = median(coh.map(m => m[d.k])); });
  const chips = D.map(d => {
    const mio = yo[d.k], m = med[d.k];
    if (mio == null || m == null) return `<div class="bs-chip"><span>${escapeHTML(d.l)}</span><b>—</b></div>`;
    // `alto:false` en "% mal calificados": ahí mejor es MENOR. Sin esa marca el
    // semáforo diría que más viajes mal calificados es una buena noticia.
    const mejor = d.alto ? mio >= m : mio <= m;
    const col = mejor ? "#10b981" : "#FF0000";
    return `<div class="bs-chip"><span>${escapeHTML(d.l)}</span>
      <b style="color:${col}">${d.f(mio)}</b>
      <i>${escapeHTML(P2T("mediana", "median", "медиана"))} ${d.f(m)}</i></div>`;
  }).join("");
  const donde = C.ciudades.length === 1 ? cityLabel(C.ciudades[0])
              : P2T("tus ciudades", "your cities", "ваших городах");
  // Por qué MEDIANA y no promedio: el promedio se mueve con un solo caso
  // extremo (sin el corte de 50 activos, el máximo de USD/hora es 12,13 contra
  // una mediana de 6,09 — un partner arrastra el promedio de los 249). La
  // mediana responde la pregunta que el partner se hace: "¿estoy en la mitad de
  // arriba o en la de abajo?".
  const tip = P2T(
    `Mediana = el valor del medio: la mitad de los ${coh.length} partners está por encima y la mitad por debajo. Se usa mediana y no promedio porque un solo partner con un número extremo mueve el promedio y no la mediana.`,
    `Median = the middle value: half of the ${coh.length} partners are above and half below. Median rather than average because one partner with an extreme figure moves the average but not the median.`,
    `Медиана — среднее значение выборки: половина из ${coh.length} партнёров выше, половина ниже. Медиана, а не среднее: один партнёр с крайним значением сдвигает среднее, но не медиану.`);
  return `<div class="bs-tira">
    <div class="bs-h" title="${escapeHTML(tip)}">${escapeHTML(P2T(
      `Tu operación vs la mediana de ${coh.length} partners comparables en ${donde}`,
      `Your operation vs the median of ${coh.length} comparable partners in ${donde}`,
      `Ваша работа против медианы ${coh.length} сопоставимых партнёров в ${donde}`))} <span class="bs-i">ⓘ</span></div>
    <div class="bs-chips">${chips}</div>
  </div>`;
}

// ── BLOQUE: CAPTACIÓN Y ACTIVACIÓN (sep 2026) ────────────────────────────────
// El embudo de los perfiles que registra EL PARTNER: de cada 100 que crea,
// cuántos llegan a 1, 10, 50 y 100 viajes, contra la mediana de sus pares en sus
// mismas ciudades.
//
// Nació como hoja propia y se movió al Ejecutivo: cuatro porcentajes no llenan
// una hoja, y acá abajo hacen su trabajo mejor porque se leen JUNTO al
// cumplimiento y a la acción — "no llegás a la meta de conductores Y encima el
// 79% de tus perfiles no arranca" es una historia; en dos hojas separadas son
// dos datos sueltos.
//
// Por qué este bloque y no otro KPI más: es el único que separa "traigo gente"
// de "la gente que traigo se queda". Medido en producción (últimas 4 semanas, 80
// partners con perfiles propios) el paso 1 va de 21,8% (p25) a 62,1% (p75) — el
// KPI con más dispersión de todo el set, o sea el que más distingue a un partner
// y el más accionable.
//
// Solo Taxi y solo perfiles de origen PARTNER: los que trae el servicio no
// dependen de lo que el partner haga, así que meterlos diluiría la señal.
// Devuelve "" cuando no hay nada que mostrar — el Ejecutivo entonces da todo el
// ancho a la lectura en vez de dejar un hueco.
export function p2EmbudoBloque(partner, dates) {
  const savedDs = PRESENT2_STATE.dataset;
  PRESENT2_STATE.dataset = "taxi";
  const C = p2BenchCohorte(partner, dates);
  PRESENT2_STATE.dataset = savedDs;
  if (!C) return "";
  const yo = p2FunnelMetrics(C.mias);
  if (!yo.perfiles || yo.r1 == null) return "";
  const coh = C.grupos.map(p2FunnelMetrics).filter(f => f.perfiles >= 10);
  const hayMed = coh.length >= 3;
  const med = k => hayMed ? median(coh.map(f => f[k])) : null;
  const PASOS = [
    { k: "r1",   l: P2T("1 viaje",    "1 trip",    "1 поездка") },
    { k: "r10",  l: P2T("10 viajes",  "10 trips",  "10 поездок") },
    { k: "r50",  l: P2T("50 viajes",  "50 trips",  "50 поездок") },
    { k: "r100", l: P2T("100 viajes", "100 trips", "100 поездок") }
  ];
  // Escala relativa al paso más alto (el propio o el de la mediana): con la
  // escala fija 0-100% las barras de los últimos pasos quedan invisibles y el
  // embudo deja de verse como un embudo.
  const tope = Math.max(yo.r1 || 0, med("r1") || 0, 0.05);
  const filas = PASOS.map(p => {
    const mio = yo[p.k] || 0, m = med(p.k);
    const col = m == null ? "#8b5cf6" : (mio >= m ? "#10b981" : "#FF0000");
    const w = Math.min((mio / tope) * 100, 100);
    const marca = m == null ? "" : `<div class="eb-med" style="left:calc(${Math.min((m / tope) * 100, 100).toFixed(1)}% - 1px)"></div>`;
    return `<div class="eb-fila">
      <span class="eb-lbl">${escapeHTML(p.l)}</span>
      <span class="eb-bar">${marca}<span class="eb-fill" style="width:${w.toFixed(1)}%;background:${col}"></span></span>
      <b class="eb-val" style="color:${col}">${(mio * 100).toFixed(0)}%</b>
      <i class="eb-med-txt">${m == null ? "" : (m * 100).toFixed(0) + "%"}</i>
    </div>`;
  }).join("");
  // Cierre: la fuga traducida a CONDUCTORES. Es la única cifra de este bloque
  // que se puede accionar — un punto porcentual no le dice nada a nadie.
  const m1 = med("r1");
  const faltan = m1 != null ? Math.round(Math.max(0, (m1 - yo.r1) * yo.perfiles)) : 0;
  const pie = faltan >= 5
    ? `<div class="eb-pie eb-pie-rojo">${escapeHTML(P2T(
        `+${fmt(faltan)} conductores con la tasa de tus pares, sin traer una persona más`,
        `+${fmt(faltan)} drivers at your peers' rate, without adding a single person`,
        `+${fmt(faltan)} водителей при ставке коллег, без единого нового человека`))}</div>`
    : hayMed
    ? `<div class="eb-pie">${escapeHTML(P2T(
        "Tu activación está a la par de tus pares.",
        "Your activation matches your peers.",
        "Ваша активация на уровне коллег."))}</div>`
    : `<div class="eb-pie">${escapeHTML(P2T(
        "Sin pares suficientes para una mediana confiable.",
        "Not enough peers for a reliable median.",
        "Недостаточно коллег для надёжной медианы."))}</div>`;
  return `<div class="px-card px-embudo">
    <div class="px-h">${escapeHTML(P2T("Captación → activación", "Acquisition → activation", "Привлечение → активация"))}</div>
    <div class="eb-top">${escapeHTML(P2T(
      `${fmt(Math.round(yo.perfiles))} perfiles registrados por vos`,
      `${fmt(Math.round(yo.perfiles))} profiles you registered`,
      `${fmt(Math.round(yo.perfiles))} профилей зарегистрировано вами`))}${hayMed ? ` · ${escapeHTML(P2T("línea = mediana", "line = median", "линия = медиана"))}` : ""}</div>
    <div class="eb-tabla">${filas}</div>
    ${pie}
  </div>`;
}

// Peor brecha contra la mediana del cohorte, para la lectura del Ejecutivo.
// Devuelve null cuando no hay pares suficientes: sin cohorte no hay posición que
// reportar, y una frase inventada ahí valdría menos que el silencio.
export function _p2BenchCtx(partner, dates) {
  const savedDs = PRESENT2_STATE.dataset;
  PRESENT2_STATE.dataset = "taxi";
  const C = p2BenchCohorte(partner, dates);
  PRESENT2_STATE.dataset = savedDs;
  if (!C) return null;
  const yo = p2OpsMetrics(C.mias);
  const coh = C.grupos.map(p2OpsMetrics).filter(m => m.ad >= 50);
  if (coh.length < 3) return null;
  const D = [
    { k: "accept",    label: P2T("Aceptación", "Acceptance", "Принятие"),                 f: v => (v * 100).toFixed(1) + "%" },
    { k: "tripsHr",   label: P2T("Viajes por hora", "Trips per hour", "Поездок в час"),   f: v => v.toFixed(2) },
    { k: "hrsDriver", label: P2T("Horas por conductor", "Hours per driver", "Часов на водителя"), f: v => fmt(Math.round(v)) },
    { k: "mph",       label: P2T("USD por hora", "USD per hour", "USD в час"),            f: v => "$" + v.toFixed(2) }
  ];
  const gaps = D.map(d => {
    const mio = yo[d.k], m = median(coh.map(x => x[d.k]));
    if (mio == null || m == null || !m) return null;
    return { label: d.label, valor: d.f(mio), mediana: d.f(m), gapPct: ((mio - m) / m) * 100 };
  }).filter(Boolean).sort((a, b) => a.gapPct - b.gapPct);
  return gaps.length ? { peor: gaps[0], mejor: gaps[gaps.length - 1], pares: coh.length } : null;
}
// Fuga del embudo en conductores, para la lectura. Mismo criterio que la hoja de
// captación: el primer paso (llegar a 1 viaje) es el que arrastra a los demás.
export function _p2FunnelCtx(partner, dates) {
  const savedDs = PRESENT2_STATE.dataset;
  PRESENT2_STATE.dataset = "taxi";
  const C = p2BenchCohorte(partner, dates);
  PRESENT2_STATE.dataset = savedDs;
  if (!C) return null;
  const yo = p2FunnelMetrics(C.mias);
  if (!yo.perfiles || yo.r1 == null) return null;
  const coh = C.grupos.map(p2FunnelMetrics).filter(f => f.perfiles >= 10);
  if (coh.length < 3) return null;
  const m = median(coh.map(f => f.r1));
  if (m == null) return null;
  return { mio: yo.r1 * 100, mediana: m * 100, faltan: Math.max(0, (m - yo.r1) * yo.perfiles), perfiles: yo.perfiles };
}

// ── BLOQUE: TRAYECTORIA (sep 2026) ───────────────────────────────────────────
// El Ejecutivo contestaba "¿cumplo?", "¿por qué?", "¿qué hago?" y "¿cómo me
// comparo?" — pero no "¿voy mejorando o empeorando?", que es la primera pregunta
// que hace cualquier gerencia y la que explica todas las demás. Este bloque la
// contesta y de paso llena la banda que quedaba vacía al pie de la hoja.
//
// Barras y no una línea: es el mismo lenguaje visual del resto del deck
// (cumplimiento, embudo) y sobrevive intacto al html2canvas del PDF, que con SVG
// escalado y `vector-effect` es donde suele romperse.
//
// El bloque CRECE con el espacio sobrante (flex en .px-trayectoria): en una hoja
// alta las barras se hacen más altas en vez de dejar un hueco.
//
// Rango: el FILTRADO completo (no el mes de la meta). Una tendencia con dos
// puntos no es una tendencia — hacen falta al menos 3 períodos o el bloque no se
// dibuja y la hoja vuelve a cerrar como antes.
export const TRAYECTORIA_MIN_PERIODOS = 3;
export const TRAYECTORIA_MAX_BARRAS   = 13;

// Serie → barras. `neg` permite valores negativos (retención con churn severo):
// la barra se dibuja desde 0 y el valor se muestra igual, sin recortar.
function _p2Barras(serie, color) {
  const vals = serie.map(v => (v == null || isNaN(v)) ? null : v);
  const max = Math.max(...vals.filter(v => v != null).map(Math.abs), 0.0001);
  const ult = vals.length - 1;
  return `<div class="tr-barras">${vals.map((v, i) => {
    const h = v == null ? 0 : Math.max(2, (Math.abs(v) / max) * 100);
    const c = v == null ? "#e8e8e8" : (v < 0 ? "#FF0000" : color);
    const op = v == null ? 1 : (i === ult ? 1 : .38);
    return `<span class="tr-b"><i style="height:${h.toFixed(1)}%;background:${c};opacity:${op}"></i></span>`;
  }).join("")}</div>`;
}
export function p2TrayectoriaBloque(partner, dates) {
  const per = (dates || []).slice(-TRAYECTORIA_MAX_BARRAS);
  if (per.length < TRAYECTORIA_MIN_PERIODOS) return "";
  const savedDs = PRESENT2_STATE.dataset;
  // Paraguas Taxi + TukTuk, igual que los KPIs de arriba: si el partner empuja
  // TukTuk, su trayectoria tiene que reflejarlo.
  const sum = (fn) => {
    PRESENT2_STATE.dataset = "taxi";  const a = p2Vals(partner, null, per, fn);
    PRESENT2_STATE.dataset = "tuktuk";
    const b = p2ActivePartners().includes(partner) ? p2Vals(partner, null, per, fn) : per.map(() => 0);
    PRESENT2_STATE.dataset = savedDs;
    return per.map((_, i) => (a[i] || 0) + (b[i] || 0));
  };
  const ad = sum(P2_GET.ad), newd = sum(P2_GET.newd), react = sum(P2_GET.react), sh = sum(P2_GET.sh);
  const nr = per.map((_, i) => (newd[i] || 0) + (react[i] || 0));
  const ret = retentionSeries(ad, newd, react);
  if (!ad.some(v => v > 0)) { PRESENT2_STATE.dataset = savedDs; return ""; }

  const mi = p2ModeInfo();
  const varPct = (arr) => {
    const v = arr[arr.length - 1], p = arr[arr.length - 2];
    return (p == null || !p || v == null) ? null : ((v - p) / p) * 100;
  };
  const badge = (p, alto = true) => {
    if (p == null) return `<em class="tr-var">—</em>`;
    const bueno = alto ? p >= 0 : p <= 0;
    return `<em class="tr-var" style="color:${bueno ? "#10b981" : "#FF0000"}">${p >= 0 ? "↑" : "↓"} ${Math.abs(p).toFixed(1)}%</em>`;
  };
  const ultRet = [...ret].reverse().find(v => v != null);
  // La cifra grande es SIEMPRE la del ULTIMO periodo, nunca el acumulado del
  // rango. Con el total, el titulo decia 4.608 N+R al lado de un grafico cuya
  // ultima barra vale 1.200: dos numeros distintos para la misma cosa, y el que
  // se lee primero es el equivocado. La unidad la fija el filtro (mes, semana o
  // dia) y el pie lo dice.
  const ult = arr => arr[arr.length - 1];
  const PANELES = [
    { l: P2T("Conductores Activos", "Active Drivers", "Активные водители"), c: "#FF0000",
      serie: ad, v: fmt(ult(ad) || 0), badge: badge(varPct(ad)) },
    { l: P2T("Nuevos + Reactivados", "New + Reactivated", "Новые + реактивированные"), c: "#f97316",
      serie: nr, v: fmt(ult(nr) || 0), badge: badge(varPct(nr)) },
    { l: P2T("Horas de Conexión", "Supply Hours", "Часы на линии"), c: "#0284c7",
      serie: sh, v: fmtSmart(ult(sh) || 0), badge: badge(varPct(sh)) },
    // Retención: la palanca más barata. Sin ella, la tendencia de AD no se
    // explica — un partner puede traer mucha gente y no crecer porque se le va
    // por el otro lado.
    { l: P2T("Retención", "Retention", "Удержание"), c: "#10b981",
      serie: ret.map(v => v == null ? null : v * 100),
      v: ultRet == null ? "—" : (ultRet * 100).toFixed(0) + "%",
      // "del período anterior" y no `${mi.unit}`: en español la unidad cambia de
      // género (el día / la semana / el mes) y salía "del semana anterior".
      badge: "", pie: P2T("de tus activos del período anterior",
                          "of your previous period's actives",
                          "от активных прошлого периода") }
  ];
  const cuerpo = PANELES.map(p => `<div class="tr-p">
    <div class="tr-lbl">${escapeHTML(p.l)}</div>
    <div class="tr-cifra"><b>${p.v}</b>${p.badge}</div>
    ${_p2Barras(p.serie, p.c)}
    <div class="tr-pie">${escapeHTML(p.pie || P2T(
      `${mi.unit.toLowerCase()} más reciente de ${per.length}`,
      `latest ${mi.unit.toLowerCase()} of ${per.length}`,
      `последний период из ${per.length}`))}</div>
  </div>`).join("");
  return `<div class="px-card px-trayectoria">
    <div class="px-h">${escapeHTML(P2T(
      `Trayectoria · ${mi.ult} ${per.length} ${mi.units}`,
      `Trajectory · last ${per.length} ${mi.units}`,
      `Динамика · последние ${per.length} ${mi.units}`))} <span class="tr-h2">${escapeHTML(P2T(
      "la barra llena es el período más reciente", "the solid bar is the latest period", "сплошная полоса — последний период"))}</span></div>
    <div class="tr-grid">${cuerpo}</div>
  </div>`;
}

export function buildSlide2Portada(partner, dates, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const savedDs = PRESENT2_STATE.dataset;
  const mesName = p2AvanceMes();

  PRESENT2_STATE.dataset = "taxi";
  const taxiDates = p2DatesMetaEnRango(mesName, dates);
  const taxiAct = p2ActualsMTD(partner, null, taxiDates);
  const levels = p2Levels(partner);
  PRESENT2_STATE.dataset = "tuktuk";
  const tkDates = p2DatesMetaEnRango(mesName, dates);
  const tkAct = p2ActualsMTD(partner, null, tkDates);
  PRESENT2_STATE.dataset = savedDs;

  const mesDates = taxiDates.length ? taxiDates : tkDates;   // fechas del MES de la meta (≠ `dates`, que es el rango del deck)
  const metasLoaded = !!(STATE.metasData || []).length;
  if (!mesDates.length || !metasLoaded) {
    return `<div class="agy-style-365 p2-hoja-cards">
      ${p2BrandHeader(partner, (P2T("Resumen ejecutivo", "Executive summary", "Сводка для руководства")) + " · " + p2MesLabel(mesName), "")}
      <div class="agy-style-396">${P2T("Sin datos o metas del mes.", "No data or targets for the month.", "Нет данных или целей за месяц.")}</div>
      ${p2BrandFooter(idx)}</div>`;
  }

  const lastDate = mesDates[mesDates.length - 1];
  const { daysElapsed, daysInMonth } = p2DiasMes(lastDate);
  const diasRestantes = Math.max(daysInMonth - daysElapsed, 0);
  const meta = p2MetaFor(partner, null, mesName);

  // Paraguas Taxi + TukTuk: es lo que la meta cubre.
  const kpis = [
    { key: "ad", lbl: P2T("Conductores Activos", "Active Drivers", "Активные водители"),
      real: (taxiAct.lastAD || 0) + (tkAct.lastAD || 0), meta: meta.mA || 0, fmt, flujo: false },
    { key: "nr", lbl: P2T("Nuevos + Reactivados", "New + Reactivated", "Новые + реактивированные"),
      real: (taxiAct.nr || 0) + (tkAct.nr || 0), meta: meta.mNR || 0, fmt, flujo: true },
    { key: "sh", lbl: P2T("Horas de Conexión", "Supply Hours", "Часы на линии"),
      real: (taxiAct.sh || 0) + (tkAct.sh || 0), meta: meta.mH || 0, fmt: fmtSmart, flujo: true }
  ].map(k => ({ ...k, pct: k.meta > 0 ? (k.real / k.meta) * 100 : 0 }));

  // Datos por ciudad para la regla de "dónde está la brecha".
  const ciudades = levels.filter(l => l.city).map(lv => {
    PRESENT2_STATE.dataset = "taxi";
    const a = p2ActualsMTD(partner, lv.city, taxiDates);
    PRESENT2_STATE.dataset = "tuktuk";
    const b = p2ActualsMTD(partner, lv.city, tkDates);
    PRESENT2_STATE.dataset = savedDs;
    const m = p2MetaFor(partner, lv.city, mesName);
    return { label: lv.label, color: lv.color,
      adReal: (a.lastAD || 0) + (b.lastAD || 0), adMeta: m.mA || 0,
      nrReal: (a.nr || 0) + (b.nr || 0),         nrMeta: m.mNR || 0,
      shReal: (a.sh || 0) + (b.sh || 0),         shMeta: m.mH || 0 };
  });

  // Variación por vertical vs el período anterior (para la regla de arrastre).
  const verticales = [];
  const addVert = (label, serie) => {
    if (!serie || serie.length < 2) return;
    const ult = serie[serie.length - 1], prev = serie[serie.length - 2];
    verticales.push({ label, varPct: prev > 0 ? ((ult - prev) / prev) * 100 : null });
  };
  addVert("Taxi", taxiAct.adV);
  addVert("TukTuk", tkAct.adV);

  // COBERTURA DEL MES — la meta es MENSUAL, pero el deck ahora respeta el rango
  // que eligió el KAM. Si ese rango no cubre el mes entero, los FLUJOS (N+R,
  // horas) acumulan solo los períodos filtrados y su % contra la meta queda
  // corto por recorte de rango, NO por desempeño: filtrando una sola semana un
  // partner que va bien aparece al 25%. Sin este aviso el informe lo mostraría
  // como incumplimiento sin decir por qué (la pestaña Metas ya avisa lo mismo).
  //
  // Se compara contra el mes COMPLETO (p2MonthDates sin filtrar), así que el
  // aviso distingue "te falta rango" de "el partner no reportó".
  // Active Drivers no se ve afectado: es un snapshot, no se acumula.
  PRESENT2_STATE.dataset = "taxi";
  const todasDelMes = p2MonthDates(mesName);
  const conDato = p2Present(partner, null, mesDates).filter(Boolean).length;
  PRESENT2_STATE.dataset = savedDs;
  const totalPer = mesDates.length;
  const rangoParcial = todasDelMes.length > mesDates.length;
  const huecosPartner = totalPer > 0 && conDato < totalPer * 0.8;
  const coberturaParcial = rangoParcial || huecosPartner;

  const embudoHTML = p2EmbudoBloque(partner, dates);
  // Contexto extra para la lectura: posición contra el cohorte y fuga del
  // embudo. Se calcula acá (no en domain/) porque necesita STATE; domain recibe
  // los números ya masticados y solo decide qué frase merece estar.
  const ctx = { lang: PRESENT2_STATE.lang, kpis, ciudades, verticales,
                diasRestantes, diasMes: daysInMonth,
                bench: _p2BenchCtx(partner, dates), funnel: _p2FunnelCtx(partner, dates),
                funnelEnBloque: !!embudoHTML };
  const lectura = p2Lectura(ctx);
  const accion  = p2Accion(ctx);

  // Veredicto: cuántas metas cumplen. Es el titular de la hoja.
  const conMeta = kpis.filter(k => k.meta > 0);
  const cumplen = conMeta.filter(k => k.pct >= META_CUMPLIDA_PCT).length;
  const vColor = !conMeta.length ? "#888"
               : cumplen === conMeta.length ? "#10b981"
               : cumplen === 0 ? "#FF0000" : "#f59e0b";
  const vTxt = !conMeta.length ? (P2T("Sin metas cargadas para el mes", "No targets loaded", "Цели на месяц не загружены"))
             : cumplen === conMeta.length ? P2T(`Las ${conMeta.length} metas del mes están cumplidas`, `All ${conMeta.length} targets met`, `Все ${conMeta.length} цели месяца выполнены`)
             : P2T(`${cumplen} de ${conMeta.length} metas cumplidas`, `${cumplen} of ${conMeta.length} targets met`, `${cumplen} из ${conMeta.length} целей выполнено`);

  const pctMes = Math.min((daysElapsed / daysInMonth) * 100, 100);

  // Tres TARJETAS lado a lado, no tres filas a lo ancho de la hoja. A ancho
  // completo la barra de progreso se volvia el elemento mas grande del slide y
  // empujaba la lectura y la accion al pie, dejando la mitad de abajo vacia.
  // En columnas cada barra mide un tercio, los tres KPIs se comparan de un
  // vistazo y sobra espacio para el texto, que es lo que hay que leer.
  const barras = kpis.map(k => {
    if (!k.meta) return `<div class="px-kpi px-na">
      <div class="px-lbl">${escapeHTML(k.lbl)}</div>
      <div class="px-val">${k.fmt(k.real)}</div>
      <div class="px-nota">${P2T("sin meta cargada", "no target", "цель не загружена")}</div></div>`;
    const col = pColor(k.pct);
    const falta = k.meta - k.real;
    return `<div class="px-kpi">
      <div class="px-lbl">${escapeHTML(k.lbl)}</div>
      <div class="px-cifra">
        <span class="px-val" style="color:${col}">${k.fmt(k.real)}</span>
        <span class="px-meta">/ ${k.fmt(k.meta)}</span>
      </div>
      <div class="px-pct" style="color:${col}">${_p2PctTxt(k.pct)}</div>
      <div class="px-bullet">
        <div class="px-fill" style="width:${Math.min(k.pct, 100).toFixed(1)}%;background:${col}"></div>
        ${k.flujo ? `<div class="px-hoy" style="left:calc(${pctMes.toFixed(1)}% - 1px)"></div>` : ""}
      </div>
      <div class="px-nota">${falta > 0
        ? P2T(`faltan ${k.fmt(falta)}`, `${k.fmt(falta)} to go`, `не хватает ${k.fmt(falta)}`)
        : P2T(`+${k.fmt(-falta)} sobre la meta`, `+${k.fmt(-falta)} over`, `+${k.fmt(-falta)} сверх цели`)}</div>
    </div>`;
  }).join("");

  return `<div class="agy-style-365">
    ${p2BrandHeader(partner, (P2T("Resumen ejecutivo", "Executive summary", "Сводка для руководства")) + " · " + p2MesLabel(mesName),
      P2T(`Día ${daysElapsed} de ${daysInMonth}${diasRestantes ? ` · quedan ${diasRestantes} días` : " · mes cerrado"}`,
          `Day ${daysElapsed} of ${daysInMonth}${diasRestantes ? ` · ${diasRestantes} days left` : " · month closed"}`,
          `День ${daysElapsed} из ${daysInMonth}${diasRestantes ? ` · осталось ${diasRestantes} дн.` : " · месяц закрыт"}`))}
    <div class="px-wrap">
      <div class="px-veredicto" style="border-left-color:${vColor}">
        <span class="px-sem" style="background:${vColor}"></span>
        <span class="px-vtxt" style="color:${vColor}">${escapeHTML(vTxt)}</span>
        <span class="px-vsub">${P2T(`${diasRestantes ? `quedan ${diasRestantes} días` : "mes cerrado"}`, `${diasRestantes ? `${diasRestantes} days left` : "month closed"}`, `${diasRestantes ? `осталось ${diasRestantes} дн.` : "месяц закрыт"}`)}</span>
      </div>
      ${coberturaParcial ? `<div class="px-aviso">${es
        ? `${rangoParcial
            ? `El rango filtrado cubre <b>${mesDates.length} de ${todasDelMes.length}</b> períodos del mes.`
            : `Este partner reportó <b>${conDato} de ${totalPer}</b> períodos del mes.`} <b>Nuevos + Reactivados</b> y <b>Horas de Conexión</b> acumulan solo esos, así que su % contra la meta <b>mensual</b> queda corto por ${rangoParcial ? "el recorte del rango" : "datos faltantes"}, no por desempeño. Para leer el cumplimiento real, ampliá el rango a todo el mes. Conductores Activos no se ve afectado (es un nivel, no se acumula).`
        : `${rangoParcial
            ? `The filtered range covers <b>${mesDates.length} of ${todasDelMes.length}</b> periods of the month.`
            : `This partner reported <b>${conDato} of ${totalPer}</b> periods this month.`} <b>New + Reactivated</b> and <b>Supply Hours</b> only accumulate those, so their % against a <b>monthly</b> target falls short due to ${rangoParcial ? "the range cut" : "missing data"}, not performance. Widen the range to the full month to read real attainment. Active Drivers is unaffected (it is a level).`}</div>` : ""}
      <div class="px-kpis">${barras}</div>
      <div class="px-abajo${embudoHTML ? "" : " px-abajo-solo"}">
        <div class="px-col">
          <div class="px-card px-lectura">
            <div class="px-h">${P2T("Lectura", "Reading", "Что это значит")}</div>
            <ul>${lectura.map(l => `<li>${escapeHTML(l)}</li>`).join("")}</ul>
          </div>
          ${accion ? `<div class="px-card px-accion">
            <div class="px-h px-h-acc">${P2T("Acción prioritaria", "Priority action", "Приоритетное действие")}</div>
            <div class="px-atxt">${escapeHTML(accion)}</div>
          </div>` : ""}
        </div>
        ${embudoHTML}
      </div>
      ${p2TrayectoriaBloque(partner, dates)}
      ${p2BenchStrip(partner, dates)}
    </div>
    ${p2BrandFooter(idx)}
  </div>`;
}

// ── SLIDE: ALERTAS POR CATEGORÍA (ago 2026) ───────────────────────────────────
// UNA hoja con las 4 verticales adentro. Antes las alertas se repetían por
// sección (una hoja por vertical) y eso volvía a inflar el deck justo cuando el
// objetivo era acortarlo. Además, verlas juntas es lo que permite comparar:
// "Taxi limpio, TukTuk con 3 señales" se lee de un golpe.
//
// Se muestran TODAS las señales, sin cortar. Un "y 1 más…" en un PDF es texto
// muerto: no se puede clickear y esconde justo lo que el partner tiene que ver.
// La hoja crece si hace falta (ver el ajuste al contenido en renderSlide2).
//
// Reusa p2ComputeAlerts sin tocarla: se cambia el dataset activo y se le pide
// las alertas de cada vertical, igual que hace el resto del deck.
export function buildSlide2Alertas(partner, dates, idx) {
  const savedDs = PRESENT2_STATE.dataset;

  const VERTS = [
    { ds: "taxi",     lbl: "Taxi",     col: "#FF0000" },
    { ds: "tuktuk",   lbl: "TukTuk",   col: "#f59e0b" },
    { ds: "delivery", lbl: "Delivery", col: "#0284c7" },
    { ds: "cargo",    lbl: "Cargo",    col: "#8b5cf6" }
  ];

  const bloques = VERTS.map(v => {
    // Solo las verticales que el partner opera de verdad.
    const opera = v.ds === "taxi"   ? p2HasTaxi(partner)
                : v.ds === "tuktuk" ? p2TuktukSectionVisible(partner)
                : p2TieneVertical(partner, v.ds);
    if (!opera) return null;
    PRESENT2_STATE.dataset = v.ds;
    let als = [];
    try { als = p2ComputeAlerts(partner, p2AllDates().filter(d => (dates || []).includes(d))) || []; }
    catch (e) { als = []; }
    PRESENT2_STATE.dataset = savedDs;
    return { ...v, als };
  }).filter(Boolean);

  PRESENT2_STATE.dataset = savedDs;

  const SEV = { high: { c: "#FF0000", t: P2T("Alta", "High", "Высокий") },
                mid:  { c: "#f59e0b", t: P2T("Media", "Mid", "Средний") } };

  const html = bloques.map(b => {
    const n = b.als.length;
    return `<div class="al-bloque">
      <div class="al-cab">
        <span class="al-dot" style="background:${b.col}"></span>
        <span class="al-nom">${b.lbl}</span>
        <span class="al-n" style="color:${n ? (b.als.some(a => a.sev === "high") ? "#FF0000" : "#f59e0b") : "#10b981"}">${
          n ? `${n} ${n === 1 ? P2T("señal", "signal", "сигнал") : P2T("señales", "signals", "сигналов")}` : (P2T("✓ sin señales", "✓ clear", "✓ без сигналов"))}</span>
      </div>
      ${n ? `<ul class="al-lista">${b.als.map(a => {
        const s = SEV[a.sev] || SEV.mid;
        return `<li><span class="al-sev" style="background:${s.c}"></span>
          <b>${escapeHTML(a.title)}</b>
          <span class="al-det">${escapeHTML(a.level)} · ${escapeHTML(a.detail)}</span></li>`;
      }).join("")}</ul>` : ""}
    </div>`;
  }).join("");

  return `<div class="agy-style-365 p2-hoja-cards">
    ${p2BrandHeader(partner, P2T("Alertas por categoría", "Alerts by category", "Сигналы по категориям"),
      P2T("Señales automáticas del período · ordenadas por severidad",
          "Automatic signals for the period · sorted by severity",
          "Автоматические сигналы за период · по степени серьёзности"))}
    <div class="al-wrap">${html || `<div class="agy-style-396">${P2T("Sin categorías con datos.", "No categories with data.", "Нет категорий с данными.")}</div>`}</div>
    ${p2BrandFooter(idx)}
  </div>`;
}

// ── SLIDE: ALERTAS (NEXT STEPS) ───────────────────────────────────────────────
// Señales automáticas por nivel. Thresholds tunables (decisión de negocio).
export const P2_ALERT_THRESHOLDS = {
  wowDropCity: -5,      // % WoW de caída de AD en ciudad → alerta
  retMin: 0.85,         // retención mínima (general)
  retLargeMin: 0.85,    // retención mínima parks grandes
  smallParkAD: 20, midParkAD: 100,
  smallShPerAdMin: 15,     // SH/AD (horas/conductor) mínimo park chico
  midTripsPerAdMin: 20     // Trips/AD (viajes/conductor) mínimo park medio
};
export function p2ComputeAlerts(partner, dates) {
  const T = P2_ALERT_THRESHOLDS;
  const mi = p2ModeInfo();
  const out = [];
  p2Levels(partner).forEach(lv => {
    const m = p2Metrics(partner, lv.city, dates);
    const ad = m.ad, ret = m.ret;
    const lastAD = ad[ad.length - 1] || 0;
    const lastRet = ret[ret.length - 1];
    const wow = getWoW(ad); const lw = wow[wow.length - 1];
    const shPerAd = m.shPerAd[m.shPerAd.length - 1], tripsPerAd = m.tripsPerAd[m.tripsPerAd.length - 1];
    // Cada alerta lleva "kind" (tipo estable, para agrupar entre ciudades) + "title"
    // (mensaje compartido por el tipo) + "detail" (la parte que varía por ciudad).
    // (a) AD cae 3 períodos seguidos (semanas/meses según escala)
    if (ad.length >= 3) {
      const a = ad.slice(-3);
      if (a[0] > a[1] && a[1] > a[2]) out.push({ sev: "high", level: lv.label, kind: "ad3drop",
        title: P2T(`AD cae 3 ${mi.units} ${mi.seg}`, `AD down 3 ${mi.units} ${mi.seg}`, `Активные водители падают 3 ${mi.units} ${mi.seg}`),
        detail: `${fmt(a[0])} → ${fmt(a[2])}` });
    }
    // (b) caída WoW > 5% en ciudad
    if (lv.city && lw != null && lw < T.wowDropCity) out.push({ sev: "high", level: lv.label, kind: "wowdrop",
      title: P2T(`Caída ${mi.pop} en Conductores Activos`, `${mi.pop} drop in Active Drivers`, `Падение ${mi.pop} по активным водителям`),
      detail: `${lw.toFixed(1)}%` });
    // (c) retención < retMin (85%)
    if (lastRet != null && lastRet < T.retMin) out.push({ sev: "mid", level: lv.label, kind: "retention",
      title: P2T(`Retención bajo ${(T.retMin * 100).toFixed(0)}%`, `Retention below ${(T.retMin * 100).toFixed(0)}%`, `Удержание ниже ${(T.retMin * 100).toFixed(0)}%`),
      detail: `${(lastRet * 100).toFixed(1)}%` });
    // (d) mínimos por tamaño de park
    if (lastAD > 0 && lastAD < T.smallParkAD) {
      if (shPerAd != null && shPerAd < T.smallShPerAdMin) out.push({ sev: "mid", level: lv.label, kind: "smallpark_sh",
        title: P2T(`Park chico con SH/AD bajo`, `Small park, low SH/AD`, `Небольшой парк, низкие часы/водитель`),
        detail: `${shPerAd.toFixed(1)} ${P2T("h/cond", "h/driver", "ч/вод.")}` });
    } else if (lastAD < T.midParkAD) {
      if ((tripsPerAd != null && tripsPerAd < T.midTripsPerAdMin)) out.push({ sev: "mid", level: lv.label, kind: "midpark_trips",
        title: P2T(`Park medio con Trips/AD bajo`, `Mid park, low Trips/AD`, `Средний парк, мало поездок/водитель`),
        detail: `${tripsPerAd.toFixed(1)} ${P2T("viajes/cond", "trips/driver", "поездок/вод.")}` });
    } else if (lastAD > 0) {
      // No duplicar señal: si ya salió "wowdrop" (caída >5% en ciudad) o "retención" (mismo
      // umbral retMin===retLargeMin) para este nivel, NO emitir largepark_decline encima —
      // antes la misma caída salía contada 2 veces (misma ciudad, misma causa, 2 pildoras).
      // Se conserva SOLO para su ventana propia: caída leve (-5%<lw<0%) o nivel Perú (sin ciudad,
      // donde wowdrop nunca aplica).
      const alreadyWowdrop   = lv.city && lw != null && lw < T.wowDropCity;
      const alreadyRetention = lastRet != null && lastRet < T.retMin;
      if (!alreadyWowdrop && !alreadyRetention && ((lw != null && lw < 0) || (lastRet != null && lastRet < T.retLargeMin))) {
        out.push({ sev: "mid", level: lv.label, kind: "largepark_decline",
          title: P2T(`Park grande con señal de caída (revisar estabilidad)`, `Large park showing decline`, `Крупный парк с признаками спада`),
          detail: "" });
      }
    }
  });
  return out.sort((a, b) => (a.sev === "high" ? 0 : 1) - (b.sev === "high" ? 0 : 1));
}
// Agrupa alertas por (severidad + kind): una fila por TIPO de señal, con las
// ciudades afectadas como chips en esa misma fila — antes salía una fila por
// ciudad y el mismo tipo de alerta se repetía N veces (una por ciudad), ilegible
// con 4+ ciudades. Mismo orden de severidad que antes (Map preserva inserción).
export function p2GroupAlerts(alerts) {
  const groups = new Map();
  alerts.forEach(a => {
    const k = `${a.sev}|||${a.kind}`;
    if (!groups.has(k)) groups.set(k, { sev: a.sev, title: a.title, items: [] });
    groups.get(k).items.push({ level: a.level, detail: a.detail });
  });
  return [...groups.values()];
}
export function buildSlide2Alerts(partner, dates, idx) {
  const es = PRESENT2_STATE.lang === "es";
  // P2_ALERT_THRESHOLDS (retención 85%, SH/AD, Trips/AD) está calibrado para cadencia
  // SEMANAL. Aplicado tal cual en Mensual/Diario dispara falsas alarmas partner-facing (ej.
  // un 82% de retención MENSUAL no es comparable a un 82% semanal). En vez de inventar
  // multiplicadores sin validar con datos reales, se restringe la slide a Semanal (ver auditoría).
  if (STATE.curMode !== "semanal") {
    const msg = es
      ? "Alertas disponibles solo en escala Semanal (los umbrales están calibrados para esa cadencia)."
      : "Alerts available only at Weekly scale (thresholds are calibrated for that cadence).";
    return `<div class="agy-style-365">
      ${p2BrandHeader(partner, P2T("Alertas / Next Steps", "Alerts / Next Steps", "Сигналы / Следующие шаги"), P2T("Señales automáticas para accionar con el partner", "Automatic signals to act on with the partner", "Автоматические сигналы для работы с партнёром"))}
      <div class="agy-style-396">${msg}</div>
      ${p2BrandFooter(idx)}
    </div>`;
  }
  const groups = p2GroupAlerts(p2ComputeAlerts(partner, dates));
  const sevColor = s => s === "high" ? "#FF0000" : "#f59e0b";
  const sevLabel = s => s === "high" ? (P2T("Alta", "High", "Высокий")) : (P2T("Media", "Medium", "Средний"));
  const items = groups.length
    ? groups.map(g => {
        // inline-block (NO inline-flex): html2canvas no pinta el texto dentro de cajas
        // inline-flex con align-items:baseline → los chips salian como pildoras vacias en
        // el PDF. inline-block + white-space:nowrap se renderiza fiable en pantalla y PDF.
        const chips = g.items.map(it => `<span class="agy-style-398"><b class="agy-style-399">${escapeHTML(it.level)}</b>${it.detail ? ` <span class="agy-style-400">${escapeHTML(it.detail)}</span>` : ""}</span>`).join("");
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;background:${sevColor(g.sev)}12;border-left:4px solid ${sevColor(g.sev)};border-radius:8px;margin-bottom:7px">
          <span style="font-size:.6rem;font-weight:800;color:#fff;background:${sevColor(g.sev)};padding:2px 7px;border-radius:10px;white-space:nowrap;margin-top:2px">${sevLabel(g.sev)}</span>
          <div class="agy-style-282">
            <div class="agy-style-401">${escapeHTML(g.title)}</div>
            <div>${chips}</div>
          </div>
        </div>`;
      }).join("")
    : `<div class="agy-style-402">✓ ${P2T("Sin alertas — todo dentro de rango.", "No alerts — all within range.", "Сигналов нет — всё в пределах нормы.")}</div>`;
  return `<div class="agy-style-365">
    ${p2BrandHeader(partner, P2T("Alertas / Next Steps", "Alerts / Next Steps", "Сигналы / Следующие шаги"), P2T("Señales automáticas para accionar con el partner", "Automatic signals to act on with the partner", "Автоматические сигналы для работы с партнёром"))}
    <div class="agy-style-375">${items}</div>
    ${p2BrandFooter(idx)}
  </div>`;
}

// ── SLIDE: PROYECCIÓN (pronóstico 3 meses + palancas de crecimiento) ───────────
// Usa el motor puro forecast.js sobre la serie MENSUAL deduplicada (STATE.rawDataMensual
// vía p2Vals). Ignora el `dates` tail-4 del deck y toma TODO el historial con p2AllDates().
// Solo tiene sentido en escala mensual → gate como buildSlide2Alerts.
export const P2_FC_KPIS = [
  { key: "ad",    es: "Conductores Activos", en: "Active Drivers", color: "#FF0000", kind: "num"  },
  { key: "sh",    es: "Horas de Conexión",   en: "Supply Hours",   color: "#8b5cf6", kind: "numK" },
  { key: "gmv",   es: "GMV",                 en: "GMV",            color: "#0284c7", kind: "money" },
  { key: "trips", es: "Viajes",              en: "Trips",          color: "#10b981", kind: "num"  }
];
export function _p2FcFmt(kind, v) {
  if (v == null || isNaN(v)) return "—";
  if (kind === "money") return "$" + fmtSmart(v);
  if (kind === "numK")  return fmtSmart(v);
  return fmt(Math.round(v));
}
// Serie mensual por KPI (Perú = Σ ciudades del partner) + inputs de palancas, desde el
// dataset activo. p2Vals suma ciudades por mes; para AD/autos (snapshot) la suma de niveles
// por ciudad ES el nivel Perú; para SH/GMV/viajes/N+R (flujos) la suma es el total.
export function p2ForecastBundle(partner) {
  const months = p2AllDates();
  const g = fn => p2Vals(partner, null, months, fn);
  const kpis = {
    ad:    g(r => r.activeDrivers || 0),
    sh:    g(r => r.supplyHours   || 0),
    gmv:   g(r => r.gmv           || 0),
    trips: g(r => r.trips         || 0)
  };
  const leversInput = {
    ad: kpis.ad, sh: kpis.sh, trips: kpis.trips,
    newP:  g(r => r.newPartner  || 0),
    newS:  g(r => r.newService  || 0),
    react: g(r => r.reactivated || 0),
    regP1:  g(r => r.newProfilesPartnerReg1   || 0), regP10: g(r => r.newProfilesPartnerReg10  || 0),
    regP50: g(r => r.newProfilesPartnerReg50  || 0), regP100:g(r => r.newProfilesPartnerReg100 || 0),
    regS1:  g(r => r.newProfilesServiceReg1   || 0), regS10: g(r => r.newProfilesServiceReg10  || 0),
    regS50: g(r => r.newProfilesServiceReg50  || 0), regS100:g(r => r.newProfilesServiceReg100 || 0)
  };
  return { months, kpis, leversInput };
}
export function _p2FcDropLast(inp) { const o = {}; for (const k in inp) o[k] = Array.isArray(inp[k]) ? inp[k].slice(0, -1) : inp[k]; return o; }
// Meta de AD del mes más reciente cargado (Σ ciudades) para las "palancas hacia la meta".
export function p2ForecastTargetAD(partner) {
  const rows = (STATE.metasData || []).filter(m => m.partner === partner && m.mA);
  if (!rows.length) return null;
  let best = null;
  rows.forEach(m => { const o = _metasMesOrden(m.mes); if (!best || o > best.o) best = { o, mes: m.mes }; });
  const sum = rows.filter(m => m.mes === best.mes).reduce((s, m) => s + (m.mA || 0), 0);
  return sum || null;
}
// Cómputo compartido por build y chartFn (mismo patrón que p2Metrics en matriz/charts).
export function p2ForecastCompute(partner) {
  const b = p2ForecastBundle(partner);
  const partial = fcIsPartialLast(b.kpis.ad);
  const drop = partial && !PRESENT2_STATE.fcInclPartial;
  const histMonths = drop ? b.months.slice(0, -1) : b.months;
  const lastMonth = histMonths[histMonths.length - 1];
  const futureMonths = lastMonth ? fcFutureMonths(lastMonth, 3) : [];
  const fc = {};
  P2_FC_KPIS.forEach(k => { fc[k.key] = fcForecastSeries(b.kpis[k.key], { horizon: 3, dropLast: drop }); });
  const levers = fcGrowthLevers(drop ? _p2FcDropLast(b.leversInput) : b.leversInput);
  const target = p2ForecastTargetAD(partner);
  return { months: b.months, histMonths, futureMonths, drop, partial, fc, levers, target };
}

export function _p2FcMiniCard(label, value, hint, color, tip) {
  return `<div ${tip ? `title="${escapeHTML(tip)}"` : ""} style="flex:1;min-width:0;background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;padding:7px 9px;display:flex;flex-direction:column;gap:1px${tip ? ";cursor:help" : ""}">
    <div class="agy-style-359">${escapeHTML(label)}${tip ? ` <span class="agy-style-403">ⓘ</span>` : ""}</div>
    <div style="font-weight:900;font-size:1rem;color:${color || "#111"}">${value}</div>
    <div class="agy-style-404">${hint}</div>
  </div>`;
}
export function _p2FcPalancasHTML(C, es) {
  const L = C.levers;
  if (!L) return "";
  const cards = [];
  // 1) Retención — cuántos de tus activos del mes pasado siguen activos este mes.
  const ret = L.retention;
  const retTxt = ret != null ? (ret * 100).toFixed(1) + "%" : "—";
  const retCol = ret == null ? "#111" : ret >= 0.85 ? "#10b981" : ret >= 0.70 ? "#f59e0b" : "#FF0000";
  const ret100 = ret != null ? Math.round(ret * 100) : null;
  const churnTxt = L.churn != null ? P2T(` · ${fmt(Math.round(L.churn))} se fueron`, ` · ${fmt(Math.round(L.churn))} left`, ` · ${fmt(Math.round(L.churn))} ушли`) : "";
  cards.push(_p2FcMiniCard(P2T("Retención", "Retention", "Удержание"), retTxt,
    ret100 != null ? P2T(`${ret100} de 100 siguen${churnTxt}`, `${ret100} of 100 stay${churnTxt}`, `${ret100} из 100 остаются${churnTxt}`) : "", retCol,
    P2T("De tus conductores activos del mes pasado, cuántos siguen activos este mes. Es la palanca más barata: menos fugas = necesitás menos nuevos para crecer.",
        "Of last month's active drivers, how many stay active this month. Cheapest lever: fewer leaks = fewer new drivers needed to grow.",
        "Сколько из ваших активных водителей прошлого месяца остаются активными в этом. Самый дешёвый рычаг: меньше потерь — меньше новых нужно для роста.")));
  // 2) Nuevos + Reactivados — tu motor de entrada este mes.
  cards.push(_p2FcMiniCard(P2T("Nuevos + React.", "New + React.", "Новые + реакт."),
    fmt(Math.round(L.newT + L.react)),
    L.leadDependency != null ? P2T(`${(L.leadDependency * 100).toFixed(0)}% vía leads Yango`, `${(L.leadDependency * 100).toFixed(0)}% via Yango leads`, `${(L.leadDependency * 100).toFixed(0)}% через лиды Yango`) : (P2T("sumados este mes", "added this month", "добавлено за месяц")), "#111",
    P2T("Conductores que ingresaron o reactivaste este mes (nuevos del partner + de leads Yango + reactivados). Tu motor de entrada.",
        "Drivers you added or reactivated this month (partner-sourced + Yango leads + reactivated). Your intake engine.",
        "Водители, которых вы привлекли или реактивировали за месяц (свои + лиды Yango + реактивированные). Ваш двигатель набора.")));
  // 3) Cuello del embudo — la etapa registro→viajes con MENOR conversión (auto-seleccionada).
  if (L.funnel.hasData && L.funnel.bottleneck) {
    const bn = L.funnel.bottleneck;
    const pct = (bn.conv * 100).toFixed(0);
    const stg = P2T(bn.es, bn.en, bn.ru || bn.en);
    cards.push(_p2FcMiniCard(P2T("Cuello del embudo", "Funnel bottleneck", "Узкое место воронки"),
      pct + "%", stg + (P2T(" · etapa más floja", " · weakest stage", " · самый слабый этап")), "#f97316",
      P2T(`Recorrido de un conductor nuevo: se registra → hace 10, 50 y 100 viajes. El "cuello" es la etapa donde MÁS se caen: acá solo ${pct}% avanza en "${stg}". Es tu mayor fuga — mejorarla sube tus activos sin traer más gente.`,
          `A new driver's journey: signs up → does 10, 50, 100 trips. The bottleneck is where most drop off: here only ${pct}% advance at "${stg}". Your biggest leak — fixing it raises actives without more intake.`,
          `Путь нового водителя: регистрация → 10, 50 и 100 поездок. «Узкое место» — этап, где отваливается больше всего: здесь только ${pct}% проходит «${stg}». Это ваша главная утечка — закрыв её, вы поднимете число активных без нового набора.`)));
  }
  // 4) Horas por conductor (SH/AD) — aprovechamiento de la base.
  const shad = L.prod.shPerAd, tr = L.prod.shPerAdTrend;
  cards.push(_p2FcMiniCard(P2T("Horas / conductor", "Hours / driver", "Часов / водитель"),
    shad != null ? shad.toFixed(1) + "h" : "—",
    tr != null ? ((tr >= 0 ? "▲ +" : "▼ ") + tr.toFixed(0) + "% vs 3m") : (P2T("al mes", "per month", "в месяц")),
    tr == null ? "#111" : tr >= 0 ? "#10b981" : "#FF0000",
    P2T("Horas de conexión promedio por conductor activo en el mes. Mide qué tan aprovechada está tu base: si cae, tenés gente registrada pero poco activa.",
        "Average supply hours per active driver in the month. How used your base is: if it falls, drivers are registered but barely active.",
        "Среднее число часов на линии на одного активного водителя за месяц. Показывает, насколько задействована ваша база: если падает — водители зарегистрированы, но почти не работают.")));
  // 5) Hacia la meta (si el partner tiene meta de AD cargada). Muestra los NUEVOS+REACT
  // que hacen falta para el nivel meta CONTANDO la rotación: aunque la meta de AD sea ~igual
  // a hoy, cada mes se van conductores (retención<100%) y hay que reponerlos. Antes se
  // disparaba por gap de NIVEL (meta==hoy → gap 0 → "en meta" engañoso, aunque falten N+R).
  const t = C.target ? fcLeversToTarget(L, C.target) : null;
  if (t) {
    const goalLbl = P2T(`Para tu meta (${fmt(Math.round(C.target))} AD)`, `To hit goal (${fmt(Math.round(C.target))} AD)`, `Для вашей цели (${fmt(Math.round(C.target))} АВ)`);
    const need = Math.round(t.newNeeded);
    const now  = Math.round(t.newNow || 0);
    const shortBy = need - now;
    const onTrack = shortBy <= 0;
    const retA = t.retNow    != null ? (t.retNow    * 100).toFixed(0) + "%" : "—";
    const retB = t.retNeeded != null ? (t.retNeeded * 100).toFixed(0) + "%" : "—";
    cards.push(_p2FcMiniCard(goalLbl,
      (onTrack ? "✓ " : "") + fmt(need) + (P2T(" N+R/mes", " N+R/mo", " Н+Р/мес")),
      onTrack ? P2T(`tu ritmo (~${fmt(now)}) alcanza`, `your pace (~${fmt(now)}) suffices`, `ваш темп (~${fmt(now)}) достаточен`)
              : P2T(`hoy ~${fmt(now)} · faltan ${fmt(shortBy)}`, `today ~${fmt(now)} · short ${fmt(shortBy)}`, `сейчас ~${fmt(now)} · не хватает ${fmt(shortBy)}`),
      onTrack ? "#10b981" : "#0284c7",
      P2T(`Aunque tu meta de AD (${fmt(Math.round(C.target))}) sea parecida a hoy (${fmt(Math.round(L.adNow))}), cada mes se te van conductores por rotación (retención ${retA}). Para sostener/llegar a la meta necesitás ~${fmt(need)} nuevos+reactivados en el mes; hoy promediás ~${fmt(now)}${shortBy > 0 ? ` (te faltan ~${fmt(shortBy)})` : ""}. Alternativa: subir la retención de ${retA} a ${retB}.`,
          `Even if your AD goal (${fmt(Math.round(C.target))}) is close to today (${fmt(Math.round(L.adNow))}), churn takes drivers each month (retention ${retA}). To hold/reach it you need ~${fmt(need)} new+reactivated in the month; today you average ~${fmt(now)}${shortBy > 0 ? ` (short ~${fmt(shortBy)})` : ""}. Alternative: raise retention from ${retA} to ${retB}.`,
          `Даже если цель по активным водителям (${fmt(Math.round(C.target))}) близка к сегодняшнему уровню (${fmt(Math.round(L.adNow))}), каждый месяц часть водителей уходит (удержание ${retA}). Чтобы удержать или достичь цели, нужно ~${fmt(need)} новых+реактивированных за месяц; сейчас в среднем ~${fmt(now)}${shortBy > 0 ? ` (не хватает ~${fmt(shortBy)})` : ""}. Альтернатива: поднять удержание с ${retA} до ${retB}.`)));
  }
  const title = P2T("Palancas de crecimiento", "Growth levers", "Рычаги роста");
  const subt = P2T("Lo que mueve tu # de Conductores Activos. La proyección de arriba asume que se mantienen — mejorá una y sube.",
                   "What moves your Active-Driver count. The forecast above assumes they hold — improve one and it rises.",
                   "Что двигает ваше число активных водителей. Прогноз выше исходит из того, что показатели не меняются — улучшите один, и он вырастет.");
  return `<div class="agy-style-405">
    <div class="agy-style-406">
      <span class="agy-style-407">${title}</span>
      <span class="agy-style-408">${escapeHTML(subt)}</span>
    </div>
    <div class="agy-style-307">${cards.join("")}</div>
  </div>`;
}
// Detalle solo-vivo para el KAM (NO va al PDF): método + precisión por KPI.
export function _p2FcDetailHTML(C, es) {
  const chips = P2_FC_KPIS.map(k => {
    const r = C.fc[k.key];
    const acc = r.mape != null ? "±" + r.mape.toFixed(0) + "%" : "—";
    return `<span class="agy-style-409"><b>${escapeHTML(P2T(k.es, k.en, k.ru || k.en))}</b>: ${escapeHTML(fcMethodName(r.method, es))} · ${acc}</span>`;
  }).join("");
  return `<div class="agy-style-410">
    <div class="agy-style-411">${P2T("Detalle KAM (no se incluye en el PDF)", "KAM detail (not in PDF)", "Детали для KAM (не входит в PDF)")}</div>
    <div>${chips}</div>
  </div>`;
}
export function buildSlide2Forecast(partner, dates, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const shell = inner => `<div class="agy-style-365">
    ${p2BrandHeader(partner, (P2T("Proyección · próximos 3 meses", "Forecast · next 3 months", "Прогноз · ближайшие 3 месяца")),
      P2T("Qué esperar si la tendencia sigue igual — y qué mover para crecer", "What to expect if the trend holds — and what to move to grow", "Чего ждать, если тренд сохранится, и что менять для роста"))}
    ${inner}
    ${p2BrandFooter(idx)}
  </div>`;
  if (STATE.curMode !== "mensual") {
    return shell(`<div class="agy-style-412">${P2T("El pronóstico usa la serie MENSUAL. Cambia la escala a Mensual (arriba) para ver la proyección.", "The forecast uses the MONTHLY series. Switch the scale to Monthly to see it.", "Прогноз строится на МЕСЯЧНОМ ряде. Переключите масштаб на «Ежемесячно» вверху, чтобы увидеть его.")}</div>`);
  }
  const C = p2ForecastCompute(partner);
  if (!C || C.histMonths.length < 4) {
    return shell(`<div class="agy-style-412">${P2T("Se necesitan al menos 4 meses de historia para proyectar.", "At least 4 months of history are needed to forecast.", "Для прогноза нужно минимум 4 месяца истории.")}</div>`);
  }
  const cards = P2_FC_KPIS.map(k => {
    const r = C.fc[k.key];
    const last = r.history[r.history.length - 1];
    const f3 = r.forecast[r.forecast.length - 1];
    const growth = last ? (f3 - last) / last * 100 : null;
    const gcol = growth == null ? "#888" : growth >= 0 ? "#10b981" : "#FF0000";
    const gtxt = growth == null ? "" : (growth >= 0 ? "+" : "") + growth.toFixed(1) + "%";
    const acc = r.mape != null ? "±" + r.mape.toFixed(0) + "%" : "—";
    // Cada tarjeta es una celda del grid 2×2 (altura acotada por grid-template-rows:1fr) →
    // el canvas nunca se desborda sobre las palancas de abajo.
    return `<div class="agy-style-413">
      <div class="agy-style-377">
        <span class="agy-style-414"><span style="width:7px;height:7px;border-radius:50%;background:${k.color};flex-shrink:0"></span><span class="agy-style-415">${escapeHTML(P2T(k.es, k.en, k.ru || k.en))}</span></span>
        <span style="font-size:.62rem;font-weight:800;color:${gcol};background:${gcol}18;padding:1px 6px;border-radius:6px">${gtxt}</span>
      </div>
      <div class="agy-style-416">
        <span class="agy-style-417">${_p2FcFmt(k.kind, last)}</span>
        <span class="agy-style-418">${P2T("hoy → 3m", "now → 3m", "сейчас → 3 мес.")}</span>
        <span style="font-weight:900;font-size:.9rem;color:${k.color}">${_p2FcFmt(k.kind, f3)}</span>
        <span class="agy-style-419">${P2T("precisión", "accuracy", "точность")} ${acc}</span>
      </div>
      <div class="agy-style-420"><canvas id="p2fc_${k.key}" class="agy-style-362"></canvas></div>
    </div>`;
  }).join("");
  const partialNote = C.partial ? `<div class="agy-style-421">
      <span>⚠️ ${P2T("El último mes parece incompleto y se excluyó del pronóstico.", "The last month looks incomplete and was excluded from the forecast.", "Последний месяц выглядит неполным и исключён из прогноза.")}</span>
      ${PRESENT2_STATE._exporting ? "" : `<button data-act="present2ToggleInclPartial" style="border:1px solid #f59e0b;background:${PRESENT2_STATE.fcInclPartial ? "#f59e0b" : "#fff"};color:${PRESENT2_STATE.fcInclPartial ? "#fff" : "#b45309"};border-radius:6px;padding:2px 8px;font-size:.58rem;font-weight:700;cursor:pointer;white-space:nowrap">${PRESENT2_STATE.fcInclPartial ? (P2T("Excluir", "Exclude", "Исключить")) : (P2T("Incluir último mes", "Include last month", "Включить последний месяц"))}</button>`}
    </div>` : "";
  // Leyenda + encuadre en lenguaje simple (qué es la proyección). Swatches inline-block
  // (seguros en el PDF). Incluye la validación (error del backtest) para dar confianza.
  const mapes = P2_FC_KPIS.map(k => C.fc[k.key].mape).filter(v => v != null);
  const avg = mapes.length ? mapes.reduce((s, v) => s + v, 0) / mapes.length : null;
  const nBack = Math.min(6, C.histMonths.length - Math.max(4, C.histMonths.length - 6));
  const sw = (style) => `<span style="display:inline-block;width:16px;height:0;border-top:2px ${style};vertical-align:middle;margin-right:5px"></span>`;
  const swSolid = sw("solid #888"), swDash = sw("dashed #888"), swUp = sw("dashed #10b981"), swDown = sw("dashed #dc2626");
  const legend = `<div class="agy-style-422">
      <span class="agy-style-423">${swSolid}${P2T(`Real (${C.histMonths.length} meses)`, `Actual (${C.histMonths.length} mo.)`, `Факт (${C.histMonths.length} мес.)`)}</span>
      <span class="agy-style-423">${swDash}${P2T("Proyección esperada", "Expected forecast", "Ожидаемый прогноз")}</span>
      <span class="agy-style-424">${swUp}${P2T("Si crece (máx)", "If grows (max)", "Если растёт (макс.)")}</span>
      <span class="agy-style-425">${swDown}${P2T("Si decrece (mín)", "If drops (min)", "Если падает (мин.)")}</span>
      ${avg != null ? `<span class="agy-style-426">✓ ${P2T(`Validado con tus ${nBack} meses más recientes · ±${avg.toFixed(0)}%`, `Validated on your ${nBack} most recent months · ±${avg.toFixed(0)}%`, `Проверено на ваших ${nBack} последних месяцах · ±${avg.toFixed(0)}%`)}</span>` : ""}
      <span class="agy-style-427">${P2T("Al ritmo actual — mové las palancas ↓ para cambiarla", "At current pace — move the levers ↓ to change it", "При текущем темпе — двигайте рычаги ↓, чтобы изменить")}</span>
    </div>`;
  const detail = PRESENT2_STATE._exporting ? "" : _p2FcDetailHTML(C, es);
  const expBanner = `<div class="agy-style-428">
      <span class="agy-style-429">🧪</span>
      <span>${P2T("EXPERIMENTAL · en validación — no compartir con partners aún. No se incluye en el PDF.", "EXPERIMENTAL · under validation — do not share with partners yet. Not included in the PDF.", "ЭКСПЕРИМЕНТ · на проверке — пока не делиться с партнёрами. Не входит в PDF.")}</span>
    </div>`;
  return shell(`
    ${expBanner}
    ${partialNote}
    ${legend}
    <div class="agy-style-430">${cards}</div>
    ${_p2FcPalancasHTML(C, es)}
    ${detail}`);
}
// Gráfico por KPI: historia (sólida) + proyección (punteada) + banda sombreada.
export function p2ForecastChart(canvasId, labels, hist, fcObj, color, kind, root) {
  const canvas = root ? root.querySelector(`#${canvasId}`) : document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  const nH = hist.length, H = fcObj.forecast.length;
  const pad = n => Array(n).fill(null);
  const histData = hist.concat(pad(H));
  // La proyección y la banda arrancan en el último punto real (para que la línea conecte).
  const bridge = nH ? [hist[nH - 1]] : [];
  const fcData = pad(nH - 1).concat(bridge, fcObj.forecast);
  const upper  = pad(nH - 1).concat(bridge, fcObj.upper);
  const lower  = pad(nH - 1).concat(bridge, fcObj.lower);
  const lastIdx = labels.length - 1;
  const fmtV = v => v == null ? "" : (kind === "money" ? "$" + fmtSmart(v) : kind === "numK" ? fmtSmart(v) : fmt(Math.round(v)));
  const UP = "#10b981", DN = "#dc2626";   // verde = si crece (máx) · rojo = si decrece (mín)
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: labels.map(d2s), datasets: [
      // Escenario ALTO ("si crezco / máximo"): línea verde punteada + banda tenue hacia el bajo.
      // Etiqueta solo en el último mes (el techo del rango) para no saturar.
      { label: "hi", data: upper, borderColor: UP, backgroundColor: color + "12", borderWidth: 1, borderDash: [2, 3], pointRadius: 0, fill: "+1", tension: 0.25, spanGaps: true,
        datalabels: { display: c => c.dataIndex === lastIdx, align: "top", anchor: "end", offset: 1, color: UP, font: { size: 8, weight: "bold" }, formatter: v => v == null ? "" : (P2T("máx ", "max ", "макс. ")) + fmtV(v) } },
      // Escenario BAJO ("si decrezco / mínimo"): línea roja punteada.
      { label: "lo", data: lower, borderColor: DN, borderWidth: 1, borderDash: [2, 3], pointRadius: 0, fill: false, tension: 0.25, spanGaps: true,
        datalabels: { display: c => c.dataIndex === lastIdx, align: "bottom", anchor: "start", offset: 1, color: DN, font: { size: 8, weight: "bold" }, formatter: v => v == null ? "" : (P2T("mín ", "min ", "мин. ")) + fmtV(v) } },
      // Real (historia) — sin etiquetas (18 puntos saturarían).
      { label: "real", data: histData, borderColor: color, backgroundColor: "transparent", borderWidth: 2.2, pointRadius: 2, pointBackgroundColor: color, tension: 0.25, fill: false, spanGaps: false,
        datalabels: { display: false } },
      // Proyección ESPERADA (punteada, color del KPI): tag del número en CADA mes proyectado.
      { label: "proy", data: fcData, borderColor: color, borderDash: [5, 4], borderWidth: 2.4, pointRadius: 3, pointBackgroundColor: "#fff", pointBorderColor: color, tension: 0.25, fill: false, spanGaps: true,
        datalabels: { display: c => c.dataIndex >= nH, align: "top", anchor: "center", offset: 3, color: color, font: { size: 8.5, weight: "bold" }, formatter: v => v == null ? "" : fmtV(v) } }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 16, right: 28, bottom: 6, left: 2 } },   // aire para los tags máx/mín/esperado
      plugins: {
        legend: { display: false },
        tooltip: { filter: c => ["real", "proy", "hi", "lo"].includes(c.dataset.label), callbacks: { label: c => {
          const m = { real: P2T("real", "actual", "факт"), proy: P2T("esperado", "expected", "ожидается"), hi: P2T("si crece", "if grows", "если растёт"), lo: P2T("si decrece", "if drops", "если падает") }[c.dataset.label] || "";
          return `${m}: ${fmtV(c.raw)}`; } } },
        datalabels: { clamp: true, clip: false }
      },
      scales: {
        x: { ticks: { font: { size: 7 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }, grid: { display: false } },
        y: { beginAtZero: false, ticks: { font: { size: 7 }, maxTicksLimit: 4, callback: v => fmtV(v) }, grid: { color: "#f5f5f5" } }
      }
    }
  });
  PRESENT2_STATE.charts.push(chart);
}
export function buildSlide2ForecastCharts(partner, dates, root) {
  if (STATE.curMode !== "mensual") return;
  const C = p2ForecastCompute(partner);
  if (!C || C.histMonths.length < 4) return;
  const labels = C.histMonths.concat(C.futureMonths);
  P2_FC_KPIS.forEach(k => {
    const r = C.fc[k.key];
    p2ForecastChart(`p2fc_${k.key}`, labels, r.history, r, k.color, k.kind, root);
  });
}
export function present2ToggleInclPartial() { PRESENT2_STATE.fcInclPartial = !PRESENT2_STATE.fcInclPartial; renderSlide2(); }

// ── RENDER PRINCIPAL (shell + slide activo) ───────────────────────────────────
export function renderPresent2() {
  ensureIndexes();
  destroyPresent2Charts();
  const el = document.getElementById("present2Content");
  if (!el) return;
  // rawDataFull (no rawData) — así el guard no falla si TODO lo cargado resulta
  // ser tuktuk (rawData quedaría vacío tras la exclusión, pero sí hay data).
  if (!STATE.rawDataFull || !STATE.rawDataFull.length) {
    el.innerHTML = `<div class="empty"><p>Carga datos de <strong>Rendimiento</strong> para usar Presentación.</p></div>`;
    return;
  }
  // Selector = unión taxi + tuktuk (deck combinado): un partner puede tener
  // sección Taxi y/o TukTuk; ambos deben poder elegirse.
  const partners = p2PartnerList();
  if (!partners.length) {
    el.innerHTML = `<div class="empty"><p>No hay partners cargados.</p></div>`;
    return;
  }
  if (!PRESENT2_STATE.partner || !partners.includes(PRESENT2_STATE.partner)) PRESENT2_STATE.partner = partners[0];
  // "Fleet" forzado solo tiene sentido si el partner está flagged Fleet — si no,
  // los KPIs de referencia (Acceptance/Owned Cars/SH interno) no existen y solo
  // se ven guiones. Clamp: si cambiaste de partner y el nuevo no es Fleet, vuelve a Auto.
  const canForceFleet = typeof isFleetPartner === "function" && isFleetPartner(PRESENT2_STATE.partner);
  if (PRESENT2_STATE.fleetMode === "fleet" && !canForceFleet) PRESENT2_STATE.fleetMode = "auto";

  // Deck del partner: define nav, badge y sección activa del toggle.
  const deck = p2Deck(PRESENT2_STATE.partner);
  PRESENT2_STATE._deckLen = deck.length;
  PRESENT2_STATE._showDsBadge = p2TuktukSectionVisible(PRESENT2_STATE.partner) && p2HasTaxi(PRESENT2_STATE.partner);
  if (PRESENT2_STATE.slide >= deck.length) PRESENT2_STATE.slide = 0;
  const curDs = (deck[PRESENT2_STATE.slide] || deck[0]).ds;

  el.innerHTML = `
    <div class="agy-style-431">
      <div class="agy-style-432">
        <div class="agy-style-168">
          <label class="agy-style-433">Partner</label>
          <input id="present2Search" type="text" class="sb-inp agy-style-434" autocomplete="off" placeholder="${P2T("Buscar partner...", "Search partner...", "Поиск партнёра...")}" value="${escapeHTML(PRESENT2_STATE.partner)}" data-act-input="p2FilterPartners" data-act-focus="p2ShowPartnerList" data-act-blur="p2HidePartnerListDelayed" data-act-keydown="p2SearchKeydown"/>
          <div id="present2PartnerList" class="agy-style-435"></div>
        </div>
        <div>
          <label class="agy-style-433">${P2T("Idioma", "Language", "Язык")}</label>
          <div class="mode-toggle">
            ${P2_LANGS.map(L => `<button class="mode-btn ${PRESENT2_STATE.lang === L.k ? "active" : ""}" data-act="setPresent2Lang" data-lang="${L.k}">${L.lbl}</button>`).join("")}
          </div>
        </div>
        <div>
          <label class="agy-style-433">${P2T("Comparar con", "Compare", "Сравнить с")}</label>
          <div id="present2CmpBar" class="agy-style-436">${p2CmpBar()}</div>
        </div>
        <div>
          <label class="agy-style-433">${P2T("Vista", "View", "Вид")}</label>
          <div class="mode-toggle" title="${P2T("Auto respeta el flag Fleet de Configuración", "Auto follows the Fleet flag in Config", "Авто следует флагу Fleet из настроек")}">
            <button class="mode-btn ${PRESENT2_STATE.fleetMode === "auto"  ? "active" : ""}" data-act="present2SetFleetMode" data-mode="auto">Auto</button>
            <button class="mode-btn ${PRESENT2_STATE.fleetMode === "taxi"  ? "active" : ""}" data-act="present2SetFleetMode" data-mode="taxi">${P2T("Taxi", "Taxi", "Такси")}</button>
            <button class="mode-btn ${PRESENT2_STATE.fleetMode === "fleet" ? "active" : ""}" ${canForceFleet ? `data-act="present2SetFleetMode" data-mode="fleet"` : `disabled class="agy-style-437"`} title="${canForceFleet ? "" : (P2T("Este partner no está marcado como Fleet", "This partner isn't flagged as Fleet", "Этот партнёр не отмечен как Fleet"))}">Fleet</button>
          </div>
        </div>
        ${p2TuktukSectionVisible(PRESENT2_STATE.partner) ? `
        <div>
          <label class="agy-style-433">${P2T("Sección", "Section", "Раздел")}</label>
          <div class="mode-toggle" id="present2SectionBar" title="${P2T("Salta a la sección Taxi o TukTuk del deck", "Jump to the Taxi or TukTuk section", "Перейти к разделу Такси или ТукТук")}">${_p2SectionBarHTML(curDs)}</div>
        </div>` : ""}
        ${p2MetaMeses().length ? `
        <div title="${P2T("Mes de la meta en 'Avance vs Meta'. Auto = el mes del 'Hasta'.", "Goal month for 'Goal vs Target'. Auto = the 'To' month.", "Месяц цели в «Прогресс к цели». Авто = месяц из поля «По».")}">
          <label class="agy-style-433">${P2T("Mes meta", "Goal month", "Месяц цели")}</label>
          <select data-act-change="present2SetAvanceMes" class="agy-style-438">
            <option value="">${P2T("Auto (según filtro)", "Auto (by filter)", "Авто (по фильтру)")}</option>
            ${p2MetaMeses().map(m => `<option value="${escapeHTML(m)}" ${PRESENT2_STATE.avanceMesSel === m ? "selected" : ""}>${escapeHTML(m)}</option>`).join("")}
          </select>
        </div>` : ""}
        <div class="agy-style-439">
          <button data-act="switchTab" data-tab="rend" class="agy-style-440">← ${P2T("Volver", "Back", "Назад")}</button>
          <button class="png-btn" data-act="present2TogglePdfPanel" title="${escapeHTML(P2T("Elegí qué hojas entran al PDF", "Choose which sheets go into the PDF", "Выберите страницы для PDF"))}">🗂 ${escapeHTML(P2T("Hojas", "Sheets", "Страницы"))} ${_p2PdfCount()}</button>
          <button class="apply-btn agy-style-441" data-act="p2AbrirChequeoExport">⬇ ${escapeHTML(P2T("Descargar PDF", "Download PDF", "Скачать PDF"))}</button>
        </div>
      </div>
      ${p2PdfPanelHTML()}
      <div id="present2Nav" class="agy-style-442">
        ${p2NavHTML()}
      </div>
      ${p2FreshnessWarn()}
      <div id="slide2Container" class="agy-style-443">
        <div id="slide2Inner" class="agy-style-362"></div>
      </div>
    </div>`;

  renderSlide2();
}

export function p2CmpBar() {
  const tog = PRESENT2_STATE.cohort || {};
  const cityBtn = `<button data-act="present2ToggleCity" class="preset-btn${PRESENT2_STATE.cmpCity ? " active" : ""}" style="flex:0 0 auto;padding:4px 10px;${PRESENT2_STATE.cmpCity ? "background:#64748b;color:#fff;border-color:#64748b" : ""}">${P2T("Ciudad", "City", "Город")}</button>`;
  const bands = P2_BANDS.map(b => {
    const on = tog[b.key];
    return `<button data-act="present2ToggleCohort" data-key="${escapeHTML(b.key)}" class="preset-btn${on ? " active" : ""}" style="flex:0 0 auto;padding:4px 10px;${on ? `background:${b.color};color:#fff;border-color:${b.color}` : ""}">${escapeHTML(P2T(b.es, b.en, b.ru || b.en))}</button>`;
  }).join("");
  return cityBtn + bands;
}

// Igual que getSelectedDates (presentacion.js) pero sobre p2AllDates() — las fechas
// del DATASET + ESCALA activos (Taxi usa STATE.allDates; TukTuk sus propias fechas).
// Sin esto, la sección TukTuk se iteraba con las fechas de Taxi: si Taxi tiene un mes
// más nuevo que TukTuk (la flota tuktuk suele subirse con retraso), la última columna
// del deck TukTuk salía en 0 en el PDF. (Bug HIGH del review; espeja el window de
// getSelectedDates: mensual = últimos 4; semanal/diario = rango, con fallback.)
export function p2SelectedDates(from, to, mode) {
  const all = p2AllDates() || [];
  if (!all.length) return [];
  const tail4 = () => {
    const idx = all.findIndex(d => d > to);
    const end = idx === -1 ? all.length - 1 : idx - 1;
    return all.slice(Math.max(0, end - 3), end + 1);
  };
  if (mode === "mensual") return tail4();
  const inRange = all.filter(d => d >= from && d <= to);
  return inRange.length ? inRange : tail4();
}

export function renderSlide2() {
  const inner = document.getElementById("slide2Inner");
  if (!inner) return;
  destroyPresent2Charts();
  const partner = PRESENT2_STATE.partner;
  const deck = p2Deck(partner);
  PRESENT2_STATE._deckLen = deck.length;
  PRESENT2_STATE._showDsBadge = p2TuktukSectionVisible(partner) && p2HasTaxi(partner);
  if (PRESENT2_STATE.slide >= deck.length) PRESENT2_STATE.slide = 0;
  const entry = deck[PRESENT2_STATE.slide] || deck[0];
  PRESENT2_STATE.dataset = entry.ds;   // scope: los accesores (p2RawDataset/…) leen este global
  const from = document.getElementById("dateFrom") ? document.getElementById("dateFrom").value : STATE.allDates[0];
  const to   = document.getElementById("dateTo")   ? document.getElementById("dateTo").value   : STATE.allDates[STATE.allDates.length - 1];
  const dates = p2SelectedDates(from, to, STATE.curMode);   // dataset-aware: TukTuk usa sus fechas
  const renderId = ++PRESENT2_STATE._renderId;
  const s = entry.def;

  // ALTURA DE LA HOJA SEGUN DENSIDAD (ago 2026). El contenedor es 16:9 fijo, y
  // la slide "KPIs por Nivel" apila un renglon por nivel (Peru + cada ciudad):
  // con 4 niveles x 4 KPIs, cada grafica quedaba tan baja que las etiquetas de
  // variacion no entraban ni con el headroom del eje. A partir de 3 niveles la
  // hoja se alarga; con 1-2 se mantiene el 16:9 clasico.
  //
  // Se aplica al CONTENEDOR (no al inner) porque es el que define la caja, y se
  // limpia en cada render para que una slide densa no deje alta a la siguiente.
  const cont = document.getElementById("slide2Container");
  if (cont) {
    // Identificada por su etiqueta `es` de P2_SLIDES. NO por
    // `s.build === buildSlide2Matrix`: el deck envuelve cada build en una
    // lambda `(p,d,i) => buildSlide2Matrix(...)`, asi que la comparacion de
    // identidad nunca da true (probado: el aspect-ratio no se aplicaba).
    const esMatriz = s.es === "KPIs por Nivel";
    const nNiveles = esMatriz ? p2Levels(partner).length : 0;
    cont.style.aspectRatio = nNiveles >= 4 ? "16 / 13"
                           : nNiveles === 3 ? "16 / 11"
                           : "";           // "" = vuelve al 16/9 del CSS
    cont.style.height = "";                // el ajuste al contenido se recalcula abajo
  }

  inner.innerHTML = s.build(partner, dates, PRESENT2_STATE.slide);

  // AJUSTE AL CONTENIDO — cinturón genérico sobre el aspect-ratio de arriba.
  // La hoja tiene overflow:hidden, así que si el contenido no entra se RECORTA
  // en silencio: en iPad vertical (hoja 780×439) el Resumen perdía la fila de
  // Cargo y la última fila se dibujaba 60px por debajo del pie, encima de él.
  // El aspect-ratio fijo no puede prever cuántas filas tiene cada slide ni a
  // qué ancho se está viendo, así que en vez de enumerar slides caso por caso
  // se mide lo renderizado y se estira la hoja lo necesario.
  // Solo CRECE (nunca encoge): una hoja más baja que 16:9 se vería rara.
  if (cont) {
    const hoja = inner.firstElementChild;
    if (hoja && hoja.scrollHeight > hoja.clientHeight + 1) {
      const falta = hoja.scrollHeight - hoja.clientHeight;
      cont.style.aspectRatio = "";                                  // liberar la relación fija
      cont.style.height = (cont.getBoundingClientRect().height + falta + 8) + "px";
    } else {
      cont.style.height = "";
    }
  }

  if (s.charts && s.chartFn) {
    setTimeout(() => {
      if (renderId !== PRESENT2_STATE._renderId || STATE.curTab !== "present2") return;
      PRESENT2_STATE.dataset = entry.ds;   // re-afirmar por si otro render cambió el global
      s.chartFn(partner, dates);   // en vivo: sin root (getElementById)
    }, 90);
  }
}

// ── NAVEGACIÓN / CONTROLES ────────────────────────────────────────────────────
export function goSlide2(i) {
  PRESENT2_STATE.slide = i;
  const nav = document.getElementById("present2Nav");
  if (nav) nav.innerHTML = p2NavHTML();   // repinta el nav (tinte por sección Taxi/TukTuk)
  renderSlide2();
}
export function prevSlide2() { goSlide2(Math.max(0, PRESENT2_STATE.slide - 1)); }
export function nextSlide2() { goSlide2(Math.min((PRESENT2_STATE._deckLen || P2_SLIDES.length) - 1, PRESENT2_STATE.slide + 1)); }
// Cambio de partner: reset a la carátula y re-render del shell (el deck del nuevo
// partner puede tener otra longitud/secciones → hay que reconstruir el nav).
export function onPresent2PartnerChange(p) { PRESENT2_STATE.partner = p; PRESENT2_STATE.slide = 0; renderPresent2(); }
export function setPresent2Lang(l) { PRESENT2_STATE.lang = l; renderPresent2(); }
export function present2ToggleCity() { PRESENT2_STATE.cmpCity = !PRESENT2_STATE.cmpCity; refreshPresent2Bar(); renderSlide2(); }
// Toggle Auto/Fleet/Taxi: re-renderiza el shell completo (el botón activo cambia
// de estilo) y el slide actual, para que la matriz recalcule con el set de KPIs correcto.
export function present2SetFleetMode(mode) { PRESENT2_STATE.fleetMode = mode; renderPresent2(); }
// Mes META de "Avance vs Meta": "" → auto (según "Hasta"); nombre → fijo.
export function present2SetAvanceMes(mes) { PRESENT2_STATE.avanceMesSel = mes || null; renderPresent2(); }
export function present2TogglePdfPanel() { PRESENT2_STATE.pdfPanel = !PRESENT2_STATE.pdfPanel; renderPresent2(); }
export function present2TogglePdfSlide(key) {
  if (PRESENT2_STATE.pdfOff.has(key)) PRESENT2_STATE.pdfOff.delete(key);
  else PRESENT2_STATE.pdfOff.add(key);
  renderPresent2();
}
export function present2PdfAll(on) {
  if (on) { PRESENT2_STATE.pdfOff.clear(); }
  else p2Deck(PRESENT2_STATE.partner).forEach(e => { if (!e.def.noPdf) PRESENT2_STATE.pdfOff.add(p2SlideKey(e)); });
  renderPresent2();
}
// Markup de los botones Taxi/TukTuk de la Sección (bar con id present2SectionBar).
// "just-active" dispara la animación CSS de pop al repintarse (ver styles.css).
export function _p2SectionBarHTML(curDs) {
  return `
    <button class="mode-btn ${curDs === "taxi"   ? "active just-active" : ""}" data-act="present2JumpSection" data-section="taxi">🚕 Taxi</button>
    <button class="mode-btn ${curDs === "tuktuk" ? "active just-active" : ""}" data-act="present2JumpSection" data-section="tuktuk">🛺 TukTuk</button>`;
}
// Salta a la primera diapositiva de la sección (Taxi/TukTuk) del deck del partner.
// NO resetea el partner (arregla el bug de perder el partner al alternar). goSlide2
// no repinta este bar (solo #present2Nav y #slide2Inner) → lo hacemos aquí para que
// el botón activo se refleje y anime en cada click (antes quedaba visualmente inerte).
export function present2JumpSection(ds) {
  const deck = p2Deck(PRESENT2_STATE.partner);
  const i = deck.findIndex(e => e.ds === ds);
  goSlide2(i < 0 ? 0 : i);
  const actualDs = (deck[PRESENT2_STATE.slide] || deck[0]).ds;
  const bar = document.getElementById("present2SectionBar");
  if (bar) bar.innerHTML = _p2SectionBarHTML(actualDs);
}
export function present2ToggleCohort(k) {
  PRESENT2_STATE.cohort = PRESENT2_STATE.cohort || {};
  PRESENT2_STATE.cohort[k] = !PRESENT2_STATE.cohort[k];
  refreshPresent2Bar(); renderSlide2();
}
export function refreshPresent2Bar() { const bar = document.getElementById("present2CmpBar"); if (bar) bar.innerHTML = p2CmpBar(); }
// Buscador autocomplete (patrón de Vista Partner): escribes → lista filtrada →
// click selecciona. NO cambia de partner al escribir. p2ActivePartners = lista del
// dataset activo (Fase 3 agregará tuktuk; hoy = STATE.allPartners).
export function p2FilterPartners(q) { p2ShowPartnerList(); _p2PaintPartnerList(q); }
export function p2ShowPartnerList() {
  const list = document.getElementById("present2PartnerList");
  if (!list) return;
  list.style.display = "block";
  if (!list.innerHTML) { const inp = document.getElementById("present2Search"); _p2PaintPartnerList(inp ? inp.value : ""); }
}
export function p2HidePartnerList() { const l = document.getElementById("present2PartnerList"); if (l) l.style.display = "none"; }
export function _p2PaintPartnerList(q) {
  const list = document.getElementById("present2PartnerList");
  if (!list) return;
  const lower = (q || "").toLowerCase().trim();
  const all = p2PartnerList();   // unión taxi + tuktuk (mismo criterio que el selector)
  const filtered = lower ? all.filter(p => p.toLowerCase().includes(lower)) : all;
  if (!filtered.length) { list.innerHTML = `<div class="agy-style-180">Sin coincidencias</div>`; return; }
  list.innerHTML = filtered.slice(0, 100).map(p => {
    const sel = p === PRESENT2_STATE.partner;
    // data-partner (leído via this.dataset.partner) en vez de inyectar el nombre crudo en el
    // string JS del onmousedown: un partner con comilla doble/backslash rompía el click o
    // podía inyectar un atributo HTML (el .replace solo escapaba comilla simple). dataset.*
    // decodifica el atributo HTML sin pasar por un parser de string JS → sin ese riesgo.
    return `<div class="pv-opt" data-partner="${escapeHTML(p)}" data-act-mousedown="p2SelectPartner" style="padding:7px 12px;font-size:.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid #f3f3f3;${sel ? "background:#fff0f0;font-weight:700" : ""}">
      <span class="agy-style-444"></span>
      <span class="agy-style-181">${escapeHTML(p)}</span></div>`;
  }).join("");
}
export function p2SelectPartner(p) {
  // onmousedown corre ANTES del onblur del input (que oculta la lista).
  const inp = document.getElementById("present2Search"); if (inp) inp.value = p;
  p2HidePartnerList(); onPresent2PartnerChange(p);
}
export function p2SearchKeydown(e) {
  if (e.key === "Enter") {
    const l = document.getElementById("present2PartnerList");
    const f = l && l.querySelector(".pv-opt");
    if (f) f.dispatchEvent(new MouseEvent("mousedown"));
    e.preventDefault();
  } else if (e.key === "Escape") { p2HidePartnerList(); }
}

// ── EXPORT PDF ────────────────────────────────────────────────────────────────
// Mismo patrón que downloadPresentPDF: cada slide se arma en un div temporal
// 1280×720 y se captura con html2canvas. Los charts se construyen acotados al div
// (root.querySelector) para no chocar con los canvas de la vista en vivo (ids dup).
// ── CHEQUEO PREVIO A LA EXPORTACION (sep 2026) ───────────────────────────────
// El PDF sale del dashboard y entra a la bandeja de un partner: es la unica
// accion de esta app que no se puede deshacer. Lo que se revisa no son errores
// de codigo sino DECISIONES DE FILTRO que producen un deck correcto pero que
// dice otra cosa de la que el KAM cree — y que en pantalla pasan desapercibidas
// porque cada aviso vive dentro de su hoja.
//
// Devuelve { resumen[], avisos[] }. Un aviso NO impide exportar: puede ser
// deliberado (mandar una sola semana, por ejemplo). Solo obliga a mirarlo.
export function p2ChequeoExport(partner) {
  const mi = p2ModeInfo();
  const from = document.getElementById("dateFrom")?.value || "";
  const to   = document.getElementById("dateTo")?.value   || "";
  const mesName = p2AvanceMes();
  const deck = p2Deck(partner);
  const dentro = deck.filter(p2SlideEnPdf);
  const resumen = [
    [P2T("Partner", "Partner", "Партнёр"), partner],
    [P2T("Idioma del PDF", "PDF language", "Язык PDF"),
      (P2_LANGS.find(l => l.k === PRESENT2_STATE.lang) || {}).lbl],
    [P2T("Escala", "Scale", "Масштаб"), mi.label],
    [P2T("Rango", "Range", "Период"), `${d2s(from)} → ${d2s(to)}`],
    [P2T("Mes de la meta", "Goal month", "Месяц цели"), p2MesLabel(mesName)],
    [P2T("Hojas", "Sheets", "Страницы"), `${dentro.length} / ${deck.filter(e => !e.def.noPdf).length}`]
  ];
  const avisos = [];
  // 1. Rango que no cubre el mes de la meta: los FLUJOS quedan cortos y el % se
  //    lee como incumplimiento. Es el aviso que ya sale en el Ejecutivo, pero
  //    ahi hay que estar mirando esa hoja.
  const savedDs = PRESENT2_STATE.dataset;
  PRESENT2_STATE.dataset = "taxi";
  const delMes = p2MonthDates(mesName);
  const enRango = p2DatesMetaEnRango(mesName, p2SelectedDates(from, to, STATE.curMode));
  PRESENT2_STATE.dataset = savedDs;
  if (delMes.length && enRango.length < delMes.length) avisos.push(P2T(
    `El rango cubre ${enRango.length} de ${delMes.length} períodos de ${p2MesLabel(mesName)}: Nuevos+Reactivados y Horas van a quedar cortos contra una meta mensual.`,
    `The range covers ${enRango.length} of ${delMes.length} periods of ${p2MesLabel(mesName)}: New+Reactivated and Hours will fall short against a monthly goal.`,
    `Диапазон покрывает ${enRango.length} из ${delMes.length} периодов месяца ${p2MesLabel(mesName)}: новые+реактивированные и часы будут занижены относительно месячной цели.`));
  // 2. Sin metas del mes: el deck sale sin cumplimiento y se lee como si el
  //    partner no hubiera llegado a nada.
  const m = p2MetaFor(partner, null, mesName);
  if (!(m.mA || m.mNR || m.mH)) avisos.push(P2T(
    `No hay metas cargadas para ${p2MesLabel(mesName)}: el deck sale sin cumplimiento.`,
    `No goals loaded for ${p2MesLabel(mesName)}: the deck goes out without attainment.`,
    `Цели на ${p2MesLabel(mesName)} не загружены: колода уйдёт без выполнения.`));
  // 3. Taxi y TukTuk con distinta frescura: el combinado suma un periodo que en
  //    una linea existe y en la otra no. En pantalla esto se avisa arriba del
  //    deck, fuera de las hojas — al exportar no se ve.
  if (p2FreshnessWarn()) avisos.push(P2T(
    "Taxi y TukTuk no llegan al mismo período: puede faltar subir uno de los dos.",
    "Taxi and TukTuk do not reach the same period: one of the two may be missing.",
    "Такси и ТукТук доходят до разных периодов: возможно, один из них не загружен."));
  // 4. Escala no mensual contra una meta mensual (mismo motivo que el aviso de
  //    la pestaña Metas): el % de Conductores Activos no es comparable.
  if (STATE.curMode !== "mensual") avisos.push(P2T(
    `Escala ${mi.label.toLowerCase()}: el % de Conductores Activos contra una meta MENSUAL no es comparable (es un nivel, no se acumula).`,
    `${mi.label} scale: the Active Drivers % against a MONTHLY goal is not comparable (it is a level, it does not accumulate).`,
    `Масштаб «${mi.label}»: процент активных водителей против МЕСЯЧНОЙ цели несопоставим (это уровень, он не накапливается).`));
  return { resumen, avisos, hojas: dentro.length };
}
export function p2CerrarChequeo() {
  document.getElementById("p2ExportChk")?.remove();
  document.body.classList.remove("p2-modal-abierto");
}
// Modal, no confirm(): el confirm del navegador no puede mostrar la tabla ni los
// avisos, y se acepta por reflejo. Mismo criterio que el borrado de usuarios.
export function p2AbrirChequeoExport() {
  const partner = PRESENT2_STATE.partner;
  if (!partner) { alert(P2T("Selecciona un partner primero.", "Pick a partner first.", "Сначала выберите партнёра.")); return; }
  p2CerrarChequeo();
  const C = p2ChequeoExport(partner);
  if (!C.hojas) { alert(P2T("No queda ninguna hoja seleccionada para el PDF.",
    "No sheets are selected for the PDF.", "Не выбрано ни одной страницы для PDF.")); return; }
  const div = document.createElement("div");
  div.id = "p2ExportChk";
  div.className = "p2chk-fondo";
  div.innerHTML = `<div class="p2chk">
    <div class="p2chk-h">${escapeHTML(P2T("Esto es lo que se va a exportar", "This is what will be exported", "Вот что будет экспортировано"))}</div>
    <dl class="p2chk-dl">${C.resumen.map(([k, v]) =>
      `<div><dt>${escapeHTML(k)}</dt><dd>${escapeHTML(String(v))}</dd></div>`).join("")}</dl>
    ${C.avisos.length ? `<ul class="p2chk-avisos">${C.avisos.map(a => `<li>${escapeHTML(a)}</li>`).join("")}</ul>` : ""}
    <div class="p2chk-btns">
      <button class="png-btn" data-act="p2CerrarChequeo">${escapeHTML(P2T("Cancelar", "Cancel", "Отмена"))}</button>
      <button class="apply-btn" data-act="downloadPresent2PDF">⬇ ${escapeHTML(P2T("Descargar PDF", "Download PDF", "Скачать PDF"))}</button>
    </div>
  </div>`;
  document.body.appendChild(div);
  document.body.classList.add("p2-modal-abierto");
}

export async function downloadPresent2PDF() {
  p2CerrarChequeo();
  logAccess("download_pdf", "presentacion2:" + (PRESENT2_STATE.partner || "?"));
  const partner = PRESENT2_STATE.partner;
  if (!partner) { alert("Selecciona un partner primero."); return; }
  try { await ensurePdfLibs(); } catch (e) { alert("No se pudieron cargar las librerías de PDF. Reintentá."); return; }
  destroyPresent2Charts();
  await new Promise(r => setTimeout(r, 100));

  const from = document.getElementById("dateFrom") ? document.getElementById("dateFrom").value : STATE.allDates[0];
  const to   = document.getElementById("dateTo")   ? document.getElementById("dateTo").value   : STATE.allDates[STATE.allDates.length - 1];
  // dates se calcula POR SLIDE dentro del loop (dataset-aware): Taxi y TukTuk usan
  // cada uno sus propias fechas. No calcular acá (sería siempre las de Taxi).

  const prog = document.createElement("div");
  prog.style.cssText = "position:fixed;inset:0;background:rgba(255,255,255,.95);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px";
  prog.innerHTML = `<div class="agy-style-445"></div><div id="p2Msg" class="agy-style-446">${P2T("Generando PDF...", "Generating PDF...", "Создаём PDF...")}</div>`;
  document.body.appendChild(prog);

  // Deck combinado: incluye sección Taxi + (si aplica) sección TukTuk. Se excluyen
  // las slides marcadas noPdf (Proyección: solo pantalla) y las que el KAM haya
  // desmarcado en el panel de hojas.
  const deck = p2Deck(partner).filter(p2SlideEnPdf);
  if (!deck.length) { document.body.removeChild(prog); alert(P2T(
    "No queda ninguna hoja seleccionada para el PDF.",
    "No sheets are selected for the PDF.",
    "Не выбрано ни одной страницы для PDF.")); return; }
  PRESENT2_STATE._deckLen = deck.length;
  PRESENT2_STATE._showDsBadge = p2TuktukSectionVisible(partner) && p2HasTaxi(partner);
  const savedDs = PRESENT2_STATE.dataset;
  PRESENT2_STATE._exporting = true;   // slides omiten bloques solo-vivo (ej. detalle KAM del pronóstico)
  try {
    const { jsPDF } = window.jspdf;
    // hotfixes:["px_scaling"] — bug documentado de jsPDF: sin este flag, unit:"px"
    // arrastra un factor de conversión DPI (96→72) inconsistente entre el `format`
    // de la página y las coordenadas de `addImage`, lo que puede recortar o
    // desplazar levemente el contenido dentro de la hoja.
    const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1280, 720], hotfixes: ["px_scaling"] });
    // Misma familia tipográfica que index.html/styles.css (body). Se fija explícita
    // acá también (no solo heredada) para que la exportación no dependa del font
    // por-defecto del navegador de quien exporta — Manuel pidió que el PDF se vea
    // SIEMPRE igual, sin importar desde qué máquina/navegador se genera.
    const P2_PDF_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    for (let i = 0; i < deck.length; i++) {
      const entry = deck[i], s = entry.def;
      PRESENT2_STATE.dataset = entry.ds;   // scope por-slide (los accesores leen este global)
      const dates = p2SelectedDates(from, to, STATE.curMode);   // dataset-aware por slide
      const div = document.createElement("div");
      div.setAttribute("data-p2slide", "1");
      div.style.cssText = `position:fixed;left:${s.charts ? "0" : "-9999px"};top:0;width:1280px;height:720px;overflow:hidden;background:#fff;z-index:99998;font-family:${P2_PDF_FONT}`;
      div.innerHTML = s.build(partner, dates, i);
      document.body.appendChild(div);
      await new Promise(r => setTimeout(r, 300));
      if (s.charts && s.chartFn) {
        PRESENT2_STATE.dataset = entry.ds;   // re-afirmar antes de dibujar los charts
        s.chartFn(partner, dates, div);   // acotado al div temporal
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 400));
      } else {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      // windowWidth/windowHeight fijos: sin esto, html2canvas usa el viewport REAL del
      // navegador para su cálculo interno de layout, que casi nunca es 1280x720 —
      // podía desalinear/recortar contenido según el tamaño de la ventana de quien
      // exporta. backgroundColor explícito evita cualquier borde translúcido en el
      // recorte. PNG (sin compresión JPEG) para que texto y líneas finas de los
      // charts salgan nítidos, no borrosos.
      const canvas = await html2canvas(div, {
        width: 1280, height: 720, windowWidth: 1280, windowHeight: 720,
        scale: P2_EXPORT_SCALE, useCORS: true, logging: false, backgroundColor: "#fff"
      });
      if (s.charts) {
        div.querySelectorAll("canvas").forEach(c => { const ch = Chart.getChart(c); if (ch) ch.destroy(); });
        PRESENT2_STATE.charts = [];
      }
      try { if (div.parentNode) document.body.removeChild(div); } catch (e) {}
      if (i > 0) pdf.addPage();
      // PNG (sin compresión) tirado atrás: a scale:4 el canvas es 5120×2880 y el
      // string base64 de un PNG sin comprimir de una slide con gráficos/texto
      // superaba el límite de longitud de string del motor JS ("Invalid string
      // length"). JPEG a calidad máxima da un tamaño manejable sin artefactos
      // visibles — la nitidez real ya la resuelve que devicePixelRatio del chart
      // y el scale de html2canvas coincidan (P2_EXPORT_SCALE), no el formato.
      pdf.addImage(canvas.toDataURL("image/jpeg", 1.0), "JPEG", 0, 0, 1280, 720);
    }
    stampPDF(pdf, `Presentación — ${partner}`);
    pdf.save(`${partner}_Presentacion2_${to}.pdf`);
  } catch (err) {
    console.error(err);
    alert((P2T("Error al generar PDF: ", "Error generating PDF: ", "Ошибка при создании PDF: ")) + err.message);
    document.querySelectorAll('div[data-p2slide="1"]').forEach(d => { try { d.remove(); } catch (e) {} });
  }
  PRESENT2_STATE.dataset = savedDs;   // restaurar el dataset de la vista en vivo
  PRESENT2_STATE._exporting = false;
  document.body.removeChild(prog);
  // Restaurar la vista en vivo (los charts se destruyeron al inicio)
  try { renderSlide2(); } catch (e) {}
}

// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";
import { stampPDF } from "./shared/pdfmeta.js";

registerActions({
  goSlide2:   d => goSlide2(+d.i),
  prevSlide2, nextSlide2,
  present2ToggleInclPartial, present2ToggleCity, downloadPresent2PDF,
  p2FilterPartners:     (d, el) => p2FilterPartners(el.value),
  p2SearchKeydown:      (d, el, e) => p2SearchKeydown(e),
  p2SelectPartner:      (d, el) => p2SelectPartner(el.dataset.partner),
  setPresent2Lang:      d => setPresent2Lang(d.lang),
  present2SetFleetMode: d => present2SetFleetMode(d.mode),
  present2SetAvanceMes: (d, el) => present2SetAvanceMes(el.value),
  present2TogglePdfPanel,
  p2AbrirChequeoExport, p2CerrarChequeo,
  present2TogglePdfSlide: d => present2TogglePdfSlide(d.key),
  present2PdfAll:         d => present2PdfAll(d.on === "1"),
  present2ToggleCohort: d => present2ToggleCohort(d.key),
  present2JumpSection:  d => present2JumpSection(d.section),
  p2ShowPartnerList,
  p2HidePartnerListDelayed: () => setTimeout(p2HidePartnerList, 200)
});
