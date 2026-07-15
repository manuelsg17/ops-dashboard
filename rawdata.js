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
  view:       "data",  // "data" = registros · "flotas" = mapeo CLID→flota · "recon" = conciliación por db_id
  editingClid: null,   // CLID de la fila en modo edicion en la vista Flotas
  expanded:   {}       // vista Conciliación: { clid: true } = CLID desglosado a db_id
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
  // Vista "Conciliación": resumen por CLID desglosable a db_id (para cuadrar vs Excel)
  if (RAW_STATE.view === "recon") {
    content.innerHTML = _renderReconView();
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
        <input class="crud-input" id="rawSearchReg" placeholder="Buscar partner o KAM..."
          value="${RAW_STATE.search.replace(/"/g, "&quot;")}"
          oninput="rawSearchInput(this,true)"
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
              ${escapeHTML(r.partner)}
            </td>
            <td style="font-size:.73rem;color:#555">${escapeHTML(r.kam) || "–"}</td>
            <td style="font-size:.73rem;color:#555">${escapeHTML(r.city) || "–"}</td>
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
      ${btn("recon",  "\uD83E\uDDFE Conciliaci\u00F3n (CLID \u2192 db_id)")}
    </div>`;
}

function rawSwitchView(v) {
  RAW_STATE.view = v;
  RAW_STATE.page = 0;
  renderRawData();
}

// Buscador sin perder foco: renderRawData reconstruye todo el panel (destruye el
// input al re-render). Guardamos el caret y re-enfocamos el mismo id tras el
// re-render → se puede escribir corrido (fix Fase 7). Espejo del arreglo de Config.
function rawSearchInput(inp, resetPage) {
  RAW_STATE.search = inp.value;
  if (resetPage) RAW_STATE.page = 0;
  const id = inp.id, pos = inp.selectionStart;
  renderRawData();
  const el = id && document.getElementById(id);
  if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} }
}

// \u2500\u2500 VISTA FLOTAS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Vista de auditoria del mapeo CLID \u2192 flota. La FUENTE DE VERDAD es la tabla
// `partners` (Configuracion). La tabla `flotas` solo:
//   - Marca CLIDs como inactivos (no se muestran en el dashboard)
//   - Anota la ciudad para auditoria
//   - Aporta nombre/KAM como fallback SOLO si el CLID no esta en `partners`
//
// Columnas:
//   - CLID
//   - Nombre Excel: lo que vino del Excel de rendimiento (informativo)
//   - Nombre EFECTIVO: el que el dashboard usa (Configuracion > flota > Excel)
//   - KAM EFECTIVO: idem
//   - Ciudad: lo que dice flota (o lo que vino del Excel)
//   - Estado: activa / inactiva / excluida por palabra prohibida
//   - Accion: editar (solo afecta tabla `flotas`)
function _renderFlotasView() {
  const flotasMap = STATE.flotasMap || {};
  const clids = Object.keys(flotasMap);

  const bannedLower = (STATE.bannedWords || []).map(w => w.toLowerCase());
  const isBanned = name => bannedLower.some(w => (name || "").toLowerCase().includes(w));

  // Mapa por CLID con la info del rendimiento.
  // `nombre_excel` = lo que vino crudo del Excel (campo `_partnerExcel`,
  // preservado al cargar desde BD). Si no esta, usa `_partnerOriginal` o
  // `partner` como ultimo fallback (compatibilidad con datos viejos donde el
  // upload pisaba el partner con CLID_MAP).
  const fromRawAll = new Map();
  STATE.rawDataFull.forEach(r => {
    if (!r.clid) return;
    if (!fromRawAll.has(r.clid)) {
      const excel = r._partnerExcel || r._partnerOriginal || r.partner;
      fromRawAll.set(r.clid, { nombre_excel: excel, ciudad: r.city });
    }
  });

  // Fleetrooms por CLID (sub-flotas con db_id real). Fuente: rawDataFull ya trae
  // db_id + fleetroom por fila. clid → Map(db_id → nombre). Solo db_id != ''.
  const fleetroomsByClid = new Map();
  STATE.rawDataFull.forEach(r => {
    if (!r.clid || !r.db_id) return;
    let m = fleetroomsByClid.get(r.clid);
    if (!m) { m = new Map(); fleetroomsByClid.set(r.clid, m); }
    if (!m.has(r.db_id)) m.set(r.db_id, r.fleetroom || "");
  });

  const allCLIDs = new Set([...clids, ...fromRawAll.keys()]);

  const q = (RAW_STATE.search || "").toLowerCase().trim();
  const ciudadF = RAW_STATE.city;

  const rows = [...allCLIDs].map(clid => {
    const f          = flotasMap[clid];
    const raw        = fromRawAll.get(clid);
    const enPartners = !!STATE.CLID_MAP[clid];

    // Fuente de verdad: partners. Fallback: flota. Ultimo recurso: Excel raw.
    const nombre_partners = STATE.CLID_MAP[clid] || "";
    const kam_partners    = (STATE.KAM_MAP[clid] || "").trim();
    const nombre_flota    = (f && f.nombre_asignado) || "";
    const kam_flota       = (f && f.kam) || "";
    const nombre_excel    = (raw && raw.nombre_excel) || (f && f.nombre_original) || "";

    const nombre_efectivo = nombre_partners || nombre_flota || nombre_excel || "\u2014";
    const kam_efectivo    = kam_partners    || kam_flota    || "\u2014";
    const ciudad          = (f && f.ciudad) || (raw && raw.ciudad) || "";

    const tieneFlota = !!f;
    const activo     = !f || f.activo !== false;
    const banned     = isBanned(nombre_excel) || isBanned(nombre_partners) || isBanned(nombre_flota);

    return {
      clid, enPartners,
      nombre_partners, nombre_flota, nombre_excel, nombre_efectivo,
      kam_partners, kam_flota, kam_efectivo,
      ciudad, tieneFlota, activo, banned
    };
  })
  .filter(r => {
    if (ciudadF !== "all" && r.ciudad !== ciudadF) return false;
    if (q) {
      const hay = [r.clid, r.nombre_excel, r.nombre_partners, r.nombre_flota,
                   r.kam_partners, r.kam_flota, r.ciudad]
        .some(s => (s || "").toLowerCase().includes(q));
      if (!hay) return false;
    }
    return true;
  })
  .sort((a, b) => (a.nombre_efectivo || a.clid).localeCompare(b.nombre_efectivo || b.clid));

  // Stats
  const conConfig = rows.filter(r => r.enPartners).length;
  const sinConfig = rows.filter(r => !r.enPartners).length;
  const inactivas = rows.filter(r => !r.activo).length;
  const baneadas  = rows.filter(r => r.banned).length;

  const allCities = [...new Set([...STATE.rawDataFull.map(r => r.city), ...Object.values(flotasMap).map(f => f.ciudad)].filter(Boolean))].sort();
  const cityOpts = allCities.map(c => `<option value="${c}"${RAW_STATE.city===c?" selected":""}>${cityLabel(c)}</option>`).join("");

  let html = secH("\uD83D\uDE9A", "#FF0000", "Vista Flotas",
    `${fmt(rows.length)} CLID(s) \u00B7 ${fmt(conConfig)} configurados en partners \u00B7 ${fmt(sinConfig)} sin configurar \u00B7 ${fmt(inactivas)} inactiva(s) \u00B7 ${fmt(baneadas)} por palabra prohibida`, "");

  html += _rawViewToggle();

  html += `
    <div class="section" style="margin-bottom:12px">
      <div style="font-size:.75rem;color:#555;margin-bottom:6px;background:#f0f9ff;border-left:3px solid #0ea5e9;padding:8px 12px;border-radius:4px">
        <strong>Fuente de verdad:</strong> Configuraci\u00F3n (tabla <code>partners</code>). El nombre y KAM que ves en el dashboard vienen de all\u00ED.
        Esta vista permite <strong>marcar CLIDs como inactivos</strong> (para excluir flotas de otras unidades de negocio) y anotar la ciudad.
        El "Nombre Excel" es informativo: sirve para detectar tuktuk/cargo/delivery/flotas antiguas. Si necesit\u00E1s cambiar nombre o KAM, hacelo en <strong>Configuraci\u00F3n</strong>.
        <div style="margin-top:6px">\uD83D\uDEFA Si un CLID trae <strong>fleetrooms</strong> (sub-flotas con <code>db_id</code>), se listan debajo y se marcan <strong>por fleetroom</strong>: <strong>Fleet</strong>, <strong>TukTuk</strong> o <strong>Excluir de Taxi</strong> (ej. delivery). As\u00ED solo esa sub-flota entra a TukTuk / sale de Taxi, sin afectar a las dem\u00E1s del mismo CLID.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <input class="crud-input" id="rawSearchFlotas" placeholder="Buscar CLID, partner, KAM, ciudad..."
          value="${(RAW_STATE.search || "").replace(/"/g, "&quot;")}"
          oninput="rawSearchInput(this,false)"
          style="flex:1;min-width:200px;max-width:340px"/>
        <select class="sb-sel" onchange="RAW_STATE.city=this.value;renderRawData()">
          <option value="all"${RAW_STATE.city==="all"?" selected":""}>Todas las ciudades</option>
          ${cityOpts}
        </select>
        <button class="crud-btn" onclick="exportFlotasCSV()"
          style="margin-left:auto;background:#f0fdf4;border-color:#86efac;color:#166534">\u2B07 Exportar CSV</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px">
        <span style="font-size:.72rem;font-weight:700;color:#92400e;white-space:nowrap">\uD83D\uDEFA Patrones TukTuk (sugerencia):</span>
        ${(STATE.tuktukPatterns || []).map(w => `
          <span style="display:inline-flex;align-items:center;gap:4px;background:#fff;border:1px solid #fde68a;border-radius:12px;padding:2px 4px 2px 9px;font-size:.7rem;color:#92400e">
            ${escapeHTML(w)}
            <button onclick="removeTuktukPattern('${w.replace(/'/g, "\\'")}')" title="Quitar" style="border:none;background:none;color:#b45309;cursor:pointer;font-weight:700;padding:0 4px">\u00D7</button>
          </span>`).join("")}
        <input id="newTuktukPattern" class="crud-input" placeholder="ej. mototaxi" style="width:130px;font-size:.72rem" onkeydown="if(event.key==='Enter')addTuktukPattern()"/>
        <button class="crud-btn" onclick="addTuktukPattern()" style="font-size:.7rem">+ Agregar</button>
      </div>
    </div>
    <div class="tbl-wrap">
      <table class="dtbl">
        <thead>
          <tr>
            <th>CLID</th>
            <th>Ciudad</th>
            <th>Nombre Excel</th>
            <th>Nombre <span style="color:#0ea5e9;font-weight:700">EFECTIVO</span></th>
            <th>KAM <span style="color:#0ea5e9;font-weight:700">EFECTIVO</span></th>
            <th style="text-align:center;width:55px">Fleet</th>
            <th style="text-align:center;width:65px">TukTuk</th>
            <th style="text-align:center;width:75px">Excluir<br>Taxi</th>
            <th style="text-align:center">Estado</th>
            <th style="text-align:center;width:90px">Acci\u00F3n</th>
          </tr>
        </thead>
        <tbody>`;

  // Opciones para selects (ciudades y KAMs disponibles)
  const cityOptList = ["LIMA","TRUJILLO","AREQUIPA"];
  const kamOptList  = [...new Set([
    ...Object.values(STATE.KAM_MAP),
    ...Object.values(STATE.flotasMap || {}).map(f => f.kam)
  ].filter(Boolean))].sort();

  // Celdas Fleet/TukTuk/Excluir-Taxi (3 <td>). Para CLIDs SIN fleetrooms (data
  // legacy sin db_id): checkboxes por CLID → `partners` via flotaSetFlag (Fleet
  // y TukTuk; Excluir no aplica a nivel CLID). Para CLIDs CON fleetrooms: el
  // tagging es por sub-flota (sub-filas debajo) → aquí solo una nota "↓ por
  // fleetroom", sin checkbox por CLID (evita ambigüedad). La sugerencia TukTuk
  // (badge + resalte) nunca auto-marca ni auto-guarda.
  function _flotaFlagCells(r, clidJS, hasFleetrooms) {
    if (hasFleetrooms) {
      const note = `<span style="font-size:.6rem;color:#0284c7;font-style:italic">↓ fleetroom</span>`;
      return `
          <td style="text-align:center">${note}</td>
          <td style="text-align:center">${note}</td>
          <td style="text-align:center">${note}</td>`;
    }
    const isFleet   = !!(STATE.CLID_IS_FLEET  || {})[r.clid];
    const isTuktuk  = !!(STATE.CLID_IS_TUKTUK || {})[r.clid];
    const suggested = !isTuktuk && _tuktukSuggested(r.nombre_excel);
    const pFall = escapeHTML(r.nombre_efectivo === "—" ? "" : r.nombre_efectivo).replace(/'/g, "\\'");
    const kFall = escapeHTML(r.kam_efectivo === "—" ? "" : r.kam_efectivo).replace(/'/g, "\\'");
    return `
          <td style="text-align:center">
            <input type="checkbox" title="Fleet" onchange="flotaSetFlag('${clidJS}','is_fleet',this.checked,'${pFall}','${kFall}')" ${isFleet ? "checked" : ""}/>
          </td>
          <td style="text-align:center">
            ${suggested ? `<div title="El Nombre Excel sugiere TukTuk" style="font-size:.62rem;color:#b45309;font-weight:700;margin-bottom:2px">\u{1F6FA}?</div>` : ""}
            <input type="checkbox" title="TukTuk" onchange="flotaSetFlag('${clidJS}','is_tuktuk',this.checked,'${pFall}','${kFall}')" ${isTuktuk ? "checked" : ""} style="${suggested ? "outline:2px solid #f59e0b" : ""}"/>
          </td>
          <td style="text-align:center"><span style="color:#ccc" title="Excluir de Taxi solo aplica por fleetroom">—</span></td>`;
  }

  // Sub-filas por fleetroom (una por db_id) debajo de la fila del CLID. Cada una
  // con 3 checkboxes (Fleet/TukTuk/Excluir Taxi) → fleetroomSetFlag(db_id,...).
  // La sugerencia TukTuk se evalúa sobre el NOMBRE del fleetroom.
  function _fleetroomSubRows(r, clidJS, froomMap) {
    const kamCtx  = escapeHTML(r.kam_efectivo === "—" ? "" : r.kam_efectivo).replace(/'/g, "\\'");
    const cityCtx = escapeHTML(r.ciudad || "").replace(/'/g, "\\'");
    return [...froomMap.entries()].sort((a, b) => (a[1] || a[0]).localeCompare(b[1] || b[0]))
      .map(([dbId, name]) => {
        const dbIdJS   = String(dbId).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const nameJS   = escapeHTML(name || "").replace(/'/g, "\\'");
        const isFleet  = !!(STATE.FLEETROOM_IS_FLEET     || {})[dbId];
        const isTuktuk = !!(STATE.FLEETROOM_IS_TUKTUK    || {})[dbId];
        const isExcl   = !!(STATE.FLEETROOM_EXCLUDE_TAXI || {})[dbId];
        const sugg     = !isTuktuk && _tuktukSuggested(name);
        const cb = (key, checked, extraStyle = "") =>
          `<input type="checkbox" onchange="fleetroomSetFlag('${dbIdJS}','${key}',this.checked,'${nameJS}','${clidJS}','${kamCtx}','${cityCtx}')" ${checked ? "checked" : ""} style="${extraStyle}"/>`;
        const dbShort = escapeHTML(String(dbId).slice(0, 10));
        return `
        <tr style="background:#f8fbff">
          <td style="text-align:right;color:#cbd5e1;font-size:.7rem;padding-right:6px">↳</td>
          <td colspan="4" style="padding-left:14px">
            <span style="font-weight:600;color:#0f172a">${escapeHTML(name || "(sin nombre)")}</span>
            ${sugg ? `<span title="El nombre sugiere TukTuk" style="margin-left:6px;font-size:.6rem;color:#b45309;font-weight:700">🛺?</span>` : ""}
            <span style="margin-left:6px;font-family:monospace;font-size:.62rem;color:#94a3b8" title="${escapeHTML(String(dbId))}">${dbShort}…</span>
          </td>
          <td style="text-align:center" title="Fleet">${cb("is_fleet", isFleet)}</td>
          <td style="text-align:center" title="TukTuk">${cb("is_tuktuk", isTuktuk, sugg ? "outline:2px solid #f59e0b" : "")}</td>
          <td style="text-align:center" title="Excluir de Taxi">${cb("exclude_from_taxi", isExcl)}</td>
          <td colspan="2"></td>
        </tr>`;
      }).join("");
  }

  rows.slice(0, 500).forEach(r => {
    const clidJS = r.clid.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const clidH  = escapeHTML(r.clid);
    const isEditing = RAW_STATE.editingClid === r.clid;
    const froomMap = fleetroomsByClid.get(r.clid);
    const hasFleetrooms = !!(froomMap && froomMap.size);

    if (isEditing) {
      // \u2500\u2500\u2500 FILA EN MODO EDICION \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const cityOpts = cityOptList.map(c =>
        `<option value="${c}"${r.ciudad===c?" selected":""}>${cityLabel(c)}</option>`).join("");
      const currentKamFlota = r.kam_flota || "";
      const kamOpts  = `<option value="">\u2014 sin KAM \u2014</option>` +
        kamOptList.map(k => `<option value="${escapeHTML(k)}"${currentKamFlota===k?" selected":""}>${escapeHTML(k)}</option>`).join("");
      const nombreWarning = r.enPartners
        ? `<div style="font-size:.66rem;color:#0ea5e9;margin-top:3px">\u26A0 Este CLID est\u00E1 configurado en partners como <strong>${escapeHTML(r.nombre_partners)}</strong>. El valor de aqu\u00ED solo se usar\u00EDa si lo borr\u00E1s de Configuraci\u00F3n.</div>`
        : `<div style="font-size:.66rem;color:#10b981;margin-top:3px">\u2713 Este CLID NO est\u00E1 en partners \u2014 este nombre ser\u00E1 el que use el dashboard.</div>`;
      const kamWarning = r.kam_partners
        ? `<div style="font-size:.66rem;color:#0ea5e9;margin-top:3px">\u26A0 KAM <strong>${escapeHTML(r.kam_partners)}</strong> configurado en partners. Este KAM solo se usar\u00EDa como fallback.</div>`
        : "";
      html += `
        <tr data-flota-clid="${clidH}" style="background:#fff8f8">
          <td style="font-family:monospace;font-size:.75rem;color:#666;vertical-align:top">${clidH}</td>
          <td style="vertical-align:top">
            <select id="flEdCity_${clidH}" class="crud-input" style="min-width:110px"><option value=""${r.ciudad?"":" selected"}>\u2014 sin ciudad \u2014</option>${cityOpts}</select>
          </td>
          <td style="color:#999;font-size:.75rem;vertical-align:top">${escapeHTML(r.nombre_excel || "\u2014")}</td>
          <td style="vertical-align:top">
            <input id="flEdName_${clidH}" class="crud-input" style="min-width:160px" value="${escapeHTML(r.nombre_flota || "")}" placeholder="opcional \u2014 fallback"/>
            ${nombreWarning}
          </td>
          <td style="vertical-align:top">
            <select id="flEdKam_${clidH}" class="crud-input" style="min-width:110px">${kamOpts}</select>
            ${kamWarning}
          </td>
          ${_flotaFlagCells(r, clidJS, hasFleetrooms)}
          <td style="text-align:center;vertical-align:top">
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:.72rem">
              <input id="flEdActivo_${clidH}" type="checkbox"${r.activo?" checked":""}/>
              <span>${r.activo?"Activa":"Inactiva"}</span>
            </label>
          </td>
          <td style="text-align:center;white-space:nowrap;vertical-align:top">
            <button onclick="flotaSaveEdit('${clidJS}')" style="padding:3px 8px;font-size:.7rem;background:#10b981;color:#fff;border:none;border-radius:5px;font-weight:700;cursor:pointer;margin-right:3px">\u2713 Guardar</button>
            <button onclick="flotaCancelEdit()"          style="padding:3px 8px;font-size:.7rem;background:#888;color:#fff;border:none;border-radius:5px;font-weight:700;cursor:pointer">\u2715</button>
          </td>
        </tr>`;
    } else {
      // \u2500\u2500\u2500 FILA EN MODO LECTURA \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const badge = !r.activo
        ? `<span style="background:#fee;color:#991b1b;padding:2px 7px;border-radius:8px;font-size:.7rem;font-weight:700">\uD83D\uDEAB Inactiva</span>`
        : r.banned
          ? `<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:8px;font-size:.7rem;font-weight:700">\uD83D\uDEAB Palabra prohibida</span>`
          : !r.enPartners
            ? `<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:8px;font-size:.7rem;font-weight:700">Sin config</span>`
            : `<span style="background:#dcfce7;color:#166534;padding:2px 7px;border-radius:8px;font-size:.7rem;font-weight:700">\u2713 Activa</span>`;
      const cityCell = r.ciudad
        ? cityLabel(r.ciudad)
        : `<span style="color:#aaa;font-style:italic">\u2014 sin ciudad \u2014</span>`;
      const nombreCell = r.enPartners
        ? `<span style="font-weight:700;color:#0ea5e9">${escapeHTML(r.nombre_partners)}</span>
           <div style="font-size:.62rem;color:#aaa">desde Configuraci\u00F3n</div>`
        : r.nombre_flota
          ? `<span style="font-weight:600">${escapeHTML(r.nombre_flota)}</span>
             <div style="font-size:.62rem;color:#f59e0b">fallback flotas</div>`
          : `<span style="color:#aaa;font-style:italic">${escapeHTML(r.nombre_excel || "\u2014")}</span>
             <div style="font-size:.62rem;color:#f59e0b">solo Excel</div>`;
      const kamCell = r.kam_partners
        ? `<span style="font-weight:700;color:#0ea5e9">${escapeHTML(r.kam_partners)}</span>
           <div style="font-size:.62rem;color:#aaa">desde Configuraci\u00F3n</div>`
        : r.kam_flota
          ? `<span style="font-weight:600">${escapeHTML(r.kam_flota)}</span>
             <div style="font-size:.62rem;color:#f59e0b">fallback flotas</div>`
          : `<span style="color:#aaa">\u2014</span>`;
      html += `
        <tr>
          <td style="font-family:monospace;font-size:.75rem;color:#666">${clidH}</td>
          <td>${cityCell}</td>
          <td style="color:#666;font-size:.78rem">${escapeHTML(r.nombre_excel || "\u2014")}</td>
          <td>${nombreCell}</td>
          <td>${kamCell}</td>
          ${_flotaFlagCells(r, clidJS, hasFleetrooms)}
          <td style="text-align:center">${badge}</td>
          <td style="text-align:center;white-space:nowrap">
            <button onclick="flotaStartEdit('${clidJS}')" title="Editar ciudad/activo/fallback" style="padding:3px 8px;font-size:.7rem;background:#fff;border:1px solid #ddd;border-radius:5px;cursor:pointer;margin-right:3px">\u270F\uFE0F</button>
            ${r.tieneFlota
              ? `<button onclick="flotaToggleActivo('${clidJS}', ${!r.activo})" title="${r.activo?'Marcar inactiva':'Reactivar'}" style="padding:3px 8px;font-size:.7rem;background:${r.activo?'#fff5f5':'#f0fdf4'};border:1px solid ${r.activo?'#fecaca':'#86efac'};color:${r.activo?'#991b1b':'#166534'};border-radius:5px;cursor:pointer">${r.activo?'\uD83D\uDEAB':'\u2713'}</button>`
              : `<button onclick="flotaToggleActivo('${clidJS}', false)" title="Marcar inactiva (crear flota)" style="padding:3px 8px;font-size:.7rem;background:#fff5f5;border:1px solid #fecaca;color:#991b1b;border-radius:5px;cursor:pointer">\uD83D\uDEAB</button>`}
          </td>
        </tr>`;
      // Sub-filas por fleetroom (solo lectura; el tagging es por db_id).
      if (hasFleetrooms) html += _fleetroomSubRows(r, clidJS, froomMap);
    }
  });

  if (rows.length > 500) {
    html += `<tr><td colspan="10" style="text-align:center;color:#aaa;padding:10px;font-size:.75rem;font-style:italic">Mostrando primeros 500 de ${fmt(rows.length)}. Us\u00E1 el buscador para filtrar.</td></tr>`;
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

// Guardar la edicion: lee los inputs de la fila y hace UPDATE/INSERT en Supabase.
// Edita solo la tabla `flotas` (no toca `partners`). El nombre/KAM solo se usa
// como fallback si el CLID no esta configurado en partners.
async function flotaSaveEdit(clid) {
  const elCity   = document.getElementById(`flEdCity_${clid}`);
  const elName   = document.getElementById(`flEdName_${clid}`);
  const elKam    = document.getElementById(`flEdKam_${clid}`);
  const elActivo = document.getElementById(`flEdActivo_${clid}`);
  if (!elActivo) { showBanner(false, "No se pudo leer la fila editada."); return; }

  const ciudad          = elCity ? elCity.value : "";
  const nombre_asignado = (elName && elName.value || "").trim();
  const kam             = elKam ? elKam.value : "";
  const activo          = elActivo.checked;

  showLoad(true, "Guardando...");
  try {
    const yaExiste = !!(STATE.flotasMap && STATE.flotasMap[clid]);
    const payload = { ciudad, nombre_asignado, kam, activo };
    if (yaExiste) {
      await updateFlotaField(clid, payload);
    } else {
      await createFlota(clid, payload);
    }
    RAW_STATE.editingClid = null;
    showBanner(true, "Flota actualizada ✓");
    await loadFromSupabase();
    renderRawData();
  } catch (err) {
    showBanner(false, "Error al guardar: " + err.message);
    console.error(err);
  } finally {
    showLoad(false);
  }
}

// Toggle rapido del flag `activo` sin entrar en modo edicion.
// Si el CLID no tiene registro en `flotas`, lo crea con activo=false (o lo
// reactiva eliminando el registro, segun el caso).
async function flotaToggleActivo(clid, nuevoEstado) {
  showLoad(true, nuevoEstado ? "Reactivando..." : "Marcando inactiva...");
  try {
    const yaExiste = !!(STATE.flotasMap && STATE.flotasMap[clid]);
    if (yaExiste) {
      await updateFlotaField(clid, { activo: nuevoEstado });
    } else {
      // Crear registro minimo en flotas para marcar como inactivo
      const existing = STATE.CLID_MAP[clid] || "";
      await createFlota(clid, { activo: nuevoEstado, nombre_asignado: existing });
    }
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

// Toggle rapido de is_fleet/is_tuktuk (escribe a `partners`, no a `flotas`).
// Sin modo edicion — se guarda al instante al tildar/destildar. partnerFallback/
// kamFallback = nombre/KAM EFECTIVOS ya resueltos para esta fila (si el CLID aun
// no esta en `partners`, evita perder el nombre en el primer upsert).
async function flotaSetFlag(clid, key, checked, partnerFallback, kamFallback) {
  showLoad(true, "Guardando...");
  try {
    await setPartnerFlag(clid, key, checked, partnerFallback, kamFallback);
    showBanner(true, "Actualizado ✓");
    await loadFromSupabase();
    renderRawData();
  } catch (err) {
    showBanner(false, "Error: " + err.message);
    console.error(err);
  } finally {
    showLoad(false);
  }
}

// Toggle de is_fleet/is_tuktuk/exclude_from_taxi POR FLEETROOM (db_id) — escribe
// a `fleetrooms`. Guarda al instante. name/kam/city = contexto de la sub-flota
// (para el primer upsert si el fleetroom aun no tiene fila). Preserva los otros
// dos flags dentro de setFleetroomFlag.
async function fleetroomSetFlag(dbId, key, checked, name, clid, kam, city) {
  showLoad(true, "Guardando...");
  try {
    await setFleetroomFlag(dbId, key, checked, { clid, name, kam, city });
    showBanner(true, "Actualizado ✓");
    await loadFromSupabase();
    renderRawData();
  } catch (err) {
    showBanner(false, "Error: " + err.message);
    console.error(err);
  } finally {
    showLoad(false);
  }
}

// Sugerencia (NO filtro): true si el Nombre Excel de un CLID matchea algún
// patrón TukTuk. Solo se usa para resaltar visualmente en Vista Flotas — nunca
// para excluir datos ni auto-marcar is_tuktuk.
function _tuktukSuggested(nombreExcel) {
  const patterns = (STATE.tuktukPatterns || []).map(w => w.toLowerCase());
  const name = (nombreExcel || "").toLowerCase();
  return patterns.some(w => name.includes(w));
}
// Gestión de la lista de patrones (cliente, sin round-trip a Supabase — es
// pura sugerencia visual, no afecta ningún dato ya cargado).
function addTuktukPattern() {
  const input = document.getElementById("newTuktukPattern");
  const word  = (input?.value || "").trim().toLowerCase();
  if (!word) return;
  if (STATE.tuktukPatterns.includes(word)) { showBanner(false, `"${word}" ya está en la lista.`); return; }
  STATE.tuktukPatterns.push(word);
  lsSet("yangoTuktukPatterns", JSON.stringify(STATE.tuktukPatterns));
  renderRawData();
  showBanner(true, `"${word}" agregado a patrones TukTuk ✓`);
}
function removeTuktukPattern(word) {
  STATE.tuktukPatterns = STATE.tuktukPatterns.filter(w => w !== word);
  lsSet("yangoTuktukPatterns", JSON.stringify(STATE.tuktukPatterns));
  renderRawData();
  showBanner(true, `"${word}" eliminado de patrones TukTuk ✓`);
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

// \u2550\u2550 VISTA CONCILIACI\u00D3N (CLID \u2192 db_id) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// Resumen por CLID desglosable a fleetroom (db_id) con las columnas del export de
// Yango, para cuadrar contra el Excel de otro colega. Marca qu\u00E9 sub-flotas se
// OMITEN del dashboard (TukTuk / Excluidas de Taxi). Corre sobre el dataset FULL
// ya deduplicado (dropLegacyAggregateRows) \u2192 sin doble conteo legacy+fleetroom.

// Formato K/M con 2 decimales (miles \u2192 "K", millones \u2192 "M"). N\u00FAmeros chicos tal
// cual. El valor exacto va en el title (hover) para conciliaci\u00F3n fina.
function _fmtKM2(n) {
  if (n === null || n === undefined || isNaN(n)) return "\u2014";
  const neg = n < 0, abs = Math.abs(n);
  let out;
  if (abs >= 1e6)      out = (abs / 1e6).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "M";
  else if (abs >= 1e3) out = (abs / 1e3).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "K";
  else                 out = abs.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return neg ? "-" + out : out;
}
function _num2(n) { return (n == null || isNaN(n)) ? "\u2014" : n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _pct1(n) { return (n == null || isNaN(n)) ? "\u2014" : (n * 100).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; }

function _reconNewAgg() { return { ad:0, sh:0, nuevos:0, react:0, trips:0, gmv:0, comm:0, ifsh:0, ofcars:0, accNum:0, accDen:0 }; }
function _reconAcc(a, r) {
  a.ad     += r.activeDrivers || 0;
  a.sh     += r.supplyHours   || 0;
  a.nuevos += (r.newPartner || 0) + (r.newService || 0);
  a.react  += r.reactivated   || 0;
  a.trips  += r.trips         || 0;
  a.gmv    += r.gmv           || 0;
  a.comm   += r.commission    || 0;
  a.ifsh   += r.internalFleetSh      || 0;
  a.ofcars += r.ownedFleetActiveCars || 0;
  if (r.acceptanceRate != null && r.trips) { a.accNum += r.acceptanceRate * r.trips; a.accDen += r.trips; }
}
// Clasificaci\u00F3n de una sub-flota (usa los predicados globales de data.js sobre una
// fila muestra; para db_id='' legacy caen al flag por CLID). Devuelve el estado y
// si se OMITE del dashboard (Taxi).
function _reconClasif(sample) {
  const tuk  = typeof rowIsTuktuk        === "function" && rowIsTuktuk(sample);
  const excl = typeof rowExcludedFromTaxi === "function" && rowExcludedFromTaxi(sample);
  const fleet= typeof rowIsFleet          === "function" && rowIsFleet(sample);
  if (tuk)             return { omit: true,  fleet, label: "\uD83D\uDEFA TukTuk (omitido)",   color: "#b45309", bg: "#fffbeb" };
  if (excl)            return { omit: true,  fleet, label: "\u26D4 Excluido (omitido)",  color: "#991b1b", bg: "#fff5f5" };
  if (fleet)           return { omit: false, fleet, label: "\uD83D\uDE97 Fleet",              color: "#166534", bg: "" };
  return                      { omit: false, fleet, label: "Taxi",                 color: "#64748b", bg: "" };
}

function _renderReconView() {
  const src0 = STATE.curMode === "mensual" ? STATE.rawDataMensualFull
             : STATE.curMode === "diario"  ? STATE.rawDataDiarioFull
             :                              STATE.rawDataFull;
  if (!src0 || !src0.length) {
    return secH("\uD83E\uDDFE", "#0ea5e9", "Conciliaci\u00F3n (CLID \u2192 db_id)", "Sin datos cargados.", "") + _rawViewToggle();
  }
  // FULL ya viene deduplicado; reaplicar es idempotente y garantiza no doble conteo.
  const src = (typeof dropLegacyAggregateRows === "function") ? dropLegacyAggregateRows(src0) : src0;

  const allDates = [...new Set(src.map(r => r.date))].sort();
  if (!RAW_STATE.dateFrom) RAW_STATE.dateFrom = allDates[0] || "";
  if (!RAW_STATE.dateTo)   RAW_STATE.dateTo   = allDates[allDates.length - 1] || "";
  const allCities = [...new Set(src.map(r => r.city).filter(Boolean))].sort();
  const q = (RAW_STATE.search || "").toLowerCase().trim();

  const inRange = r =>
    (RAW_STATE.city === "all" || r.city === RAW_STATE.city) &&
    (!RAW_STATE.dateFrom || r.date >= RAW_STATE.dateFrom) &&
    (!RAW_STATE.dateTo   || r.date <= RAW_STATE.dateTo);

  // Agrupar por CLID \u2192 fleetroom (db_id)
  const byClid = new Map();
  src.forEach(r => {
    if (!inRange(r)) return;
    const clid = r.clid || "(sin clid)";
    let c = byClid.get(clid);
    if (!c) { c = { clid, partner: "", kam: "", cities: new Set(), agg: _reconNewAgg(), frooms: new Map() }; byClid.set(clid, c); }
    c.partner = STATE.CLID_MAP[clid] || c.partner || r.partner || "";
    c.kam     = STATE.KAM_MAP[clid]  || c.kam     || r.kam     || "";
    if (r.city) c.cities.add(r.city);
    _reconAcc(c.agg, r);
    const fk = r.db_id || "";
    let f = c.frooms.get(fk);
    if (!f) { f = { db_id: fk, name: r.fleetroom || "", agg: _reconNewAgg(), sample: r }; c.frooms.set(fk, f); }
    if (!f.name && r.fleetroom) f.name = r.fleetroom;
    _reconAcc(f.agg, r);
  });

  let clids = [...byClid.values()];
  if (q) clids = clids.filter(c =>
    c.clid.toLowerCase().includes(q) || (c.partner || "").toLowerCase().includes(q) || (c.kam || "").toLowerCase().includes(q));
  clids.sort((a, b) => b.agg.ad - a.agg.ad);

  // Totales: full vs Taxi (lo que s\u00ED entra al dashboard) para ver lo omitido
  const totFull = _reconNewAgg(), totTaxi = _reconNewAgg();
  let omitCount = 0;
  clids.forEach(c => {
    _reconAcc2(totFull, c.agg);
    c.frooms.forEach(f => {
      const cl = _reconClasif(f.sample);
      if (cl.omit) omitCount++; else _reconAcc2(totTaxi, f.agg);
    });
  });

  // \u2500\u2500 Controles \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const dateFromOpts = allDates.map(d => `<option value="${d}"${d === RAW_STATE.dateFrom ? " selected" : ""}>${d2s(d)}</option>`).join("");
  const dateToOpts   = allDates.map(d => `<option value="${d}"${d === RAW_STATE.dateTo   ? " selected" : ""}>${d2s(d)}</option>`).join("");
  const cityOpts     = allCities.map(c => `<option value="${c}"${RAW_STATE.city === c ? " selected" : ""}>${cityLabel(c)}</option>`).join("");
  const singlePeriod = RAW_STATE.dateFrom === RAW_STATE.dateTo;

  let html = secH("\uD83E\uDDFE", "#0ea5e9", "Conciliaci\u00F3n (CLID \u2192 db_id)",
    `${fmt(clids.length)} CLID(s) \u00B7 ${fmt(omitCount)} sub-flota(s) omitida(s) del dashboard \u00B7 clic en un CLID para desglosar`, "");
  html += _rawViewToggle();

  html += `
    <div class="section" style="margin-bottom:12px">
      <div style="font-size:.75rem;color:#555;margin-bottom:8px;background:#f0f9ff;border-left:3px solid #0ea5e9;padding:8px 12px;border-radius:4px">
        Resumen por <strong>CLID</strong> con desglose por <strong>db_id</strong> (fleetroom). N\u00FAmeros con <strong>K/M y 2 decimales</strong> \u2014 el valor exacto est\u00E1 en el <em>hover</em> y en el CSV. Las sub-flotas <strong>\uD83D\uDEFA TukTuk</strong> y <strong>\u26D4 Excluidas</strong> NO entran al dashboard (Taxi) y van resaltadas; <strong>\uD83D\uDE97 Fleet</strong> s\u00ED entra (es subconjunto de Taxi).
        ${singlePeriod ? "" : `<div style="margin-top:6px;color:#b45309"><strong>Ojo:</strong> ten\u00E9s un rango de varios per\u00EDodos \u2014 AD y autos se <strong>suman</strong> entre ellos. Para cuadrar contra un Excel de un per\u00EDodo, pon\u00E9 el mismo per\u00EDodo en "Desde" y "Hasta".</div>`}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="crud-input" id="rawSearchRecon" placeholder="Buscar CLID, partner o KAM..."
          value="${(RAW_STATE.search || "").replace(/"/g, "&quot;")}" oninput="rawSearchInput(this,false)"
          style="flex:1;min-width:180px;max-width:280px"/>
        <select class="sb-sel" onchange="RAW_STATE.city=this.value;renderRawData()">
          <option value="all"${RAW_STATE.city === "all" ? " selected" : ""}>Todas las ciudades</option>${cityOpts}
        </select>
        <select class="sb-sel" onchange="RAW_STATE.dateFrom=this.value;renderRawData()">${dateFromOpts}</select>
        <span style="font-size:.75rem;color:#aaa">\u2192</span>
        <select class="sb-sel" onchange="RAW_STATE.dateTo=this.value;renderRawData()">${dateToOpts}</select>
        <button class="crud-btn" onclick="reconExpandAll(true)" style="padding:4px 10px">Expandir todo</button>
        <button class="crud-btn" onclick="reconExpandAll(false)" style="padding:4px 10px">Colapsar</button>
        <button class="crud-btn" onclick="exportReconCSV()" style="margin-left:auto;background:#f0fdf4;border-color:#86efac;color:#166534">\u2B07 Exportar CSV</button>
      </div>
    </div>`;

  // \u2500\u2500 Tabla \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const th = (l, extra = "") => `<th style="white-space:nowrap;${extra}">${l}</th>`;
  const numCells = a => `
    <td class="tn" title="${fmt(a.ad)}">${_fmtKM2(a.ad)}</td>
    <td class="tn" title="${fmt(a.sh)}">${_fmtKM2(a.sh)}</td>
    <td class="tn" title="${fmt(a.nuevos)}">${_fmtKM2(a.nuevos)}</td>
    <td class="tn" title="${fmt(a.react)}">${_fmtKM2(a.react)}</td>
    <td class="tn" title="${fmt(a.nuevos + a.react)}" style="font-weight:600">${_fmtKM2(a.nuevos + a.react)}</td>
    <td class="tn" title="${fmt(a.trips)}">${_fmtKM2(a.trips)}</td>
    <td class="tn" title="${fmt(a.gmv)}">${_fmtKM2(a.gmv)}</td>
    <td class="tn" title="${fmt(a.comm)}">${_fmtKM2(a.comm)}</td>
    <td class="tn" title="\u03A3 int.fleet.sh / \u03A3 autos">${a.ofcars > 0 ? _num2(a.ifsh / a.ofcars) : "\u2014"}</td>
    <td class="tn">${a.accDen > 0 ? _pct1(a.accNum / a.accDen) : "\u2014"}</td>
    <td class="tn" title="${fmt(a.ofcars)}">${_fmtKM2(a.ofcars)}</td>`;

  html += `
    <div class="tbl-wrap">
      <table class="dtbl">
        <thead><tr>
          <th style="width:26px"></th>
          ${th("CLID / Flota")}
          ${th("AD")}${th("Horas")}${th("Nuevos")}${th("React")}${th("N+R")}${th("Viajes")}${th("GMV")}${th("Comisi\u00F3n")}
          ${th("SH/auto<br>fleet")}${th("Acept.")}${th("Autos<br>fleet")}${th("Estado")}
        </tr></thead>
        <tbody>`;

  clids.slice(0, 400).forEach(c => {
    const clidJS = c.clid.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const open   = !!RAW_STATE.expanded[c.clid];
    const froomArr = [...c.frooms.values()];
    // omitido a nivel CLID (para el resumen)
    let omitAd = 0, omitN = 0;
    froomArr.forEach(f => { const cl = _reconClasif(f.sample); if (cl.omit) { omitAd += f.agg.ad; omitN++; } });
    const cityStr = [...c.cities].map(cityLabel).join(", ");
    const omitBadge = omitN
      ? `<span title="${omitN} sub-flota(s) fuera del dashboard \u00B7 AD omitido: ${fmt(omitAd)}" style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;font-size:.66rem;font-weight:700">omite ${omitN} \u00B7 ${_fmtKM2(omitAd)} AD</span>`
      : `<span style="color:#cbd5e1;font-size:.66rem">\u2014</span>`;

    html += `
      <tr onclick="reconToggleClid('${clidJS}')" style="cursor:pointer;background:#f9fafb;border-top:2px solid #eef2f7">
        <td style="text-align:center;color:#0ea5e9;font-weight:700">${froomArr.length > 1 || (froomArr[0] && froomArr[0].db_id) ? (open ? "\u25BE" : "\u25B8") : ""}</td>
        <td>
          <span style="font-family:monospace;font-size:.72rem;color:#64748b">${escapeHTML(c.clid)}</span>
          <span style="font-weight:700;margin-left:6px">${escapeHTML(c.partner || "(sin nombre)")}</span>
          <div style="font-size:.66rem;color:#94a3b8">${escapeHTML(c.kam || "sin KAM")}${cityStr ? " \u00B7 " + escapeHTML(cityStr) : ""} \u00B7 ${froomArr.length} fleetroom(s)</div>
        </td>
        ${numCells(c.agg)}
        <td style="text-align:center">${omitBadge}</td>
      </tr>`;

    if (open) {
      froomArr.sort((a, b) => b.agg.ad - a.agg.ad).forEach(f => {
        const cl = _reconClasif(f.sample);
        const dbShort = f.db_id ? escapeHTML(f.db_id.slice(0, 12)) + "\u2026" : "(legacy s/ db_id)";
        html += `
      <tr style="background:${cl.bg || "#fff"};${cl.omit ? "opacity:.92" : ""}">
        <td></td>
        <td style="padding-left:16px">
          <span style="color:#cbd5e1">\u21B3</span>
          <span style="font-weight:600">${escapeHTML(f.name || "(sin nombre)")}</span>
          <span style="font-family:monospace;font-size:.62rem;color:#94a3b8;margin-left:6px" title="${escapeHTML(f.db_id)}">${dbShort}</span>
        </td>
        ${numCells(f.agg)}
        <td style="text-align:center"><span style="color:${cl.color};font-size:.66rem;font-weight:700;white-space:nowrap">${cl.label}</span></td>
      </tr>`;
      });
    }
  });

  // Totales
  html += `
        <tr style="background:#eef6ff;font-weight:700;border-top:2px solid #bfdbfe">
          <td></td><td style="color:#1e40af">TOTAL (todo)</td>${numCells(totFull)}<td></td>
        </tr>
        <tr style="background:#f0fdf4;font-weight:700">
          <td></td><td style="color:#166534" title="Excluye TukTuk y sub-flotas excluidas">TOTAL en dashboard (Taxi)</td>${numCells(totTaxi)}<td></td>
        </tr>
        </tbody>
      </table>
    </div>`;

  if (clids.length > 400) {
    html += `<div style="text-align:center;color:#aaa;padding:10px;font-size:.75rem;font-style:italic">Mostrando primeros 400 de ${fmt(clids.length)} CLIDs. Us\u00E1 el buscador para filtrar.</div>`;
  }
  return html;
}
// Suma un agg dentro de otro (para totales).
function _reconAcc2(dst, a) {
  dst.ad += a.ad; dst.sh += a.sh; dst.nuevos += a.nuevos; dst.react += a.react;
  dst.trips += a.trips; dst.gmv += a.gmv; dst.comm += a.comm;
  dst.ifsh += a.ifsh; dst.ofcars += a.ofcars; dst.accNum += a.accNum; dst.accDen += a.accDen;
}

function reconToggleClid(clid) {
  RAW_STATE.expanded[clid] = !RAW_STATE.expanded[clid];
  renderRawData();
}
function reconExpandAll(open) {
  RAW_STATE.expanded = {};
  if (open) {
    const src = STATE.curMode === "mensual" ? STATE.rawDataMensualFull
              : STATE.curMode === "diario"  ? STATE.rawDataDiarioFull
              :                              STATE.rawDataFull;
    (src || []).forEach(r => { if (r.clid) RAW_STATE.expanded[r.clid] = true; });
  }
  renderRawData();
}

// Export CSV: una fila por (clid, db_id) con valores EXACTOS + clasificaci\u00F3n.
function exportReconCSV() {
  const src0 = STATE.curMode === "mensual" ? STATE.rawDataMensualFull
             : STATE.curMode === "diario"  ? STATE.rawDataDiarioFull
             :                              STATE.rawDataFull;
  const src = (typeof dropLegacyAggregateRows === "function") ? dropLegacyAggregateRows(src0 || []) : (src0 || []);
  const inRange = r =>
    (RAW_STATE.city === "all" || r.city === RAW_STATE.city) &&
    (!RAW_STATE.dateFrom || r.date >= RAW_STATE.dateFrom) &&
    (!RAW_STATE.dateTo   || r.date <= RAW_STATE.dateTo);

  const byKey = new Map();  // clid|db_id -> {clid, db_id, name, partner, kam, agg, sample}
  src.forEach(r => {
    if (!inRange(r)) return;
    const clid = r.clid || "(sin clid)", fk = r.db_id || "";
    const k = clid + "|" + fk;
    let g = byKey.get(k);
    if (!g) g = byKey.set(k, { clid, db_id: fk, name: r.fleetroom || "", partner: STATE.CLID_MAP[clid] || r.partner || "", kam: STATE.KAM_MAP[clid] || r.kam || "", agg: _reconNewAgg(), sample: r }).get(k);
    if (!g.name && r.fleetroom) g.name = r.fleetroom;
    _reconAcc(g.agg, r);
  });

  const header = ["CLID","db_id","Flota","Partner","KAM","Clasificacion","Omitido","AD","SupplyHours","Nuevos","Reactivados","N+R","Viajes","GMV","Comision","FleetSHxAuto","AcceptanceRate","FleetActiveCars"];
  const lines = [header.join(",")];
  [...byKey.values()].sort((a, b) => (a.partner || a.clid).localeCompare(b.partner || b.clid) || b.agg.ad - a.agg.ad).forEach(g => {
    const a = g.agg, cl = _reconClasif(g.sample);
    const clase = cl.label.replace(/[\uD83D\uDEFA\u26D4\uD83D\uDE97]/g, "").replace(/\s*\(omitido\)/, "").trim() || "Taxi";
    const fleetShCar = a.ofcars > 0 ? (a.ifsh / a.ofcars) : "";
    const accept = a.accDen > 0 ? (a.accNum / a.accDen) : "";
    const row = [g.clid, g.db_id, g.name, g.partner, g.kam, clase, cl.omit ? "SI" : "",
      a.ad, a.sh, a.nuevos, a.react, a.nuevos + a.react, a.trips, a.gmv, a.comm, fleetShCar, accept, a.ofcars]
      .map(v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; });
    lines.push(row.join(","));
  });

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `conciliacion_${RAW_STATE.dateFrom}_${RAW_STATE.dateTo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
