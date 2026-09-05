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
         pacingFlujo, median } from "./domain/metrics.js";
import { reportYM, MES_NOMBRES } from "./shared/mesReporte.js";
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
  lang:     "es",       // es | en
  slide:    0,          // 0=Matriz, 1=Data Raw #, 2=Data Raw %
  cohort:   {},         // { t1, t23, t45, t610, t5 } activados
  cmpCity:  true,       // mostrar tendencia de ciudad
  fleetMode: "auto",    // "auto" | "fleet" | "taxi" — auto = según is_fleet del partner
  dataset:  "taxi",     // "taxi" | "tuktuk" — qué slice de partners/datos se muestra
  avanceMesSel: null,   // mes META de "Avance vs Meta": null = auto (según "Hasta")
  charts:   [],
  _renderId: 0
};

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
  { es: "Carátula",       en: "Cover",          charts: false, build: (p, d, i) => buildSlide2Cover(p, d) },
  // ✨ Resumen (ago 2026): consolida Avance Combinado + Avance vs Meta +
  // 🛺 Avance vs Meta en una hoja. Convive con los viejos A PROPÓSITO mientras
  // Manuel compara número contra número; cuando valide, los viejos se retiran
  // en un commit aparte que sea puramente de borrado.
  { es: "✨ Resumen",     en: "✨ Summary",     charts: false, build: (p, d, i) => buildSlide2Resumen(p, i) },
  { es: "✨ Ritmo del mes", en: "✨ Monthly pace", charts: false, build: (p, d, i) => buildSlide2Ritmo(p, i) },
  { es: "✨ Benchmark",    en: "✨ Benchmark",    charts: false, build: (p, d, i) => buildSlide2Benchmark(p, d, i) },
  { es: "Avance vs Meta", en: "Goal vs Target", charts: false, build: (p, d, i) => buildSlide2Avance(p, i) },
  { es: "Proyección",     en: "Forecast",       charts: true,  noPdf: true,  build: (p, d, i) => buildSlide2Forecast(p, d, i), chartFn: (p, d, root) => buildSlide2ForecastCharts(p, d, root) },
  { es: "KPIs por Nivel", en: "KPIs by Level",  charts: true,  build: (p, d, i) => buildSlide2Matrix(p, d, i), chartFn: (p, d, root) => buildSlide2MatrixCharts(p, d, root) },
  { es: "Data Raw (#)",   en: "Data Raw (#)",   charts: false, build: (p, d, i) => buildSlide2Raw(p, d, false, i) },
  { es: "Data Raw (%)",   en: "Data Raw (%)",   charts: false, build: (p, d, i) => buildSlide2Raw(p, d, true, i) },
  { es: "Alertas",        en: "Alerts",         charts: false, build: (p, d, i) => buildSlide2Alerts(p, d, i) }
];

// ── DECK COMBINADO Taxi + TukTuk (Fase 6) ─────────────────────────────────────
// Un partner puede tener sección Taxi y sección TukTuk en la MISMA presentación.
// El deck lista los slides con un tag `ds` ("taxi"|"tuktuk"); render/PDF fijan
// PRESENT2_STATE.dataset = entry.ds antes de build/chartFn (los accesores leen ese
// global) → cada slide dibuja del dataset correcto sin cambiar firmas.
// Partners tuktuk = unión de ambas escalas (semanal + mensual): así la sección
// TukTuk del deck y el selector aparecen aunque la escala activa sea la otra.
export function _p2TkPartnersAll() {
  return [...new Set([...(STATE._tuktukPartners || []), ...(STATE._tuktukMensualPartners || [])])];
}
export function p2HasTuktuk(partner) { return _p2TkPartnersAll().includes(partner); }
// Diario NO tiene slice TukTuk propio (el export diario no trae db_id, Fase F pendiente de
// datos): sin este guard, un partner TukTuk en escala Diaria generaba una sección "TukTuk"
// que en realidad mostraba datos SEMANALES (p2AllDates cae a _tuktukDates) pero rotulados
// "Diario"/"DoD"/"días" (p2ModeInfo lee STATE.curMode) — inconsistencia real de escala.
// Predicado separado de p2HasTuktuk (que solo dice "existen datos tuktuk"): esta func decide
// si la SECCIÓN se muestra en la escala activa. Un partner tuktuk-only en Diario cae al
// fallback de p2Deck (body con ds="taxi", vacío pero rotulado honesto) en vez de mostrar
// data real bajo la escala equivocada.
export function p2TuktukSectionVisible(partner) { return STATE.curMode !== "diario" && p2HasTuktuk(partner); }
export function p2HasTaxi(partner)   { return (STATE.allPartners   || []).includes(partner); }
// Lista del SELECTOR: unión taxi + tuktuk (un partner tuktuk-only debe poder elegirse).
export function p2PartnerList() {
  return [...new Set([...(STATE.allPartners || []), ..._p2TkPartnersAll()])].sort();
}
// Portada divisoria de sección (se inserta antes de la sección TukTuk).
export const P2_DIVIDER = { es: "TukTuk", en: "TukTuk", charts: false, build: (p) => buildSlide2SectionCover(p, "tuktuk") };
// Criterios del mes (TukTuk). Va SOLO en la sección TukTuk, justo después del
// divisor: es lo primero que el partner tiene que ver de esa línea, porque es lo
// que se le pide. Ver TK_META_NUEVOS_MES en rendimiento.ts (misma constante, una
// sola definición) y buildSlide2TkCriterios abajo para por qué Full Timers no está.
export const P2_TK_CRITERIOS_SLIDE = { es: "Criterios del mes", en: "Monthly criteria", charts: false, build: (p, d, i) => buildSlide2TkCriterios(p, i) };
// ✨ Criterios TukTuk (ago 2026): formato NUEVO — 24h por conductor base + meta
// de nuevos (N+R). Convive con el viejo mientras Manuel compara; cuando valide,
// el de arriba se retira en un commit puramente de borrado.
export const P2_TK_CRITERIOS2_SLIDE = { es: "✨ Criterios TukTuk", en: "✨ TukTuk Criteria", charts: false, build: (p, d, i) => buildSlide2CriteriosTk(p, i) };
// Slide de Seguimiento (Fase 3, render-only): solo si el partner tiene tareas cargadas.
// Va al final del deck y entra al PDF automáticamente (no es noPdf). Definida en seguimiento.js.
export const P2_SEG_SLIDE = { es: "Seguimiento", en: "Follow-up", charts: false, build: (p, d, i) => buildSlide2Seguimiento(p, i) };
// Avance vs Meta Combinado (Taxi+TukTuk): NO vive en P2_SLIDES a propósito — ese
// array se re-ejecuta completo para la sección Taxi Y para la TukTuk (ver body.forEach
// más abajo); si el combinado estuviera ahí, se duplicaría (una vez por sección). Se
// inserta a mano en p2Deck(), UNA sola vez, justo después de la carátula — es la vista
// rápida "cómo va TODO mi negocio", va primero, antes del detalle Taxi/TukTuk individual.
export const P2_COMBINADO_SLIDE = { es: "Avance Combinado", en: "Combined Goal", charts: false, build: (p, d, i) => buildSlide2AvanceCombinado(p, i) };
// Deck por partner: carátula + [Combinado si hay TukTuk] + [sección Taxi] + [divisor + sección TukTuk].
export function p2Deck(partner) {
  const hasTaxi = p2HasTaxi(partner);
  const showTk  = p2TuktukSectionVisible(partner);   // datos existen Y la escala activa los soporta (no Diario)
  const body = P2_SLIDES.slice(1);   // Avance, KPIs, Data Raw #, Data Raw %, Alertas
  // Cover y body por defecto van a "taxi" salvo que el partner sea tuktuk-only Y la sección
  // tuktuk sea visible en esta escala — así cover y body NUNCA quedan en datasets distintos
  // (antes: tuktuk-only en Diario podía dejar el cover en "tuktuk" con el body vacío en "taxi").
  const fallbackTaxi = hasTaxi || !showTk;
  const deck = [{ def: P2_SLIDES[0], ds: fallbackTaxi ? "taxi" : "tuktuk" }];  // carátula
  if (fallbackTaxi) {
    // Combinado solo si el partner tiene TukTuk (si no, sería idéntico al Taxi-only).
    if (showTk) deck.push({ def: P2_COMBINADO_SLIDE, ds: "taxi" });
    body.forEach(def => deck.push({ def, ds: "taxi" }));
  }
  if (showTk) {
    deck.push({ def: P2_DIVIDER, ds: "tuktuk" });
    deck.push({ def: P2_TK_CRITERIOS_SLIDE, ds: "tuktuk" });
    deck.push({ def: P2_TK_CRITERIOS2_SLIDE, ds: "tuktuk" });
    body.forEach(def => deck.push({ def, ds: "tuktuk" }));
  }
  // Seguimiento (Fase 3): al final del deck, solo si el partner tiene tareas.
  if (typeof p2PartnerHasSeguimiento === "function" && p2PartnerHasSeguimiento(partner))
    deck.push({ def: P2_SEG_SLIDE, ds: "taxi" });
  return deck;
}
// HTML del nav (prev/next + un botón por slide del deck; sección TukTuk tintada ámbar).
export function p2NavHTML() {
  const es = PRESENT2_STATE.lang === "es";
  const deck = p2Deck(PRESENT2_STATE.partner);
  const btns = deck.map((entry, i) => {
    const label = es ? entry.def.es : entry.def.en;
    const on = PRESENT2_STATE.slide === i, tk = entry.ds === "tuktuk";
    const activeBg = tk ? "#f59e0b" : "#FF0000";
    const bd = on ? activeBg : (tk ? "#fde68a" : "#e5e5e5");
    const bg = on ? activeBg : (tk ? "#fffbeb" : "#fff");
    const co = on ? "#fff" : (tk ? "#b45309" : "#555");
    return `<button data-slide2="${i}" data-act="goSlide2" data-i="${i}" style="padding:6px 14px;border-radius:6px;font-size:.78rem;font-weight:600;border:2px solid ${bd};background:${bg};color:${co};cursor:pointer">${tk ? "🛺 " : ""}${escapeHTML(label)}</button>`;
  }).join("");
  return `<button class="png-btn" data-act="prevSlide2" class="agy-style-329">◀</button>${btns}<button class="png-btn" data-act="nextSlide2" class="agy-style-329">▶</button>`;
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
  const es = PRESENT2_STATE.lang === "es";
  const m = STATE.curMode;
  if (m === "mensual") return { label: es ? "Mensual" : "Monthly", unit: es ? "Mes" : "Month", units: es ? "meses" : "months", seg: es ? "seguidos" : "in a row", pop: "MoM", color: "#0284c7" };
  if (m === "diario")  return { label: es ? "Diario"  : "Daily",   unit: es ? "Día" : "Day",   units: es ? "días" : "days",    seg: es ? "seguidos" : "in a row", pop: "DoD", color: "#a855f7" };
  return                       { label: es ? "Semanal" : "Weekly",  unit: es ? "Semana" : "Week", units: es ? "semanas" : "weeks", seg: es ? "seguidas" : "in a row", pop: "WoW", color: "#2563eb" };
}

// Alerta de FRESCURA de datos (para el KAM — se pinta en el tab, NO va al PDF).
// Si en la escala activa (mensual/semanal) el último período de Taxi y TukTuk no
// coinciden, casi siempre significa que faltó subir uno de los dos datasets (el
// KAM suele actualizar todo junto). Compara solo dentro de la misma granularidad.
export function p2FreshnessWarn() {
  const es = PRESENT2_STATE.lang === "es";
  const mensual = STATE.curMode === "mensual", semanal = STATE.curMode === "semanal";
  if (!mensual && !semanal) return "";   // diario: no hay slice TukTuk comparable
  const taxiDates = STATE.allDates || [];
  const tkDates   = mensual ? (STATE._tuktukMensualDates || []) : (STATE._tuktukDates || []);
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
  const es = PRESENT2_STATE.lang === "es";
  const total = PRESENT2_STATE._deckLen || P2_SLIDES.length;
  return `<div class="agy-style-341">
    <span>YANGO Partners · ${es ? "Confidencial" : "Confidential"}</span>
    <span>${es ? "pág" : "page"} ${(idx || 0) + 1}/${total}</span>
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
  const es = PRESENT2_STATE.lang === "es";
  const col = (STATE.partnerColors && STATE.partnerColors[partner]) || "#FF0000";
  const kam = (typeof getKAMForPartner === "function" ? getKAMForPartner(partner) : "") || "";
  const cities = p2PartnerCities(partner).map(cityLabel).join(" · ");
  // Ventana REAL que muestran las demás slides (p2SelectedDates: en mensual = tail4,
  // ignora el "Desde" crudo) — NUNCA leer #dateFrom/#dateTo directo aquí: la carátula
  // rotulaba un período distinto al que cubren KPIs por Nivel/Data Raw (bug de auditoría).
  const from = (dates && dates[0]) || (document.getElementById("dateFrom") ? document.getElementById("dateFrom").value : (p2AllDates() || [])[0]);
  const to   = (dates && dates[dates.length - 1]) || (document.getElementById("dateTo") ? document.getElementById("dateTo").value : (p2AllDates() || []).slice(-1)[0]);
  const modeLabel = es ? `Avance ${p2ModeInfo().label}` : `${p2ModeInfo().label} Update`;
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
      ${kam ? `<div class="agy-style-351">${es ? "Ejecutivo de Cuenta" : "Account Manager"}: <strong class="agy-style-352">${escapeHTML(kam)}</strong></div>` : ""}
    </div>`;
}
export function p2SlideNames() { const es = PRESENT2_STATE.lang === "es"; return P2_SLIDES.map(s => es ? s.es : s.en); }

// ── SLIDE: PORTADA DIVISORIA DE SECCIÓN (Taxi / TukTuk) ────────────────────────
// Separador visual antes de la sección TukTuk: deja claro en el PDF que las
// diapositivas siguientes son de otra flota.
export function buildSlide2SectionCover(partner, ds) {
  const es = PRESENT2_STATE.lang === "es";
  const tk = ds === "tuktuk";
  const accent = tk ? "#f59e0b" : "#FF0000";
  const emoji  = tk ? "🛺" : "🚕";
  const title  = tk ? (es ? "Sección TukTuk" : "TukTuk Section") : (es ? "Sección Taxi" : "Taxi Section");
  const sub    = es ? "Las métricas a continuación corresponden a" : "The metrics below correspond to";
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

// ── SLIDE: Criterios del mes (TukTuk) ────────────────────────────────────────
// Muestra "Nuevos conductores de adquisición propia" vs la meta del criterio.
//
// LA DEFINICIÓN ES LA LETRA CHICA: el criterio dice "de adquisición propia: no
// contempla self-registration", y esa distinción existe tal cual en la fuente —
// new_from_partner (los trae el partner, CUENTAN) vs new_from_service
// (self-registration, NO cuentan). El desglose se muestra abajo a propósito: este
// deck se le manda al partner, así que tiene que poder auditar de dónde sale el
// número en vez de recibir un total sin explicación.
//
// FULL TIMERS NO ESTÁ, y no es un olvido: la measure no existe en las 48 del
// reporte de taxiparks y NO se puede derivar de sh_per_active_driver, que es un
// PROMEDIO — el share de conductores sobre 40h necesita la distribución. Un
// promedio de 40h sale igual con todos en 40h que con la mitad en 80h y la otra
// mitad en cero. Mostrar un placeholder en un deck que ve el partner sería peor
// que no mostrarlo: se agrega cuando la fuente exponga la métrica.
export function buildSlide2TkCriterios(partner, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const META = 100;                       // = TK_META_NUEVOS_MES (criterios del mes)
  const rows  = p2RawDataset().filter(r => r.partner === partner);

  // SIEMPRE POR MES, sea cual sea la escala en la que esté navegando el KAM.
  // El criterio es "100 al mes": en semanal el último período son 7 días, y la
  // primera version mostraba "3 / 100" con un disclaimer. Como la escala por
  // defecto es Semanal, el partner recibía ese slide casi siempre — el numero
  // grande contradecía el mensaje. Ahora se agrega por MES DE REPORTE (p2ReportYM,
  // el mismo bucketing que usa Avance vs Meta: en semanal la semana cuenta en el
  // mes de su jueves), así que en semanal suma sus ~4 semanas y da el mes real.
  const porMes = new Map();
  rows.forEach(r => {
    const { y, m } = p2ReportYM(r.date);
    if (!y) return;
    const k = `${y}-${String(m).padStart(2, "0")}`;
    let e = porMes.get(k);
    if (!e) { e = { propios: 0, self: 0 }; porMes.set(k, e); }
    e.propios += r.newPartner  || 0;
    e.self    += r.newService  || 0;
  });
  const meses = [...porMes.keys()].sort();
  const last = meses[meses.length - 1], prev = meses[meses.length - 2];
  const cur  = porMes.get(last) || { propios: 0, self: 0 };
  const propios  = cur.propios, self = cur.self;
  const pPropios = prev ? (porMes.get(prev).propios) : 0;
  const total   = propios + self;
  const pctProp = total > 0 ? (propios / total) * 100 : 0;

  // Ya no hay caso "no comparable": la cifra es mensual por construcción.
  const pctMeta = Math.min(100, (propios / META) * 100);
  const col = propios >= META ? "#10b981" : propios >= META * 0.5 ? "#f59e0b" : "#FF0000";
  const delta = pPropios > 0 ? ((propios - pPropios) / pPropios) * 100 : null;
  // El mes es cerrado sólo si hay uno posterior; si es el último, va MTD.
  //
  // BUG REAL (auditoría ago 2026): `last === meses[meses.length-1]` es
  // trivialmente cierto por construcción (así se definió `last` una línea
  // arriba) — por precedencia de operadores la condición quedaba
  // `meses.length<2 || curMode!=="mensual"`, así que en mensual con ≥2 meses
  // NUNCA marcaba "mes en curso" (aunque el último mes estuviera a medias) y
  // en semanal/diario SIEMPRE lo marcaba (aunque el mes ya estuviera cerrado
  // hace tiempo). Solo afecta la etiqueta "parcial"/MTD, no el número. Fix:
  // comparar contra el mes calendario REAL — cerrado si `last` quedó en el
  // pasado, en curso si `last` es el mes actual.
  const _hoy = new Date();
  const _mesActual = `${_hoy.getFullYear()}-${String(_hoy.getMonth() + 1).padStart(2, "0")}`;
  const parcial = meses.length < 1 || last === _mesActual;

  // Evolución: últimos 6 MESES, para que se vea la tendencia y no un dato suelto.
  const ultimos = meses.slice(-6);
  const maxEvo = Math.max(META, ...ultimos.map(k => porMes.get(k).propios));
  const evo = ultimos.map(k => {
    const v = porMes.get(k).propios;
    const h = Math.max(3, Math.round((v / maxEvo) * 90));
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="font-size:.68rem;font-weight:700;color:#334155">${fmt(v)}</div>
      <div style="width:100%;height:90px;display:flex;align-items:flex-end">
        <div style="width:100%;height:${h}px;background:${v >= META ? "#10b981" : "#f59e0b"};border-radius:4px 4px 0 0"></div>
      </div>
      <div style="font-size:.6rem;color:#94a3b8">${escapeHTML(String(k))}</div>
    </div>`;
  }).join("");

  const card = (label, val, sub, color) => `
    <div style="flex:1;background:#fff;border:1px solid #e2e8f0;border-top:3px solid ${color};border-radius:10px;padding:14px 16px">
      <div style="font-size:.72rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.03em">${label}</div>
      <div style="font-size:1.9rem;font-weight:800;color:${color};margin-top:4px">${val}</div>
      <div style="font-size:.68rem;color:#94a3b8;margin-top:2px">${sub}</div>
    </div>`;

  return `
    <div style="padding:8px 4px">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
        <div style="font-size:1.35rem;font-weight:800;color:#0f172a">🛺 ${es ? "Criterios del mes" : "Monthly criteria"}</div>
        <div style="color:#94a3b8;font-size:.8rem">${escapeHTML(partner)} · ${escapeHTML(String(last || ""))}</div>
      </div>
      <div style="color:#64748b;font-size:.82rem;margin-bottom:14px">
        ${es ? "Conductores nuevos traídos por el partner. No contempla self-registration."
             : "New drivers brought in by the partner. Self-registration does not count."}
      </div>

      <div style="display:flex;gap:12px;margin-bottom:16px">
        ${card(es ? "Nuevos propios" : "Own acquisition", fmt(propios),
               (es ? "meta " : "target ") + META + (parcial ? (es ? " · mes en curso" : " · month in progress") : ""), col)}
        ${card(es ? "Self-registration" : "Self-registration", fmt(self),
               es ? "no cuenta para la meta" : "does not count", "#94a3b8")}
        ${card(es ? "% adquisición propia" : "% own acquisition", pctProp.toFixed(1) + "%",
               es ? "propios / total nuevos" : "own / total new", "#0284c7")}
        ${card(es ? "vs mes anterior" : "vs previous month",
               delta === null ? "—" : (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%",
               delta === null ? (es ? "sin base previa" : "no prior base") : "MoM",
               delta === null ? "#94a3b8" : delta >= 0 ? "#10b981" : "#FF0000")}
      </div>

      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:.75rem;font-weight:700;color:#334155;margin-bottom:6px">
          <span>${es ? "Avance vs meta" : "Progress vs target"}</span><span>${fmt(propios)} / ${META}</span>
        </div>
        <div style="background:#eef2f7;height:14px;border-radius:7px;overflow:hidden">
          <div style="width:${pctMeta}%;height:100%;background:${col}"></div>
        </div>
      </div>

      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px">
        <div style="font-size:.75rem;font-weight:700;color:#334155;margin-bottom:10px">
          ${es ? "Evolución · nuevos propios" : "Trend · own acquisition"}
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end">${evo || `<div style="color:#94a3b8;font-size:.8rem">${es ? "Sin datos" : "No data"}</div>`}</div>
      </div>
    </div>`;
}

// Bandas de cohorte (mismas que Vista Partner). range = [inicio, fin) sobre el ranking.
export const P2_BANDS = [
  { key: "t1",   range: [0, 1],  color: "#dc2626", es: "Top 1",       en: "Top 1" },
  { key: "t23",  range: [1, 3],  color: "#f59e0b", es: "Top 2-3",     en: "Top 2-3" },
  { key: "t45",  range: [3, 5],  color: "#0284c7", es: "Top 4-5",     en: "Top 4-5" },
  { key: "t610", range: [5, 10], color: "#a855f7", es: "Top 6-10",    en: "Top 6-10" },
  { key: "t5",   range: [0, 5],  color: "#10b981", es: "Prom. Top 5", en: "Avg Top 5" }
];

// ── HELPERS DE DATOS ──────────────────────────────────────────────────────────
export function destroyPresent2Charts() {
  PRESENT2_STATE.charts.forEach(c => { try { c.destroy(); } catch (e) {} });
  PRESENT2_STATE.charts = [];
}

// Dataset activo (Fase 3): "taxi" = STATE.rawData/_byCityDate (comportamiento
// idéntico a Fases 1-2); "tuktuk" = el slice paralelo (STATE.rawDataTuktuk,
// separado por el flag manual is_tuktuk, excluido del resto del dashboard).
// Índices tuktuk mode-aware: en mensual usa el slice MENSUAL (_tuktukMensual*),
// en semanal/diario el semanal. Antes siempre leía el semanal → tuktuk salía en
// BLANCO en modo mensual (buscaba claves de mes "YYYY-MM" en un índice de semanas).
// (Taxi ya es mode-aware porque _byCityDate/rawData/allDates se reconstruyen en switchMode.)
export function _p2TkMensual() { return STATE.curMode === "mensual"; }
export function p2CityDateIndex()  { return PRESENT2_STATE.dataset === "tuktuk" ? (_p2TkMensual() ? STATE._tuktukMensualByCityDate : STATE._tuktukByCityDate) : STATE._byCityDate; }
export function p2RawDataset()     { return PRESENT2_STATE.dataset === "tuktuk" ? (_p2TkMensual() ? (STATE.rawDataMensualTuktuk || []) : (STATE.rawDataTuktuk || [])) : (STATE.rawData || []); }
export function p2ActivePartners() { return PRESENT2_STATE.dataset === "tuktuk" ? (_p2TkMensual() ? (STATE._tuktukMensualPartners || []) : (STATE._tuktukPartners || [])) : (STATE.allPartners || []); }
export function p2AllDates()       { return PRESENT2_STATE.dataset === "tuktuk" ? (_p2TkMensual() ? (STATE._tuktukMensualDates || []) : (STATE._tuktukDates || [])) : (STATE.allDates || []); }

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
  const es = PRESENT2_STATE.lang === "es";
  const out = [];
  P2_BANDS.forEach(b => {
    if (!tog[b.key]) return;
    const members = ranked.slice(b.range[0], b.range[1]);
    if (!members.length) return;
    out.push({ label: es ? b.es : b.en, data: p2CohortAvg(members, scope, dates, kpiKey), color: b.color });
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
    { key: "ad",    label: es ? "Conductores Activos" : "Active Drivers",   color: "#FF0000", kind: "num" },
    { key: "nr",    label: es ? "Nuevos + Reactivados" : "New + Reactivated", color: "#f97316", kind: "num" },
    { key: "sh",    label: es ? "Horas de Conexión" : "Supply Hours",        color: "#8b5cf6", kind: "num" },
    { key: "trips", label: es ? "Viajes" : "Trips",                          color: "#10b981", kind: "num" }
  ];
}
// Variante Fleet: los 4 KPIs EXACTOS del reporte real del partner (confirmado
// por captura del usuario) — N+R, Acceptance Rate, Owned Fleet Active Cars,
// Internal Fleet SH/Auto Activo. Se QUITA AD de la matriz en modo Fleet (info
// de agregador completa sigue disponible en Data Raw y Avance).
export function p2KpiDefsFleet(es) {
  return [
    { key: "nr",                   label: es ? "Nuevos + Reactivados" : "New + Reactivated", color: "#f97316", kind: "num" },
    { key: "accept",               label: "Acceptance Rate",                                 color: "#10b981", kind: "pct" },
    { key: "ownedFleetActiveCars", label: es ? "Owned Fleet Active Cars" : "Owned Fleet Active Cars", color: "#0284c7", kind: "num" },
    { key: "shCarInt",             label: es ? "Internal Fleet SH/Auto" : "Internal Fleet SH/Car",     color: "#8b5cf6", kind: "ratio1" }
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
  const sub = es ? "Línea = partner (rojo) · gris = tendencia ciudad · punteadas = cohortes" : "Line = partner (red) · grey = city trend · dashed = cohorts";
  return `
    <div class="agy-style-365">
      ${p2BrandHeader(partner, (es ? "KPIs por Nivel" : "KPIs by Level") + " · " + d2s(from) + " → " + d2s(to), sub)}
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
// Labels espejados al ES/EN de p2KpiDefs (matriz) y buildSlide2Avance — la MISMA métrica
// debe llamarse igual en todo el deck. Antes solo "Retención" traducía; el resto quedaba en
// inglés fijo aun con lang=es (inconsistente con KPIs por Nivel/Avance, que sí traducen).
// `grp` agrupa las columnas bajo una cabecera de sección (Volumen / Eficiencia
// / Flota) — misma información, pero la tabla deja de ser una tira de 15
// columnas indistintas: el ojo encuentra primero el bloque y después el dato.
// Pedido de Manuel (ago 2026): agrupar, NO recortar — el partner no tiene
// acceso al CSV y esta tabla es su única fuente.
export function p2RawCols(es) {
  return [
    { key: "trips", label: es ? "Viajes" : "Trips",                 kind: "num", grp: "vol" },
    { key: "sh",    label: es ? "Horas de Conexión" : "Supply Hours", kind: "num", grp: "vol" },
    { key: "ad",    label: es ? "Conductores Activos" : "Active Drivers", kind: "num", grp: "vol" },
    { key: "newd",  label: es ? "Nuevos" : "New Drivers",           kind: "num", grp: "vol" },
    { key: "react", label: es ? "Reactivados" : "Reactivated",      kind: "num", grp: "vol" },
    { key: "nr",    label: "N+R",              kind: "num", grp: "vol" },
    { key: "comm",  label: es ? "Comisión Partner" : "Partner Commission", kind: "money", grp: "vol" },
    { key: "ret",   label: es ? "Retención" : "Retention", kind: "pct", grp: "efi" },
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
    { key: "shCarInt",             label: es ? "Internal Fleet SH/Auto" : "Internal Fleet SH/Car",     kind: "ratio1", grp: "fleet" },
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
    const GRP_LBL = { vol: es ? "Volumen" : "Volume", efi: es ? "Eficiencia" : "Efficiency", fleet: es ? "Flota" : "Fleet" };
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
  const title = pct ? (es ? `Data Raw · Variación % (${_mi.pop})` : `Data Raw · % change (${_mi.pop})`) : (es ? "Data Raw · Valores" : "Data Raw · Values");
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
  const { daysElapsed, daysRemaining } = calcProjectionDays(lastDate);
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
// Mismos rangos que pColor() (data.js), usado en Metas/Ops/Insights: >100 morado,
// >=80 verde, >=50 amarillo, <50 rojo. Antes esta función tenía su propio corte en
// 80/100 (todo <80 salía rojo) — desalineado con el resto del dashboard.
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
    <div class="agy-style-380">${es ? "Referencia (sin meta)" : "Reference (no target)"}</div>
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
    ${ppct != null ? `<div class="agy-style-388">${es ? "proy" : "proj"} ${fmtN(projV)} (${ppct.toFixed(0)}%)</div>` : ""}
  </div>`;
}
// Tarjeta solo-meta (sin actual medible, ej. Utilización Fleet).
export function _p2MetaOnlyCard(label, goal, fmtN, note, es) {
  return `<div class="agy-style-389">
    <span class="agy-style-390">${escapeHTML(label)}</span>
    <div class="agy-style-379">${fmtN(goal)}</div>
    <div class="agy-style-391">${es ? "meta" : "target"}${note ? " · " + note : ""}</div>
  </div>`;
}

// % honesto: NO redondear 99.5-99.99 a "100%" (parecería meta cumplida sin estarlo).
// <100 → 1 decimal (99.6%); ≥100 → entero (106%). Espeja el criterio de la pestaña Metas.
export function _p2PctTxt(pct) { return (pct >= 100 ? pct.toFixed(0) : Math.min(pct, 99.9).toFixed(1)) + "%"; }

export function buildSlide2Avance(partner, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const isTk = PRESENT2_STATE.dataset === "tuktuk";   // TukTuk: metas meta_tk_* (Fase 4)
  const fleetMode = p2IsFleetMode(partner);
  const mesName = p2AvanceMes();
  const monthDates = p2MonthDates(mesName);
  const lastDate = monthDates.length ? monthDates[monthDates.length - 1] : p2AllDates().slice(-1)[0];
  const levels = p2Levels(partner);
  // Necesita fechas del mes META + metas cargadas. Si hay metas pero el mes elegido no
  // tiene datos (≤ Hasta), NO se muestran actuals de otro mes: se avisa "sin datos del mes".
  const metasLoaded = !!(STATE.metasData || []).length;
  const noMonthData = metasLoaded && !monthDates.length;
  const noData = !monthDates.length || !metasLoaded;
  // TukTuk usa metas meta_tk_* (AD/N+R/Brandeados); Taxi usa meta_active_drivers/nr/sh.
  // `snap` marca métricas SNAPSHOT (nivel actual, no acumuladas): su "fact" es el ÚLTIMO
  // período visible (lastAD/lastCars), NO el máximo del mes — así el número coincide con
  // la última semana (KPIs por Nivel) y con la proyección, en vez de sobre-mostrar el pico.
  const metricDefs = isTk ? [
    { mk: "mtkAD",   ak: "ad",   snap: "lastAD",   label: es ? "Conductores Activos" : "Active Drivers", kind: "num" },
    { mk: "mtkNR",   ak: "nr",   label: es ? "Nuevos + Reactivados" : "New + React",   kind: "num" },
    { mk: "mtkCars", ak: "cars", snap: "lastCars", label: es ? "Brandeados" : "Branded",                 kind: "num" }
  ] : [
    { mk: "mA",  ak: "ad", snap: "lastAD", label: es ? "Conductores Activos" : "Active Drivers", kind: "num"  },
    { mk: "mNR", ak: "nr", label: es ? "Nuevos + Reactivados" : "New + React",   kind: "num"  },
    { mk: "mH",  ak: "sh", label: es ? "Horas de Conexión" : "Supply Hours",     kind: "numK" }
  ];
  // KPIs Fleet (Fase 4): Aceptación y SH/Auto con meta real si está cargada (meta_acceptance
  // / meta_sh_car); Utilización solo meta; Owned Cars como referencia. Ver bloque fleetMode.
  const rows = levels.map(lv => {
    const act = p2ActualsMTD(partner, lv.city, monthDates);
    if (isTk) {   // Brandeados: snapshot → ÚLTIMO período (Σ ciudades en la última fecha)
      const carsV = p2Vals(partner, lv.city, monthDates, r => r.brandedActiveCars || 0);
      act.lastCars = carsV.length ? carsV[carsV.length - 1] : 0;
      act.cars     = act.lastCars;   // compat
    }
    const proj = p2ProjMTD(act, lastDate);
    if (isTk) proj.cars = act.lastCars;   // snapshot: proyección = nivel actual
    // Metas reales de STATE.metasData (agregador: mA/mNR/mH · TukTuk: mtk*).
    const meta = p2MetaFor(partner, lv.city, mesName);
    // Jerarquía (ago 2026): las tarjetas CON meta son el mensaje del slide y
    // van en la fila principal; las de referencia/"sin meta" son contexto y
    // van en una fila secundaria más compacta. Antes convivían al mismo rango
    // visual y el ojo no sabía cuál era el avance y cuál el dato decorativo.
    const metaCards = [], refCards = [];
    metricDefs.forEach(m => {
      // Snapshot (AD/Cars) → último período; acumuladas (N+R/SH) → total del mes.
      const real = m.snap ? (act[m.snap] != null ? act[m.snap] : act[m.ak]) : act[m.ak];
      const goal = meta[m.mk] || 0, projV = proj[m.ak];
      const fmtN = m.kind === "numK" ? fmtSmart : fmt;
      if (!goal) {
        const subTxt = es ? "Sin meta" : "No target";
        refCards.push(`<div class="agy-style-392">
          <div class="agy-style-383">${escapeHTML(m.label)}</div>
          <div class="agy-style-379">${fmtN(real)}</div>
          <div class="agy-style-393">${subTxt}</div></div>`);
        return;
      }
      const pct = (real / goal) * 100, ppct = (projV / goal) * 100, col = p2AvanceColor(pct);
      metaCards.push(`<div class="agy-style-381">
        <div class="agy-style-382">
          <span class="agy-style-383">${escapeHTML(m.label)}</span>
          <span style="font-size:.74rem;font-weight:800;color:${col}">${_p2PctTxt(pct)}</span>
        </div>
        <div class="agy-style-384">
          <span class="agy-style-385">${fmtN(real)}</span>
          <span class="agy-style-386">/ ${fmtN(goal)}</span>
        </div>
        <div class="agy-style-387">
          ${ppct > pct ? `<div style="position:absolute;top:0;left:0;height:100%;width:${Math.min(Math.max(ppct, 0), 100).toFixed(1)}%;background:${p2AvanceColor(ppct)};opacity:.35;border-radius:5px"></div>` : ""}
          <div style="position:absolute;top:0;left:0;height:100%;width:${Math.min(pct, 100).toFixed(1)}%;background:${col};border-radius:5px"></div>
          ${ppct != null ? `<div class="p2-proj-tick" style="left:calc(${Math.min(Math.max(ppct, 0), 100).toFixed(1)}% - 1px)"></div>` : ""}
        </div>
        <div class="agy-style-388">${es ? "proy" : "proj"} ${fmtN(projV)} (${_p2PctTxt(ppct)})</div>
      </div>`);
    });
    if (fleetMode) {
      const fs = p2FleetSeries(partner, lv.city, monthDates);
      const lastOf = arr => (arr && arr.length) ? arr[arr.length - 1] : null;
      // Las tasas Fleet (aceptación, SH/auto) NO se promedian entre ciudades sin ponderar,
      // así que la comparación meta-vs-actual SOLO se muestra POR CIUDAD. A nivel Perú-general
      // (lv.city null) se muestran como REFERENCIA (sin %), igual que hace la pestaña Metas
      // (que no agrega Fleet a Perú). Evita "actual ponderado ÷ meta de una ciudad" engañoso.
      const perCity = lv.city != null;
      const accA = lastOf(fs.accept);     // 0-1 o null
      const shcA = lastOf(fs.shCarInt);   // ratio o null
      // Aceptación: meta real por ciudad SOLO si hay meta Y actual con dato; si no, referencia (— si null).
      if (perCity && meta.mAcc != null && accA != null)
        metaCards.push(_p2MetaCard(es ? "Aceptación" : "Acceptance", accA * 100, meta.mAcc, null, v => fmt(v) + "%", es));
      else refCards.push(p2RefCard(es ? "Acceptance Rate" : "Acceptance Rate", fs.accept, "pct", es));
      // SH/Auto interno:
      if (perCity && meta.mSHcar != null && shcA != null)
        metaCards.push(_p2MetaCard(es ? "SH/Auto (interno)" : "Internal SH/Car", shcA, meta.mSHcar, null, v => fmt(v), es));
      else refCards.push(p2RefCard(es ? "Internal Fleet SH/Auto" : "Internal Fleet SH/Car", fs.shCarInt, "ratio1", es));
      // Utilización: solo meta, solo por ciudad (sin actual medible) — es contexto, va secundaria.
      if (perCity && meta.mUtil != null) refCards.push(_p2MetaOnlyCard(es ? "Utilización" : "Utilization", meta.mUtil, v => fmt(v) + "%", es ? "sin actual" : "no actual", es));
      // Owned Fleet Active Cars: referencia (sin meta en BD).
      refCards.push(p2RefCard(es ? "Owned Fleet Active Cars" : "Owned Fleet Active Cars", fs.ownedFleetActiveCars, "num", es));
    }
    // Sin ninguna tarjeta con meta, las referencias suben a la fila principal
    // (una fila secundaria sola parecería un slide en borrador).
    const primary = metaCards.length ? metaCards : refCards;
    const secondary = metaCards.length ? refCards : [];
    return `<div style="display:flex;gap:8px;flex:1 1 0;min-height:0;max-height:230px;border-left:3px solid ${lv.color};padding-left:8px;align-items:stretch">
      <div class="agy-style-394"><span style="font-weight:800;font-size:.82rem;color:${lv.color}">${escapeHTML(lv.label)}</span></div>
      <div class="p2-lvl-cards">
        <div class="p2-lvl-primary">${primary.join("")}</div>
        ${secondary.length ? `<div class="p2-lvl-secondary">${secondary.join("")}</div>` : ""}
      </div>
    </div>`;
  }).join("");
  const avTitle = isTk
    ? (es ? "Avance vs Meta TukTuk" : "TukTuk Goal vs Target")
    : (es ? "Avance vs Meta del mes" : "Goal vs Target");
  const avSub = es
    ? "Actual vs meta · barra = avance · marca ▏= proyección"
    : "Actual vs goal · bar = progress · ▏mark = projection";
  const noDataMsg = noMonthData
    ? (es ? `Sin datos de ${escapeHTML(mesName)} para comparar con la meta.` : `No data for ${escapeHTML(mesName)} to compare.`)
    : isTk
      ? (es ? "Sin metas TukTuk para este mes." : "No TukTuk goals for this month.")
      : (es ? "Sin metas cargadas para este mes." : "No goals loaded for this month.");
  return `<div class="agy-style-365">
    ${p2BrandHeader(partner, avTitle + " · " + (mesName || "—"), avSub)}
    ${noData
      ? `<div class="agy-style-396">${noDataMsg}</div>`
      : `<div class="agy-style-366">${rows}</div>`}
    ${p2BrandFooter(idx)}
  </div>`;
}

// ── SLIDE: AVANCE VS META COMBINADO (Taxi + TukTuk) ───────────────────────────
// Vista rápida "cómo va TODO mi negocio": suma Conductores Activos, N+R y Horas de
// Conexión de Taxi + TukTuk contra la meta combinada (meta Taxi + meta TukTuk).
// Solo Perú-general (sin desglose por ciudad — eso ya existe por separado en las
// slides Taxi/TukTuk individuales). Se inserta UNA VEZ en el deck vía p2Deck(), NO
// vía P2_SLIDES (ese array se re-ejecuta completo para la sección Taxi Y para la
// TukTuk — agregarla ahí la duplicaría). Solo aparece para partners con TukTuk
// (p2TuktukSectionVisible) — sin TukTuk, "combinado" sería idéntico a Taxi-only.
export function buildSlide2AvanceCombinado(partner, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const savedDs = PRESENT2_STATE.dataset;   // restaurar antes de salir (accessors globales)

  const mesName = p2AvanceMes();   // dataset-agnóstico (lee metasData + "Hasta")

  PRESENT2_STATE.dataset = "taxi";
  const taxiDates = p2MonthDates(mesName);
  const taxiLastDate = taxiDates.length ? taxiDates[taxiDates.length - 1] : p2AllDates().slice(-1)[0];
  const taxiAct  = p2ActualsMTD(partner, null, taxiDates);
  const taxiProj = p2ProjMTD(taxiAct, taxiLastDate);

  PRESENT2_STATE.dataset = "tuktuk";
  const tkDates = p2MonthDates(mesName);
  const tkLastDate = tkDates.length ? tkDates[tkDates.length - 1] : p2AllDates().slice(-1)[0];
  const tkAct  = p2ActualsMTD(partner, null, tkDates);
  const tkProj = p2ProjMTD(tkAct, tkLastDate);

  PRESENT2_STATE.dataset = savedDs;   // restaurar YA — antes de cualquier early-return

  const meta = p2MetaFor(partner, null, mesName);   // dataset-agnóstico (mA/mNR/mH + mtkAD/mtkNR/mtkSH)
  const metasLoaded = !!(STATE.metasData || []).length;
  const noMonthData = metasLoaded && !taxiDates.length && !tkDates.length;
  const noData = (!taxiDates.length && !tkDates.length) || !metasLoaded;

  // Proyección de AD COMBINADA: la serie taxi+tk se suma POR FECHA y se
  // proyecta el máximo de ESA serie (×1.4) — sumar la proyección de cada
  // línea (máx(taxi)+máx(tk)) sobre-estima siempre que cada línea picó en
  // semanas distintas: "una proyección de snapshot no se suma hacia arriba"
  // (caso Lizzo, jul 2026), la misma regla que aplica Metas Combinado.
  const _combAdByDate = new Map();
  taxiDates.forEach((d, i) => _combAdByDate.set(d, (_combAdByDate.get(d) || 0) + (taxiAct.adV[i] || 0)));
  tkDates.forEach((d, i)   => _combAdByDate.set(d, (_combAdByDate.get(d) || 0) + (tkAct.adV[i]   || 0)));
  const _combKeys = [..._combAdByDate.keys()].sort();
  const _combProjAD = projAD(_combKeys.map(d => _combAdByDate.get(d)), _combKeys[_combKeys.length - 1]);

  // META PARAGUAS — mA/mNR/mH YA INCLUYEN TukTuk, no se les suma meta_tk_*.
  //
  // Verificado contra producción (ago 2026): en los partners con meta TukTuk, la
  // razón meta_tk_ad/meta_active_drivers coincide con la participación real de
  // TukTuk sobre el TOTAL, no sobre el taxi (Flota Pe 17,2% vs 17,2% real).
  // Corrobora la Calculadora, que reparte cuotas sobre base combinada.
  //
  // Antes se sumaban (mA + mtkAD) y la meta salía inflada: TRANSPOTAXI Lima
  // mostraba 3.785 en vez de 2.661 → 60% de avance cuando el real era 86%.
  // Además meta_tk_* quedó OBSOLETA (Manuel, ago 2026): TukTuk ya no se mide
  // con metas de AD/N+R/SH propias sino con criterios (24h por conductor base
  // + meta de nuevos). Estas columnas no se leen más acá.
  const defs = [
    { label: es ? "Conductores Activos" : "Active Drivers",
      // FACT = snapshot del último período de cada línea, sumados. PROYECCIÓN =
      // sobre la serie combinada (ver arriba).
      real: taxiAct.lastAD + tkAct.lastAD, proj: _combProjAD,
      goal: meta.mA || 0, fmtN: fmt },
    { label: es ? "Nuevos + Reactivados" : "New + React",
      real: taxiAct.nr + tkAct.nr, proj: taxiProj.nr + tkProj.nr,
      goal: meta.mNR || 0, fmtN: fmt },
    { label: es ? "Horas de Conexión" : "Supply Hours",
      real: taxiAct.sh + tkAct.sh, proj: taxiProj.sh + tkProj.sh,
      goal: meta.mH || 0, fmtN: fmtSmart }
  ];
  const cards = defs.map(d => d.goal > 0
    ? _p2MetaCard(d.label, d.real, d.goal, d.proj, d.fmtN, es)
    : `<div class="agy-style-392">
        <div class="agy-style-383">${escapeHTML(d.label)}</div>
        <div class="agy-style-379">${d.fmtN(d.real)}</div>
        <div class="agy-style-393">${es ? "Sin meta" : "No target"}</div>
      </div>`
  ).join("");

  const title = es ? "Avance vs Meta Combinado" : "Combined Goal vs Target";
  const sub   = es
    ? "Taxi + TukTuk sumados · barra = avance · marca ▏= proyección"
    : "Taxi + TukTuk combined · bar = progress · ▏mark = projection";
  const noDataMsg = noMonthData
    ? (es ? `Sin datos de ${escapeHTML(mesName)} para comparar con la meta.` : `No data for ${escapeHTML(mesName)} to compare.`)
    : (es ? "Sin metas cargadas para este mes." : "No goals loaded for this month.");

  return `<div class="agy-style-365">
    ${p2BrandHeader(partner, title + " · " + (mesName || "—"), sub, { text: es ? "🔀 COMBINADO" : "🔀 COMBINED", color: "#8b5cf6" })}
    ${noData
      ? `<div class="agy-style-396">${noDataMsg}</div>`
      : `<div class="agy-style-397">${cards}</div>`}
    ${p2BrandFooter(idx)}
  </div>`;
}

// ── SLIDE: RESUMEN / SCORECARD (ago 2026) ─────────────────────────────────────
// Consolida en UNA hoja lo que hoy toma tres (Avance Combinado + Avance vs Meta
// + 🛺 Avance vs Meta). Responde de un vistazo: ¿cómo voy, en qué ciudad, y en
// qué categoría?
//
// Dos zonas separadas A PROPÓSITO, porque no todo se mide igual:
//   1. CUMPLIMIENTO — solo donde hay meta. La meta paraguas (mA/mNR/mH) cubre
//      Taxi + TukTuk juntos, así que el actual que se compara es la SUMA de
//      ambos. No se le suma meta_tk_* (obsoleta, ver buildSlide2AvanceCombinado).
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

export function buildSlide2Resumen(partner, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const savedDs = PRESENT2_STATE.dataset;
  const mesName = p2AvanceMes();

  // Actuales por vertical. Taxi y TukTuk salen de los accesores del deck
  // (mismo camino que las slides existentes → los números tienen que coincidir);
  // Delivery y Cargo, de sus slices propios.
  PRESENT2_STATE.dataset = "taxi";
  const taxiDates = p2MonthDates(mesName);
  const levels = p2Levels(partner);
  PRESENT2_STATE.dataset = "tuktuk";
  const tkDates = p2MonthDates(mesName);
  PRESENT2_STATE.dataset = savedDs;

  const dates = taxiDates.length ? taxiDates : tkDates;
  const metasLoaded = !!(STATE.metasData || []).length;
  const noData = !dates.length || !metasLoaded;

  // ── Zona 1: cumplimiento del paraguas por ciudad ──────────────────────────
  const filaCumpl = (lv) => {
    PRESENT2_STATE.dataset = "taxi";
    const aTx = p2ActualsMTD(partner, lv.city, taxiDates);
    PRESENT2_STATE.dataset = "tuktuk";
    const aTk = p2ActualsMTD(partner, lv.city, tkDates);
    PRESENT2_STATE.dataset = savedDs;
    const meta = p2MetaFor(partner, lv.city, mesName);
    // Paraguas = Taxi + TukTuk (lo que la meta cubre). Delivery/Cargo quedan
    // fuera: la meta no los incluye.
    const ad = (aTx.lastAD || 0) + (aTk.lastAD || 0);
    const nr = (aTx.nr || 0) + (aTk.nr || 0);
    const sh = (aTx.sh || 0) + (aTk.sh || 0);
    return `<tr>
      <td class="sc-lvl"><span class="sc-dot" style="background:${lv.color}"></span>${escapeHTML(lv.label)}</td>
      ${_scCell(ad, meta.mA  || 0, fmt)}
      ${_scCell(nr, meta.mNR || 0, fmt)}
      ${_scCell(sh, meta.mH  || 0, fmtSmart)}
    </tr>`;
  };

  // ── Zona 2: composición por vertical (Perú) ───────────────────────────────
  const VERTS = [
    { key: "taxi",     label: "Taxi",     color: "#FF0000" },
    { key: "tuktuk",   label: "TukTuk",   color: "#f59e0b" },
    { key: "delivery", label: "Delivery", color: "#0284c7" },
    { key: "cargo",    label: "Cargo",    color: "#8b5cf6" }
  ];
  const compFilas = VERTS.map(v => {
    let t;
    if (v.key === "taxi") {
      PRESENT2_STATE.dataset = "taxi";  t = p2ActualsMTD(partner, null, taxiDates); t.presente = !!taxiDates.length;
      PRESENT2_STATE.dataset = savedDs;
    } else if (v.key === "tuktuk") {
      PRESENT2_STATE.dataset = "tuktuk"; t = p2ActualsMTD(partner, null, tkDates); t.presente = !!tkDates.length;
      PRESENT2_STATE.dataset = savedDs;
    } else {
      t = p2VerticalTotals(p2SliceVertical(v.key), partner, null, dates);
    }
    const ad = t.lastAD != null ? t.lastAD : t.ad;
    if (!t.presente && !ad && !t.nr && !t.sh) return "";   // vertical que el partner no opera
    return `<tr>
      <td class="sc-lvl"><span class="sc-dot" style="background:${v.color}"></span>${v.label}</td>
      <td class="sc-num"><span class="sc-val">${fmt(ad)}</span></td>
      <td class="sc-num"><span class="sc-val">${fmt(t.nr)}</span></td>
      <td class="sc-num"><span class="sc-val">${fmtSmart(t.sh)}</span></td>
    </tr>`;
  }).filter(Boolean).join("");

  const th = `<tr><th></th>
    <th>${es ? "Conductores Activos" : "Active Drivers"}</th>
    <th>${es ? "Nuevos + Reactivados" : "New + React"}</th>
    <th>${es ? "Horas de Conexión" : "Supply Hours"}</th></tr>`;

  const cuerpo = noData
    ? `<div class="agy-style-396">${es ? `Sin datos de ${escapeHTML(mesName || "")} para comparar con la meta.` : "No data for this month."}</div>`
    : `
      <div class="sc-zona">
        <div class="sc-zona-tit">${es ? "Cumplimiento vs meta del mes" : "Goal attainment"}
          <span class="sc-zona-sub">${es ? "Taxi + TukTuk — la meta cubre las dos" : "Taxi + TukTuk — the goal covers both"}</span></div>
        <table class="sc-tbl"><thead>${th}</thead><tbody>${levels.map(filaCumpl).join("")}</tbody></table>
      </div>
      <div class="sc-zona">
        <div class="sc-zona-tit">${es ? "Composición por categoría" : "Breakdown by category"}
          <span class="sc-zona-sub">${es ? "Perú · Delivery y Cargo aún sin meta" : "Peru · Delivery and Cargo have no goal yet"}</span></div>
        <table class="sc-tbl"><thead>${th}</thead><tbody>${compFilas}</tbody></table>
      </div>`;

  return `<div class="agy-style-365">
    ${p2BrandHeader(partner, (es ? "Resumen" : "Summary") + " · " + (mesName || "—"),
      es ? "Cumplimiento del mes y de dónde viene" : "Monthly attainment and where it comes from")}
    <div class="sc-wrap">${cuerpo}</div>
    ${p2BrandFooter(idx)}
  </div>`;
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

// Mes (YYYY-MM) sobre el que se evalúan los criterios: el del "Hasta" del
// filtro, para que coincida con el resto del deck.
export function p2TkCriteriosYM() {
  const to = document.getElementById("dateTo")?.value || "";
  if (to) return String(to).slice(0, 7);
  const ds = (STATE._tuktukMensualDates || []);
  return ds.length ? String(ds[ds.length - 1]).slice(0, 7) : "";
}

export function buildSlide2CriteriosTk(partner, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const ym = p2TkCriteriosYM();
  // Etiqueta del mes desde el YYYY-MM (P2_MES_NOMBRES ya está en el archivo).
  const mesTxt = ym ? `${P2_MES_NOMBRES[+ym.slice(5, 7) - 1] || ym} ${ym.slice(0, 4)}` : "—";

  const savedDs = PRESENT2_STATE.dataset;
  PRESENT2_STATE.dataset = "tuktuk";
  const levels = p2Levels(partner);
  PRESENT2_STATE.dataset = savedDs;

  const meta = p2MetaFor(partner, null, p2AvanceMes());
  const metaNuevos = meta.mtkNR || 0;

  const pais = p2TkCriteriosDatos(partner, null, ym);
  const h = horasPorConductorBase(pais.sh, pais.ad, pais.nuevos, pais.react);

  if (!pais.hay) {
    return `<div class="agy-style-365">
      ${p2BrandHeader(partner, (es ? "Criterios TukTuk" : "TukTuk Criteria") + " · " + mesTxt, "")}
      <div class="agy-style-396">${es
        ? "Sin datos mensuales de TukTuk para evaluar los criterios."
        : "No monthly TukTuk data to evaluate the criteria."}</div>
      ${p2BrandFooter(idx)}
    </div>`;
  }

  // Criterio 1 — horas por conductor base. Los estados "no aplica" se explican
  // en pantalla: un partner chico no puede leer un guion sin saber por qué.
  const AVISO = {
    pocos_activos: es
      ? `No aplica: menos de ${TK_MIN_ACTIVOS} conductores activos en el mes (${fmt(pais.ad)}). Con esa muestra el promedio no es representativo.`
      : `Not applicable: fewer than ${TK_MIN_ACTIVOS} active drivers this month (${fmt(pais.ad)}). The average is not representative at that size.`,
    sin_base: es
      ? "No medible: todos los conductores activos del mes son nuevos o reactivados, así que no hay base sobre la cual promediar."
      : "Not measurable: every active driver this month is new or reactivated, so there is no base to average over."
  };
  const noAplica = h.valor == null;
  const col1 = noAplica ? "#888" : (h.estado === "cumple" ? "#10b981" : "#FF0000");
  const card1 = `
    <div class="tkc-card ${noAplica ? "tkc-na" : ""}">
      <div class="tkc-lbl">${es ? "Horas por conductor base" : "Hours per base driver"}</div>
      <div class="tkc-val" style="color:${col1}">${noAplica ? "—" : h.valor.toFixed(1) + " h"}</div>
      <div class="tkc-meta">${es ? "mínimo" : "minimum"} ${TK_HORAS_BASE_MIN} h</div>
      <div class="tkc-form">${es
        ? "horas conectadas ÷ (activos − nuevos − reactivados)"
        : "connected hours ÷ (active − new − reactivated)"}${
        // La base solo se muestra cuando el criterio APLICA: si no aplica puede
        // ser negativa (base -222) y ese número no significa nada para el partner.
        noAplica ? "" : ` · base ${fmt(h.base)}`}</div>
      ${noAplica ? `<div class="tkc-aviso">${escapeHTML(AVISO[h.estado] || "")}</div>`
                 : `<div class="tkc-veredicto" style="color:${col1}">${h.estado === "cumple"
                      ? (es ? "✓ Cumple" : "✓ Meets") : (es ? "✗ No cumple" : "✗ Does not meet")}</div>`}
    </div>`;

  // Criterio 2 — nuevos + reactivados vs meta del KAM.
  const pct2 = metaNuevos > 0 ? (pais.nr / metaNuevos) * 100 : null;
  const col2 = pct2 == null ? "#888" : p2AvanceColor(pct2);
  const card2 = `
    <div class="tkc-card ${metaNuevos > 0 ? "" : "tkc-na"}">
      <div class="tkc-lbl">${es ? "Nuevos + Reactivados" : "New + Reactivated"}</div>
      <div class="tkc-val" style="color:${col2}">${fmt(pais.nr)}</div>
      <div class="tkc-meta">${metaNuevos > 0
        ? `${es ? "meta" : "target"} ${fmt(metaNuevos)}`
        : (es ? "sin meta cargada" : "no target loaded")}</div>
      <div class="tkc-form">${es
        ? `${fmt(pais.nuevos)} nuevos + ${fmt(pais.react)} reactivados`
        : `${fmt(pais.nuevos)} new + ${fmt(pais.react)} reactivated`}</div>
      ${metaNuevos > 0
        ? `<div class="tkc-veredicto" style="color:${col2}">${_p2PctTxt(pct2)} ${es ? "de la meta" : "of target"}</div>`
        : `<div class="tkc-aviso">${es
            ? "Tu KAM carga esta meta al inicio del mes. Sin meta cargada solo se muestra el volumen."
            : "Your KAM sets this target at the start of the month. Without it, only the volume is shown."}</div>`}
    </div>`;

  // Detalle por ciudad — cada una con su propio estado (una ciudad chica puede
  // no aplicar aunque el país sí).
  const filas = levels.filter(lv => lv.city).map(lv => {
    const d = p2TkCriteriosDatos(partner, lv.city, ym);
    if (!d.hay) return "";
    const hc = horasPorConductorBase(d.sh, d.ad, d.nuevos, d.react);
    const na = hc.valor == null;
    const c  = na ? "#888" : (hc.estado === "cumple" ? "#10b981" : "#FF0000");
    const motivo = na
      ? (hc.estado === "pocos_activos"
          ? (es ? `menos de ${TK_MIN_ACTIVOS} activos` : `under ${TK_MIN_ACTIVOS} active`)
          : (es ? "sin base" : "no base"))
      : "";
    return `<tr>
      <td class="sc-lvl"><span class="sc-dot" style="background:${lv.color}"></span>${escapeHTML(lv.label)}</td>
      <td class="sc-num"><span class="sc-val">${fmt(d.ad)}</span></td>
      <td class="sc-num"><span class="sc-val">${fmt(d.nr)}</span></td>
      <td class="sc-num">
        <span class="sc-val" style="color:${c}">${na ? "—" : hc.valor.toFixed(1) + " h"}</span>
        ${motivo ? `<span class="sc-sub">${escapeHTML(motivo)}</span>` : ""}
      </td>
    </tr>`;
  }).filter(Boolean).join("");

  return `<div class="agy-style-365">
    ${p2BrandHeader(partner, (es ? "Criterios TukTuk" : "TukTuk Criteria") + " · " + mesTxt,
      es ? "Esto es lo que te pedimos cada mes" : "This is what we ask for each month",
      { text: "🛺 TUKTUK", color: "#f59e0b" })}
    <div class="tkc-wrap">
      <div class="tkc-cards">${card1}${card2}</div>
      ${filas ? `<div class="sc-zona">
        <div class="sc-zona-tit">${es ? "Detalle por ciudad" : "By city"}</div>
        <table class="sc-tbl"><thead><tr><th></th>
          <th>${es ? "Activos" : "Active"}</th>
          <th>${es ? "Nuevos + React" : "New + React"}</th>
          <th>${es ? "Horas / base" : "Hours / base"}</th></tr></thead>
          <tbody>${filas}</tbody></table>
      </div>` : ""}
    </div>
    ${p2BrandFooter(idx)}
  </div>`;
}

// ── SLIDE: RITMO DEL MES (ago 2026) ───────────────────────────────────────────
// Las metas son MENSUALES pero la conversación con el partner es SEMANAL, así
// que la pregunta útil a mitad de mes no es "¿cumpliste?" sino "¿vas
// encaminado?". Este slide compara el avance contra el calendario.
//
// SOLO para FLUJOS (N+R, horas). Active Drivers NO entra en el ritmo: es un
// SNAPSHOT, no se acumula — estar al 60% del mes no significa que el AD deba ir
// al 60% de la meta, ya debería estar cerca de su nivel final. Meterlo acá
// mostraría un "atraso" inventado. Se muestra aparte, como nivel.
export function buildSlide2Ritmo(partner, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const savedDs = PRESENT2_STATE.dataset;
  const mesName = p2AvanceMes();

  PRESENT2_STATE.dataset = "taxi";
  const taxiDates = p2MonthDates(mesName);
  const taxiAct = p2ActualsMTD(partner, null, taxiDates);
  PRESENT2_STATE.dataset = "tuktuk";
  const tkDates = p2MonthDates(mesName);
  const tkAct = p2ActualsMTD(partner, null, tkDates);
  PRESENT2_STATE.dataset = savedDs;

  const dates = taxiDates.length ? taxiDates : tkDates;
  const lastDate = dates.length ? dates[dates.length - 1] : (p2AllDates() || []).slice(-1)[0];
  const { daysElapsed, daysInMonth } = calcProjectionDays(lastDate);
  const meta = p2MetaFor(partner, null, mesName);
  const metasLoaded = !!(STATE.metasData || []).length;

  if (!dates.length || !metasLoaded) {
    return `<div class="agy-style-365">
      ${p2BrandHeader(partner, (es ? "Ritmo del mes" : "Monthly pace") + " · " + (mesName || "—"), "")}
      <div class="agy-style-396">${es ? "Sin datos o metas del mes para calcular el ritmo." : "No data or goals to compute pace."}</div>
      ${p2BrandFooter(idx)}
    </div>`;
  }

  // Paraguas Taxi + TukTuk (lo que la meta cubre).
  const flujos = [
    // `ent`: N+R son PERSONAS, la proyección se redondea ("cierra en 60,65
    // conductores" no es un número que se le pueda decir a un partner).
    { lbl: es ? "Nuevos + Reactivados" : "New + Reactivated", real: (taxiAct.nr || 0) + (tkAct.nr || 0), meta: meta.mNR || 0, f: fmt, ent: true },
    { lbl: es ? "Horas de Conexión" : "Supply Hours",         real: (taxiAct.sh || 0) + (tkAct.sh || 0), meta: meta.mH  || 0, f: fmtSmart }
  ];
  const pctMesGlobal = Math.min((daysElapsed / daysInMonth) * 100, 100);

  const VERD = {
    adelantado: { txt: es ? "Adelantado" : "Ahead",     col: "#10b981" },
    en_ritmo:   { txt: es ? "En ritmo"   : "On pace",   col: "#0284c7" },
    atrasado:   { txt: es ? "Atrasado"   : "Behind",    col: "#FF0000" },
    sin_meta:   { txt: es ? "Sin meta"   : "No target", col: "#888" }
  };

  const cards = flujos.map(m => {
    const p = pacingFlujo(m.real, m.meta, daysElapsed, daysInMonth);
    const v = VERD[p.estado];
    if (p.estado === "sin_meta") {
      return `<div class="rt-card rt-na">
        <div class="rt-lbl">${escapeHTML(m.lbl)}</div>
        <div class="rt-val">${m.f(m.real)}</div>
        <div class="rt-sub">${es ? "sin meta cargada para el mes" : "no target loaded"}</div>
      </div>`;
    }
    // Proyección al cierre por ritmo (misma regla que el resto del deck).
    let proy = projectFlow(m.real, daysElapsed, daysInMonth - daysElapsed);
    if (m.ent) proy = Math.round(proy);
    const pctProy = (proy / m.meta) * 100;
    return `<div class="rt-card">
      <div class="rt-lbl">${escapeHTML(m.lbl)}</div>
      <div class="rt-val">${m.f(m.real)} <span class="rt-meta">/ ${m.f(m.meta)}</span></div>
      <div class="rt-barra">
        <div class="rt-fill" style="width:${Math.min(p.pctMeta, 100).toFixed(1)}%;background:${v.col}"></div>
        <div class="rt-hoy" style="left:calc(${p.pctMes.toFixed(1)}% - 1px)"></div>
      </div>
      <div class="rt-linea">
        <span style="color:${v.col};font-weight:800">${v.txt}</span>
        <span class="rt-dim">${_p2PctTxt(p.pctMeta)} ${es ? "de la meta" : "of target"} · ${p.ritmo >= 0 ? "+" : ""}${p.ritmo.toFixed(0)}pp ${es ? "vs calendario" : "vs calendar"}</span>
      </div>
      <div class="rt-proy">${es ? "a este ritmo cierra en" : "at this pace closes at"} <strong>${m.f(proy)}</strong> (${_p2PctTxt(pctProy)})</div>
    </div>`;
  }).join("");

  // AD aparte: es nivel, no ritmo.
  const adReal = (taxiAct.lastAD || 0) + (tkAct.lastAD || 0);
  const adMeta = meta.mA || 0;
  const adPct  = adMeta > 0 ? (adReal / adMeta) * 100 : null;

  return `<div class="agy-style-365">
    ${p2BrandHeader(partner, (es ? "Ritmo del mes" : "Monthly pace") + " · " + (mesName || "—"),
      es ? `Día ${daysElapsed} de ${daysInMonth} · ${pctMesGlobal.toFixed(0)}% del mes transcurrido`
         : `Day ${daysElapsed} of ${daysInMonth} · ${pctMesGlobal.toFixed(0)}% of month elapsed`)}
    <div class="rt-wrap">
      <div class="rt-cards">${cards}</div>
      <div class="rt-nivel">
        <span class="rt-nivel-lbl">${es ? "Conductores Activos" : "Active Drivers"}</span>
        <span class="rt-nivel-val">${fmt(adReal)}${adMeta ? ` <span class="rt-meta">/ ${fmt(adMeta)}</span>` : ""}</span>
        ${adPct != null ? `<span class="rt-nivel-pct" style="color:${p2AvanceColor(adPct)}">${_p2PctTxt(adPct)}</span>` : ""}
        <span class="rt-nivel-nota">${es
          ? "es un nivel, no se acumula: no aplica ritmo"
          : "a level, not accumulated: pace does not apply"}</span>
      </div>
    </div>
    ${p2BrandFooter(idx)}
  </div>`;
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
export function p2OpsMetrics(rows) {
  let trips = 0, horas = 0, accW = 0, badW = 0, mphW = 0;
  for (const r of rows) {
    const t = r.trips || 0, h = r.supplyHours || 0;
    trips += t; horas += h;
    if (r.acceptanceRate      != null) accW += r.acceptanceRate * t;
    if (r.badRatedTripsShare  != null) badW += r.badRatedTripsShare * t;
    if (r.moneyPerHour        != null) mphW += r.moneyPerHour * h;
  }
  return {
    accept:   trips > 0 ? accW / trips : null,
    bad:      trips > 0 ? badW / trips : null,
    mph:      horas > 0 ? mphW / horas : null,
    tripsHr:  horas > 0 ? trips / horas : null,
    ad: rows.length ? Math.max(...rows.map(r => r.activeDrivers || 0)) : 0
  };
}

export function buildSlide2Benchmark(partner, dates, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const dset = new Set(dates || []);
  const todas = (STATE.rawData || []).filter(r => dset.has(r.date));
  const mias  = todas.filter(r => r.partner === partner);

  if (!mias.length) {
    return `<div class="agy-style-365">
      ${p2BrandHeader(partner, es ? "Benchmark operacional" : "Operational benchmark", "")}
      <div class="agy-style-396">${es ? "Sin datos del partner en el rango." : "No partner data in range."}</div>
      ${p2BrandFooter(idx)}
    </div>`;
  }

  const yo = p2OpsMetrics(mias);

  // Cohorte = partners con >=50 activos en el rango. El corte evita que flotas
  // de 3 conductores muevan la mediana con ratios que no son representativos.
  const porPartner = new Map();
  todas.forEach(r => {
    let a = porPartner.get(r.partner);
    if (!a) { a = []; porPartner.set(r.partner, a); }
    a.push(r);
  });
  const cohorte = [...porPartner.values()].map(p2OpsMetrics).filter(m => m.ad >= 50);
  const med = {
    accept:  median(cohorte.map(m => m.accept)),
    bad:     median(cohorte.map(m => m.bad)),
    mph:     median(cohorte.map(m => m.mph)),
    tripsHr: median(cohorte.map(m => m.tripsHr))
  };

  // `mejorEsAlto`: en "% mal calificados" mejor es MÁS BAJO — sin esta marca el
  // semáforo diría que un partner con más viajes mal calificados va bien.
  const DEFS = [
    { k: "accept",  lbl: es ? "Aceptación" : "Acceptance",        f: v => (v * 100).toFixed(1) + "%", alto: true  },
    { k: "mph",     lbl: es ? "USD por hora" : "USD per hour",    f: v => "$" + v.toFixed(2),         alto: true  },
    { k: "tripsHr", lbl: es ? "Viajes por hora" : "Trips per hour", f: v => v.toFixed(2),             alto: true  },
    { k: "bad",     lbl: es ? "% mal calificados" : "% badly rated", f: v => (v * 100).toFixed(1) + "%", alto: false }
  ];

  const filas = DEFS.map(d => {
    const mio = yo[d.k], m = med[d.k];
    if (mio == null || m == null) {
      return `<tr><td class="sc-lvl">${escapeHTML(d.lbl)}</td>
        <td class="sc-num"><span class="sc-val">—</span></td>
        <td class="sc-num"><span class="sc-val" style="color:#aaa">—</span></td>
        <td class="sc-num"><span class="sc-sub">${es ? "sin dato" : "no data"}</span></td></tr>`;
    }
    const mejor = d.alto ? mio >= m : mio <= m;
    const col = mejor ? "#10b981" : "#FF0000";
    const dif = m !== 0 ? ((mio - m) / Math.abs(m)) * 100 : 0;
    return `<tr>
      <td class="sc-lvl">${escapeHTML(d.lbl)}</td>
      <td class="sc-num"><span class="sc-val" style="color:${col}">${d.f(mio)}</span></td>
      <td class="sc-num"><span class="sc-val" style="color:#888;font-weight:700">${d.f(m)}</span></td>
      <td class="sc-num">
        <span class="sc-val" style="color:${col};font-size:.8rem">${dif >= 0 ? "+" : ""}${dif.toFixed(0)}%</span>
        <span class="sc-sub">${mejor ? (es ? "mejor que la mediana" : "better than median") : (es ? "peor que la mediana" : "worse than median")}</span>
      </td>
    </tr>`;
  }).join("");

  return `<div class="agy-style-365">
    ${p2BrandHeader(partner, es ? "Benchmark operacional" : "Operational benchmark",
      es ? `Tu operación vs la mediana de ${cohorte.length} partners con 50+ conductores activos`
         : `Your operation vs the median of ${cohorte.length} partners with 50+ active drivers`)}
    <div class="sc-wrap">
      <table class="sc-tbl"><thead><tr>
        <th></th><th>${es ? "Vos" : "You"}</th>
        <th>${es ? "Mediana del cohorte" : "Cohort median"}</th>
        <th>${es ? "Diferencia" : "Difference"}</th>
      </tr></thead><tbody>${filas}</tbody></table>
      <div class="bm-nota">${es
        ? "Estas métricas describen cómo opera tu flota y sirven para compararte. En los datos de este período NO se observó relación entre ellas y la variación de conductores activos, así que no se presentan como causa de crecimiento o caída."
        : "These metrics describe how your fleet operates and are for comparison. In this period's data no relationship was observed between them and active-driver change, so they are not presented as a cause of growth or decline."}</div>
    </div>
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
  const es = PRESENT2_STATE.lang === "es";
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
        title: es ? `AD cae 3 ${mi.units} ${mi.seg}` : `AD down 3 ${mi.units} ${mi.seg}`,
        detail: `${fmt(a[0])} → ${fmt(a[2])}` });
    }
    // (b) caída WoW > 5% en ciudad
    if (lv.city && lw != null && lw < T.wowDropCity) out.push({ sev: "high", level: lv.label, kind: "wowdrop",
      title: es ? `Caída ${mi.pop} en Conductores Activos` : `${mi.pop} drop in Active Drivers`,
      detail: `${lw.toFixed(1)}%` });
    // (c) retención < retMin (85%)
    if (lastRet != null && lastRet < T.retMin) out.push({ sev: "mid", level: lv.label, kind: "retention",
      title: es ? `Retención bajo ${(T.retMin * 100).toFixed(0)}%` : `Retention below ${(T.retMin * 100).toFixed(0)}%`,
      detail: `${(lastRet * 100).toFixed(1)}%` });
    // (d) mínimos por tamaño de park
    if (lastAD > 0 && lastAD < T.smallParkAD) {
      if (shPerAd != null && shPerAd < T.smallShPerAdMin) out.push({ sev: "mid", level: lv.label, kind: "smallpark_sh",
        title: es ? `Park chico con SH/AD bajo` : `Small park, low SH/AD`,
        detail: `${shPerAd.toFixed(1)} ${es ? "h/cond" : "h/driver"}` });
    } else if (lastAD < T.midParkAD) {
      if ((tripsPerAd != null && tripsPerAd < T.midTripsPerAdMin)) out.push({ sev: "mid", level: lv.label, kind: "midpark_trips",
        title: es ? `Park medio con Trips/AD bajo` : `Mid park, low Trips/AD`,
        detail: `${tripsPerAd.toFixed(1)} ${es ? "viajes/cond" : "trips/driver"}` });
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
          title: es ? `Park grande con señal de caída (revisar estabilidad)` : `Large park showing decline`,
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
      ${p2BrandHeader(partner, es ? "Alertas / Next Steps" : "Alerts / Next Steps", es ? "Señales automáticas para accionar con el partner" : "Automatic signals to act on with the partner")}
      <div class="agy-style-396">${msg}</div>
      ${p2BrandFooter(idx)}
    </div>`;
  }
  const groups = p2GroupAlerts(p2ComputeAlerts(partner, dates));
  const sevColor = s => s === "high" ? "#FF0000" : "#f59e0b";
  const sevLabel = s => s === "high" ? (es ? "Alta" : "High") : (es ? "Media" : "Medium");
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
    : `<div class="agy-style-402">✓ ${es ? "Sin alertas — todo dentro de rango." : "No alerts — all within range."}</div>`;
  return `<div class="agy-style-365">
    ${p2BrandHeader(partner, es ? "Alertas / Next Steps" : "Alerts / Next Steps", es ? "Señales automáticas para accionar con el partner" : "Automatic signals to act on with the partner")}
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
  const churnTxt = L.churn != null ? (es ? ` · ${fmt(Math.round(L.churn))} se fueron` : ` · ${fmt(Math.round(L.churn))} left`) : "";
  cards.push(_p2FcMiniCard(es ? "Retención" : "Retention", retTxt,
    ret100 != null ? (es ? `${ret100} de 100 siguen${churnTxt}` : `${ret100} of 100 stay${churnTxt}`) : "", retCol,
    es ? "De tus conductores activos del mes pasado, cuántos siguen activos este mes. Es la palanca más barata: menos fugas = necesitás menos nuevos para crecer."
       : "Of last month's active drivers, how many stay active this month. Cheapest lever: fewer leaks = fewer new drivers needed to grow."));
  // 2) Nuevos + Reactivados — tu motor de entrada este mes.
  cards.push(_p2FcMiniCard(es ? "Nuevos + React." : "New + React.",
    fmt(Math.round(L.newT + L.react)),
    L.leadDependency != null ? (es ? `${(L.leadDependency * 100).toFixed(0)}% vía leads Yango` : `${(L.leadDependency * 100).toFixed(0)}% via Yango leads`) : (es ? "sumados este mes" : "added this month"), "#111",
    es ? "Conductores que ingresaron o reactivaste este mes (nuevos del partner + de leads Yango + reactivados). Tu motor de entrada."
       : "Drivers you added or reactivated this month (partner-sourced + Yango leads + reactivated). Your intake engine."));
  // 3) Cuello del embudo — la etapa registro→viajes con MENOR conversión (auto-seleccionada).
  if (L.funnel.hasData && L.funnel.bottleneck) {
    const bn = L.funnel.bottleneck;
    const pct = (bn.conv * 100).toFixed(0);
    const stg = es ? bn.es : bn.en;
    cards.push(_p2FcMiniCard(es ? "Cuello del embudo" : "Funnel bottleneck",
      pct + "%", stg + (es ? " · etapa más floja" : " · weakest stage"), "#f97316",
      es ? `Recorrido de un conductor nuevo: se registra → hace 10, 50 y 100 viajes. El "cuello" es la etapa donde MÁS se caen: acá solo ${pct}% avanza en "${stg}". Es tu mayor fuga — mejorarla sube tus activos sin traer más gente.`
         : `A new driver's journey: signs up → does 10, 50, 100 trips. The bottleneck is where most drop off: here only ${pct}% advance at "${stg}". Your biggest leak — fixing it raises actives without more intake.`));
  }
  // 4) Horas por conductor (SH/AD) — aprovechamiento de la base.
  const shad = L.prod.shPerAd, tr = L.prod.shPerAdTrend;
  cards.push(_p2FcMiniCard(es ? "Horas / conductor" : "Hours / driver",
    shad != null ? shad.toFixed(1) + "h" : "—",
    tr != null ? ((tr >= 0 ? "▲ +" : "▼ ") + tr.toFixed(0) + "% vs 3m") : (es ? "al mes" : "per month"),
    tr == null ? "#111" : tr >= 0 ? "#10b981" : "#FF0000",
    es ? "Horas de conexión promedio por conductor activo en el mes. Mide qué tan aprovechada está tu base: si cae, tenés gente registrada pero poco activa."
       : "Average supply hours per active driver in the month. How used your base is: if it falls, drivers are registered but barely active."));
  // 5) Hacia la meta (si el partner tiene meta de AD cargada). Muestra los NUEVOS+REACT
  // que hacen falta para el nivel meta CONTANDO la rotación: aunque la meta de AD sea ~igual
  // a hoy, cada mes se van conductores (retención<100%) y hay que reponerlos. Antes se
  // disparaba por gap de NIVEL (meta==hoy → gap 0 → "en meta" engañoso, aunque falten N+R).
  const t = C.target ? fcLeversToTarget(L, C.target) : null;
  if (t) {
    const goalLbl = es ? `Para tu meta (${fmt(Math.round(C.target))} AD)` : `To hit goal (${fmt(Math.round(C.target))} AD)`;
    const need = Math.round(t.newNeeded);
    const now  = Math.round(t.newNow || 0);
    const shortBy = need - now;
    const onTrack = shortBy <= 0;
    const retA = t.retNow    != null ? (t.retNow    * 100).toFixed(0) + "%" : "—";
    const retB = t.retNeeded != null ? (t.retNeeded * 100).toFixed(0) + "%" : "—";
    cards.push(_p2FcMiniCard(goalLbl,
      (onTrack ? "✓ " : "") + fmt(need) + (es ? " N+R/mes" : " N+R/mo"),
      onTrack ? (es ? `tu ritmo (~${fmt(now)}) alcanza` : `your pace (~${fmt(now)}) suffices`)
              : (es ? `hoy ~${fmt(now)} · faltan ${fmt(shortBy)}` : `today ~${fmt(now)} · short ${fmt(shortBy)}`),
      onTrack ? "#10b981" : "#0284c7",
      es ? `Aunque tu meta de AD (${fmt(Math.round(C.target))}) sea parecida a hoy (${fmt(Math.round(L.adNow))}), cada mes se te van conductores por rotación (retención ${retA}). Para sostener/llegar a la meta necesitás ~${fmt(need)} nuevos+reactivados en el mes; hoy promediás ~${fmt(now)}${shortBy > 0 ? ` (te faltan ~${fmt(shortBy)})` : ""}. Alternativa: subir la retención de ${retA} a ${retB}.`
         : `Even if your AD goal (${fmt(Math.round(C.target))}) is close to today (${fmt(Math.round(L.adNow))}), churn takes drivers each month (retention ${retA}). To hold/reach it you need ~${fmt(need)} new+reactivated in the month; today you average ~${fmt(now)}${shortBy > 0 ? ` (short ~${fmt(shortBy)})` : ""}. Alternative: raise retention from ${retA} to ${retB}.`));
  }
  const title = es ? "Palancas de crecimiento" : "Growth levers";
  const subt = es ? "Lo que mueve tu # de Conductores Activos. La proyección de arriba asume que se mantienen — mejorá una y sube."
                  : "What moves your Active-Driver count. The forecast above assumes they hold — improve one and it rises.";
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
    return `<span class="agy-style-409"><b>${escapeHTML(es ? k.es : k.en)}</b>: ${escapeHTML(fcMethodName(r.method, es))} · ${acc}</span>`;
  }).join("");
  return `<div class="agy-style-410">
    <div class="agy-style-411">${es ? "Detalle KAM (no se incluye en el PDF)" : "KAM detail (not in PDF)"}</div>
    <div>${chips}</div>
  </div>`;
}
export function buildSlide2Forecast(partner, dates, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const shell = inner => `<div class="agy-style-365">
    ${p2BrandHeader(partner, (es ? "Proyección · próximos 3 meses" : "Forecast · next 3 months"),
      es ? "Qué esperar si la tendencia sigue igual — y qué mover para crecer" : "What to expect if the trend holds — and what to move to grow")}
    ${inner}
    ${p2BrandFooter(idx)}
  </div>`;
  if (STATE.curMode !== "mensual") {
    return shell(`<div class="agy-style-412">${es ? "El pronóstico usa la serie MENSUAL. Cambia la escala a Mensual (arriba) para ver la proyección." : "The forecast uses the MONTHLY series. Switch the scale to Monthly to see it."}</div>`);
  }
  const C = p2ForecastCompute(partner);
  if (!C || C.histMonths.length < 4) {
    return shell(`<div class="agy-style-412">${es ? "Se necesitan al menos 4 meses de historia para proyectar." : "At least 4 months of history are needed to forecast."}</div>`);
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
        <span class="agy-style-414"><span style="width:7px;height:7px;border-radius:50%;background:${k.color};flex-shrink:0"></span><span class="agy-style-415">${escapeHTML(es ? k.es : k.en)}</span></span>
        <span style="font-size:.62rem;font-weight:800;color:${gcol};background:${gcol}18;padding:1px 6px;border-radius:6px">${gtxt}</span>
      </div>
      <div class="agy-style-416">
        <span class="agy-style-417">${_p2FcFmt(k.kind, last)}</span>
        <span class="agy-style-418">${es ? "hoy → 3m" : "now → 3m"}</span>
        <span style="font-weight:900;font-size:.9rem;color:${k.color}">${_p2FcFmt(k.kind, f3)}</span>
        <span class="agy-style-419">${es ? "precisión" : "accuracy"} ${acc}</span>
      </div>
      <div class="agy-style-420"><canvas id="p2fc_${k.key}" class="agy-style-362"></canvas></div>
    </div>`;
  }).join("");
  const partialNote = C.partial ? `<div class="agy-style-421">
      <span>⚠️ ${es ? "El último mes parece incompleto y se excluyó del pronóstico." : "The last month looks incomplete and was excluded from the forecast."}</span>
      ${PRESENT2_STATE._exporting ? "" : `<button data-act="present2ToggleInclPartial" style="border:1px solid #f59e0b;background:${PRESENT2_STATE.fcInclPartial ? "#f59e0b" : "#fff"};color:${PRESENT2_STATE.fcInclPartial ? "#fff" : "#b45309"};border-radius:6px;padding:2px 8px;font-size:.58rem;font-weight:700;cursor:pointer;white-space:nowrap">${PRESENT2_STATE.fcInclPartial ? (es ? "Excluir" : "Exclude") : (es ? "Incluir último mes" : "Include last month")}</button>`}
    </div>` : "";
  // Leyenda + encuadre en lenguaje simple (qué es la proyección). Swatches inline-block
  // (seguros en el PDF). Incluye la validación (error del backtest) para dar confianza.
  const mapes = P2_FC_KPIS.map(k => C.fc[k.key].mape).filter(v => v != null);
  const avg = mapes.length ? mapes.reduce((s, v) => s + v, 0) / mapes.length : null;
  const nBack = Math.min(6, C.histMonths.length - Math.max(4, C.histMonths.length - 6));
  const sw = (style) => `<span style="display:inline-block;width:16px;height:0;border-top:2px ${style};vertical-align:middle;margin-right:5px"></span>`;
  const swSolid = sw("solid #888"), swDash = sw("dashed #888"), swUp = sw("dashed #10b981"), swDown = sw("dashed #dc2626");
  const legend = `<div class="agy-style-422">
      <span class="agy-style-423">${swSolid}${es ? `Real (${C.histMonths.length} meses)` : `Actual (${C.histMonths.length} mo.)`}</span>
      <span class="agy-style-423">${swDash}${es ? "Proyección esperada" : "Expected forecast"}</span>
      <span class="agy-style-424">${swUp}${es ? "Si crece (máx)" : "If grows (max)"}</span>
      <span class="agy-style-425">${swDown}${es ? "Si decrece (mín)" : "If drops (min)"}</span>
      ${avg != null ? `<span class="agy-style-426">✓ ${es ? `Validado con tus ${nBack} meses más recientes · ±${avg.toFixed(0)}%` : `Validated on your ${nBack} most recent months · ±${avg.toFixed(0)}%`}</span>` : ""}
      <span class="agy-style-427">${es ? "Al ritmo actual — mové las palancas ↓ para cambiarla" : "At current pace — move the levers ↓ to change it"}</span>
    </div>`;
  const detail = PRESENT2_STATE._exporting ? "" : _p2FcDetailHTML(C, es);
  const expBanner = `<div class="agy-style-428">
      <span class="agy-style-429">🧪</span>
      <span>${es ? "EXPERIMENTAL · en validación — no compartir con partners aún. No se incluye en el PDF." : "EXPERIMENTAL · under validation — do not share with partners yet. Not included in the PDF."}</span>
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
  const es = PRESENT2_STATE.lang === "es";
  const lastIdx = labels.length - 1;
  const fmtV = v => v == null ? "" : (kind === "money" ? "$" + fmtSmart(v) : kind === "numK" ? fmtSmart(v) : fmt(Math.round(v)));
  const UP = "#10b981", DN = "#dc2626";   // verde = si crece (máx) · rojo = si decrece (mín)
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: labels.map(d2s), datasets: [
      // Escenario ALTO ("si crezco / máximo"): línea verde punteada + banda tenue hacia el bajo.
      // Etiqueta solo en el último mes (el techo del rango) para no saturar.
      { label: "hi", data: upper, borderColor: UP, backgroundColor: color + "12", borderWidth: 1, borderDash: [2, 3], pointRadius: 0, fill: "+1", tension: 0.25, spanGaps: true,
        datalabels: { display: c => c.dataIndex === lastIdx, align: "top", anchor: "end", offset: 1, color: UP, font: { size: 8, weight: "bold" }, formatter: v => v == null ? "" : (es ? "máx " : "max ") + fmtV(v) } },
      // Escenario BAJO ("si decrezco / mínimo"): línea roja punteada.
      { label: "lo", data: lower, borderColor: DN, borderWidth: 1, borderDash: [2, 3], pointRadius: 0, fill: false, tension: 0.25, spanGaps: true,
        datalabels: { display: c => c.dataIndex === lastIdx, align: "bottom", anchor: "start", offset: 1, color: DN, font: { size: 8, weight: "bold" }, formatter: v => v == null ? "" : (es ? "mín " : "min ") + fmtV(v) } },
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
          const m = { real: es ? "real" : "actual", proy: es ? "esperado" : "expected", hi: es ? "si crece" : "if grows", lo: es ? "si decrece" : "if drops" }[c.dataset.label] || "";
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

  const es = PRESENT2_STATE.lang === "es";
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
          <input id="present2Search" type="text" class="sb-inp agy-style-434" autocomplete="off" placeholder="${es ? "Buscar partner..." : "Search partner..."}" value="${escapeHTML(PRESENT2_STATE.partner)}" data-act-input="p2FilterPartners" data-act-focus="p2ShowPartnerList" data-act-blur="p2HidePartnerListDelayed" data-act-keydown="p2SearchKeydown"/>
          <div id="present2PartnerList" class="agy-style-435"></div>
        </div>
        <div>
          <label class="agy-style-433">${es ? "Idioma" : "Language"}</label>
          <div class="mode-toggle">
            <button class="mode-btn ${es ? "active" : ""}" data-act="setPresent2Lang" data-lang="es">ES</button>
            <button class="mode-btn ${!es ? "active" : ""}" data-act="setPresent2Lang" data-lang="en">EN</button>
          </div>
        </div>
        <div>
          <label class="agy-style-433">${es ? "Comparar con" : "Compare"}</label>
          <div id="present2CmpBar" class="agy-style-436">${p2CmpBar()}</div>
        </div>
        <div>
          <label class="agy-style-433">${es ? "Vista" : "View"}</label>
          <div class="mode-toggle" title="${es ? "Auto respeta el flag Fleet de Configuración" : "Auto follows the Fleet flag in Config"}">
            <button class="mode-btn ${PRESENT2_STATE.fleetMode === "auto"  ? "active" : ""}" data-act="present2SetFleetMode" data-mode="auto">Auto</button>
            <button class="mode-btn ${PRESENT2_STATE.fleetMode === "taxi"  ? "active" : ""}" data-act="present2SetFleetMode" data-mode="taxi">${es ? "Taxi" : "Taxi"}</button>
            <button class="mode-btn ${PRESENT2_STATE.fleetMode === "fleet" ? "active" : ""}" ${canForceFleet ? `data-act="present2SetFleetMode" data-mode="fleet"` : `disabled class="agy-style-437"`} title="${canForceFleet ? "" : (es ? "Este partner no está marcado como Fleet" : "This partner isn't flagged as Fleet")}">Fleet</button>
          </div>
        </div>
        ${p2TuktukSectionVisible(PRESENT2_STATE.partner) ? `
        <div>
          <label class="agy-style-433">${es ? "Sección" : "Section"}</label>
          <div class="mode-toggle" id="present2SectionBar" title="${es ? "Salta a la sección Taxi o TukTuk del deck" : "Jump to the Taxi or TukTuk section"}">${_p2SectionBarHTML(curDs)}</div>
        </div>` : ""}
        ${p2MetaMeses().length ? `
        <div title="${es ? "Mes de la meta en 'Avance vs Meta'. Auto = el mes del 'Hasta'." : "Goal month for 'Goal vs Target'. Auto = the 'To' month."}">
          <label class="agy-style-433">${es ? "Mes meta" : "Goal month"}</label>
          <select data-act-change="present2SetAvanceMes" class="agy-style-438">
            <option value="">${es ? "Auto (según filtro)" : "Auto (by filter)"}</option>
            ${p2MetaMeses().map(m => `<option value="${escapeHTML(m)}" ${PRESENT2_STATE.avanceMesSel === m ? "selected" : ""}>${escapeHTML(m)}</option>`).join("")}
          </select>
        </div>` : ""}
        <div class="agy-style-439">
          <button data-act="switchTab" data-tab="rend" class="agy-style-440">← ${es ? "Volver" : "Back"}</button>
          <button class="apply-btn agy-style-441" data-act="downloadPresent2PDF">⬇ ${es ? "Descargar PDF" : "Download PDF"}</button>
        </div>
      </div>
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
  const es = PRESENT2_STATE.lang === "es";
  const tog = PRESENT2_STATE.cohort || {};
  const cityBtn = `<button data-act="present2ToggleCity" class="preset-btn${PRESENT2_STATE.cmpCity ? " active" : ""}" style="flex:0 0 auto;padding:4px 10px;${PRESENT2_STATE.cmpCity ? "background:#64748b;color:#fff;border-color:#64748b" : ""}">${es ? "Ciudad" : "City"}</button>`;
  const bands = P2_BANDS.map(b => {
    const on = tog[b.key];
    return `<button data-act="present2ToggleCohort" data-key="${escapeHTML(b.key)}" class="preset-btn${on ? " active" : ""}" style="flex:0 0 auto;padding:4px 10px;${on ? `background:${b.color};color:#fff;border-color:${b.color}` : ""}">${escapeHTML(es ? b.es : b.en)}</button>`;
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
  }

  inner.innerHTML = s.build(partner, dates, PRESENT2_STATE.slide);
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
export async function downloadPresent2PDF() {
  logAccess("download_pdf", "presentacion2:" + (PRESENT2_STATE.partner || "?"));
  const partner = PRESENT2_STATE.partner;
  if (!partner) { alert("Selecciona un partner primero."); return; }
  try { await ensurePdfLibs(); } catch (e) { alert("No se pudieron cargar las librerías de PDF. Reintentá."); return; }
  destroyPresent2Charts();
  await new Promise(r => setTimeout(r, 100));

  const es = PRESENT2_STATE.lang === "es";
  const from = document.getElementById("dateFrom") ? document.getElementById("dateFrom").value : STATE.allDates[0];
  const to   = document.getElementById("dateTo")   ? document.getElementById("dateTo").value   : STATE.allDates[STATE.allDates.length - 1];
  // dates se calcula POR SLIDE dentro del loop (dataset-aware): Taxi y TukTuk usan
  // cada uno sus propias fechas. No calcular acá (sería siempre las de Taxi).

  const prog = document.createElement("div");
  prog.style.cssText = "position:fixed;inset:0;background:rgba(255,255,255,.95);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px";
  prog.innerHTML = `<div class="agy-style-445"></div><div id="p2Msg" class="agy-style-446">${es ? "Generando PDF..." : "Generating PDF..."}</div>`;
  document.body.appendChild(prog);

  // Deck combinado: incluye sección Taxi + (si aplica) sección TukTuk. Se EXCLUYEN las
  // slides marcadas noPdf (ej. Proyección, experimental) hasta validar mejor los datos.
  const deck = p2Deck(partner).filter(e => !e.def.noPdf);
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
    alert((es ? "Error al generar PDF: " : "Error generating PDF: ") + err.message);
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
  present2ToggleCohort: d => present2ToggleCohort(d.key),
  present2JumpSection:  d => present2JumpSection(d.section),
  p2ShowPartnerList,
  p2HidePartnerListDelayed: () => setTimeout(p2HidePartnerList, 200)
});
