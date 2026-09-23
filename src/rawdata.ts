//@ts-nocheck
// rawdata.js — Pestaña Data Raw: vista completa sin filtrar para comparar con Excel
//
// Ola 6 (sep-2026): Data Raw pasa a ser SOLO CONSULTA. La clasificación de
// sub-flotas (antes "Vista Flotas") y la conciliación CLID → db_id se mudaron a
// Configuración → Clasificación (configView.ts): son datos maestros, no una
// forma de mirar los registros. Acá queda un enlace para encontrarlas.

import { registerActions } from "./shared/actions.js";
import { t } from "./core/i18n";
import { logAccess } from "./shared/accessLog.js";
import { filaCSV } from "./shared/csv";
import { fechaLimaISO } from "./core/dates";
import { escapeHTML } from "./core/security";
import { fmt, fmt5, fmtK, d2s, cityLabel } from "./core/format";
import { STATE } from "./core/config.js";
import { btn, emptyState, icon } from "./shared/ui";

export const RAW_STATE = {
  page:       0,
  PAGE_SIZE:  50,
  search:     "",
  city:       "all",
  dateFrom:   "",
  dateTo:     "",
  sortCol:    "date",
  sortDir:    "asc"
};

const e = s => escapeHTML(s == null ? "" : String(s));

function _src() {
  return STATE.curMode === "mensual" ? STATE.rawDataMensualFull
       : STATE.curMode === "diario"  ? STATE.rawDataDiarioFull
       :                              STATE.rawDataFull;
}

function _filtrar(src) {
  const q = RAW_STATE.search.toLowerCase();
  return src.filter(r => {
    if (RAW_STATE.city !== "all" && r.city !== RAW_STATE.city) return false;
    if (RAW_STATE.dateFrom && r.date < RAW_STATE.dateFrom) return false;
    if (RAW_STATE.dateTo   && r.date > RAW_STATE.dateTo)   return false;
    if (q && !r.partner.toLowerCase().includes(q) && !(r.kam || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
export function renderRawData() {
  const content = document.getElementById("rawdataContent");
  if (!content) return;
  const src = _src();

  if (!src || !src.length) {
    content.innerHTML = emptyState({ icon: "table", title: t("raw.vacio"), text: t("raw.vacioSub") }) + _linkClasif();
    return;
  }

  // Inicializar el rango de fechas si está vacío o quedó fuera de la escala
  // actual (cambiar de semanal a mensual deja fechas que no existen).
  const allDates = [...new Set(src.map(r => r.date))].sort();
  if (!RAW_STATE.dateFrom || !allDates.includes(RAW_STATE.dateFrom)) RAW_STATE.dateFrom = allDates[0] || "";
  if (!RAW_STATE.dateTo   || !allDates.includes(RAW_STATE.dateTo))   RAW_STATE.dateTo   = allDates[allDates.length - 1] || "";
  const allCities = [...new Set(src.map(r => r.city).filter(Boolean))].sort();

  const filtered = _filtrar(src);

  // ── Ordenar ──────────────────────────────────────────────────────────────
  const col = RAW_STATE.sortCol;
  const dir = RAW_STATE.sortDir === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    const av = col === "nr" ? (a.newPartner + a.newService + a.reactivated) : (a[col] ?? "");
    const bv = col === "nr" ? (b.newPartner + b.newService + b.reactivated) : (b[col] ?? "");
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });

  // ── Totales del set filtrado completo ────────────────────────────────────
  const totAD   = filtered.reduce((s, r) => s + r.activeDrivers, 0);
  const totNR   = filtered.reduce((s, r) => s + r.newPartner + r.newService + r.reactivated, 0);
  const totSH   = filtered.reduce((s, r) => s + r.supplyHours, 0);
  const totCom  = filtered.reduce((s, r) => s + r.commission, 0);
  const totTrip = filtered.reduce((s, r) => s + r.trips, 0);

  // ── Paginación ───────────────────────────────────────────────────────────
  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / RAW_STATE.PAGE_SIZE));
  if (RAW_STATE.page >= totalPages) RAW_STATE.page = 0;
  const pageRows   = filtered.slice(RAW_STATE.page * RAW_STATE.PAGE_SIZE, (RAW_STATE.page + 1) * RAW_STATE.PAGE_SIZE);

  // Encabezado ordenable: botón dentro del <th> (accesible por teclado) y
  // aria-sort en el <th>.
  const thSort = (label, colKey, num = false) => {
    const active = RAW_STATE.sortCol === colKey;
    const sort = active ? (RAW_STATE.sortDir === "asc" ? "ascending" : "descending") : "none";
    const ico = active ? icon(RAW_STATE.sortDir === "asc" ? "arrow-up" : "arrow-down", { size: 12 }) : "";
    return `<th scope="col" aria-sort="${sort}"${num ? ' class="ui-num"' : ""}>
      <button type="button" class="raw-sort${active ? " raw-sort--on" : ""}" data-act="rawSort" data-col="${e(colKey)}">${e(label)}${ico}</button></th>`;
  };

  // I6: ciudades y fechas vienen de la base / del Excel: escapadas.
  const dOpts = sel => allDates.map(d => `<option value="${e(d)}"${d === sel ? " selected" : ""}>${e(d2s(d))}</option>`).join("");
  const cityOpts = allCities.map(c => `<option value="${e(c)}"${RAW_STATE.city === c ? " selected" : ""}>${e(cityLabel(c))}</option>`).join("");

  let html = `
    <div class="raw-bar" role="search">
      <input class="ui-input raw-bar__search" type="search" id="rawSearchReg" placeholder="${e(t("raw.buscarPartnerKam"))}"
        value="${e(RAW_STATE.search)}" data-act-input="rawSearch" data-reset="1" autocomplete="off" aria-label="${e(t("raw.buscarPartnerKam"))}"/>
      <select class="ui-select raw-bar__sel" data-act-change="rawSetCity" data-reset="1" aria-label="${e(t("calc.col.ciudad"))}">
        <option value="all"${RAW_STATE.city === "all" ? " selected" : ""}>${e(t("raw.todasCiudades"))}</option>
        ${cityOpts}
      </select>
      <span class="raw-bar__range">
        <select class="ui-select raw-bar__date" data-act-change="rawSetDateFrom" data-reset="1" aria-label="${e(t("raw6.desde"))}">${dOpts(RAW_STATE.dateFrom)}</select>
        <span class="raw-bar__arrow" aria-hidden="true">→</span>
        <select class="ui-select raw-bar__date" data-act-change="rawSetDateTo" data-reset="1" aria-label="${e(t("raw6.hasta"))}">${dOpts(RAW_STATE.dateTo)}</select>
      </span>
      <span class="raw-bar__end">${btn({ label: t("raw6.exportarCsv"), icon: "download", act: "exportRawCSV" })}</span>
    </div>
    <div class="raw-meta">
      <span>${e(t("raw6.meta", { t: fmt(src.length), d: fmt(STATE.rawData.length), x: fmt(src.length - STATE.rawData.length) }))}</span>
      <span>${t("raw.registrosPaginas", { n: fmt(total), p: fmt(totalPages) })}</span>
    </div>`;

  const rows = pageRows.map(r => {
    const nr = r.newPartner + r.newService + r.reactivated;
    return `<tr>
      <td class="raw-td-date">${e(d2s(r.date))}</td>
      <td>${e(r.partner)}</td>
      <td>${e(r.kam) || "–"}</td>
      <td>${e(r.city) || "–"}</td>
      <td class="ui-num">${fmt5(r.activeDrivers)}</td>
      <td class="ui-num">${fmt5(nr)}</td>
      <td class="ui-num">${fmt5(r.supplyHours)}</td>
      <td class="ui-num" title="$${fmt5(r.commission)}">${fmtK(r.commission)}</td>
      <td class="ui-num">${fmt5(r.trips)}</td>
    </tr>`;
  }).join("");

  html += `
    <div class="ui-table-wrap ui-table-wrap--scroll raw-table-wrap">
      <table class="ui-table ui-table--sticky-first raw-table">
        <thead><tr>
          ${thSort(t("raw.col.fecha"), "date")}
          ${thSort(t("calc.col.partner"), "partner")}
          ${thSort(t("sidebar.kam"), "kam")}
          ${thSort(t("calc.col.ciudad"), "city")}
          ${thSort("AD", "activeDrivers", true)}
          ${thSort("N+R", "nr", true)}
          ${thSort(t("metric.sh.short"), "supplyHours", true)}
          ${thSort(t("raw.col.comision"), "commission", true)}
          ${thSort(t("raw.col.viajes"), "trips", true)}
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="9" class="raw-empty-row">${e(t("raw6.sinCoincidencias"))}</td></tr>`}</tbody>
        <tfoot><tr class="raw-total">
          <td colspan="4">${e(t("raw.total", { n: fmt(total) }))}</td>
          <td class="ui-num">${fmt5(totAD)}</td>
          <td class="ui-num">${fmt5(totNR)}</td>
          <td class="ui-num">${fmt5(totSH)}</td>
          <td class="ui-num" title="$${fmt5(totCom)}">${fmtK(totCom)}</td>
          <td class="ui-num">${fmt5(totTrip)}</td>
        </tr></tfoot>
      </table>
    </div>`;

  if (totalPages > 1) {
    html += `
    <div class="raw-pager">
      ${btn({ label: t("raw6.anterior"), size: "sm", icon: "chevron-left", act: "rawPagePrev", disabled: RAW_STATE.page === 0 })}
      <span>${t("raw.pagina", { a: `<strong>${RAW_STATE.page + 1}</strong>`, b: `<strong>${totalPages}</strong>` })}</span>
      ${btn({ label: t("raw6.siguiente"), size: "sm", act: "rawPageNext", data: { total: totalPages }, disabled: RAW_STATE.page === totalPages - 1 })}
    </div>`;
  }
  html += _linkClasif();
  content.innerHTML = html;
}

function _linkClasif() {
  return `<p class="raw-link">${icon("info", { size: 14 })}<span>${e(t("raw6.clasifMovida"))}</span>
    <button type="button" class="ui-link-btn" data-act="rawIrClasif">${e(t("raw6.irClasif"))}</button></p>`;
}

// ── SORT ──────────────────────────────────────────────────────────────────────
export function rawSortBy(col) {
  if (RAW_STATE.sortCol === col) {
    RAW_STATE.sortDir = RAW_STATE.sortDir === "asc" ? "desc" : "asc";
  } else {
    RAW_STATE.sortCol = col;
    RAW_STATE.sortDir = col === "date" || col === "partner" ? "asc" : "desc";
  }
  RAW_STATE.page = 0;
  renderRawData();
}

// ── EXPORT CSV ────────────────────────────────────────────────────────────────
export function exportRawCSV() {
  const rows = _filtrar(_src() || []);
  // I10: logAccess como el resto de las exportaciones (Monitoreo cuenta las
  // descargas) y celdas RFC 4180 + fórmulas neutralizadas (shared/csv.ts).
  logAccess("download_csv", "data_raw");
  const header = ["Fecha", "Partner", "KAM", "Ciudad", "AD", "N+R", "Horas", "Comision", "Viajes"];
  const lines  = [filaCSV(header)];
  rows.forEach(r => {
    const nr = r.newPartner + r.newService + r.reactivated;
    lines.push(filaCSV([
      r.date, r.partner, r.kam || "", r.city || "",
      r.activeDrivers, nr, r.supplyHours, r.commission, r.trips
    ]));
  });
  // UTF-8 BOM para que Excel lo abra con la codificación correcta
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `data_raw_${RAW_STATE.dateFrom || "inicio"}_${RAW_STATE.dateTo || fechaLimaISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Buscador sin perder foco: renderRawData reconstruye el panel; se guarda el
// caret y se re-enfoca el mismo id tras el re-render (fix Fase 7).
export function rawSearchInput(inp, resetPage) {
  RAW_STATE.search = inp.value;
  if (resetPage) RAW_STATE.page = 0;
  const id = inp.id, pos = inp.selectionStart;
  renderRawData();
  const el = id && document.getElementById(id);
  if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (err) { /* type=search sin selección */ } }
}

// ── ACCIONES DELEGADAS ────────────────────────────────────────────────────────
registerActions({
  rawSort:        d => rawSortBy(d.col),
  rawSearch:      (d, el) => rawSearchInput(el, d.reset === "1"),
  rawSetCity:     (d, el) => { RAW_STATE.city = el.value;     if (d.reset === "1") RAW_STATE.page = 0; renderRawData(); },
  rawSetDateFrom: (d, el) => { RAW_STATE.dateFrom = el.value; if (d.reset === "1") RAW_STATE.page = 0; renderRawData(); },
  rawSetDateTo:   (d, el) => { RAW_STATE.dateTo = el.value;   if (d.reset === "1") RAW_STATE.page = 0; renderRawData(); },
  rawPagePrev:    () => { RAW_STATE.page = Math.max(0, RAW_STATE.page - 1); renderRawData(); },
  rawPageNext:    d  => { RAW_STATE.page = Math.min((+d.total || 1) - 1, RAW_STATE.page + 1); renderRawData(); },
  exportRawCSV,
  rawIrClasif: () => {
    if (window.CONFIG_STATE) { window.CONFIG_STATE.section = "clasificacion"; window.CONFIG_STATE.panel = null; }
    if (typeof window.switchTab === "function") window.switchTab("config");
  }
});
