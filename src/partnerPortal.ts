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

import { registerActions } from "./shared/actions.js";
import { t } from "./core/i18n";
import { logAccess } from "./shared/accessLog.js";
import { stampPDF } from "./shared/pdfmeta.js";
import { ensurePdfLibs } from "./shared/lazyLibs.js";
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

export const PORTAL_STATE = { city: "all", line: "comb" };

// ── LÍNEAS DE NEGOCIO ────────────────────────────────────────────────────────
// Mismo criterio que Rendimiento/Metas: Fleet ⊂ Agregador (sus autos hacen Taxi)
// y TukTuk es disjunto de Taxi. Solo se ofrecen las líneas en las que ESTE
// partner tiene datos — mostrarle una pestaña "TukTuk" vacía a quien no opera
// TukTuk es ruido.
// Texto: t("portal.linea.<k>") y t("portal.linea.<k>Tip").
export const PORTAL_LINES = [
  { k: "comb",  emoji: "🔀" },
  { k: "agg",   emoji: "📊" },
  { k: "fleet", emoji: "🚗" },
  { k: "tk",    emoji: "🛺" }
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
  const diario = false;   // las 4 líneas ya funcionan en las 3 escalas
  return PORTAL_LINES.filter(l => l.k === "agg" || (!diario && _portalDataset(l.k).length));
}

function _portalLineToggle() {
  const avail = _portalAvailableLines();
  if (avail.length < 2) return "";   // sin alternativas, el selector sobra
  const cur = _portalLine();
  return `<div class="mode-toggle-row" style="margin-bottom:14px">${
    avail.map(l => `<button class="mode-btn${cur === l.k ? " active" : ""}"
      title="${escapeHTML(t(`portal.linea.${l.k}Tip`))}" data-act="portalSetLine" data-line="${l.k}">${l.emoji} ${t(`portal.linea.${l.k}`)}</button>`).join("")
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

// WoW en % entre los dos últimos valores de una serie. null cuando no hay base
// de comparación — un "0%" ahí sería mentira, no un dato neutro.
function _portalWow(cur, prev) {
  if (prev == null || prev === 0 || cur == null) return null;
  return ((cur - prev) / prev) * 100;
}
function _wowCell(pct) {
  if (pct == null) return `<td class="tn agy-style-90">—</td>`;
  const col = pct >= 0 ? "#10b981" : "#FF0000";
  return `<td class="tn"><span style="color:${col};font-weight:700">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span></td>`;
}

function _sum(rows, fn) { return rows.reduce((s, r) => s + (fn(r) || 0), 0); }

// Aceptación (%) ponderada por viajes, solo sobre las filas que traen la tasa.
// null = ninguna fila la trae: se muestra "—", no 0%.
function _portalAccept(rows) {
  const v = tasaPonderada(rows.map(r => [r.acceptanceRate, r.trips]));
  return v == null ? null : v * 100;
}

// KPI del último período (snapshot) + período anterior, para el badge.
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

// numKey (opcional): clave de la huella de números (shared/huella.ts).
function _kpiCard(label, sub, valor, actual, previo, color, fmtFn = fmt, numKey = "") {
  return `
    <div class="mcard" style="border-top:3px solid ${color}">
      <div class="mcard-label">${label}</div>
      <div class="mcard-sub-label">${sub}</div>
      <div class="mcard-val"${numKey ? dn(numKey) : ""}>${fmtFn(valor)}</div>
      <div class="agy-style-257">${bdgMode(actual, previo)}
        <span class="agy-style-258">${t("portal.vsAnterior")}</span>
      </div>
    </div>`;
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
    return secH("🎯", "#0284c7", t("portal.metasFlota", { m: escapeHTML(mes) }), t("portal.metasFlotaSub"), "") +
      `<div class="section">
        ${_portalMetaRow(t("portal.shCarInterno"), shCar, mShCar, null, v => fmt(v), "portal.metas.fleet.shCar")}
        ${_portalMetaRow(t("portal.aceptacion"), accept, mAcc, null, v => fmt(v) + "%", "portal.metas.fleet.accept")}
        ${mUtil != null ? `<div class="agy-style-196"><div class="agy-style-259">
            <span>${t("portal.utilizacion")}</span><span><strong${dn("portal.metas.fleet.util.meta")}>${fmt(mUtil)}%</strong> <span class="agy-style-89">${t("metas.metaSinActual")}</span></span>
          </div></div>` : ""}
      </div>`;
  }

  if (mA == null && mNR == null && mH == null) return "";
  const tit = line === "tk" ? "portal.metasTk" : line === "comb" ? "portal.metasComb" : "portal.metas";
  return secH("🎯", "#8b5cf6", t(tit, { m: escapeHTML(mes) }),
      proyOn ? t("portal.metasSubEnCurso") : t("portal.metasSubCerrado"), "") +
    `<div class="section">
      ${_portalMetaRow(t("metric.ad.label"), adAct, mA, proyOn ? projAD(adSerie, last) : null, fmt, `portal.metas.${line}.ad`)}
      ${_portalMetaRow(t("metric.nr.label"), nrAct, mNR, proyOn ? projectFlow(nrAct, daysElapsed, daysRemaining) : null, fmt, `portal.metas.${line}.nr`)}
      ${_portalMetaRow(t("metric.sh.label"), shAct, mH, proyOn ? projectFlow(shAct, daysElapsed, daysRemaining) : null, fmtSmart, `portal.metas.${line}.sh`)}
    </div>`;
}

// Fila meta-vs-actual con barra de avance y (si aplica) marca de proyección.
function _portalMetaRow(label, act, meta, proj, fmtFn, numKey = "") {
  const _k = sfx => numKey ? dn(numKey, sfx) : "";   // huella de números
  if (meta == null || !meta) return "";
  // Sin actual medible (tasa sin dato en el rango): la meta se muestra, pero
  // sin barra ni % — un 0% se leería como incumplimiento total.
  if (act == null) return `
    <div class="agy-style-196"><div class="agy-style-259">
      <span>${label}</span><span><strong${_k("real")}>—</strong> <span class="agy-style-89">/ <span${_k("meta")}>${fmtFn(meta)}</span> · ${t("portal.sinDatoRango")}</span></span>
    </div></div>`;
  const p  = (act / meta) * 100;
  const pp = proj != null ? (proj / meta) * 100 : null;
  return `
    <div class="agy-style-196">
      <div class="agy-style-259">
        <span>${label}</span>
        <span><strong${_k("real")}>${fmtFn(act)}</strong> <span class="agy-style-89">/ <span${_k("meta")}>${fmtFn(meta)}</span></span>
          <strong style="color:${pColor(p)};margin-left:6px"${_k("pct")}>${p.toFixed(1)}%</strong></span>
      </div>
      <div class="agy-style-260" style="position:relative">
        ${pp != null && pp > p ? `<div style="position:absolute;top:0;left:0;height:100%;width:${Math.min(pp,100).toFixed(1)}%;background:${pColor(pp)};opacity:.32;border-radius:5px"></div>` : ""}
        <div style="position:relative;height:100%;width:${Math.min(p, 100).toFixed(1)}%;background:${pColor(p)};border-radius:5px"></div>
      </div>
      ${pp != null ? `<div style="font-size:.68rem;color:${pColor(pp)};margin-top:3px">${t("portal.proyCierre")} <strong${_k("proj")}>${fmtFn(proj)}</strong> (${pp.toFixed(1)}%)</div>` : ""}
    </div>`;
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
    box.innerHTML = `<div class="empty"><p>${t(esc)}</p></div>`;
    reintentarCuandoEscalaLista("portal", STATE, renderPartnerPortal, () => STATE.curTab === "portal");
    return;
  }

  const line = _portalLine();
  const rows = _portalRows(line);
  if (!rows.length) {
    box.innerHTML = _portalLineToggle() + `
      <div class="empty">
        <p>${t("portal.sinDatos")}</p>
        <p class="empty-sub">${t("portal.sinDatosSub")}</p>
      </div>`;
    return;
  }

  const k = _portalKpis(rows);
  const misPartners = [...new Set(rows.map(r => r.partner))].sort();
  const ciudades    = [...new Set((STATE.rawData || []).map(r => r.city).filter(Boolean))].sort();
  // Dos formas: "último mes/día" vs "última semana" (concordancia de género), y
  // "vs el mes anterior" para la nota del WoW.
  const escalaN = t(STATE.curMode === "mensual" ? "portal.ultMes" : STATE.curMode === "diario" ? "portal.ultDia" : "portal.ultSemana");
  const escala  = t(STATE.curMode === "mensual" ? "portal.escMes" : STATE.curMode === "diario" ? "portal.escDia" : "portal.escSemana");

  // Título: normalmente 1-2 nombres (RLS recorta a los CLIDs del partner). Se
  // acota igual por robustez — un partner con muchos CLIDs bajo razones
  // sociales distintas no debe romper el encabezado.
  const titulo = misPartners.length > 3
    ? misPartners.slice(0, 3).map(escapeHTML).join(" · ") + ` <span class="agy-style-261">${t("portal.yMas", { n: misPartners.length - 3 })}</span>`
    : (misPartners.map(escapeHTML).join(" · ") || t("portal.tuOperacion"));

  let html = _portalLineToggle();
  html += secH("📊", "#FF0000", titulo,
    t("portal.tituloSub", { e: escalaN }),
    d2s(k.last));

  // Barra de herramientas: filtro de ciudad (solo si opera en más de una) + PDF.
  // El botón lleva data-html2canvas-ignore para no salir dentro del propio PDF.
  html += `<div class="section agy-style-262">`;
  if (ciudades.length > 1) {
    html += `<label class="agy-style-263">${t("sidebar.ciudad")}</label>
      <select class="sb-sel agy-style-10" data-act-change="portalSetCity">
        <option value="all">${t("metas.todas")}</option>
        ${ciudades.map(c => `<option value="${escapeHTML(c)}"${PORTAL_STATE.city === c ? " selected" : ""}>${cityLabel(c)}</option>`).join("")}
      </select>`;
  }
  html += `<button class="apply-btn agy-style-264" id="portalPdfBtn" data-html2canvas-ignore="true"
      data-act="portalDownloadPDF">${t("portal.descargarPDF")}</button>
    </div>`;

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
    // actual y como anterior, así que bdgMode() siempre comparaba un número
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
    html += `<div class="section"><div class="metric-row">
      ${_kpiCard("🚗 " + t("portal.autosPropios"), escalaN, now.owned, now.owned, prev.owned, "#0284c7", fmt, "portal.kpi.fleet.owned")}
      ${_kpiCard("🎨 " + t("metas.brandeados"), escalaN, now.branded, now.branded, prev.branded, "#7e22ce", fmt, "portal.kpi.fleet.branded")}
      ${_kpiCard("⏱️ " + t("portal.shCarInterno"), escalaN, now.shCar, now.shCar, prev.shCar, "#8b5cf6", v => fmt(v), "portal.kpi.fleet.shCar")}
      ${_kpiCard("✅ " + t("portal.aceptacion"), `${escalaN} · ${t("portal.ponderadaViajes")}`, now.accept, now.accept, prev.accept, "#10b981", v => v == null ? "—" : fmt(v) + "%", "portal.kpi.fleet.accept")}
    </div></div>`;
  } else {
    html += `<div class="section"><div class="metric-row">
      ${_kpiCard("📊 " + t("metric.ad.label"), escalaN, k.ad,  k.ad,  k.adP, "#FF0000", fmt, `portal.kpi.${line}.ad`)}
      ${_kpiCard("🆕 " + t("metric.nr.label"), t("portal.acumRango"), k.nr, k.nrL, k.nrP, "#f97316", fmt, `portal.kpi.${line}.nr`)}
      ${_kpiCard("⏱️ " + t("metric.sh.label"), t("portal.acumRango"), k.sh, k.shL, k.shP, "#8b5cf6", fmtSmart, `portal.kpi.${line}.sh`)}
      ${_kpiCard("🚕 " + t("metric.tr.label"), t("portal.acumRango"), k.tr, k.trL, k.trP, "#0284c7", fmtSmart, `portal.kpi.${line}.tr`)}
    </div></div>`;
  }

  html += _portalMetas(line, rows);

  // ── Evolución: una gráfica por KPI (mismo estilo que el deck) ───────────
  const charts = line === "fleet"
    ? [{ id: "portalChAd",  label: t("portal.autosPropios"), color: "#0284c7", fn: r => r.ownedFleetActiveCars || 0 },
       { id: "portalChNr",  label: t("metas.brandeados"),    color: "#7e22ce", fn: r => r.brandedActiveCars || 0 },
       { id: "portalChSh",  label: t("portal.horasInternas"), color: "#8b5cf6", fn: r => r.internalFleetSh || 0 },
       { id: "portalChTr",  label: t("metric.tr.label"),     color: "#0284c7", fn: r => r.trips || 0 }]
    : [{ id: "portalChAd",  label: t("metric.ad.label"),     color: "#FF0000", fn: r => r.activeDrivers || 0 },
       { id: "portalChNr",  label: t("metric.nr.label"),     color: "#f97316", fn: r => (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0) },
       { id: "portalChSh",  label: t("metric.sh.label"),     color: "#8b5cf6", fn: r => r.supplyHours || 0 },
       { id: "portalChTr",  label: t("metric.tr.label"),     color: "#0284c7", fn: r => r.trips || 0 }];

  html += secH("📈", "#10b981", t("portal.evolucion"), t("portal.evolucionSub", { e: t(`mode.${STATE.curMode}`) }), "");
  html += `<div class="section"><div class="agy-style-527">${
    charts.map(c => `<div class="chart-card">
      <div class="chart-head"><span class="chart-title">${escapeHTML(c.label)}</span></div>
      <div id="${c.id}"></div></div>`).join("")
  }</div></div>`;

  // ── Detalle por período, con WoW ────────────────────────────────────────
  html += secH("📋", "#6366f1", t("portal.detalle"), t("portal.detalleSub", { e: escala }), "");
  html += `<div class="section"><div class="tbl-wrap"><table class="dtbl"><thead><tr>
      <th>${t("portal.th.periodo")}</th>
      <th class="tn">${t("portal.th.ad")}</th><th class="tn">WoW</th>
      <th class="tn">${t("portal.th.nr")}</th><th class="tn">WoW</th>
      <th class="tn">${t("portal.th.sh")}</th><th class="tn">WoW</th>
      <th class="tn">${t("metric.tr.label")}</th><th class="tn">WoW</th>
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
  // Se recorre DESCENDENTE para mostrar lo más reciente arriba, pero el WoW se
  // calcula contra el período inmediatamente ANTERIOR en el tiempo (índice-1 del
  // array ascendente), no contra la fila de abajo en pantalla.
  [...fechasAsc].reverse().forEach(d => {
    const v = porFecha.get(d);
    const i = fechasAsc.indexOf(d);
    const prev = i > 0 ? porFecha.get(fechasAsc[i - 1]) : null;
    html += `<tr>
      <td>${d2s(d)}</td>
      <td class="tn"${dn("portal.detalle.ad", d)}>${fmt(v.ad)}</td>${_wowCell(_portalWow(v.ad, prev && prev.ad))}
      <td class="tn"${dn("portal.detalle.nr", d)}>${fmt(v.nr)}</td>${_wowCell(_portalWow(v.nr, prev && prev.nr))}
      <td class="tn"${dn("portal.detalle.sh", d)}>${fmtSmart(v.sh)}</td>${_wowCell(_portalWow(v.sh, prev && prev.sh))}
      <td class="tn"${dn("portal.detalle.tr", d)}>${fmtSmart(v.tr)}</td>${_wowCell(_portalWow(v.tr, prev && prev.tr))}
    </tr>`;
  });
  html += `</tbody></table></div></div>`;

  box.innerHTML = html;

  // Charts (mismo helper que el resto del dashboard; ApexCharts es lazy y
  // buildLineChart se re-encola solo si todavía no llegó).
  charts.forEach(c => {
    try {
      const s = _portalSeries(rows, c.fn);
      buildLineChart(c.id, s.dates, [{ name: c.label, data: s.values }], [c.color]);
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
  if (btn) { btn.textContent = "⏳ " + t("metas.generandoPDF"); btn.disabled = true; }
  try {
    await ensurePdfLibs();
    let bg = getComputedStyle(document.body).backgroundColor;
    if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") bg = "#F2F2F2";
    const canvas = await html2canvas(content, { scale: 2, useCORS: true, logging: false, backgroundColor: bg });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, canvas.width, canvas.height);
    stampPDF(pdf, t("portal.pdfTitulo"));
    pdf.save(`MiDesempeno_${fechaLocalISO()}.pdf`);
  } catch (err) {
    // Mensaje genérico a propósito: el portal es de cara externa, no le eco
    // detalles internos (payloads de Supabase, stacks) a un partner.
    alert(t("portal.errPDF"));
    if (DEBUG) console.error(err);
  } finally {
    if (btn) { btn.textContent = t("portal.descargarPDF"); btn.disabled = false; }
  }
}

registerActions({
  portalSetCity: (d, el) => portalSetCity(el.value),
  portalSetLine: d => portalSetLine(d.line),
  portalDownloadPDF
});
