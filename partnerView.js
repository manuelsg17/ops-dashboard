// partnerView.js — Vista detallada de un partner individual
// Pensado para reuniones semanales/mensuales con el partner.
// Estructura: header, KPIs globales, sección por ciudad con charts.

const PARTNER_VIEW_STATE = {
  partner: null,
  period:  "auto",   // auto | 3m | 6m | 12m | custom
  charts:  []        // ApexCharts instances
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function _pvDestroyCharts() {
  PARTNER_VIEW_STATE.charts.forEach(c => { try { c.destroy(); } catch(e){} });
  PARTNER_VIEW_STATE.charts = [];
}

// Cuántos puntos mostrar según escala
function _pvDefaultPoints(mode) {
  if (mode === "mensual") return 12;
  if (mode === "diario")  return 30;
  return 13; // semanal
}

// Devuelve las últimas N fechas disponibles (subset de STATE.allDates)
function _pvLastNDates(n) {
  const all = STATE.allDates || [];
  return all.slice(-n);
}

// Agrega rawData filtrado por partner + ciudad, devuelve array { date, ad, nr, sh,
// trips, commission, npPartner (newPartner only), npService (newService only), reactivated }
function _pvSeriesByPartnerCity(partner, city, dates) {
  const datesSet = new Set(dates);
  const byDate = {};
  // Solo rows de este partner y esta ciudad y dentro del rango
  const rows = (STATE._byPartner?.get(partner) || STATE.rawData.filter(r => r.partner === partner))
    .filter(r => r.city === city && datesSet.has(r.date));
  rows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = {
      date: r.date, ad: 0, nr: 0, sh: 0,
      trips: 0, commission: 0,
      npPartner: 0, npService: 0, reactivated: 0
    };
    const e = byDate[r.date];
    // AD es snapshot: max entre CLIDs duplicados del mismo partner+ciudad+fecha
    if ((r.activeDrivers || 0) > e.ad) e.ad = r.activeDrivers || 0;
    e.npPartner   += r.newPartner;
    e.npService   += r.newService;
    e.reactivated += r.reactivated;
    e.nr = e.npPartner + e.npService + e.reactivated;
    e.sh += r.supplyHours;
    e.trips      += r.trips || 0;
    e.commission += r.commission || 0;
  });
  return dates.map(d => byDate[d] || {
    date: d, ad: 0, nr: 0, sh: 0,
    trips: 0, commission: 0,
    npPartner: 0, npService: 0, reactivated: 0
  });
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
function renderPartnerView() {
  const el = document.getElementById("partnerViewContent");
  if (!el) return;
  ensureIndexes();
  _pvDestroyCharts();
  // Reset _seriesCache: la siguiente seccion lo repuebla solo para el render
  // actual. Evita acumulacion sin limite si el usuario navega muchos partners.
  PARTNER_VIEW_STATE._seriesCache = {};

  if (!STATE.rawData.length) {
    el.innerHTML = `<div class="empty"><p>Carga datos de <strong>Rendimiento</strong> para usar Vista Partner.</p></div>`;
    return;
  }

  const partners = STATE.allPartners || [];
  if (!partners.length) {
    el.innerHTML = `<div class="empty"><p>No hay partners cargados.</p></div>`;
    return;
  }

  // Estado: partner seleccionado (default = primero)
  if (!PARTNER_VIEW_STATE.partner || !partners.includes(PARTNER_VIEW_STATE.partner)) {
    PARTNER_VIEW_STATE.partner = partners[0];
  }
  const partner = PARTNER_VIEW_STATE.partner;

  // Período auto-detect por escala
  const period = PARTNER_VIEW_STATE.period;
  const nPoints = period === "auto"
    ? _pvDefaultPoints(STATE.curMode)
    : (period === "3m" ? 3 : period === "6m" ? 6 : period === "12m" ? 12 : 13);
  const dates = _pvLastNDates(nPoints);
  if (!dates.length) {
    el.innerHTML = `<div class="empty"><p>Sin fechas disponibles en este modo.</p></div>`;
    return;
  }

  // Ciudades donde opera este partner (>= 1 row con datos)
  const partnerRows = STATE._byPartner?.get(partner) || STATE.rawData.filter(r => r.partner === partner);
  const citiesOf = [...new Set(partnerRows.map(r => r.city).filter(Boolean))].sort();
  const kam = getKAMForPartner(partner) || partnerRows[0]?.kam || "Sin KAM";

  // Detectar si recibe leads Yango (algún new_from_service > 0 históricamente)
  const recibeLeads = partnerRows.some(r => r.newService > 0);

  // KPIs globales del partner: último período del rango
  const lastDate = dates[dates.length - 1];
  const prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
  const lastRows = partnerRows.filter(r => r.date === lastDate);
  const prevRows = prevDate ? partnerRows.filter(r => r.date === prevDate) : [];
  const tAD = lastRows.reduce((s, r) => Math.max(s, r.activeDrivers), 0);  // max por ciudad
  // Para AD a nivel global mejor sumar ciudades del último period
  const adByCityLast = {};
  lastRows.forEach(r => { adByCityLast[r.city] = (adByCityLast[r.city] || 0) + r.activeDrivers; });
  const tADsum = Object.values(adByCityLast).reduce((s, v) => s + v, 0);
  const tNR = lastRows.reduce((s, r) => s + r.newPartner + r.newService + r.reactivated, 0);
  const tSH = lastRows.reduce((s, r) => s + r.supplyHours, 0);
  const tTr = lastRows.reduce((s, r) => s + (r.trips || 0), 0);
  const tCo = lastRows.reduce((s, r) => s + (r.commission || 0), 0);
  const pAD = prevRows.reduce((acc, r) => { acc[r.city] = (acc[r.city] || 0) + r.activeDrivers; return acc; }, {});
  const pADsum = Object.values(pAD).reduce((s, v) => s + v, 0);
  const pNR = prevRows.reduce((s, r) => s + r.newPartner + r.newService + r.reactivated, 0);
  const pSH = prevRows.reduce((s, r) => s + r.supplyHours, 0);

  // Building HTML
  const partnerColor = STATE.partnerColors[partner] || "#FF0000";
  const periodLabel = STATE.curMode === "mensual" ? `${nPoints} meses`
                    : STATE.curMode === "diario"  ? `${nPoints} días`
                    : `${nPoints} semanas`;

  let html = `
    <div style="padding:0 8px 16px">
      <!-- Controles -->
      <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:8px 0 16px">
        <div style="position:relative">
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">Partner</label>
          <input type="text" id="pvSearch" class="sb-inp" placeholder="Buscar partner..." style="width:240px" autocomplete="off"
            value="${escapeHTML(partner)}"
            oninput="pvFilterPartners(this.value)"
            onfocus="pvShowPartnerList()"
            onblur="setTimeout(pvHidePartnerList, 200)"
            onkeydown="pvSearchKeydown(event)"/>
          <div id="pvPartnerList" style="display:none;position:absolute;top:100%;left:0;width:240px;max-height:280px;overflow-y:auto;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.12);z-index:100;margin-top:2px"></div>
        </div>
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">Período</label>
          <select id="pvPeriodSel" class="sb-sel" style="width:200px" onchange="pvOnPeriodChange(this.value)">
            ${_pvPeriodOptions(period, periodLabel)}
          </select>
        </div>
        <button style="padding:8px 16px;margin-left:auto;background:#FF0000;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:.85rem" onclick="pvDownloadPDF()">
          📤 Descargar PDF
        </button>
      </div>

      <!-- Header partner -->
      <div style="background:linear-gradient(135deg,${partnerColor}10 0%,#fff 100%);border-left:4px solid ${partnerColor};border-radius:10px;padding:14px 18px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span style="width:12px;height:12px;border-radius:50%;background:${partnerColor}"></span>
          <span style="font-size:1.25rem;font-weight:900;color:#111">${escapeHTML(partner)}</span>
          <span style="background:${KAM_COLORS[kam]||"#888"};color:#fff;font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:12px;margin-left:8px">${escapeHTML(kam)}</span>
        </div>
        <div style="font-size:.78rem;color:#666">
          Ciudades: <strong>${citiesOf.map(escapeHTML).join(" · ")}</strong>
          ${recibeLeads ? ` <span style="margin-left:10px;font-size:.7rem;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:8px">★ Recibe leads Yango</span>` : ""}
          <br>Período: ${d2s(dates[0])} → ${d2s(lastDate)} · Escala: <strong>${STATE.curMode}</strong>
        </div>
      </div>

      <!-- KPIs globales -->
      ${_secH("⚡", "#FF0000", "KPIs del último período", `${d2s(lastDate)}`)}
      <div class="section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
        ${_pvKpiCard(METRICS.ad.label, tADsum, pADsum, METRICS.ad.color)}
        ${_pvKpiCard(METRICS.nr.label, tNR,    pNR,    METRICS.nr.color)}
        ${_pvKpiCard(METRICS.sh.label, tSH,    pSH,    METRICS.sh.color)}
        ${_pvKpiCard("Viajes",         tTr,    null,   "#10b981")}
        ${_pvKpiCard("Comisión",       tCo,    null,   "#06b6d4", true)}
      </div>

      <!-- Sección por ciudad -->
      ${_secH("🏙️", "#06b6d4", "Detalle por Ciudad", `${citiesOf.length} ciudad${citiesOf.length>1?"es":""} · ${periodLabel}`)}
      <div class="section">
        ${citiesOf.map(city => {
          // Cachear series por ciudad para no recalcular en buildCharts
          if (!PARTNER_VIEW_STATE._seriesCache) PARTNER_VIEW_STATE._seriesCache = {};
          const ck = `${partner}|||${city}|||${dates.join(",")}`;
          if (!PARTNER_VIEW_STATE._seriesCache[ck]) {
            PARTNER_VIEW_STATE._seriesCache[ck] = _pvSeriesByPartnerCity(partner, city, dates);
          }
          return _pvCitySection(partner, city, dates, recibeLeads, PARTNER_VIEW_STATE._seriesCache[ck]);
        }).join("")}
      </div>
    </div>`;

  // Marca de render unica para evitar race conditions de setTimeout
  const renderId = (PARTNER_VIEW_STATE._renderId = (PARTNER_VIEW_STATE._renderId || 0) + 1);
  el.innerHTML = html;

  // Construir charts despues de innerHTML. Si llega otro render antes,
  // el renderId cambia y el setTimeout previo se ignora.
  setTimeout(() => {
    if (renderId !== PARTNER_VIEW_STATE._renderId) return;
    citiesOf.forEach(city => {
      const ck = `${partner}|||${city}|||${dates.join(",")}`;
      const series = PARTNER_VIEW_STATE._seriesCache?.[ck] || _pvSeriesByPartnerCity(partner, city, dates);
      _pvBuildCityCharts(partner, city, dates, recibeLeads, series);
    });
  }, 100);
}

function _pvKpiCard(label, cur, prev, color, isMoney = false) {
  const value = isMoney ? `$${fmt(cur)}` : fmt(cur);
  const bdgHtml = prev !== null ? bdgMode(cur, prev, "mb-badge") : "";
  return `
    <div style="background:#fff;border:1px solid #eee;border-top:3px solid ${color};border-radius:10px;padding:10px 12px">
      <div style="font-size:.66rem;color:#666;font-weight:700;text-transform:uppercase;letter-spacing:.4px">${escapeHTML(label)}</div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:2px">
        <span style="font-size:1.15rem;font-weight:900;color:#111">${value}</span>
        ${bdgHtml}
      </div>
    </div>`;
}

function _pvCitySection(partner, city, dates, recibeLeads, seriesCached) {
  const cityColor = CITY_COLORS[city] || "#888";
  const series = seriesCached || _pvSeriesByPartnerCity(partner, city, dates);
  // Tendencia: comparar promedio últimos 3 vs anteriores 3 (si hay datos)
  let trendTxt = "—", trendCol = "#888";
  if (series.length >= 6) {
    const last3 = series.slice(-3);
    const prev3 = series.slice(-6, -3);
    const avgL = last3.reduce((s, x) => s + x.ad, 0) / 3;
    const avgP = prev3.reduce((s, x) => s + x.ad, 0) / 3;
    if (avgP > 0) {
      const chg = ((avgL - avgP) / avgP) * 100;
      trendTxt = `${chg >= 0 ? "↑" : "↓"} ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% AD (últ. 3 vs ant. 3)`;
      trendCol = chg >= 0 ? "#10b981" : "#FF0000";
    }
  }

  const id = city.toLowerCase().replace(/[^a-z0-9]/g, "");

  return `
    <div style="border:1px solid #eee;border-top:3px solid ${cityColor};border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:12px;height:12px;border-radius:50%;background:${cityColor}"></span>
          <span style="font-size:1rem;font-weight:800;color:#111">${escapeHTML(city)}</span>
        </div>
        <span style="font-size:.72rem;color:${trendCol};font-weight:700">${trendTxt}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
        <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(METRICS.ad.label)}</span></div><div id="pv_${id}_ad"></div></div>
        <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(METRICS.sh.label)}</span></div><div id="pv_${id}_sh"></div></div>
        <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(METRICS.nr.label)} ${recibeLeads ? "(desglose)" : ""}</span></div><div id="pv_${id}_nr"></div></div>
        <div class="chart-card"><div class="chart-head"><span class="chart-title">Viajes & Comisión</span></div><div id="pv_${id}_tc"></div></div>
      </div>
    </div>`;
}

function _pvBuildCityCharts(partner, city, dates, recibeLeads, seriesCached) {
  const id = city.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cityColor = CITY_COLORS[city] || "#888";
  const series = seriesCached || _pvSeriesByPartnerCity(partner, city, dates);
  const labels = dates.map(d2s);

  // Chart 1: AD (línea simple)
  _pvSimpleLine(`pv_${id}_ad`, labels, [{ name: "AD", data: series.map(s => s.ad) }], [cityColor]);

  // Chart 2: SH (línea simple)
  _pvSimpleLine(`pv_${id}_sh`, labels, [{ name: "SH", data: series.map(s => s.sh) }], ["#8b5cf6"]);

  // Chart 3: N+R desglosado o agregado
  const nrSeries = recibeLeads
    ? [
        { name: "Nuevos (Partner)",  data: series.map(s => s.npPartner) },
        { name: "Nuevos (Yango)",    data: series.map(s => s.npService) },
        { name: "Reactivados",       data: series.map(s => s.reactivated) }
      ]
    : [
        { name: "Nuevos (Partner)",  data: series.map(s => s.npPartner) },
        { name: "Reactivados",       data: series.map(s => s.reactivated) }
      ];
  const nrColors = recibeLeads ? ["#3b82f6", "#f59e0b", "#10b981"] : ["#3b82f6", "#10b981"];
  _pvStackedColumn(`pv_${id}_nr`, labels, nrSeries, nrColors);

  // Chart 4: Trips & Commission (mixed)
  _pvDualLine(`pv_${id}_tc`, labels,
    [{ name: "Viajes", data: series.map(s => s.trips) },
     { name: "Comisión", data: series.map(s => s.commission) }],
    ["#10b981", "#06b6d4"]);
}

function _pvSimpleLine(elId, labels, series, colors) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  // Marcar el contenedor con clase para que las reglas CSS de fondo claro
  // (styles.css .pv-chart .apexcharts-datalabel-background) apliquen.
  el.classList.add("pv-chart");
  const ch = new ApexCharts(el, {
    series,
    chart: { type: "line", height: 180, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    stroke: { curve: "smooth", width: 2.5 },
    colors,
    markers: { size: 3 },
    // dataLabels: numeros visibles sobre la linea. El FILL del background lo
    // setea ApexCharts segun la serie (negro/oscuro por default) y NO se puede
    // cambiar via API. Forzamos blanco con CSS en styles.css.
    dataLabels: {
      enabled: true,
      formatter: v => fmt(v),
      style: { fontSize: "9px", colors: ["#222"], fontWeight: 700 },
      background: { enabled: true, foreColor: "#222", padding: 3, borderRadius: 3, borderColor: "#e5e5e5", borderWidth: 1, opacity: 1 },
      offsetY: -8
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { formatter: v => fmt(v), style: { fontSize: "10px" } } },
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4 },
    tooltip: { y: { formatter: v => fmt(v) } },
    legend: { show: false }
  });
  ch.render();
  PARTNER_VIEW_STATE.charts.push(ch);
}

function _pvStackedColumn(elId, labels, series, colors) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  const ch = new ApexCharts(el, {
    series,
    chart: { type: "bar", height: 180, stacked: true, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    plotOptions: { bar: { columnWidth: "60%", dataLabels: { position: "center" } } },
    colors,
    // dataLabels chicos para que entren dentro de cada segmento de la barra.
    // Solo se muestran si el valor es >= 3 (evita ruido en segmentos minusculos).
    dataLabels: {
      enabled: true,
      formatter: v => (v >= 3 ? fmt(v) : ""),
      style: { fontSize: "8px", colors: ["#fff"], fontWeight: 700 },
      dropShadow: { enabled: true, top: 1, left: 1, blur: 1, opacity: .35 }
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 } },
    yaxis: { labels: { formatter: v => fmt(v), style: { fontSize: "10px" } } },
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4 },
    tooltip: { y: { formatter: v => fmt(v) } },
    legend: { position: "bottom", fontSize: "10px", itemMargin: { horizontal: 6 } }
  });
  ch.render();
  PARTNER_VIEW_STATE.charts.push(ch);
}

function _pvDualLine(elId, labels, series, colors) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  const ch = new ApexCharts(el, {
    series,
    chart: { type: "line", height: 180, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    stroke: { curve: "smooth", width: [2.5, 2.5] },
    colors,
    markers: { size: 3 },
    dataLabels: {
      enabled: true,
      enabledOnSeries: [0, 1],
      formatter: (v, opts) => opts.seriesIndex === 1 ? "$" + fmt(v) : fmt(v),
      style: { fontSize: "9px", colors: ["#222"], fontWeight: 700 },
      background: { enabled: true, foreColor: "#222", padding: 3, borderRadius: 3, borderColor: "#e5e5e5", borderWidth: 1, opacity: 1 },
      offsetY: -8
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 } },
    yaxis: [
      { seriesName: "Viajes", labels: { formatter: v => fmt(v), style: { fontSize: "10px" } } },
      { opposite: true, seriesName: "Comisión", labels: { formatter: v => "$" + fmt(v), style: { fontSize: "10px" } } }
    ],
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4 },
    tooltip: { y: { formatter: (v, { seriesIndex }) => seriesIndex === 1 ? "$" + fmt(v) : fmt(v) } },
    legend: { position: "bottom", fontSize: "10px" }
  });
  ch.render();
  PARTNER_VIEW_STATE.charts.push(ch);
}

// ── INTERACCIONES ─────────────────────────────────────────────────────────────
function pvOnPartnerChange(p) {
  PARTNER_VIEW_STATE.partner = p;
  renderPartnerView();
}

function pvOnPeriodChange(p) {
  PARTNER_VIEW_STATE.period = p;
  renderPartnerView();
}

// ── COMBOBOX FLOTANTE DE PARTNERS ─────────────────────────────────────────────
// Reemplaza el <select> nativo que se cerraba en cada keystroke. La lista es
// un <div> flotante que NO se re-renderiza (solo cambian items visibles),
// asi que el input nunca pierde focus y se puede hacer click en una opcion.
function pvFilterPartners(q) {
  pvShowPartnerList();
  _pvPaintPartnerList(q);
}

function pvShowPartnerList() {
  const list = document.getElementById("pvPartnerList");
  if (!list) return;
  list.style.display = "block";
  if (!list.innerHTML) {
    const inp = document.getElementById("pvSearch");
    _pvPaintPartnerList(inp ? inp.value : "");
  }
}

function pvHidePartnerList() {
  const list = document.getElementById("pvPartnerList");
  if (list) list.style.display = "none";
}

function _pvPaintPartnerList(q) {
  const list = document.getElementById("pvPartnerList");
  if (!list) return;
  const lower = (q || "").toLowerCase().trim();
  const filtered = lower
    ? STATE.allPartners.filter(p => p.toLowerCase().includes(lower))
    : STATE.allPartners;
  if (!filtered.length) {
    list.innerHTML = `<div style="padding:8px 12px;font-size:.78rem;color:#aaa">Sin coincidencias</div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 100).map(p => {
    const c = STATE.partnerColors[p] || "#888";
    const sel = p === PARTNER_VIEW_STATE.partner;
    return `<div class="pv-opt" onmousedown="pvSelectPartner('${p.replace(/'/g,"\\'")}')"
      style="padding:7px 12px;font-size:.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid #f3f3f3;${sel?'background:#fff0f0;font-weight:700':''}">
      <span style="width:7px;height:7px;border-radius:50%;background:${c};flex-shrink:0"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(p)}</span>
    </div>`;
  }).join("");
}

function pvSelectPartner(p) {
  // onmousedown asegura que esto corra ANTES del onblur del input (que oculta la lista)
  const inp = document.getElementById("pvSearch");
  if (inp) inp.value = p;
  pvHidePartnerList();
  pvOnPartnerChange(p);
}

function pvSearchKeydown(e) {
  if (e.key === "Enter") {
    const list = document.getElementById("pvPartnerList");
    const first = list && list.querySelector(".pv-opt");
    if (first) {
      // Reusar el handler del onmousedown
      first.dispatchEvent(new MouseEvent("mousedown"));
    }
    e.preventDefault();
  } else if (e.key === "Escape") {
    pvHidePartnerList();
  }
}

// ── OPCIONES DINAMICAS DE PERIODO ─────────────────────────────────────────────
// Etiquetas claras segun el modo actual (semanal/mensual/diario). Antes decian
// "Ultimos 3 (cortos)", "Ultimos 6" sin unidad — confuso.
function _pvPeriodOptions(period, periodLabel) {
  const mode = STATE.curMode;
  const unit = mode === "mensual" ? "meses" : mode === "diario" ? "días" : "semanas";
  return `
    <option value="auto" ${period==="auto"?"selected":""}>Auto (${periodLabel})</option>
    <option value="3m"   ${period==="3m" ?"selected":""}>Últim${unit==="meses"?"os 3":unit==="días"?"os 3":"as 3"} ${unit}</option>
    <option value="6m"   ${period==="6m" ?"selected":""}>Últim${unit==="meses"?"os 6":unit==="días"?"os 6":"as 6"} ${unit}</option>
    <option value="12m"  ${period==="12m"?"selected":""}>Últim${unit==="meses"?"os 12":unit==="días"?"os 12":"as 12"} ${unit}</option>`;
}

// ── EXPORT PDF ────────────────────────────────────────────────────────────────
async function pvDownloadPDF() {
  const partner = PARTNER_VIEW_STATE.partner;
  if (!partner) { alert("Selecciona un partner primero."); return; }
  if (!window.jspdf || !window.html2canvas) { alert("Librerias PDF no disponibles."); return; }

  showLoad(true, "Generando PDF...");
  await new Promise(r => setTimeout(r, 200));
  try {
    const content = document.getElementById("partnerViewContent");
    const canvas = await html2canvas(content, { scale: 2, useCORS: true, logging: false, backgroundColor: "#fff" });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
    pdf.save(`${partner}_${STATE.curMode}_${(new Date()).toISOString().slice(0,10)}.pdf`);
    showBanner(true, "PDF descargado");
  } catch (err) {
    alert("Error al generar PDF: " + err.message);
    console.error(err);
  } finally {
    showLoad(false);
  }
}
