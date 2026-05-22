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
  sortDir:    "asc",
  view:       "data",  // "data" = registros de rendimiento, "flotas" = mapeo CLID→flota
  editingClid: null    // CLID de la fila en modo edicion en la vista Flotas
};

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
function renderRawData() {
  const content = document.getElementById("rawdataContent");
  if (!content) return;

  // Si la vista es "flotas", renderizamos un panel distinto
  if (RAW_STATE.view === "flotas") {
    content.innerHTML = _renderFlotasView();
    return;
  }

  const src = STATE.curMode === "mensual" ? STATE.rawDataMensualFull
            : STATE.curMode === "diario"  ? STATE.rawDataDiarioFull
            :                              STATE.rawDataFull;

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

  // Toggle Data Raw / Flotas
  html += _rawViewToggle();

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
  const src    = STATE.curMode === "mensual" ? STATE.rawDataMensualFull
               : STATE.curMode === "diario"  ? STATE.rawDataDiarioFull
               :                              STATE.rawDataFull;
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

// \u2500\u2500 TOGGLE ENTRE VISTA REGISTROS Y VISTA FLOTAS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function _rawViewToggle() {
  const isData   = RAW_STATE.view !== "flotas";
  const btn = (v, label) => `
    <button onclick="rawSwitchView('${v}')"
      style="padding:6px 14px;font-size:.78rem;font-weight:700;border:1px solid #ddd;cursor:pointer;
        background:${RAW_STATE.view===v?'#FF0000':'#fff'};color:${RAW_STATE.view===v?'#fff':'#555'};
        border-radius:6px">${label}</button>`;
  return `
    <div style="display:flex;gap:6px;margin-bottom:12px">
      ${btn("data",   "\uD83D\uDCCA Registros")}
      ${btn("flotas", "\uD83D\uDE9A Flotas (CLID \u2192 Nombre)")}
    </div>`;
}

function rawSwitchView(v) {
  RAW_STATE.view = v;
  RAW_STATE.page = 0;
  renderRawData();
}

// \u2500\u2500 VISTA FLOTAS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Muestra mapeo CLID \u2192 flota (de la tabla `flotas`) cruzado con datos del raw
// para mostrar: CLID, Ciudad, Nombre original (del Excel), Nombre asignado, KAM,
// y si esta excluida por bannedWords o por activo=false.
function _renderFlotasView() {
  const flotasMap = STATE.flotasMap || {};
  const clids = Object.keys(flotasMap);

  // Construir el universo de CLIDs: union de los que estan en flotas y los que
  // aparecen en rawDataFull. Asi vemos tambien CLIDs sin flota asignada.
  const bannedLower = (STATE.bannedWords || []).map(w => w.toLowerCase());
  const isBanned = name => bannedLower.some(w => (name || "").toLowerCase().includes(w));

  const fromRawAll = new Map(); // clid -> { nombre_original, ciudad, kam }
  STATE.rawDataFull.forEach(r => {
    if (!r.clid) return;
    if (!fromRawAll.has(r.clid)) {
      const original = r._partnerOriginal || r.partner;
      fromRawAll.set(r.clid, {
        nombre_original: original,
        ciudad: r.city,
        kam: r.kam || getKAMForPartner(original) || ""
      });
    }
  });

  const allCLIDs = new Set([...clids, ...fromRawAll.keys()]);

  // Aplicar filtro de busqueda y ciudad
  const q = (RAW_STATE.search || "").toLowerCase().trim();
  const ciudadF = RAW_STATE.city;
  const rows = [...allCLIDs].map(clid => {
    const f = flotasMap[clid];
    const raw = fromRawAll.get(clid);
    const ciudad         = (f && f.ciudad)         || (raw && raw.ciudad)         || "";
    const nombre_original= (raw && raw.nombre_original) || (f && f.nombre_original) || "";
    const nombre_asignado= (f && f.nombre_asignado) || "";
    const kam            = (f && f.kam)            || (raw && raw.kam)            || "";
    const tieneFlota     = !!f;
    const activo         = !f || f.activo !== false;
    const banned         = isBanned(nombre_original) || isBanned(nombre_asignado);
    return { clid, ciudad, nombre_original, nombre_asignado, kam, tieneFlota, activo, banned };
  })
  .filter(r => {
    if (ciudadF !== "all" && r.ciudad !== ciudadF) return false;
    if (q) {
      const hay = [r.clid, r.nombre_original, r.nombre_asignado, r.kam, r.ciudad]
        .some(s => (s || "").toLowerCase().includes(q));
      if (!hay) return false;
    }
    return true;
  })
  .sort((a, b) => (a.nombre_asignado || a.nombre_original || a.clid)
                    .localeCompare(b.nombre_asignado || b.nombre_original || b.clid));

  // Stats
  const conFlota   = rows.filter(r => r.tieneFlota).length;
  const sinFlota   = rows.filter(r => !r.tieneFlota).length;
  const excluidas  = rows.filter(r => r.banned || !r.activo).length;

  const allCities = [...new Set([...STATE.rawDataFull.map(r => r.city), ...Object.values(flotasMap).map(f => f.ciudad)].filter(Boolean))].sort();
  const cityOpts = allCities.map(c => `<option value="${c}"${RAW_STATE.city===c?" selected":""}>${cityLabel(c)}</option>`).join("");

  let html = secH("\uD83D\uDE9A", "#FF0000", "Vista Flotas",
    `Mapeo CLID \u2192 Nombre asignado \u00B7 ${fmt(rows.length)} CLID(s) \u00B7 ${fmt(conFlota)} con flota \u00B7 ${fmt(sinFlota)} sin flota \u00B7 ${fmt(excluidas)} excluida(s)`, "");

  html += _rawViewToggle();

  html += `
    <div class="section" style="margin-bottom:12px">
      <div style="font-size:.75rem;color:#888;margin-bottom:10px">
        Mostr\u00E1 <strong>todos</strong> los CLIDs que aparecen en tu base, con su nombre original del Excel y el nombre que vos asignaste en la tabla <code>flotas</code>.
        Marca \uD83D\uDEAB si est\u00E1 excluido por palabra prohibida o si <code>activo=false</code>.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <input class="crud-input" placeholder="Buscar CLID, partner, KAM, ciudad..."
          value="${(RAW_STATE.search || "").replace(/"/g, "&quot;")}"
          oninput="RAW_STATE.search=this.value;renderRawData()"
          style="flex:1;min-width:200px;max-width:340px"/>
        <select class="sb-sel" onchange="RAW_STATE.city=this.value;renderRawData()">
          <option value="all"${RAW_STATE.city==="all"?" selected":""}>Todas las ciudades</option>
          ${cityOpts}
        </select>
        <button class="crud-btn" onclick="exportFlotasCSV()"
          style="margin-left:auto;background:#f0fdf4;border-color:#86efac;color:#166534">\u2B07 Exportar CSV</button>
      </div>
    </div>
    <div class="tbl-wrap">
      <table class="dtbl">
        <thead>
          <tr>
            <th>CLID</th>
            <th>Ciudad</th>
            <th>Nombre original (Excel)</th>
            <th>Nombre asignado</th>
            <th>KAM</th>
            <th style="text-align:center">Activa</th>
            <th style="text-align:center;width:80px">Acci\u00F3n</th>
          </tr>
        </thead>
        <tbody>`;

  // Opciones para selects (ciudades y KAMs disponibles)
  const cityOptList = ["LIMA","TRUJILLO","AREQUIPA"];
  const kamOptList  = [...new Set([...Object.values(STATE.KAM_MAP), ...Object.values(STATE.flotasMap || {}).map(f => f.kam)].filter(Boolean))].sort();

  rows.slice(0, 500).forEach(r => {
    const clidJS = r.clid.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const clidH  = escapeHTML(r.clid);
    const isEditing = RAW_STATE.editingClid === r.clid;

    if (isEditing) {
      // \u2500\u2500\u2500 FILA EN MODO EDICION \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const cityOpts = cityOptList.map(c =>
        `<option value="${c}"${r.ciudad===c?" selected":""}>${cityLabel(c)}</option>`).join("");
      const kamOpts  = `<option value="">\u2014 sin KAM \u2014</option>` +
        kamOptList.map(k => `<option value="${escapeHTML(k)}"${r.kam===k?" selected":""}>${escapeHTML(k)}</option>`).join("");
      html += `
        <tr data-flota-clid="${clidH}" style="background:#fff8f8">
          <td style="font-family:monospace;font-size:.75rem;color:#666">${clidH}</td>
          <td><select id="flEdCity_${clidH}" class="crud-input" style="min-width:110px"><option value=""${r.ciudad?"":" selected"}>\u2014 sin ciudad \u2014</option>${cityOpts}</select></td>
          <td style="color:#999;font-size:.75rem">${escapeHTML(r.nombre_original || "\u2014")}</td>
          <td><input id="flEdName_${clidH}" class="crud-input" style="min-width:160px" value="${escapeHTML(r.nombre_asignado || "")}"/></td>
          <td><select id="flEdKam_${clidH}" class="crud-input" style="min-width:110px">${kamOpts}</select></td>
          <td style="text-align:center">
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:.72rem">
              <input id="flEdActivo_${clidH}" type="checkbox"${r.activo?" checked":""}/>
              <span>${r.activo?"S\u00ED":"No"}</span>
            </label>
          </td>
          <td style="text-align:center;white-space:nowrap">
            <button onclick="flotaSaveEdit('${clidJS}')"  style="padding:3px 8px;font-size:.7rem;background:#10b981;color:#fff;border:none;border-radius:5px;font-weight:700;cursor:pointer;margin-right:3px">\u2713</button>
            <button onclick="flotaCancelEdit()"           style="padding:3px 8px;font-size:.7rem;background:#888;color:#fff;border:none;border-radius:5px;font-weight:700;cursor:pointer">\u2715</button>
          </td>
        </tr>`;
    } else {
      // \u2500\u2500\u2500 FILA EN MODO LECTURA \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const badge = !r.tieneFlota
        ? `<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:8px;font-size:.7rem;font-weight:700">Sin flota</span>`
        : !r.activo
          ? `<span style="background:#fee;color:#991b1b;padding:2px 7px;border-radius:8px;font-size:.7rem;font-weight:700">\uD83D\uDEAB Inactiva</span>`
          : r.banned
            ? `<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:8px;font-size:.7rem;font-weight:700">\uD83D\uDEAB Palabra prohibida</span>`
            : `<span style="background:#dcfce7;color:#166534;padding:2px 7px;border-radius:8px;font-size:.7rem;font-weight:700">\u2713 Activa</span>`;
      const cityCell = r.ciudad
        ? cityLabel(r.ciudad)
        : `<span style="color:#aaa;font-style:italic">\u2014 sin ciudad \u2014</span>`;
      html += `
        <tr>
          <td style="font-family:monospace;font-size:.75rem;color:#666">${clidH}</td>
          <td>${cityCell}</td>
          <td style="color:#666">${escapeHTML(r.nombre_original || "\u2014")}</td>
          <td style="font-weight:600">${escapeHTML(r.nombre_asignado || "\u2014")}</td>
          <td>${escapeHTML(r.kam || "\u2014")}</td>
          <td style="text-align:center">${badge}</td>
          <td style="text-align:center;white-space:nowrap">
            <button onclick="flotaStartEdit('${clidJS}')" title="Editar" style="padding:3px 8px;font-size:.7rem;background:#fff;border:1px solid #ddd;border-radius:5px;cursor:pointer;margin-right:3px">\u270F\uFE0F</button>
            ${r.tieneFlota
              ? `<button onclick="flotaToggleActivo('${clidJS}', ${!r.activo})" title="${r.activo?'Marcar inactiva':'Reactivar'}" style="padding:3px 8px;font-size:.7rem;background:${r.activo?'#fff5f5':'#f0fdf4'};border:1px solid ${r.activo?'#fecaca':'#86efac'};color:${r.activo?'#991b1b':'#166534'};border-radius:5px;cursor:pointer">${r.activo?'\uD83D\uDEAB':'\u2713'}</button>`
              : ""}
          </td>
        </tr>`;
    }
  });

  if (rows.length > 500) {
    html += `<tr><td colspan="7" style="text-align:center;color:#aaa;padding:10px;font-size:.75rem;font-style:italic">Mostrando primeros 500 de ${fmt(rows.length)}. Us\u00E1 el buscador para filtrar.</td></tr>`;
  }

  html += `</tbody></table></div>`;

  if (!Object.keys(flotasMap).length) {
    html += `
      <div style="margin-top:14px;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:.78rem;color:#92400e">
        \uD83D\uDCA1 A\u00FAn no subiste ninguna flota. Sub\u00ED un Excel con columnas <code>CLID | CIUDAD | NOMBRE_ASIGNADO | KAM | ACTIVO</code> desde <strong>Actualizar informaci\u00F3n \u2192 Flotas</strong>.
      </div>`;
  }

  return html;
}

// ── EDICION INLINE DE FLOTAS ──────────────────────────────────────────────────
// Entrar en modo edicion para una fila (se renderiza con inputs)
function flotaStartEdit(clid) {
  RAW_STATE.editingClid = clid;
  renderRawData();
}

function flotaCancelEdit() {
  RAW_STATE.editingClid = null;
  renderRawData();
}

// Guardar la edicion: lee los inputs de la fila y hace UPDATE en Supabase.
// Si el CLID no tenia registro en `flotas`, hace INSERT.
async function flotaSaveEdit(clid) {
  const clidH = clid.replace(/'/g, "\\'");
  const safe = id => id.replace(/[^a-zA-Z0-9_]/g, "");
  // Los IDs en el HTML usan el clid escapeado, pero como solo son digitos, esto es directo
  const elCity   = document.getElementById(`flEdCity_${clid}`);
  const elName   = document.getElementById(`flEdName_${clid}`);
  const elKam    = document.getElementById(`flEdKam_${clid}`);
  const elActivo = document.getElementById(`flEdActivo_${clid}`);
  if (!elName) { showBanner(false, "No se pudo leer la fila editada."); return; }

  const ciudad = elCity ? elCity.value : "";
  const nombre = (elName.value || "").trim();
  const kam    = elKam ? elKam.value : "";
  const activo = elActivo ? elActivo.checked : true;

  if (!nombre) { showBanner(false, "El nombre asignado no puede estar vacío."); return; }

  showLoad(true, "Guardando...");
  try {
    const yaExiste = !!(STATE.flotasMap && STATE.flotasMap[clid]);
    if (yaExiste) {
      await updateFlotaField(clid, {
        ciudad, nombre_asignado: nombre, kam, activo
      });
    } else {
      await createFlota(clid, {
        ciudad, nombre_asignado: nombre, kam, activo,
        nombre_original: STATE.flotasMap?.[clid]?.nombre_original || ""
      });
    }
    RAW_STATE.editingClid = null;
    showBanner(true, "Flota actualizada ✓");
    await loadFromSupabase();   // reload completo para que el override se reaplique en todas las pestañas
    renderRawData();
  } catch (err) {
    showBanner(false, "Error al guardar: " + err.message);
    console.error(err);
  } finally {
    showLoad(false);
  }
}

// Toggle rapido del flag `activo` sin entrar en modo edicion
async function flotaToggleActivo(clid, nuevoEstado) {
  showLoad(true, nuevoEstado ? "Reactivando..." : "Marcando inactiva...");
  try {
    await updateFlotaField(clid, { activo: nuevoEstado });
    showBanner(true, nuevoEstado ? "Flota reactivada ✓" : "Flota marcada inactiva ✓");
    await loadFromSupabase();
    renderRawData();
  } catch (err) {
    showBanner(false, "Error: " + err.message);
    console.error(err);
  } finally {
    showLoad(false);
  }
}

function exportFlotasCSV() {
  const flotasMap = STATE.flotasMap || {};
  const fromRawAll = new Map();
  STATE.rawDataFull.forEach(r => {
    if (!r.clid) return;
    if (!fromRawAll.has(r.clid)) {
      fromRawAll.set(r.clid, {
        nombre_original: r._partnerOriginal || r.partner,
        ciudad: r.city,
        kam: r.kam || getKAMForPartner(r.partner) || ""
      });
    }
  });
  const allCLIDs = new Set([...Object.keys(flotasMap), ...fromRawAll.keys()]);
  const headers = ["CLID","CIUDAD","NOMBRE_ORIGINAL","NOMBRE_ASIGNADO","KAM","ACTIVO"];
  const lines = [headers.join(",")];
  [...allCLIDs].forEach(clid => {
    const f = flotasMap[clid];
    const raw = fromRawAll.get(clid);
    const row = [
      clid,
      (f && f.ciudad) || (raw && raw.ciudad) || "",
      (raw && raw.nombre_original) || (f && f.nombre_original) || "",
      (f && f.nombre_asignado) || "",
      (f && f.kam) || (raw && raw.kam) || "",
      (f ? (f.activo !== false ? "true" : "false") : "true")
    ].map(v => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(row.join(","));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flotas_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
