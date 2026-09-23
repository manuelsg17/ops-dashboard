//@ts-nocheck
// app.js — Inicialización principal, sidebar, tabs y helpers de UI

// ── CONFIG PAGINATION STATE ───────────────────────────────────────────────────
// section (Ola 6): "partners" · "clasificacion" · "cargas" · "usuarios" (admin) ·
// "monitoreo" (admin) · "preferencias" · "mantenimiento" (admin o delete:data).
// La vista vive en configView.ts; qué sección ve cada rol lo decide ella.
// estado: "todos" | "pendientes" (filtro de la tabla de Partners) · panel: null |
// { modo: "editar"|"alta", clid } (panel lateral) · sel: CLIDs marcados para
// reasignar KAM en bloque.
export const CONFIG_STATE = {
  page: 0, search: "", kamFilter: "all", PAGE_SIZE: 20, section: "partners",
  estado: "todos", panel: null, sel: new Set()
};

// ── LOCALSTORAGE HELPER ───────────────────────────────────────────────────────
export function lsSet(key, val) {
  try { localStorage.setItem(key, val); } catch (e) { /* QuotaExceededError o privado */ }
}
export function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// ── DEBOUNCE ──────────────────────────────────────────────────────────────────
export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => { clearTimeout(t); t = null; };
  return wrapped;
}

// Timers a nivel modulo para que switchTab pueda cancelarlos al salir del tab
export let _pSearchTimer = null;
export let _sidebarResizeTimer = null;
// Debounce de applyFilters expuesto a nivel modulo (se inicializa en initApp).
// setDatePreset() lo cancela antes de llamar applyFilters() directo para no
// solapar dos renders.
export let _debouncedApply       = null;
export function _debouncedApplyCancel() { if (_debouncedApply && _debouncedApply.cancel) _debouncedApply.cancel(); }

// Universo de partners del sidebar: Taxi + los que SOLO operan TukTuk (ver
// updateIndexes en data.js). Fallback a allPartners por si se llama antes de
// que updateIndexes haya corrido.
function _sidebarList() {
  return (STATE.sidebarPartners && STATE.sidebarPartners.length)
    ? STATE.sidebarPartners
    : (STATE.allPartners || []);
}

// ── LISTENERS DE LA APP (una sola vez por carga de página) ─────────────────────
// I2: initApp vuelve a correr en cada login SIN recarga (handleLogout pone
// _appInitialized=false para que se vuelvan a pedir los datos del usuario
// nuevo). Estos listeners, en cambio, se colgaban de nodos que NO se recrean
// (document, #partnerSearch, los <input type=file>, #pList…), así que salir y
// entrar los duplicaba: cada filtro renderizaba dos veces, cada menú se cerraba
// dos veces. Ninguno depende del usuario, así que se instalan UNA vez.
let _listenersListos = false;
function _instalarListenersUnaVez() {
  if (_listenersListos) return;
  _listenersListos = true;
  // Debounce en búsqueda de partners (timer a nivel modulo para cancelar al cambiar tab)
  document.getElementById("partnerSearch").addEventListener("input", () => {
    clearTimeout(_pSearchTimer);
    _pSearchTimer = setTimeout(filterPList, 300);
  });

  // Cerrar dropdowns al hacer clic fuera.
  // OJO (Fase A2, event delegation): antes los botones que ABREN estos menús
  // usaban onclick inline con e.stopPropagation() para que el click no llegara
  // hasta acá y los cerrara al instante. Ahora esos handlers son delegados y
  // viven TAMBIÉN en `document`, asi que stopPropagation ya no los separa (solo
  // frena la propagación entre nodos, no entre listeners del mismo nodo). Por
  // eso el guard explícito: si el click fue sobre un botón que abre un menú, no
  // cerramos nada — de lo contrario el menú se abriría y cerraría en el mismo
  // click y no se abriría nunca.
  const _MENU_TOGGLES = '[data-act="toggleUploadMenu"],[data-act="toggleUserMenu"]';
  document.addEventListener("click", e => {
    if (e.target.closest(_MENU_TOGGLES)) return;
    const m = document.getElementById("uploadMenu");
    if (m) m.classList.remove("open");
    const u = document.getElementById("userMenu");
    if (u) u.classList.remove("open");
    syncMenusAria();
  });

  // Cerrar dropdown al seleccionar un archivo
  ["fileRend", "fileRendMensual", "fileRendDiario", "fileMetas", "fileData", "fileFlotas", "fileConversion"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const m = document.getElementById("uploadMenu");
      if (m) m.classList.remove("open");
      syncMenusAria();
    });
  });

  // Filtros reactivos: cualquier cambio dispara applyFilters() debounced.
  // No hay boton "Aplicar Filtros" — se elimino porque era redundante.
  // kamFilter NO se incluye: ya tiene su propia accion delegada (onKAMChange)
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

}

// ── APP INIT ──────────────────────────────────────────────────────────────────
export function initApp() {
  // Arrancar la descarga de ApexCharts YA, en paralelo con el fetch de datos:
  // no bloquea nada (buildLineChart/buildDonutChart se re-encolan solos si aún
  // no llegó) pero para cuando el render llega a las gráficas, casi siempre ya
  // está lista. initApp corre post-login, así que la pantalla de login sigue
  // sin pagar los 133 kB.
  if (typeof ensureApex === "function") ensureApex().catch(() => {});

  // Restaurar configuración de alerta de declive
  try {
    const d = JSON.parse(lsGet("yangoDecline") || "{}");
    if (d.metric)    STATE.declineMetric    = d.metric;
    if (d.threshold) STATE.declineThreshold = d.threshold;
  } catch(e) {}

  initFileHandlers();
  _instalarListenersUnaVez();

  // Precarga en tiempo ocioso de las pantallas más usadas, DESPUÉS de que la
  // carga inicial terminó: bajar sus chunks mientras el navegador está libre es
  // gratis, y hace que cambiar de pestaña no tenga que esperar una descarga
  // (era buena parte de la sensación de "trabado / pantalla en blanco").
  // ORDEN POR PESO REAL, no por frecuencia de uso (medido con el build de
  // ago-2026, en gzip): present2 arrastra Chart.js como import estatico, asi que
  // abrirla en frio son 24 kB del modulo + 71 kB de la libreria = 95 kB, contra
  // 24 kB de partnerview o 13 kB de calculator. Iba TERCERA en la fila y la
  // precarga es serial (una por callback de idle), asi que era justo la mas
  // pesada la que casi nunca llegaba a tiempo — de ahi que "Presentacion 2.0"
  // se sintiera la mas lenta al entrar. Ahora va primera.
  //
  // …PERO EL CHUNK NUNCA FUE LO MÁS CARO. Medido en ago-2026: abrir Presentación
  // 2.0 en frío esperaba además a `ensureFullRendColumns()`, que switchTab AWAITEA
  // antes de pintar — un fetch de las 26 columnas diferidas sobre la ventana
  // entera. Por eso se sentía lenta "solo la primera vez" y rápida después: el
  // chunk ya estaba precargado, la descarga de datos no. Lo mismo con mensual y
  // diario, que hacen su propio lazy load al primer cambio de escala.
  //
  // Ahora la cadena de idle precarga DATOS, no solo módulos. El orden es por
  // costo de espera percibido: primero lo que bloquea el render de una pestaña
  // (columnas), después las escalas alternativas. Diario va último: es el dataset
  // más grande y el que menos se abre.
  // Si la sesión cambió mientras cargaba (logout, o la sesión provisional no se
  // pudo validar — Ola 2, V1, ver auth.ts), no se precarga nada para ella.
  const _epoca = STATE._authEpoch || 0;
  const _prefetchData = async () => {
    const idle = window.requestIdleCallback || (cb => setTimeout(cb, 800));
    // Cada paso vuelve a mirar la época: la cadena dura varios segundos y la
    // sesión puede descartarse en el medio (V1, ver auth.ts).
    const paso = fn => new Promise(res => idle(() => {
      if ((STATE._authEpoch || 0) !== _epoca) return res();
      Promise.resolve(fn()).then(res, res);
    }));
    // Fallo silencioso a propósito: es una optimización. Si algo no llega, la
    // pestaña lo pide igual por el camino de siempre.
    await paso(() => ensureFullRendColumns());
    // Con la escala guardada en mensual/diaria (V3), el paso de arriba completa
    // ESA escala y la semanal quedaba sin sus columnas diferidas: el portal
    // (que no las pide al cambiar de línea) mostraba la aceptación Fleet en "—"
    // al pasar a semanal. Ya pasaba antes de V3 (restoreFilters cambiaba de
    // escala antes de esta precarga); no-op si ya estaban.
    await paso(() => ensureFullRendColumns("semanal"));
    await paso(() => loadMensualIfNeeded(true));
    await paso(() => ensureFullRendColumns("mensual"));
    await paso(() => loadDiarioIfNeeded(true));
    await paso(() => ensureFullRendColumns("diario"));
  };
  const _prefetch = () => {
    if ((STATE._authEpoch || 0) !== _epoca) return;
    if (typeof window.prefetchViewModules === "function") {
      window.prefetchViewModules(["present2", "calculator", "rawdata", "seguimiento"]);
    }
    _prefetchData().catch(() => {});
  };
  Promise.resolve(loadFromSupabase()).then(_prefetch, _prefetch);

  // Indicador "BD actualizada hace X" del topbar — informativo, nunca bloquea
  // el arranque (ver comentario en data.js junto a fetchAndRenderLastIngest).
  if (typeof fetchAndRenderLastIngest === "function") fetchAndRenderLastIngest();
}

// Menu de sesion: el email es el disparador y "Salir" vive adentro. Antes
// "Salir" era un boton permanente en la barra para una accion que se usa una
// vez por dia.
export function toggleUserMenu(e) {
  e.stopPropagation();
  const m = document.getElementById("userMenu");
  if (m) m.classList.toggle("open");
  document.getElementById("uploadMenu")?.classList.remove("open");
  syncMenusAria();
}

export function toggleUploadMenu(e) {
  e.stopPropagation();
  document.getElementById("uploadMenu").classList.toggle("open");
  document.getElementById("userMenu")?.classList.remove("open");
  syncMenusAria();
}

// (Ola 5: el desplegable "Análisis" y la barra de pestañas de arriba se
// retiraron; la navegación es lateral y la pinta shell.ts.)

// ── PANEL DE FILTROS (antes "sidebar") ────────────────────────────────────────

// La preferencia de sidebar se guarda POR TIPO DE PANTALLA. En escritorio el
// sidebar es un panel fijo al costado y tenerlo abierto es lo natural; en
// tablet FLOTA sobre el contenido, así que ese mismo "abierto" tapa los KPIs.
// Con una sola clave, abrirlo una vez en la Mac lo dejaba abierto en el iPad.
export function _esLayoutTablet() {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(max-width: 1024px)").matches : false;
}
export function _sidebarPrefKey() {
  return _esLayoutTablet() ? "yangoSidebarCollapsedTablet" : "yangoSidebarCollapsed";
}

export function toggleSidebar() {
  const sb  = document.getElementById("mainSidebar");
  const collapsed = sb.classList.toggle("collapsed");
  lsSet(_sidebarPrefKey(), collapsed ? "1" : "0");
  syncFiltrosAria();
  // Al abrir el panel flotante (tablet) el foco va a su primer control; al
  // cerrarlo, vuelve al botón de "Filtros" del encabezado.
  if (_esLayoutTablet()) {
    if (!collapsed) sb.querySelector(".fp-close")?.focus();
    else document.querySelector(".shell-filtros-btn")?.focus();
  }
  // Reajustar gráficas ApexCharts al cambiar ancho (timer cancelable desde switchTab)
  clearTimeout(_sidebarResizeTimer);
  _sidebarResizeTimer = setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
}

// ── FILTROS EN localStorage ───────────────────────────────────────────────────
export function saveFilters() {
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

export function restoreFilters() {
  const raw = lsGet("yangoFilters");
  if (!raw) return;
  try {
    const f = JSON.parse(raw);
    const optVals = sel => [...(sel?.options || [])].map(o => o.value);

    if (f.dateFrom) {
      const el = document.getElementById("dateFrom");
      // No restaurar un "Desde" guardado más viejo que la ventana REALMENTE
      // cargada (STATE._loadedFrom, semanal) — si no, un valor guardado hace
      // meses (nunca expira, saveFilters() lo pisa en cada interacción)
      // reaparecería en el selector y dispararía needsWiderRange()==true en
      // el primer cambio de filtro, re-descargando la tabla entera (mismo bug
      // que popDates() — ver su comentario). Un "Desde" MÁS RECIENTE que lo
      // cargado (el usuario acotó el rango a propósito) sí se restaura normal.
      const tooOld = STATE.curMode === "semanal" && STATE._loadedFrom && f.dateFrom < STATE._loadedFrom;
      if (el && !tooOld && optVals(el).includes(f.dateFrom)) el.value = f.dateFrom;
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

}

// Restaurar estado del sidebar. En TABLET arranca cerrado salvo que el usuario
// haya elegido lo contrario: ahí el sidebar FLOTA sobre el contenido (ver
// styles.css), así que dejarlo abierto de entrada tapa los KPIs con un panel de
// filtros que todavía no pidió.
//
// OJO — esto vivía DENTRO de restoreFilters(), después de su `return` temprano
// de "no hay filtros guardados". O sea: no corría en un dispositivo sin
// filtros previos, que es exactamente la primera visita en el iPad, el único
// caso para el que se escribió. Va aparte y se llama siempre.
export function restoreSidebarState() {
  const _pref = lsGet(_sidebarPrefKey());
  if (!(_pref === "1" || (_pref === null && _esLayoutTablet()))) return;
  const sb  = document.getElementById("mainSidebar");
  if (sb)  sb.classList.add("collapsed");
  syncFiltrosAria();
}

// ── MODE SWITCH (Semanal / Mensual) ───────────────────────────────────────────
export let _inSwitchMode = false; // guard: evita que restoreFilters() revierta el cambio de modo
export async function switchMode(mode) {
  if (_inSwitchMode) return;
  _inSwitchMode = true;

  STATE.curMode = mode;

  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  schedulePageHeader();   // chip de escala al instante

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

  // Las pestañas lazy conservan el HTML de la escala ANTERIOR hasta que su render
  // termina, y el suyo espera a que lleguen las columnas diferidas de la escala
  // nueva (una request). En ese hueco el KAM veia un deck rotulado "SEMANAL"
  // estando la app en mensual — y ese deck es el que se le manda al partner.
  // Blanquearlas es lo unico que garantiza que no exista un estado en el que la
  // pantalla dice una escala y los numeros son de otra.
  invalidarPanelesDeEscala();

  // El badge de frescura responde POR ESCALA ("¿hasta cuándo llegan los datos
  // de lo que estoy mirando?"), así que su respuesta cambia acá aunque el dato
  // de la ingesta sea el mismo. Sin esto seguiría mostrando el veredicto de la
  // escala anterior — que es exactamente el error que el badge existe para
  // evitar: una escala al día y la otra atrasada, con el mismo cartel.
  if (typeof renderFrescura === "function") renderFrescura();

  // Otro yield antes del render pesado para que el browser pinte el spinner
  await new Promise(r => requestAnimationFrame(r));

  // Render unico del tab activo (restoreFilters no rendero por _suppressRestoreRender)
  if (STATE.curTab === "rend"        && STATE.rawData.length) renderRend();
  if (STATE.curTab === "metas"       && STATE.metasData.length && STATE.rawData.length) renderMetas();
  // Estas cuatro leen las columnas DIFERIDAS, que son por escala: sin el await
  // se renderizaban con la escala nueva pero esas columnas en null (KPIs y
  // embudo en "—", sin ningun error). switchTab ya lo hacia; switchMode no.
  if (_NEED_FULL_COLS.has(STATE.curTab) && typeof ensureFullRendColumns === "function") {
    try { await ensureFullRendColumns(); } catch (e) { /* nunca bloquear el render */ }
  }
  if (STATE.curTab === "calculator"  && STATE.rawData.length) renderCalculator();
  if (STATE.curTab === "present2"    && STATE.rawData.length && typeof renderPresent2 === "function") renderPresent2();
  if (STATE.curTab === "rawdata"     && typeof renderRawData === "function") renderRawData();

  showLoad(false);
  _inSwitchMode = false;
  schedulePageHeader();
}

// Pestañas cuyo contenido depende de la ESCALA y viven en un chunk lazy: su HTML
// sobrevive al cambio de escala porque el panel no se desmonta. Ver el comentario
// en switchMode.
export const _NEED_FULL_COLS = new Set(["present2", "rawdata", "calculator"]);
const _PANELES_DE_ESCALA = ["present2Content", "calculatorContent", "rawdataContent"];
export function invalidarPanelesDeEscala() {
  _PANELES_DE_ESCALA.forEach(id => {
    const el = document.getElementById(id);
    // Solo si tiene algo: vaciar uno vacio dispararia el placeholder de switchTab
    // sin motivo.
    if (el && el.innerHTML.trim()) el.innerHTML = "";
  });
}

// ── TAB NAVIGATION ────────────────────────────────────────────────────────────
export function switchTab(tab) {
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
    // Telemetría: primera visita a cada pestaña en la sesión (ver accessLog.js).
    logAccess("tab", tab);

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
      if (prevTab === "present2"    && typeof destroyPresent2Charts === "function")   destroyPresent2Charts();
      const apexConsumers = new Set(["rend","metas"]);
      if (apexConsumers.has(prevTab) && !apexConsumers.has(tab) && typeof destroyAllCharts === "function") {
        destroyAllCharts();
      }
      // Cancelar timers de sidebar para que no disparen trabajo cross-tab
      clearTimeout(_pSearchTimer);    _pSearchTimer    = null;
      clearTimeout(_sidebarResizeTimer); _sidebarResizeTimer = null;
    }

    // Pantalla completa en presentación
    document.body.classList.toggle("present-mode", tab === "present2");
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

    // Navegación lateral (Ola 5): sección activa + cierre del cajón en móvil.
    syncNavActive(tab);
    closeNavDrawer();
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    document.getElementById(`tab-${tab}`).classList.add("active");
    renderPageHeader();

    // Placeholder de carga en tabs que dependen de un chunk lazy (loadViewModule):
    // sin esto, la primera vez que se visita una de estas pestañas en la sesión
    // (mientras el navegador descarga+ejecuta su JS) el panel quedaba en BLANCO
    // hasta que terminara el render — se sentía "trabado"/"crasheado". El
    // contenido real lo pisa igual apenas termina, así que si el chunk ya está
    // cacheado esto ni se alcanza a ver.
    const LAZY_TAB_CONTENT = {
      present2: "present2Content",
      calculator: "calculatorContent", config: "configContent", portal: "portalContent",
      rawdata: "rawdataContent"
    };
    const lazyBox = LAZY_TAB_CONTENT[tab] && document.getElementById(LAZY_TAB_CONTENT[tab]);
    if (lazyBox && !lazyBox.innerHTML.trim()) {
      lazyBox.innerHTML = `<div style="padding:60px 0;text-align:center;color:#888;font-size:.85rem">Cargando…</div>`;
    }

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
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      // Si en los 2 frames intermedios el usuario ya cambio otra vez, abortar.
      if (STATE._tabRenderId !== tokenAtDispatch) return;
      if (STATE.curTab !== tab) return;

      if (typeof window.loadViewModule === "function") {
        try {
          await window.loadViewModule(tab);
        } catch (err) {
          // loadViewModule ya reintenta los fallos de red y solo recarga ante un
          // chunk 404 real. Si igual llegó acá, es un error de verdad: mostrarlo
          // EN el panel en vez de dejar el placeholder "Cargando…" para siempre
          // (que se leía como app colgada).
          if (STATE.curTab !== tab) return;
          const box = lazyBox || document.getElementById(`tab-${tab}`);
          if (box) {
            box.innerHTML = `<div class="empty"><p>${escapeHTML(t("app.errSeccion"))}</p>
              <p style="font-size:.78rem;color:#888">${escapeHTML((err && err.message) || String(err))}</p>
              <button class="btn" data-act="reloadApp">${escapeHTML(t("app.reintentar"))}</button></div>`;
          }
          return;
        }
      }

      if (STATE._tabRenderId !== tokenAtDispatch || STATE.curTab !== tab) return;

      // Columnas pesadas bajo demanda: estas 4 pestañas son las únicas que leen
      // las 26 columnas que el arranque NO pide (ver TX_DEFERRED_COLS en
      // data.js). Se traen solo las que faltan y se fusionan sobre las filas ya
      // cargadas; es una vez por escala y por sesión.
      // Logos: diferidos, solo para las dos pantallas que los muestran. No
      // bloquean el render — si tardan, la carátula usa el monograma y se
      // re-renderiza cuando llegan.
      if ((tab === "present2" || tab === "config") && typeof ensurePartnerLogos === "function") {
        ensurePartnerLogos().then(() => {
          if (STATE.curTab !== tab) return;
          if (tab === "config" && typeof renderConfigResults === "function") renderConfigResults();
          if (tab === "present2" && typeof renderSlide2 === "function") renderSlide2();
        });
      }
      if (_NEED_FULL_COLS.has(tab) && typeof ensureFullRendColumns === "function") {
        try { await ensureFullRendColumns(); } catch (e) { /* nunca bloquear el render */ }
        if (STATE._tabRenderId !== tokenAtDispatch || STATE.curTab !== tab) return;
      }

      if (tab === "rend"        && STATE.rawData.length)                           renderRend();
      if (tab === "metas"       && STATE.metasData.length && STATE.rawData.length) renderMetas();
      if (tab === "rawdata")                                                        renderRawData();
      if (tab === "seguimiento")                                                    renderSeguimiento();
      if (tab === "config")                                                         renderConfig();
      if (tab === "present2"    && STATE.rawData.length && typeof renderPresent2 === "function")    renderPresent2();
      if (tab === "calculator"  && STATE.rawData.length && typeof renderCalculator === "function")   renderCalculator();
    }));
  } finally {
    STATE._switchingTab = false;
  }
}
// ── SIDEBAR: DATES ────────────────────────────────────────────────────────────
// Rango por defecto de la escala activa: el que pone popDates. Lo usa también
// el encabezado (shell.ts) para saber si el rango es un recorte y para
// "Restablecer" / quitar el chip de rango.
export function rangoPorDefecto() {
  const all = STATE.allDates || [];
  if (!all.length) return { from: "", to: "" };
  const from = (STATE.curMode === "semanal" && STATE._loadedFrom && all.includes(STATE._loadedFrom))
    ? STATE._loadedFrom : all[0];
  return { from, to: all[all.length - 1] };
}

export function popDates() {
  const opts = STATE.allDates.map(d => `<option value="${d}">${d2s(d)}</option>`).join("");
  ["dateFrom", "dateTo"].forEach(id => {
    document.getElementById(id).innerHTML = opts;
  });
  if (STATE.allDates.length) {
    // "Desde" por defecto: el inicio de la VENTANA REALMENTE CARGADA
    // (STATE._loadedFrom, solo aplica a semanal — allDates ahí trae TODA la
    // historia vía dashboard_dates, para que el dropdown ofrezca elegir un
    // rango más viejo si se quiere). Usar allDates[0] (el período más viejo de
    // toda la historia) dejaba el selector mostrando "desde el inicio de los
    // tiempos" aunque solo estuvieran cargadas las últimas 6 semanas — y ese
    // valor, guardado por saveFilters(), disparaba needsWiderRange()==true en
    // la primera interacción con cualquier filtro (bug real, ver comentario en
    // data.js junto a computeWindowStart).
    // (La regla vive en rangoPorDefecto(): el encabezado la necesita igual.)
    const def = rangoPorDefecto();
    document.getElementById("dateFrom").value = def.from;
    document.getElementById("dateTo").value   = def.to;
  }
}

// Suma N días a un string "YYYY-MM-DD" con aritmética 100% LOCAL (constructor y
// getters multi-argumento de Date, nunca toISOString()/parseo de string, que son
// UTC — Peru es UTC-5 fijo y de noche ya corre el día, desalineando el cálculo).
export function _addDaysToDateStr(str, n) {
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// ── DATE PRESETS ──────────────────────────────────────────────────────────────
export function setDatePreset(type) {
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
export function getPresetButtonsHTML() {
  // Los presets se REGENERAN desde acá por escala, asi que el data-i18n del HTML
  // estatico se pisaba y estos botones quedaban en espanol con la UI en ruso
  // (encontrado probandolo en el navegador, no leyendo el codigo).
  const defs = {
    diario:  [["today","preset.hoy"],["7d","preset.d7"],["14d","preset.d14"],["30d","preset.d30"],["90d","preset.d90"]],
    semanal: [["week","preset.week"],["fortnight","preset.fortnight"],["month","preset.month"]],
    mensual: [["month","preset.month"],["3m","preset.m3"],["6m","preset.m6"]]
  };
  return (defs[STATE.curMode] || defs.semanal)
    .map(([k, l]) => `<button class="preset-btn" data-act="setDatePreset" data-preset="${escapeHTML(k)}">${escapeHTML(t(l))}</button>`)
    .join("");
}

export function rerenderSidebarPresets() {
  const el = document.getElementById("datePresets");
  if (el) el.innerHTML = getPresetButtonsHTML();
}

// ── SIDEBAR: KAM ─────────────────────────────────────────────────────────────
// El desplegable sale de KAM_PARTNERS (los grupos que REALMENTE existen), no de
// los valores crudos de KAM_MAP.
//
// BUG QUE ESTO ARREGLA: KAM_MAP tiene "" como valor para los partners sin KAM,
// así que el Set incluía la cadena vacía y el `.sort()` la dejaba PRIMERA →
// había una opción en blanco arriba de todo. Al elegirla, onKAMChange buscaba
// STATE.KAM_PARTNERS[""] (undefined) y deseleccionaba TODOS los partners: la
// pantalla quedaba vacía sin explicar por qué. Ahora ese mismo caso es la
// opción "No KAM" y selecciona exactamente los partners sin KAM asignado.
//
// SIN_KAM va ÚLTIMO: es un pendiente de configuración, no un KAM más, y
// ordenado alfabéticamente ("No KAM") caería en medio de la lista de personas.
export function popKAM() {
  const kams = Object.keys(STATE.KAM_PARTNERS || {}).filter(k => k && k !== SIN_KAM).sort();
  if (STATE.KAM_PARTNERS?.[SIN_KAM]?.size) kams.push(SIN_KAM);
  const n = k => (k === SIN_KAM ? ` (${STATE.KAM_PARTNERS[k].size})` : "");
  document.getElementById("kamFilter").innerHTML =
    `<option value="all">${escapeHTML(t("sidebar.todos"))}</option>` +
    kams.map(k => `<option value="${escapeHTML(k)}">${escapeHTML(kamLabel(k) + n(k))}</option>`).join("");
}

// ── SIDEBAR: PARTNERS ────────────────────────────────────────────────────────
export const VIRT_THRESHOLD = 100; // partners antes de activar virtualización
export const VIRT_ITEM_H   = 28;   // px por ítem (debe coincidir con CSS .pi height)
export const VIRT_VISIBLE  = 12;   // ítems visibles en la ventana

export function popPartners(selected) {
  const list   = document.getElementById("pList");
  const selSet = new Set(selected);

  if (_sidebarList().length <= VIRT_THRESHOLD) {
    // Render completo para listas pequeñas
    list.style.height = "";
    list.style.overflowY = "";
    list.innerHTML = _sidebarList().map(p => _pItem(p, selSet)).join("");
    return;
  }

  // Virtualización ligera: altura fija + renderizado de ventana
  list.style.height    = (VIRT_VISIBLE * VIRT_ITEM_H) + "px";
  list.style.overflowY = "auto";

  const renderWindow = () => {
    const scrollTop  = list.scrollTop;
    const start      = Math.max(0, Math.floor(scrollTop / VIRT_ITEM_H) - 2);
    const end        = Math.min(_sidebarList().length, start + VIRT_VISIBLE + 4);
    const topPad     = start * VIRT_ITEM_H;
    const botPad     = (_sidebarList().length - end) * VIRT_ITEM_H;
    const items      = _sidebarList().slice(start, end)
                         .map(p => _pItem(p, selSet)).join("");
    list.innerHTML =
      `<div style="height:${topPad}px"></div>` +
      items +
      `<div style="height:${botPad}px"></div>`;
  };

  list.onscroll = renderWindow;
  renderWindow();
}

export function _pItem(p, selSet) {
  const chk = selSet.has(p) ? "checked" : "";
  const c   = STATE.partnerColors[p] || "#FF0000";
  const id  = "c_" + p.replace(/[^a-z0-9]/gi, "_");
  const pH  = escapeHTML(p);
  return `<div class="pi" data-p="${pH}" style="height:${VIRT_ITEM_H}px">
      <input type="checkbox" id="${id}" value="${pH}" ${chk}/>
      <label for="${id}" title="${pH}">
        <span class="pdot" style="background:${c}"></span>${pH}
      </label>
    </div>`;
}

// ── SIDEBAR UI REFRESH ────────────────────────────────────────────────────────
// SOLO refresca elementos del sidebar (dates/KAM/partners + restore filtros).
// La construccion de indices secundarios (_byDate, _byPartner, _byCity,
// _byCityDate, _partnerKAM) la hace updateIndexes() en data.js — debe llamarse
// ANTES de popSidebarUI() porque restoreFilters > onKAMChange leen los indices.
export function popSidebarUI() {
  popDates();
  rerenderSidebarPresets();
  popKAM();
  popPartners(_sidebarList());
  restoreFilters();
  restoreSidebarState();   // aparte: restoreFilters corta antes si no hay filtros guardados
  // Frescura del encabezado: depende de los períodos de la escala (allDates),
  // que recién están acá. Antes solo se evaluaba al volver get_last_ingest_at
  // (que puede llegar antes que los datos) y al cambiar de escala.
  if (typeof renderFrescura === "function") renderFrescura();
  schedulePageHeader();
}

export function filterPList() {
  const q = document.getElementById("partnerSearch").value.toLowerCase();
  if (_sidebarList().length > VIRT_THRESHOLD) {
    // En modo virtual, reconstruir con la lista filtrada
    const filtered = _sidebarList().filter(p => p.toLowerCase().includes(q));
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
export let _skipApply = false;
export function selectAll()  {
  document.querySelectorAll("#pList input").forEach(c => c.checked = true);
  if (!_skipApply && _debouncedApply) _debouncedApply();
}
export function deselectAll(){
  document.querySelectorAll("#pList input").forEach(c => c.checked = false);
  if (!_skipApply && _debouncedApply) _debouncedApply();
}

export function onKAMChange() {
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
  schedulePageHeader();
  // Si la invocacion viene desde restoreFilters() dentro de switchMode/loadFromSupabase,
  // suprimimos el render porque el caller orquestara el render final una sola vez.
  // Evita double-render (ej. switchMode: updateIndexes→popSidebarUI→restoreFilters→onKAMChange
  // renderizaba ANTES, y luego switchMode renderizaba OTRA VEZ al final).
  if (STATE._suppressRestoreRender) return;
  if (STATE.curTab === "rend"        && STATE.rawData.length)                           renderRend();
  if (STATE.curTab === "metas"       && STATE.metasData.length && STATE.rawData.length) renderMetas();
  if (STATE.curTab === "calculator"  && STATE.rawData.length)                           renderCalculator();
}

export function getSel() {
  return [...document.querySelectorAll("#pList input:checked")].map(c => c.value);
}

export function applyFilters() {
  // Corregir rango invertido automáticamente
  const elFrom = document.getElementById("dateFrom");
  const elTo   = document.getElementById("dateTo");
  if (elFrom && elTo && elFrom.value > elTo.value) {
    [elFrom.value, elTo.value] = [elTo.value, elFrom.value];
  }
  saveFilters();
  schedulePageHeader();

  // Partner externo: su unica vista es el portal (Track C2).
  if (STATE.userRole === "partner") {
    if (typeof renderPartnerPortal === "function") renderPartnerPortal();
    return;
  }

  // Fase A3: los datos se cargan por VENTANA (últimas N semanas), no la tabla
  // entera. Los selectores sí ofrecen todos los períodos, así que el usuario
  // puede pedir uno anterior a lo que hay en memoria — ahí se re-fetchea
  // ampliando la ventana. saveFilters() ya corrió arriba, así que la recarga
  // (que repuebla el sidebar vía restoreFilters) conserva el rango elegido.
  if (typeof needsWiderRange === "function" && needsWiderRange(elFrom?.value)) {
    loadFromSupabase({ from: elFrom.value });   // re-renderiza al terminar
    return;
  }
  if (STATE.curTab === "rend"        && STATE.rawData.length)                           renderRend();
  if (STATE.curTab === "metas"       && STATE.metasData.length && STATE.rawData.length) renderMetas();
  if (STATE.curTab === "calculator"  && STATE.rawData.length)                           renderCalculator();
  // Data Raw NO va acá a propósito: está en NO_SIDEBAR_TABS y tiene sus propios
  // selectores de ciudad y fecha adentro, así que el sidebar no lo toca. Sí
  // depende de la ESCALA, y eso lo cubre switchMode.
  // Presentación: re-render COMPLETO, no solo el slide. Con renderSlide2 la hoja
  // se actualizaba pero el nav y el contador "Hojas x/y" quedaban con el deck
  // anterior — y el deck cambia con el rango, porque una vertical sin datos en
  // esas fechas deja de tener hojas. Un nav que miente sobre lo que se va a
  // exportar es exactamente lo que no puede pasar acá.
  if (STATE.curTab === "present2"    && typeof renderPresent2 === "function"
      && PRESENT2_STATE.partner && STATE.rawData.length)                                renderPresent2();
}

export function updateDeclineSettings() {
  const metric = document.getElementById("declineMetricSel")?.value;
  const threshold = parseInt(document.getElementById("declineThresholdSel")?.value);
  if (metric)    STATE.declineMetric    = metric;
  if (threshold) STATE.declineThreshold = threshold;
  lsSet("yangoDecline", JSON.stringify({ metric: STATE.declineMetric, threshold: STATE.declineThreshold }));
  renderConfig(); // refresca el texto descriptivo
  if (STATE.rawData.length) renderRend(); // recalcula badges
}

// ── CONFIG TAB ────────────────────────────────────────────────────────────────
// Ola 6: Configuración vive en su propio chunk (configView.ts: Partners,
// Clasificación, Cargas, Preferencias, Mantenimiento + los contenedores de
// Usuarios y Monitoreo). Se importa bajo demanda: nadie paga ese código en el
// arranque. Acá queda solo el cargador — renderConfig() sigue siendo el mismo
// global de siempre (setUiLang, refrescos tras escribir, switchTab).
let _cfgMod = null;
let _cfgModP = null;
function _cargarConfigView() {
  if (!_cfgModP) {
    _cfgModP = import("./configView").then(m => (_cfgMod = m))
      .catch(err => { _cfgModP = null; throw err; });
  }
  return _cfgModP;
}

export function renderConfig() {
  const content = document.getElementById("configContent");
  if (!content) return;
  if (!_cfgMod) {
    if (!content.querySelector(".cfgx")) {
      content.innerHTML = `<div class="cfgx-loading" role="status">${escapeHTML(t("cfg6.cargando"))}</div>`;
    }
    _cargarConfigView()
      .then(() => { if (STATE.curTab === "config") renderConfig(); })
      .catch(err => {
        console.error("configView:", err);
        content.innerHTML = alertBox({ tone: "bad", title: t("cfg6.errCargarVista"), text: String(err?.message || err),
          actions: btn({ label: t("cfg6.recargar"), act: "reloadApp", size: "sm" }) });
      });
    return;
  }
  _cfgMod.renderConfigView(content);
}

// ── CARGAS DE EXCEL: resultado de la última subida de ESTA sesión ────────────
// handleFile (data.ts) no devuelve un resultado: todo lo que dice lo dice por
// showBanner. Para que Configuración → Cargas pueda mostrar "cómo salió la
// última subida" sin tocar data.ts, se observa el propio flujo:
//   · inicio  = `change` del <input type=file> (captura en document, corre
//               ANTES del listener de initFileHandlers),
//   · mensajes = los showBanner que ocurren mientras está en curso,
//   · fin     = handleFile vacía el input en TODOS sus caminos de salida
//               (_limpiarInput) y ya no hay overlay de carga.
// Es una foto de la sesión (se pierde al recargar), no un historial.
const _INPUT_TIPO = {
  fileRend: "rendimiento", fileRendMensual: "rendimientoMensual", fileRendDiario: "rendimientoDiario",
  fileMetas: "metas", fileData: "data", fileFlotas: "flotas", fileConversion: "conversion"
};
export const CARGAS_SESION = {};   // tipo → { archivo, inicio, fin, estado: "en curso"|"ok"|"error", mensajes: [{ok,msg}] }
let _cargaActiva = null;
let _cargaTimer = null;

function _repintarCargas() {
  if (STATE.curTab === "config" && CONFIG_STATE.section === "cargas") renderConfig();
}

function _seguirCarga(input, reg) {
  clearInterval(_cargaTimer);
  _cargaTimer = setInterval(() => {
    if (input.value !== "" || document.getElementById("loadingEl")) return;
    clearInterval(_cargaTimer);
    _cargaTimer = null;
    const ultimo = reg.mensajes[reg.mensajes.length - 1];
    reg.estado = ultimo && ultimo.ok ? "ok" : "error";
    reg.fin = Date.now();
    if (_cargaActiva === reg) _cargaActiva = null;
    if (_cfgMod && _cfgMod.invalidarUltimosCargados) _cfgMod.invalidarUltimosCargados();
    _repintarCargas();
  }, 400);
}

document.addEventListener("change", ev => {
  const input = ev.target;
  const tipo = input && _INPUT_TIPO[input.id];
  if (!tipo || !input.files || !input.files[0]) return;
  const reg = { archivo: input.files[0].name, inicio: Date.now(), fin: null, estado: "en curso", mensajes: [] };
  CARGAS_SESION[tipo] = reg;
  _cargaActiva = reg;
  _seguirCarga(input, reg);
  _repintarCargas();
}, true);

// Ir a Configuración → Cargas (atajo desde el menú de la barra superior).
export function cfgIrCargas() {
  CONFIG_STATE.section = "cargas";
  document.getElementById("uploadMenu")?.classList.remove("open");
  syncMenusAria();
  if (STATE.curTab === "config") renderConfig(); else switchTab("config");
}

// ── UI HELPERS ────────────────────────────────────────────────────────────────
// I6: el mensaje va por textContent, NUNCA como HTML. Muchos banners llevan
// nombres que vienen de la base o del Excel (partner, KAM, mensajes de error de
// PostgREST que citan valores); con innerHTML un nombre con "<img onerror>"
// era una inyección. Ningún llamador pasa HTML a propósito (verificado con
// grep, 23-sep-2026) — si alguno lo necesitara, que arme su propio nodo.
export function showBanner(ok, msg) {
  if (_cargaActiva) _cargaActiva.mensajes.push({ ok: !!ok, msg: msg == null ? "" : String(msg) });
  const el = document.getElementById("dsBanner");
  if (!el) return;
  el.style.display = "flex";
  el.className = ok ? "ds-banner" : "ds-banner err";
  el.innerHTML = `<span class="ds-dot${ok ? "" : " err"}"></span><span class="${ok ? "agy-style-84" : "agy-style-85"}"></span>`;
  el.lastElementChild.textContent = msg == null ? "" : String(msg);
}

export function showLoad(show, msg = "Procesando...") {
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
      <div class="agy-style-86"></div>`;
    el.lastElementChild.textContent = msg == null ? "" : String(msg);
  } else {
    el?.remove();
  }
}

// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";
// Import explicito (no global): app.ts se evalua antes de que vendor.ts espeje
// los globales, y estas se llaman desde handlers que corren despues — pero el
// import deja la dependencia a la vista, que es el punto.
import { alertBox, btn } from "./shared/ui";
import { alCerrarSesion } from "./shared/sesion";

// I2: la sub-sección, la búsqueda y la página de Configuración son del usuario
// que se fue — el siguiente arranca en "Partners", sin filtro.
alCerrarSesion(() => {
  CONFIG_STATE.page = 0; CONFIG_STATE.search = ""; CONFIG_STATE.kamFilter = "all";
  CONFIG_STATE.section = "partners"; CONFIG_STATE.estado = "todos"; CONFIG_STATE.panel = null;
  CONFIG_STATE.sel.clear();
  for (const k of Object.keys(CARGAS_SESION)) delete CARGAS_SESION[k];
});
import { t, setLang, getLang, aplicarI18nEstatico, selectorIdiomaHTML, kamLabel } from "./core/i18n";
import { SIN_KAM } from "./core/config.js";
import { logAccess } from "./shared/accessLog.js";
import { instalarShell, renderShellNav, renderPageHeader, schedulePageHeader, syncNavActive,
         closeNavDrawer, syncFiltrosAria, syncMenusAria } from "./shell";

// ── i18n de la interfaz ──────────────────────────────────────────────────────
// Se aplica al arrancar (el login tambien esta traducido, no solo la app ya
// logueada) y en cada cambio de idioma. Ademas del HTML estatico hay que
// RE-RENDERIZAR la pestana activa: casi todo el texto se genera desde JS con
// template literals, asi que no basta con repintar los data-i18n.
export function _initUiLang() {
  // El idioma guardado (localStorage) puede no ser el "es" del index.html —
  // ver el comentario en setUiLang sobre la traducción automática.
  try { document.documentElement.lang = getLang(); } catch (_) {}
  const cont = document.getElementById("langSwitch");
  if (cont) cont.innerHTML = selectorIdiomaHTML();
  aplicarI18nEstatico();
}

export function setUiLang(code) {
  if (!setLang(code)) return;
  // Mantener <html lang> en sincronía con el idioma REAL de la interfaz.
  // Sin esto quedaba clavado en "es" del index.html: al pasar a EN/RU, el
  // navegador veía contenido inglés/ruso declarado como español, detectaba el
  // idioma por su cuenta y ofrecía "traducir" — que es de donde salían
  // "Tablero de instrumentos" (Dashboard) y "pruebas de sangre" (Análisis
  // interpretado como análisis clínico).
  try { document.documentElement.lang = code; } catch (_) {}
  const cont = document.getElementById("langSwitch");
  if (cont) cont.innerHTML = selectorIdiomaHTML();
  aplicarI18nEstatico();
  // Re-render de la pestana activa: casi todo el texto se genera con template
  // literals, asi que repintar solo los data-i18n deja el contenido en el idioma
  // anterior. OJO: aca habia `switchTab(STATE.curTab, true)` — switchTab recibe
  // UN solo parametro y ademas corta si el tab no cambia, asi que no repintaba
  // nada; los tres idiomas mostraban el mismo texto. Se usa la primitiva que ya
  // existe para esto.
  // El sidebar NO es parte del panel de la pestana: presets y selects se
  // regeneran por su cuenta, asi que hay que repintarlos aparte (si no, quedan
  // en el idioma anterior — se veia en la captura).
  if (typeof rerenderSidebarPresets === "function") rerenderSidebarPresets();
  if (typeof popSidebarUI === "function") popSidebarUI();
  if (typeof _renderActiveTabAfterLoad === "function") _renderActiveTabAfterLoad();
  else if (STATE.curTab && typeof switchTab === "function") switchTab(STATE.curTab);
  // _renderActiveTabAfterLoad NO cubre Metas ni Seguimiento A PROPOSITO: cuando
  // corre tras la carga inicial, metas/proyectos/seguimiento todavia pueden estar
  // en vuelo. Para un cambio de IDIOMA ese motivo no aplica —los datos ya estan—
  // y sin esto la pestana Metas se quedaba en el idioma anterior o directamente
  // vacia (se veia como "largo: 93" al probar la vista Combinado en ingles).
  if (STATE.curTab === "metas" && STATE.metasData?.length && typeof renderMetas === "function") renderMetas();
  if (STATE.curTab === "seguimiento" && typeof renderSeguimiento === "function") renderSeguimiento();
  if (STATE.curTab === "config" && typeof renderConfig === "function") renderConfig();
  // Estructura (Ola 5): navegación y encabezado se generan desde JS.
  renderShellNav();
  renderPageHeader();
}

registerActions({
  setUiLang: d => setUiLang(d.lang),
  // El selector de idioma pasó de 3 botones-bandera a un <select> (ocupaba
  // ~113px de la barra). El handler de botón se conserva por si algo lo sigue
  // usando; el del select lee el value.
  setUiLangSel: (d, el) => setUiLang(el.value),
  // sidebar / filtros
  setDatePreset: d => setDatePreset(d.preset),
  onKAMChange, selectAll, deselectAll, toggleSidebar,
  switchMode:      d => switchMode(d.mode),
  switchTab:       d => switchTab(d.tab),
  toggleUploadMenu:  (d, el, e) => toggleUploadMenu(e),
  toggleUserMenu:    (d, el, e) => toggleUserMenu(e),
  // Botón del estado de error de un chunk que no cargó (ver switchTab). Limpia
  // el guard para que el recovery de vendor.js pueda volver a intentar.
  reloadApp: () => { try { sessionStorage.removeItem("_chunkReloadOnce"); } catch (e) {} location.reload(); },

  // configuración (el resto de sus acciones vive en configView.ts, que se
  // carga junto con la vista; estas tres se usan desde fuera de ese chunk)
  updateDeclineSettings,
  cfgSetSection: d => { CONFIG_STATE.section = d.section; CONFIG_STATE.panel = null; renderConfig(); },
  cfgIrCargas
});

// Arranca el idioma apenas carga el modulo: la pantalla de LOGIN tambien se
// traduce, no solo la app ya autenticada.
_initUiLang();
// Navegación lateral + listeners de la estructura (Ola 5). Una sola vez.
instalarShell();
