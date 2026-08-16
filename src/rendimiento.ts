//@ts-nocheck
// rendimiento.js — Pestaña Rendimiento

// Núcleo de cálculo compartido (ver domain/metrics.ts).
import { ratio } from "./domain/metrics.js";
import { t } from "./core/i18n";

// ── LÍNEA DE NEGOCIO (Agregador / Fleet / TukTuk / Combinado) ─────────────────
// Localizado a Rendimiento: NO muta STATE.rawData (el agregador queda intacto para
// Metas/Calculadora/etc). Se filtra el slice de la línea con los MISMOS filtros del
// sidebar (ciudad/fecha/partner). Agregador incluye Fleet (Fleet ⊂ Taxi). Combinado
// = Taxi + TukTuk (conjuntos disjuntos: TukTuk se excluye de rawData al cargar, así
// que el concat no double-cuenta). El diario no trae db_id (sin sub-flota) →
// Fleet/TukTuk/Combinado se deshabilitan y cae a Agregador.
export function _rendLine() {
  // Las 4 líneas funcionan en las 3 escalas. El guard que forzaba "agg" en
  // diario existía porque el export diario no traía db_id — dejó de ser cierto
  // (verificado contra la BD el 2026-07-29: las 5.516 filas de la ventana lo
  // tienen), y ahora loadDiarioIfNeeded construye los slices Fleet/TukTuk.
  return STATE.rendLine || "comb";
}
// Dataset completo (todas las fechas) de la línea activa para la escala actual.
// Slice de una línea para la ESCALA ACTIVA. Antes esto era un booleano
// `mensual ? ... : ...`, que en diario caía silenciosamente al slice SEMANAL.
// Ahora las tres escalas tienen sus propios slices (ver loadDiarioIfNeeded).
function _sliceEscala(base) {
  const m = STATE.curMode;
  if (m === "mensual") return STATE["rawDataMensual" + base] || [];
  if (m === "diario")  return STATE["rawDataDiario"  + base] || [];
  return STATE["rawData" + base] || [];
}

export function _rendLineDataset() {
  const line = _rendLine();
  if (line === "agg") return STATE.rawData;
  const tk = _sliceEscala("Tuktuk");
  if (line === "fleet") return _sliceEscala("Fleet");
  if (line === "comb")  return STATE.rawData.concat(tk);
  return tk;
}
// ¿Este partner está incluido en la selección del sidebar?
//
// HISTORIA (importante, tuvo dos versiones incorrectas): los partners solo-TukTuk
// (ej. PIAGGIO) no llegaban al sidebar porque la lista salía del dataset Taxi.
//   v1: `selSet.has(partner)` a secas → nunca aparecían: SUB-conteo.
//   v2: `selSet.has(partner) || !sidebarSet.has(partner)` → aparecían SIEMPRE,
//       incluso al elegir un único partner: SOBRE-conteo (se veía "Perú 145"
//       con un partner de 77 seleccionado, los otros 68 eran PIAGGIO).
// Ninguna de las dos es correcta porque el problema no estaba acá sino en el
// sidebar, que no podía expresar esos partners. Ahora `STATE.sidebarPartners`
// los incluye (ver updateIndexes en data.js), así que la selección alcanza y
// esta función vuelve a ser lo simple que siempre debió ser.
//
// El segundo parámetro se conserva por compatibilidad con los call sites y como
// red de seguridad: si algún partner quedara fuera del sidebar por un camino no
// previsto, se lo sigue incluyendo (preferimos sobre-contar visiblemente antes
// que perder data en silencio).
export function _lineSelHas(selSet, sidebarSet, partner) {
  if (selSet.has(partner)) return true;
  return !!sidebarSet && !sidebarSet.has(partner);
}

// KAM efectivo de una fila. `partners`/`flotas` mandan (getKAMForPartner); el KAM
// que vino en el Excel es solo fallback.
export function _lineKamOf(row) {
  const k = (typeof getKAMForPartner === "function" && getKAMForPartner(row.partner)) || "";
  return k || row.kam || "";
}

// Filas de la línea filtradas por ciudad/fecha/partner/KAM (espeja getFiltered()).
//
// OJO con el filtro de KAM — acá había un sobreconteo real: en Agregador el KAM se
// aplica indirectamente (onKAMChange marca/desmarca los checkboxes del sidebar, así
// que `selected` ya viene acotado), pero los partners solo-TukTuk NO están en el
// sidebar y `_lineSelHas` los da por incluidos SIEMPRE. Resultado: al filtrar por un
// KAM en TukTuk/Combinado se colaban los partners solo-TukTuk de TODOS los demás
// KAMs, inflando los totales. Por eso el KAM se filtra acá de forma EXPLÍCITA en vez
// de confiar en la selección del sidebar.
export function _rendLineFiltered() {
  if (_rendLine() === "agg") return getFiltered();
  const f = getCurrentFilters();
  const selSet = new Set(f.selected);
  const sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  return _rendLineDataset().filter(r =>
    (f.city === "all" || r.city === f.city) &&
    r.date >= f.from && r.date <= f.to &&
    (f.kam === "all" || _lineKamOf(r) === f.kam) &&
    _lineSelHas(selSet, sidebar, r.partner)
  );
}
// Filas de prevDate (fuera del rango) para la línea. Agregador usa el índice _byDate;
// Fleet/TukTuk filtran su slice (arrays pequeños, sin índice dedicado).
// El KAM se aplica por el mismo motivo que arriba: si no, el período anterior de la
// comparación WoW incluiría partners que el período actual ya excluyó → un WoW que
// compara dos universos distintos y siempre da caída.
export function _rendLinePrev(prevDate, city) {
  if (!prevDate) return [];
  if (_rendLine() === "agg") {
    const base = (STATE._byDate && STATE._byDate.get(prevDate))
      || STATE.rawData.filter(r => r.date === prevDate);
    return city ? base.filter(r => r.city === city) : base;
  }
  const kam = (getCurrentFilters().kam) || "all";
  return _rendLineDataset().filter(r =>
    r.date === prevDate &&
    (!city || r.city === city) &&
    (kam === "all" || _lineKamOf(r) === kam)
  );
}

// Barra segmentada de línea de negocio (reusa .mode-toggle-row/.mode-btn del selector
// de escala). En diario, Fleet/TukTuk quedan deshabilitados (sin datos por sub-flota).
// Etiqueta del periodo del snapshot, segun la escala activa. Vive suelto porque
// la usan renderRend Y mkMetricCard, y esta ultima NO recibe periodLabel por
// parametro: referenciarlo ahi habria sido un ReferenceError en runtime que
// @ts-nocheck no marca (encontrado al revisar el ambito, antes de que llegara al
// navegador).
export function _rendPeriodLabel() {
  return STATE.curMode === "mensual" ? t("rend.per.ultimoMes")
       : STATE.curMode === "diario"  ? t("rend.per.ultimoDia")
       : t("rend.per.ultimaSemana");
}

export function rendLineToggleHTML() {
  const line   = _rendLine();
  const diario = false;   // las 4 líneas ya funcionan en las 3 escalas
  const defs = [
    { k: "comb",  emoji: "🔀", label: t("rend.linea.comb"), tip: t("rend.linea.combTip") },
    { k: "agg",   emoji: "📊", label: t("rend.linea.agg"),  tip: t("rend.linea.aggTip") },
    { k: "fleet", emoji: "🚗", label: "Fleet",              tip: t("rend.linea.fleetTip") },
    { k: "tk",    emoji: "🛺", label: "TukTuk",             tip: t("rend.linea.tkTip") }
  ];
  const btns = defs.map(d => {
    const on  = line === d.k;
    const dis = diario && d.k !== "agg";
    return `<button class="mode-btn${on ? " active" : ""}" ${dis ? "disabled" : ""}
      title="${dis ? "Sin datos diarios por sub-flota — usa escala semanal o mensual" : escapeHTML(d.tip)}"
      ${dis ? "" : `data-act="setRendLine" data-line="${escapeHTML(d.k)}"`}
      style="${dis ? "opacity:.4;cursor:not-allowed" : ""}">${d.emoji} ${d.label}</button>`;
  }).join("");
  const note = diario
    ? `<span class="agy-style-213">Fleet/TukTuk/Combinado requieren escala semanal o mensual (el diario no trae sub-flota)</span>`
    : "";
  return `<div class="mode-toggle-row agy-style-214">${btns}${note}</div>`;
}
export async function setRendLine(line) {
  if ((STATE.rendLine || "comb") === line) return;
  STATE.rendLine = line;
  // El scorecard "Fleet · Calidad y Dependencia" lee 6 columnas que el arranque
  // NO pide (ver TX_DEFERRED_COLS). Sin esperarlas, la tarjeta se pintaría con
  // ceros — que no se distinguen de un negocio con 0% de fraude. La precarga en
  // idle suele haberlas traído ya, así que en la práctica esto no espera nada.
  if (line === "fleet" && typeof ensureFullRendColumns === "function") {
    try { await ensureFullRendColumns(); } catch (e) { /* nunca bloquear el render */ }
    if ((STATE.rendLine || "comb") !== line) return;   // el usuario ya cambió de línea
  }
  renderRend();
}

// Guard de reentrancia: evita que dos renderRend() concurrentes se pisen.
// Si llega un segundo render mientras el primero corre, se descarta.
export let _renderRendBusy  = false;
// Token incremental: la cola de charts diferidos verifica este token. Si llega
// un nuevo renderRend, el pump de charts del render anterior se aborta.
export let _renderRendToken = 0;

export function renderRend() {
  if (_renderRendBusy) return;
  if (!STATE.rawData.length) return;
  _renderRendBusy  = true;
  _renderRendToken++;
  try {
    _renderRendImpl();
  } finally {
    _renderRendBusy = false;
  }
}

export function _renderRendImpl() {
  // Garantiza índices secundarios construidos (defensivo contra cache/races)
  ensureIndexes();

  // Destruir charts existentes ANTES de borrar sus DIVs con innerHTML
  // (evita instancias huérfanas y memory leak en cada re-render)
  destroyAllCharts();

  const line      = _rendLine();
  const filtered  = _rendLineFiltered();
  const apd       = aggPDc(filtered);
  const byDate    = aggDatec(filtered);
  const dates     = [...new Set(apd.map(r => r.date))].sort();
  const partners  = getSel();
  const empty     = document.getElementById("rendEmpty");
  const content   = document.getElementById("rendContent");

  // Sin partners seleccionados → empty global (mensaje de carga: aún no hay data en
  // memoria, o el usuario deschequeó todo).
  if (!partners.length) {
    empty.style.display   = "";
    content.style.display = "none";
    return;
  }
  // Agregador con partners seleccionados pero 0 filas en el filtro actual: NO es "falta
  // cargar data" (el empty global mentiría) — casi siempre Ciudad+KAM/partners sin overlap
  // (ej. Ciudad=Arequipa + KAM cuyos partners solo operan en Lima). Mensaje inline nombrando
  // la combinación exacta, mismo patrón que el empty de Fleet/TukTuk de abajo.
  if (!filtered.length && line === "agg") {
    empty.style.display   = "none";
    content.style.display = "";
    const f       = getCurrentFilters();
    const kamLbl  = f.kam  !== "all" ? ` de <strong>${escapeHTML(f.kam)}</strong>` : "";
    const cityLbl = f.city !== "all" ? ` en <strong>${cityLabel(f.city)}</strong>` : "";
    content.innerHTML = rendLineToggleHTML() +
      `<div class="section"><div class="agy-style-266">
        No hay partners${kamLbl} con datos${cityLbl} en el rango de fechas seleccionado.<br>
        La data SÍ está cargada — esta combinación de filtros no tiene overlap. Ajusta ciudad, KAM, fechas o partners.
      </div></div>`;
    return;
  }
  // Fleet/TukTuk sin datos para el filtro: mantener el toggle visible (para volver a
  // Agregador) + empty inline. NO usar el empty global (dejaría al usuario atrapado).
  if (!filtered.length) {
    empty.style.display   = "none";
    content.style.display = "";
    const lname = line === "fleet" ? "Fleet" : line === "comb" ? "Combinado (Taxi+TukTuk)" : "TukTuk";
    content.innerHTML = rendLineToggleHTML() +
      `<div class="section"><div class="agy-style-266">
        No hay datos de <strong>${lname}</strong> para el filtro actual.<br>
        Cambia a <strong>📊 Agregador</strong> o ajusta ciudad / fechas / partners.
      </div></div>`;
    return;
  }
  empty.style.display   = "none";
  content.style.display = "";

  // Cachear filtered por ciudad (se usa 3 veces: secciones 2, 4 y los charts)
  const filteredByCity = {};
  CITIES.forEach(city => {
    filteredByCity[city] = filtered.filter(r => r.city === city);
  });

  // lastDate = fecha "Hasta" del filtro
  const toDate   = document.getElementById("dateTo").value;
  const lastDate = dates.filter(d => d <= toDate).slice(-1)[0] || dates[dates.length - 1] || "";

  // prevDate = semana inmediatamente anterior a lastDate en TODOS los datos
  const allDates = STATE.allDates;
  const lastIdx  = allDates.indexOf(lastDate);
  const prevDate = lastIdx > 0 ? allDates[lastIdx - 1] : "";

  // prevRows: datos de prevDate fuera del rango filtrado
  const cityFilter = document.getElementById("cityFilter").value;
  const selSet     = new Set(getSel());
  const _sidebarSet = new Set(STATE.sidebarPartners || STATE.allPartners);
  // Lookup de la línea activa (agg usa _byDate; fleet/tk/comb filtran su slice).
  const _prevAll = _rendLinePrev(prevDate, null);
  const prevFiltered = _prevAll.filter(r =>
    (cityFilter === "all" || r.city === cityFilter) &&
    _lineSelHas(selSet, _sidebarSet, r.partner)
  );
  const prevAPD = aggPD(prevFiltered);

  // Fleet: vista SOLO de KPIs de flota (columnas fleet-scoped). El AD/SH/N+R a nivel
  // fleetroom mezcla actividad agregador+fleet del MISMO fleetroom → sería un falso
  // negativo. Solo se muestran owned cars / SH-auto interno / aceptación / branded,
  // que sí son columnas propias de la sub-flota. Se corta antes de las secciones
  // genéricas y del pump de charts.
  if (line === "fleet") {
    const fLastRows = filtered.filter(r => r.date === lastDate);
    content.innerHTML = _renderFleetView(fLastRows, prevFiltered, lastDate, prevDate);
    _scheduleFleetCharts(filtered, dates, fLastRows);
    return;
  }

  const lastRows = apd.filter(r => r.date === lastDate);
  const prevRows = prevAPD;

  const tAD = sumR(lastRows, r => r.activeDrivers);
  const pAD = sumR(prevRows, r => r.activeDrivers);
  const tNR = sumR(apd,      r => r.newPartner + r.newService + r.reactivated);
  const lNR = sumR(lastRows, r => r.newPartner + r.newService + r.reactivated);
  const pNR = sumR(prevRows, r => r.newPartner + r.newService + r.reactivated);
  const tSH = sumR(apd,      r => r.supplyHours);
  const lSH = sumR(lastRows, r => r.supplyHours);
  const pSH = sumR(prevRows, r => r.supplyHours);
  const tTR = sumR(apd,      r => r.trips || 0);
  const lTR = sumR(lastRows, r => r.trips || 0);
  const pTR = sumR(prevRows, r => r.trips || 0);

  let html = rendLineToggleHTML();

  // ── 1. Peru General ────────────────────────────────────────────────────────
  // Subtitulo segun modo: en diario/semanal/mensual contextualiza el dato
  const periodLabel = _rendPeriodLabel();
  html += secH("🇵🇪", "#FF0000",
    t("rend.peru.titulo"),
    t("rend.peru.sub", { p: periodLabel }),
    d2s(lastDate));
  html += `<div class="section"><div class="metric-row">
    ${mkMetricCard(t("metric.ad.label"),"📊",tAD,pAD,apd,lastRows,prevRows,"ad",METRICS.ad.color,false)}
    ${mkMetricCard(t("metric.nr.label"),"🆕",tNR,lNR,apd,lastRows,prevRows,"nr",METRICS.nr.color,true)}
    ${mkMetricCard(t("metric.sh.label"),"⏱️",tSH,lSH,apd,lastRows,prevRows,"sh",METRICS.sh.color,true)}
    ${mkMetricCard(t("metric.tr.label"),"🚕",tTR,lTR,apd,lastRows,prevRows,"tr",METRICS.tr.color,true)}
  </div></div>`;

  // ── 1b. KPIs propios de TukTuk (Fleet tiene su vista dedicada arriba) ───────
  if (line === "tk") {
    html += _rendTkKPIs(filtered.filter(r => r.date === lastDate), prevFiltered);
  }

  // ── 2. Por Ciudad ──────────────────────────────────────────────────────────
  html += secH("🏙️", "#06b6d4", t("rend.ciudad.titulo"), t("rend.ciudad.sub"), "");
  html += `<div class="section"><div class="city-grid">`;
  CITIES.forEach(city => {
    const cr = filteredByCity[city];
    if (!cr.length) return;
    const ca   = aggPD(cr);
    const cL   = ca.filter(r => r.date === lastDate);
    // prevDate para ciudad, según la línea activa (agg usa índice; fleet/tk/comb su slice)
    const _cPrev = _rendLinePrev(prevDate, city);
    const cPraw = _cPrev.filter(r => _lineSelHas(selSet, _sidebarSet, r.partner));
    const cP   = aggPD(cPraw);
    const cAD  = sumR(cL,  r => r.activeDrivers);
    const cNR  = sumR(cL,  r => r.newPartner + r.newService + r.reactivated);
    const cSH  = sumR(cL,  r => r.supplyHours);
    const cTR  = sumR(cL,  r => r.trips || 0);
    const cpAD = sumR(cP,  r => r.activeDrivers);
    const cpNR = sumR(cP,  r => r.newPartner + r.newService + r.reactivated);
    const cpSH = sumR(cP,  r => r.supplyHours);
    const cpTR = sumR(cP,  r => r.trips || 0);
    const col  = CITY_COLORS[city] || "#888";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${cityLabel(city)}
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">${escapeHTML(t("metric.ad.label"))}</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmt(cAD)}</span>${bdgMode(cAD,cpAD,"mb-badge")}</div>
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">${escapeHTML(t("metric.nr.label"))}</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmt(cNR)}</span>${bdgMode(cNR,cpNR,"mb-badge")}</div>
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">${escapeHTML(t("metric.sh.label"))}</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmt(cSH)}</span>${bdgMode(cSH,cpSH,"mb-badge")}</div>
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">${t("metric.tr.label")}</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmtSmart(cTR)}</span>${bdgMode(cTR,cpTR,"mb-badge")}</div>
        </div>
      </div>`;
  });
  html += `</div></div>`;

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  html += secH("👤", "#f59e0b", t("rend.kam.titulo"), t("rend.kam.sub"), "");
  html += `<div class="section"><div class="agy-style-524">`;
  // Respetar kamFilter: si el usuario filtra por un KAM, solo mostrar ese
  const kamFilterVal = document.getElementById("kamFilter")?.value || "all";
  const kamsToShow = [...new Set(Object.values(STATE.KAM_MAP))]
    .filter(k => kamFilterVal === "all" || k === kamFilterVal)
    .sort();
  kamsToShow.forEach(kam => {
    const kpSet = new Set(STATE.KAM_PARTNERS[kam] || []);
    const kL  = lastRows.filter(r => kpSet.has(r.partner));
    const kP  = prevRows.filter(r => kpSet.has(r.partner));
    if (!kL.length) return;
    const kAD  = sumR(kL, r => r.activeDrivers);
    const kNR  = sumR(kL, r => r.newPartner + r.newService + r.reactivated);
    const kSH  = sumR(kL, r => r.supplyHours);
    const kTR  = sumR(kL, r => r.trips || 0);
    const kpAD = sumR(kP, r => r.activeDrivers);
    const kpNR = sumR(kP, r => r.newPartner + r.newService + r.reactivated);
    const kpTR = sumR(kP, r => r.trips || 0);
    const col  = KAM_COLORS[kam] || "#888";
    html += `
      <div class="mcard" style="border-left:3px solid ${col}">
        <div class="mcard-label"><span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block"></span> ${escapeHTML(kam)}</div>
        <div class="mcard-val">${fmt(kAD)}</div>
        <div>${bdgMode(kAD,kpAD)} <span class="agy-style-525">${escapeHTML(t("rend.lbl.activos"))}</span></div>
        <div class="mcard-breakdown">
          <div class="mb-row"><span class="mb-name">N+R</span><span class="mb-val">${fmt(kNR)}</span>${bdgMode(kNR,kpNR,"mb-badge")}</div>
          <div class="mb-row"><span class="mb-name">${escapeHTML(t("metric.sh.short"))}</span><span class="mb-val">${fmt(kSH)}</span></div>
          <div class="mb-row"><span class="mb-name">${t("metric.tr.short")}</span><span class="mb-val">${fmtSmart(kTR)}</span>${bdgMode(kTR,kpTR,"mb-badge")}</div>
        </div>
      </div>`;
  });
  html += `</div></div>`;

  // ── 4. Tendencias ─────────────────────────────────────────────────────────
  html += secH("📈", "#10b981", t("rend.tend.titulo"),
    t("rend.tend.sub"), "");
  html += `<div class="section">`;
  html += `<div class="agy-style-526">${escapeHTML(t("rend.tend.peruTotal"))}</div>`;
  html += `<div class="agy-style-527">
    <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(t("rend.ch.condActivos"))}</span><button class="png-btn" data-act="dlChart" data-chart="chP_ad" data-name="AD_Peru">PNG</button></div><div id="chP_ad"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(t("rend.ch.nuevosReact"))}</span><button class="png-btn" data-act="dlChart" data-chart="chP_nr" data-name="NR_Peru">PNG</button></div><div id="chP_nr"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(t("metric.sh.label"))}</span><button class="png-btn" data-act="dlChart" data-chart="chP_sh" data-name="SH_Peru">PNG</button></div><div id="chP_sh"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">${t("metric.tr.label")}</span><button class="png-btn" data-act="dlChart" data-chart="chP_tr" data-name="Viajes_Peru">PNG</button></div><div id="chP_tr"></div></div>
  </div>`;

  // Comparativa entre ciudades: UNA gráfica por métrica con una línea por ciudad.
  //
  // Antes había 4 gráficas POR CIUDAD (12 con 3 ciudades, 16 en total con las de
  // Perú). Cada render de ApexCharts bloquea 30-80ms, así que eran ~800ms de hilo
  // principal, y encima obligaba a hacer scroll y memorizar para comparar dos
  // ciudades. Consolidado: 8 gráficas en total, y la comparación se lee de una.
  const citiesWithData = CITIES.filter(c => (filteredByCity[c] || []).length);
  if (citiesWithData.length) {
    html += `<div class="agy-style-526" style="margin-top:18px">Comparativa por ciudad</div>`;
    html += `<div class="agy-style-527">
      <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(t("rend.ch.condActivos"))}</span><button class="png-btn" data-act="dlChart" data-chart="chC_ad" data-name="AD_Ciudades">PNG</button></div><div id="chC_ad"></div></div>
      <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(t("rend.ch.nuevosReact"))}</span><button class="png-btn" data-act="dlChart" data-chart="chC_nr" data-name="NR_Ciudades">PNG</button></div><div id="chC_nr"></div></div>
      <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(t("metric.sh.label"))}</span><button class="png-btn" data-act="dlChart" data-chart="chC_sh" data-name="SH_Ciudades">PNG</button></div><div id="chC_sh"></div></div>
      <div class="chart-card"><div class="chart-head"><span class="chart-title">${t("metric.tr.label")}</span><button class="png-btn" data-act="dlChart" data-chart="chC_tr" data-name="Viajes_Ciudades">PNG</button></div><div id="chC_tr"></div></div>
    </div>`;
  }
  html += `</div>`;

  // ── 4b. Productividad ─────────────────────────────────────────────────────
  // Ratios, no volúmenes: responden "¿cada conductor rinde más o menos?", que es
  // una pregunta distinta de "¿tenemos más conductores?". Un mes puede crecer en
  // AD y caer en horas por conductor — sin estos ratios eso pasa desapercibido.
  const prodOf = rs => {
    const ad = sumR(rs, r => r.activeDrivers), sh = sumR(rs, r => r.supplyHours), tr = sumR(rs, r => r.trips || 0);
    return { shAd: ratio(sh, ad), trAd: ratio(tr, ad), trSh: ratio(tr, sh) };
  };
  const pNow = prodOf(lastRows), pPrev = prodOf(prevRows);
  html += secH("⚡", "#eab308", t("rend.prod.titulo"),
    t("rend.prod.sub", { d: d2s(lastDate) }), "");
  html += `<div class="section"><div class="metric-row">
    ${_rendKpiCard(t("rend.kpi.horasCond"), "⏱️", pNow.shAd, pPrev.shAd, "#8b5cf6", v => fmt(v))}
    ${_rendKpiCard(t("rend.kpi.viajesCond"), "🚕", pNow.trAd, pPrev.trAd, "#0ea5e9", v => fmt(v))}
    ${_rendKpiCard(t("rend.kpi.viajesHora"), "📐", pNow.trSh, pPrev.trSh, "#10b981", v => v.toFixed(2))}
  </div></div>`;

  // ── 4c. Quién se movió ────────────────────────────────────────────────────
  // El KAM no necesita leer 60 filas para saber a quién llamar: acá salen los 5
  // que más subieron y los 5 que más cayeron en Conductores Activos vs el
  // período anterior. Se excluyen los partners sin base previa (no es una caída,
  // es que no había con qué comparar).
  const prevByPartner = new Map();
  prevRows.forEach(r => prevByPartner.set(r.partner, (prevByPartner.get(r.partner) || 0) + r.activeDrivers));
  const movers = lastRows.map(r => {
    const prev = prevByPartner.get(r.partner) || 0;
    return { partner: r.partner, now: r.activeDrivers, prev, delta: r.activeDrivers - prev,
             pct: prev > 0 ? ((r.activeDrivers - prev) / prev) * 100 : null };
  }).filter(m => m.pct != null);
  const suben = movers.slice().sort((a, b) => b.delta - a.delta).filter(m => m.delta > 0).slice(0, 5);
  const bajan = movers.slice().sort((a, b) => a.delta - b.delta).filter(m => m.delta < 0).slice(0, 5);
  if (suben.length || bajan.length) {
    const lista = (items, color, signo) => items.length
      ? items.map(m => `<div class="agy-style-247">
          <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${STATE.partnerColors[m.partner] || "#ccc"};margin-right:5px"></span>${escapeHTML(m.partner)}</span>
          <span><strong style="color:${color}">${signo}${fmt(Math.abs(m.delta))}</strong>
            <span class="agy-style-90" style="margin-left:5px">${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(1)}%</span></span>
        </div>`).join("")
      : `<div class="agy-style-90" style="font-size:.76rem;padding:6px 0">${escapeHTML(t("rend.mov.sinMov"))}</div>`;
    html += secH("↕️", "#ec4899", t("rend.mov.titulo"),
      t("rend.mov.sub", { d: prevDate ? d2s(prevDate) : t("rend.per.periodoAnterior") }), "");
    html += `<div class="section"><div class="city-grid">
      <div class="city-card" style="border-top-color:#10b981">
        <div class="city-name">${escapeHTML(t("rend.mov.suben"))}</div>${lista(suben, "#10b981", "+")}
      </div>
      <div class="city-card" style="border-top-color:#ef4444">
        <div class="city-name">${escapeHTML(t("rend.mov.bajan"))}</div>${lista(bajan, "#ef4444", "−")}
      </div>
    </div></div>`;
  }

  // ── 5. Tabla ───────────────────────────────────────────────────────────────
  // Resumen de leads Yango para el encabezado
  const leadsSet  = new Set(apd.filter(r => r.date === lastDate && r.newService > 0).map(r => r.partner));
  const leadsNote = leadsSet.size > 0
    ? `<div class="leads-summary">★ ${leadsSet.size} partner${leadsSet.size > 1 ? "s reciben" : " recibe"} leads de Yango esta semana</div>`
    : "";
  html += secH("📋", "#6366f1", t("rend.tabla.titulo"), t("rend.tabla.sub"), "");
  html += `<div class="section">${leadsNote}<div class="tbl-wrap"><div id="tblContainer"></div></div></div>`;

  // ── 6. Tarjetas por Partner ────────────────────────────────────────────────
  html += secH("🃏", "#FF0000", t("rend.cards.titulo"), t("rend.cards.sub"), "");
  html += `<div class="section"><div class="partner-grid" id="partnerCards"></div></div>`;

  content.innerHTML = html;

  // Renders sincronos de tablas (datos, no charts) — relativamente baratos
  buildTable(apd, lastDate, prevDate, partners);
  buildPartnerCards(apd, lastDate, prevDate, partners, partners);

  // ── DIFERIR CHARTS con RAF ─────────────────────────────────────────────────
  // Cada ApexCharts.render() bloquea 30-80ms. Construir 12 en serie congela
  // el main thread ~600ms. Yieldeando entre cada uno: la UI aparece instantanea
  // y los charts pop-in progresivamente sin freezar inputs/scroll del usuario.
  const tokenAtSchedule = _renderRendToken;
  const tabTokenAtSched = STATE._tabRenderId;
  const chartJobs = [
    () => buildMultiLine("chP_ad", dates, partners, byDate, "ad", "#FF0000"),
    () => buildMultiLine("chP_nr", dates, partners, byDate, "nr", "#f97316"),
    () => buildMultiLine("chP_sh", dates, partners, byDate, "sh", "#8b5cf6"),
    () => buildMultiLine("chP_tr", dates, partners, byDate, "tr", METRICS.tr.color),
  ];
  // Una gráfica por métrica con una serie por ciudad (ver el comentario en la
  // sección Tendencias): 4 renders en vez de 4 × nº de ciudades.
  const cityCols = citiesWithData.map(c => CITY_COLORS[c] || "#888");
  const cityByDateAll = citiesWithData.map(c => aggCityDatec(filteredByCity[c], c));
  [["chC_ad", "ad"], ["chC_nr", "nr"], ["chC_sh", "sh"], ["chC_tr", "tr"]].forEach(([elId, metric]) => {
    chartJobs.push(() => buildLineChart(elId, dates,
      citiesWithData.map((c, i) => ({
        name: cityLabel(c),
        data: dates.map(d => (cityByDateAll[i][d] || {})[metric] || 0)
      })), cityCols));
  });

  function pumpCharts(i) {
    if (i >= chartJobs.length) return;
    // Abort si otro renderRend arranco, cambio el tab, o salio de "rend"
    if (_renderRendToken !== tokenAtSchedule)   return;
    if (STATE._tabRenderId !== tabTokenAtSched) return;
    if (STATE.curTab !== "rend")                return;
    try { chartJobs[i](); } catch(e) { console.warn("Chart job", i, "failed:", e); }
    requestAnimationFrame(() => pumpCharts(i + 1));
  }
  requestAnimationFrame(() => pumpCharts(0));
}

// ── METRIC CARD ───────────────────────────────────────────────────────────────
export function mkMetricCard(label, icon, val, prevWk, apd, lastRows, prevRows, metric, color, isCum) {
  function gv(rows) {
    if (metric === "nr") return sumR(rows, r => r.newPartner + r.newService + r.reactivated);
    if (metric === "sh") return sumR(rows, r => r.supplyHours);
    if (metric === "tr") return sumR(rows, r => r.trips || 0);
    return sumR(rows, r => r.activeDrivers);
  }
  const lwVal = gv(lastRows);
  const pwVal = gv(prevRows);

  let html = `
    <div class="mcard" style="border-top:3px solid ${color}">
      <div class="mcard-label">${icon} ${label}</div>
      <div class="mcard-sub-label">${escapeHTML(isCum ? t("rend.lbl.acumRango") : _rendPeriodLabel())}</div>
      <div class="mcard-val">${fmt(val)}</div>
      <div class="agy-style-257">${bdgMode(lwVal, pwVal)}
        <span class="agy-style-258">${escapeHTML(t("rend.cmp.vs", { p: STATE.curMode === "mensual" ? t("rend.cmp.mesAnterior") : STATE.curMode === "diario" ? t("rend.cmp.diaAnterior") : t("rend.cmp.semAnterior") }))}</span>
      </div>
      <div class="mcard-breakdown">`;

  [...new Set(Object.values(STATE.KAM_MAP))].sort().forEach(kam => {
    const kpSet = new Set(STATE.KAM_PARTNERS[kam] || []);
    const kl   = lastRows.filter(r => kpSet.has(r.partner));
    const kAll = apd.filter(r => kpSet.has(r.partner));
    const kpr  = prevRows.filter(r => kpSet.has(r.partner));
    if (!kl.length && !kAll.length) return;
    const kv  = gv(kl, kAll);
    const kpv = gv(kpr, kpr);
    if (!kv) return;
    const dot = KAM_COLORS[kam] || "#888";
    html += `<div class="mb-row">
      <span class="mb-name"><span class="mb-dot" style="background:${dot}"></span>${escapeHTML(kam)}</span>
      <span class="mb-val">${fmt(kv)}</span>${bdgMode(kv, kpv, "mb-badge")}
    </div>`;
  });

  html += `</div></div>`;
  return html;
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
export function buildTable(apd, lastDate, prevDate, sel) {
  const selSet = new Set(sel);
  const lR    = apd.filter(r => r.date === lastDate);
  const _pAll = _rendLinePrev(prevDate, null);
  const pRraw = _pAll.filter(r => selSet.has(r.partner));
  const pR    = aggPD(pRraw);
  // Historia completa (todas las fechas) para detectar declive, ignorando el rango.
  // Agregador cachea en STATE._apdFull; Fleet/TukTuk recomputan del slice (arrays chicos).
  let apdFullBase;
  if (_rendLine() === "agg") {
    if (!STATE._apdFull) STATE._apdFull = aggPD(STATE.rawData);
    apdFullBase = STATE._apdFull;
  } else {
    apdFullBase = aggPD(_rendLineDataset());
  }
  const apdFull = apdFullBase.filter(r => selSet.has(r.partner));
  const partners = [...new Set(apd.map(r => r.partner))];

  // Pre-indexar lR, pR y apd por partner UNA vez. Reemplaza 3 filter()
  // O(n) por partner = O(n × partners) → O(1) lookup por partner.
  const lByPartner    = new Map();
  const prByPartner   = new Map();
  const apdByPartner  = new Map();
  const apdFullByPartner = new Map();
  lR.forEach(r => {
    let a = lByPartner.get(r.partner);
    if (!a) { a = []; lByPartner.set(r.partner, a); }
    a.push(r);
  });
  pR.forEach(r => {
    let a = prByPartner.get(r.partner);
    if (!a) { a = []; prByPartner.set(r.partner, a); }
    a.push(r);
  });
  apd.forEach(r => {
    let a = apdByPartner.get(r.partner);
    if (!a) { a = []; apdByPartner.set(r.partner, a); }
    a.push(r);
  });
  apdFull.forEach(r => {
    let a = apdFullByPartner.get(r.partner);
    if (!a) { a = []; apdFullByPartner.set(r.partner, a); }
    a.push(r);
  });

  STATE.curSummaries = partners.map(p => {
    const l    = lByPartner.get(p) || [];
    const pr   = prByPartner.get(p) || [];
    const rows = (apdByPartner.get(p) || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    return {
      partner:      p,
      kam:          (l[0] || {}).kam || "",
      ad:           sumR(l,  r => r.activeDrivers),
      nr:           sumR(l,  r => r.newPartner + r.newService + r.reactivated),
      sh:           sumR(l,  r => r.supplyHours),
      tr:           sumR(l,  r => r.trips || 0),
      co:           sumR(l,  r => r.commission),
      ns:           sumR(l,  r => r.newService),
      pad:          sumR(pr, r => r.activeDrivers),
      pnr:          sumR(pr, r => r.newPartner + r.newService + r.reactivated),
      ptr:          sumR(pr, r => r.trips || 0),
      tAD:          trendI(rows.map(r => r.activeDrivers)),
      declineAlert: hasConsecutiveDecline(apdFullByPartner, p)
    };
  });
  renderTable();
}

export function renderTable() {
  const sorted = STATE.curSummaries.slice().sort((a, b) => {
    const va = a[STATE.tblSort.col], vb = b[STATE.tblSort.col];
    if (typeof va === "string")
      return STATE.tblSort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return STATE.tblSort.dir === "asc" ? va - vb : vb - va;
  });

  const cols = [
    { k: "partner", l: t("rend.col.partner") }, { k: "kam", l: t("sidebar.kam") },
    { k: "ad", l: t("metric.ad.short") },       { k: "nr", l: t("metric.nr.short") },
    { k: "sh", l: t("metric.sh.short") },       { k: "tr", l: t("metric.tr.short") },
    { k: "co", l: t("rend.col.comision") },     { k: "ns", l: t("rend.col.leads") }
  ];

  let h = `<table class="dtbl"><thead><tr>`;
  cols.forEach(c => {
    const s = STATE.tblSort.col === c.k ? (STATE.tblSort.dir === "asc" ? "sa" : "sd") : "";
    h += `<th class="${s}" data-act="sortTbl" data-col="${escapeHTML(c.k)}">${c.l}</th>`;
  });
  h += `<th>WoW</th><th>Tend.</th></tr></thead><tbody>`;

  sorted.forEach(r => {
    const pd      = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${STATE.partnerColors[r.partner]||"#ccc"};margin-right:5px"></span>`;
    const kd      = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${KAM_COLORS[r.kam]||"#ccc"};margin-right:4px"></span>`;
    const alertBd = r.declineAlert
      ? `<span class="decline-badge" title="Declive ${STATE.declineThreshold} períodos consecutivos (${STATE.declineMetric === 'activeDrivers' ? 'Activos' : STATE.declineMetric === 'supplyHours' ? 'Horas' : 'N+R'})">⚠</span>`
      : "";
    const nsCell  = r.ns > 0
      ? `<span class="leads-badge" title="Recibe leads de Yango">★ ${fmt(r.ns)}</span>`
      : `<span class="agy-style-90">${fmt(r.ns)}</span>`;
    h += `<tr data-partner="${escapeHTML(r.partner)}"${r.ns > 0 ? ' class="leads-row"' : ""}>
      <td>${pd}${alertBd}${escapeHTML(r.partner)}</td><td>${kd}${escapeHTML(r.kam)}</td>
      <td class="tn">${fmt(r.ad)}</td><td class="tn">${fmt(r.nr)}</td>
      <td class="tn">${fmt(r.sh)}</td><td class="tn">${fmtSmart(r.tr)}</td>
      <td class="tn">${fmtK(r.co)}</td>
      <td class="tn">${nsCell}</td>
      <td class="tn">${bdgMode(r.ad, r.pad, "tbadge")}</td>
      <td class="agy-style-528"><span style="${r.tAD.c}">${r.tAD.i}</span></td>
    </tr>`;
  });
  h += `</tbody></table>`;
  const el = document.getElementById("tblContainer");
  if (el) el.innerHTML = h;
}

export function sortTbl(col) {
  if (STATE.tblSort.col === col)
    STATE.tblSort.dir = STATE.tblSort.dir === "asc" ? "desc" : "asc";
  else { STATE.tblSort.col = col; STATE.tblSort.dir = "desc"; }

  // Intentar reordenar filas existentes sin reconstruir el HTML
  const tbody = document.querySelector("#tblContainer tbody");
  if (!tbody || !STATE.curSummaries.length) { renderTable(); return; }

  const dir = STATE.tblSort.dir === "asc" ? 1 : -1;
  const k   = STATE.tblSort.col;
  const sorted = STATE.curSummaries.slice().sort((a, b) => {
    const av = a[k], bv = b[k];
    return (typeof av === "string" ? av.localeCompare(bv) : (av - bv)) * dir;
  });

  // Actualizar indicadores de orden en cabeceras
  // Mismo orden que `cols` en renderTable: se mapea por ÍNDICE de <th>.
  const colKeys = ["partner","kam","ad","nr","sh","tr","co","ns"];
  document.querySelectorAll("#tblContainer th").forEach((th, i) => {
    if (i < colKeys.length) {
      th.className = STATE.tblSort.col === colKeys[i]
        ? (STATE.tblSort.dir === "asc" ? "sa" : "sd") : "";
    }
  });

  // Reordenar <tr> existentes vía DocumentFragment (cero re-parse de HTML)
  const rowMap = new Map(
    [...tbody.querySelectorAll("tr")].map(tr => [tr.dataset.partner, tr])
  );
  const frag = document.createDocumentFragment();
  sorted.forEach(s => { const tr = rowMap.get(s.partner); if (tr) frag.appendChild(tr); });
  tbody.appendChild(frag);
}

// ── PARTNER CARDS ─────────────────────────────────────────────────────────────
export function buildPartnerCards(apd, lastDate, prevDate, partners, sel) {
  const grid = document.getElementById("partnerCards");
  if (!grid) return;

  const selSet  = new Set(sel);
  const _pdAll = _rendLinePrev(prevDate, null);
  const prevRaw = _pdAll.filter(r => selSet.has(r.partner));
  const prevAPD = aggPD(prevRaw);

  // Pre-indexar apd y prevAPD por partner una sola vez.
  // Reemplaza .filter() + .find() por partner (O(n × partners)) con lookups O(1).
  const apdByPartner = new Map();
  const prevByPartner = new Map();
  for (const r of apd) {
    let a = apdByPartner.get(r.partner);
    if (!a) { a = []; apdByPartner.set(r.partner, a); }
    a.push(r);
  }
  for (const r of prevAPD) prevByPartner.set(r.partner, r);

  const frag    = document.createDocumentFragment();

  partners.forEach(partner => {
    const rows = (apdByPartner.get(partner) || [])
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return;
    const last    = rows[rows.length - 1];
    const prevRow = prevByPartner.get(partner) || null;
    const col     = STATE.partnerColors[partner] || "#FF0000";
    const kc      = KAM_COLORS[last.kam] || "#888";

    const lastNR = last.newPartner + last.newService + last.reactivated;
    const prevNR = prevRow ? prevRow.newPartner + prevRow.newService + prevRow.reactivated : null;
    const tA = trendI(rows.map(r => r.activeDrivers));
    const tN = trendI(rows.map(r => r.newPartner + r.newService + r.reactivated));
    const tH = trendI(rows.map(r => r.supplyHours));

    const card = document.createElement("div");
    card.className         = "pcard";
    card.style.borderLeftColor = col;
    card.innerHTML = `
      <div class="pcard-name">
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col};margin-right:5px"></span>
        ${escapeHTML(partner)}
      </div>
      <div class="pcard-sub">
        <span style="width:7px;height:7px;border-radius:50%;background:${kc};display:inline-block;margin-right:3px"></span>
        ${escapeHTML(last.kam)} &nbsp;·&nbsp; ${prevRow ? d2s(prevDate) + " → " : ""}${d2s(lastDate)}
      </div>
      <div class="pcard-kpis">
        <div class="pk">
          <div class="pk-label">${escapeHTML(t("metric.ad.short"))}</div>
          <div class="pk-val">${fmt(last.activeDrivers)}</div>
          ${bdgMode(last.activeDrivers, prevRow?.activeDrivers ?? null, "mb-badge")}
          <span style="${tA.c}">${tA.i}</span>
        </div>
        <div class="pk">
          <div class="pk-label">${escapeHTML(t("metric.sh.short"))}</div>
          <div class="pk-val">${fmt(last.supplyHours)}</div>
          ${bdgMode(last.supplyHours, prevRow?.supplyHours ?? null, "mb-badge")}
          <span style="${tH.c}">${tH.i}</span>
        </div>
        <div class="pk-wide">
          <div class="pk-label">
            ${escapeHTML(t("metric.nr.label"))} &nbsp;
            ${bdgMode(lastNR, prevNR, "mb-badge")}
            <span style="${tN.c}">${tN.i}</span>
          </div>
          <div class="pk-sub-grid">
            <div>
              <div class="pk-sub-label">Partner</div>
              <div class="pk-sub-val">${fmt(last.newPartner)}</div>
              ${bdgMode(last.newPartner, prevRow?.newPartner ?? null, "mb-badge")}
            </div>
            <div>
              <div class="pk-sub-label">Servicio</div>
              <div class="pk-sub-val">${fmt(last.newService)}</div>
              ${bdgMode(last.newService, prevRow?.newService ?? null, "mb-badge")}
            </div>
            <div>
              <div class="pk-sub-label">Reactivados</div>
              <div class="pk-sub-val">${fmt(last.reactivated)}</div>
              ${bdgMode(last.reactivated, prevRow?.reactivated ?? null, "mb-badge")}
            </div>
          </div>
        </div>
      </div>`;
    frag.appendChild(card);
  });
  grid.appendChild(frag); // un solo reflow al final
}

// ── KPIs DE LÍNEA (Fleet / TukTuk) — Fase 2 ───────────────────────────────────
// Tarjeta KPI simple con badge WoW/MoM (reusa .mcard). val/prev ya agregados.
// subLabel es opcional y por defecto dice "snapshot último período" porque casi
// todos los KPIs de esta vista lo son. Los de FLUJO (nuevos conductores) acumulan
// sobre el rango y tienen que decirlo — si no, se leen como si fueran del último
// período y el número parece inflado sin motivo.
export function _rendKpiCard(label, icon, val, prev, color, fmtFn, subLabel) {
  return `
    <div class="mcard" style="border-top:3px solid ${color}">
      <div class="mcard-label">${icon} ${label}</div>
      <div class="mcard-sub-label">${subLabel || "snapshot último período"}</div>
      <div class="mcard-val">${fmtFn(val)}</div>
      <div class="agy-style-257">${bdgMode(val, prev)}
        <span class="agy-style-258">${escapeHTML(t("rend.cmp.vs", { p: STATE.curMode === "mensual" ? t("rend.cmp.mesAnterior") : STATE.curMode === "diario" ? t("rend.cmp.diaAnterior") : t("rend.cmp.semAnterior") }))}</span>
      </div>
    </div>`;
}
// Suma/pondera KPIs Fleet sobre filas crudas (una por fleetroom-ciudad de una fecha).
// SH/Auto interno = Σ internalFleetSh / Σ ownedFleetActiveCars; Aceptación = Σ(rate×trips)/Σtrips
// (mismas fórmulas que presentacion2.p2FleetSeries). Cars/Branded = snapshots sumados.
// Revenue/productividad (gmv, comisión, tripsPerHour, moneyPerHour) se recalculan EXACTOS
// desde las sumas crudas (gmv, trips, SH) — no se reusa la columna-ratio precalculada por
// fila, para no perder precisión al agregar varias filas (misma lección que
// excel-upload-full-precision: sumar crudo, no promediar ratios ya redondeados).
// Calidad/riesgo/dependencia (fraude, mal calificados, completion, subsidio, soporte,
// % SH externo) SÍ son shares sin numerador/denominador propio en la BD → se ponderan
// por trips (o por gmv en el caso de subsidio) igual que Aceptación.
export function _rendFleetAgg(rows) {
  let owned = 0, intSh = 0, extSh = 0, trips = 0, accW = 0, branded = 0, actCars = 0,
      gmv = 0, commission = 0,
      fraudW = 0, badRatedW = 0, complW = 0, supportW = 0, subsidyW = 0;
  rows.forEach(r => {
    owned      += r.ownedFleetActiveCars || 0;
    intSh      += r.internalFleetSh || 0;
    extSh      += r.externalFleetSh || 0;
    trips      += r.trips || 0;
    accW       += (r.acceptanceRate || 0) * (r.trips || 0);
    branded    += r.brandedActiveCars || 0;
    actCars    += r.activeCars || 0;
    gmv        += r.gmv || 0;
    commission += r.commission || 0;
    fraudW     += (r.fraudTripsShare || 0) * (r.trips || 0);
    badRatedW  += (r.badRatedTripsShare || 0) * (r.trips || 0);
    complW     += (r.completionRate || 0) * (r.trips || 0);
    supportW   += (r.driverSupportRequestsShare || 0) * (r.trips || 0);
    subsidyW   += (r.driverSubsidiesByGmv || 0) * (r.gmv || 0);
  });
  const totalSh = intSh + extSh;
  return {
    owned, branded, actCars, gmv, commission,
    shCar:            owned > 0   ? intSh / owned : 0,
    accept:           trips > 0   ? (accW / trips) * 100 : 0,
    pctBranded:       owned > 0   ? (branded / owned) * 100 : 0,
    gmvPerCar:        owned > 0   ? gmv / owned : 0,
    commissionPerCar: owned > 0   ? commission / owned : 0,
    tripsPerCar:      owned > 0   ? trips / owned : 0,
    tripsPerHour:     totalSh > 0 ? trips / totalSh : 0,
    moneyPerHour:     totalSh > 0 ? gmv / totalSh : 0,
    externalShShare:  totalSh > 0 ? (extSh / totalSh) * 100 : 0,
    fraudShare:       trips > 0   ? (fraudW / trips) * 100 : 0,
    badRatedShare:    trips > 0   ? (badRatedW / trips) * 100 : 0,
    completionRate:   trips > 0   ? (complW / trips) * 100 : 0,
    supportReqShare:  trips > 0   ? (supportW / trips) * 100 : 0,
    subsidyByGmv:     gmv > 0     ? (subsidyW / gmv) * 100 : 0
  };
}
// Agrega KPIs Fleet por fecha (Peru total, todas las ciudades) — mismas fórmulas
// que _rendFleetAgg, indexadas por fecha. Insumo de los charts de Tendencias.
export function _fleetAggByDate(rows) {
  const m = new Map();
  rows.forEach(r => { let a = m.get(r.date); if (!a) { a = []; m.set(r.date, a); } a.push(r); });
  const out = {};
  m.forEach((rs, d) => { out[d] = _rendFleetAgg(rs); });
  return out;
}
// Línea de un KPI de flota (Peru total) a lo largo del rango filtrado (no solo el
// último período — a diferencia de las tarjetas/tabla, que son snapshot).
export const _FLEET_TREND_LABEL = {
  owned: "Owned Cars", shCar: "SH / Auto", accept: "Aceptación %", branded: "Branded Cars",
  gmvPerCar: "GMV / Auto", externalShShare: "% SH Externo"
};
export function buildFleetTrendLine(elId, dates, byDate, key, color) {
  const data = dates.map(d => (byDate[d] ? byDate[d][key] : 0) || 0);
  buildLineChart(elId, dates, [{ name: _FLEET_TREND_LABEL[key] || key, data }], [color]);
}
// Donut "Owned Cars por Partner" — snapshot del último período, Top 6 + Otros.
// Parts-of-whole (dónde se concentra la flota) → donut es la elección correcta,
// no una línea (no es serie de tiempo).
export function _buildFleetOwnedDonut(lastRows) {
  const byP = new Map();
  lastRows.forEach(r => {
    const v = r.ownedFleetActiveCars || 0;
    if (!v) return;
    byP.set(r.partner, (byP.get(r.partner) || 0) + v);
  });
  const sorted  = [...byP.entries()].sort((a, b) => b[1] - a[1]);
  const TOP     = 6;
  const top     = sorted.slice(0, TOP);
  const restSum = sumR(sorted.slice(TOP), ([, v]) => v);
  const labels  = top.map(([p]) => p);
  const series  = top.map(([, v]) => v);
  const colors  = top.map(([p]) => STATE.partnerColors[p] || "#94a3b8");
  if (restSum > 0) { labels.push("Otros"); series.push(restSum); colors.push("#cbd5e1"); }
  buildDonutChart("chF_ownedDonut", labels, series, colors);
}
// Donut "Brandeados vs No Brandeados" — snapshot del último período, Peru total.
export function _buildFleetBrandedDonut(lastRows) {
  const agg = _rendFleetAgg(lastRows);
  const noBranded = Math.max(agg.owned - agg.branded, 0);
  buildDonutChart("chF_brandedDonut", ["Brandeados", "No brandeados"], [agg.branded, noBranded], ["#f59e0b", "#e2e8f0"]);
}
// Programa los charts de Fleet (tendencias + composición) diferidos con RAF — mismo
// patrón anti-freeze que pumpCharts() de Agregador. Aborta si cambia filtro/tab/línea
// mientras corre (evita pintar charts sobre un render ya obsoleto).
export function _scheduleFleetCharts(filtered, dates, lastRows) {
  const tokenAtSchedule = _renderRendToken;
  const tabTokenAtSched = STATE._tabRenderId;
  const byDate = _fleetAggByDate(filtered);
  const jobs = [
    () => buildFleetTrendLine("chF_owned",   dates, byDate, "owned",  "#0891b2"),
    () => buildFleetTrendLine("chF_shcar",   dates, byDate, "shCar",  "#8b5cf6"),
    () => buildFleetTrendLine("chF_accept",  dates, byDate, "accept", "#10b981"),
    () => buildFleetTrendLine("chF_branded", dates, byDate, "branded","#f59e0b"),
    () => buildFleetTrendLine("chF_gmvcar",  dates, byDate, "gmvPerCar",       "#059669"),
    () => buildFleetTrendLine("chF_extsh",   dates, byDate, "externalShShare", "#dc2626"),
    () => _buildFleetOwnedDonut(lastRows),
    () => _buildFleetBrandedDonut(lastRows)
  ];
  function pump(i) {
    if (i >= jobs.length) return;
    if (_renderRendToken !== tokenAtSchedule)   return;
    if (STATE._tabRenderId !== tabTokenAtSched) return;
    if (STATE.curTab !== "rend")                return;
    try { jobs[i](); } catch (e) { console.warn("Fleet chart job", i, "failed:", e); }
    requestAnimationFrame(() => pump(i + 1));
  }
  requestAnimationFrame(() => pump(0));
}
// Vista Fleet completa (SOLO KPIs de flota): Perú general + por ciudad + por partner.
// lastRows/prevRows = filas CRUDAS de sub-flotas Fleet (una por fleetroom-ciudad) del
// último período y del anterior. NO se usan AD/SH/N+R (mezclados a nivel fleetroom).
export function _renderFleetView(lastRows, prevRows, lastDate, prevDate) {
  const periodLabel = _rendPeriodLabel();
  let html = rendLineToggleHTML();

  // Perú general (10 KPIs de flota: presencia/calidad + revenue/productividad)
  html += secH("🚗", "#0891b2", t("rend.fleet.peru"),
    t("rend.fleet.peruSub", { p: periodLabel }),
    d2s(lastDate));
  html += _rendFleetCardsBody(_rendFleetAgg(lastRows), _rendFleetAgg(prevRows));

  // Tendencias (línea, Peru total, evolución del rango filtrado — no solo el
  // último período). Series continuas → línea es la lectura correcta (mismo
  // patrón que la sección "Tendencias" del Agregador).
  html += secH("📈", "#10b981", t("rend.fleet.tend"), t("rend.fleet.tendSub"), "");
  html += `<div class="section"><div class="agy-style-529">
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Owned Fleet Cars</span><button class="png-btn" data-act="dlChart" data-chart="chF_owned" data-name="Fleet_OwnedCars">PNG</button></div><div id="chF_owned"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">SH / Auto (interno)</span><button class="png-btn" data-act="dlChart" data-chart="chF_shcar" data-name="Fleet_SHAuto">PNG</button></div><div id="chF_shcar"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Aceptación %</span><button class="png-btn" data-act="dlChart" data-chart="chF_accept" data-name="Fleet_Aceptacion">PNG</button></div><div id="chF_accept"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Branded Active Cars</span><button class="png-btn" data-act="dlChart" data-chart="chF_branded" data-name="Fleet_Branded">PNG</button></div><div id="chF_branded"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">GMV / Auto</span><button class="png-btn" data-act="dlChart" data-chart="chF_gmvcar" data-name="Fleet_GMVporAuto">PNG</button></div><div id="chF_gmvcar"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">% SH Externo (dependencia)</span><button class="png-btn" data-act="dlChart" data-chart="chF_extsh" data-name="Fleet_PctSHExterno">PNG</button></div><div id="chF_extsh"></div></div>
  </div></div>`;

  // Composición (donut, snapshot del último período) — dónde se concentra la
  // flota y qué tan brandeada está. Parts-of-whole (pocas categorías, una foto
  // en el tiempo) → donut, no línea.
  html += secH("🥯", "#7e22ce", t("rend.fleet.comp"), t("rend.fleet.compSub", { d: d2s(lastDate) }), "");
  html += `<div class="section"><div class="agy-style-529">
    <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(t("rend.fleet.ownedDonut"))}</span><button class="png-btn" data-act="dlChart" data-chart="chF_ownedDonut" data-name="Fleet_OwnedPorPartner">PNG</button></div><div id="chF_ownedDonut"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(t("rend.fleet.brandDonut"))}</span><button class="png-btn" data-act="dlChart" data-chart="chF_brandedDonut" data-name="Fleet_Brandeados">PNG</button></div><div id="chF_brandedDonut"></div></div>
  </div></div>`;

  // Calidad y dependencia (scorecard, Perú total, snapshot) — métricas de riesgo/
  // madurez del negocio: se leen mejor como checklist compacto que como tiles
  // grandes (son secundarias frente a presencia/revenue de arriba).
  html += secH("🛡️", "#64748b", t("rend.fleet.calidad"),
    t("rend.fleet.calidadSub", { p: periodLabel }), "");
  {
    const c = _rendFleetAgg(lastRows), p = _rendFleetAgg(prevRows);
    const pct = v => fmt(v) + "%";
    html += `<div class="section">${_rendFleetScorecard([
      { label: "% SH Externo (no propio)",        val: c.externalShShare, prev: p.externalShShare, fmtFn: pct },
      { label: "% Viajes con Fraude",              val: c.fraudShare,      prev: p.fraudShare,      fmtFn: pct },
      { label: "% Viajes Mal Calificados",         val: c.badRatedShare,   prev: p.badRatedShare,   fmtFn: pct },
      { label: "% Completion Rate",                val: c.completionRate,  prev: p.completionRate,  fmtFn: pct },
      { label: "Subsidio Yango / GMV",             val: c.subsidyByGmv,    prev: p.subsidyByGmv,    fmtFn: pct },
      { label: "% Solicitudes de Soporte",         val: c.supportReqShare, prev: p.supportReqShare, fmtFn: pct }
    ])}</div>`;
  }

  // Por ciudad
  html += secH("🏙️", "#06b6d4", t("rend.fleet.ciudad"), t("rend.fleet.ciudadSub"), "");
  html += `<div class="section"><div class="city-grid">`;
  CITIES.forEach(city => {
    const cr = lastRows.filter(r => r.city === city);
    if (!cr.length) return;
    const c = _rendFleetAgg(cr);
    const p = _rendFleetAgg(prevRows.filter(r => r.city === city));
    const col = CITY_COLORS[city] || "#888";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${cityLabel(city)}
        </div>
        ${_rendFleetCityKpi("Owned Fleet Cars", c.owned,      p.owned,      fmt)}
        ${_rendFleetCityKpi("SH / Auto",        c.shCar,      p.shCar,      fmt)}
        ${_rendFleetCityKpi("Aceptación",       c.accept,     p.accept,     v => fmt(v) + "%")}
        ${_rendFleetCityKpi("Branded Cars",     c.branded,    p.branded,    fmt)}
        ${_rendFleetCityKpi("% Brandeado",      c.pctBranded, p.pctBranded, v => fmt(v) + "%")}
      </div>`;
  });
  html += `</div></div>`;

  // Por partner (tabla)
  html += secH("📋", "#6366f1", t("rend.fleet.partner"), t("rend.fleet.partnerSub"), "");
  html += `<div class="section"><div class="tbl-wrap">${_rendFleetPartnerTable(lastRows, prevRows)}</div></div>`;
  return html;
}
export function _rendFleetCardsBody(c, p) {
  const pct = v => fmt(v) + "%";
  // 10 tarjetas: el grid de 3 columnas de .metric-row se sobre-escribe inline con
  // auto-fit (no tocar la clase global — la usa también el Agregador con 3 cards).
  // auto-fit/minmax evita que se aplasten en pantallas angostas (envuelve a 2 filas).
  return `<div class="section"><div class="metric-row agy-style-226">
      ${_rendKpiCard(t("rend.kpi.ownedCars"),   "🚗", c.owned,      p.owned,      "#0891b2", fmt)}
      ${_rendKpiCard(t("rend.kpi.shAuto"), "⏱️", c.shCar,      p.shCar,      "#8b5cf6", fmt)}
      ${_rendKpiCard(t("rend.kpi.aceptacion"),          "✅", c.accept,     p.accept,     "#10b981", pct)}
      ${_rendKpiCard(t("rend.kpi.brandedCars"), "🏷️", c.branded,    p.branded,    "#f59e0b", fmt)}
      ${_rendKpiCard(t("rend.kpi.pctBrand"),         "🎯", c.pctBranded, p.pctBranded, "#7e22ce", pct)}
      ${_rendKpiCard(t("rend.kpi.gmvAuto"),          "💰", c.gmvPerCar,        p.gmvPerCar,        "#059669", fmt)}
      ${_rendKpiCard(t("rend.kpi.comAuto"),     "💵", c.commissionPerCar, p.commissionPerCar, "#059669", fmt)}
      ${_rendKpiCard(t("rend.kpi.viajesAuto"),       "🧭", c.tripsPerCar,      p.tripsPerCar,      "#0ea5e9", fmt)}
      ${_rendKpiCard("Viajes / Hora",       "⚡", c.tripsPerHour,     p.tripsPerHour,     "#0ea5e9", fmt)}
      ${_rendKpiCard(t("rend.kpi.gmvHora"),          "📈", c.moneyPerHour,     p.moneyPerHour,     "#059669", fmt)}
    </div></div>`;
}
// Scorecard compacto: filas label+valor+badge WoW/MoM apiladas en 1 tarjeta (a
// diferencia de _rendKpiCard, que es 1 tarjeta grande por métrica). Métricas de
// calidad/riesgo/dependencia son secundarias — se leen mejor como checklist que
// como 6 tiles gigantes.
export function _rendFleetScorecard(items) {
  return `<div class="mcard agy-style-530">
    ${items.map(it => `
      <div class="city-kpi">
        <span class="city-kpi-label">${it.label}</span>
        <div class="city-kpi-right"><span class="city-kpi-val">${it.fmtFn(it.val)}</span>${bdgMode(it.val, it.prev, "mb-badge")}</div>
      </div>`).join("")}
  </div>`;
}
export function _rendFleetCityKpi(label, val, prev, fmtFn) {
  return `<div class="city-kpi">
    <span class="city-kpi-label">${label}</span>
    <div class="city-kpi-right"><span class="city-kpi-val">${fmtFn(val)}</span>${bdgMode(val, prev, "mb-badge")}</div>
  </div>`;
}
export function _rendFleetPartnerTable(lastRows, prevRows) {
  const groupBy = (rows) => {
    const m = new Map();
    rows.forEach(r => { let a = m.get(r.partner); if (!a) { a = []; m.set(r.partner, a); } a.push(r); });
    return m;
  };
  const byP = groupBy(lastRows), prevByP = groupBy(prevRows);
  const rows = [...byP.entries()].map(([p, rs]) => {
    const c  = _rendFleetAgg(rs);
    const pr = _rendFleetAgg(prevByP.get(p) || []);
    return { partner: p, kam: (rs[0] || {}).kam || "", ...c, prev: pr };
  }).sort((a, b) => b.owned - a.owned);
  if (!rows.length) return `<div class="agy-style-531">Sin partners Fleet en el filtro actual.</div>`;
  // Delta inline junto al valor (mismo patrón que _rendFleetCityKpi) en vez de una
  // sola columna "WoW Cars" — así cada métrica trae su propio WoW/MoM.
  let h = `<table class="dtbl"><thead><tr>
    <th>Partner</th><th>KAM</th><th>Owned Cars</th><th>SH/Auto</th><th>Aceptación</th><th>Branded</th><th>% Brandeado</th><th>GMV/Auto</th><th>Comisión/Auto</th></tr></thead><tbody>`;
  rows.forEach(r => {
    const kc = KAM_COLORS[r.kam] || "#ccc";
    h += `<tr>
      <td>${escapeHTML(r.partner)}</td>
      <td><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${kc};margin-right:4px"></span>${escapeHTML(r.kam)}</td>
      <td class="tn">${fmt(r.owned)} ${bdgMode(r.owned, r.prev.owned, "tbadge")}</td>
      <td class="tn">${fmt(r.shCar)} ${bdgMode(r.shCar, r.prev.shCar, "tbadge")}</td>
      <td class="tn">${fmt(r.accept)}% ${bdgMode(r.accept, r.prev.accept, "tbadge")}</td>
      <td class="tn">${fmt(r.branded)}</td>
      <td class="tn">${fmt(r.pctBranded)}% ${bdgMode(r.pctBranded, r.prev.pctBranded, "tbadge")}</td>
      <td class="tn">${fmt(r.gmvPerCar)} ${bdgMode(r.gmvPerCar, r.prev.gmvPerCar, "tbadge")}</td>
      <td class="tn">${fmt(r.commissionPerCar)} ${bdgMode(r.commissionPerCar, r.prev.commissionPerCar, "tbadge")}</td>
    </tr>`;
  });
  h += `</tbody></table>`;
  return h;
}
export function _rendTkKPIs(lastRows, prevRows) {
  const agg = rows => {
    let branded = 0, actCars = 0;
    rows.forEach(r => { branded += r.brandedActiveCars || 0; actCars += r.activeCars || 0; });
    return { branded, actCars };
  };
  const c = agg(lastRows), p = agg(prevRows);
  return secH("🛺", "#7e22ce", "TukTuk · Autos",
      "Autos brandeados y activos del último período · solo sub-flotas TukTuk", "") +
    `<div class="section"><div class="metric-row">
      ${_rendKpiCard(t("rend.kpi.brandeados"),  "🏷️", c.branded, p.branded, "#7e22ce", fmt)}
      ${_rendKpiCard(t("rend.kpi.activeCars"), "🚗", c.actCars, p.actCars, "#0891b2", fmt)}
    </div></div>` +
    _rendTkAdquisicion(lastRows, prevRows);
}

// ── TukTuk · Adquisición propia (criterio "Las 6 metas del mes") ──────────────
// Meta del criterio: 100 conductores nuevos al mes de ADQUISICIÓN PROPIA. La
// letra chica importa y define la métrica: "no contempla self-registration", que
// es exactamente la distinción entre las dos columnas de la fuente:
//   new_from_partner  → los trae el partner   (cuentan)
//   new_from_service  → self-registration     (NO cuentan)
// Por eso la tarjeta de self-registration se muestra al lado: deja la definición
// a la vista y auditable, en vez de que el número salga de una caja negra.
export const TK_META_NUEVOS_MES = 100;

// OJO CON LA VENTANA: la meta es de 100 al MES, así que esta sección mide el
// ÚLTIMO PERÍODO, no el acumulado del rango. Con el acumulado, un rango de 3
// meses daba 97,2 contra una meta de 100 y parecía "casi cumplida" cuando en
// realidad el mes cerró en 36 — el mismo error de escala que ya obligó a poner
// un aviso en Metas. Comparar contra el período anterior, no contra el rango.
export function _rendTkAdquisicion(lastRows, prevRows) {
  const sum = (rows, get) => rows.reduce((a, r) => a + (get(r) || 0), 0);
  const propios  = sum(lastRows, r => r.newPartner);
  const self     = sum(lastRows, r => r.newService);
  const pPropios = sum(prevRows, r => r.newPartner);
  const pSelf    = sum(prevRows, r => r.newService);
  const total    = propios + self;
  const pTotal   = pPropios + pSelf;
  const pct      = total  > 0 ? (propios  / total)  * 100 : 0;
  const pPct     = pTotal > 0 ? (pPropios / pTotal) * 100 : 0;

  // Por partner: lo accionable es a quién llamar, no el total país.
  const byPartner = new Map();
  lastRows.forEach(r => {
    byPartner.set(r.partner, (byPartner.get(r.partner) || 0) + (r.newPartner || 0));
  });
  const filas = [...byPartner.entries()].sort((a, b) => b[1] - a[1]);

  // La meta es MENSUAL. En semanal/diario el "último período" es una semana o un
  // día, así que compararlo contra 100 daría un incumplimiento falso → el
  // semáforo queda en gris (mismo criterio que el aviso de escala de Metas).
  const mensual = STATE.curMode === "mensual";
  const rangoTxt = mensual ? "último mes" : "último período (no es un mes)";

  const filasHTML = filas.length ? filas.map(([partner, n]) => {
    const ok  = n >= TK_META_NUEVOS_MES;
    const col = !mensual ? "#64748b" : ok ? "#10b981" : n >= TK_META_NUEVOS_MES * 0.5 ? "#f59e0b" : "#FF0000";
    const pctMeta = Math.min(100, (n / TK_META_NUEVOS_MES) * 100);
    return `<tr>
      <td style="padding:8px 12px">${escapeHTML(partner)}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700;color:${col}">${fmt(n)}</td>
      <td style="padding:8px 12px;width:40%">
        <div style="background:#eee;height:8px;border-radius:4px;overflow:hidden">
          <div style="width:${pctMeta}%;height:100%;background:${col}"></div>
        </div>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="3" style="padding:12px;color:#888">Sin conductores nuevos en el rango.</td></tr>`;

  return secH("🎯", "#e11d48", "TukTuk · Adquisición propia",
      `Conductores nuevos traídos por el partner (excluye self-registration) · meta ${TK_META_NUEVOS_MES}/mes`, "") +
    `<div class="section">
      <div class="metric-row">
        ${_rendKpiCard(t("rend.kpi.nuevosProp"), "🎯", propios, pPropios, "#e11d48", fmt, rangoTxt)}
        ${_rendKpiCard(t("rend.kpi.selfReg"), "🔁", self, pSelf, "#94a3b8", fmt, "no cuenta para la meta")}
        ${_rendKpiCard(t("rend.kpi.pctAdq"), "📈", pct, pPct, "#0891b2", v => v.toFixed(1) + "%", "propios / total nuevos")}
      </div>
      ${!mensual ? `<div class="agy-style-213" style="margin:10px 0">
        ⚠️ La meta de ${TK_META_NUEVOS_MES} es <strong>mensual</strong>. En escala ${STATE.curMode} el último período es ${STATE.curMode === "diario" ? "un día" : "una semana"}, así que no es comparable contra ella y el semáforo por partner queda en gris. Cambiá a <strong>Mensual</strong> para evaluar cumplimiento.
      </div>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:.85rem">
        <thead><tr style="background:#f8fafc;text-align:left">
          <th style="padding:8px 12px">PARTNER</th>
          <th style="padding:8px 12px;text-align:right">NUEVOS PROPIOS</th>
          <th style="padding:8px 12px">vs META ${TK_META_NUEVOS_MES}</th>
        </tr></thead>
        <tbody>${filasHTML}</tbody>
      </table>
    </div>`;
}

// ── SECTION HEADER ─────────────────────────────────────────────────────────────
export function secH(icon, bg, title, sub, tag) {
  return `<div class="sh">
    <div class="sh-icon" style="background:${bg}20">${icon}</div>
    <div>
      <div class="sh-title">${title}</div>
      <div class="sh-sub">${sub}</div>
    </div>
    ${tag ? `<span class="sh-tag">${tag}</span>` : ""}
  </div>`;
}

// Variante compacta de section header (sin fondo de ícono ni tag) — vivía en
// insights.js (borrado en Fase A0 por no tener ruta de UI propia), pero
// calculator.js/partnerView.js/seguimiento.js seguían usándola como global.
// Restaurada acá al detectar el ReferenceError durante la conversión a módulos ES.
export function _secH(emoji, color, title, subtitle) {
  return `
    <div class="agy-style-532">
      <div class="agy-style-533">${emoji}</div>
      <div class="agy-style-534">
        <div class="agy-style-535">${escapeHTML(title)}</div>
        <div class="agy-style-536">${escapeHTML(subtitle)}</div>
      </div>
    </div>`;
}
// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";

registerActions({
  setRendLine: d => setRendLine(d.line),
  sortTbl:     d => sortTbl(d.col),
  dlChart:     d => dlChart(d.chart, d.name)
});
