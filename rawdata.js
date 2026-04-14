// rawdata.js — Pestaña Data Raw: vista completa sin filtrar para comparar con Excel

const RAW_STATE = {
  page:       0,
  PAGE_SIZE:  50,
  search:     "",
  city:       "all",
  dateFrom:   "",
  dateTo:     "",
  showBanned: true,    // true = incluir flotas excluidas del dashboard
  sortCol:    "date",
  sortDir:    "asc"
};

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
function renderRawData() {
  const content = document.getElementById("rawdataContent");
  if (!content) return;

  const src = STATE.curMode === "mensual" ? STATE.rawDataMensualFull : STATE.rawDataFull;

  if (!src || !src.length) {
    content.innerHTML = `
      <div class="empty">
        <p>Sin datos cargados.</p>
        <p class="empty-sub">Sube un archivo de rendimiento para ver la data raw.</p>
      </div>`;
    return;
  }

  // Inicializar rangos de fecha si están vacíos
  const allDates = [...new Set(src.map(r => r.date))].sort();
  if (!RAW_STATE.dateFrom) RAW_STATE.dateFrom = allDates[0] || "";
  if (!RAW_STATE.dateTo)   RAW_STATE.dateTo   = allDates[allDates.length - 1] || "";

  // Ciudades únicas del full dataset
  const allCities = [...new Set(src.map(r => r.city).filter(Boolean))].sort();

  // Set de partners baneados (para marcar con 🚫)
  const banned = (STATE.bannedWords || []).map(w => w.toLowerCase());
  const isBanned = name => banned.some(w => (name || "").toLowerCase().includes(w));

  // ── Aplicar filtros ──────────────────────────────────────────────────────
  let filtered = src.filter(r => {
    if (!RAW_STATE.showBanned && isBanned(r.partner)) return false;
    if (RAW_STATE.city !== "all" && r.city !== RAW_STATE.city) return false;
    if (RAW_STATE.dateFrom && r.date < RAW_STATE.dateFrom) return false;
    if (RAW_STATE.dateTo   && r.date > RAW_STATE.dateTo)   return false;
    if (RAW_STATE.search) {
      const q = RAW_STATE.search.toLowerCase();
      if (!r.partner.toLowerCase().includes(q) && !(r.kam || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

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
  const pageRows   = filtered.slice(
    RAW_STATE.page * RAW_STATE.PAGE_SIZE,
    (RAW_STATE.page + 1) * RAW_STATE.PAGE_SIZE
  );

  // ── Helpers de cabecera con sort ─────────────────────────────────────────
  function thSort(label, colKey) {
    const active = RAW_STATE.sortCol === colKey;
    const arrow  = active ? (RAW_STATE.sortDir === "asc" ? " ↑" : " ↓") : "";
    const cls    = active ? (RAW_STATE.sortDir === "asc" ? "sa" : "sd") : "";
    return `<th class="${cls}" onclick="rawSortBy('${colKey}')" style="cursor:pointer;white-space:nowrap">${label}${arrow}</th>`;
  }

  // ── Date selects ─────────────────────────────────────────────────────────
  const dateFromOpts = allDates.map(d =>
    `<option value="${d}"${d === RAW_STATE.dateFrom ? " selected" : ""}>${d2s(d)}</option>`
  ).join("");
  const dateToOpts = allDates.map(d =>
    `<option value="${d}"${d === RAW_STATE.dateTo ? " selected" : ""}>${d2s(d)}</option>`
  ).join("");
  const cityOpts = allCities.map(c =>
    `<option value="${c}"${RAW_STATE.city === c ? " selected" : ""}>${c}</option>`
  ).join("");

  // ── Build HTML ───────────────────────────────────────────────────────────
  let html = secH("🗂️", "#6366f1", "Data Raw",
    `Todos los registros cargados · ${fmt(src.length)} total · ${fmt(STATE.rawData.length)} en dashboard · ${fmt(src.length - STATE.rawData.length)} excluidos`, "");

  // Controles de filtro
  html += `
    <div class="section" style="margin-bottom:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="crud-input" placeholder="Buscar partner o KAM..."
          value="${RAW_STATE.search.replace(/"/g, "&quot;")}"
          oninput="RAW_STATE.search=this.value;RAW_STATE.page=0;renderRawData()"
          style="flex:1;min-width:160px;max-width:260px"/>
        <select class="sb-sel" onchange="RAW_STATE.city=this.value;RAW_STATE.page=0;renderRawData()">
          <option value="all"${RAW_STATE.city === "all" ? " selected" : ""}>Todas las ciudades</option>
          ${cityOpts}
        </select>
        <select class="sb-sel" onchange="RAW_STATE.dateFrom=this.value;RAW_STATE.page=0;renderRawData()">
          ${dateFromOpts}
        </select>
        <span style="font-size:.75rem;color:#aaa">→</span>
        <select class="sb-sel" onchange="RAW_STATE.dateTo=this.value;RAW_STATE.page=0;renderRawData()">
          ${dateToOpts}
        </select>
        <label style="display:flex;align-items:center;gap:5px;font-size:.75rem;color:#555;cursor:pointer;white-space:nowrap">
          <input type="checkbox" ${RAW_STATE.showBanned ? "checked" : ""}
            onchange="RAW_STATE.showBanned=this.checked;RAW_STATE.page=0;renderRawData()"/>
          Mostrar excluidos 🚫
        </label>
        <button class="crud-btn" onclick="exportRawCSV()"
          style="margin-left:auto;background:#f0fdf4;border-color:#86efac;color:#166534">
          ⬇ Exportar CSV
        </button>
      </div>
      <div style="margin-top:6px;font-size:.73rem;color:#aaa">${fmt(total)} registro(s) · ${fmt(totalPages)} página(s)</div>
    </div>`;

  // Tabla
  html += `
    <div class="tbl-wrap">
      <table class="dtbl">
        <thead>
          <tr>
            ${thSort("Fecha", "date")}
            ${thSort("Partner", "partner")}
            ${thSort("KAM", "kam")}
            ${thSort("Ciudad", "city")}
            ${thSort("AD", "activeDrivers")}
            ${thSort("N+R", "nr")}
            ${thSort("Horas", "supplyHours")}
            ${thSort("Comisión", "commission")}
            ${thSort("Viajes", "trips")}
            <th style="width:36px"></th>
          </tr>
        </thead>
        <tbody>`;

  pageRows.forEach(r => {
    const nr        = r.newPartner + r.newService + r.reactivated;
    const banned_r  = isBanned(r.partner);
    const rowStyle  = banned_r ? "background:#fff8f8" : "";
    const statusIco = banned_r ? `<span title="Excluido del dashboard">🚫</span>` : "";
    html += `
          <tr style="${rowStyle}">
            <td style="color:#888;font-size:.72rem">${d2s(r.date)}</td>
            <td>
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${STATE.partnerColors[r.partner] || "#ccc"};margin-right:5px"></span>
              ${r.partner}
            </td>
            <td style="font-size:.73rem;color:#555">${r.kam || "–"}</td>
            <td style="font-size:.73rem;color:#555">${r.city || "–"}</td>
            <td class="tn">${fmt(r.activeDrivers)}</td>
            <td class="tn">${fmt(nr)}</td>
            <td class="tn">${fmt(r.supplyHours)}</td>
            <td class="tn">${fmtK(r.commission)}</td>
            <td class="tn">${fmt(r.trips)}</td>
            <td style="text-align:center">${statusIco}</td>
          </tr>`;
  });

  // Fila de totales (siempre visible, basada en el set filtrado completo)
  html += `
          <tr style="background:#f9fffe;font-weight:700;border-top:2px solid #e5e7eb">
            <td colspan="4" style="font-size:.75rem;color:#555">TOTAL (${fmt(total)} filas)</td>
            <td class="tn" style="color:#111">${fmt(totAD)}</td>
            <td class="tn" style="color:#111">${fmt(totNR)}</td>
            <td class="tn" style="color:#111">${fmt(totSH)}</td>
            <td class="tn" style="color:#111">${fmtK(totCom)}</td>
            <td class="tn" style="color:#111">${fmt(totTrip)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>`;

  // Paginación
  if (totalPages > 1) {
    html += `
    <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:.78rem;color:#555">
      <button class="crud-btn" onclick="RAW_STATE.page=Math.max(0,RAW_STATE.page-1);renderRawData()"
        ${RAW_STATE.page === 0 ? "disabled" : ""} style="padding:4px 10px">← Anterior</button>
      <span>Página <strong>${RAW_STATE.page + 1}</strong> de <strong>${totalPages}</strong></span>
      <button class="crud-btn" onclick="RAW_STATE.page=Math.min(${totalPages - 1},RAW_STATE.page+1);renderRawData()"
        ${RAW_STATE.page === totalPages - 1 ? "disabled" : ""} style="padding:4px 10px">Siguiente →</button>
    </div>`;
  }

  content.innerHTML = html;
}

// ── SORT ──────────────────────────────────────────────────────────────────────
function rawSortBy(col) {
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
function exportRawCSV() {
  const src    = STATE.curMode === "mensual" ? STATE.rawDataMensualFull : STATE.rawDataFull;
  const banned = (STATE.bannedWords || []).map(w => w.toLowerCase());
  const isBanned = name => banned.some(w => (name || "").toLowerCase().includes(w));

  const rows = src.filter(r => {
    if (!RAW_STATE.showBanned && isBanned(r.partner)) return false;
    if (RAW_STATE.city !== "all" && r.city !== RAW_STATE.city) return false;
    if (RAW_STATE.dateFrom && r.date < RAW_STATE.dateFrom) return false;
    if (RAW_STATE.dateTo   && r.date > RAW_STATE.dateTo)   return false;
    if (RAW_STATE.search) {
      const q = RAW_STATE.search.toLowerCase();
      if (!r.partner.toLowerCase().includes(q) && !(r.kam || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const header = ["Fecha", "Partner", "KAM", "Ciudad", "AD", "N+R", "Horas", "Comision", "Viajes", "Excluido"];
  const lines  = [header.join(",")];
  rows.forEach(r => {
    const nr = r.newPartner + r.newService + r.reactivated;
    const excl = isBanned(r.partner) ? "Sí" : "";
    // Wrap text fields in quotes to handle commas
    lines.push([
      r.date,
      `"${r.partner}"`,
      `"${r.kam || ""}"`,
      `"${r.city || ""}"`,
      r.activeDrivers,
      nr,
      r.supplyHours,
      r.commission,
      r.trips,
      excl
    ].join(","));
  });

  // UTF-8 BOM so Excel opens with correct encoding
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `data_raw_${RAW_STATE.dateFrom}_${RAW_STATE.dateTo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
