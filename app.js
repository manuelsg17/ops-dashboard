// app.js — Inicialización principal, sidebar, tabs y helpers de UI

// ── APP INIT ──────────────────────────────────────────────────────────────────
function initApp() {
  // Restaurar configuración de alerta de declive
  try {
    const d = JSON.parse(localStorage.getItem("yangoDecline") || "{}");
    if (d.metric)    STATE.declineMetric    = d.metric;
    if (d.threshold) STATE.declineThreshold = d.threshold;
  } catch(e) {}

  initFileHandlers();

  // Debounce en búsqueda de partners
  let _pSearchTimer;
  document.getElementById("partnerSearch").addEventListener("input", () => {
    clearTimeout(_pSearchTimer);
    _pSearchTimer = setTimeout(filterPList, 300);
  });

  // Cerrar dropdowns al hacer clic fuera
  document.addEventListener("click", () => {
    const m = document.getElementById("uploadMenu");
    if (m) m.classList.remove("open");
    const a = document.getElementById("analisisMenu");
    if (a) {
      a.classList.remove("open");
      const w = document.getElementById("navAnalisisWrap");
      if (w) w.classList.remove("menu-open");
    }
  });

  // Cerrar dropdown al seleccionar un archivo
  ["fileRend", "fileRendMensual", "fileMetas", "fileData"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      const m = document.getElementById("uploadMenu");
      if (m) m.classList.remove("open");
    });
  });

  attachTooltipEvents(); // solo se necesita una vez
  loadFromSupabase();
}

function toggleUploadMenu(e) {
  e.stopPropagation();
  document.getElementById("uploadMenu").classList.toggle("open");
}

// ── NAV ANÁLISIS DROPDOWN ─────────────────────────────────────────────────────
function toggleAnalisisMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById("analisisMenu");
  const wrap = document.getElementById("navAnalisisWrap");
  menu.classList.toggle("open");
  wrap.classList.toggle("menu-open", menu.classList.contains("open"));
}

function switchTabFromMenu(tab) {
  document.getElementById("analisisMenu").classList.remove("open");
  document.getElementById("navAnalisisWrap").classList.remove("menu-open");
  switchTab(tab);
}

// ── SIDEBAR TOGGLE ────────────────────────────────────────────────────────────
const _SVG_COLLAPSE = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`;
const _SVG_EXPAND   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;

function toggleSidebar() {
  const sb  = document.getElementById("mainSidebar");
  const btn = document.getElementById("sidebarToggle");
  const collapsed = sb.classList.toggle("collapsed");
  btn.innerHTML = collapsed ? _SVG_EXPAND : _SVG_COLLAPSE;
  localStorage.setItem("yangoSidebarCollapsed", collapsed ? "1" : "0");
  // Reajustar gráficas ApexCharts al cambiar ancho
  setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
}

// ── FILTROS EN localStorage ───────────────────────────────────────────────────
function saveFilters() {
  const f = {
    dateFrom: document.getElementById("dateFrom")?.value,
    dateTo:   document.getElementById("dateTo")?.value,
    city:     document.getElementById("cityFilter")?.value,
    kam:      document.getElementById("kamFilter")?.value,
    search:   document.getElementById("partnerSearch")?.value,
    selected: getSel(),
    mode:     STATE.curMode
  };
  localStorage.setItem("yangoFilters", JSON.stringify(f));
}

function restoreFilters() {
  const raw = localStorage.getItem("yangoFilters");
  if (!raw) return;
  try {
    const f = JSON.parse(raw);
    const optVals = sel => [...(sel?.options || [])].map(o => o.value);

    if (f.dateFrom) {
      const el = document.getElementById("dateFrom");
      if (el && optVals(el).includes(f.dateFrom)) el.value = f.dateFrom;
    }
    if (f.dateTo) {
      const el = document.getElementById("dateTo");
      if (el && optVals(el).includes(f.dateTo)) el.value = f.dateTo;
    }
    if (f.city) {
      const el = document.getElementById("cityFilter");
      if (el && optVals(el).includes(f.city)) el.value = f.city;
    }
    if (f.kam) {
      const el = document.getElementById("kamFilter");
      if (el && optVals(el).includes(f.kam)) {
        el.value = f.kam;
        onKAMChange();
      }
    }
    if (f.search) {
      const el = document.getElementById("partnerSearch");
      if (el) { el.value = f.search; filterPList(); }
    }
    if (f.selected && f.selected.length) {
      document.querySelectorAll("#pList input").forEach(c => {
        c.checked = f.selected.includes(c.value);
      });
    }
    if (f.mode && f.mode !== STATE.curMode && !_inSwitchMode) switchMode(f.mode);
  } catch (e) {
    localStorage.removeItem("yangoFilters");
  }

  // Restaurar estado del sidebar
  if (localStorage.getItem("yangoSidebarCollapsed") === "1") {
    const sb  = document.getElementById("mainSidebar");
    const btn = document.getElementById("sidebarToggle");
    if (sb)  sb.classList.add("collapsed");
    if (btn) btn.innerHTML = _SVG_EXPAND;
  }
}

// ── MODE SWITCH (Semanal / Mensual) ───────────────────────────────────────────
let _inSwitchMode = false; // guard: evita que restoreFilters() revierta el cambio de modo
function switchMode(mode) {
  if (_inSwitchMode) return;
  _inSwitchMode = true;

  STATE.curMode = mode;

  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  // Swap rawData según el modo
  if (mode === "mensual") {
    STATE._rawDataSemanal = STATE._rawDataSemanal || STATE.rawData;
    STATE.rawData = STATE.rawDataMensual;
  } else {
    if (STATE._rawDataSemanal) STATE.rawData = STATE._rawDataSemanal;
  }

  // updateIndexes ya llama popDates/popKAM/popPartners/restoreFilters internamente
  updateIndexes();

  if (STATE.curTab === "rend"  && STATE.rawData.length) renderRend();
  if (STATE.curTab === "metas" && STATE.metasData.length && STATE.rawData.length) renderMetas();
  if (STATE.curTab === "ops")                            renderOps();

  _inSwitchMode = false;
}

// ── TAB NAVIGATION ────────────────────────────────────────────────────────────
function switchTab(tab) {
// Pantalla completa en presentación
  document.body.classList.toggle("present-mode", tab === "present");
  // Guardar filtros actuales antes de cambiar
  STATE.savedFilters = {
    dateFrom:      document.getElementById("dateFrom")?.value,
    dateTo:        document.getElementById("dateTo")?.value,
    city:          document.getElementById("cityFilter")?.value,
    kam:           document.getElementById("kamFilter")?.value,
    partnerSearch: document.getElementById("partnerSearch")?.value,
    selected:      getSel()
  };

  STATE.curTab = tab;

  const ANALISIS_TABS = ["rend", "metas", "ops", "proyectos"];
  const navAnalisis = document.getElementById("navAnalisis");
  if (navAnalisis) navAnalisis.classList.toggle("active", ANALISIS_TABS.includes(tab));
  document.querySelectorAll(".nav-tab[data-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".nav-dd-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.add("active");

  // Restaurar filtros guardados
  if (STATE.savedFilters) {
    const f = STATE.savedFilters;
    if (f.dateFrom && document.getElementById("dateFrom"))
      document.getElementById("dateFrom").value = f.dateFrom;
    if (f.dateTo && document.getElementById("dateTo"))
      document.getElementById("dateTo").value = f.dateTo;
    if (f.city && document.getElementById("cityFilter"))
      document.getElementById("cityFilter").value = f.city;
    if (f.kam && document.getElementById("kamFilter"))
      document.getElementById("kamFilter").value = f.kam;
    if (f.partnerSearch && document.getElementById("partnerSearch"))
      document.getElementById("partnerSearch").value = f.partnerSearch;
    if (f.selected) {
      document.querySelectorAll("#pList input").forEach(c => {
        c.checked = f.selected.includes(c.value);
      });
    }
  }

  // Renderizar con datos ya en memoria, sin recargar Supabase
  if (tab === "rend"      && STATE.rawData.length)                           renderRend();
  if (tab === "metas"     && STATE.metasData.length && STATE.rawData.length) renderMetas();
  if (tab === "ops")                                                          renderOps();
  if (tab === "proyectos")                                                    renderProyectos();
  if (tab === "config")                                                       renderConfig();
  if (tab === "present")                                                      renderPresent();
}
// ── SIDEBAR: DATES ────────────────────────────────────────────────────────────
function popDates() {
  ["dateFrom", "dateTo"].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = "";
    STATE.allDates.forEach(d => {
      sel.innerHTML += `<option value="${d}">${d2s(d)}</option>`;
    });
  });
  if (STATE.allDates.length) {
    document.getElementById("dateFrom").value = STATE.allDates[0];
    document.getElementById("dateTo").value   = STATE.allDates[STATE.allDates.length - 1];
  }
}

// ── SIDEBAR: KAM ─────────────────────────────────────────────────────────────
function popKAM() {
  const sel = document.getElementById("kamFilter");
  sel.innerHTML = `<option value="all">Todos</option>`;
  [...new Set(Object.values(STATE.KAM_MAP))].sort().forEach(k => {
    sel.innerHTML += `<option value="${k}">${k}</option>`;
  });
}

// ── SIDEBAR: PARTNERS ────────────────────────────────────────────────────────
function popPartners(selected) {
  const list  = document.getElementById("pList");
  const selSet = new Set(selected);
  list.innerHTML = STATE.allPartners.map(p => {
    const chk = selSet.has(p) ? "checked" : "";
    const c   = STATE.partnerColors[p] || "#FF0000";
    const id  = "c_" + p.replace(/[^a-z0-9]/gi, "_");
    return `<div class="pi" data-p="${p}">
        <input type="checkbox" id="${id}" value="${p}" ${chk}/>
        <label for="${id}">
          <span class="pdot" style="background:${c}"></span>${p}
        </label>
      </div>`;
  }).join("");
}

function updateIndexes() {
  STATE.allDates    = [...new Set(STATE.rawData.map(r => r.date))].sort();
  STATE.allPartners = [...new Set(STATE.rawData.map(r => r.partner))].sort();
  STATE.allPartners.forEach(p => {
    if (!STATE.partnerColors[p]) STATE.partnerColors[p] = hashColor(p);
  });
  popDates();
  popKAM();
  popPartners(STATE.allPartners);
  restoreFilters();
}

function filterPList() {
  const q = document.getElementById("partnerSearch").value.toLowerCase();
  document.querySelectorAll("#pList .pi").forEach(el => {
    el.style.display = el.dataset.p.toLowerCase().includes(q) ? "flex" : "none";
  });
}

function selectAll()  { document.querySelectorAll("#pList input").forEach(c => c.checked = true); }
function deselectAll(){ document.querySelectorAll("#pList input").forEach(c => c.checked = false); }

function onKAMChange() {
  const k = document.getElementById("kamFilter").value;
  if (k === "all") { selectAll(); return; }
  const ps = STATE.KAM_PARTNERS[k] ? [...STATE.KAM_PARTNERS[k]] : [];
  document.querySelectorAll("#pList input").forEach(c => {
    c.checked = ps.includes(c.value);
  });
}

function getSel() {
  return [...document.querySelectorAll("#pList input:checked")].map(c => c.value);
}

function applyFilters() {
  saveFilters();
  if (STATE.curTab === "rend"  && STATE.rawData.length)                      renderRend();
  if (STATE.curTab === "metas" && STATE.metasData.length && STATE.rawData.length) renderMetas();
}

function updateDeclineSettings() {
  const metric = document.getElementById("declineMetricSel")?.value;
  const threshold = parseInt(document.getElementById("declineThresholdSel")?.value);
  if (metric)    STATE.declineMetric    = metric;
  if (threshold) STATE.declineThreshold = threshold;
  localStorage.setItem("yangoDecline", JSON.stringify({ metric: STATE.declineMetric, threshold: STATE.declineThreshold }));
  renderConfig(); // refresca el texto descriptivo
  if (STATE.rawData.length) renderRend(); // recalcula badges
}

// ── MODE TOGGLE HTML (compartido por Rendimiento y Metas) ─────────────────────
function modeToggleHTML() {
  const s = STATE.curMode === "semanal";
  return `
    <div class="tab-mode-bar">
      <button class="mode-btn${s ? " active" : ""}" data-mode="semanal" onclick="switchMode('semanal')">Semanal</button>
      <button class="mode-btn${!s ? " active" : ""}" data-mode="mensual" onclick="switchMode('mensual')">Mensual</button>
    </div>`;
}

// ── CONFIG TAB ────────────────────────────────────────────────────────────────
function renderConfig() {
  const content = document.getElementById("configContent");
  if (!Object.keys(STATE.CLID_MAP).length) {
    content.innerHTML = `
      <div class="empty">
        <p>Carga el archivo <strong>Partners</strong> para configurar CLIDs</p>
        <p class="empty-sub">Hoja DATOS con columnas: CLID | KAM | PARTNER</p>
      </div>`;
    return;
  }

  const kams = [...new Set(Object.values(STATE.KAM_MAP))].sort();
  const metricLabel = { activeDrivers: "Conductores Activos", supplyHours: "Horas de Conexión", nr: "Nuevos + Reactivados" };
  let html = secH("⚙️", "#10b981", "Configuración de Partners",
    "CLIDs, nombres y KAMs · editable directamente desde aquí", "");

  // ── Decline alert settings ──────────────────────────────────────────────
  html += `
    <div class="section" style="margin-bottom:16px">
      <div style="font-size:.8rem;font-weight:700;color:#555;margin-bottom:10px">🔔 Alerta de Declive Consecutivo</div>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div>
          <label style="font-size:.75rem;color:#aaa;display:block;margin-bottom:4px">Métrica</label>
          <select class="sb-sel" id="declineMetricSel" onchange="updateDeclineSettings()" style="width:auto;min-width:180px">
            <option value="activeDrivers"${STATE.declineMetric==="activeDrivers"?" selected":""}>Conductores Activos</option>
            <option value="supplyHours"${STATE.declineMetric==="supplyHours"?" selected":""}>Horas de Conexión</option>
            <option value="nr"${STATE.declineMetric==="nr"?" selected":""}>Nuevos + Reactivados</option>
          </select>
        </div>
        <div>
          <label style="font-size:.75rem;color:#aaa;display:block;margin-bottom:4px">Semanas consecutivas</label>
          <select class="sb-sel" id="declineThresholdSel" onchange="updateDeclineSettings()" style="width:auto">
            ${[2,3,4,5].map(n => `<option value="${n}"${STATE.declineThreshold===n?" selected":""}>${n} semanas</option>`).join("")}
          </select>
        </div>
        <div style="font-size:.75rem;color:#888;max-width:260px">
          Se mostrará el badge <span class="decline-badge" style="animation:none">⚠</span> en la tabla cuando un partner tenga
          <strong>${STATE.declineThreshold}</strong> períodos seguidos de baja en <strong>${metricLabel[STATE.declineMetric]}</strong>.
        </div>
      </div>
    </div>`;

  // Stats per KAM
  html += `<div class="section"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px">`;
  kams.forEach(kam => {
    const count = Object.values(STATE.KAM_MAP).filter(k => k === kam).length;
    const color = KAM_COLORS[kam] || "#888";
    html += `
      <div class="mcard" style="border-left:3px solid ${color}">
        <div class="mcard-label">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>
          ${kam}
        </div>
        <div class="mcard-val">${count}</div>
        <div style="font-size:.75rem;color:#aaa">CLIDs asignados</div>
      </div>`;
  });
  html += `</div>`;

  // CRUD table
  html += `
    <div style="margin-bottom:10px;font-size:.8rem;font-weight:700;color:#555">👥 Partners &amp; CLIDs</div>
    <div class="tbl-wrap">
      <table class="dtbl" id="crudTable">
        <thead>
          <tr>
            <th>CLID</th><th>Partner</th><th>KAM</th>
            <th style="text-align:center;width:130px">Acciones</th>
          </tr>
        </thead>
        <tbody>`;

  Object.entries(STATE.CLID_MAP)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([clid, partner]) => {
      const kam   = STATE.KAM_MAP[clid] || "";
      const color = KAM_COLORS[kam] || "#888";
      const pdot  = STATE.partnerColors[partner] || "#ccc";
      html += `
        <tr data-clid="${clid}">
          <td style="font-size:.75rem;color:#aaa;font-family:monospace">${clid}</td>
          <td>
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${pdot};margin-right:5px"></span>
            ${partner}
          </td>
          <td>
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:4px"></span>
            ${kam}
          </td>
          <td style="text-align:center">
            <button class="crud-btn crud-btn-edit" onclick="kamMakeEditable('${clid}')">Editar</button>
            <button class="crud-btn crud-btn-del"  onclick="kamCrudDelete('${clid}')">Eliminar</button>
          </td>
        </tr>`;
    });

  // Fila para agregar nuevo
  html += `
        <tr id="newClidRow" style="background:#f9fffe">
          <td><input class="crud-input" id="newClid"    placeholder="CLID"/></td>
          <td><input class="crud-input" id="newPartner" placeholder="Nombre del partner"/></td>
          <td><input class="crud-input" id="newKam"     placeholder="Nombre del KAM"/></td>
          <td style="text-align:center">
            <button class="crud-btn crud-btn-add" onclick="kamCrudAdd()">+ Agregar</button>
          </td>
        </tr>
      </tbody></table>
    </div></div>`;
  content.innerHTML = html;
}

// ── KAM CRUD FUNCTIONS ────────────────────────────────────────────────────────
function kamMakeEditable(clid) {
  const row = document.querySelector(`#crudTable tr[data-clid="${clid}"]`);
  if (!row) return;
  const partner = STATE.CLID_MAP[clid] || "";
  const kam     = STATE.KAM_MAP[clid]  || "";
  row.innerHTML = `
    <td style="font-size:.75rem;color:#aaa;font-family:monospace">${clid}</td>
    <td><input class="crud-input" id="edit_partner_${clid}" value="${partner}"/></td>
    <td><input class="crud-input" id="edit_kam_${clid}"     value="${kam}"/></td>
    <td style="text-align:center">
      <button class="crud-btn crud-btn-save"   onclick="kamCrudEdit('${clid}')">Guardar</button>
      <button class="crud-btn crud-btn-cancel" onclick="renderConfig()">Cancelar</button>
    </td>`;
}

async function kamCrudEdit(clid) {
  const partner = document.getElementById(`edit_partner_${clid}`)?.value.trim();
  const kam     = document.getElementById(`edit_kam_${clid}`)?.value.trim();
  if (!partner || !kam) { showBanner(false, "Completa nombre y KAM antes de guardar."); return; }
  showLoad(true, "Guardando...");
  const { error } = await sb.from("partners")
    .upsert([{ clid, partner, kam, activo: true }], { onConflict: "clid" });
  showLoad(false);
  if (error) { showBanner(false, "Error al guardar: " + error.message); return; }
  await loadFromSupabase();
}

async function kamCrudAdd() {
  const clid    = document.getElementById("newClid")?.value.trim();
  const partner = document.getElementById("newPartner")?.value.trim();
  const kam     = document.getElementById("newKam")?.value.trim();
  if (!clid || !partner || !kam) { showBanner(false, "Completa CLID, partner y KAM para agregar."); return; }
  showLoad(true, "Guardando...");
  const { error } = await sb.from("partners")
    .upsert([{ clid, partner, kam, activo: true }], { onConflict: "clid" });
  showLoad(false);
  if (error) { showBanner(false, "Error al agregar: " + error.message); return; }
  await loadFromSupabase();
}

async function kamCrudDelete(clid) {
  const partner = STATE.CLID_MAP[clid] || clid;
  if (!confirm(`¿Eliminar "${partner}" (CLID: ${clid})?\nEsta acción no se puede deshacer.`)) return;
  showLoad(true, "Eliminando...");
  const { error } = await sb.from("partners").delete().eq("clid", clid);
  showLoad(false);
  if (error) { showBanner(false, "Error al eliminar: " + error.message); return; }
  await loadFromSupabase();
}

// ── UI HELPERS ────────────────────────────────────────────────────────────────
function showBanner(ok, msg) {
  const el = document.getElementById("dsBanner");
  el.style.display = "flex";
  if (ok) {
    el.className = "ds-banner";
    el.innerHTML = `<span class="ds-dot"></span>
                    <span style="font-size:.75rem;color:#065f46;flex:1">${msg}</span>`;
  } else {
    el.className = "ds-banner err";
    el.innerHTML = `<span class="ds-dot err"></span>
                    <span style="font-size:.75rem;color:#FF0000;flex:1">${msg}</span>`;
  }
}

function showLoad(show, msg = "Procesando...") {
  let el = document.getElementById("loadingEl");
  if (show) {
    if (!el) {
      el = document.createElement("div");
      el.id        = "loadingEl";
      el.className = "overlay";
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="spinner"></div>
      <div style="font-weight:600;color:#555">${msg}</div>`;
  } else {
    el?.remove();
  }
}
