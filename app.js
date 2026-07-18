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
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => { clearTimeout(t); t = null; };
  return wrapped;
}

// Timers a nivel modulo para que switchTab pueda cancelarlos al salir del tab
let _pSearchTimer = null;
let _sidebarResizeTimer = null;
// Debounce de applyFilters expuesto a nivel modulo (se inicializa en initApp).
// setDatePreset() lo cancela antes de llamar applyFilters() directo para no
// solapar dos renders.
let _debouncedApply       = null;
function _debouncedApplyCancel() { if (_debouncedApply && _debouncedApply.cancel) _debouncedApply.cancel(); }

// ── APP INIT ──────────────────────────────────────────────────────────────────
function initApp() {
  // Restaurar configuración de alerta de declive
  try {
    const d = JSON.parse(lsGet("yangoDecline") || "{}");
    if (d.metric)    STATE.declineMetric    = d.metric;
    if (d.threshold) STATE.declineThreshold = d.threshold;
  } catch(e) {}

  initFileHandlers();

  // Debounce en búsqueda de partners (timer a nivel modulo para cancelar al cambiar tab)
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
  ["fileRend", "fileRendMensual", "fileRendDiario", "fileMetas", "fileData", "fileFlotas", "fileConversion"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const m = document.getElementById("uploadMenu");
      if (m) m.classList.remove("open");
    });
  });

  // Filtros reactivos: cualquier cambio dispara applyFilters() debounced.
  // No hay boton "Aplicar Filtros" — se elimino porque era redundante.
  // kamFilter NO se incluye: ya tiene su propio handler inline onchange="onKAMChange()"
  // que es mas completo (actualiza checkboxes ademas de renderizar). Agregarlo aqui
  // causa DOBLE render: onKAMChange sincrono + applyFilters debounced 250ms despues.
  _debouncedApply = debounce(applyFilters, 250);
  ["dateFrom", "dateTo", "cityFilter"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", _debouncedApply);
  });

  // Cambios en checkboxes de partners (#pList) tambien deben disparar render.
  // Listener delegado: funciona aunque la lista se re-renderice (virtualizacion).
  const pList = document.getElementById("pList");
  if (pList) {
    pList.addEventListener("change", e => {
      if (e.target.matches('input[type="checkbox"]')) _debouncedApply();
    });
  }

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
  // Reajustar gráficas ApexCharts al cambiar ancho (timer cancelable desde switchTab)
  clearTimeout(_sidebarResizeTimer);
  _sidebarResizeTimer = setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
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

  // Mostrar feedback inmediato y ceder al browser para que pinte el toggle
  // ANTES de empezar el trabajo pesado (destroy charts, updateIndexes, render)
  showLoad(true, `Cambiando a ${mode}...`);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Destruir charts antiguos antes de reasignar rawData (evita huérfanos)
  if (typeof destroyAllCharts === "function") destroyAllCharts();

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

  // CRITICO: updateIndexes() es la de data.js — reconstruye _byDate, _byPartner,
  // _byCity, _byCityDate, _partnerKAM sobre el NUEVO rawData. Sin esto, los
  // indices apuntarian a rows del dataset anterior (causa de freeze al filtrar).
  updateIndexes();
  if (typeof clearAggCache === "function") clearAggCache(); // purgar cache _C
  // restoreFilters dentro de popSidebarUI puede disparar onKAMChange → render.
  // Marcamos para evitar el doble render al final de switchMode.
  STATE._suppressRestoreRender = true;
  popSidebarUI();
  STATE._suppressRestoreRender = false;

  // Otro yield antes del render pesado para que el browser pinte el spinner
  await new Promise(r => requestAnimationFrame(r));

  // Render unico del tab activo (restoreFilters no rendero por _suppressRestoreRender)
  if (STATE.curTab === "rend"        && STATE.rawData.length) renderRend();
  if (STATE.curTab === "metas"       && STATE.metasData.length && STATE.rawData.length) renderMetas();
  if (STATE.curTab === "ops")                                  renderOps();
  if (STATE.curTab === "insights"    && STATE.rawData.length) renderInsights();
  if (STATE.curTab === "unifview"    && STATE.rawData.length) renderUnifView();
  if (STATE.curTab === "partnerview" && STATE.rawData.length) renderPartnerView();
  if (STATE.curTab === "calculator"  && STATE.rawData.length) renderCalculator();

  showLoad(false);
  _inSwitchMode = false;
}

// ── TAB NAVIGATION ────────────────────────────────────────────────────────────
function switchTab(tab) {
  const prevTab = STATE.curTab;

  // Guard reentrancia: doble-click rapido o nav simultaneo no debe lanzar
  // dos secuencias destroy+render concurrentes.
  if (STATE._switchingTab) return;
  // Si clickearon el mismo tab, ignorar (sin cleanup ni re-render redundante)
  if (prevTab === tab) return;
  STATE._switchingTab = true;

  try {
    // ── 1. Marcar nuevo tab + incrementar token ANTES del blur ──────────────
    // Asi, cualquier onchange/oninput que dispare el blur vera el nuevo curTab.
    // El handler guarda su estado (CALC_STATE.edits/kamGoals/etc) pero los
    // guards de renderCalculator y _calcScheduleRerender abortan, evitando
    // render sincrono pesado durante la transicion.
    STATE.curTab = tab;
    STATE._tabRenderId++;

    // ── 2. BLUR sincronico del input editado ────────────────────────────────
    // Fuerza el `onchange`/`oninput` final del input que tenia foco para que
    // el handler corra y persista su edicion en CALC_STATE antes del cleanup.
    const ae = document.activeElement;
    if (ae && ae !== document.body && typeof ae.blur === "function") {
      try { ae.blur(); } catch(e) {}
    }

    // ── 3. CLEANUP del tab anterior ─────────────────────────────────────────
    if (prevTab && prevTab !== tab) {
      if (prevTab === "calculator"  && typeof calcCancelPendingRender === "function") calcCancelPendingRender();
      if (prevTab === "partnerview" && typeof _pvDestroyCharts === "function")        _pvDestroyCharts();
      if (prevTab === "present"     && typeof destroyPresentCharts === "function")    destroyPresentCharts();
      if (prevTab === "present2"    && typeof destroyPresent2Charts === "function")   destroyPresent2Charts();
      const apexConsumers = new Set(["rend","metas","ops","insights","unifview"]);
      if (apexConsumers.has(prevTab) && !apexConsumers.has(tab) && typeof destroyAllCharts === "function") {
        destroyAllCharts();
      }
      // Cancelar timers de sidebar para que no disparen trabajo cross-tab
      clearTimeout(_pSearchTimer);    _pSearchTimer    = null;
      clearTimeout(_sidebarResizeTimer); _sidebarResizeTimer = null;
    }

    // Pantalla completa en presentación
    document.body.classList.toggle("present-mode", tab === "present" || tab === "present2");
    // Ocultar el sidebar de filtros en tabs donde no aplica (Fase 7): la data de
    // Configuración/Calculadora/Data Raw no depende de Escala/Fechas/Ciudad/KAM.
    const NO_SIDEBAR_TABS = new Set(["config", "calculator", "rawdata", "seguimiento"]);
    document.body.classList.toggle("no-sidebar", NO_SIDEBAR_TABS.has(tab));
    // Guardar filtros actuales antes de cambiar
    STATE.savedFilters = {
      dateFrom:      document.getElementById("dateFrom")?.value,
      dateTo:        document.getElementById("dateTo")?.value,
      city:          document.getElementById("cityFilter")?.value,
      kam:           document.getElementById("kamFilter")?.value,
      partnerSearch: document.getElementById("partnerSearch")?.value,
      selected:      getSel()
    };

    // Tabs bajo el dropdown "Análisis" (Fase 7: sincronizado con el nav visible —
    // incluye partnerview/calculator, excluye ops/proyectos ocultos).
    const ANALISIS_TABS = ["rend", "partnerview", "calculator", "metas", "unifview", "seguimiento", "rawdata"];
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

    // ── DISPATCH RENDER con DOBLE RAF ───────────────────────────────────────
    // El browser pinta primero la activacion visual del tab (clase .active,
    // chips, etc) y SOLO DESPUES corre el render pesado. Resultado: el cambio
    // de tab se siente instantaneo aunque el render demore 500ms.
    const tokenAtDispatch = STATE._tabRenderId;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // Si en los 2 frames intermedios el usuario ya cambio otra vez, abortar.
      if (STATE._tabRenderId !== tokenAtDispatch) return;
      if (STATE.curTab !== tab) return;

      if (tab === "rend"        && STATE.rawData.length)                           renderRend();
      if (tab === "metas"       && STATE.metasData.length && STATE.rawData.length) renderMetas();
      if (tab === "ops")                                                            renderOps();
      if (tab === "proyectos")                                                      renderProyectos();
      if (tab === "unifview")                                                       renderUnifView();
      if (tab === "rawdata")                                                        renderRawData();
      if (tab === "seguimiento")                                                    renderSeguimiento();
      if (tab === "config")                                                         renderConfig();
      if (tab === "present")                                                        renderPresent();
      if (tab === "present2"    && STATE.rawData.length)                            renderPresent2();
      if (tab === "insights"    && STATE.rawData.length)                            renderInsights();
      if (tab === "partnerview" && STATE.rawData.length)                            renderPartnerView();
      if (tab === "calculator"  && STATE.rawData.length)                            renderCalculator();
    }));
  } finally {
    STATE._switchingTab = false;
  }
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

// Suma N días a un string "YYYY-MM-DD" con aritmética 100% LOCAL (constructor y
// getters multi-argumento de Date, nunca toISOString()/parseo de string, que son
// UTC — Peru es UTC-5 fijo y de noche ya corre el día, desalineando el cálculo).
function _addDaysToDateStr(str, n) {
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// ── DATE PRESETS ──────────────────────────────────────────────────────────────
function setDatePreset(type) {
  const dates = STATE.allDates;
  if (!dates || !dates.length) return;
  // Todo ancla al ÚLTIMO DATO disponible (lastD), NUNCA al reloj real (new Date()):
  // si la data cargada va rezagada respecto a hoy (normal en un dashboard de carga
  // manual), "Esta semana"/"Quincena"/7-90 días deben caer en el último período CON
  // DATOS — igual que ya hacía "Este mes" — en vez de colapsar a un día (semana) o
  // expandirse silenciosamente a todo el histórico (quincena, fallback a dates[0]).
  const lastD = dates[dates.length - 1];
  let from, to;

  if (type === 'week') {
    // Lunes de la semana de lastD, hasta lastD.
    const [ly, lm, ld] = lastD.split("-").map(Number);
    const dow  = new Date(ly, lm - 1, ld).getDay(); // 0=Dom, 1=Lun...
    const diff = (dow + 6) % 7;                      // días desde el lunes
    const mondayStr = _addDaysToDateStr(lastD, -diff);
    from = dates.find(d => d >= mondayStr) || lastD;
    to   = lastD;
  } else if (type === 'fortnight') {
    const [ly, lm, ld] = lastD.split("-").map(Number);
    const m = `${ly}-${String(lm).padStart(2, "0")}`;
    if (ld <= 15) {
      // Primera quincena: 1-15 del mes de lastD
      from = dates.find(d => d >= `${m}-01`) || dates[0];
      to   = dates.filter(d => d <= `${m}-15`).at(-1) || dates[0];
    } else {
      // Segunda quincena: 16-fin del mes de lastD
      from = dates.find(d => d >= `${m}-16`) || dates[0];
      to   = lastD;
    }
  } else if (type === 'month') {
    // "Este mes" = el ÚLTIMO MES CON DATOS (no el mes calendario de hoy). Si la data
    // llega a junio y hoy es julio, selecciona junio COMPLETO (1ra → última semana),
    // no solo la última semana.
    const m = lastD.slice(0, 7);
    // Mensual: dates son "YYYY-MM"; semanal/diario: "YYYY-MM-DD". "2026-06" >= "2026-06-01"
    // es FALSE (string), por eso en mensual se compara contra m directo.
    const monthKey = STATE.curMode === "mensual" ? m : `${m}-01`;
    from = dates.find(d => d >= monthKey) || dates[0];
    to   = lastD;

  // ── Presets para escala diaria ───────────────────────────────────────────
  } else if (type === 'today') {
    from = to = lastD; // día más reciente disponible
  } else if (type === '7d' || type === '14d' || type === '30d' || type === '90d') {
    const nDays = { '7d': 6, '14d': 13, '30d': 29, '90d': 89 }[type];
    const cutoffStr = _addDaysToDateStr(lastD, -nDays);
    from = dates.find(d => d >= cutoffStr) || dates[0];
    to   = lastD;

  // ── Presets para escala mensual ──────────────────────────────────────────
  } else if (type === '3m' || type === '6m') {
    const nMonths = type === '3m' ? 3 : 6;
    // En mensual, dates son "YYYY-MM".
    const [ly, lm] = lastD.slice(0, 7).split("-").map(Number);
    const cutoffDate = new Date(ly, lm - 1 - (nMonths - 1), 1);
    const cutoffStr  = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, "0")}`;
    from = dates.find(d => d >= cutoffStr) || dates[0];
    to   = lastD;
  }

  if (!from || !to) return;
  const elFrom = document.getElementById("dateFrom");
  const elTo   = document.getElementById("dateTo");
  if (elFrom) elFrom.value = from;
  if (elTo)   elTo.value   = to;
  // Cancelar cualquier debounce de applyFilters pendiente del listener change
  // de dateFrom/dateTo (250ms) para evitar doble render solapado.
  if (typeof _debouncedApplyCancel === "function") _debouncedApplyCancel();
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
    kams.map(k => `<option value="${escapeHTML(k)}">${escapeHTML(k)}</option>`).join("");
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
  const pH  = escapeHTML(p);
  return `<div class="pi" data-p="${pH}" style="height:${VIRT_ITEM_H}px">
      <input type="checkbox" id="${id}" value="${pH}" ${chk}/>
      <label for="${id}">
        <span class="pdot" style="background:${c}"></span>${pH}
      </label>
    </div>`;
}

// ── SIDEBAR UI REFRESH ────────────────────────────────────────────────────────
// SOLO refresca elementos del sidebar (dates/KAM/partners + restore filtros).
// La construccion de indices secundarios (_byDate, _byPartner, _byCity,
// _byCityDate, _partnerKAM) la hace updateIndexes() en data.js — debe llamarse
// ANTES de popSidebarUI() porque restoreFilters > onKAMChange leen los indices.
function popSidebarUI() {
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

// _skipApply: cuando es true (set por onKAMChange y restore), selectAll/deselectAll
// NO disparan el _debouncedApply para evitar double-render con el caller.
let _skipApply = false;
function selectAll()  {
  document.querySelectorAll("#pList input").forEach(c => c.checked = true);
  if (!_skipApply && _debouncedApply) _debouncedApply();
}
function deselectAll(){
  document.querySelectorAll("#pList input").forEach(c => c.checked = false);
  if (!_skipApply && _debouncedApply) _debouncedApply();
}

function onKAMChange() {
  const k = document.getElementById("kamFilter").value;
  _skipApply = true;
  if (k === "all") {
    selectAll();
  } else {
    const ps = STATE.KAM_PARTNERS[k] ? [...STATE.KAM_PARTNERS[k]] : [];
    document.querySelectorAll("#pList input").forEach(c => {
      c.checked = ps.includes(c.value);
    });
  }
  _skipApply = false;
  // El debounce de applyFilters dispara renders con 250ms de retraso. Forzamos
  // un re-render inmediato del tab activo para que el cambio se vea al instante.
  saveFilters();
  // Si la invocacion viene desde restoreFilters() dentro de switchMode/loadFromSupabase,
  // suprimimos el render porque el caller orquestara el render final una sola vez.
  // Evita double-render (ej. switchMode: updateIndexes→popSidebarUI→restoreFilters→onKAMChange
  // renderizaba ANTES, y luego switchMode renderizaba OTRA VEZ al final).
  if (STATE._suppressRestoreRender) return;
  if (STATE.curTab === "rend"        && STATE.rawData.length)                           renderRend();
  if (STATE.curTab === "metas"       && STATE.metasData.length && STATE.rawData.length) renderMetas();
  if (STATE.curTab === "ops"         && STATE.rawData.length)                           renderOps();
  if (STATE.curTab === "insights"    && STATE.rawData.length)                           renderInsights();
  if (STATE.curTab === "unifview"    && STATE.rawData.length)                           renderUnifView();
  if (STATE.curTab === "partnerview" && STATE.rawData.length)                           renderPartnerView();
  if (STATE.curTab === "calculator"  && STATE.rawData.length)                           renderCalculator();
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
  if (STATE.curTab === "rend"        && STATE.rawData.length)                           renderRend();
  if (STATE.curTab === "metas"       && STATE.metasData.length && STATE.rawData.length) renderMetas();
  if (STATE.curTab === "unifview"    && STATE.rawData.length)                           renderUnifView();
  if (STATE.curTab === "ops"         && STATE.rawData.length)                           renderOps();
  if (STATE.curTab === "insights"    && STATE.rawData.length)                           renderInsights();
  if (STATE.curTab === "partnerview" && STATE.rawData.length)                           renderPartnerView();
  if (STATE.curTab === "calculator"  && STATE.rawData.length)                           renderCalculator();
  // Presentación 2.0: al mover el filtro, re-renderiza el slide actual (Avance vs Meta
  // deriva su mes del "Hasta" → antes no se actualizaba porque applyFilters no lo tocaba).
  if (STATE.curTab === "present2"    && typeof renderSlide2 === "function"
      && PRESENT2_STATE.partner && STATE.rawData.length)                                renderSlide2();
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

  // ── Sección: Eliminar Datos (solo admin) ────────────────────────────────────
  // El gate definitivo es RLS en Supabase: aunque alguien fuerce el render
  // desde DevTools, la query DELETE falla con 401/PGRST.
  if (STATE.isAdmin) {
    html += `
    <div class="section" style="margin-bottom:16px;border:1px solid #fecaca;background:#fff8f8;border-radius:8px;padding:14px">
      <div style="font-size:.8rem;font-weight:700;color:#991b1b;margin-bottom:6px">🗑️ Eliminar Datos</div>
      <div style="font-size:.72rem;color:#888;margin-bottom:12px">
        Borra registros de la base de datos. Útil cuando subiste un Excel con error y quieres re-subir.
        Si dejas el mes vacío, borra <strong>TODA</strong> la tabla. <strong style="color:#991b1b">Acción irreversible.</strong>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div style="display:flex;flex-direction:column">
          <label style="font-size:.68rem;color:#aaa;margin-bottom:3px;font-weight:600">Tabla</label>
          <select class="crud-input" id="delTableSel" style="width:auto;min-width:140px">
            <option value="rendimiento">Rendimiento Semanal</option>
            <option value="rendimiento_mensual">Rendimiento Mensual</option>
            <option value="rendimiento_diario">Rendimiento Diario</option>
            <option value="metas">Metas</option>
          </select>
        </div>
        <div style="display:flex;flex-direction:column">
          <label style="font-size:.68rem;color:#aaa;margin-bottom:3px;font-weight:600">Mes (opcional)</label>
          <input class="crud-input" id="delMonthInput" placeholder="2026-04 o vacío"
            style="width:140px" maxlength="7"/>
        </div>
        <button class="crud-btn crud-btn-del" onclick="deleteDashboardData()"
          style="background:#FF0000;color:#fff;font-weight:700;padding:8px 14px;margin-top:18px">
          🗑️ Eliminar
        </button>
      </div>
    </div>`;
  }

  // ── Sección: Filtros de Flota (palabras prohibidas) ──────────────────────────
  const excludedCount = STATE.rawDataFull.length - STATE.rawData.length;
  // bannedWords viene de localStorage y puede ser manipulado: escapamos siempre,
  // y pasamos el valor como JSON HTML-encodeado para no romper el atributo onclick.
  const bannedBadges  = STATE.bannedWords.map(w => {
    const wText = escapeHTML(w);
    const wAttr = escapeHTML(JSON.stringify(w));
    return `<span style="display:inline-flex;align-items:center;gap:4px;background:#fff0f0;border:1px solid #fecaca;border-radius:20px;padding:3px 10px;font-size:.73rem;font-weight:600;color:#991b1b">
      ${wText}
      <button onclick="removeBannedWord(${wAttr})"
        style="background:none;border:none;cursor:pointer;color:#FF0000;font-size:.85rem;line-height:1;padding:0 2px;margin-left:2px" title="Eliminar">✕</button>
    </span>`;
  }).join("");

  // Calcular qué partners fueron excluidos y por qué (qué palabra disparó la exclusion)
  const bannedLower = (STATE.bannedWords || []).map(w => w.toLowerCase());
  const excludedPartners = new Map(); // partner -> { matchedWord, rows, kam }
  STATE.rawDataFull.forEach(r => {
    const nameLower = (r.partner || "").toLowerCase();
    const matched = bannedLower.find(w => nameLower.includes(w));
    if (!matched) return;
    if (!excludedPartners.has(r.partner)) {
      excludedPartners.set(r.partner, { matchedWord: matched, rows: 0, kam: r.kam || getKAMForPartner(r.partner) || "—" });
    }
    excludedPartners.get(r.partner).rows++;
  });
  const excludedList = [...excludedPartners.entries()].sort((a,b) => b[1].rows - a[1].rows);

  html += `
    <div class="section" style="margin-bottom:16px">
      <div style="font-size:.8rem;font-weight:700;color:#555;margin-bottom:10px">🚫 Filtros de Flota — Palabras Prohibidas</div>
      <div style="font-size:.75rem;color:#888;margin-bottom:10px">
        Los partners cuyo nombre contenga alguna de estas palabras (sin importar mayúsculas) quedan excluidos del dashboard.
        Actualmente excluidos: <strong style="color:#FF0000">${excludedCount}</strong> registro(s) · <strong>${excludedPartners.size}</strong> partner(s) en el período cargado.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
        ${bannedBadges || `<span style="font-size:.75rem;color:#aaa">Sin palabras prohibidas configuradas.</span>`}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <input class="crud-input" id="newBannedWord" placeholder="Nueva palabra (ej: mototaxi)"
          style="flex:1;min-width:180px;max-width:280px"
          onkeydown="if(event.key==='Enter') addBannedWord()"/>
        <button class="crud-btn crud-btn-add" onclick="addBannedWord()">+ Agregar</button>
      </div>
      ${excludedList.length ? `
        <details style="border:1px solid #fecaca;border-radius:6px;background:#fffafa;margin-top:8px">
          <summary style="cursor:pointer;padding:8px 12px;font-size:.78rem;font-weight:700;color:#991b1b">
            Ver partners actualmente excluidos (${excludedPartners.size})
          </summary>
          <div style="max-height:280px;overflow-y:auto;border-top:1px solid #fecaca">
            <table style="width:100%;border-collapse:collapse;font-size:.75rem">
              <thead style="background:#fff5f5;position:sticky;top:0">
                <tr>
                  <th style="text-align:left;padding:6px 10px;border-bottom:1px solid #fecaca">Partner</th>
                  <th style="text-align:left;padding:6px 10px;border-bottom:1px solid #fecaca">KAM</th>
                  <th style="text-align:left;padding:6px 10px;border-bottom:1px solid #fecaca">Palabra que aplicó</th>
                  <th style="text-align:right;padding:6px 10px;border-bottom:1px solid #fecaca">Filas</th>
                </tr>
              </thead>
              <tbody>
                ${excludedList.map(([p, info]) => `
                  <tr>
                    <td style="padding:5px 10px;border-bottom:1px solid #fee">${escapeHTML(p)}</td>
                    <td style="padding:5px 10px;border-bottom:1px solid #fee;color:#666">${escapeHTML(info.kam)}</td>
                    <td style="padding:5px 10px;border-bottom:1px solid #fee"><code style="background:#fff0f0;padding:1px 5px;border-radius:3px;color:#991b1b">${escapeHTML(info.matchedWord)}</code></td>
                    <td style="padding:5px 10px;border-bottom:1px solid #fee;text-align:right;color:#888">${info.rows}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </details>` : ""}
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

  // CRUD table: toolbar ESTÁTICO (search + KAM filter) + contenedor de resultados
  // que se repinta solo (renderConfigResults) → el input no se re-crea y conserva
  // el foco al escribir (fix Fase 7).
  const cfgKamF   = CONFIG_STATE.kamFilter;
  const kamFilterOpts = kams.map(k => `<option value="${escapeHTML(k)}"${cfgKamF===k?" selected":""}>${escapeHTML(k)}</option>`).join("");
  html += `
    <div style="margin-bottom:10px;font-size:.8rem;font-weight:700;color:#555">👥 Partners &amp; CLIDs</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <input class="crud-input" id="configSearch" placeholder="Buscar CLID, partner o KAM..." value="${CONFIG_STATE.search.replace(/"/g,'&quot;')}"
        oninput="CONFIG_STATE.search=this.value;CONFIG_STATE.page=0;renderConfigResults()" style="flex:1;min-width:160px;max-width:300px"/>
      <select class="crud-input" id="configKamFilter" onchange="CONFIG_STATE.kamFilter=this.value;CONFIG_STATE.page=0;renderConfigResults()" style="width:auto">
        <option value="all"${cfgKamF==="all"?" selected":""}>Todos los KAMs</option>
        ${kamFilterOpts}
      </select>
      <span id="configCount" style="font-size:.75rem;color:#aaa"></span>
    </div>
    <div id="configResults"></div>
    </div>`;   // cierra la .section abierta arriba (stats KAM + Partners & CLIDs)
  content.innerHTML = html;
  renderConfigResults();
}

// Repinta SOLO contador + tabla + paginación (sin re-crear el input de búsqueda).
function renderConfigResults() {
  const box = document.getElementById("configResults");
  if (!box) return;
  const kams = [...new Set(Object.values(STATE.KAM_MAP))].sort();
  const cfgSearch = CONFIG_STATE.search.toLowerCase();
  const cfgKamF   = CONFIG_STATE.kamFilter;
  const allRows = Object.entries(STATE.CLID_MAP)
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
  const cnt = document.getElementById("configCount");
  if (cnt) cnt.textContent = `${allRows.length} resultado${allRows.length!==1?"s":""}`;

  let html = `
    <div class="tbl-wrap">
      <table class="dtbl" id="crudTable">
        <thead>
          <tr>
            <th>CLID</th><th>Partner</th><th>KAM</th>
            <th style="text-align:center;width:60px">Fleet</th>
            <th style="text-align:center;width:70px">TukTuk</th>
            <th style="text-align:center;width:130px">Acciones</th>
          </tr>
        </thead>
        <tbody>`;

  pageRows.forEach(([clid, partner]) => {
      const kam   = STATE.KAM_MAP[clid] || "";
      const color = KAM_COLORS[kam] || "#888";
      const pdot  = STATE.partnerColors[partner] || "#ccc";
      // Escapar valores para evitar XSS (CLID con apostrofes/HTML)
      const clidH    = escapeHTML(clid);
      const partnerH = escapeHTML(partner);
      const kamH     = escapeHTML(kam);
      // Para uso dentro de comillas simples de onclick, escapar apostrofes
      const clidJS   = clid.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const isFleet  = !!(STATE.CLID_IS_FLEET  || {})[clid];
      const isTuktuk = !!(STATE.CLID_IS_TUKTUK || {})[clid];
      html += `
        <tr data-clid="${clidH}">
          <td style="font-size:.75rem;color:#aaa;font-family:monospace">${clidH}</td>
          <td>
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${pdot};margin-right:5px"></span>
            ${partnerH}
          </td>
          <td>
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:4px"></span>
            ${kamH}
          </td>
          <td style="text-align:center">${isFleet ? `<span style="font-size:.68rem;background:#ecfdf5;color:#059669;padding:2px 7px;border-radius:10px;font-weight:700">🚗 Fleet</span>` : `<span style="color:#ddd">—</span>`}</td>
          <td style="text-align:center">${isTuktuk ? `<span style="font-size:.68rem;background:#fff7ed;color:#c2410c;padding:2px 7px;border-radius:10px;font-weight:700">🛺 TukTuk</span>` : `<span style="color:#ddd">—</span>`}</td>
          <td style="text-align:center">
            <button class="crud-btn crud-btn-edit" onclick="kamMakeEditable('${clidJS}')">Editar</button>
            <button class="crud-btn crud-btn-del"  onclick="kamCrudDelete('${clidJS}')">Eliminar</button>
          </td>
        </tr>`;
    });

  // Fila para agregar nuevo
  const kamOpts = kams.map(k => `<option value="${escapeHTML(k)}">${escapeHTML(k)}</option>`).join("");
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
          <td style="text-align:center"><input type="checkbox" id="newFleet" title="Fleet"/></td>
          <td style="text-align:center"><input type="checkbox" id="newTuktuk" title="TukTuk"/></td>
          <td style="text-align:center">
            <button class="crud-btn crud-btn-add" onclick="kamCrudAdd()">+ Agregar</button>
          </td>
        </tr>
      </tbody></table>
    </div>
    ${totalPages > 1 ? `
    <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:.78rem;color:#555">
      <button class="crud-btn" onclick="CONFIG_STATE.page=Math.max(0,CONFIG_STATE.page-1);renderConfigResults()"
        ${CONFIG_STATE.page===0?"disabled":""} style="padding:4px 10px">← Anterior</button>
      <span>Página <strong>${CONFIG_STATE.page+1}</strong> de <strong>${totalPages}</strong></span>
      <button class="crud-btn" onclick="CONFIG_STATE.page=Math.min(${totalPages-1},CONFIG_STATE.page+1);renderConfigResults()"
        ${CONFIG_STATE.page===totalPages-1?"disabled":""} style="padding:4px 10px">Siguiente →</button>
    </div>` : ""}`;
  box.innerHTML = html;
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
  const editKamOpts = kams.map(k => `<option value="${escapeHTML(k)}"${k===kam?" selected":""}>${escapeHTML(k)}</option>`).join("");
  const clidH    = escapeHTML(clid);
  const partnerH = escapeHTML(partner);
  const clidJS   = clid.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const isFleet  = !!(STATE.CLID_IS_FLEET  || {})[clid];
  const isTuktuk = !!(STATE.CLID_IS_TUKTUK || {})[clid];
  row.innerHTML = `
    <td style="font-size:.75rem;color:#aaa;font-family:monospace">${clidH}</td>
    <td><input class="crud-input" id="edit_partner_${clidH}" value="${partnerH}"/></td>
    <td>
      <select class="crud-input" id="edit_kam_${clidH}" onchange="kamEditKamChange('${clidJS}')" style="width:100%">
        ${editKamOpts}
        <option value="__new__">+ Añadir nuevo KAM...</option>
      </select>
      <input class="crud-input" id="edit_kam_custom_${clidH}" placeholder="Nuevo nombre de KAM" style="display:none;margin-top:4px"/>
    </td>
    <td style="text-align:center"><input type="checkbox" id="edit_fleet_${clidH}" ${isFleet ? "checked" : ""} title="Fleet"/></td>
    <td style="text-align:center"><input type="checkbox" id="edit_tuktuk_${clidH}" ${isTuktuk ? "checked" : ""} title="TukTuk"/></td>
    <td style="text-align:center">
      <button class="crud-btn crud-btn-save"   onclick="kamCrudEdit('${clidJS}')">Guardar</button>
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
  const isFleet  = document.getElementById(`edit_fleet_${clid}`)?.checked || false;
  const isTuktuk = document.getElementById(`edit_tuktuk_${clid}`)?.checked || false;
  showLoad(true, "Guardando...");
  const { error } = await sb.from("partners")
    .upsert([{ clid, partner, kam, activo: true, is_fleet: isFleet, is_tuktuk: isTuktuk }], { onConflict: "clid" });
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
  const isFleet  = document.getElementById("newFleet")?.checked || false;
  const isTuktuk = document.getElementById("newTuktuk")?.checked || false;
  showLoad(true, "Guardando...");
  const { error } = await sb.from("partners")
    .upsert([{ clid, partner, kam, activo: true, is_fleet: isFleet, is_tuktuk: isTuktuk }], { onConflict: "clid" });
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

// ── ELIMINAR DATOS DE SUPABASE ────────────────────────────────────────────────
async function deleteDashboardData() {
  const tableSel = document.getElementById("delTableSel");
  const monthInp = document.getElementById("delMonthInput");
  if (!tableSel || !monthInp) return;

  // Guard defensivo. El enforcement real esta en RLS (is_admin()).
  if (!STATE.isAdmin) {
    showBanner(false, "Operacion bloqueada: requiere rol admin.");
    return;
  }

  const table = tableSel.value;
  const mes   = monthInp.value.trim();

  const labels = {
    rendimiento:         "Rendimiento Semanal",
    rendimiento_mensual: "Rendimiento Mensual",
    rendimiento_diario:  "Rendimiento Diario",
    metas:               "Metas"
  };

  // Validar formato del mes si se proporciono
  if (mes && !/^\d{4}-\d{2}$/.test(mes)) {
    alert("Formato de mes invalido. Debe ser YYYY-MM (ej: 2026-04).");
    return;
  }

  const scope = mes ? `del mes ${mes}` : "TODA la tabla";
  if (!confirm(
    `¿Confirmas borrar ${scope} de ${labels[table]}?\n\n` +
    `Esta accion NO se puede deshacer.`
  )) return;

  showLoad(true, `Eliminando ${labels[table]}...`);

  try {
    let query = sb.from(table).delete();

    if (mes) {
      const [y, m] = mes.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const monthEnd = `${mes}-${String(lastDay).padStart(2, "0")}`;
      const monthStart = `${mes}-01`;

      if (table === "rendimiento") {
        query = query.gte("fecha", monthStart).lte("fecha", monthEnd);
      } else if (table === "rendimiento_diario") {
        query = query.gte("date", monthStart).lte("date", monthEnd);
      } else if (table === "rendimiento_mensual") {
        query = query.eq("mes", mes);
      } else if (table === "metas") {
        query = query.eq("mes", mes);
      }
    } else {
      // Supabase requiere un WHERE para DELETE. Usar filtro tautologico.
      query = query.neq("clid", "__NEVER_MATCH__");
    }

    const { error } = await query;
    if (error) throw error;

    showBanner(true, `Eliminado: ${labels[table]} ${mes ? `(${mes})` : "(todo)"}`);

    // Resetear flags de lazy-load para forzar recarga del dataset modificado
    if (table === "rendimiento_mensual") STATE._mensualLoaded = false;
    if (table === "rendimiento_diario")  STATE._diarioLoaded  = false;

    // Recargar desde Supabase para reflejar el estado actual
    monthInp.value = "";
    await loadFromSupabase();
  } catch (err) {
    showBanner(false, `Error al eliminar: ${err.message}`);
    console.error(err);
  } finally {
    showLoad(false);
  }
}
