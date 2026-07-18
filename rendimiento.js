// rendimiento.js — Pestaña Rendimiento

// ── LÍNEA DE NEGOCIO (Agregador / Fleet / TukTuk) — Fase 2 ────────────────────
// Localizado a Rendimiento: NO muta STATE.rawData (el agregador queda intacto para
// Metas/Calculadora/etc). Se filtra el slice de la línea con los MISMOS filtros del
// sidebar (ciudad/fecha/partner). Agregador incluye Fleet (Fleet ⊂ Taxi). El diario
// no trae db_id (sin sub-flota) → Fleet/TukTuk se deshabilitan y cae a Agregador.
function _rendLine() {
  let line = STATE.rendLine || "agg";
  if (STATE.curMode === "diario" && line !== "agg") line = "agg";
  return line;
}
// Dataset completo (todas las fechas) de la línea activa para la escala actual.
function _rendLineDataset() {
  const line = _rendLine();
  if (line === "agg") return STATE.rawData;
  const mensual = STATE.curMode === "mensual";
  if (line === "fleet") return (mensual ? STATE.rawDataMensualFleet  : STATE.rawDataFleet)  || [];
  return                        (mensual ? STATE.rawDataMensualTuktuk : STATE.rawDataTuktuk) || [];
}
// Filas de la línea filtradas por ciudad/fecha/partner (espeja getFiltered()).
function _rendLineFiltered() {
  if (_rendLine() === "agg") return getFiltered();
  const f = getCurrentFilters();
  const selSet = new Set(f.selected);
  return _rendLineDataset().filter(r =>
    (f.city === "all" || r.city === f.city) &&
    r.date >= f.from && r.date <= f.to &&
    selSet.has(r.partner)
  );
}
// Filas de prevDate (fuera del rango) para la línea. Agregador usa el índice _byDate;
// Fleet/TukTuk filtran su slice (arrays pequeños, sin índice dedicado).
function _rendLinePrev(prevDate, city) {
  if (!prevDate) return [];
  if (_rendLine() === "agg") {
    const base = (STATE._byDate && STATE._byDate.get(prevDate))
      || STATE.rawData.filter(r => r.date === prevDate);
    return city ? base.filter(r => r.city === city) : base;
  }
  return _rendLineDataset().filter(r => r.date === prevDate && (!city || r.city === city));
}

// Barra segmentada de línea de negocio (reusa .mode-toggle-row/.mode-btn del selector
// de escala). En diario, Fleet/TukTuk quedan deshabilitados (sin datos por sub-flota).
function rendLineToggleHTML() {
  const line   = _rendLine();
  const diario = STATE.curMode === "diario";
  const defs = [
    { k: "agg",   emoji: "📊", label: "Agregador", tip: "Taxi — incluye la actividad de las flotas" },
    { k: "fleet", emoji: "🚗", label: "Fleet",     tip: "Solo sub-flotas marcadas Fleet" },
    { k: "tk",    emoji: "🛺", label: "TukTuk",    tip: "Solo TukTuk" }
  ];
  const btns = defs.map(d => {
    const on  = line === d.k;
    const dis = diario && d.k !== "agg";
    return `<button class="mode-btn${on ? " active" : ""}" ${dis ? "disabled" : ""}
      title="${dis ? "Sin datos diarios por sub-flota — usa escala semanal o mensual" : escapeHTML(d.tip)}"
      ${dis ? "" : `onclick="setRendLine('${d.k}')"`}
      style="${dis ? "opacity:.4;cursor:not-allowed" : ""}">${d.emoji} ${d.label}</button>`;
  }).join("");
  const note = diario
    ? `<span style="font-size:.7rem;color:#b45309;margin-left:10px;align-self:center">Fleet/TukTuk requieren escala semanal o mensual (el diario no trae sub-flota)</span>`
    : "";
  return `<div class="mode-toggle-row" style="margin:0 4px 12px">${btns}${note}</div>`;
}
function setRendLine(line) {
  if ((STATE.rendLine || "agg") === line) return;
  if (STATE.curMode === "diario" && line !== "agg") return;
  STATE.rendLine = line;
  renderRend();
}

// Guard de reentrancia: evita que dos renderRend() concurrentes se pisen.
// Si llega un segundo render mientras el primero corre, se descarta.
let _renderRendBusy  = false;
// Token incremental: la cola de charts diferidos verifica este token. Si llega
// un nuevo renderRend, el pump de charts del render anterior se aborta.
let _renderRendToken = 0;

function renderRend() {
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

function _renderRendImpl() {
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
      `<div class="section"><div style="padding:28px 16px;text-align:center;color:#999;font-size:.85rem">
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
    const lname = line === "fleet" ? "Fleet" : "TukTuk";
    content.innerHTML = rendLineToggleHTML() +
      `<div class="section"><div style="padding:28px 16px;text-align:center;color:#999;font-size:.85rem">
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
  // Lookup de la línea activa (agg usa _byDate; fleet/tk filtran su slice).
  const _prevAll = _rendLinePrev(prevDate, null);
  const prevFiltered = _prevAll.filter(r =>
    (cityFilter === "all" || r.city === cityFilter) &&
    selSet.has(r.partner)
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

  let html = rendLineToggleHTML();

  // ── 1. Peru General ────────────────────────────────────────────────────────
  // Subtitulo segun modo: en diario/semanal/mensual contextualiza el dato
  const periodLabel = STATE.curMode === "mensual" ? "último mes"
                    : STATE.curMode === "diario"  ? "último día"
                    : "última semana";
  html += secH("🇵🇪", "#FF0000",
    "Peru - Vista General",
    `Activos: snapshot ${periodLabel}  ·  N+R y Horas: acumulado del rango`,
    d2s(lastDate));
  html += `<div class="section"><div class="metric-row">
    ${mkMetricCard(METRICS.ad.label,"📊",tAD,pAD,apd,lastRows,prevRows,"ad",METRICS.ad.color,false)}
    ${mkMetricCard(METRICS.nr.label,"🆕",tNR,lNR,apd,lastRows,prevRows,"nr",METRICS.nr.color,true)}
    ${mkMetricCard(METRICS.sh.label,"⏱️",tSH,lSH,apd,lastRows,prevRows,"sh",METRICS.sh.color,true)}
  </div></div>`;

  // ── 1b. KPIs propios de TukTuk (Fleet tiene su vista dedicada arriba) ───────
  if (line === "tk") {
    html += _rendTkKPIs(filtered.filter(r => r.date === lastDate), prevFiltered);
  }

  // ── 2. Por Ciudad ──────────────────────────────────────────────────────────
  html += secH("🏙️", "#06b6d4", "Por Ciudad", "Rendimiento y comparativo WoW", "");
  html += `<div class="section"><div class="city-grid">`;
  CITIES.forEach(city => {
    const cr = filteredByCity[city];
    if (!cr.length) return;
    const ca   = aggPD(cr);
    const cL   = ca.filter(r => r.date === lastDate);
    // prevDate para ciudad, según la línea activa (agg usa índice; fleet/tk su slice)
    const _cPrev = _rendLinePrev(prevDate, city);
    const cPraw = _cPrev.filter(r => selSet.has(r.partner));
    const cP   = aggPD(cPraw);
    const cAD  = sumR(cL,  r => r.activeDrivers);
    const cNR  = sumR(cL,  r => r.newPartner + r.newService + r.reactivated);
    const cSH  = sumR(cL,  r => r.supplyHours);
    const cpAD = sumR(cP,  r => r.activeDrivers);
    const cpNR = sumR(cP,  r => r.newPartner + r.newService + r.reactivated);
    const cpSH = sumR(cP,  r => r.supplyHours);
    const col  = CITY_COLORS[city] || "#888";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${cityLabel(city)}
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">Conductores Activos</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmt(cAD)}</span>${bdgMode(cAD,cpAD,"mb-badge")}</div>
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">Nuevos + Reactivados</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmt(cNR)}</span>${bdgMode(cNR,cpNR,"mb-badge")}</div>
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">Horas de Conexión</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmt(cSH)}</span>${bdgMode(cSH,cpSH,"mb-badge")}</div>
        </div>
      </div>`;
  });
  html += `</div></div>`;

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  html += secH("👤", "#f59e0b", "Por KAM", "Rendimiento por responsable", "");
  html += `<div class="section"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">`;
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
    const kpAD = sumR(kP, r => r.activeDrivers);
    const kpNR = sumR(kP, r => r.newPartner + r.newService + r.reactivated);
    const col  = KAM_COLORS[kam] || "#888";
    html += `
      <div class="mcard" style="border-left:3px solid ${col}">
        <div class="mcard-label"><span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block"></span> ${escapeHTML(kam)}</div>
        <div class="mcard-val">${fmt(kAD)}</div>
        <div>${bdgMode(kAD,kpAD)} <span style="font-size:.72rem;color:#aaa;margin-left:5px">Activos</span></div>
        <div class="mcard-breakdown">
          <div class="mb-row"><span class="mb-name">N+R</span><span class="mb-val">${fmt(kNR)}</span>${bdgMode(kNR,kpNR,"mb-badge")}</div>
          <div class="mb-row"><span class="mb-name">Hs. Conexión</span><span class="mb-val">${fmt(kSH)}</span></div>
        </div>
      </div>`;
  });
  html += `</div></div>`;

  // ── 4. Tendencias ─────────────────────────────────────────────────────────
  html += secH("📈", "#10b981", "Tendencias", "Peru y ciudades · 3 KPIs principales", "");
  html += `<div class="section">`;
  html += `<div style="font-weight:700;font-size:.78rem;color:#666;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">Peru Total</div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Conductores Activos</span><button class="png-btn" onclick="dlChart('chP_ad','AD_Peru')">PNG</button></div><div id="chP_ad"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Nuevos + Reactivados</span><button class="png-btn" onclick="dlChart('chP_nr','NR_Peru')">PNG</button></div><div id="chP_nr"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Horas de Conexión</span><button class="png-btn" onclick="dlChart('chP_sh','SH_Peru')">PNG</button></div><div id="chP_sh"></div></div>
  </div>`;
  CITIES.forEach(city => {
    const cr = filteredByCity[city];
    if (!cr.length) return;
    const cid = city.toLowerCase();
    const col = CITY_COLORS[city] || "#888";
    html += `<div style="font-weight:700;font-size:.78rem;color:${col};margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">${city}</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
      <div class="chart-card"><div class="chart-head"><span class="chart-title">Conductores Activos</span><button class="png-btn" onclick="dlChart('ch_${cid}_ad','AD_${city}')">PNG</button></div><div id="ch_${cid}_ad"></div></div>
      <div class="chart-card"><div class="chart-head"><span class="chart-title">Nuevos + Reactivados</span><button class="png-btn" onclick="dlChart('ch_${cid}_nr','NR_${city}')">PNG</button></div><div id="ch_${cid}_nr"></div></div>
      <div class="chart-card"><div class="chart-head"><span class="chart-title">Horas de Conexión</span><button class="png-btn" onclick="dlChart('ch_${cid}_sh','SH_${city}')">PNG</button></div><div id="ch_${cid}_sh"></div></div>
    </div>`;
  });
  html += `</div>`;

  // ── 5. Tabla ───────────────────────────────────────────────────────────────
  // Resumen de leads Yango para el encabezado
  const leadsSet  = new Set(apd.filter(r => r.date === lastDate && r.newService > 0).map(r => r.partner));
  const leadsNote = leadsSet.size > 0
    ? `<div class="leads-summary">★ ${leadsSet.size} partner${leadsSet.size > 1 ? "s reciben" : " recibe"} leads de Yango esta semana</div>`
    : "";
  html += secH("📋", "#6366f1", "Tabla de Partners", "Click en columna para ordenar", "");
  html += `<div class="section">${leadsNote}<div class="tbl-wrap"><div id="tblContainer"></div></div></div>`;

  // ── 6. Tarjetas por Partner ────────────────────────────────────────────────
  html += secH("🃏", "#FF0000", "KPIs por Partner", "Detalle del último período", "");
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
  ];
  CITIES.forEach(city => {
    const cr = filteredByCity[city];
    if (!cr.length) return;
    const cid = city.toLowerCase();
    const col = CITY_COLORS[city] || "#888";
    const cbd = aggCityDatec(cr, city);
    chartJobs.push(() => buildSingleLine(`ch_${cid}_ad`, dates, cbd, "ad", col, city));
    chartJobs.push(() => buildSingleLine(`ch_${cid}_nr`, dates, cbd, "nr", col, city));
    chartJobs.push(() => buildSingleLine(`ch_${cid}_sh`, dates, cbd, "sh", col, city));
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
function mkMetricCard(label, icon, val, prevWk, apd, lastRows, prevRows, metric, color, isCum) {
  function gv(rows) {
    if (metric === "nr") return sumR(rows, r => r.newPartner + r.newService + r.reactivated);
    if (metric === "sh") return sumR(rows, r => r.supplyHours);
    return sumR(rows, r => r.activeDrivers);
  }
  const lwVal = gv(lastRows);
  const pwVal = gv(prevRows);

  let html = `
    <div class="mcard" style="border-top:3px solid ${color}">
      <div class="mcard-label">${icon} ${label}</div>
      <div class="mcard-sub-label">${isCum ? "acumulado rango" : "última semana"}</div>
      <div class="mcard-val">${fmt(val)}</div>
      <div style="margin-top:4px">${bdgMode(lwVal, pwVal)}
        <span style="font-size:.7rem;color:#bbb;margin-left:5px">vs ${STATE.curMode === 'mensual' ? 'mes' : 'sem.'} anterior</span>
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
function buildTable(apd, lastDate, prevDate, sel) {
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
      co:           sumR(l,  r => r.commission),
      ns:           sumR(l,  r => r.newService),
      pad:          sumR(pr, r => r.activeDrivers),
      pnr:          sumR(pr, r => r.newPartner + r.newService + r.reactivated),
      tAD:          trendI(rows.map(r => r.activeDrivers)),
      declineAlert: hasConsecutiveDecline(apdFullByPartner, p)
    };
  });
  renderTable();
}

function renderTable() {
  const sorted = STATE.curSummaries.slice().sort((a, b) => {
    const va = a[STATE.tblSort.col], vb = b[STATE.tblSort.col];
    if (typeof va === "string")
      return STATE.tblSort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return STATE.tblSort.dir === "asc" ? va - vb : vb - va;
  });

  const cols = [
    { k: "partner", l: "Partner" }, { k: "kam", l: "KAM" },
    { k: "ad", l: "Cond. Activos" }, { k: "nr", l: "Nuevos+React" },
    { k: "sh", l: "Hs. Conexión" },  { k: "co", l: "Comision" },
    { k: "ns", l: "Leads Yango" }
  ];

  let h = `<table class="dtbl"><thead><tr>`;
  cols.forEach(c => {
    const s = STATE.tblSort.col === c.k ? (STATE.tblSort.dir === "asc" ? "sa" : "sd") : "";
    h += `<th class="${s}" onclick="sortTbl('${c.k}')">${c.l}</th>`;
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
      : `<span style="color:#ccc">${fmt(r.ns)}</span>`;
    h += `<tr data-partner="${escapeHTML(r.partner)}"${r.ns > 0 ? ' class="leads-row"' : ""}>
      <td>${pd}${alertBd}${escapeHTML(r.partner)}</td><td>${kd}${escapeHTML(r.kam)}</td>
      <td class="tn">${fmt(r.ad)}</td><td class="tn">${fmt(r.nr)}</td>
      <td class="tn">${fmt(r.sh)}</td><td class="tn">${fmtK(r.co)}</td>
      <td class="tn">${nsCell}</td>
      <td class="tn">${bdgMode(r.ad, r.pad, "tbadge")}</td>
      <td style="text-align:center;font-size:.85rem"><span style="${r.tAD.c}">${r.tAD.i}</span></td>
    </tr>`;
  });
  h += `</tbody></table>`;
  const el = document.getElementById("tblContainer");
  if (el) el.innerHTML = h;
}

function sortTbl(col) {
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
  const colKeys = ["partner","kam","ad","nr","sh","co","ns"];
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
function buildPartnerCards(apd, lastDate, prevDate, partners, sel) {
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
          <div class="pk-label">Cond. Activos</div>
          <div class="pk-val">${fmt(last.activeDrivers)}</div>
          ${bdgMode(last.activeDrivers, prevRow?.activeDrivers ?? null, "mb-badge")}
          <span style="${tA.c}">${tA.i}</span>
        </div>
        <div class="pk">
          <div class="pk-label">Hs. Conexión</div>
          <div class="pk-val">${fmt(last.supplyHours)}</div>
          ${bdgMode(last.supplyHours, prevRow?.supplyHours ?? null, "mb-badge")}
          <span style="${tH.c}">${tH.i}</span>
        </div>
        <div class="pk-wide">
          <div class="pk-label">
            Nuevos + Reactivados &nbsp;
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
function _rendKpiCard(label, icon, val, prev, color, fmtFn) {
  return `
    <div class="mcard" style="border-top:3px solid ${color}">
      <div class="mcard-label">${icon} ${label}</div>
      <div class="mcard-sub-label">snapshot último período</div>
      <div class="mcard-val">${fmtFn(val)}</div>
      <div style="margin-top:4px">${bdgMode(val, prev)}
        <span style="font-size:.7rem;color:#bbb;margin-left:5px">vs ${STATE.curMode === 'mensual' ? 'mes' : 'sem.'} anterior</span>
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
function _rendFleetAgg(rows) {
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
function _fleetAggByDate(rows) {
  const m = new Map();
  rows.forEach(r => { let a = m.get(r.date); if (!a) { a = []; m.set(r.date, a); } a.push(r); });
  const out = {};
  m.forEach((rs, d) => { out[d] = _rendFleetAgg(rs); });
  return out;
}
// Línea de un KPI de flota (Peru total) a lo largo del rango filtrado (no solo el
// último período — a diferencia de las tarjetas/tabla, que son snapshot).
const _FLEET_TREND_LABEL = {
  owned: "Owned Cars", shCar: "SH / Auto", accept: "Aceptación %", branded: "Branded Cars",
  gmvPerCar: "GMV / Auto", externalShShare: "% SH Externo"
};
function buildFleetTrendLine(elId, dates, byDate, key, color) {
  const data = dates.map(d => (byDate[d] ? byDate[d][key] : 0) || 0);
  buildLineChart(elId, dates, [{ name: _FLEET_TREND_LABEL[key] || key, data }], [color]);
}
// Donut "Owned Cars por Partner" — snapshot del último período, Top 6 + Otros.
// Parts-of-whole (dónde se concentra la flota) → donut es la elección correcta,
// no una línea (no es serie de tiempo).
function _buildFleetOwnedDonut(lastRows) {
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
function _buildFleetBrandedDonut(lastRows) {
  const agg = _rendFleetAgg(lastRows);
  const noBranded = Math.max(agg.owned - agg.branded, 0);
  buildDonutChart("chF_brandedDonut", ["Brandeados", "No brandeados"], [agg.branded, noBranded], ["#f59e0b", "#e2e8f0"]);
}
// Programa los charts de Fleet (tendencias + composición) diferidos con RAF — mismo
// patrón anti-freeze que pumpCharts() de Agregador. Aborta si cambia filtro/tab/línea
// mientras corre (evita pintar charts sobre un render ya obsoleto).
function _scheduleFleetCharts(filtered, dates, lastRows) {
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
function _renderFleetView(lastRows, prevRows, lastDate, prevDate) {
  const periodLabel = STATE.curMode === "mensual" ? "último mes" : "última semana";
  let html = rendLineToggleHTML();

  // Perú general (10 KPIs de flota: presencia/calidad + revenue/productividad)
  html += secH("🚗", "#0891b2", "Fleet · Perú General",
    `Presencia, calidad y revenue/productividad de flota · snapshot ${periodLabel}`,
    d2s(lastDate));
  html += _rendFleetCardsBody(_rendFleetAgg(lastRows), _rendFleetAgg(prevRows));

  // Tendencias (línea, Peru total, evolución del rango filtrado — no solo el
  // último período). Series continuas → línea es la lectura correcta (mismo
  // patrón que la sección "Tendencias" del Agregador).
  html += secH("📈", "#10b981", "Fleet · Tendencias", "Evolución Peru total en el rango filtrado", "");
  html += `<div class="section"><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px">
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Owned Fleet Cars</span><button class="png-btn" onclick="dlChart('chF_owned','Fleet_OwnedCars')">PNG</button></div><div id="chF_owned"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">SH / Auto (interno)</span><button class="png-btn" onclick="dlChart('chF_shcar','Fleet_SHAuto')">PNG</button></div><div id="chF_shcar"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Aceptación %</span><button class="png-btn" onclick="dlChart('chF_accept','Fleet_Aceptacion')">PNG</button></div><div id="chF_accept"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Branded Active Cars</span><button class="png-btn" onclick="dlChart('chF_branded','Fleet_Branded')">PNG</button></div><div id="chF_branded"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">GMV / Auto</span><button class="png-btn" onclick="dlChart('chF_gmvcar','Fleet_GMVporAuto')">PNG</button></div><div id="chF_gmvcar"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">% SH Externo (dependencia)</span><button class="png-btn" onclick="dlChart('chF_extsh','Fleet_PctSHExterno')">PNG</button></div><div id="chF_extsh"></div></div>
  </div></div>`;

  // Composición (donut, snapshot del último período) — dónde se concentra la
  // flota y qué tan brandeada está. Parts-of-whole (pocas categorías, una foto
  // en el tiempo) → donut, no línea.
  html += secH("🥯", "#7e22ce", "Fleet · Composición", `Snapshot ${d2s(lastDate)} · distribución, no tendencia`, "");
  html += `<div class="section"><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px">
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Owned Cars por Partner</span><button class="png-btn" onclick="dlChart('chF_ownedDonut','Fleet_OwnedPorPartner')">PNG</button></div><div id="chF_ownedDonut"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Brandeados vs No Brandeados</span><button class="png-btn" onclick="dlChart('chF_brandedDonut','Fleet_Brandeados')">PNG</button></div><div id="chF_brandedDonut"></div></div>
  </div></div>`;

  // Calidad y dependencia (scorecard, Perú total, snapshot) — métricas de riesgo/
  // madurez del negocio: se leen mejor como checklist compacto que como tiles
  // grandes (son secundarias frente a presencia/revenue de arriba).
  html += secH("🛡️", "#64748b", "Fleet · Calidad y Dependencia",
    `Riesgo operativo y madurez del negocio · snapshot ${periodLabel}`, "");
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
  html += secH("🏙️", "#06b6d4", "Fleet por Ciudad", "KPIs de flota por ciudad · comparativo con período anterior", "");
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
  html += secH("📋", "#6366f1", "Fleet por Partner", "Detalle de flota por partner · ordenado por autos propios", "");
  html += `<div class="section"><div class="tbl-wrap">${_rendFleetPartnerTable(lastRows, prevRows)}</div></div>`;
  return html;
}
function _rendFleetCardsBody(c, p) {
  const pct = v => fmt(v) + "%";
  // 10 tarjetas: el grid de 3 columnas de .metric-row se sobre-escribe inline con
  // auto-fit (no tocar la clase global — la usa también el Agregador con 3 cards).
  // auto-fit/minmax evita que se aplasten en pantallas angostas (envuelve a 2 filas).
  return `<div class="section"><div class="metric-row" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      ${_rendKpiCard("Owned Fleet Cars",   "🚗", c.owned,      p.owned,      "#0891b2", fmt)}
      ${_rendKpiCard("SH / Auto (interno)", "⏱️", c.shCar,      p.shCar,      "#8b5cf6", fmt)}
      ${_rendKpiCard("Aceptación",          "✅", c.accept,     p.accept,     "#10b981", pct)}
      ${_rendKpiCard("Branded Active Cars", "🏷️", c.branded,    p.branded,    "#f59e0b", fmt)}
      ${_rendKpiCard("% Brandeado",         "🎯", c.pctBranded, p.pctBranded, "#7e22ce", pct)}
      ${_rendKpiCard("GMV / Auto",          "💰", c.gmvPerCar,        p.gmvPerCar,        "#059669", fmt)}
      ${_rendKpiCard("Comisión / Auto",     "💵", c.commissionPerCar, p.commissionPerCar, "#059669", fmt)}
      ${_rendKpiCard("Viajes / Auto",       "🧭", c.tripsPerCar,      p.tripsPerCar,      "#0ea5e9", fmt)}
      ${_rendKpiCard("Viajes / Hora",       "⚡", c.tripsPerHour,     p.tripsPerHour,     "#0ea5e9", fmt)}
      ${_rendKpiCard("GMV / Hora",          "📈", c.moneyPerHour,     p.moneyPerHour,     "#059669", fmt)}
    </div></div>`;
}
// Scorecard compacto: filas label+valor+badge WoW/MoM apiladas en 1 tarjeta (a
// diferencia de _rendKpiCard, que es 1 tarjeta grande por métrica). Métricas de
// calidad/riesgo/dependencia son secundarias — se leen mejor como checklist que
// como 6 tiles gigantes.
function _rendFleetScorecard(items) {
  return `<div class="mcard" style="border-top:3px solid #64748b">
    ${items.map(it => `
      <div class="city-kpi">
        <span class="city-kpi-label">${it.label}</span>
        <div class="city-kpi-right"><span class="city-kpi-val">${it.fmtFn(it.val)}</span>${bdgMode(it.val, it.prev, "mb-badge")}</div>
      </div>`).join("")}
  </div>`;
}
function _rendFleetCityKpi(label, val, prev, fmtFn) {
  return `<div class="city-kpi">
    <span class="city-kpi-label">${label}</span>
    <div class="city-kpi-right"><span class="city-kpi-val">${fmtFn(val)}</span>${bdgMode(val, prev, "mb-badge")}</div>
  </div>`;
}
function _rendFleetPartnerTable(lastRows, prevRows) {
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
  if (!rows.length) return `<div style="padding:12px;color:#aaa;font-size:.8rem">Sin partners Fleet en el filtro actual.</div>`;
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
function _rendTkKPIs(lastRows, prevRows) {
  const agg = rows => {
    let branded = 0, actCars = 0;
    rows.forEach(r => { branded += r.brandedActiveCars || 0; actCars += r.activeCars || 0; });
    return { branded, actCars };
  };
  const c = agg(lastRows), p = agg(prevRows);
  return secH("🛺", "#7e22ce", "TukTuk · Autos",
      "Autos brandeados y activos del último período · solo sub-flotas TukTuk", "") +
    `<div class="section"><div class="metric-row">
      ${_rendKpiCard("Brandeados",  "🏷️", c.branded, p.branded, "#7e22ce", fmt)}
      ${_rendKpiCard("Active Cars", "🚗", c.actCars, p.actCars, "#0891b2", fmt)}
    </div></div>`;
}

// ── SECTION HEADER ─────────────────────────────────────────────────────────────
function secH(icon, bg, title, sub, tag) {
  return `<div class="sh">
    <div class="sh-icon" style="background:${bg}20">${icon}</div>
    <div>
      <div class="sh-title">${title}</div>
      <div class="sh-sub">${sub}</div>
    </div>
    ${tag ? `<span class="sh-tag">${tag}</span>` : ""}
  </div>`;
}