// presentacion2.js — "Presentación 2.0" (Fase 1a)
// Presentación semanal estandarizada para enviar al partner. Sección NUEVA e
// independiente: no toca "Vista Partner" (partnerView.js) ni "Presentación"
// (presentacion.js). Reusa helpers globales (getPartnerVals, getCityVals,
// getSelectedDates, _presOrderCities, getWoW, wowColor, fmt, fmtSmart, d2s,
// CITY_COLORS, cityLabel, escapeHTML, ensureIndexes) pero mantiene su PROPIO
// registro de charts (PRESENT2_STATE.charts) para no chocar con presentacion.js.
//
// Fase 1a incluye: selector de partner + idioma + comparativas (vs Top-N / vs
// ciudad), slide de MATRIZ (Perú + ciudades × AD, N+R, SH, Comisión, Viajes,
// Retención), slides de DATA RAW numérica y porcentual (WoW), y export a PDF.
// Pendiente (fases siguientes): Avance vs Meta, alertas KAM, variante Fleet, TukTuk.

let PRESENT2_STATE = {
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

const P2_MES_NOMBRES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

// Mes de REPORTE al que pertenece una fecha (para "Avance vs Meta"). En SEMANAL, una
// semana Lun–Dom pertenece al mes donde cae su JUEVES (inicio+3 = día mediano) — así la
// semana que arranca el Lun 29-jun (Jun 29 → Dom 05-jul, 5 de 7 días en julio) cuenta como
// PRIMERA semana de JULIO, no como última de junio: el avance MTD y la meta caen en el mes
// correcto y cuadran con "KPIs por Nivel" (que muestra la semana tal cual). En MENSUAL/DIARIO
// el mes es el de la fecha misma. Devuelve { y: año, m: 1-12 }.
function p2ReportYM(dateStr) {
  if (!dateStr) return { y: 0, m: 0 };
  if (STATE.curMode === "semanal") {
    const dt = parseLocalDate(dateStr);
    dt.setDate(dt.getDate() + 3);   // jueves de la semana (mediana Lun–Dom)
    return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
  }
  return { y: parseInt(dateStr.slice(0, 4), 10), m: parseInt(dateStr.slice(5, 7), 10) };
}

// Resuelve si el partner se muestra con KPIs Fleet (SH/Auto Activo, Acceptance,
// Carros Fleet) o Taxi (SH, Viajes). "auto" respeta el flag is_fleet de Config.
function p2IsFleetMode(partner) {
  if (PRESENT2_STATE.dataset === "tuktuk") return false;   // TukTuk usa los 4 KPIs Taxi (Fase 6)
  if (PRESENT2_STATE.fleetMode === "fleet") return true;
  if (PRESENT2_STATE.fleetMode === "taxi") return false;
  return typeof isFleetPartner === "function" && isFleetPartner(partner);
}

// Registro ÚNICO de slides: de aquí derivan el nav, el bound de navegación, el
// render EN VIVO y el PDF (una sola fuente → no divergen). build(partner,dates)
// → HTML; charts=true + chartFn(partner,dates,root) para slides con Chart.js.
const P2_SLIDES = [
  { es: "Carátula",       en: "Cover",          charts: false, build: (p, d, i) => buildSlide2Cover(p, d) },
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
function _p2TkPartnersAll() {
  return [...new Set([...(STATE._tuktukPartners || []), ...(STATE._tuktukMensualPartners || [])])];
}
function p2HasTuktuk(partner) { return _p2TkPartnersAll().includes(partner); }
// Diario NO tiene slice TukTuk propio (el export diario no trae db_id, Fase F pendiente de
// datos): sin este guard, un partner TukTuk en escala Diaria generaba una sección "TukTuk"
// que en realidad mostraba datos SEMANALES (p2AllDates cae a _tuktukDates) pero rotulados
// "Diario"/"DoD"/"días" (p2ModeInfo lee STATE.curMode) — inconsistencia real de escala.
// Predicado separado de p2HasTuktuk (que solo dice "existen datos tuktuk"): esta func decide
// si la SECCIÓN se muestra en la escala activa. Un partner tuktuk-only en Diario cae al
// fallback de p2Deck (body con ds="taxi", vacío pero rotulado honesto) en vez de mostrar
// data real bajo la escala equivocada.
function p2TuktukSectionVisible(partner) { return STATE.curMode !== "diario" && p2HasTuktuk(partner); }
function p2HasTaxi(partner)   { return (STATE.allPartners   || []).includes(partner); }
// Lista del SELECTOR: unión taxi + tuktuk (un partner tuktuk-only debe poder elegirse).
function p2PartnerList() {
  return [...new Set([...(STATE.allPartners || []), ..._p2TkPartnersAll()])].sort();
}
// Portada divisoria de sección (se inserta antes de la sección TukTuk).
const P2_DIVIDER = { es: "TukTuk", en: "TukTuk", charts: false, build: (p) => buildSlide2SectionCover(p, "tuktuk") };
// Slide de Seguimiento (Fase 3, render-only): solo si el partner tiene tareas cargadas.
// Va al final del deck y entra al PDF automáticamente (no es noPdf). Definida en seguimiento.js.
const P2_SEG_SLIDE = { es: "Seguimiento", en: "Follow-up", charts: false, build: (p, d, i) => buildSlide2Seguimiento(p, i) };
// Avance vs Meta Combinado (Taxi+TukTuk): NO vive en P2_SLIDES a propósito — ese
// array se re-ejecuta completo para la sección Taxi Y para la TukTuk (ver body.forEach
// más abajo); si el combinado estuviera ahí, se duplicaría (una vez por sección). Se
// inserta a mano en p2Deck(), UNA sola vez, justo después de la carátula — es la vista
// rápida "cómo va TODO mi negocio", va primero, antes del detalle Taxi/TukTuk individual.
const P2_COMBINADO_SLIDE = { es: "Avance Combinado", en: "Combined Goal", charts: false, build: (p, d, i) => buildSlide2AvanceCombinado(p, i) };
// Deck por partner: carátula + [Combinado si hay TukTuk] + [sección Taxi] + [divisor + sección TukTuk].
function p2Deck(partner) {
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
    body.forEach(def => deck.push({ def, ds: "tuktuk" }));
  }
  // Seguimiento (Fase 3): al final del deck, solo si el partner tiene tareas.
  if (typeof p2PartnerHasSeguimiento === "function" && p2PartnerHasSeguimiento(partner))
    deck.push({ def: P2_SEG_SLIDE, ds: "taxi" });
  return deck;
}
// HTML del nav (prev/next + un botón por slide del deck; sección TukTuk tintada ámbar).
function p2NavHTML() {
  const es = PRESENT2_STATE.lang === "es";
  const deck = p2Deck(PRESENT2_STATE.partner);
  const btns = deck.map((entry, i) => {
    const label = es ? entry.def.es : entry.def.en;
    const on = PRESENT2_STATE.slide === i, tk = entry.ds === "tuktuk";
    const activeBg = tk ? "#f59e0b" : "#FF0000";
    const bd = on ? activeBg : (tk ? "#fde68a" : "#e5e5e5");
    const bg = on ? activeBg : (tk ? "#fffbeb" : "#fff");
    const co = on ? "#fff" : (tk ? "#b45309" : "#555");
    return `<button data-slide2="${i}" onclick="goSlide2(${i})" style="padding:6px 14px;border-radius:6px;font-size:.78rem;font-weight:600;border:2px solid ${bd};background:${bg};color:${co};cursor:pointer">${tk ? "🛺 " : ""}${escapeHTML(label)}</button>`;
  }).join("");
  return `<button class="png-btn" onclick="prevSlide2()" style="padding:6px 12px">◀</button>${btns}<button class="png-btn" onclick="nextSlide2()" style="padding:6px 12px">▶</button>`;
}

// Logo de marca (inline SVG, mismo ícono que la app). P2_LOGO_MARK = versión chica
// para el header de cada slide.
const P2_LOGO_SVG  = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="26" height="26"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
const P2_LOGO_MARK = `<span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle"><span style="width:15px;height:15px;background:#FF0000;border-radius:4px;display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" width="10" height="10"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span><span style="font-weight:900;font-size:.72rem;color:#111;letter-spacing:-.3px">YANGO <span style="color:#FF0000">Partners</span></span></span>`;

// Info del modo/escala activa (mensual/semanal/diario) para rótulos consistentes
// en TODA la presentación: badge visible, unidad de columna, sufijo de racha y
// abreviatura período-sobre-período (WoW/MoM/DoD). Así la deck "dice" en qué escala
// estás y ningún texto queda hablando de "semana" cuando ves meses.
function p2ModeInfo() {
  const es = PRESENT2_STATE.lang === "es";
  const m = STATE.curMode;
  if (m === "mensual") return { label: es ? "Mensual" : "Monthly", unit: es ? "Mes" : "Month", units: es ? "meses" : "months", seg: es ? "seguidos" : "in a row", pop: "MoM", color: "#0891b2" };
  if (m === "diario")  return { label: es ? "Diario"  : "Daily",   unit: es ? "Día" : "Day",   units: es ? "días" : "days",    seg: es ? "seguidos" : "in a row", pop: "DoD", color: "#a855f7" };
  return                       { label: es ? "Semanal" : "Weekly",  unit: es ? "Semana" : "Week", units: es ? "semanas" : "weeks", seg: es ? "seguidas" : "in a row", pop: "WoW", color: "#2563eb" };
}

// Alerta de FRESCURA de datos (para el KAM — se pinta en el tab, NO va al PDF).
// Si en la escala activa (mensual/semanal) el último período de Taxi y TukTuk no
// coinciden, casi siempre significa que faltó subir uno de los dos datasets (el
// KAM suele actualizar todo junto). Compara solo dentro de la misma granularidad.
function p2FreshnessWarn() {
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
  return `<div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:9px 12px;margin-bottom:12px;font-size:.8rem;color:#92400e;display:flex;gap:8px;align-items:flex-start">
    <span style="font-size:1rem;line-height:1.1">⚠️</span><span style="line-height:1.35">${msg}</span></div>`;
}

// Header de marca compartido: partner + contexto (izq) · logo + título de slide (der)
// + línea de acento roja. Reemplaza los headers ad-hoc de cada slide.
// badgeOverride opcional {text, color}: para slides que no son ni Taxi ni TukTuk
// puros (ej. Avance Combinado) — evita que el badge automático lea
// PRESENT2_STATE.dataset (que en esos slides no representa una sola línea).
function p2BrandHeader(partner, title, sub, badgeOverride) {
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
    <div style="min-width:0">
      ${badge}
      <div style="font-weight:900;font-size:1rem;color:#111;letter-spacing:-.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(partner)}</div>
      ${sub ? `<div style="font-size:.62rem;color:#999;margin-top:1px">${escapeHTML(sub)}</div>` : ""}
    </div>
    <div style="text-align:right;flex:0 0 auto">
      ${P2_LOGO_MARK}
      <div style="font-size:.64rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-top:2px">${escapeHTML(title)}</div>
      <div>${modeChip}</div>
    </div>
  </div>`;
}
// Footer de marca: confidencialidad + número de página (total = tamaño del deck).
function p2BrandFooter(idx) {
  const es = PRESENT2_STATE.lang === "es";
  const total = PRESENT2_STATE._deckLen || P2_SLIDES.length;
  return `<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #eee;padding-top:6px;margin-top:8px;font-size:.6rem;color:#bbb;flex:0 0 auto">
    <span>YANGO Partners · ${es ? "Confidencial" : "Confidential"}</span>
    <span>${es ? "pág" : "page"} ${(idx || 0) + 1}/${total}</span>
  </div>`;
}

// ── SLIDE: CARÁTULA (branded, oscura) ─────────────────────────────────────────
function buildSlide2Cover(partner, dates) {
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
    <div style="width:100%;height:100%;background:linear-gradient(135deg,#1a1a1a 0%,#2d2d2d 100%);display:flex;flex-direction:column;justify-content:center;align-items:center;position:relative;overflow:hidden">
      <div style="position:absolute;top:-80px;right:-80px;width:320px;height:320px;border-radius:50%;background:${col};opacity:.08"></div>
      <div style="position:absolute;bottom:-60px;left:-60px;width:240px;height:240px;border-radius:50%;background:#FF0000;opacity:.06"></div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px">
        <div style="width:48px;height:48px;background:#FF0000;border-radius:12px;display:flex;align-items:center;justify-content:center">${P2_LOGO_SVG}</div>
        <div style="color:#fff;font-weight:900;font-size:1.4rem;letter-spacing:-1px">YANGO <span style="color:#FF0000">Partners</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:14px;height:14px;border-radius:50%;background:${col}"></div>
        <div style="color:#fff;font-weight:900;font-size:2.4rem;letter-spacing:-1px;text-align:center">${escapeHTML(partner)}</div>
      </div>
      <div style="color:#FF0000;font-weight:700;font-size:1.1rem;margin-bottom:8px">${modeLabel} · ${period}</div>
      ${cities ? `<div style="color:#aaa;font-size:.85rem;margin-bottom:24px">${escapeHTML(cities)}</div>` : `<div style="margin-bottom:24px"></div>`}
      ${kam ? `<div style="background:rgba(255,255,255,.08);border-radius:8px;padding:8px 20px;color:#ccc;font-size:.8rem">${es ? "Ejecutivo de Cuenta" : "Account Manager"}: <strong style="color:#fff">${escapeHTML(kam)}</strong></div>` : ""}
    </div>`;
}
function p2SlideNames() { const es = PRESENT2_STATE.lang === "es"; return P2_SLIDES.map(s => es ? s.es : s.en); }

// ── SLIDE: PORTADA DIVISORIA DE SECCIÓN (Taxi / TukTuk) ────────────────────────
// Separador visual antes de la sección TukTuk: deja claro en el PDF que las
// diapositivas siguientes son de otra flota.
function buildSlide2SectionCover(partner, ds) {
  const es = PRESENT2_STATE.lang === "es";
  const tk = ds === "tuktuk";
  const accent = tk ? "#f59e0b" : "#FF0000";
  const emoji  = tk ? "🛺" : "🚕";
  const title  = tk ? (es ? "Sección TukTuk" : "TukTuk Section") : (es ? "Sección Taxi" : "Taxi Section");
  const sub    = es ? "Las métricas a continuación corresponden a" : "The metrics below correspond to";
  return `
    <div style="width:100%;height:100%;background:linear-gradient(135deg,#1a1a1a 0%,#2d2d2d 100%);display:flex;flex-direction:column;justify-content:center;align-items:center;position:relative;overflow:hidden">
      <div style="position:absolute;top:-80px;right:-80px;width:320px;height:320px;border-radius:50%;background:${accent};opacity:.12"></div>
      <div style="position:absolute;bottom:-60px;left:-60px;width:240px;height:240px;border-radius:50%;background:${accent};opacity:.07"></div>
      <div style="font-size:4rem;margin-bottom:6px;filter:drop-shadow(0 4px 12px rgba(0,0,0,.4))">${emoji}</div>
      <div style="color:#fff;font-weight:900;font-size:2.3rem;letter-spacing:-1px">${title}</div>
      <div style="color:${accent};font-weight:800;font-size:1.1rem;margin-top:6px">${escapeHTML(partner)}</div>
      <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:8px 20px;margin-top:18px;color:#ccc;font-size:.8rem">${sub} <strong style="color:#fff">${tk ? "TukTuk" : "Taxi"}</strong></div>
    </div>`;
}

// Bandas de cohorte (mismas que Vista Partner). range = [inicio, fin) sobre el ranking.
const P2_BANDS = [
  { key: "t1",   range: [0, 1],  color: "#ef4444", es: "Top 1",       en: "Top 1" },
  { key: "t23",  range: [1, 3],  color: "#f59e0b", es: "Top 2-3",     en: "Top 2-3" },
  { key: "t45",  range: [3, 5],  color: "#0ea5e9", es: "Top 4-5",     en: "Top 4-5" },
  { key: "t610", range: [5, 10], color: "#a855f7", es: "Top 6-10",    en: "Top 6-10" },
  { key: "t5",   range: [0, 5],  color: "#10b981", es: "Prom. Top 5", en: "Avg Top 5" }
];

// ── HELPERS DE DATOS ──────────────────────────────────────────────────────────
function destroyPresent2Charts() {
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
function _p2TkMensual() { return STATE.curMode === "mensual"; }
function p2CityDateIndex()  { return PRESENT2_STATE.dataset === "tuktuk" ? (_p2TkMensual() ? STATE._tuktukMensualByCityDate : STATE._tuktukByCityDate) : STATE._byCityDate; }
function p2RawDataset()     { return PRESENT2_STATE.dataset === "tuktuk" ? (_p2TkMensual() ? (STATE.rawDataMensualTuktuk || []) : (STATE.rawDataTuktuk || [])) : (STATE.rawData || []); }
function p2ActivePartners() { return PRESENT2_STATE.dataset === "tuktuk" ? (_p2TkMensual() ? (STATE._tuktukMensualPartners || []) : (STATE._tuktukPartners || [])) : (STATE.allPartners || []); }
function p2AllDates()       { return PRESENT2_STATE.dataset === "tuktuk" ? (_p2TkMensual() ? (STATE._tuktukMensualDates || []) : (STATE._tuktukDates || [])) : (STATE.allDates || []); }

// Espejo local de getPartnerVals/getCityVals (presentacion.js), pero acotado al
// índice del dataset activo — así taxi se comporta IDÉNTICO a antes (misma
// STATE._byCityDate) y tuktuk lee su propio índice sin forkear presentacion.js.
function p2GetPartnerVals(partner, city, dates, fn) {
  const idx = p2CityDateIndex();
  return dates.map(d => {
    const rows = (idx && idx.get(`${city}|||${d}`)) || [];
    let s = 0;
    for (const r of rows) if (r.partner === partner) s += fn(r);
    return s;
  });
}
function p2GetCityVals(city, dates, fn) {
  const idx = p2CityDateIndex();
  return dates.map(d => {
    const rows = (idx && idx.get(`${city}|||${d}`)) || [];
    let s = 0;
    for (const r of rows) s += fn(r);
    return s;
  });
}

// Ciudades del partner en orden canónico (Lima → Arequipa → Trujillo → resto).
function p2PartnerCities(partner) {
  const rows = p2RawDataset().filter(r => r.partner === partner);
  return _presOrderCities([...new Set(rows.map(r => r.city).filter(Boolean))]);
}

// Valores por fecha de una métrica para un nivel: scope=null → Perú (suma de las
// ciudades del partner); scope="LIMA" → esa ciudad.
function p2Vals(partner, scope, dates, fn) {
  if (scope) return p2GetPartnerVals(partner, scope, dates, fn);
  const cities = p2PartnerCities(partner);
  const per = cities.map(c => p2GetPartnerVals(partner, c, dates, fn));
  return dates.map((_, i) => per.reduce((s, a) => s + (a[i] || 0), 0));
}

// Tendencia de ciudad (total de TODOS los partners) para comparar. scope=null →
// suma de las ciudades del partner.
function p2CityVals(partner, scope, dates, fn) {
  if (scope) return p2GetCityVals(scope, dates, fn);
  const cities = p2PartnerCities(partner);
  const per = cities.map(c => p2GetCityVals(c, dates, fn));
  return dates.map((_, i) => per.reduce((s, a) => s + (a[i] || 0), 0));
}

// Getters de métricas base.
const P2_GET = {
  ad:    r => r.activeDrivers,
  newd:  r => r.newPartner + r.newService,
  react: r => r.reactivated,
  sh:    r => r.supplyHours,
  trips: r => r.trips || 0,
  comm:  r => r.commission || 0
};

// Todas las métricas (base + derivadas: N+R, Retención, Trips/SH, Trips/AD, SH/AD) por nivel.
// Retención[i] = (AD[i] − Nuevos[i] − Reactivados[i]) / AD[i−1]  (null si i=0 o AD prev=0).
function p2Metrics(partner, scope, dates) {
  const ad    = p2Vals(partner, scope, dates, P2_GET.ad);
  const newd  = p2Vals(partner, scope, dates, P2_GET.newd);
  const react = p2Vals(partner, scope, dates, P2_GET.react);
  const sh    = p2Vals(partner, scope, dates, P2_GET.sh);
  const trips = p2Vals(partner, scope, dates, P2_GET.trips);
  const comm  = p2Vals(partner, scope, dates, P2_GET.comm);
  const nr    = dates.map((_, i) => (newd[i] || 0) + (react[i] || 0));
  const ret   = dates.map((_, i) => (i === 0 || !ad[i - 1]) ? null : (ad[i] - newd[i] - react[i]) / ad[i - 1]);
  const tripsPerSh = dates.map((_, i) => sh[i] ? trips[i] / sh[i] : null);   // Trips/SH
  const tripsPerAd = dates.map((_, i) => ad[i] ? trips[i] / ad[i] : null);   // Trips/AD
  const shPerAd    = dates.map((_, i) => ad[i] ? sh[i] / ad[i] : null);      // SH/AD
  return { ad, newd, react, sh, trips, comm, nr, ret, tripsPerSh, tripsPerAd, shPerAd };
}

// Retención a nivel ciudad (todos los partners) para la tendencia de comparación.
function p2CityRet(partner, scope, dates) {
  const ad    = p2CityVals(partner, scope, dates, P2_GET.ad);
  const newd  = p2CityVals(partner, scope, dates, P2_GET.newd);
  const react = p2CityVals(partner, scope, dates, P2_GET.react);
  return dates.map((_, i) => (i === 0 || !ad[i - 1]) ? null : (ad[i] - newd[i] - react[i]) / ad[i - 1]);
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
function p2FleetSeries(partner, scope, dates) {
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
function p2CityFleetSeries(scope, dates) {
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
function p2Ranked(scope, dates) {
  const lastDate = dates[dates.length - 1];
  const rows = p2RawDataset().filter(r => r.date === lastDate && (!scope || r.city === scope));
  const byP = {};
  rows.forEach(r => { byP[r.partner] = (byP[r.partner] || 0) + (r.activeDrivers || 0); });
  return Object.entries(byP).sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

// Promedio del cohorte para un KPI (kpiKey). Para retención promedia las series
// de retención de cada miembro; para el resto promedia la métrica directa.
function p2CohortAvg(members, scope, dates, kpiKey) {
  if (!members.length) return dates.map(() => 0);
  let arrs;
  if (kpiKey === "ret") {
    arrs = members.map(p => {
      const ad = p2Vals(p, scope, dates, P2_GET.ad);
      const nd = p2Vals(p, scope, dates, P2_GET.newd);
      const rc = p2Vals(p, scope, dates, P2_GET.react);
      return dates.map((_, i) => (i === 0 || !ad[i - 1]) ? null : (ad[i] - nd[i] - rc[i]) / ad[i - 1]);
    });
  } else {
    const fn = kpiKey === "nr" ? (r => r.newPartner + r.newService + r.reactivated) : P2_GET[kpiKey];
    arrs = members.map(p => p2Vals(p, scope, dates, fn));
  }
  return dates.map((_, i) => {
    let s = 0, n = 0;
    arrs.forEach(a => { if (a[i] != null && !isNaN(a[i])) { s += a[i]; n++; } });
    return n ? s / n : null;
  });
}

// Líneas de cohorte activas para un KPI en un scope.
function p2CohortLines(scope, dates, kpiKey) {
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

// ── CHART (Chart.js, registro propio) ─────────────────────────────────────────
// Línea del partner (con puntos WoW) + tendencia de ciudad (opcional, gris punteada)
// + líneas de cohorte (opcional, punteadas de color). isPct=true → formatea %.
function p2Chart(canvasId, dates, partnerVals, cityVals, cohortLines, color, isPct, root) {
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
  const datasets = [{
    label: "Partner", data: partnerVals, borderColor: "#FF0000", backgroundColor: color + "18",
    borderWidth: 2.5, pointRadius: 3.5, pointBackgroundColor: pWoW.map(w => wowColor(w)),
    pointBorderColor: pWoW.map(w => wowColor(w)), tension: 0.3, fill: true, spanGaps: true
  }];
  if (PRESENT2_STATE.cmpCity && cityVals) {
    // Normaliza la tendencia de ciudad a la escala del partner para que se vea la FORMA.
    const pMax = Math.max(1, ...partnerVals.filter(v => v != null));
    const cMax = Math.max(1, ...cityVals.filter(v => v != null));
    const cNorm = cityVals.map(v => v == null ? null : (v / cMax) * pMax);
    datasets.push({
      label: PRESENT2_STATE.lang === "es" ? "Ciudad" : "City", data: cNorm,
      borderColor: "#bbb", borderWidth: 1.5, borderDash: [4, 4], pointRadius: 2,
      tension: 0.3, fill: false, spanGaps: true, _raw: cityVals
    });
  }
  (cohortLines || []).forEach(l => {
    const cMax = Math.max(1, ...l.data.filter(v => v != null));
    const pMax = Math.max(1, ...partnerVals.filter(v => v != null));
    const norm = l.data.map(v => v == null ? null : (v / cMax) * pMax);
    datasets.push({
      label: l.label, data: norm, borderColor: l.color, borderWidth: 1.5,
      borderDash: [6, 3], pointRadius: 2, tension: 0.3, fill: false, spanGaps: true, _raw: l.data
    });
  });
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: dates.map(d2s), datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => {
          const raw = ctx.dataset._raw ? ctx.dataset._raw[ctx.dataIndex] : ctx.raw;
          return `${ctx.dataset.label}: ${fmtV(raw)}`;
        } } },
        datalabels: {
          display: ctx => ctx.datasetIndex === 0 && ctx.dataIndex > 0 && pWoWLabel[ctx.dataIndex] != null,
          formatter: (_, ctx) => { const w = pWoWLabel[ctx.dataIndex]; return (w >= 0 ? "+" : "") + w.toFixed(1) + (isPct ? "pp" : "%"); },
          color: ctx => wowColor(pWoW[ctx.dataIndex]),
          font: { size: 8, weight: "bold" }, anchor: "end", align: "top", offset: 2
        }
      },
      scales: {
        x: { ticks: { font: { size: 8 }, maxRotation: 0 }, grid: { display: false } },
        y: { beginAtZero: false, ticks: { font: { size: 8 }, callback: v => fmtV(v) }, grid: { color: "#f5f5f5" } }
      }
    }
  });
  PRESENT2_STATE.charts.push(chart);
}

// ── KPIs de la matriz ─────────────────────────────────────────────────────────
// Matriz: 4 KPIs (los que el KAM revisa de un vistazo). Comisión y Retención se
// quitaron de los gráficos por densidad; siguen en el Data Raw.
function p2KpiDefs(es) {
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
function p2KpiDefsFleet(es) {
  return [
    { key: "nr",                   label: es ? "Nuevos + Reactivados" : "New + Reactivated", color: "#f97316", kind: "num" },
    { key: "accept",               label: "Acceptance Rate",                                 color: "#10b981", kind: "pct" },
    { key: "ownedFleetActiveCars", label: es ? "Owned Fleet Active Cars" : "Owned Fleet Active Cars", color: "#0ea5e9", kind: "num" },
    { key: "shCarInt",             label: es ? "Internal Fleet SH/Auto" : "Internal Fleet SH/Car",     color: "#8b5cf6", kind: "ratio1" }
  ];
}

// Niveles a mostrar: Perú + ciudades del partner (si tiene >1 ciudad, se agrega Perú).
function p2Levels(partner) {
  const cities = p2PartnerCities(partner);
  const levels = cities.length > 1
    ? [{ id: "PE", city: null, label: "Perú", color: "#111" }]
    : [];
  cities.forEach(c => levels.push({ id: c.toLowerCase().replace(/[^a-z0-9]/g, ""), city: c, label: cityLabel(c), color: CITY_COLORS[c] || "#888" }));
  return levels;
}

function p2FmtVal(kind, v) {
  if (v == null || isNaN(v)) return (kind === "pct" || kind === "ratio1") ? "—" : "0";
  if (kind === "pct")    return (v * 100).toFixed(1) + "%";
  if (kind === "money")  return "$" + fmtSmart(v);
  if (kind === "ratio1") return v.toFixed(1);
  return fmt(v);
}

// ── SLIDE 0: MATRIZ (niveles × KPIs) ──────────────────────────────────────────
function buildSlide2Matrix(partner, dates, idx) {
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
        <div style="flex:1;min-width:0;min-height:0;background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;padding:5px 7px;display:flex;flex-direction:column">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;gap:3px">
            <span style="display:flex;align-items:center;gap:4px;min-width:0"><span style="width:6px;height:6px;border-radius:50%;background:${k.color};flex-shrink:0"></span><span style="font-size:.55rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(k.label)}</span></span>
            <span style="font-size:.64rem;font-weight:700;color:${bColor};background:${bColor}18;padding:1px 5px;border-radius:6px">${badge || "—"}</span>
          </div>
          <div style="font-weight:900;font-size:.9rem;color:#111;margin-bottom:3px">${p2FmtVal(k.kind, last)}</div>
          <div style="flex:1;min-height:60px;position:relative;width:100%"><canvas id="p2_${lv.id}_${k.key}" style="width:100%;height:100%"></canvas></div>
        </div>`;
    }).join("");
    return `
      <div style="display:flex;gap:6px;flex:1 1 0;min-height:0;max-height:220px;border-left:3px solid ${lv.color};padding-left:6px">
        <div style="flex:0 0 60px;display:flex;align-items:center"><span style="font-weight:800;font-size:.78rem;color:${lv.color};line-height:1.1">${escapeHTML(lv.label)}</span></div>
        <div style="flex:1;min-width:0;display:flex;gap:6px;min-height:0">${cards}</div>
      </div>`;
  }).join("");
  const sub = es ? "Línea = partner (rojo) · gris = tendencia ciudad · punteadas = cohortes" : "Line = partner (red) · grey = city trend · dashed = cohorts";
  return `
    <div style="width:100%;height:100%;background:#fff;padding:12px 14px;display:flex;flex-direction:column;overflow:hidden">
      ${p2BrandHeader(partner, (es ? "KPIs por Nivel" : "KPIs by Level") + " · " + d2s(from) + " → " + d2s(to), sub)}
      <div style="display:flex;flex-direction:column;gap:8px;flex:1;min-height:0">${rows}</div>
      ${p2BrandFooter(idx)}
    </div>`;
}

function buildSlide2MatrixCharts(partner, dates, root) {
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
function p2RawCols(es) {
  return [
    { key: "trips", label: es ? "Viajes" : "Trips",                 kind: "num" },
    { key: "sh",    label: es ? "Horas de Conexión" : "Supply Hours", kind: "num" },
    { key: "ad",    label: es ? "Conductores Activos" : "Active Drivers", kind: "num" },
    { key: "newd",  label: es ? "Nuevos" : "New Drivers",           kind: "num" },
    { key: "react", label: es ? "Reactivados" : "Reactivated",      kind: "num" },
    { key: "comm",  label: es ? "Comisión Partner" : "Partner Commission", kind: "money" },
    { key: "nr",    label: "N+R",              kind: "num" },
    { key: "ret",   label: es ? "Retención" : "Retention", kind: "pct" },
    { key: "tripsPerSh", label: "Trips/SH",    kind: "ratio" },
    { key: "tripsPerAd", label: "Trips/AD",    kind: "ratio" },
    { key: "shPerAd",    label: "SH/AD",       kind: "ratio" }
  ];
}
// Fleet: TODAS las columnas de agregador (p2RawCols, sin quitar nada — incluye
// Trips/SH, Trips/AD, SH/AD) + 3 fleet-específicas al final (aditivo, no reemplaza; el
// partner Fleet quiere ver info de agregador Y de fleet juntas).
function p2RawColsFleet(es) {
  return [
    ...p2RawCols(es),
    { key: "ownedFleetActiveCars", label: "Owned Fleet Active Cars", kind: "num" },
    { key: "shCarInt",             label: es ? "Internal Fleet SH/Auto" : "Internal Fleet SH/Car",     kind: "ratio1" },
    { key: "accept",               label: "Acceptance Rate", kind: "pct" }
  ];
}
function p2FmtRaw(kind, v) {
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

function buildSlide2Raw(partner, dates, pct, idx) {
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
    const head = `<th style="text-align:left;padding:4px 6px;position:sticky;left:0;background:#f4f4f4;font-size:.64rem">${p2ModeInfo().unit}</th>` +
      cols.map(c => `<th style="text-align:right;padding:4px 6px;font-size:.62rem;white-space:nowrap">${escapeHTML(c.label)}</th>`).join("");
    const body = idxs.map(i => {
      const cells = cols.map(c => {
        const cur = m[c.key][i];
        if (!pct) {
          return `<td style="text-align:right;padding:3px 6px;font-size:.64rem;border-bottom:1px solid #f2f2f2">${p2FmtRaw(c.kind, cur)}</td>`;
        }
        // Variación WoW: para % (retención) diferencia en puntos; para el resto % relativo.
        const prev = m[c.key][i - 1];
        let txt = "—", bg = "#fafafa", col = "#888";
        if (cur != null && prev != null) {
          if (c.kind === "pct") { const d = (cur - prev) * 100; col = d >= 0 ? "#065f46" : "#7f1d1d"; bg = d >= 0 ? "#d1fae5" : "#fee2e2"; txt = (d >= 0 ? "+" : "") + d.toFixed(1) + "pp"; }
          else if (prev !== 0)  { const w = (cur - prev) / prev * 100; col = w >= 0 ? "#065f46" : "#7f1d1d"; bg = w >= 0 ? "#d1fae5" : "#fee2e2"; txt = (w >= 0 ? "+" : "") + w.toFixed(1) + "%"; }
        }
        return `<td style="text-align:right;padding:3px 6px;font-size:.64rem;background:${bg};color:${col};font-weight:600;border-bottom:1px solid #fff">${txt}</td>`;
      }).join("");
      return `<tr><td style="text-align:left;padding:3px 6px;font-size:.64rem;font-weight:700;position:sticky;left:0;background:#fff;border-bottom:1px solid #f2f2f2">${d2s(dates[i])}</td>${cells}</tr>`;
    }).join("");
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="width:10px;height:10px;border-radius:2px;background:${lv.color};display:inline-block"></span>
          <span style="font-weight:800;font-size:.82rem;color:${lv.color}">${escapeHTML(lv.label)}</span>
        </div>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:#fff">
          <thead><tr style="background:#f4f4f4">${head}</tr></thead><tbody>${body}</tbody></table></div>
      </div>`;
  }).join("");
  const _mi = p2ModeInfo();
  const title = pct ? (es ? `Data Raw · Variación % (${_mi.pop})` : `Data Raw · % change (${_mi.pop})`) : (es ? "Data Raw · Valores" : "Data Raw · Values");
  return `
    <div style="width:100%;height:100%;background:#fff;padding:12px 14px;display:flex;flex-direction:column;overflow:hidden">
      ${p2BrandHeader(partner, title + " · " + d2s(from) + " → " + d2s(to), "")}
      <div style="flex:1;min-height:0;overflow:auto">${tables}</div>
      ${p2BrandFooter(idx)}
    </div>`;
}

// ── SLIDE: AVANCE VS META DEL MES ─────────────────────────────────────────────
// Reusa la lógica de metas.js/data.js: actuals month-to-date (AD=max, N+R/SH=sum)
// vs meta (STATE.metasData) + proyección a fin de mes (calcProjectionDays/projA).
// El avance es SIEMPRE del mes seleccionado (no del rango del sidebar).
// Meses META disponibles (nombres, más reciente primero).
function p2MetaMeses() {
  return [...new Set((STATE.metasData || []).map(m => m.mes))].filter(Boolean)
    .sort((a, b) => _metasMesOrden(b) - _metasMesOrden(a));
}
// Mes META de "Avance vs Meta". Prioridad:
//   1) selección manual (PRESENT2_STATE.avanceMesSel), si tiene metas.
//   2) AUTO: el mes del "Hasta" (el dato que se está viendo) → si estás en junio,
//      compara vs la meta de JUNIO, no vs la más reciente (julio).
//   3) fallback: la meta más reciente.
function p2AvanceMes() {
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
function p2MonthDates(mesName) {
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
function p2MetaFor(partner, scopeCity, mes) {
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
function p2ActualsMTD(partner, scopeCity, monthDates) {
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
  const lastAD = adTot.length ? adTot[adTot.length - 1] : 0;   // Σciudades en la última fecha (base de proyección)
  return { ad, nr, sh, nrV, shV, lastAD };
}
function p2ProjMTD(act, lastDate) {
  const { daysElapsed, daysRemaining } = calcProjectionDays(lastDate);
  // AD es SNAPSHOT (nivel), no un flujo acumulado: la proyección honesta de cierre de mes
  // es el nivel actual (plano), NO lastAD×1.4 (un +40% fijo que ignora los días restantes e
  // inflaba la marca en el deck partner-facing; además contradecía a Brandeados que ya iba
  // plano). N+R y SH (flujos) sí se extrapolan con projA por días restantes. Ver auditoría.
  return { ad: act.lastAD, nr: projA(act.nrV, daysElapsed, daysRemaining), sh: projA(act.shV, daysElapsed, daysRemaining) };
}
function p2AvanceColor(pct) { return pct >= 100 ? "#10b981" : pct >= 80 ? "#f59e0b" : "#FF0000"; }

// Tarjeta "Referencia" (sin meta en BD, ej. Fleet): valor actual + badge WoW,
// estilo visualmente distinto (fondo celeste) de las tarjetas con meta real.
function p2RefCard(label, arr, kind, es) {
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
  return `<div style="flex:1;min-width:0;background:#f0f9ff;border:1px dashed #bae6fd;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:4px">
      <span style="font-size:.58rem;color:#0284c7;font-weight:700;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(label)}</span>
      <span style="font-size:.62rem;font-weight:700;color:${bColor}">${badge}</span>
    </div>
    <div style="font-weight:900;font-size:1rem;color:#111">${fmtN(last)}</div>
    <div style="font-size:.58rem;color:#0284c7;font-style:italic">${es ? "Referencia (sin meta)" : "Reference (no target)"}</div>
  </div>`;
}

// Tarjeta meta-vs-actual reutilizable (Fleet/TukTuk): actual/goal + % + barra.
// projV null → sin línea de proyección (KPIs de tasa/snapshot no proyectan).
function _p2MetaCard(label, real, goal, projV, fmtN, es) {
  const pct = goal > 0 ? (real / goal) * 100 : 0;
  const col = p2AvanceColor(pct);
  const ppct = (projV != null && goal > 0) ? (projV / goal) * 100 : null;
  return `<div style="flex:1;min-width:0;background:#fafafa;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:4px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px">
      <span style="font-size:.58rem;color:#aaa;font-weight:700;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(label)}</span>
      <span style="font-size:.74rem;font-weight:800;color:${col}">${pct.toFixed(0)}%</span>
    </div>
    <div style="display:flex;align-items:baseline;gap:5px">
      <span style="font-weight:900;font-size:1.05rem;color:#111">${fmtN(real)}</span>
      <span style="font-size:.62rem;color:#999">/ ${fmtN(goal)}</span>
    </div>
    <div style="height:7px;background:#eee;border-radius:5px;overflow:hidden;position:relative">
      <div style="height:100%;width:${Math.min(pct, 100).toFixed(1)}%;background:${col};border-radius:5px"></div>
      ${ppct != null ? `<div style="position:absolute;top:-1px;bottom:-1px;left:${Math.min(Math.max(ppct, 0), 100).toFixed(1)}%;width:2px;background:#111;opacity:.55"></div>` : ""}
    </div>
    ${ppct != null ? `<div style="font-size:.6rem;color:#999">${es ? "proy" : "proj"} ${fmtN(projV)} (${ppct.toFixed(0)}%)</div>` : ""}
  </div>`;
}
// Tarjeta solo-meta (sin actual medible, ej. Utilización Fleet).
function _p2MetaOnlyCard(label, goal, fmtN, note, es) {
  return `<div style="flex:1;min-width:0;background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;justify-content:center;gap:2px">
    <span style="font-size:.58rem;color:#0891b2;font-weight:700;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(label)}</span>
    <div style="font-weight:900;font-size:1rem;color:#111">${fmtN(goal)}</div>
    <div style="font-size:.58rem;color:#0891b2">${es ? "meta" : "target"}${note ? " · " + note : ""}</div>
  </div>`;
}

// % honesto: NO redondear 99.5-99.99 a "100%" (parecería meta cumplida sin estarlo).
// <100 → 1 decimal (99.6%); ≥100 → entero (106%). Espeja el criterio de la pestaña Metas.
function _p2PctTxt(pct) { return (pct >= 100 ? pct.toFixed(0) : Math.min(pct, 99.9).toFixed(1)) + "%"; }

function buildSlide2Avance(partner, idx) {
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
    let cards = metricDefs.map(m => {
      // Snapshot (AD/Cars) → último período; acumuladas (N+R/SH) → total del mes.
      const real = m.snap ? (act[m.snap] != null ? act[m.snap] : act[m.ak]) : act[m.ak];
      const goal = meta[m.mk] || 0, projV = proj[m.ak];
      const fmtN = m.kind === "numK" ? fmtSmart : fmt;
      if (!goal) {
        const subTxt = es ? "Sin meta" : "No target";
        return `<div style="flex:1;min-width:0;background:#fafafa;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;justify-content:center;gap:2px">
          <div style="font-size:.58rem;color:#aaa;font-weight:700;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(m.label)}</div>
          <div style="font-weight:900;font-size:1rem;color:#111">${fmtN(real)}</div>
          <div style="font-size:.6rem;color:#bbb">${subTxt}</div></div>`;
      }
      const pct = (real / goal) * 100, ppct = (projV / goal) * 100, col = p2AvanceColor(pct);
      return `<div style="flex:1;min-width:0;background:#fafafa;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px">
          <span style="font-size:.58rem;color:#aaa;font-weight:700;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(m.label)}</span>
          <span style="font-size:.74rem;font-weight:800;color:${col}">${_p2PctTxt(pct)}</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:5px">
          <span style="font-weight:900;font-size:1.05rem;color:#111">${fmtN(real)}</span>
          <span style="font-size:.62rem;color:#999">/ ${fmtN(goal)}</span>
        </div>
        <div style="height:7px;background:#eee;border-radius:5px;overflow:hidden;position:relative">
          <div style="height:100%;width:${Math.min(pct, 100).toFixed(1)}%;background:${col};border-radius:5px"></div>
          <div style="position:absolute;top:-1px;bottom:-1px;left:${Math.min(Math.max(ppct, 0), 100).toFixed(1)}%;width:2px;background:#111;opacity:.55"></div>
        </div>
        <div style="font-size:.6rem;color:#999">${es ? "proy" : "proj"} ${fmtN(projV)} (${_p2PctTxt(ppct)})</div>
      </div>`;
    }).join("");
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
      cards += (perCity && meta.mAcc != null && accA != null)
        ? _p2MetaCard(es ? "Aceptación" : "Acceptance", accA * 100, meta.mAcc, null, v => fmt(v) + "%", es)
        : p2RefCard(es ? "Acceptance Rate" : "Acceptance Rate", fs.accept, "pct", es);
      // SH/Auto interno:
      cards += (perCity && meta.mSHcar != null && shcA != null)
        ? _p2MetaCard(es ? "SH/Auto (interno)" : "Internal SH/Car", shcA, meta.mSHcar, null, v => fmt(v), es)
        : p2RefCard(es ? "Internal Fleet SH/Auto" : "Internal Fleet SH/Car", fs.shCarInt, "ratio1", es);
      // Utilización: solo meta, solo por ciudad (sin actual medible).
      if (perCity && meta.mUtil != null) cards += _p2MetaOnlyCard(es ? "Utilización" : "Utilization", meta.mUtil, v => fmt(v) + "%", es ? "sin actual" : "no actual", es);
      // Owned Fleet Active Cars: referencia (sin meta en BD).
      cards += p2RefCard(es ? "Owned Fleet Active Cars" : "Owned Fleet Active Cars", fs.ownedFleetActiveCars, "num", es);
    }
    return `<div style="display:flex;gap:8px;flex:1 1 0;min-height:0;max-height:200px;border-left:3px solid ${lv.color};padding-left:8px;align-items:stretch">
      <div style="flex:0 0 62px;display:flex;align-items:center"><span style="font-weight:800;font-size:.82rem;color:${lv.color}">${escapeHTML(lv.label)}</span></div>
      <div style="flex:1;min-width:0;display:flex;gap:8px">${cards}</div>
    </div>`;
  }).join("");
  const avTitle = isTk
    ? (es ? "Avance vs Meta TukTuk" : "TukTuk Goal vs Target")
    : (es ? "Avance vs Meta del mes" : "Goal vs Target");
  const avSub = es
    ? "Actual vs meta · barra = avance · marca negra = proyección"
    : "Actual vs goal · bar = progress · black mark = projection";
  const noDataMsg = noMonthData
    ? (es ? `Sin datos de ${escapeHTML(mesName)} para comparar con la meta.` : `No data for ${escapeHTML(mesName)} to compare.`)
    : isTk
      ? (es ? "Sin metas TukTuk para este mes." : "No TukTuk goals for this month.")
      : (es ? "Sin metas cargadas para este mes." : "No goals loaded for this month.");
  return `<div style="width:100%;height:100%;background:#fff;padding:12px 14px;display:flex;flex-direction:column;overflow:hidden">
    ${p2BrandHeader(partner, avTitle + " · " + (mesName || "—"), avSub)}
    ${noData
      ? `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:.9rem">${noDataMsg}</div>`
      : `<div style="display:flex;flex-direction:column;gap:8px;flex:1;min-height:0">${rows}</div>`}
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
function buildSlide2AvanceCombinado(partner, idx) {
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

  const defs = [
    { label: es ? "Conductores Activos" : "Active Drivers",
      real: taxiAct.lastAD + tkAct.lastAD, proj: taxiAct.lastAD + tkAct.lastAD,
      goal: (meta.mA || 0) + (meta.mtkAD || 0), fmtN: fmt },
    { label: es ? "Nuevos + Reactivados" : "New + React",
      real: taxiAct.nr + tkAct.nr, proj: taxiProj.nr + tkProj.nr,
      goal: (meta.mNR || 0) + (meta.mtkNR || 0), fmtN: fmt },
    { label: es ? "Horas de Conexión" : "Supply Hours",
      real: taxiAct.sh + tkAct.sh, proj: taxiProj.sh + tkProj.sh,
      goal: (meta.mH || 0) + (meta.mtkSH || 0), fmtN: fmtSmart }
  ];
  const cards = defs.map(d => d.goal > 0
    ? _p2MetaCard(d.label, d.real, d.goal, d.proj, d.fmtN, es)
    : `<div style="flex:1;min-width:0;background:#fafafa;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;justify-content:center;gap:2px">
        <div style="font-size:.58rem;color:#aaa;font-weight:700;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(d.label)}</div>
        <div style="font-weight:900;font-size:1rem;color:#111">${d.fmtN(d.real)}</div>
        <div style="font-size:.6rem;color:#bbb">${es ? "Sin meta" : "No target"}</div>
      </div>`
  ).join("");

  const title = es ? "Avance vs Meta Combinado" : "Combined Goal vs Target";
  const sub   = es
    ? "Taxi + TukTuk sumados · barra = avance · marca negra = proyección"
    : "Taxi + TukTuk combined · bar = progress · black mark = projection";
  const noDataMsg = noMonthData
    ? (es ? `Sin datos de ${escapeHTML(mesName)} para comparar con la meta.` : `No data for ${escapeHTML(mesName)} to compare.`)
    : (es ? "Sin metas cargadas para este mes." : "No goals loaded for this month.");

  return `<div style="width:100%;height:100%;background:#fff;padding:12px 14px;display:flex;flex-direction:column;overflow:hidden">
    ${p2BrandHeader(partner, title + " · " + (mesName || "—"), sub, { text: es ? "🔀 COMBINADO" : "🔀 COMBINED", color: "#8b5cf6" })}
    ${noData
      ? `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:.9rem">${noDataMsg}</div>`
      : `<div style="display:flex;gap:8px;flex:1;min-height:0;align-items:stretch">${cards}</div>`}
    ${p2BrandFooter(idx)}
  </div>`;
}

// ── SLIDE: ALERTAS (NEXT STEPS) ───────────────────────────────────────────────
// Señales automáticas por nivel. Thresholds tunables (decisión de negocio).
const P2_ALERT_THRESHOLDS = {
  wowDropCity: -5,      // % WoW de caída de AD en ciudad → alerta
  retMin: 0.85,         // retención mínima (general)
  retLargeMin: 0.85,    // retención mínima parks grandes
  smallParkAD: 20, midParkAD: 100,
  smallShPerAdMin: 15,     // SH/AD (horas/conductor) mínimo park chico
  midTripsPerAdMin: 20     // Trips/AD (viajes/conductor) mínimo park medio
};
function p2ComputeAlerts(partner, dates) {
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
function p2GroupAlerts(alerts) {
  const groups = new Map();
  alerts.forEach(a => {
    const k = `${a.sev}|||${a.kind}`;
    if (!groups.has(k)) groups.set(k, { sev: a.sev, title: a.title, items: [] });
    groups.get(k).items.push({ level: a.level, detail: a.detail });
  });
  return [...groups.values()];
}
function buildSlide2Alerts(partner, dates, idx) {
  const es = PRESENT2_STATE.lang === "es";
  // P2_ALERT_THRESHOLDS (retención 85%, SH/AD, Trips/AD) está calibrado para cadencia
  // SEMANAL. Aplicado tal cual en Mensual/Diario dispara falsas alarmas partner-facing (ej.
  // un 82% de retención MENSUAL no es comparable a un 82% semanal). En vez de inventar
  // multiplicadores sin validar con datos reales, se restringe la slide a Semanal (ver auditoría).
  if (STATE.curMode !== "semanal") {
    const msg = es
      ? "Alertas disponibles solo en escala Semanal (los umbrales están calibrados para esa cadencia)."
      : "Alerts available only at Weekly scale (thresholds are calibrated for that cadence).";
    return `<div style="width:100%;height:100%;background:#fff;padding:12px 14px;display:flex;flex-direction:column;overflow:hidden">
      ${p2BrandHeader(partner, es ? "Alertas / Next Steps" : "Alerts / Next Steps", es ? "Señales automáticas para accionar con el partner" : "Automatic signals to act on with the partner")}
      <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:.9rem">${msg}</div>
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
        const chips = g.items.map(it => `<span style="display:inline-block;white-space:nowrap;background:#fff;border:1px solid #eee;border-radius:14px;padding:2px 9px;font-size:.72rem;margin:2px 4px 2px 0"><b style="color:#333">${escapeHTML(it.level)}</b>${it.detail ? ` <span style="color:#666">${escapeHTML(it.detail)}</span>` : ""}</span>`).join("");
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;background:${sevColor(g.sev)}12;border-left:4px solid ${sevColor(g.sev)};border-radius:8px;margin-bottom:7px">
          <span style="font-size:.6rem;font-weight:800;color:#fff;background:${sevColor(g.sev)};padding:2px 7px;border-radius:10px;white-space:nowrap;margin-top:2px">${sevLabel(g.sev)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;color:#111;font-size:.82rem;margin-bottom:4px">${escapeHTML(g.title)}</div>
            <div>${chips}</div>
          </div>
        </div>`;
      }).join("")
    : `<div style="padding:14px;background:#f0fdf4;border:1px solid #10b981;border-radius:10px;color:#065f46;font-weight:700">✓ ${es ? "Sin alertas — todo dentro de rango." : "No alerts — all within range."}</div>`;
  return `<div style="width:100%;height:100%;background:#fff;padding:12px 14px;display:flex;flex-direction:column;overflow:hidden">
    ${p2BrandHeader(partner, es ? "Alertas / Next Steps" : "Alerts / Next Steps", es ? "Señales automáticas para accionar con el partner" : "Automatic signals to act on with the partner")}
    <div style="flex:1;min-height:0;overflow:auto">${items}</div>
    ${p2BrandFooter(idx)}
  </div>`;
}

// ── SLIDE: PROYECCIÓN (pronóstico 3 meses + palancas de crecimiento) ───────────
// Usa el motor puro forecast.js sobre la serie MENSUAL deduplicada (STATE.rawDataMensual
// vía p2Vals). Ignora el `dates` tail-4 del deck y toma TODO el historial con p2AllDates().
// Solo tiene sentido en escala mensual → gate como buildSlide2Alerts.
const P2_FC_KPIS = [
  { key: "ad",    es: "Conductores Activos", en: "Active Drivers", color: "#FF0000", kind: "num"  },
  { key: "sh",    es: "Horas de Conexión",   en: "Supply Hours",   color: "#8b5cf6", kind: "numK" },
  { key: "gmv",   es: "GMV",                 en: "GMV",            color: "#0ea5e9", kind: "money" },
  { key: "trips", es: "Viajes",              en: "Trips",          color: "#10b981", kind: "num"  }
];
function _p2FcFmt(kind, v) {
  if (v == null || isNaN(v)) return "—";
  if (kind === "money") return "$" + fmtSmart(v);
  if (kind === "numK")  return fmtSmart(v);
  return fmt(Math.round(v));
}
// Serie mensual por KPI (Perú = Σ ciudades del partner) + inputs de palancas, desde el
// dataset activo. p2Vals suma ciudades por mes; para AD/autos (snapshot) la suma de niveles
// por ciudad ES el nivel Perú; para SH/GMV/viajes/N+R (flujos) la suma es el total.
function p2ForecastBundle(partner) {
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
function _p2FcDropLast(inp) { const o = {}; for (const k in inp) o[k] = Array.isArray(inp[k]) ? inp[k].slice(0, -1) : inp[k]; return o; }
// Meta de AD del mes más reciente cargado (Σ ciudades) para las "palancas hacia la meta".
function p2ForecastTargetAD(partner) {
  const rows = (STATE.metasData || []).filter(m => m.partner === partner && m.mA);
  if (!rows.length) return null;
  let best = null;
  rows.forEach(m => { const o = _metasMesOrden(m.mes); if (!best || o > best.o) best = { o, mes: m.mes }; });
  const sum = rows.filter(m => m.mes === best.mes).reduce((s, m) => s + (m.mA || 0), 0);
  return sum || null;
}
// Cómputo compartido por build y chartFn (mismo patrón que p2Metrics en matriz/charts).
function p2ForecastCompute(partner) {
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

function _p2FcMiniCard(label, value, hint, color, tip) {
  return `<div ${tip ? `title="${escapeHTML(tip)}"` : ""} style="flex:1;min-width:0;background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;padding:7px 9px;display:flex;flex-direction:column;gap:1px${tip ? ";cursor:help" : ""}">
    <div style="font-size:.55rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(label)}${tip ? ` <span style="color:#bbb;font-weight:900">ⓘ</span>` : ""}</div>
    <div style="font-weight:900;font-size:1rem;color:${color || "#111"}">${value}</div>
    <div style="font-size:.56rem;color:#999;line-height:1.15">${hint}</div>
  </div>`;
}
function _p2FcPalancasHTML(C, es) {
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
      onTrack ? "#10b981" : "#0891b2",
      es ? `Aunque tu meta de AD (${fmt(Math.round(C.target))}) sea parecida a hoy (${fmt(Math.round(L.adNow))}), cada mes se te van conductores por rotación (retención ${retA}). Para sostener/llegar a la meta necesitás ~${fmt(need)} nuevos+reactivados en el mes; hoy promediás ~${fmt(now)}${shortBy > 0 ? ` (te faltan ~${fmt(shortBy)})` : ""}. Alternativa: subir la retención de ${retA} a ${retB}.`
         : `Even if your AD goal (${fmt(Math.round(C.target))}) is close to today (${fmt(Math.round(L.adNow))}), churn takes drivers each month (retention ${retA}). To hold/reach it you need ~${fmt(need)} new+reactivated in the month; today you average ~${fmt(now)}${shortBy > 0 ? ` (short ~${fmt(shortBy)})` : ""}. Alternative: raise retention from ${retA} to ${retB}.`));
  }
  const title = es ? "Palancas de crecimiento" : "Growth levers";
  const subt = es ? "Lo que mueve tu # de Conductores Activos. La proyección de arriba asume que se mantienen — mejorá una y sube."
                  : "What moves your Active-Driver count. The forecast above assumes they hold — improve one and it rises.";
  return `<div style="flex:0 0 auto;margin-top:6px">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;flex-wrap:wrap">
      <span style="font-size:.6rem;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.4px">${title}</span>
      <span style="font-size:.56rem;color:#aaa">${escapeHTML(subt)}</span>
    </div>
    <div style="display:flex;gap:6px">${cards.join("")}</div>
  </div>`;
}
// Detalle solo-vivo para el KAM (NO va al PDF): método + precisión por KPI.
function _p2FcDetailHTML(C, es) {
  const chips = P2_FC_KPIS.map(k => {
    const r = C.fc[k.key];
    const acc = r.mape != null ? "±" + r.mape.toFixed(0) + "%" : "—";
    return `<span style="display:inline-block;background:#f4f4f4;border-radius:6px;padding:2px 7px;margin:0 4px 2px 0;font-size:.58rem;color:#555"><b>${escapeHTML(es ? k.es : k.en)}</b>: ${escapeHTML(fcMethodName(r.method, es))} · ${acc}</span>`;
  }).join("");
  return `<div style="flex:0 0 auto;margin-top:6px;border-top:1px dashed #eee;padding-top:5px">
    <div style="font-size:.55rem;color:#bbb;font-weight:700;text-transform:uppercase;margin-bottom:3px">${es ? "Detalle KAM (no se incluye en el PDF)" : "KAM detail (not in PDF)"}</div>
    <div>${chips}</div>
  </div>`;
}
function buildSlide2Forecast(partner, dates, idx) {
  const es = PRESENT2_STATE.lang === "es";
  const shell = inner => `<div style="width:100%;height:100%;background:#fff;padding:12px 14px;display:flex;flex-direction:column;overflow:hidden">
    ${p2BrandHeader(partner, (es ? "Proyección · próximos 3 meses" : "Forecast · next 3 months"),
      es ? "Qué esperar si la tendencia sigue igual — y qué mover para crecer" : "What to expect if the trend holds — and what to move to grow")}
    ${inner}
    ${p2BrandFooter(idx)}
  </div>`;
  if (STATE.curMode !== "mensual") {
    return shell(`<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:.9rem;text-align:center;padding:0 40px">${es ? "El pronóstico usa la serie MENSUAL. Cambia la escala a Mensual (arriba) para ver la proyección." : "The forecast uses the MONTHLY series. Switch the scale to Monthly to see it."}</div>`);
  }
  const C = p2ForecastCompute(partner);
  if (!C || C.histMonths.length < 4) {
    return shell(`<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:.9rem;text-align:center;padding:0 40px">${es ? "Se necesitan al menos 4 meses de historia para proyectar." : "At least 4 months of history are needed to forecast."}</div>`);
  }
  const cards = P2_FC_KPIS.map(k => {
    const r = C.fc[k.key];
    const last = r.history[r.history.length - 1];
    const f3 = r.forecast[r.forecast.length - 1];
    const growth = last ? (f3 - last) / last * 100 : null;
    const gcol = growth == null ? "#999" : growth >= 0 ? "#10b981" : "#FF0000";
    const gtxt = growth == null ? "" : (growth >= 0 ? "+" : "") + growth.toFixed(1) + "%";
    const acc = r.mape != null ? "±" + r.mape.toFixed(0) + "%" : "—";
    // Cada tarjeta es una celda del grid 2×2 (altura acotada por grid-template-rows:1fr) →
    // el canvas nunca se desborda sobre las palancas de abajo.
    return `<div style="min-width:0;min-height:0;overflow:hidden;background:#fff;border:1px solid #f0f0f0;border-radius:8px;padding:5px 8px;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:4px">
        <span style="display:flex;align-items:center;gap:5px;min-width:0"><span style="width:7px;height:7px;border-radius:50%;background:${k.color};flex-shrink:0"></span><span style="font-size:.6rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(es ? k.es : k.en)}</span></span>
        <span style="font-size:.62rem;font-weight:800;color:${gcol};background:${gcol}18;padding:1px 6px;border-radius:6px">${gtxt}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px">
        <span style="font-weight:900;font-size:.9rem;color:#111">${_p2FcFmt(k.kind, last)}</span>
        <span style="font-size:.58rem;color:#bbb">${es ? "hoy → 3m" : "now → 3m"}</span>
        <span style="font-weight:900;font-size:.9rem;color:${k.color}">${_p2FcFmt(k.kind, f3)}</span>
        <span style="font-size:.54rem;color:#ccc;margin-left:auto">${es ? "precisión" : "accuracy"} ${acc}</span>
      </div>
      <div style="flex:1;min-height:0;position:relative;width:100%"><canvas id="p2fc_${k.key}" style="width:100%;height:100%"></canvas></div>
    </div>`;
  }).join("");
  const partialNote = C.partial ? `<div style="flex:0 0 auto;background:#fffbeb;border:1px solid #fcd34d;border-radius:7px;padding:5px 9px;margin-bottom:5px;font-size:.62rem;color:#92400e;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span>⚠️ ${es ? "El último mes parece incompleto y se excluyó del pronóstico." : "The last month looks incomplete and was excluded from the forecast."}</span>
      ${PRESENT2_STATE._exporting ? "" : `<button onclick="present2ToggleInclPartial()" style="border:1px solid #f59e0b;background:${PRESENT2_STATE.fcInclPartial ? "#f59e0b" : "#fff"};color:${PRESENT2_STATE.fcInclPartial ? "#fff" : "#b45309"};border-radius:6px;padding:2px 8px;font-size:.58rem;font-weight:700;cursor:pointer;white-space:nowrap">${PRESENT2_STATE.fcInclPartial ? (es ? "Excluir" : "Exclude") : (es ? "Incluir último mes" : "Include last month")}</button>`}
    </div>` : "";
  // Leyenda + encuadre en lenguaje simple (qué es la proyección). Swatches inline-block
  // (seguros en el PDF). Incluye la validación (error del backtest) para dar confianza.
  const mapes = P2_FC_KPIS.map(k => C.fc[k.key].mape).filter(v => v != null);
  const avg = mapes.length ? mapes.reduce((s, v) => s + v, 0) / mapes.length : null;
  const nBack = Math.min(6, C.histMonths.length - Math.max(4, C.histMonths.length - 6));
  const sw = (style) => `<span style="display:inline-block;width:16px;height:0;border-top:2px ${style};vertical-align:middle;margin-right:5px"></span>`;
  const swSolid = sw("solid #888"), swDash = sw("dashed #888"), swUp = sw("dashed #10b981"), swDown = sw("dashed #ef4444");
  const legend = `<div style="flex:0 0 auto;display:flex;align-items:center;flex-wrap:wrap;margin-bottom:5px;font-size:.62rem;color:#666">
      <span style="display:inline-block;margin-right:14px;white-space:nowrap">${swSolid}${es ? `Real (${C.histMonths.length} meses)` : `Actual (${C.histMonths.length} mo.)`}</span>
      <span style="display:inline-block;margin-right:14px;white-space:nowrap">${swDash}${es ? "Proyección esperada" : "Expected forecast"}</span>
      <span style="display:inline-block;margin-right:14px;white-space:nowrap;color:#059669">${swUp}${es ? "Si crece (máx)" : "If grows (max)"}</span>
      <span style="display:inline-block;margin-right:14px;white-space:nowrap;color:#dc2626">${swDown}${es ? "Si decrece (mín)" : "If drops (min)"}</span>
      ${avg != null ? `<span style="display:inline-block;margin-right:14px;color:#10b981;font-weight:700;white-space:nowrap">✓ ${es ? `Validado con tus ${nBack} meses más recientes · ±${avg.toFixed(0)}%` : `Validated on your ${nBack} most recent months · ±${avg.toFixed(0)}%`}</span>` : ""}
      <span style="margin-left:auto;color:#999;font-style:italic">${es ? "Al ritmo actual — mové las palancas ↓ para cambiarla" : "At current pace — move the levers ↓ to change it"}</span>
    </div>`;
  const detail = PRESENT2_STATE._exporting ? "" : _p2FcDetailHTML(C, es);
  const expBanner = `<div style="flex:0 0 auto;background:#fef2f2;border:1px solid #fca5a5;border-radius:7px;padding:5px 10px;margin-bottom:6px;font-size:.62rem;color:#b91c1c;font-weight:700;display:flex;align-items:center;gap:8px">
      <span style="font-size:.9rem;line-height:1">🧪</span>
      <span>${es ? "EXPERIMENTAL · en validación — no compartir con partners aún. No se incluye en el PDF." : "EXPERIMENTAL · under validation — do not share with partners yet. Not included in the PDF."}</span>
    </div>`;
  return shell(`
    ${expBanner}
    ${partialNote}
    ${legend}
    <div style="flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:8px">${cards}</div>
    ${_p2FcPalancasHTML(C, es)}
    ${detail}`);
}
// Gráfico por KPI: historia (sólida) + proyección (punteada) + banda sombreada.
function p2ForecastChart(canvasId, labels, hist, fcObj, color, kind, root) {
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
  const UP = "#10b981", DN = "#ef4444";   // verde = si crece (máx) · rojo = si decrece (mín)
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
function buildSlide2ForecastCharts(partner, dates, root) {
  if (STATE.curMode !== "mensual") return;
  const C = p2ForecastCompute(partner);
  if (!C || C.histMonths.length < 4) return;
  const labels = C.histMonths.concat(C.futureMonths);
  P2_FC_KPIS.forEach(k => {
    const r = C.fc[k.key];
    p2ForecastChart(`p2fc_${k.key}`, labels, r.history, r, k.color, k.kind, root);
  });
}
function present2ToggleInclPartial() { PRESENT2_STATE.fcInclPartial = !PRESENT2_STATE.fcInclPartial; renderSlide2(); }

// ── RENDER PRINCIPAL (shell + slide activo) ───────────────────────────────────
function renderPresent2() {
  ensureIndexes();
  destroyPresent2Charts();
  const el = document.getElementById("present2Content");
  if (!el) return;
  // rawDataFull (no rawData) — así el guard no falla si TODO lo cargado resulta
  // ser tuktuk (rawData quedaría vacío tras la exclusión, pero sí hay data).
  if (!STATE.rawDataFull || !STATE.rawDataFull.length) {
    el.innerHTML = `<div class="empty"><p>Carga datos de <strong>Rendimiento</strong> para usar Presentación 2.0.</p></div>`;
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
    <div style="min-height:100vh;background:#f2f2f2;padding:20px;display:flex;flex-direction:column">
      <div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div style="position:relative">
          <label style="font-size:.72rem;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Partner</label>
          <input id="present2Search" type="text" class="sb-inp" style="width:220px" autocomplete="off" placeholder="${es ? "Buscar partner..." : "Search partner..."}" value="${escapeHTML(PRESENT2_STATE.partner)}" oninput="p2FilterPartners(this.value)" onfocus="p2ShowPartnerList()" onblur="setTimeout(p2HidePartnerList,200)" onkeydown="p2SearchKeydown(event)"/>
          <div id="present2PartnerList" style="display:none;position:absolute;top:100%;left:0;width:220px;max-height:280px;overflow-y:auto;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.12);z-index:100;margin-top:2px"></div>
        </div>
        <div>
          <label style="font-size:.72rem;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">${es ? "Idioma" : "Language"}</label>
          <div class="mode-toggle">
            <button class="mode-btn ${es ? "active" : ""}" onclick="setPresent2Lang('es')">ES</button>
            <button class="mode-btn ${!es ? "active" : ""}" onclick="setPresent2Lang('en')">EN</button>
          </div>
        </div>
        <div>
          <label style="font-size:.72rem;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">${es ? "Comparar con" : "Compare"}</label>
          <div id="present2CmpBar" style="display:flex;gap:6px;flex-wrap:wrap">${p2CmpBar()}</div>
        </div>
        <div>
          <label style="font-size:.72rem;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">${es ? "Vista" : "View"}</label>
          <div class="mode-toggle" title="${es ? "Auto respeta el flag Fleet de Configuración" : "Auto follows the Fleet flag in Config"}">
            <button class="mode-btn ${PRESENT2_STATE.fleetMode === "auto"  ? "active" : ""}" onclick="present2SetFleetMode('auto')">Auto</button>
            <button class="mode-btn ${PRESENT2_STATE.fleetMode === "taxi"  ? "active" : ""}" onclick="present2SetFleetMode('taxi')">${es ? "Taxi" : "Taxi"}</button>
            <button class="mode-btn ${PRESENT2_STATE.fleetMode === "fleet" ? "active" : ""}" ${canForceFleet ? `onclick="present2SetFleetMode('fleet')"` : `disabled style="opacity:.35;cursor:not-allowed"`} title="${canForceFleet ? "" : (es ? "Este partner no está marcado como Fleet" : "This partner isn't flagged as Fleet")}">Fleet</button>
          </div>
        </div>
        ${p2TuktukSectionVisible(PRESENT2_STATE.partner) ? `
        <div>
          <label style="font-size:.72rem;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">${es ? "Sección" : "Section"}</label>
          <div class="mode-toggle" id="present2SectionBar" title="${es ? "Salta a la sección Taxi o TukTuk del deck" : "Jump to the Taxi or TukTuk section"}">${_p2SectionBarHTML(curDs)}</div>
        </div>` : ""}
        ${p2MetaMeses().length ? `
        <div title="${es ? "Mes de la meta en 'Avance vs Meta'. Auto = el mes del 'Hasta'." : "Goal month for 'Goal vs Target'. Auto = the 'To' month."}">
          <label style="font-size:.72rem;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">${es ? "Mes meta" : "Goal month"}</label>
          <select onchange="present2SetAvanceMes(this.value)" style="border:2px solid #e5e5e5;border-radius:8px;padding:7px 10px;font-size:.82rem;font-weight:600;background:#fff;cursor:pointer;height:38px">
            <option value="">${es ? "Auto (según filtro)" : "Auto (by filter)"}</option>
            ${p2MetaMeses().map(m => `<option value="${escapeHTML(m)}" ${PRESENT2_STATE.avanceMesSel === m ? "selected" : ""}>${escapeHTML(m)}</option>`).join("")}
          </select>
        </div>` : ""}
        <div style="margin-left:auto;display:flex;gap:8px;align-items:flex-end">
          <button onclick="switchTab('rend')" style="padding:8px 16px;border-radius:8px;font-size:.82rem;font-weight:600;border:2px solid #e5e5e5;background:#fff;color:#555;cursor:pointer">← ${es ? "Volver" : "Back"}</button>
          <button class="apply-btn" style="width:auto;padding:8px 18px" onclick="downloadPresent2PDF()">⬇ ${es ? "Descargar PDF" : "Download PDF"}</button>
        </div>
      </div>
      <div id="present2Nav" style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        ${p2NavHTML()}
      </div>
      ${p2FreshnessWarn()}
      <div id="slide2Container" style="width:100%;aspect-ratio:16/9;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.12);overflow:hidden">
        <div id="slide2Inner" style="width:100%;height:100%"></div>
      </div>
    </div>`;

  renderSlide2();
}

function p2CmpBar() {
  const es = PRESENT2_STATE.lang === "es";
  const tog = PRESENT2_STATE.cohort || {};
  const cityBtn = `<button onclick="present2ToggleCity()" class="preset-btn${PRESENT2_STATE.cmpCity ? " active" : ""}" style="flex:0 0 auto;padding:4px 10px;${PRESENT2_STATE.cmpCity ? "background:#64748b;color:#fff;border-color:#64748b" : ""}">${es ? "Ciudad" : "City"}</button>`;
  const bands = P2_BANDS.map(b => {
    const on = tog[b.key];
    return `<button onclick="present2ToggleCohort('${b.key}')" class="preset-btn${on ? " active" : ""}" style="flex:0 0 auto;padding:4px 10px;${on ? `background:${b.color};color:#fff;border-color:${b.color}` : ""}">${escapeHTML(es ? b.es : b.en)}</button>`;
  }).join("");
  return cityBtn + bands;
}

// Igual que getSelectedDates (presentacion.js) pero sobre p2AllDates() — las fechas
// del DATASET + ESCALA activos (Taxi usa STATE.allDates; TukTuk sus propias fechas).
// Sin esto, la sección TukTuk se iteraba con las fechas de Taxi: si Taxi tiene un mes
// más nuevo que TukTuk (la flota tuktuk suele subirse con retraso), la última columna
// del deck TukTuk salía en 0 en el PDF. (Bug HIGH del review; espeja el window de
// getSelectedDates: mensual = últimos 4; semanal/diario = rango, con fallback.)
function p2SelectedDates(from, to, mode) {
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

function renderSlide2() {
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
function goSlide2(i) {
  PRESENT2_STATE.slide = i;
  const nav = document.getElementById("present2Nav");
  if (nav) nav.innerHTML = p2NavHTML();   // repinta el nav (tinte por sección Taxi/TukTuk)
  renderSlide2();
}
function prevSlide2() { goSlide2(Math.max(0, PRESENT2_STATE.slide - 1)); }
function nextSlide2() { goSlide2(Math.min((PRESENT2_STATE._deckLen || P2_SLIDES.length) - 1, PRESENT2_STATE.slide + 1)); }
// Cambio de partner: reset a la carátula y re-render del shell (el deck del nuevo
// partner puede tener otra longitud/secciones → hay que reconstruir el nav).
function onPresent2PartnerChange(p) { PRESENT2_STATE.partner = p; PRESENT2_STATE.slide = 0; renderPresent2(); }
function setPresent2Lang(l) { PRESENT2_STATE.lang = l; renderPresent2(); }
function present2ToggleCity() { PRESENT2_STATE.cmpCity = !PRESENT2_STATE.cmpCity; refreshPresent2Bar(); renderSlide2(); }
// Toggle Auto/Fleet/Taxi: re-renderiza el shell completo (el botón activo cambia
// de estilo) y el slide actual, para que la matriz recalcule con el set de KPIs correcto.
function present2SetFleetMode(mode) { PRESENT2_STATE.fleetMode = mode; renderPresent2(); }
// Mes META de "Avance vs Meta": "" → auto (según "Hasta"); nombre → fijo.
function present2SetAvanceMes(mes) { PRESENT2_STATE.avanceMesSel = mes || null; renderPresent2(); }
// Markup de los botones Taxi/TukTuk de la Sección (bar con id present2SectionBar).
// "just-active" dispara la animación CSS de pop al repintarse (ver styles.css).
function _p2SectionBarHTML(curDs) {
  return `
    <button class="mode-btn ${curDs === "taxi"   ? "active just-active" : ""}" onclick="present2JumpSection('taxi')">🚕 Taxi</button>
    <button class="mode-btn ${curDs === "tuktuk" ? "active just-active" : ""}" onclick="present2JumpSection('tuktuk')">🛺 TukTuk</button>`;
}
// Salta a la primera diapositiva de la sección (Taxi/TukTuk) del deck del partner.
// NO resetea el partner (arregla el bug de perder el partner al alternar). goSlide2
// no repinta este bar (solo #present2Nav y #slide2Inner) → lo hacemos aquí para que
// el botón activo se refleje y anime en cada click (antes quedaba visualmente inerte).
function present2JumpSection(ds) {
  const deck = p2Deck(PRESENT2_STATE.partner);
  const i = deck.findIndex(e => e.ds === ds);
  goSlide2(i < 0 ? 0 : i);
  const actualDs = (deck[PRESENT2_STATE.slide] || deck[0]).ds;
  const bar = document.getElementById("present2SectionBar");
  if (bar) bar.innerHTML = _p2SectionBarHTML(actualDs);
}
function present2ToggleCohort(k) {
  PRESENT2_STATE.cohort = PRESENT2_STATE.cohort || {};
  PRESENT2_STATE.cohort[k] = !PRESENT2_STATE.cohort[k];
  refreshPresent2Bar(); renderSlide2();
}
function refreshPresent2Bar() { const bar = document.getElementById("present2CmpBar"); if (bar) bar.innerHTML = p2CmpBar(); }
// Buscador autocomplete (patrón de Vista Partner): escribes → lista filtrada →
// click selecciona. NO cambia de partner al escribir. p2ActivePartners = lista del
// dataset activo (Fase 3 agregará tuktuk; hoy = STATE.allPartners).
function p2FilterPartners(q) { p2ShowPartnerList(); _p2PaintPartnerList(q); }
function p2ShowPartnerList() {
  const list = document.getElementById("present2PartnerList");
  if (!list) return;
  list.style.display = "block";
  if (!list.innerHTML) { const inp = document.getElementById("present2Search"); _p2PaintPartnerList(inp ? inp.value : ""); }
}
function p2HidePartnerList() { const l = document.getElementById("present2PartnerList"); if (l) l.style.display = "none"; }
function _p2PaintPartnerList(q) {
  const list = document.getElementById("present2PartnerList");
  if (!list) return;
  const lower = (q || "").toLowerCase().trim();
  const all = p2PartnerList();   // unión taxi + tuktuk (mismo criterio que el selector)
  const filtered = lower ? all.filter(p => p.toLowerCase().includes(lower)) : all;
  if (!filtered.length) { list.innerHTML = `<div style="padding:8px 12px;font-size:.78rem;color:#aaa">Sin coincidencias</div>`; return; }
  list.innerHTML = filtered.slice(0, 100).map(p => {
    const sel = p === PRESENT2_STATE.partner;
    // data-partner (leído via this.dataset.partner) en vez de inyectar el nombre crudo en el
    // string JS del onmousedown: un partner con comilla doble/backslash rompía el click o
    // podía inyectar un atributo HTML (el .replace solo escapaba comilla simple). dataset.*
    // decodifica el atributo HTML sin pasar por un parser de string JS → sin ese riesgo.
    return `<div class="pv-opt" data-partner="${escapeHTML(p)}" onmousedown="p2SelectPartner(this.dataset.partner)" style="padding:7px 12px;font-size:.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid #f3f3f3;${sel ? "background:#fff0f0;font-weight:700" : ""}">
      <span style="width:7px;height:7px;border-radius:50%;background:#FF0000;flex-shrink:0"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(p)}</span></div>`;
  }).join("");
}
function p2SelectPartner(p) {
  // onmousedown corre ANTES del onblur del input (que oculta la lista).
  const inp = document.getElementById("present2Search"); if (inp) inp.value = p;
  p2HidePartnerList(); onPresent2PartnerChange(p);
}
function p2SearchKeydown(e) {
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
async function downloadPresent2PDF() {
  const partner = PRESENT2_STATE.partner;
  if (!partner) { alert("Selecciona un partner primero."); return; }
  if (!window.jspdf || !window.html2canvas) { alert("Librerias PDF no disponibles."); return; }
  destroyPresent2Charts();
  await new Promise(r => setTimeout(r, 100));

  const es = PRESENT2_STATE.lang === "es";
  const from = document.getElementById("dateFrom") ? document.getElementById("dateFrom").value : STATE.allDates[0];
  const to   = document.getElementById("dateTo")   ? document.getElementById("dateTo").value   : STATE.allDates[STATE.allDates.length - 1];
  // dates se calcula POR SLIDE dentro del loop (dataset-aware): Taxi y TukTuk usan
  // cada uno sus propias fechas. No calcular acá (sería siempre las de Taxi).

  const prog = document.createElement("div");
  prog.style.cssText = "position:fixed;inset:0;background:rgba(255,255,255,.95);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px";
  prog.innerHTML = `<div style="width:36px;height:36px;border:4px solid #eee;border-top-color:#FF0000;border-radius:50%;animation:spin .7s linear infinite"></div><div id="p2Msg" style="font-weight:700;color:#333">${es ? "Generando PDF..." : "Generating PDF..."}</div>`;
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
    const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1280, 720] });
    for (let i = 0; i < deck.length; i++) {
      const entry = deck[i], s = entry.def;
      PRESENT2_STATE.dataset = entry.ds;   // scope por-slide (los accesores leen este global)
      const dates = p2SelectedDates(from, to, STATE.curMode);   // dataset-aware por slide
      const div = document.createElement("div");
      div.setAttribute("data-p2slide", "1");
      div.style.cssText = `position:fixed;left:${s.charts ? "0" : "-9999px"};top:0;width:1280px;height:720px;overflow:hidden;background:#fff;z-index:99998`;
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
      const canvas = await html2canvas(div, { width: 1280, height: 720, scale: 4, useCORS: true, logging: false });
      if (s.charts) {
        div.querySelectorAll("canvas").forEach(c => { const ch = Chart.getChart(c); if (ch) ch.destroy(); });
        PRESENT2_STATE.charts = [];
      }
      try { if (div.parentNode) document.body.removeChild(div); } catch (e) {}
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 1280, 720);
    }
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
