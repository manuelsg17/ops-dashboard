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
import { stampPDF } from "./shared/pdfmeta.js";
import { ensurePdfLibs } from "./shared/lazyLibs.js";

export const PORTAL_STATE = { city: "all" };

// ¿La sesión actual es de un partner externo?
export function isPartnerSession() {
  return STATE.userRole === "partner";
}

// Filas del rango elegido (mismo criterio de fechas que el resto del dashboard).
function _portalRows() {
  const from = document.getElementById("dateFrom")?.value || "";
  const to   = document.getElementById("dateTo")?.value   || "";
  return (STATE.rawData || []).filter(r =>
    (!from || r.date >= from) && (!to || r.date <= to) &&
    (PORTAL_STATE.city === "all" || r.city === PORTAL_STATE.city)
  );
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
    last, prev,
    ad:   _sum(lastRows, r => r.activeDrivers),
    adP:  _sum(prevRows, r => r.activeDrivers),
    nr:   nr(rows),            // acumulado del rango
    nrL:  nr(lastRows), nrP: nr(prevRows),
    sh:   _sum(rows,     r => r.supplyHours),
    shL:  _sum(lastRows, r => r.supplyHours),
    shP:  _sum(prevRows, r => r.supplyHours)
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

// Metas del mes vs actual — solo de los CLIDs del partner (RLS ya recortó metasData).
function _portalMetas() {
  const metas = STATE.metasData || [];
  if (!metas.length) return "";
  const meses = [...new Set(metas.map(m => m.mes))].filter(Boolean)
    .sort((a, b) => _metasMesOrden(b) - _metasMesOrden(a));
  const mes = meses[0];
  if (!mes) return "";
  const delMes = metas.filter(m => m.mes === mes);

  const rows = _portalRows();
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const last  = dates[dates.length - 1] || "";
  const adAct = _sum(rows.filter(r => r.date === last), r => r.activeDrivers);
  const nrAct = _sum(rows, r => r.newPartner + r.newService + r.reactivated);
  const shAct = _sum(rows, r => r.supplyHours);

  const mA  = _sum(delMes, m => m.mA);
  const mNR = _sum(delMes, m => m.mNR);
  const mH  = _sum(delMes, m => m.mH);
  if (!mA && !mNR && !mH) return "";

  const fila = (label, act, meta, fmtFn = fmt) => {
    if (!meta) return "";
    const p = (act / meta) * 100;
    return `
      <div class="agy-style-196">
        <div class="agy-style-259">
          <span>${label}</span>
          <span><strong>${fmtFn(act)}</strong> <span class="agy-style-89">/ ${fmtFn(meta)}</span>
            <strong style="color:${pColor(p)};margin-left:6px">${p.toFixed(1)}%</strong></span>
        </div>
        <div class="agy-style-260">
          <div style="height:100%;width:${Math.min(p, 100).toFixed(1)}%;background:${pColor(p)};border-radius:5px"></div>
        </div>
      </div>`;
  };

  return secH("🎯", "#8b5cf6", `Tus metas — ${escapeHTML(mes)}`,
      "Avance del mes contra el objetivo acordado con tu KAM", "") +
    `<div class="section">
      ${fila("Conductores Activos", adAct, mA)}
      ${fila("Nuevos + Reactivados", nrAct, mNR)}
      ${fila("Horas de Conexión", shAct, mH, fmtSmart)}
    </div>`;
}

// ── RENDER ───────────────────────────────────────────────────────────────────
export function renderPartnerPortal() {
  const box = document.getElementById("portalContent");
  if (!box) return;

  const rows = _portalRows();
  if (!rows.length) {
    box.innerHTML = `
      <div class="empty">
        <p>Todavía no hay datos para el rango seleccionado.</p>
        <p class="empty-sub">Probá ampliar el rango de fechas. Si el problema sigue, escribile a tu KAM.</p>
      </div>`;
    return;
  }

  const k = _portalKpis(rows);
  const misPartners = [...new Set(rows.map(r => r.partner))].sort();
  const ciudades    = [...new Set((STATE.rawData || []).map(r => r.city).filter(Boolean))].sort();

  // Título: normalmente 1-2 nombres (RLS recorta a los CLIDs del partner). Se
  // acota igual por robustez — un partner con muchos CLIDs bajo razones
  // sociales distintas no debe romper el encabezado.
  const titulo = misPartners.length > 3
    ? misPartners.slice(0, 3).map(escapeHTML).join(" · ") + ` <span class="agy-style-261">y ${misPartners.length - 3} más</span>`
    : (misPartners.map(escapeHTML).join(" · ") || "Tu operación");

  let html = secH("📊", "#FF0000", titulo,
    `Activos: último período · N+R y Horas: acumulado del rango`,
    d2s(k.last));

  // Barra de herramientas: filtro de ciudad (solo si opera en más de una) + PDF.
  // El botón lleva data-html2canvas-ignore para no salir dentro del propio PDF.
  html += `<div class="section agy-style-262">`;
  if (ciudades.length > 1) {
    html += `<label class="agy-style-263">Ciudad</label>
      <select class="sb-sel" data-act-change="portalSetCity" class="agy-style-10">
        <option value="all">Todas</option>
        ${ciudades.map(c => `<option value="${escapeHTML(c)}"${PORTAL_STATE.city === c ? " selected" : ""}>${cityLabel(c)}</option>`).join("")}
      </select>`;
  }
  html += `<button class="apply-btn" id="portalPdfBtn" data-html2canvas-ignore="true"
      data-act="portalDownloadPDF" class="agy-style-264">📄 Descargar PDF</button>
    </div>`;

  html += `<div class="section"><div class="metric-row">
    ${_kpiCard("📊 Conductores Activos", "último período", k.ad,  k.ad,  k.adP, "#FF0000")}
    ${_kpiCard("🆕 Nuevos + Reactivados", "acumulado del rango", k.nr, k.nrL, k.nrP, "#f97316")}
    ${_kpiCard("⏱️ Horas de Conexión", "acumulado del rango", k.sh, k.shL, k.shP, "#8b5cf6", fmtSmart)}
  </div></div>`;

  html += _portalMetas();

  // Evolución
  html += secH("📈", "#10b981", "Tu evolución", "Conductores activos por período", "");
  html += `<div class="section"><div class="chart-card"><div id="portalChart"></div></div></div>`;

  // Detalle por período
  html += secH("📋", "#6366f1", "Detalle por período", "Los mismos números, período a período", "");
  html += `<div class="section"><div class="tbl-wrap"><table class="dtbl"><thead><tr>
      <th>Período</th><th class="tn">Cond. Activos</th><th class="tn">Nuevos + React.</th><th class="tn">Hs. Conexión</th>
    </tr></thead><tbody>`;
  const porFecha = new Map();
  rows.forEach(r => {
    let a = porFecha.get(r.date);
    if (!a) { a = { ad: 0, nr: 0, sh: 0 }; porFecha.set(r.date, a); }
    a.ad += r.activeDrivers || 0;
    a.nr += (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0);
    a.sh += r.supplyHours || 0;
  });
  [...porFecha.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([d, v]) => {
    html += `<tr><td>${d2s(d)}</td><td class="tn">${fmt(v.ad)}</td><td class="tn">${fmt(v.nr)}</td><td class="tn">${fmt(v.sh)}</td></tr>`;
  });
  html += `</tbody></table></div></div>`;

  box.innerHTML = html;

  // Chart de evolución (mismo helper que el resto del dashboard)
  const dates = [...porFecha.keys()].sort();
  try {
    buildLineChart("portalChart", dates,
      [{ name: "Conductores Activos", data: dates.map(d => porFecha.get(d).ad) }], ["#FF0000"]);
  } catch (_) { /* el chart es accesorio: nunca romper la vista por él */ }
}

export function portalSetCity(city) {
  PORTAL_STATE.city = city;
  renderPartnerPortal();
}

// Export PDF del portal. Sellado con el email de la sesión + timestamp
// (shared/pdfmeta.js): si un partner reenvía el PDF, queda claro de qué cuenta
// salió y que es material de uso restringido.
export async function portalDownloadPDF() {
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
  portalDownloadPDF
});
