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
import { logAccess } from "./shared/accessLog.js";
import { stampPDF } from "./shared/pdfmeta.js";
import { ensurePdfLibs } from "./shared/lazyLibs.js";
// Mismo núcleo de cálculo que Metas, Rendimiento y el deck: el partner tiene que
// ver EXACTAMENTE los números que su KAM le presenta.
import { snapshotValue, seriesByDate, projectSnapshot, projectFlow, ratio, weightedAvg } from "./domain/metrics.js";

export const PORTAL_STATE = { city: "all", line: "comb" };

// ── LÍNEAS DE NEGOCIO ────────────────────────────────────────────────────────
// Mismo criterio que Rendimiento/Metas: Fleet ⊂ Agregador (sus autos hacen Taxi)
// y TukTuk es disjunto de Taxi. Solo se ofrecen las líneas en las que ESTE
// partner tiene datos — mostrarle una pestaña "TukTuk" vacía a quien no opera
// TukTuk es ruido.
export const PORTAL_LINES = [
  { k: "comb",  emoji: "🔀", label: "Combinado", tip: "Taxi + TukTuk sumados" },
  { k: "agg",   emoji: "📊", label: "Taxi",      tip: "Operación de taxi (incluye tus autos de flota)" },
  { k: "fleet", emoji: "🚗", label: "Fleet",     tip: "KPIs de tu flota propia" },
  { k: "tk",    emoji: "🛺", label: "TukTuk",    tip: "Operación TukTuk" }
];

function _portalDataset(line) {
  // Slice por ESCALA (3, no 2): antes un booleano `mensual ?` hacía que diario
  // cayera al slice semanal en silencio.
  const _sl = base => {
    const m = STATE.curMode;
    if (m === "mensual") return STATE["rawDataMensual" + base] || [];
    if (m === "diario")  return STATE["rawDataDiario"  + base] || [];
    return STATE["rawData" + base] || [];
  };
  const tk = _sl("Tuktuk");
  if (line === "fleet") return _sl("Fleet");
  if (line === "tk")    return tk;
  if (line === "comb")  return (STATE.rawData || []).concat(tk);
  return STATE.rawData || [];
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
      title="${escapeHTML(l.tip)}" data-act="portalSetLine" data-line="${l.k}">${l.emoji} ${l.label}</button>`).join("")
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

function _kpiCard(label, sub, valor, actual, previo, color, fmtFn = fmt) {
  return `
    <div class="mcard" style="border-top:3px solid ${color}">
      <div class="mcard-label">${label}</div>
      <div class="mcard-sub-label">${sub}</div>
      <div class="mcard-val">${fmtFn(valor)}</div>
      <div class="agy-style-257">${bdgMode(actual, previo)}
        <span class="agy-style-258">vs período anterior</span>
      </div>
    </div>`;
}

// Metas del mes vs actual — solo de los CLIDs del partner (RLS ya recortó
// metasData). Respeta la línea activa: en Combinado la meta es la suma de la
// meta Taxi + la meta TukTuk, igual que en la pestaña Metas del equipo.
function _portalMetas(line, rows) {
  const metas = STATE.metasData || [];
  if (!metas.length) return "";
  const meses = [...new Set(metas.map(m => m.mes))].filter(Boolean)
    .sort((a, b) => _metasMesOrden(b) - _metasMesOrden(a));
  const mes = meses[0];
  if (!mes) return "";
  const delMes = metas.filter(m => m.mes === mes &&
    (PORTAL_STATE.city === "all" || m.city === PORTAL_STATE.city));

  const dates = [...new Set(rows.map(r => r.date))].sort();
  const last  = dates[dates.length - 1] || "";
  const adAct = _sum(rows.filter(r => r.date === last), r => r.activeDrivers);
  const nrAct = _sum(rows, r => r.newPartner + r.newService + r.reactivated);
  const shAct = _sum(rows, r => r.supplyHours);
  const adSerie = _portalSeries(rows, r => r.activeDrivers).values;
  const { daysElapsed, daysRemaining } = calcProjectionDays(last);

  // Qué meta aplica según la línea. `null` = ese KPI no tiene meta cargada para
  // esta línea (distinto de meta 0).
  const pick = (taxi, tk) => {
    if (line === "tk")    return tk;
    if (line === "agg" || line === "fleet") return taxi;
    return (taxi == null && tk == null) ? null : (taxi || 0) + (tk || 0);   // comb
  };
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
    const trips = _sum(rows, r => r.trips || 0);
    const accW  = rows.reduce((s, r) => s + (r.acceptanceRate || 0) * (r.trips || 0), 0);
    const shCar  = ratio(intSh, owned);
    const accept = ratio(accW, trips) * 100;
    // Las metas de tasa se re-ponderan por el mismo denominador que el actual;
    // promediarlas a secas entre ciudades daría un número sin significado.
    const wMeta = (key, w) => {
      const pairs = delMes.filter(m => m[key] != null).map(m => [m[key], w]);
      return pairs.length ? weightedAvg(pairs) : null;
    };
    const mShCar = wMeta("mSHcar", owned), mAcc = wMeta("mAcc", trips), mUtil = wMeta("mUtil", owned);
    if (mShCar == null && mAcc == null && mUtil == null) return "";
    return secH("🎯", "#0891b2", `Tus metas de flota — ${escapeHTML(mes)}`,
        "Acumulado del RANGO seleccionado vs el objetivo mensual acordado con tu KAM · para un % representativo, elegí el mes completo", "") +
      `<div class="section">
        ${_portalMetaRow("SH / Auto (interno)", shCar, mShCar, null, v => fmt(v))}
        ${_portalMetaRow("Aceptación", accept, mAcc, null, v => fmt(v) + "%")}
        ${mUtil != null ? `<div class="agy-style-196"><div class="agy-style-259">
            <span>Utilización</span><span><strong>${fmt(mUtil)}%</strong> <span class="agy-style-89">meta · sin actual medible</span></span>
          </div></div>` : ""}
      </div>`;
  }

  if (mA == null && mNR == null && mH == null) return "";
  const lbl = line === "tk" ? "TukTuk" : line === "comb" ? "(Taxi + TukTuk)" : "";
  return secH("🎯", "#8b5cf6", `Tus metas ${lbl} — ${escapeHTML(mes)}`.replace("  ", " "),
      "Avance del mes contra el objetivo acordado con tu KAM · la barra clara es la proyección al cierre", "") +
    `<div class="section">
      ${_portalMetaRow("Conductores Activos", adAct, mA, projectSnapshot(adSerie), fmt)}
      ${_portalMetaRow("Nuevos + Reactivados", nrAct, mNR, projectFlow(nrAct, daysElapsed, daysRemaining), fmt)}
      ${_portalMetaRow("Horas de Conexión", shAct, mH, projectFlow(shAct, daysElapsed, daysRemaining), fmtSmart)}
    </div>`;
}

// Fila meta-vs-actual con barra de avance y (si aplica) marca de proyección.
function _portalMetaRow(label, act, meta, proj, fmtFn) {
  if (meta == null || !meta) return "";
  const p  = (act / meta) * 100;
  const pp = proj != null ? (proj / meta) * 100 : null;
  return `
    <div class="agy-style-196">
      <div class="agy-style-259">
        <span>${label}</span>
        <span><strong>${fmtFn(act)}</strong> <span class="agy-style-89">/ ${fmtFn(meta)}</span>
          <strong style="color:${pColor(p)};margin-left:6px">${p.toFixed(1)}%</strong></span>
      </div>
      <div class="agy-style-260" style="position:relative">
        ${pp != null && pp > p ? `<div style="position:absolute;top:0;left:0;height:100%;width:${Math.min(pp,100).toFixed(1)}%;background:${pColor(pp)};opacity:.32;border-radius:5px"></div>` : ""}
        <div style="position:relative;height:100%;width:${Math.min(p, 100).toFixed(1)}%;background:${pColor(p)};border-radius:5px"></div>
      </div>
      ${pp != null ? `<div style="font-size:.68rem;color:${pColor(pp)};margin-top:3px">Proyección al cierre: <strong>${fmtFn(proj)}</strong> (${pp.toFixed(1)}%)</div>` : ""}
    </div>`;
}

// ── RENDER ───────────────────────────────────────────────────────────────────
export function renderPartnerPortal() {
  const box = document.getElementById("portalContent");
  if (!box) return;

  const line = _portalLine();
  const rows = _portalRows(line);
  if (!rows.length) {
    box.innerHTML = _portalLineToggle() + `
      <div class="empty">
        <p>Todavía no hay datos para el rango seleccionado.</p>
        <p class="empty-sub">Probá ampliar el rango de fechas o cambiar de escala (diaria / semanal / mensual). Si el problema sigue, escribile a tu KAM.</p>
      </div>`;
    return;
  }

  const k = _portalKpis(rows);
  const misPartners = [...new Set(rows.map(r => r.partner))].sort();
  const ciudades    = [...new Set((STATE.rawData || []).map(r => r.city).filter(Boolean))].sort();
  // Dos formas: "último mes/día" vs "última semana" (concordancia de género), y
  // "vs el mes anterior" para la nota del WoW.
  const escalaN = STATE.curMode === "mensual" ? "último mes" : STATE.curMode === "diario" ? "último día" : "última semana";
  const escala  = STATE.curMode === "mensual" ? "mes" : STATE.curMode === "diario" ? "día" : "semana";

  // Título: normalmente 1-2 nombres (RLS recorta a los CLIDs del partner). Se
  // acota igual por robustez — un partner con muchos CLIDs bajo razones
  // sociales distintas no debe romper el encabezado.
  const titulo = misPartners.length > 3
    ? misPartners.slice(0, 3).map(escapeHTML).join(" · ") + ` <span class="agy-style-261">y ${misPartners.length - 3} más</span>`
    : (misPartners.map(escapeHTML).join(" · ") || "Tu operación");

  let html = _portalLineToggle();
  html += secH("📊", "#FF0000", titulo,
    `Activos: ${escalaN} · N+R, Horas y Viajes: acumulado del rango`,
    d2s(k.last));

  // Barra de herramientas: filtro de ciudad (solo si opera en más de una) + PDF.
  // El botón lleva data-html2canvas-ignore para no salir dentro del propio PDF.
  html += `<div class="section agy-style-262">`;
  if (ciudades.length > 1) {
    html += `<label class="agy-style-263">Ciudad</label>
      <select class="sb-sel agy-style-10" data-act-change="portalSetCity">
        <option value="all">Todas</option>
        ${ciudades.map(c => `<option value="${escapeHTML(c)}"${PORTAL_STATE.city === c ? " selected" : ""}>${cityLabel(c)}</option>`).join("")}
      </select>`;
  }
  html += `<button class="apply-btn agy-style-264" id="portalPdfBtn" data-html2canvas-ignore="true"
      data-act="portalDownloadPDF">📄 Descargar PDF</button>
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
      const trips = _sum(rs, r => r.trips || 0);
      return {
        owned,
        branded: _sum(rs, r => r.brandedActiveCars || 0),
        shCar:   ratio(_sum(rs, r => r.internalFleetSh || 0), owned),
        accept:  ratio(rs.reduce((s, r) => s + (r.acceptanceRate || 0) * (r.trips || 0), 0), trips) * 100
      };
    };
    const now = fl(rowsLast), prev = fl(rowsPrev);
    html += `<div class="section"><div class="metric-row">
      ${_kpiCard("🚗 Autos propios activos", escalaN, now.owned, now.owned, prev.owned, "#0891b2")}
      ${_kpiCard("🎨 Brandeados", escalaN, now.branded, now.branded, prev.branded, "#7e22ce")}
      ${_kpiCard("⏱️ SH / Auto (interno)", escalaN, now.shCar, now.shCar, prev.shCar, "#8b5cf6", v => fmt(v))}
      ${_kpiCard("✅ Aceptación", `${escalaN} · ponderada por viajes`, now.accept, now.accept, prev.accept, "#10b981", v => fmt(v) + "%")}
    </div></div>`;
  } else {
    html += `<div class="section"><div class="metric-row">
      ${_kpiCard("📊 Conductores Activos", escalaN, k.ad,  k.ad,  k.adP, "#FF0000")}
      ${_kpiCard("🆕 Nuevos + Reactivados", "acumulado del rango", k.nr, k.nrL, k.nrP, "#f97316")}
      ${_kpiCard("⏱️ Horas de Conexión", "acumulado del rango", k.sh, k.shL, k.shP, "#8b5cf6", fmtSmart)}
      ${_kpiCard("🚕 Viajes", "acumulado del rango", k.tr, k.trL, k.trP, "#0ea5e9", fmtSmart)}
    </div></div>`;
  }

  html += _portalMetas(line, rows);

  // ── Evolución: una gráfica por KPI (mismo estilo que el deck) ───────────
  const charts = line === "fleet"
    ? [{ id: "portalChAd",  label: "Autos propios activos", color: "#0891b2", fn: r => r.ownedFleetActiveCars || 0 },
       { id: "portalChNr",  label: "Brandeados",            color: "#7e22ce", fn: r => r.brandedActiveCars || 0 },
       { id: "portalChSh",  label: "Horas internas de flota", color: "#8b5cf6", fn: r => r.internalFleetSh || 0 },
       { id: "portalChTr",  label: "Viajes",                color: "#0ea5e9", fn: r => r.trips || 0 }]
    : [{ id: "portalChAd",  label: "Conductores Activos",   color: "#FF0000", fn: r => r.activeDrivers || 0 },
       { id: "portalChNr",  label: "Nuevos + Reactivados",  color: "#f97316", fn: r => (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0) },
       { id: "portalChSh",  label: "Horas de Conexión",     color: "#8b5cf6", fn: r => r.supplyHours || 0 },
       { id: "portalChTr",  label: "Viajes",                color: "#0ea5e9", fn: r => r.trips || 0 }];

  html += secH("📈", "#10b981", "Tu evolución", `Período a período · escala ${STATE.curMode}`, "");
  html += `<div class="section"><div class="agy-style-527">${
    charts.map(c => `<div class="chart-card">
      <div class="chart-head"><span class="chart-title">${escapeHTML(c.label)}</span></div>
      <div id="${c.id}"></div></div>`).join("")
  }</div></div>`;

  // ── Detalle por período, con WoW ────────────────────────────────────────
  html += secH("📋", "#6366f1", "Detalle por período",
    `Los mismos números, período a período · WoW = variación vs el ${escala} anterior`, "");
  html += `<div class="section"><div class="tbl-wrap"><table class="dtbl"><thead><tr>
      <th>Período</th>
      <th class="tn">Cond. Activos</th><th class="tn">WoW</th>
      <th class="tn">Nuevos + React.</th><th class="tn">WoW</th>
      <th class="tn">Hs. Conexión</th><th class="tn">WoW</th>
      <th class="tn">Viajes</th><th class="tn">WoW</th>
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
      <td class="tn">${fmt(v.ad)}</td>${_wowCell(_portalWow(v.ad, prev && prev.ad))}
      <td class="tn">${fmt(v.nr)}</td>${_wowCell(_portalWow(v.nr, prev && prev.nr))}
      <td class="tn">${fmtSmart(v.sh)}</td>${_wowCell(_portalWow(v.sh, prev && prev.sh))}
      <td class="tn">${fmtSmart(v.tr)}</td>${_wowCell(_portalWow(v.tr, prev && prev.tr))}
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
  if (btn) { btn.textContent = "⏳ Generando..."; btn.disabled = true; }
  try {
    await ensurePdfLibs();
    let bg = getComputedStyle(document.body).backgroundColor;
    if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") bg = "#F2F2F2";
    const canvas = await html2canvas(content, { scale: 2, useCORS: true, logging: false, backgroundColor: bg });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, canvas.width, canvas.height);
    stampPDF(pdf, "Mi desempeño — Yango Perú");
    pdf.save(`MiDesempeno_${(new Date()).toISOString().slice(0, 10)}.pdf`);
  } catch (err) {
    // Mensaje genérico a propósito: el portal es de cara externa, no le eco
    // detalles internos (payloads de Supabase, stacks) a un partner.
    alert("No se pudo generar el PDF. Intentá de nuevo o escribile a tu KAM.");
    if (DEBUG) console.error(err);
  } finally {
    if (btn) { btn.textContent = "📄 Descargar PDF"; btn.disabled = false; }
  }
}

registerActions({
  portalSetCity: (d, el) => portalSetCity(el.value),
  portalSetLine: d => portalSetLine(d.line),
  portalDownloadPDF
});
