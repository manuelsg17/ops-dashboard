//@ts-nocheck
// partnerPortal.js — Vista para PARTNERS externos (Track C2).
//
// Superficie deliberadamente reducida: un partner ve SU desempeño y SUS metas,
// nada más. No hay Data Raw, Configuración, Calculadora, selector de partners,
// export CSV ni comparativas contra otros partners.
//
// DÓNDE ESTÁ LA SEGURIDAD REAL: en RLS (migración 2026-07-24_partner_portal_rls).
// Cuando el JWT tiene role='partner', Postgres solo devuelve filas de los CLIDs
// mapeados en partner_users — el recorte NO lo hace este archivo. Esta UI es
// conveniencia: aunque alguien fuerce el render desde DevTools, o llame a
// PostgREST a mano, no puede ver datos de otro partner. Por eso acá no hay
// (ni debe haber) ningún filtro "where clid = ..." de seguridad: sería teatro.
//
// Corolario práctico: STATE.rawData YA viene recortado para un partner, así que
// los agregados de abajo son "su total" sin filtrar nada explícitamente.
//
// Diseño (Ola 6, sep-2026): es lo que ve alguien de AFUERA de la empresa, así
// que es la pantalla más cuidada y la que menos información interna muestra
// (nada de KAMs, frescura de ingesta, jerga de columnas). Sistema de diseño:
// tarjetas ui-kpi con delta, barras ui-progress contra la meta, gráficos con
// chartTheme (paleta categórica de los tokens) y estilos en
// src/styles/views/portal.css (prefijo pp-).

import { registerActions } from "./shared/actions.js";
import { t, mesLabel, getLang } from "./core/i18n";
import { logAccess } from "./shared/accessLog.js";
import { stampPDF } from "./shared/pdfmeta.js";
import { ensurePdfLibs } from "./shared/lazyLibs.js";
import { opcionesCapturaClara, tokenClaro } from "./shared/exportClaro";
// Mismo núcleo de cálculo que Metas, Rendimiento y el deck: el partner tiene que
// ver EXACTAMENTE los números que su KAM le presenta.
import { seriesByDate, projectFlow, ratio, tasaPonderada } from "./domain/metrics.js";
import { reportYM, diasMesReporte, MES_NOMBRES } from "./shared/mesReporte.js";
import { datasetLinea } from "./shared/escala.js";
import { dn } from "./shared/huella";
import { metaTasaPonderada } from "./domain/metaTasa";
import { esMesEnCurso } from "./domain/mesEnCurso";
import { escalaLista, reintentarCuandoEscalaLista } from "./shared/escalaLista";
import { fechaLocalISO } from "./shared/fechaLocal";
import { delta, badge, goalTone, emptyState, icon } from "./shared/ui";
import { apexBase, seriesColor, chartTokens } from "./shared/chartTheme";
import { alertDialog } from "./shared/confirmDialog";
import { ensureFullRendColumns, ensurePartnerLogos } from "./data.js";
import { ensureApex } from "./charts.js";
import { ChartRegistry } from "./core/chartRegistry.js";

export const PORTAL_STATE = { city: "all", line: "comb" };

// ── LÍNEAS DE NEGOCIO ────────────────────────────────────────────────────────
// Mismo criterio que Rendimiento/Metas: Fleet ⊂ Agregador (sus autos hacen Taxi)
// y TukTuk es disjunto de Taxi. Solo se ofrecen las líneas en las que ESTE
// partner tiene datos — mostrarle una pestaña "TukTuk" vacía a quien no opera
// TukTuk es ruido.
// Texto: t("portal.linea.<k>") y t("portal.linea.<k>Tip").
export const PORTAL_LINES = [
  { k: "comb",  icon: "chart-bar" },
  { k: "agg",   icon: "taxi" },
  { k: "fleet", icon: "car" },
  { k: "tk",    icon: "tuktuk" }
];

function _portalDataset(line) {
  // Slice por ESCALA (3, no 2) — resuelto en shared/escala.ts, con tests.
  // Acá importa el doble: el portal es lo que ve el PARTNER, así que un slice de
  // otra escala es un número equivocado mostrado fuera de la empresa.
  return datasetLinea(STATE, line);
}

// Línea activa, degradada si la elegida no tiene datos (o si la escala diaria no
// trae sub-flota, igual que en el resto del dashboard).
function _portalLine() {
  let line = PORTAL_STATE.line || "comb";
  // (El guard que forzaba "agg" en diario se retiró: el export diario ya trae
  //  db_id, así que Fleet/TukTuk/Combinado funcionan en las 3 escalas.)
  if (!_portalDataset(line).length) line = "agg";
  return line;
}

function _portalAvailableLines() {
  return PORTAL_LINES.filter(l => l.k === "agg" || _portalDataset(l.k).length);
}

// Selector de línea: control segmentado del sistema de diseño. Se arma a mano
// (no con ui.segmented) porque la acción lee `data-line` — es el contrato que
// usan app.ts y la huella de números (scripts/huella/huella.js).
function _portalLineToggle() {
  const avail = _portalAvailableLines();
  if (avail.length < 2) return "";   // sin alternativas, el selector sobra
  const cur = _portalLine();
  return `<div class="ui-segmented" role="group" aria-label="${escapeHTML(t("portal.linea.aria"))}">${
    avail.map(l => `<button type="button" class="ui-segmented__btn" aria-pressed="${cur === l.k}"
      title="${escapeHTML(t(`portal.linea.${l.k}Tip`))}" data-act="portalSetLine" data-line="${l.k}">${icon(l.icon, { size: 14 })}<span>${escapeHTML(t(`portal.linea.${l.k}`))}</span></button>`).join("")
  }</div>`;
}

// ¿La sesión actual es de un partner externo?
export function isPartnerSession() {
  return STATE.userRole === "partner";
}

// Filas del rango elegido (mismo criterio de fechas que el resto del dashboard).
function _portalRows(line) {
  const from = document.getElementById("dateFrom")?.value || "";
  const to   = document.getElementById("dateTo")?.value   || "";
  return _portalDataset(line || _portalLine()).filter(r =>
    (!from || r.date >= from) && (!to || r.date <= to) &&
    (PORTAL_STATE.city === "all" || r.city === PORTAL_STATE.city)
  );
}

// Serie por período de una métrica (Σ ciudades/sub-flotas por fecha).
function _portalSeries(rows, fn) {
  const by = {};
  rows.forEach(r => { by[r.date] = (by[r.date] || 0) + (fn(r) || 0); });
  return { dates: Object.keys(by).sort(), values: seriesByDate(by) };
}

// Variación en % entre un período y el anterior. null cuando no hay base de
// comparación — un "0%" ahí sería mentira, no un dato neutro.
function _portalWow(cur, prev) {
  if (prev == null || prev === 0 || cur == null) return null;
  return ((cur - prev) / prev) * 100;
}
function _wowCell(pct) {
  return `<td class="ui-num">${delta(pct, { naLabel: "—" })}</td>`;
}

function _sum(rows, fn) { return rows.reduce((s, r) => s + (fn(r) || 0), 0); }

// Aceptación (%) ponderada por viajes, solo sobre las filas que traen la tasa.
// null = ninguna fila la trae: se muestra "—", no 0%.
function _portalAccept(rows) {
  const v = tasaPonderada(rows.map(r => [r.acceptanceRate, r.trips]));
  return v == null ? null : v * 100;
}

// KPI del último período (snapshot) + período anterior, para el delta.
function _portalKpis(rows) {
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const last  = dates[dates.length - 1] || "";
  const prev  = dates[dates.length - 2] || "";
  const lastRows = rows.filter(r => r.date === last);
  const prevRows = rows.filter(r => r.date === prev);
  const nr = rs => _sum(rs, r => r.newPartner + r.newService + r.reactivated);
  return {
    last, prev, dates,
    // Conductores activos es un SNAPSHOT: el valor del rango es el del último
    // período, NO la suma (tener 100 activos 4 semanas seguidas es 100, no 400).
    ad:   _sum(lastRows, r => r.activeDrivers),
    adP:  _sum(prevRows, r => r.activeDrivers),
    nr:   nr(rows),            // acumulado del rango
    nrL:  nr(lastRows), nrP: nr(prevRows),
    sh:   _sum(rows,     r => r.supplyHours),
    shL:  _sum(lastRows, r => r.supplyHours),
    shP:  _sum(prevRows, r => r.supplyHours),
    tr:   _sum(rows,     r => r.trips || 0),
    trL:  _sum(lastRows, r => r.trips || 0),
    trP:  _sum(prevRows, r => r.trips || 0)
  };
}

// Delta del KPI con la MISMA semántica que bdgMode() (data.ts), que es la que
// tenía el portal: en diario no se compara (día contra día no aporta), sin base
// o sin dato → "N/A", base 0 con actual > 0 → "Nuevo".
function _deltaHtml(actual, previo) {
  if (STATE.curMode === "diario") return "";
  if (previo == null || actual == null) return delta(null, { naLabel: "N/A" });
  if (previo === 0) return actual > 0 ? badge(t("portal.nuevo"), "info") : delta(null, { naLabel: "—" });
  return delta(((actual - previo) / previo) * 100);
}

function _prevLabel() {
  const k = STATE.curMode === "mensual" ? "rend.cmp.mesAnterior" : STATE.curMode === "diario" ? "rend.cmp.diaAnterior" : "rend.cmp.semAnterior";
  return t("rend.cmp.vs", { p: t(k) });
}

// Tarjeta KPI del sistema de diseño (misma estructura que ui.kpiCard) con la
// clave de la huella de números en el VALOR. kpiCard() no la puede llevar: su
// valor es texto escapado. numKey: shared/huella.ts.
function _kpiCard(label, sub, valor, actual, previo, fmtFn = fmt, numKey = "") {
  const d = _deltaHtml(actual, previo);
  return `<div class="ui-kpi">
      <div class="ui-kpi__label">${escapeHTML(label)}</div>
      <div class="ui-kpi__row"><span class="ui-kpi__value"${numKey ? dn(numKey) : ""}>${fmtFn(valor)}</span>
        ${d ? `<span class="ui-kpi__delta">${d}<span class="ui-kpi__prev">${escapeHTML(_prevLabel())}</span></span>` : ""}
      </div>
      <div class="ui-kpi__sub">${escapeHTML(sub)}</div>
    </div>`;
}

// Encabezado de sección (h2 + bajada). Sin iconos de color: la jerarquía la
// dan el tamaño y el peso, no un arcoíris.
function _secH(title, sub, right = "") {
  return `<div class="pp-sec__head"><div><h2 class="pp-sec__title">${title}</h2>${sub ? `<p class="pp-sec__sub">${sub}</p>` : ""}</div>${right}</div>`;
}

// Nombre del mes dentro de una frase ("de la meta de septiembre"): en español y
// ruso los meses van en minúscula; en inglés, con mayúscula.
function _mesEnFrase(mes) {
  const s = mesLabel(mes) || "";
  return ({ es: 1, ru: 1 })[getLang()] ? s.toLocaleLowerCase() : s;
}

// Metas del mes vs actual — solo de los CLIDs del partner (RLS ya recortó
// metasData). Respeta la línea activa: en Combinado la meta es la suma de la
// meta Taxi + la meta TukTuk, igual que en la pestaña Metas del equipo.
function _portalMetas(line, rows) {
  const metas = STATE.metasData || [];
  if (!metas.length) return "";
  // B1: ordenar por año*100+mes con el año más reciente de cada nombre de mes
  // (sin año, ENERO quedaba detrás de DICIEMBRE del año anterior).
  const maxAnio = new Map();
  metas.forEach(m => { if (m.mes && m.mYear != null && !(maxAnio.get(m.mes) >= m.mYear)) maxAnio.set(m.mes, m.mYear); });
  const meses = [...new Set(metas.map(m => m.mes))].filter(Boolean)
    .sort((a, b) => _metasMesOrden(b, maxAnio.get(b) ?? null) - _metasMesOrden(a, maxAnio.get(a) ?? null));
  if (!meses.length) return "";
  // BUG REAL (auditoría ago 2026): antes se tomaba SIEMPRE el mes con meta más
  // reciente cargada (meses[0]), ignorando qué rango está viendo el partner —
  // si el admin ya cargó las metas del mes siguiente, el portal comparaba el
  // rango visto contra la meta de OTRO mes, y el deck (que sí usa el mes del
  // "Hasta", ver p2AvanceMes en presentacion2.ts) mostraba algo distinto para
  // el mismo partner. Misma regla acá: mes del "Hasta" si tiene meta cargada,
  // si no el más reciente disponible.
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const lastAll = dates[dates.length - 1] || "";
  let mes = meses[0];
  if (lastAll) {
    const mn = reportYM(lastAll, STATE.curMode, parseLocalDate).m;
    const name = MES_NOMBRES[mn - 1];
    if (name && meses.includes(name)) mes = name;
  }
  // Año del mes elegido (el más reciente si hay ambigüedad) — mismo criterio
  // que metas.ts _metasMatchMes: una fila sin año conocido no se descarta.
  const metaAños = metas.filter(m => m.mes === mes && m.mYear != null).map(m => m.mYear);
  const mesYearSel = metaAños.length ? Math.max(...metaAños) : null;
  const delMes = metas.filter(m => m.mes === mes &&
    (mesYearSel == null || m.mYear == null || m.mYear === mesYearSel) &&
    (PORTAL_STATE.city === "all" || m.city === PORTAL_STATE.city));

  // Actuals recortados A ESE MES (MTD), no al rango completo del sidebar —
  // antes nrAct/shAct sumaban TODO el rango elegido (puede cruzar 2+ meses)
  // contra una meta mensual, inflando el % de cumplimiento.
  const rowsMes = rows.filter(r => {
    const rym = reportYM(r.date, STATE.curMode, parseLocalDate);
    return MES_NOMBRES[rym.m - 1] === mes && (mesYearSel == null || rym.y === mesYearSel);
  });
  const datesMes = [...new Set(rowsMes.map(r => r.date))].sort();
  const last  = datesMes[datesMes.length - 1] || "";
  const adAct = _sum(rowsMes.filter(r => r.date === last), r => r.activeDrivers);
  const nrAct = _sum(rowsMes, r => r.newPartner + r.newService + r.reactivated);
  const shAct = _sum(rowsMes, r => r.supplyHours);
  const adSerie = _portalSeries(rowsMes, r => r.activeDrivers).values;
  // rowsMes se arma con reportYM, así que los días también salen del mes de
  // REPORTE: con calcProjectionDays (mes calendario) la semana del 29-jun daba
  // los 30 días de junio bajo la meta de julio. Ver diasMesReporte.
  const { daysElapsed, daysRemaining } = diasMesReporte(last, STATE.curMode, parseLocalDate);
  // Decisión 4 (Manuel, 23-sep-2026): la proyección al cierre SOLO para el mes
  // en curso — un mes cerrado "no logrará más avances". Regla única en
  // domain/mesEnCurso.ts (la misma de Metas y del deck).
  const anioMes = mesYearSel != null ? mesYearSel
    : (last ? reportYM(last, STATE.curMode, parseLocalDate).y : null);
  const proyOn = esMesEnCurso(MES_NOMBRES.indexOf(mes) + 1, anioMes);
  const mesFrase = escapeHTML(_mesEnFrase(mes));

  // Qué meta aplica según la línea. `null` = ese KPI no tiene meta cargada para
  // esta línea (distinto de meta 0).
  // META PARAGUAS: mA/mNR/mH ya cubren Taxi + TukTuk juntos (ago 2026), así que
  // el Combinado NO les suma meta_tk_*. Sumarlas contaba el objetivo de TukTuk
  // dos veces y hundía el cumplimiento que ve el PARTNER: agosto-2026,
  // TRANSPOTAXI Lima, plan de N+R 651 → 1.015 (+56%). El deck ya usaba el
  // paraguas; acá y en la pestaña Metas se había quedado la suma vieja.
  // `meta_tk_nr` sigue viva como meta del CRITERIO TukTuk (línea "tk").
  const pick = (taxi, tk) => (line === "tk" ? tk : taxi);
  const sumOrNull = (fn) => {
    let t = null;
    delMes.forEach(m => { const v = fn(m); if (v != null) t = (t || 0) + v; });
    return t;
  };
  const mA  = pick(sumOrNull(m => m.mA  || null), sumOrNull(m => m.mtkAD));
  const mNR = pick(sumOrNull(m => m.mNR || null), sumOrNull(m => m.mtkNR));
  const mH  = pick(sumOrNull(m => m.mH  || null), sumOrNull(m => m.mtkSH));

  // Fleet mide TASAS, no cantidades: su bloque de metas es distinto.
  if (line === "fleet") {
    const owned = _sum(rows, r => r.ownedFleetActiveCars || 0);
    const intSh = _sum(rows, r => r.internalFleetSh || 0);
    const shCar  = ratio(intSh, owned);
    const accept = _portalAccept(rows);
    // Las metas de tasa se re-ponderan por el peso de CADA unidad (partner,
    // ciudad), igual que la pestaña Metas (_metasAggKpi): autos para SH/auto y
    // utilización, viajes para aceptación.
    // B6 (sep-2026): antes cada fila de meta llevaba el MISMO peso (el total del
    // partner) — un promedio simple disfrazado. 90%·100 autos + 50%·2 autos daba
    // 70% acá y ~89% en Metas: el partner veía otra meta que su KAM.
    const pesoU = new Map();
    rows.forEach(r => {
      const k = `${r.partner}|||${r.city}`;
      let e = pesoU.get(k);
      if (!e) { e = { owned: 0, trips: 0 }; pesoU.set(k, e); }
      e.owned += r.ownedFleetActiveCars || 0;
      e.trips += r.trips || 0;
    });
    const wMeta = (key, peso) => metaTasaPonderada(delMes, m => m[key],
      m => (pesoU.get(`${m.partner}|||${m.city}`) || {})[peso]);
    const mShCar = wMeta("mSHcar", "owned"), mAcc = wMeta("mAcc", "trips"), mUtil = wMeta("mUtil", "owned");
    if (mShCar == null && mAcc == null && mUtil == null) return "";
    return `<section class="pp-sec ui-card">` +
      _secH(t("portal.metasFlota", { m: escapeHTML(mesLabel(mes)) }), t("portal.metasFlotaSub")) +
      `<div class="pp-goals">
        ${_portalMetaRow(t("portal.shCarInterno"), shCar, mShCar, null, v => fmt(v), "portal.metas.fleet.shCar", mesFrase)}
        ${_portalMetaRow(t("portal.aceptacion"), accept, mAcc, null, v => fmt(v) + "%", "portal.metas.fleet.accept", mesFrase)}
        ${mUtil != null ? `<div class="pp-goal">
            <div class="pp-goal__head"><span class="pp-goal__label">${escapeHTML(t("portal.utilizacion"))}</span>
              <span class="pp-goal__nums"><strong${dn("portal.metas.fleet.util.meta")}>${fmt(mUtil)}%</strong></span></div>
            <div class="pp-goal__caption">${escapeHTML(t("portal.meta.soloMeta"))}</div>
          </div>` : ""}
      </div></section>`;
  }

  if (mA == null && mNR == null && mH == null) return "";
  const tit = line === "tk" ? "portal.metasTk" : line === "comb" ? "portal.metasComb" : "portal.metas";
  return `<section class="pp-sec ui-card">` +
    _secH(t(tit, { m: escapeHTML(mesLabel(mes)) }),
      proyOn ? t("portal.metasSubEnCurso") : t("portal.metasSubCerrado")) +
    `<div class="pp-goals">
      ${_portalMetaRow(t("metric.ad.label"), adAct, mA, proyOn ? projAD(adSerie, last) : null, fmt, `portal.metas.${line}.ad`, mesFrase)}
      ${_portalMetaRow(t("metric.nr.label"), nrAct, mNR, proyOn ? projectFlow(nrAct, daysElapsed, daysRemaining) : null, fmt, `portal.metas.${line}.nr`, mesFrase)}
      ${_portalMetaRow(t("metric.sh.label"), shAct, mH, proyOn ? projectFlow(shAct, daysElapsed, daysRemaining) : null, fmtSmart, `portal.metas.${line}.sh`, mesFrase)}
    </div></section>`;
}

// Fila meta-vs-actual: valor, barra de avance (ui-progress, mismos cortes que
// el resto de la app vía goalTone) con la proyección como franja clara, y un
// pie "83.2% de la meta de septiembre (3,343)".
function _portalMetaRow(label, act, meta, proj, fmtFn, numKey = "", mesFrase = "") {
  const _k = sfx => numKey ? dn(numKey, sfx) : "";   // huella de números
  if (meta == null || !meta) return "";
  // Sin actual medible (tasa sin dato en el rango): la meta se muestra, pero
  // sin barra ni % — un 0% se leería como incumplimiento total.
  if (act == null) return `
    <div class="pp-goal">
      <div class="pp-goal__head"><span class="pp-goal__label">${escapeHTML(label)}</span>
        <span class="pp-goal__nums"><strong${_k("real")}>—</strong></span></div>
      <div class="pp-goal__caption"><span>${t("portal.meta.sinDato", { v: `<span${_k("meta")}>${fmtFn(meta)}</span>` })}</span></div>
    </div>`;
  const p  = (act / meta) * 100;
  const pp = proj != null ? (proj / meta) * 100 : null;
  const tone = goalTone(p) || "bad";
  const toneP = goalTone(pp) || tone;
  const w = v => Math.max(0, Math.min(100, v)).toFixed(1);
  const cap = t("portal.meta.caption", {
    p: `<span class="pp-tone--${tone} pp-goal__pct"${_k("pct")}>${p.toFixed(1)}%</span>`,
    m: mesFrase,
    v: `<span${_k("meta")}>${fmtFn(meta)}</span>`
  });
  const proyTxt = pp != null ? `<span class="pp-goal__proj pp-tone--${toneP}">${t("portal.meta.proy", {
    v: `<strong${_k("proj")}>${fmtFn(proj)}</strong>`, p: `${pp.toFixed(1)}%`
  })}</span>` : "";
  return `
    <div class="pp-goal">
      <div class="pp-goal__head"><span class="pp-goal__label">${escapeHTML(label)}</span>
        <span class="pp-goal__nums"><strong${_k("real")}>${fmtFn(act)}</strong></span></div>
      <div class="ui-progress ui-progress--${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100"
        aria-valuenow="${Math.round(Math.max(0, Math.min(100, p)))}" aria-label="${escapeHTML(label)}">
        ${pp != null && pp > p ? `<div class="ui-progress__proj" style="width:${w(pp)}%"></div>` : ""}
        <div class="ui-progress__bar" style="width:${w(p)}%"></div>
      </div>
      <div class="pp-goal__caption"><span>${cap}</span>${proyTxt}</div>
    </div>`;
}

// ── Encabezado del informe (entra al PDF) ───────────────────────────────────
// El encabezado de la app ya dice "Tu desempeño" y el nombre del partner, pero
// el PDF solo captura #portalContent: sin esto el archivo no diría de quién es.
function _portalLogo(nombre) {
  const url = (STATE.partnerLogos || {})[nombre];
  if (url) return `<img class="pp-hero__logo" src="${escapeHTML(url)}" alt="">`;
  const ini = String(nombre || "").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
  return `<div class="pp-hero__logo pp-hero__logo--mono" aria-hidden="true">${escapeHTML(ini)}</div>`;
}

// Logos: carga diferida (data.ts), una vez por sesión. Si trae el logo de este
// partner se repinta; si no, queda el monograma.
let _logosPedidos = false;
function _pedirLogos(nombre) {
  if (_logosPedidos || STATE._logosCargados) return;
  _logosPedidos = true;
  ensurePartnerLogos().then(() => {
    if (STATE.curTab === "portal" && (STATE.partnerLogos || {})[nombre]) renderPartnerPortal();
  }).catch(() => { /* sin logo, monograma */ });
}

// Columnas diferidas (aceptación, autos propios, horas internas de flota…): el
// portal las pide él mismo. Antes dependía de la precarga en idle de app.ts, y
// un partner que arrancaba en mensual veía la aceptación en "—". Se pinta con
// lo que hay y se repinta cuando llegan (una vez por escala).
const _colsPedidas = {};
const _PENDIENTE = {};
function _pedirColumnas() {
  const mode = STATE.curMode || "semanal";
  if (_colsPedidas[mode]) return;
  _colsPedidas[mode] = true;
  const p = Promise.resolve(ensureFullRendColumns());
  // Solo se repinta si la carga estaba EN VUELO: si la precarga de app.ts ya las
  // había traído, repintar no cambia nada y solo pisa los gráficos a mitad de
  // su render. (race con una promesa ya resuelta = "ya estaba".)
  Promise.race([p, Promise.resolve(_PENDIENTE)]).then(v => {
    if (v !== _PENDIENTE) return;
    p.then(() => {
      if (STATE.curTab === "portal" && STATE.curMode === mode) renderPartnerPortal();
    });
  }).catch(() => { _colsPedidas[mode] = false; });
}

// ── Gráficos de evolución (chartTheme) ──────────────────────────────────────
function _merge(a, b) {
  if (Array.isArray(b) || b == null || typeof b !== "object") return b;
  const out = { ...(a && typeof a === "object" && !Array.isArray(a) ? a : {}) };
  Object.keys(b).forEach(k => { out[k] = _merge(out[k], b[k]); });
  return out;
}
// Eje X corto: "03/08" en semanal/diario (el año ya está en el encabezado),
// "09/2026" en mensual. Con la fecha completa ApexCharts las recortaba.
const _etiquetaEje = d => (d && d.length === 10) ? d2s(d).slice(0, 5) : d2s(d);
const _fmtEje = v => (v == null || !isFinite(v)) ? "—" : Math.abs(v) >= 10000 ? fmtSmart(v) : fmt(v);

function _portalChart(id, dates, name, values, color) {
  if (!window.ApexCharts) { ensureApex().then(() => _portalChart(id, dates, name, values, color)); return; }
  const el = document.getElementById(id);
  if (!el) return;
  // Sin ancho (pestaña todavía oculta, panel de filtros abriéndose en móvil)
  // ApexCharts dibuja con NaN: se espera a que el contenedor tenga tamaño.
  if (!el.getBoundingClientRect().width && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!el.isConnected) { ro.disconnect(); return; }
      if (el.getBoundingClientRect().width) { ro.disconnect(); _portalChart(id, dates, name, values, color); }
    });
    ro.observe(el);
    return;
  }
  const prev = STATE.charts && STATE.charts[id];
  if (prev) { try { prev.destroy(); } catch (e) { /* huérfano */ } delete STATE.charts[id]; }
  const opts = _merge(apexBase(), {
    chart: { type: "area", height: 220, animations: { enabled: false } },
    series: [{ name, data: values }],
    colors: [color],
    stroke: { width: 2, curve: "straight" },
    fill: { type: "gradient", gradient: { shadeIntensity: 0, opacityFrom: 0.18, opacityTo: 0.02, stops: [0, 100] } },
    markers: { size: dates.length <= 14 ? 3 : 0, strokeWidth: 0, hover: { size: 5 } },
    legend: { show: false },
    grid: { padding: { left: 8, right: 20 } },
    xaxis: { categories: dates.map(_etiquetaEje), labels: { rotate: 0, hideOverlappingLabels: true, trim: false } },
    yaxis: { labels: { formatter: _fmtEje }, forceNiceScale: true },
    tooltip: { y: { formatter: _fmtEje } }
  });
  const ch = new ApexCharts(el, opts);
  ch.render();
  if (STATE.charts) STATE.charts[id] = ch;
  ChartRegistry.register(id, ch);
}

// ── RENDER ───────────────────────────────────────────────────────────────────
export function renderPartnerPortal() {
  const box = document.getElementById("portalContent");
  if (!box) return;
  // B12: con la escala mensual guardada, curMode dice "mensual" desde el
  // arranque pero rawData sigue siendo el semanal hasta que termina la carga.
  // Antes se pintaban números SEMANALES con rótulos "mensual" y segundos
  // después cambiaban — delante del partner. Se espera al dataset correcto.
  if (!escalaLista(STATE)) {
    const esc = STATE.curMode === "mensual" ? "datos.cargandoMensual" : STATE.curMode === "diario" ? "datos.cargandoDiario" : "datos.cargandoSemanal";
    box.innerHTML = `<div class="pp">${emptyState({ title: t(esc), icon: "clock" })}</div>`;
    reintentarCuandoEscalaLista("portal", STATE, renderPartnerPortal, () => STATE.curTab === "portal");
    return;
  }
  _pedirColumnas();

  const line = _portalLine();
  const rows = _portalRows(line);
  const ciudades = [...new Set((STATE.rawData || []).map(r => r.city).filter(Boolean))].sort();

  // Barra de controles: línea + ciudad (solo si opera en más de una) + PDF.
  // data-html2canvas-ignore: no sale en el PDF (el encabezado ya dice qué línea
  // y escala se está viendo).
  const ciudadSel = ciudades.length > 1 ? `<label class="pp-toolbar__field">
      <span class="pp-toolbar__label">${escapeHTML(t("sidebar.ciudad"))}</span>
      <select class="ui-select ui-select--sm" data-act-change="portalSetCity">
        <option value="all">${escapeHTML(t("metas.todas"))}</option>
        ${ciudades.map(c => `<option value="${escapeHTML(c)}"${PORTAL_STATE.city === c ? " selected" : ""}>${escapeHTML(cityLabel(c))}</option>`).join("")}
      </select></label>` : "";
  const toolbar = (conPdf) => `<div class="pp-toolbar" data-html2canvas-ignore="true">
      ${_portalLineToggle()}${ciudadSel}
      ${conPdf ? `<button type="button" class="ui-btn ui-btn--primary ui-btn--sm pp-toolbar__pdf" id="portalPdfBtn" data-act="portalDownloadPDF">${icon("download", { size: 14 })}<span>${escapeHTML(t("portal.descargarPDF"))}</span></button>` : ""}
    </div>`;

  if (!rows.length) {
    box.innerHTML = `<div class="pp">${toolbar(false)}${emptyState({
      title: t("portal.sinDatos"), text: t("portal.sinDatosSub"), icon: "calendar"
    })}</div>`;
    return;
  }

  const k = _portalKpis(rows);
  const misPartners = [...new Set(rows.map(r => r.partner))].sort();
  // Dos formas: "último mes/día" vs "última semana" (concordancia de género), y
  // "vs el mes anterior" para la nota de la variación.
  const escalaN = t(STATE.curMode === "mensual" ? "portal.ultMes" : STATE.curMode === "diario" ? "portal.ultDia" : "portal.ultSemana");
  const cap = s => s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;

  // Título: normalmente 1-2 nombres (RLS recorta a los CLIDs del partner). Se
  // acota igual por robustez — un partner con muchos CLIDs bajo razones
  // sociales distintas no debe romper el encabezado.
  const titulo = misPartners.length > 3
    ? misPartners.slice(0, 3).map(escapeHTML).join(" · ") + ` <span class="pp-hero__more">${t("portal.yMas", { n: misPartners.length - 3 })}</span>`
    : (misPartners.map(escapeHTML).join(" · ") || t("portal.tuOperacion"));
  _pedirLogos(misPartners[0]);

  const fechas = [...new Set(rows.map(r => r.date))].sort();
  const rango = fechas.length > 1 ? `${d2s(fechas[0])} – ${d2s(fechas[fechas.length - 1])}` : d2s(fechas[0]);
  const lineaTxt = t(`portal.linea.${line}`);
  const ciudadTxt = PORTAL_STATE.city === "all" ? "" : ` · ${escapeHTML(cityLabel(PORTAL_STATE.city))}`;

  let html = `<div class="pp">` + toolbar(true);
  html += `<header class="pp-hero ui-card">
      ${_portalLogo(misPartners[0])}
      <div class="pp-hero__text">
        <h2 class="pp-hero__name">${titulo}</h2>
        <p class="pp-hero__meta">${escapeHTML(lineaTxt)} · ${escapeHTML(t(`mode.${STATE.curMode}`))}${ciudadTxt} · ${escapeHTML(t("portal.hero.rango", { r: rango }))}</p>
      </div>
      <div class="pp-hero__date"><span class="pp-hero__date-lbl">${escapeHTML(t("portal.hero.datosAl"))}</span><strong>${d2s(k.last)}</strong></div>
    </header>`;

  // ── KPIs ────────────────────────────────────────────────────────────────
  // Fleet tiene sus propios KPIs (tasas de flota); el resto de las líneas
  // comparte los cuatro de siempre.
  if (line === "fleet") {
    // Los KPIs de flota se muestran como SNAPSHOT del último período, igual que
    // en la pestaña Rendimiento del equipo — si acá se mostrara el ponderado del
    // rango completo, el partner vería un número distinto al que su KAM tiene en
    // pantalla para el mismo filtro, que es exactamente el tipo de discrepancia
    // que hay que evitar en una vista de cara al cliente.
    // (El bloque de metas de más abajo SÍ usa el acumulado del rango, porque ahí
    //  se compara contra un objetivo mensual — y está etiquetado como tal.)
    const dts  = [...new Set(rows.map(r => r.date))].sort();
    const dLast = dts[dts.length - 1], dPrev = dts[dts.length - 2];
    const rowsLast = rows.filter(r => r.date === dLast);
    const rowsPrev = dPrev ? rows.filter(r => r.date === dPrev) : [];
    // OJO: acá estaba el bug de los "+0.0%" — se pasaba el MISMO valor como
    // actual y como anterior, así que el delta siempre comparaba un número
    // contra sí mismo. Ahora el período anterior se calcula de verdad.
    const fl = rs => {
      const owned = _sum(rs, r => r.ownedFleetActiveCars || 0);
      return {
        owned,
        branded: _sum(rs, r => r.brandedActiveCars || 0),
        shCar:   ratio(_sum(rs, r => r.internalFleetSh || 0), owned),
        accept:  _portalAccept(rs)
      };
    };
    const now = fl(rowsLast), prev = fl(rowsPrev);
    html += `<div class="ui-kpi-grid pp-kpis">
      ${_kpiCard(t("portal.autosPropios"), cap(escalaN), now.owned, now.owned, prev.owned, fmt, "portal.kpi.fleet.owned")}
      ${_kpiCard(t("metas.brandeados"), cap(escalaN), now.branded, now.branded, prev.branded, fmt, "portal.kpi.fleet.branded")}
      ${_kpiCard(t("portal.shCarInterno"), cap(escalaN), now.shCar, now.shCar, prev.shCar, v => fmt(v), "portal.kpi.fleet.shCar")}
      ${_kpiCard(t("portal.aceptacion"), `${cap(escalaN)} · ${t("portal.ponderadaViajes")}`, now.accept, now.accept, prev.accept, v => v == null ? "—" : fmt(v) + "%", "portal.kpi.fleet.accept")}
    </div>`;
  } else {
    html += `<div class="ui-kpi-grid pp-kpis">
      ${_kpiCard(t("metric.ad.label"), cap(escalaN), k.ad,  k.ad,  k.adP, fmt, `portal.kpi.${line}.ad`)}
      ${_kpiCard(t("metric.nr.label"), cap(t("portal.acumRango")), k.nr, k.nrL, k.nrP, fmt, `portal.kpi.${line}.nr`)}
      ${_kpiCard(t("metric.sh.label"), cap(t("portal.acumRango")), k.sh, k.shL, k.shP, fmtSmart, `portal.kpi.${line}.sh`)}
      ${_kpiCard(t("metric.tr.label"), cap(t("portal.acumRango")), k.tr, k.trL, k.trP, fmtSmart, `portal.kpi.${line}.tr`)}
    </div>`;
  }
  html += `<p class="pp-note">${escapeHTML(line === "fleet" ? t("portal.notaFleet") : t("portal.tituloSub", { e: escalaN }))}</p>`;

  html += _portalMetas(line, rows);

  // ── Evolución: una gráfica por KPI, color fijo por KPI (paleta de tokens) ─
  const charts = line === "fleet"
    ? [{ id: "portalChAd",  label: t("portal.autosPropios"),  fn: r => r.ownedFleetActiveCars || 0 },
       { id: "portalChNr",  label: t("metas.brandeados"),     fn: r => r.brandedActiveCars || 0 },
       { id: "portalChSh",  label: t("portal.horasInternas"), fn: r => r.internalFleetSh || 0 },
       { id: "portalChTr",  label: t("metric.tr.label"),      fn: r => r.trips || 0 }]
    : [{ id: "portalChAd",  label: t("metric.ad.label"),      fn: r => r.activeDrivers || 0 },
       { id: "portalChNr",  label: t("metric.nr.label"),      fn: r => (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0) },
       { id: "portalChSh",  label: t("metric.sh.label"),      fn: r => r.supplyHours || 0 },
       { id: "portalChTr",  label: t("metric.tr.label"),      fn: r => r.trips || 0 }];

  html += `<section class="pp-sec">` +
    _secH(t("portal.evolucion"), t("portal.evolucionSub", { e: escapeHTML(t(`mode.${STATE.curMode}`).toLocaleLowerCase()) })) +
    `<div class="pp-charts">${
      charts.map(c => `<div class="ui-card pp-chart">
        <div class="pp-chart__title">${escapeHTML(c.label)}</div>
        <div id="${c.id}" class="pp-chart__plot"></div></div>`).join("")
    }</div></section>`;

  // ── Detalle por período, con variación vs el período anterior ───────────
  html += `<section class="pp-sec">` +
    _secH(t("portal.detalle"), t("portal.detalleSub")) +
    `<div class="ui-table-wrap"><table class="ui-table ui-table--sticky-first pp-table"><thead><tr>
      <th>${escapeHTML(t("portal.th.periodo"))}</th>
      <th class="ui-num">${escapeHTML(t("portal.th.ad"))}</th><th class="ui-num">${escapeHTML(t("portal.th.var"))}</th>
      <th class="ui-num">${escapeHTML(t("portal.th.nr"))}</th><th class="ui-num">${escapeHTML(t("portal.th.var"))}</th>
      <th class="ui-num">${escapeHTML(t("portal.th.sh"))}</th><th class="ui-num">${escapeHTML(t("portal.th.var"))}</th>
      <th class="ui-num">${escapeHTML(t("metric.tr.label"))}</th><th class="ui-num">${escapeHTML(t("portal.th.var"))}</th>
    </tr></thead><tbody>`;
  const porFecha = new Map();
  rows.forEach(r => {
    let a = porFecha.get(r.date);
    if (!a) { a = { ad: 0, nr: 0, sh: 0, tr: 0 }; porFecha.set(r.date, a); }
    a.ad += r.activeDrivers || 0;
    a.nr += (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0);
    a.sh += r.supplyHours || 0;
    a.tr += r.trips || 0;
  });
  const fechasAsc = [...porFecha.keys()].sort();
  // Se recorre DESCENDENTE para mostrar lo más reciente arriba, pero la
  // variación se calcula contra el período inmediatamente ANTERIOR en el tiempo
  // (índice-1 del array ascendente), no contra la fila de abajo en pantalla.
  [...fechasAsc].reverse().forEach(d => {
    const v = porFecha.get(d);
    const i = fechasAsc.indexOf(d);
    const prev = i > 0 ? porFecha.get(fechasAsc[i - 1]) : null;
    html += `<tr>
      <td>${d2s(d)}</td>
      <td class="ui-num"${dn("portal.detalle.ad", d)}>${fmt(v.ad)}</td>${_wowCell(_portalWow(v.ad, prev && prev.ad))}
      <td class="ui-num"${dn("portal.detalle.nr", d)}>${fmt(v.nr)}</td>${_wowCell(_portalWow(v.nr, prev && prev.nr))}
      <td class="ui-num"${dn("portal.detalle.sh", d)}>${fmtSmart(v.sh)}</td>${_wowCell(_portalWow(v.sh, prev && prev.sh))}
      <td class="ui-num"${dn("portal.detalle.tr", d)}>${fmtSmart(v.tr)}</td>${_wowCell(_portalWow(v.tr, prev && prev.tr))}
    </tr>`;
  });
  html += `</tbody></table></div></section></div>`;

  box.innerHTML = html;

  // Charts: ApexCharts es lazy; _portalChart se re-encola solo si no llegó.
  const tk = chartTokens();
  charts.forEach((c, i) => {
    try {
      const s = _portalSeries(rows, c.fn);
      _portalChart(c.id, s.dates, c.label, s.values, seriesColor(i, tk));
    } catch (_) { /* el chart es accesorio: nunca romper la vista por él */ }
  });
}

export function portalSetLine(line) {
  PORTAL_STATE.line = line;
  renderPartnerPortal();
}

export function portalSetCity(city) {
  PORTAL_STATE.city = city;
  renderPartnerPortal();
}

// Export PDF del portal. Sellado con el email de la sesión + timestamp
// (shared/pdfmeta.js): si un partner reenvía el PDF, queda claro de qué cuenta
// salió y que es material de uso restringido.
export async function portalDownloadPDF() {
  logAccess("download_pdf", "portal");
  const content = document.getElementById("portalContent");
  if (!content) return;
  const btn = document.getElementById("portalPdfBtn");
  const lbl = btn && btn.querySelector("span");
  if (btn) { if (lbl) lbl.textContent = t("metas.generandoPDF"); btn.disabled = true; }
  try {
    await ensurePdfLibs();
    // Siempre claro (Ola 7): fondo = el de la app EN CLARO (antes se leía del
    // body, que con el tema oscuro daba un PDF negro) y la copia que captura
    // html2canvas va en claro, gráficos incluidos (exportClaro.ts).
    const bg = tokenClaro("--color-bg", "#f3f4f6");
    const canvas = await html2canvas(content, opcionesCapturaClara({ scale: 2, useCORS: true, logging: false, backgroundColor: bg }));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, canvas.width, canvas.height);
    stampPDF(pdf, t("portal.pdfTitulo"));
    pdf.save(`MiDesempeno_${fechaLocalISO()}.pdf`);
  } catch (err) {
    // Mensaje genérico a propósito: el portal es de cara externa, no le eco
    // detalles internos (payloads de Supabase, stacks) a un partner.
    if (DEBUG) console.error(err);
    await alertDialog({ title: t("portal.errPDFTitulo"), body: t("portal.errPDF"), tone: "bad" });
  } finally {
    if (btn) { if (lbl) lbl.textContent = t("portal.descargarPDF"); btn.disabled = false; }
  }
}

registerActions({
  portalSetCity: (d, el) => portalSetCity(el.value),
  portalSetLine: d => portalSetLine(d.line),
  portalDownloadPDF
});
