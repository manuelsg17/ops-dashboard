// app.js — Inicialización principal, sidebar, tabs y helpers de UI

// ── CONFIG PAGINATION STATE ───────────────────────────────────────────────────
const CONFIG_STATE = { page: 0, search: "", kamFilter: "all", PAGE_SIZE: 20 };

// ── LOCALSTORAGE HELPER ───────────────────────────────────────────────────────
function lsSet(key, val) {
  try { localStorage.setItem(key, val); } catch (e) { /* QuotaExceededError o privado */ }
}
function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// ── DEBOUNCE ──────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── APP INIT ──────────────────────────────────────────────────────────────────
function initApp() {
  // Restaurar configuración de alerta de declive
  try {
    const d = JSON.parse(lsGet("yangoDecline") || "{}");
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
  ["fileRend", "fileRendMensual", "fileRendDiario", "fileMetas", "fileData"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      const m = document.getElementById("uploadMenu");
      if (m) m.classList.remove("open");
    });
  });

  // Debounce del botón Aplicar Filtros: evita renders en ráfaga
  const applyBtn = document.querySelector(".apply-btn");
  if (applyBtn) applyBtn.onclick = debounce(applyFilters, 150);

  // Debounce en cambios directos a filtros (sin pasar por el botón)
  const _debouncedApply = debounce(applyFilters, 250);
  ["dateFrom", "dateTo", "cityFilter", "kamFilter"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", _debouncedApply);
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
  lsSet("yangoSidebarCollapsed", collapsed ? "1" : "0");
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
  lsSet("yangoFilters", JSON.stringify(f));
}

function restoreFilters() {
  const raw = lsGet("yangoFilters");
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
  if (lsGet("yangoSidebarCollapsed") === "1") {
    const sb  = document.getElementById("mainSidebar");
    const btn = document.getElementById("sidebarToggle");
    if (sb)  sb.classList.add("collapsed");
    if (btn) btn.innerHTML = _SVG_EXPAND;
  }
}

// ── MODE SWITCH (Semanal / Mensual) ───────────────────────────────────────────
let _inSwitchMode = false; // guard: evita que restoreFilters() revierta el cambio de modo
async function switchMode(mode) {
  if (_inSwitchMode) return;
  _inSwitchMode = true;

  STATE.curMode = mode;

  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  // Lazy load según escala; _semanalData es la referencia fija al dataset semanal filtrado
  if (mode === "mensual") {
    await loadMensualIfNeeded();
    STATE.rawData = STATE.rawDataMensual;
  } else if (mode === "diario") {
    await loadDiarioIfNeeded();
    STATE.rawData = STATE.rawDataDiario;
  } else {
    if (STATE._semanalData) STATE.rawData = STATE._semanalData;
  }

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

  const ANALISIS_TABS = ["rend", "metas", "ops", "proyectos", "unifview", "rawdata"];
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
  if (tab === "unifview")                                                     renderUnifView();
  if (tab === "rawdata")                                                      renderRawData();
  if (tab === "config")                                                       renderConfig();
  if (tab === "present")                                                      renderPresent();
}
// ── SIDEBAR: DATES ────────────────────────────────────────────────────────────
function popDates() {
  const opts = STATE.allDates.map(d => `<option value="${d}">${d2s(d)}</option>`).join("");
  ["dateFrom", "dateTo"].forEach(id => {
    document.getElementById(id).innerHTML = opts;
  });
  if (STATE.allDates.length) {
    document.getElementById("dateFrom").value = STATE.allDates[0];
    document.getElementById("dateTo").value   = STATE.allDates[STATE.allDates.length - 1];
  }
}

// ── DATE PRESETS ──────────────────────────────────────────────────────────────
function setDatePreset(type) {
  const dates = STATE.allDates;
  if (!dates || !dates.length) return;
  const today = new Date();
  let from, to;

  if (type === 'week') {
    // Last Monday up to most recent date in data
    const day = today.getDay(); // 0=Sun, 1=Mon...
    const diff = (day + 6) % 7; // days since last Monday
    const monday = new Date(today);
    monday.setDate(today.getDate() - diff);
    const mondayStr = monday.toISOString().slice(0, 10);
    from = dates.find(d => d >= mondayStr) || dates[dates.length - 1];
    to   = dates[dates.length - 1];
  } else if (type === 'fortnight') {
    const dayOfMonth = today.getDate();
    if (dayOfMonth <= 15) {
      // First fortnight: 1st to 15th
      const m = today.toISOString().slice(0, 7);
      from = dates.find(d => d >= `${m}-01`) || dates[0];
      to   = dates.filter(d => d <= `${m}-15`).at(-1) || dates[0];
    } else {
      // Second fortnight: 16th to end of month
      const m = today.toISOString().slice(0, 7);
      from = dates.find(d => d >= `${m}-16`) || dates[0];
      to   = dates[dates.length - 1];
    }
  } else if (type === 'month') {
    const m = today.toISOString().slice(0, 7);
    from = dates.find(d => d >= `${m}-01`) || dates[0];
    to   = dates[dates.length - 1];

  // ── Presets para escala diaria ───────────────────────────────────────────
  } else if (type === 'today') {
    from = to = dates[dates.length - 1]; // día más reciente disponible
  } else if (type === '7d' || type === '14d' || type === '30d' || type === '90d') {
    const nDays = { '7d': 6, '14d': 13, '30d': 29, '90d': 89 }[type];
    const cutoff = new Date(dates[dates.length - 1]);
    cutoff.setDate(cutoff.getDate() - nDays);
    from = dates.find(d => d >= cutoff.toISOString().slice(0, 10)) || dates[0];
    to   = dates[dates.length - 1];

  // ── Presets para escala mensual ──────────────────────────────────────────
  } else if (type === '3m' || type === '6m') {
    const nMonths = type === '3m' ? 3 : 6;
    const cutoff  = new Date(dates[dates.length - 1].slice(0, 7) + "-01");
    cutoff.setMonth(cutoff.getMonth() - nMonths + 1);
    const cutoffStr = cutoff.toISOString().slice(0, 7);
    from = dates.find(d => d >= cutoffStr) || dates[0];
    to   = dates[dates.length - 1];
  }

  if (!from || !to) return;
  const elFrom = document.getElementById("dateFrom");
  const elTo   = document.getElementById("dateTo");
  if (elFrom) elFrom.value = from;
  if (elTo)   elTo.value   = to;
  applyFilters();
}

// ── PRESETS DINÁMICOS POR ESCALA ─────────────────────────────────────────────
function getPresetButtonsHTML() {
  const defs = {
    diario:  [["today","Hoy"],["7d","7 días"],["14d","14 días"],["30d","30 días"],["90d","90 días"]],
    semanal: [["week","Esta semana"],["fortnight","Quincena"],["month","Este mes"]],
    mensual: [["month","Este mes"],["3m","Últ. 3 meses"],["6m","Últ. 6 meses"]]
  };
  return (defs[STATE.curMode] || defs.semanal)
    .map(([k, l]) => `<button class="preset-btn" onclick="setDatePreset('${k}')">${l}</button>`)
    .join("");
}

function rerenderSidebarPresets() {
  const el = document.getElementById("datePresets");
  if (el) el.innerHTML = getPresetButtonsHTML();
}

// ── SIDEBAR: KAM ─────────────────────────────────────────────────────────────
function popKAM() {
  const kams = [...new Set(Object.values(STATE.KAM_MAP))].sort();
  document.getElementById("kamFilter").innerHTML =
    `<option value="all">Todos</option>` +
    kams.map(k => `<option value="${k}">${k}</option>`).join("");
}

// ── SIDEBAR: PARTNERS ────────────────────────────────────────────────────────
const VIRT_THRESHOLD = 100; // partners antes de activar virtualización
const VIRT_ITEM_H   = 28;   // px por ítem (debe coincidir con CSS .pi height)
const VIRT_VISIBLE  = 12;   // ítems visibles en la ventana

function popPartners(selected) {
  const list   = document.getElementById("pList");
  const selSet = new Set(selected);

  if (STATE.allPartners.length <= VIRT_THRESHOLD) {
    // Render completo para listas pequeñas
    list.style.height = "";
    list.style.overflowY = "";
    list.innerHTML = STATE.allPartners.map(p => _pItem(p, selSet)).join("");
    return;
  }

  // Virtualización ligera: altura fija + renderizado de ventana
  list.style.height    = (VIRT_VISIBLE * VIRT_ITEM_H) + "px";
  list.style.overflowY = "auto";

  const renderWindow = () => {
    const scrollTop  = list.scrollTop;
    const start      = Math.max(0, Math.floor(scrollTop / VIRT_ITEM_H) - 2);
    const end        = Math.min(STATE.allPartners.length, start + VIRT_VISIBLE + 4);
    const topPad     = start * VIRT_ITEM_H;
    const botPad     = (STATE.allPartners.length - end) * VIRT_ITEM_H;
    const items      = STATE.allPartners.slice(start, end)
                         .map(p => _pItem(p, selSet)).join("");
    list.innerHTML =
      `<div style="height:${topPad}px"></div>` +
      items +
      `<div style="height:${botPad}px"></div>`;
  };

  list.onscroll = renderWindow;
  renderWindow();
}

function _pItem(p, selSet) {
  const chk = selSet.has(p) ? "checked" : "";
  const c   = STATE.partnerColors[p] || "#FF0000";
  const id  = "c_" + p.replace(/[^a-z0-9]/gi, "_");
  return `<div class="pi" data-p="${p}" style="height:${VIRT_ITEM_H}px">
      <input type="checkbox" id="${id}" value="${p}" ${chk}/>
      <label for="${id}">
        <span class="pdot" style="background:${c}"></span>${p}
      </label>
    </div>`;
}

function updateIndexes() {
  STATE.allDates    = [...new Set(STATE.rawData.map(r => r.date))].sort();
  STATE.allPartners = [...new Set(STATE.rawData.map(r => r.partner))].sort();
  STATE._apdFull = null;
  STATE.allPartners.forEach(p => {
    if (!STATE.partnerColors[p]) STATE.partnerColors[p] = hashColor(p);
  });
  popDates();
  rerenderSidebarPresets();
  popKAM();
  popPartners(STATE.allPartners);
  restoreFilters();
}

function filterPList() {
  const q = document.getElementById("partnerSearch").value.toLowerCase();
  if (STATE.allPartners.length > VIRT_THRESHOLD) {
    // En modo virtual, reconstruir con la lista filtrada
    const filtered = STATE.allPartners.filter(p => p.toLowerCase().includes(q));
    const list     = document.getElementById("pList");
    const selSet   = new Set(getSel());
    list.style.height    = Math.min(filtered.length, VIRT_VISIBLE) * VIRT_ITEM_H + "px";
    list.style.overflowY = filtered.length > VIRT_VISIBLE ? "auto" : "";
    list.onscroll        = null;
    list.innerHTML       = filtered.map(p => _pItem(p, selSet)).join("");
    return;
  }
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
  // Corregir rango invertido automáticamente
  const elFrom = document.getElementById("dateFrom");
  const elTo   = document.getElementById("dateTo");
  if (elFrom && elTo && elFrom.value > elTo.value) {
    [elFrom.value, elTo.value] = [elTo.value, elFrom.value];
  }
  saveFilters();
  if (STATE.curTab === "rend"     && STATE.rawData.length)                           renderRend();
  if (STATE.curTab === "metas"    && STATE.metasData.length && STATE.rawData.length) renderMetas();
  if (STATE.curTab === "unifview" && STATE.rawData.length)                           renderUnifView();
}

function updateDeclineSettings() {
  const metric = document.getElementById("declineMetricSel")?.value;
  const threshold = parseInt(document.getElementById("declineThresholdSel")?.value);
  if (metric)    STATE.declineMetric    = metric;
  if (threshold) STATE.declineThreshold = threshold;
  lsSet("yangoDecline", JSON.stringify({ metric: STATE.declineMetric, threshold: STATE.declineThreshold }));
  renderConfig(); // refresca el texto descriptivo
  if (STATE.rawData.length) renderRend(); // recalcula badges
}

// ── MODE TOGGLE HTML (compartido por Rendimiento y Metas) ─────────────────────
function modeToggleHTML() {
  return ""; // El selector de escala vive en el sidebar — ver .mode-toggle-row
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

  // ── Sección: Filtros de Flota (palabras prohibidas) ──────────────────────────
  const excludedCount = STATE.rawDataFull.length - STATE.rawData.length;
  const bannedBadges  = STATE.bannedWords.map(w =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:#fff0f0;border:1px solid #fecaca;border-radius:20px;padding:3px 10px;font-size:.73rem;font-weight:600;color:#991b1b">
      ${w}
      <button onclick="removeBannedWord('${w.replace(/'/g, "\\'")}')"
        style="background:none;border:none;cursor:pointer;color:#FF0000;font-size:.85rem;line-height:1;padding:0 2px;margin-left:2px" title="Eliminar">✕</button>
    </span>`
  ).join("");

  html += `
    <div class="section" style="margin-bottom:16px">
      <div style="font-size:.8rem;font-weight:700;color:#555;margin-bottom:10px">🚫 Filtros de Flota — Palabras Prohibidas</div>
      <div style="font-size:.75rem;color:#888;margin-bottom:10px">
        Los partners cuyo nombre contenga alguna de estas palabras (sin importar mayúsculas) quedan excluidos del dashboard.
        Actualmente excluidos: <strong style="color:#FF0000">${excludedCount}</strong> registro(s) en el período cargado.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
        ${bannedBadges || `<span style="font-size:.75rem;color:#aaa">Sin palabras prohibidas configuradas.</span>`}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="crud-input" id="newBannedWord" placeholder="Nueva palabra (ej: mototaxi)"
          style="flex:1;min-width:180px;max-width:280px"
          onkeydown="if(event.key==='Enter') addBannedWord()"/>
        <button class="crud-btn crud-btn-add" onclick="addBannedWord()">+ Agregar</button>
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

  // CRUD table with filter + pagination
  const cfgSearch = CONFIG_STATE.search.toLowerCase();
  const cfgKamF   = CONFIG_STATE.kamFilter;
  let allRows = Object.entries(STATE.CLID_MAP)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .filter(([clid, partner]) => {
      const kam = STATE.KAM_MAP[clid] || "";
      if (cfgKamF !== "all" && kam !== cfgKamF) return false;
      if (cfgSearch && !clid.toLowerCase().includes(cfgSearch) && !partner.toLowerCase().includes(cfgSearch) && !kam.toLowerCase().includes(cfgSearch)) return false;
      return true;
    });
  const totalPages = Math.max(1, Math.ceil(allRows.length / CONFIG_STATE.PAGE_SIZE));
  if (CONFIG_STATE.page >= totalPages) CONFIG_STATE.page = 0;
  const pageRows  = allRows.slice(CONFIG_STATE.page * CONFIG_STATE.PAGE_SIZE, (CONFIG_STATE.page + 1) * CONFIG_STATE.PAGE_SIZE);
  const kamFilterOpts = kams.map(k => `<option value="${k}"${cfgKamF===k?" selected":""}>${k}</option>`).join("");

  html += `
    <div style="margin-bottom:10px;font-size:.8rem;font-weight:700;color:#555">👥 Partners &amp; CLIDs</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <input class="crud-input" id="configSearch" placeholder="Buscar CLID, partner o KAM..." value="${CONFIG_STATE.search.replace(/"/g,'&quot;')}"
        oninput="CONFIG_STATE.search=this.value;CONFIG_STATE.page=0;renderConfig()" style="flex:1;min-width:160px;max-width:300px"/>
      <select class="crud-input" id="configKamFilter" onchange="CONFIG_STATE.kamFilter=this.value;CONFIG_STATE.page=0;renderConfig()" style="width:auto">
        <option value="all"${cfgKamF==="all"?" selected":""}>Todos los KAMs</option>
        ${kamFilterOpts}
      </select>
      <span style="font-size:.75rem;color:#aaa">${allRows.length} resultado${allRows.length!==1?"s":""}</span>
    </div>
    <div class="tbl-wrap">
      <table class="dtbl" id="crudTable">
        <thead>
          <tr>
            <th>CLID</th><th>Partner</th><th>KAM</th>
            <th style="text-align:center;width:130px">Acciones</th>
          </tr>
        </thead>
        <tbody>`;

  pageRows.forEach(([clid, partner]) => {
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
  const kamOpts = kams.map(k => `<option value="${k}">${k}</option>`).join("");
  html += `
        <tr id="newClidRow" style="background:#f9fffe">
          <td><input class="crud-input" id="newClid"    placeholder="CLID"/></td>
          <td><input class="crud-input" id="newPartner" placeholder="Nombre del partner"/></td>
          <td>
            <select class="crud-input" id="newKam" onchange="kamNewKamChange()" style="width:100%">
              ${kamOpts}
              <option value="__new__">+ Añadir nuevo KAM...</option>
            </select>
            <input class="crud-input" id="newKamCustom" placeholder="Nuevo nombre de KAM" style="display:none;margin-top:4px"/>
          </td>
          <td style="text-align:center">
            <button class="crud-btn crud-btn-add" onclick="kamCrudAdd()">+ Agregar</button>
          </td>
        </tr>
      </tbody></table>
    </div>
    ${totalPages > 1 ? `
    <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:.78rem;color:#555">
      <button class="crud-btn" onclick="CONFIG_STATE.page=Math.max(0,CONFIG_STATE.page-1);renderConfig()"
        ${CONFIG_STATE.page===0?"disabled":""} style="padding:4px 10px">← Anterior</button>
      <span>Página <strong>${CONFIG_STATE.page+1}</strong> de <strong>${totalPages}</strong></span>
      <button class="crud-btn" onclick="CONFIG_STATE.page=Math.min(${totalPages-1},CONFIG_STATE.page+1);renderConfig()"
        ${CONFIG_STATE.page===totalPages-1?"disabled":""} style="padding:4px 10px">Siguiente →</button>
    </div>` : ""}
    </div>`;
  content.innerHTML = html;
}

// ── KAM CRUD FUNCTIONS ────────────────────────────────────────────────────────
function kamMakeEditable(clid) {
  const row = document.querySelector(`#crudTable tr[data-clid="${clid}"]`);
  if (!row) return;
  const partner = STATE.CLID_MAP[clid] || "";
  const kam     = STATE.KAM_MAP[clid]  || "";
  const kams    = [...new Set(Object.values(STATE.KAM_MAP))].sort();
  // Include current KAM even if not in list (safety)
  if (kam && !kams.includes(kam)) kams.push(kam);
  const editKamOpts = kams.map(k => `<option value="${k}"${k===kam?" selected":""}>${k}</option>`).join("");
  row.innerHTML = `
    <td style="font-size:.75rem;color:#aaa;font-family:monospace">${clid}</td>
    <td><input class="crud-input" id="edit_partner_${clid}" value="${partner}"/></td>
    <td>
      <select class="crud-input" id="edit_kam_${clid}" onchange="kamEditKamChange('${clid}')" style="width:100%">
        ${editKamOpts}
        <option value="__new__">+ Añadir nuevo KAM...</option>
      </select>
      <input class="crud-input" id="edit_kam_custom_${clid}" placeholder="Nuevo nombre de KAM" style="display:none;margin-top:4px"/>
    </td>
    <td style="text-align:center">
      <button class="crud-btn crud-btn-save"   onclick="kamCrudEdit('${clid}')">Guardar</button>
      <button class="crud-btn crud-btn-cancel" onclick="renderConfig()">Cancelar</button>
    </td>`;
}

function kamNewKamChange() {
  const sel    = document.getElementById("newKam");
  const custom = document.getElementById("newKamCustom");
  if (custom) custom.style.display = sel.value === "__new__" ? "block" : "none";
}

function kamEditKamChange(clid) {
  const sel    = document.getElementById(`edit_kam_${clid}`);
  const custom = document.getElementById(`edit_kam_custom_${clid}`);
  if (custom) custom.style.display = sel.value === "__new__" ? "block" : "none";
}

async function kamCrudEdit(clid) {
  const partner  = document.getElementById(`edit_partner_${clid}`)?.value.trim();
  const kamSel   = document.getElementById(`edit_kam_${clid}`);
  const kamRaw   = kamSel?.value;
  const kam      = kamRaw === "__new__"
    ? (document.getElementById(`edit_kam_custom_${clid}`)?.value.trim() || "")
    : (kamRaw || "").trim();
  if (!partner || !kam) { showBanner(false, "Completa nombre y KAM antes de guardar."); return; }
  showLoad(true, "Guardando...");
  const { error } = await sb.from("partners")
    .upsert([{ clid, partner, kam, activo: true }], { onConflict: "clid" });
  showLoad(false);
  if (error) { showBanner(false, "Error al guardar: " + error.message); return; }
  await loadFromSupabase();
  renderConfig();
  showBanner(true, "Guardado correctamente ✓");
}

async function kamCrudAdd() {
  const clid    = document.getElementById("newClid")?.value.trim();
  const partner = document.getElementById("newPartner")?.value.trim();
  const kamSel  = document.getElementById("newKam");
  const kamRaw  = kamSel?.value;
  const kam     = kamRaw === "__new__"
    ? (document.getElementById("newKamCustom")?.value.trim() || "")
    : (kamRaw || "").trim();
  if (!clid || !partner || !kam) { showBanner(false, "Completa CLID, partner y KAM para agregar."); return; }
  if (STATE.CLID_MAP[clid]) {
    const existing = `${STATE.CLID_MAP[clid]} (KAM: ${STATE.KAM_MAP[clid]})`;
    if (!confirm(`El CLID "${clid}" ya existe: ${existing}.\n¿Deseas actualizarlo con los nuevos datos?`)) return;
  }
  showLoad(true, "Guardando...");
  const { error } = await sb.from("partners")
    .upsert([{ clid, partner, kam, activo: true }], { onConflict: "clid" });
  showLoad(false);
  if (error) { showBanner(false, "Error al agregar: " + error.message); return; }
  await loadFromSupabase();
  renderConfig();
  showBanner(true, "CLID agregado correctamente ✓");
}

async function kamCrudDelete(clid) {
  const partner = STATE.CLID_MAP[clid] || clid;
  if (!confirm(`¿Eliminar "${partner}" (CLID: ${clid})?\nEsta acción no se puede deshacer.`)) return;
  showLoad(true, "Eliminando...");
  const { error } = await sb.from("partners").delete().eq("clid", clid);
  showLoad(false);
  if (error) { showBanner(false, "Error al eliminar: " + error.message); return; }
  await loadFromSupabase();
  renderConfig();
  showBanner(true, `"${partner}" eliminado correctamente ✓`);
}

// ── BANNED WORDS MANAGEMENT ───────────────────────────────────────────────────
async function addBannedWord() {
  const input = document.getElementById("newBannedWord");
  const word  = (input?.value || "").trim().toLowerCase();
  if (!word) return;
  if (STATE.bannedWords.includes(word)) {
    showBanner(false, `"${word}" ya está en la lista.`);
    return;
  }
  STATE.bannedWords.push(word);
  lsSet("yangoBannedWords", JSON.stringify(STATE.bannedWords));
  showLoad(true, "Aplicando filtro...");
  await loadFromSupabase();
  showLoad(false);
  renderConfig();
  showBanner(true, `"${word}" agregado a la lista de exclusión ✓`);
}

async function removeBannedWord(word) {
  STATE.bannedWords = STATE.bannedWords.filter(w => w !== word);
  lsSet("yangoBannedWords", JSON.stringify(STATE.bannedWords));
  showLoad(true, "Aplicando filtro...");
  await loadFromSupabase();
  showLoad(false);
  renderConfig();
  showBanner(true, `"${word}" eliminado de la lista de exclusión ✓`);
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
