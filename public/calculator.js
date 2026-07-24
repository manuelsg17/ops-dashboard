// calculator.js — Calculadora de Metas (flujo por PESTAÑAS de línea de negocio)
// El KAM ingresa su meta TOTAL por línea y se reparte (disgrega) a cada partner+ciudad
// segun su % de representacion en el ULTIMO MES. En vez de un scroll con 6+ tablas,
// se navega por pestañas: Agregador / Fleet / TukTuk / Revisar y compartir.
// Solo se muestra la pestaña activa (primera pantalla corta); la cabecera persistente
// lleva el selector de KAM + una barra de estado con el cuadre EN VIVO de cada línea.
// Las pestañas Fleet/TukTuk solo aparecen si el KAM tiene esos partners.

const CALC_STATE = {
  kam:        "all",
  tab:        "agg",   // pestaña activa: "agg" | "fleet" | "tk" | "review"
  // Metas editadas manualmente: { "partner|||city|||metric": valor }
  edits:      {},
  // Utilización Fleet sembrada en 85 (default estándar) por key ya sembrada — así
  // el 85 visible en la pestaña Fleet llega a la tarjeta y al guardado; borrable.
  _utilSeeded: {},
  // Metas KAM input manual (formato Yango con pesos) + metas TukTuk (Fase 7)
  kamGoals:   { ad: 0, sh: 0, nr: 0, otherProj: 0, fleetA2: 0, tkAd: 0, tkNr: 0, tkCars: 0, tkSh: 0 },
  // Idioma de la tarjeta compartible: "es" | "en" | "es-en" (bilingüe, default)
  exportLang: "es-en"
};

// Pesos Yango (formato KAM-level)
const KAM_WEIGHTS = {
  ad:        15,    // %
  sh:        15,
  nr:        27.5,
  otherProj: 35,
  fleetA2:    7.5
};

// Métricas por línea (estáticas). get(e) sobre una fila agregada partner-ciudad.
const CALC_TAXI_METRICS = [
  { key: "ad", label: "AD",  get: e => e.ad },
  { key: "sh", label: "SH",  get: e => e.sh },
  { key: "nr", label: "N+R", get: e => e.np + e.ns + e.re }
];
const CALC_TK_METRICS = [
  { key: "ad",   label: "AD",   get: e => e.ad },
  { key: "nr",   label: "N+R",  get: e => e.np + e.ns + e.re },
  { key: "cars", label: "Cars", get: e => e.bcars },
  { key: "sh",   label: "SH",   get: e => e.sh }
];

// ── HELPER: dataset mensual (rendimiento_mensual) ─────────────────────────────
function _calcGetMensualData() {
  if (STATE.rawDataMensual && STATE.rawDataMensual.length) return STATE.rawDataMensual;
  return STATE.rawData || [];
}

// Devuelve los N últimos meses (claves YYYY-MM) presentes en el dataset
function _calcLastNMonths(rows, n) {
  const months = [...new Set(rows.map(r => r.date))].sort();
  return months.slice(-n);
}

// Agrega por partner+city sobre un set de meses específicos.
// Devuelve Map<"partner|||city", { clid, trips, sh, ad, np, ns, re, partner, city, kam }>
function _calcAggByPartnerCity(rows, monthsSet) {
  const out = new Map();
  rows.forEach(r => {
    if (!monthsSet.has(r.date)) return;
    const k = `${r.partner}|||${r.city}`;
    let e = out.get(k);
    if (!e) {
      e = { clid: r.clid || "", partner: r.partner, city: r.city, kam: r.kam,
            trips: 0, sh: 0, ad: 0, np: 0, ns: 0, re: 0, bcars: 0,
            acceptW: 0, intSh: 0, ownedCars: 0, _adByDate: {}, _bcarsByDate: {} };
      out.set(k, e);
    }
    if (!e.clid && r.clid) e.clid = r.clid;
    e.trips += r.trips || 0;
    e.sh    += r.supplyHours || 0;
    // AD y branded cars son SNAPSHOT: los fleetrooms (db_id distintos) de la MISMA
    // fecha se SUMAN (son conductores/autos distintos) y se toma el MÁX entre fechas.
    // Antes se hacía max sobre TODAS las filas → sub-contaba partners multi-fleetroom
    // (tomaba el fleetroom más grande, no la suma). Espeja getRPC (metas.js/Rendimiento).
    e._adByDate[r.date]    = (e._adByDate[r.date]    || 0) + (r.activeDrivers || 0);
    e._bcarsByDate[r.date] = (e._bcarsByDate[r.date] || 0) + (r.brandedActiveCars || 0);
    e.np    += r.newPartner || 0;
    e.ns    += r.newService || 0;
    e.re    += r.reactivated || 0;
    // Referencias fleet (tasas). SH/Auto interno = Σ internal_fleet_sh / Σ owned_fleet_active_cars
    // (MISMA definición que usa el deck/Metas como ACTUAL; antes se usaba sh_per_active_car
    // que medía otra cosa → la meta que fijaba el KAM nunca cuadraba con el actual).
    // Acceptance (0-1) ponderada por viajes.
    e.intSh     += r.internalFleetSh || 0;
    e.ownedCars += r.ownedFleetActiveCars || 0;
    e.acceptW   += (r.acceptanceRate || 0) * (r.trips || 0);
  });
  // Colapsar snapshots: máx sobre fechas de la suma por fecha (suma de fleetrooms).
  for (const e of out.values()) {
    const ads = Object.values(e._adByDate), bcs = Object.values(e._bcarsByDate);
    e.ad    = ads.length ? Math.max(...ads) : 0;
    e.bcars = bcs.length ? Math.max(...bcs) : 0;
    delete e._adByDate; delete e._bcarsByDate;
  }
  return out;
}

// Referencia 3m (promedio ponderado) de los KPIs fleet de un partner-ciudad.
function _calcFleetRef(e) {
  return {
    shcar:  e.ownedCars > 0 ? e.intSh / e.ownedCars : null,      // SH interno / auto propio (= deck/Metas)
    accept: e.trips > 0 ? (e.acceptW / e.trips) * 100 : null     // % (0-100)
  };
}

// Fallback: busca el CLID de un partner+city en los datasets si la fila agregada no lo tiene.
function _calcLookupClid(partner, city) {
  const datasets = [STATE.rawDataMensual, STATE.rawData, STATE.rawDataDiario];
  for (const ds of datasets) {
    if (!ds || !ds.length) continue;
    const row = ds.find(r => r.partner === partner && r.city === city && r.clid);
    if (row) return row.clid;
  }
  for (const [clid, p] of Object.entries(STATE.CLID_MAP || {})) {
    if (p === partner) return clid;
  }
  return "";
}

// Totales del KAM (base para repartir): suma de los valores de cada partner+ciudad.
// opts.excludeFleet salta partners fleet (isFleetPartner) → los NO-fleet suman 100%
// (el reparto de agregador no depende de partners fleet). Incluye cars (TukTuk).
function _calcKamTotals(agg, opts) {
  const skipFleet = opts && opts.excludeFleet;
  let ad = 0, sh = 0, nr = 0, cars = 0;
  for (const e of agg.values()) {
    if (skipFleet && _calcIsFleet(e.partner)) continue;
    ad += e.ad; sh += e.sh; nr += (e.np + e.ns + e.re); cars += e.bcars || 0;
  }
  return { ad, sh, nr, cars };
}
// Totales TukTuk (AD/N+R/cars/SH) — alias semántico sobre _calcKamTotals.
function _calcTkTotals(agg, opts) { const t = _calcKamTotals(agg, opts); return { ad: t.ad, nr: t.nr, cars: t.cars, sh: t.sh }; }

// Totales por CIUDAD para UN mes, sobre TODOS los partners (NO filtrado por KAM):
// es el denominador exacto del "peso de Yego en Lima". Reusa _calcAggByPartnerCity
// (mismo criterio de agregación: AD/cars = max, resto suma) y colapsa por ciudad.
function _calcCityTotals(month, rows) {
  const aggFull = _calcAggByPartnerCity(rows || [], new Set([month]));
  const byCity = new Map();
  for (const e of aggFull.values()) {
    let c = byCity.get(e.city);
    if (!c) { c = { ad: 0, sh: 0, nr: 0, cars: 0 }; byCity.set(e.city, c); }
    c.ad += e.ad; c.sh += e.sh; c.nr += (e.np + e.ns + e.re); c.cars += e.bcars || 0;
  }
  return byCity;
}
function _calcShare(val, tot) { return tot > 0 ? val / tot : 0; }
function _calcIsFleet(partner) { return typeof isFleetPartner === "function" && isFleetPartner(partner); }

// Bases distribuidas de AGREGADOR (AD/SH/N+R) para un partner-ciudad.
// Los partners Fleet SÍ se reparten con la MISMA ecuación (goal × share) y el
// denominador incluye a TODOS (cartTotals) → así no se sobre-exige a los no-fleet.
// `fleet` queda solo como badge. `noAct` marca partners sin actividad Taxi el último
// mes (share 0 → meta 0): se resaltan para fijar la meta a mano (decisión del KAM).
function _calcAggMetaBases(e, g, cartTotals) {
  const fleet = _calcIsFleet(e.partner);
  const nr = e.np + e.ns + e.re;
  const noAct = (e.ad + e.sh + nr) === 0;
  return {
    ad: (+g.ad || 0) * _calcShare(e.ad, cartTotals.ad),
    sh: (+g.sh || 0) * _calcShare(e.sh, cartTotals.sh),
    nr: (+g.nr || 0) * _calcShare(nr,  cartTotals.nr),
    fleet, noAct
  };
}
// Bases distribuidas TukTuk (AD/N+R/cars/SH).
function _calcTkBases(e, g, distTotals) {
  const nr = e.np + e.ns + e.re;
  return {
    ad:   (+g.tkAd   || 0) * _calcShare(e.ad,    distTotals.ad),
    nr:   (+g.tkNr   || 0) * _calcShare(nr,      distTotals.nr),
    cars: (+g.tkCars || 0) * _calcShare(e.bcars, distTotals.cars),
    sh:   (+g.tkSh   || 0) * _calcShare(e.sh,    distTotals.sh)
  };
}

// Meta distribuida o edit manual para un partner+city+metric.
function _calcGoalFor(partner, city, metric, base) {
  const k = `${partner}|||${city}|||${metric}`;
  if (CALC_STATE.edits[k] !== undefined) return +CALC_STATE.edits[k] || 0;
  return Math.round(base);
}

// Heatmap helpers (% de representación)
function _calcHeatColor(pct) {
  if (pct >= 20) return "#10b981";
  if (pct >= 10) return "#22c55e";
  if (pct >= 5)  return "#f59e0b";
  if (pct >= 1)  return "#fb923c";
  return "#FF0000";
}
function _calcHeatBg(pct) {
  if (pct >= 20) return "#bbf7d0";
  if (pct >= 10) return "#d9f99d";
  if (pct >= 5)  return "#fef3c7";
  if (pct >= 1)  return "#fed7aa";
  return "#fecaca";
}

// ── MODELO EN MEMORIA ─────────────────────────────────────────────────────────
// Deriva todos los agregados que necesita la pestaña activa + la barra de estado.
// Barato (todo en memoria); lo llaman renderCalculator Y _calcRefreshStatus.
function _calcComputeModel() {
  const rows = _calcGetMensualData();
  const allMonths = [...new Set(rows.map(r => r.date))].sort();
  const last3 = allMonths.slice(-3);
  const last3Set = new Set(last3);
  const lastMonth = allMonths[allMonths.length - 1];

  const filteredRows = CALC_STATE.kam === "all"
    ? rows
    : rows.filter(r => (r.kam || getKAMForPartner(r.partner)) === CALC_STATE.kam);

  // Agregados TAXI: 3M para el promedio y las refs fleet; ÚLTIMO MES para
  // representación y reparto (así el % que se ve = el que reparte). distTot1 excluye fleet.
  const aggLast3 = _calcAggByPartnerCity(filteredRows, last3Set);
  const aggLast1 = _calcAggByPartnerCity(filteredRows, new Set([lastMonth]));
  const cartTot1 = _calcKamTotals(aggLast1);
  // Denominador del reparto = TODOS los partners (incl. Fleet). Antes excluía Fleet
  // (distTot1) y eso sobre-exigía a los demás; ahora Fleet se reparte igual (decisión 1).
  const distTot1 = cartTot1;
  const cityTot1 = _calcCityTotals(lastMonth, STATE.rawDataMensual || []);

  // Agregados TUKTUK (eje de meses propio; puede diferir del taxi).
  const tkRows  = STATE.rawDataMensualTuktuk || [];
  const tkFilt  = CALC_STATE.kam === "all" ? tkRows
                : tkRows.filter(r => (r.kam || getKAMForPartner(r.partner)) === CALC_STATE.kam);
  const tkMonths = [...new Set(tkRows.map(r => r.date))].sort();
  const tkLast1  = tkMonths.length ? tkMonths[tkMonths.length - 1] : null;
  const aggTk1   = tkLast1 ? _calcAggByPartnerCity(tkFilt, new Set([tkLast1])) : new Map();
  const tkCartT1 = _calcTkTotals(aggTk1);
  const tkCityT1 = tkLast1 ? _calcCityTotals(tkLast1, tkRows) : new Map();

  const hasTk    = tkFilt.length > 0;   // adaptativo por KAM (no solo "existe data tuktuk")
  const hasFleet = [...aggLast3.values()].some(e => _calcIsFleet(e.partner));

  return { rows, last3, lastMonth, aggLast3, aggLast1, cartTot1, distTot1, cityTot1,
           aggTk1, tkCartT1, tkCityT1, tkLast1, hasTk, hasFleet };
}

// Array de pestañas visibles (adaptativo). Agregador y Revisar siempre; Fleet/TukTuk
// solo si el KAM los tiene.
function _calcBuildTabs(m) {
  const tabs = [{ key: "agg", label: "Agregador" }];
  if (m.hasFleet) tabs.push({ key: "fleet", label: "Fleet" });
  if (m.hasTk)    tabs.push({ key: "tk", label: "TukTuk" });
  tabs.push({ key: "review", label: "Revisar y compartir" });
  return tabs;
}

// ── ESTADO / CUADRE ───────────────────────────────────────────────────────────
// Cuadre de una métrica: sum distribuida vs meta KAM (misma tolerancia que _calcCuadre).
function _calcMetricCuadre(sum, target) {
  const hasGoal = target > 0;
  const gap = sum - target;
  const ok = hasGoal && Math.abs(gap) <= Math.max(1, target * 0.005);
  return { sum, target, gap, ok, hasGoal };
}

// Sumas distribuidas de agregador (respeta edits). Incluye Fleet (ahora se reparte
// como el resto) → Σ(todos) = meta KAM y el cuadre balancea.
function _calcAggDistSums(agg, distTotals, g) {
  let sumAD = 0, sumSH = 0, sumNR = 0;
  for (const e of agg.values()) {
    const b = _calcAggMetaBases(e, g, distTotals);
    sumAD += _calcGoalFor(e.partner, e.city, "ad", b.ad);
    sumSH += _calcGoalFor(e.partner, e.city, "sh", b.sh);
    sumNR += _calcGoalFor(e.partner, e.city, "nr", b.nr);
  }
  return { sumAD, sumSH, sumNR };
}

// Sumas distribuidas TukTuk (respeta edits).
function _calcTkDistSums(agg, tkTotals, g) {
  let sAD = 0, sNR = 0, sCars = 0, sSH = 0;
  for (const e of agg.values()) {
    const b = _calcTkBases(e, g, tkTotals);
    sAD   += _calcGoalFor(e.partner, e.city, "tk_ad",   b.ad);
    sNR   += _calcGoalFor(e.partner, e.city, "tk_nr",   b.nr);
    sCars += _calcGoalFor(e.partner, e.city, "tk_cars", b.cars);
    sSH   += _calcGoalFor(e.partner, e.city, "tk_sh",   b.sh);
  }
  return { sAD, sNR, sCars, sSH };
}

// Conteo fleet: partner-ciudades con SH/Auto o Aceptación cargados (los KPIs que
// requieren entrada manual). Utilización se excluye porque viene con default 85 →
// contarla inflaría el "con meta" y perdería el sentido del aviso "falta meta".
function _calcFleetMetaCount(agg) {
  const fleet = [...agg.values()].filter(e => _calcIsFleet(e.partner));
  let filled = 0;
  for (const e of fleet) {
    const has = ["shcar", "accept"].some(mtr => {
      const v = CALC_STATE.edits[`${e.partner}|||${e.city}|||${mtr}`];
      return v !== undefined && v !== "";
    });
    if (has) filled++;
  }
  return { filled, total: fleet.length };
}

// Estado completo de las 3 líneas (para píldoras + puntos de pestaña).
function _calcComputeStatus(m) {
  const g = CALC_STATE.kamGoals;
  const a = _calcAggDistSums(m.aggLast1, m.distTot1, g);
  const agg = {
    ad: _calcMetricCuadre(a.sumAD, +g.ad || 0),
    sh: _calcMetricCuadre(a.sumSH, +g.sh || 0),
    nr: _calcMetricCuadre(a.sumNR, +g.nr || 0)
  };
  let fleet = null;
  if (m.hasFleet) fleet = _calcFleetMetaCount(m.aggLast3);
  let tk = null;
  if (m.hasTk) {
    const t = _calcTkDistSums(m.aggTk1, m.tkCartT1, g);
    tk = {
      ad:   _calcMetricCuadre(t.sAD, +g.tkAd || 0),
      nr:   _calcMetricCuadre(t.sNR, +g.tkNr || 0),
      cars: _calcMetricCuadre(t.sCars, +g.tkCars || 0),
      sh:   _calcMetricCuadre(t.sSH, +g.tkSh || 0)
    };
  }
  return { agg, fleet, tk, hasFleet: m.hasFleet, hasTk: m.hasTk };
}

// Rollup de una línea agregador/tuktuk a un glifo/color (para el punto de pestaña).
function _calcLineRollup(line) {
  const parts = Object.values(line).filter(p => p && p.hasGoal);
  if (!parts.length) return { glyph: "○", color: "#aaa" };
  return parts.every(p => p.ok)
    ? { glyph: "✓", color: "#10b981" }
    : { glyph: "⚠", color: "#f59e0b" };
}

// ── CABECERA + BARRA DE ESTADO + BARRA DE PESTAÑAS ────────────────────────────
function _calcPill(label, body) {
  return `<span style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #eee;border-radius:20px;padding:4px 11px;font-size:.7rem;margin:2px 6px 2px 0">
    <b style="color:#555">${escapeHTML(label)}</b> ${body}</span>`;
}
// Cuerpo de píldora por línea agregador/tuktuk: por métrica ✓ o el gap coloreado.
function _calcLinePillBody(line, defs) {
  const anyGoal = defs.some(([, k]) => line[k] && line[k].hasGoal);
  if (!anyGoal) return `<span style="color:#aaa">sin metas</span>`;
  return defs.map(([lbl, k]) => {
    const p = line[k];
    if (!p || !p.hasGoal) return `<span style="color:#ccc">${lbl} —</span>`;
    if (p.ok) return `<span style="color:#10b981;font-weight:700">${lbl} ✓</span>`;
    const sign = p.gap > 0 ? "+" : "";
    const col  = p.gap > 0 ? "#f59e0b" : "#FF0000";
    return `<span style="color:${col};font-weight:700">${lbl} ${sign}${fmt(p.gap)}</span>`;
  }).join(` <span style="color:#ddd">·</span> `);
}
function _calcStatusPills(status) {
  const pills = [];
  pills.push(_calcPill("Agregador", _calcLinePillBody(status.agg, [["AD", "ad"], ["SH", "sh"], ["N+R", "nr"]])));
  if (status.hasFleet && status.fleet) {
    const f = status.fleet;
    const c = f.total === 0 ? "#aaa" : (f.filled >= f.total ? "#10b981" : "#f59e0b");
    pills.push(_calcPill("Fleet", `<span style="color:${c};font-weight:700">${f.filled}/${f.total} con meta</span>`));
  }
  if (status.hasTk && status.tk) {
    pills.push(_calcPill("TukTuk", _calcLinePillBody(status.tk, [["AD", "ad"], ["N+R", "nr"], ["Cars", "cars"], ["SH", "sh"]])));
  }
  return pills.join("");
}

// Punto de estado de una pestaña (espejo de la píldora).
function _calcTabDot(key, status) {
  let r = null;
  if (key === "agg") r = _calcLineRollup(status.agg);
  else if (key === "tk" && status.tk) r = _calcLineRollup(status.tk);
  else if (key === "fleet" && status.fleet) {
    if (status.fleet.total === 0) return "";
    const done = status.fleet.filled >= status.fleet.total;
    r = done ? { glyph: "✓", color: "#10b981" } : { glyph: "⚠", color: "#f59e0b" };
  }
  if (!r) return "";
  return `<span style="color:${r.color};margin-right:5px;font-weight:900">${r.glyph}</span>`;
}
function _calcTabBtns(tabs, active, status) {
  return tabs.map(t =>
    `<button class="mode-btn${t.key === active ? " active" : ""}" style="flex:0 0 auto" onclick="calcSetTab('${t.key}')">${_calcTabDot(t.key, status)}${escapeHTML(t.label)}</button>`
  ).join("");
}
function _calcTabBar(tabs, active, status) {
  return `<div class="mode-toggle-row" id="calcTabBar" style="flex-wrap:wrap;margin:0 4px 12px">${_calcTabBtns(tabs, active, status)}</div>`;
}

function _calcHeader(m, allKAMs, status) {
  const nextM = _calcNextMonth(m.lastMonth || "");
  return `
    ${_secH("🎯", "#FF0000", "Calculadora de metas", "Define las metas del próximo mes por línea de negocio · navega por pestañas")}
    <div class="section">
      <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">KAM</label>
          <select id="calcKamSel" class="sb-sel" style="width:200px" onchange="calcOnKamChange(this.value)">
            <option value="all" ${CALC_STATE.kam === "all" ? "selected" : ""}>Todos los KAMs</option>
            ${allKAMs.map(k => `<option value="${escapeHTML(k)}" ${CALC_STATE.kam === k ? "selected" : ""}>${escapeHTML(k)}</option>`).join("")}
          </select>
        </div>
        <div style="font-size:.72rem;color:#666;background:#fef3c7;padding:6px 10px;border-radius:6px;border:1px solid #fcd34d">
          📅 Metas para <strong>${d2s(nextM)}</strong> · reparto según ${d2s(m.lastMonth || "")}
        </div>
      </div>
      <div style="font-size:.66rem;color:#999;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Estado (cuadre en vivo)</div>
      <div id="calcStatusBar" style="display:flex;flex-wrap:wrap;align-items:center">${_calcStatusPills(status)}</div>
    </div>`;
}

// Refresca las píldoras de estado + los puntos de pestaña + (si está visible) las
// filas "Suma"/"cuadre" DENTRO de la tabla de distribución — sin re-render total
// (patrón in-place → no roba foco). Antes solo se pintaban las píldoras de arriba:
// el usuario editaba una celda, miraba la fila de Suma de la MISMA tabla (la
// referencia más natural) y la veía sin cambiar hasta "Recalcular" → parecía que su
// edición directa no se guardaba (sí se guardaba en CALC_STATE.edits; solo faltaba
// reflejarlo aquí). Marca el botón Recalcular como "pendiente".
function _calcRefreshStatus() {
  const sb = document.getElementById("calcStatusBar");
  if (!sb) return; // no estamos en la Calculadora
  const m = _calcComputeModel();
  const status = _calcComputeStatus(m);
  sb.innerHTML = _calcStatusPills(status);
  const tb = document.getElementById("calcTabBar");
  if (tb) tb.innerHTML = _calcTabBtns(_calcBuildTabs(m), CALC_STATE.tab, status);
  const rb = document.getElementById("calcRecalcBtn");
  if (rb && !/pendiente/.test(rb.textContent)) rb.textContent = "↻ Recalcular distribución (pendiente)";

  const g = CALC_STATE.kamGoals;
  if (document.getElementById("calcAggSumAD")) {
    const a = _calcAggDistSums(m.aggLast1, m.distTot1, g);
    document.getElementById("calcAggSumAD").textContent = fmt(a.sumAD);
    document.getElementById("calcAggSumSH").textContent = fmt(a.sumSH);
    document.getElementById("calcAggSumNR").textContent = fmt(a.sumNR);
    document.getElementById("calcAggCuadreAD").innerHTML = _calcCuadre(a.sumAD, +g.ad || 0);
    document.getElementById("calcAggCuadreSH").innerHTML = _calcCuadre(a.sumSH, +g.sh || 0);
    document.getElementById("calcAggCuadreNR").innerHTML = _calcCuadre(a.sumNR, +g.nr || 0);
  }
  if (document.getElementById("calcTkSumAD")) {
    const t = _calcTkDistSums(m.aggTk1, m.tkCartT1, g);
    document.getElementById("calcTkSumAD").textContent    = fmt(t.sAD);
    document.getElementById("calcTkSumNR").textContent    = fmt(t.sNR);
    document.getElementById("calcTkSumCars").textContent  = fmt(t.sCars);
    document.getElementById("calcTkSumSH").textContent    = fmt(t.sSH);
    document.getElementById("calcTkCuadreAD").innerHTML   = _calcCuadre(t.sAD, +g.tkAd || 0);
    document.getElementById("calcTkCuadreNR").innerHTML   = _calcCuadre(t.sNR, +g.tkNr || 0);
    document.getElementById("calcTkCuadreCars").innerHTML = _calcCuadre(t.sCars, +g.tkCars || 0);
    document.getElementById("calcTkCuadreSH").innerHTML   = _calcCuadre(t.sSH, +g.tkSh || 0);
  }
}

// Botón de recálculo (pestañas con metas → tabla): re-render de la pestaña.
function _calcRecalcBtn() {
  return `<button id="calcRecalcBtn" style="width:100%;margin:14px 0 4px;padding:11px;font-size:.86rem;background:#FF0000;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer" onclick="calcApplyChanges()">↻ Recalcular distribución</button>`;
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
function renderCalculator() {
  if (STATE.curTab !== "calculator") return;
  const el = document.getElementById("calculatorContent");
  if (!el) return;
  ensureIndexes();

  const rows = _calcGetMensualData();
  if (!rows.length) {
    el.innerHTML = `
      <div class="empty">
        <p>Carga datos de <strong>Rendimiento Mensual</strong> para usar la Calculadora.</p>
        <p style="font-size:.75rem;color:#888;margin-top:4px">Sugerencia: ve a Configuración → "Actualizar información" → Rendimiento Mensual.</p>
      </div>`;
    return;
  }

  const hasMonthFormat = rows.some(r => /^\d{4}-\d{2}$/.test(r.date || ""));
  if (!hasMonthFormat) {
    el.innerHTML = `
      <div class="empty">
        <p>La calculadora requiere datos en formato <strong>mensual</strong> (YYYY-MM).</p>
        <p style="font-size:.75rem;color:#888;margin-top:4px">
          El dataset actual está en escala <strong>${STATE.curMode}</strong>.
          Cambia a <strong>Mensual</strong> en el sidebar, o sube datos mensuales desde Configuración.
        </p>
      </div>`;
    return;
  }

  const allKAMs = [...new Set(Object.values(STATE.KAM_MAP).map(k => (k || "").trim()).filter(Boolean))].sort();
  const m = _calcComputeModel();

  // Sembrar Utilización Fleet = 85 (default estándar) una vez por partner-ciudad fleet,
  // para que el 85 llegue a la tarjeta compartible y al guardado (no solo al input).
  // Guard: si el KAM la borra, no se re-siembra; calcResetEdits limpia el guard.
  for (const e of m.aggLast3.values()) {
    if (!_calcIsFleet(e.partner)) continue;
    const k = `${e.partner}|||${e.city}|||util`;
    if (CALC_STATE.edits[k] === undefined && !CALC_STATE._utilSeeded[k]) {
      CALC_STATE.edits[k] = 85;
      CALC_STATE._utilSeeded[k] = true;
    }
  }

  // Pestañas adaptativas + clamp (protege un cambio de KAM que quita Fleet/TukTuk).
  const tabs = _calcBuildTabs(m);
  if (!tabs.some(t => t.key === CALC_STATE.tab)) CALC_STATE.tab = "agg";
  const status = _calcComputeStatus(m);

  let body;
  switch (CALC_STATE.tab) {
    case "fleet":  body = _calcTabFleet(m);  break;
    case "tk":     body = _calcTabTk(m);     break;
    case "review": body = _calcTabReview(m); break;
    default:       body = _calcTabAgg(m);
  }

  el.innerHTML = `
    <div style="padding:0 8px 16px">
      ${_calcHeader(m, allKAMs, status)}
      ${_calcTabBar(tabs, CALC_STATE.tab, status)}
      ${body}
    </div>`;
}

// ── PESTAÑA: AGREGADOR ────────────────────────────────────────────────────────
function _calcTabAgg(m) {
  return `
    <div class="section">${_calcAggGoalsBlock()}</div>
    ${_calcPctDetails(m.aggLast1, m.cartTot1, m.cityTot1, CALC_TAXI_METRICS, m.lastMonth)}
    ${_calcRecalcBtn()}
    ${_calcSec4_distribucion(m.aggLast1, m.distTot1, m.lastMonth)}`;
}

// Bloque de metas totales del agregador (Taxi) — lo único que va al CSV.
function _calcAggGoalsBlock() {
  const g = CALC_STATE.kamGoals;
  return `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:.82rem;font-weight:800;color:#92400e">📥 Metas totales · Agregador (Taxi)</div>
        <span title="Solo estas metas (AD/SH/N+R) se exportan al CSV de metas" style="font-size:.58rem;background:#FF0000;color:#fff;padding:2px 7px;border-radius:6px;font-weight:800;letter-spacing:.5px">VA AL CSV</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
        ${_kamGoalInput("ad", "Active Drivers",    KAM_WEIGHTS.ad, g.ad)}
        ${_kamGoalInput("sh", "Supply Hours",      KAM_WEIGHTS.sh, g.sh)}
        ${_kamGoalInput("nr", "New + Reactivated", KAM_WEIGHTS.nr, g.nr)}
      </div>
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-size:.72rem;font-weight:700;color:#92400e">Metas % KAM (no se reparten por partner)</summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:8px">
          ${_kamGoalInput("otherProj", "Other Projects (%)",   KAM_WEIGHTS.otherProj, g.otherProj)}
          ${_kamGoalInput("fleetA2",   "Fleet drivers A2 (%)", KAM_WEIGHTS.fleetA2,   g.fleetA2)}
        </div>
        <div style="font-size:.68rem;color:#92400e;margin-top:6px;font-style:italic">Metas % a nivel KAM (referencia); no se distribuyen por partner ni van al CSV.</div>
      </details>
    </div>`;
}

// ── PESTAÑA: FLEET ────────────────────────────────────────────────────────────
function _calcTabFleet(m) {
  return _calcSec4b_fleet(m.aggLast3);
}

// ── PESTAÑA: TUKTUK ───────────────────────────────────────────────────────────
function _calcTabTk(m) {
  return `
    <div class="section">${_calcTkGoalsBlock()}</div>
    ${_calcPctDetails(m.aggTk1, m.tkCartT1, m.tkCityT1, CALC_TK_METRICS, m.tkLast1)}
    ${_calcRecalcBtn()}
    ${_calcSecTk_distribucion(m.aggTk1, m.tkCartT1, m.tkLast1)}`;
}

// Bloque de metas totales TukTuk (viven en la tarjeta, no en el CSV).
function _calcTkGoalsBlock() {
  const g = CALC_STATE.kamGoals;
  return `
    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:12px">
      <div style="font-size:.82rem;font-weight:800;color:#7e22ce;margin-bottom:8px">🛺 Metas totales · TukTuk (branding cars)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
        ${_kamGoalInput("tkAd",   "AD (TukTuk)",    null, g.tkAd)}
        ${_kamGoalInput("tkNr",   "N+R (TukTuk)",   null, g.tkNr)}
        ${_kamGoalInput("tkCars", "Cars (branded)", null, g.tkCars)}
        ${_kamGoalInput("tkSh",   "Horas Conexión (TukTuk)", null, g.tkSh)}
      </div>
    </div>`;
}

// ── PESTAÑA: REVISAR Y COMPARTIR ──────────────────────────────────────────────
function _calcTabReview(m) {
  return `
    ${_calcSecActions()}
    ${_calcSec5_exportPartner(m.aggLast1, m.distTot1, m.aggTk1, m.tkCartT1, m.lastMonth, m.tkLast1)}
    ${_calcSec2_promedio3m(m.aggLast3, m.last3)}`;
}

function _kamGoalInput(metric, label, weight, val) {
  const wtag = (weight === null || weight === undefined) ? "" : ` <span style="color:#aaa">(${weight}%)</span>`;
  return `
    <div>
      <label style="font-size:.66rem;color:#666;font-weight:700;display:block;margin-bottom:3px">${escapeHTML(label)}${wtag}</label>
      <input type="number" step="1" min="0" value="${+val || 0}"
        onchange="calcOnKamGoalChange('${metric}', this.value)"
        class="sb-inp" style="width:100%;padding:5px 8px;font-size:.78rem"/>
    </div>`;
}

// ── Promedio 3 últimos meses (referencia colapsable, pestaña Revisar) ─────────
function _calcSec2_promedio3m(agg, months) {
  const n = months.length || 1;
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const tot = { trips: 0, sh: 0, ad: 0, np: 0, ns: 0, re: 0 };
  items.forEach(e => {
    tot.trips += e.trips / n; tot.sh += e.sh / n; tot.ad += e.ad;
    tot.np += e.np / n; tot.ns += e.ns / n; tot.re += e.re / n;
  });

  const rowsHtml = items.map(e => `
    <tr>
      <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
      <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
      <td class="tn">${fmt(e.trips / n)}</td>
      <td class="tn">${fmt(e.sh / n)}</td>
      <td class="tn">${fmt(e.ad)}</td>
      <td class="tn">${fmt(e.np / n)}</td>
      <td class="tn">${fmt(e.ns / n)}</td>
      <td class="tn">${fmt(e.re / n)}</td>
    </tr>`).join("");

  return `
    <details class="section" style="margin-top:8px">
      <summary style="cursor:pointer;font-size:.82rem;font-weight:700;color:#666;padding:6px 4px">📊 Promedio 3 meses · referencia (no reparte) · ${items.length} partner-ciudad · KAM: ${CALC_STATE.kam === "all" ? "Todos" : CALC_STATE.kam}</summary>
      <div class="tbl-wrap" style="max-height:400px;overflow-y:auto;margin-top:8px">
        <table class="dtbl">
          <thead>
            <tr>
              <th>Partner</th><th>Ciudad</th>
              <th class="tn">Trips</th><th class="tn">SH</th>
              <th class="tn">AD (máx)</th><th class="tn">New Partner</th>
              <th class="tn">New Yango</th><th class="tn">Reactivados</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="8" style="text-align:center;color:#aaa;padding:20px">Sin datos.</td></tr>`}</tbody>
          <tfoot style="font-weight:700;background:#f9f9f9">
            <tr>
              <td colspan="2">Total ${CALC_STATE.kam === "all" ? "general" : "KAM"}</td>
              <td class="tn">${fmt(tot.trips)}</td>
              <td class="tn">${fmt(tot.sh)}</td>
              <td class="tn">${fmt(tot.ad)}</td>
              <td class="tn">${fmt(tot.np)}</td>
              <td class="tn">${fmt(tot.ns)}</td>
              <td class="tn">${fmt(tot.re)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>`;
}

// ── % Representación (Ciudad + Cartera) — colapsable dentro de su pestaña ──────
// Por cada métrica muestra DOS columnas: % Ciudad (val ÷ total de la ciudad, TODOS
// los partners → "peso de Yego en Lima", exacto) y % Cartera (val ÷ total del KAM
// = base del reparto, suma 100%). Ventana: último mes.
function _calcPctDetails(agg, cartTotals, cityTotals, metrics, monthLabel) {
  return `
    <details class="section" style="margin-bottom:8px">
      <summary style="cursor:pointer;font-size:.8rem;font-weight:700;color:#666;padding:6px 4px">📊 Ver % Ciudad / Cartera · referencia · ${d2s(monthLabel || "")}</summary>
      <div style="font-size:.68rem;color:#888;margin:4px 4px 8px">% Ciudad = peso real de tu partner en la ciudad (todos los partners Yango) · % Cartera = peso en tu KAM (base del reparto)</div>
      ${_calcPctTableHTML(agg, cartTotals, cityTotals, metrics)}
    </details>`;
}
function _calcPctTableHTML(agg, cartTotals, cityTotals, M) {
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  // Por métrica: Valor (número real del último mes) + % Ciudad + % Cartera.
  const _fmtV = key => (key === "sh" ? fmtSmart : fmt);
  const _valCell = (val, key) => `<td class="tn" style="font-weight:700;color:#111">${_fmtV(key)(val)}</td>`;
  const _pctCell = (val, tot) => {
    if (!tot) return `<td class="tn" style="color:#ccc">—</td>`;
    const pct = (val / tot) * 100;
    return `<td class="tn" style="background:${_calcHeatBg(pct)};color:${_calcHeatColor(pct)};font-weight:700">${pct.toFixed(1)}%</td>`;
  };

  const rowsHtml = items.map(e => {
    const ct = cityTotals.get(e.city) || {};
    const cells = M.map(mtr => {
      const v = mtr.get(e);
      return _valCell(v, mtr.key) + _pctCell(v, ct[mtr.key]) + _pctCell(v, cartTotals[mtr.key]);   // Valor, % Ciudad, % Cartera
    }).join("");
    return `
      <tr>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        ${cells}
      </tr>`;
  }).join("");

  const topHead = M.map(mtr => `<th class="tn" colspan="3">${escapeHTML(mtr.label)}</th>`).join("");
  const subHead = M.map(() => `<th class="tn" title="Valor real del último mes">Valor</th><th class="tn" title="Peso en la ciudad (todos los KAMs)">% Ciudad</th><th class="tn" title="Peso en tu cartera KAM">% Cartera</th>`).join("");
  const footCells = M.map(mtr => `<td class="tn">${_fmtV(mtr.key)(cartTotals[mtr.key] || 0)}</td><td class="tn" style="color:#aaa">—</td><td class="tn">100%</td>`).join("");
  const nCols = 2 + M.length * 3;

  return `
    <div class="tbl-wrap" style="max-height:400px;overflow-y:auto">
      <table class="dtbl">
        <thead>
          <tr><th rowspan="2">Partner</th><th rowspan="2">Ciudad</th>${topHead}</tr>
          <tr>${subHead}</tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="${nCols}" style="text-align:center;color:#aaa;padding:20px">Sin datos.</td></tr>`}</tbody>
        <tfoot style="font-weight:700;background:#f9f9f9">
          <tr><td colspan="2">Total cartera</td>${footCells}</tr>
        </tfoot>
      </table>
    </div>`;
}

// ── Distribución de metas AGREGADOR (editable) ────────────────────────────────
// Ventana: último mes (misma que la representación → el % que ves reparte).
// Fleet SÍ se reparte (denominador = todos) y cuenta en el cuadre; queda solo el
// badge FLEET. Los partners sin actividad Taxi el último mes se marcan "FIJAR MANUAL".
function _calcSec4_distribucion(agg, distTotals, monthLabel) {
  const g = CALC_STATE.kamGoals;
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const _input = (partner, city, metric, base) => {
    const k = `${partner}|||${city}|||${metric}`;
    const val = CALC_STATE.edits[k] !== undefined ? +CALC_STATE.edits[k] : Math.round(base);
    return `<input type="number" step="1" min="0" class="calc-inp" value="${val}"
      data-pk="${escapeHTML(partner)}" data-city="${escapeHTML(city)}" data-metric="${metric}"
      onchange="calcOnGoalEdit(this)"
      style="width:90px;padding:3px 5px;border:1px solid #ddd;border-radius:4px;font-size:.74rem;text-align:right"/>`;
  };
  const _pctCell = (val, tot, noAct) => noAct
    ? `<td class="tn" style="color:#f59e0b">—</td>`
    : `<td class="tn" style="color:#888">${tot > 0 ? ((val / tot) * 100).toFixed(1) + "%" : "—"}</td>`;

  let sumAD = 0, sumSH = 0, sumNR = 0, nManual = 0;
  const rowsHtml = items.map(e => {
    const nr = e.np + e.ns + e.re;
    const b = _calcAggMetaBases(e, g, distTotals);
    const ad = _calcGoalFor(e.partner, e.city, "ad", b.ad);
    const sh = _calcGoalFor(e.partner, e.city, "sh", b.sh);
    const nrg = _calcGoalFor(e.partner, e.city, "nr", b.nr);
    sumAD += ad; sumSH += sh; sumNR += nrg;
    if (b.noAct) nManual++;
    const badge  = b.fleet ? ` <span style="font-size:.58rem;background:#0891b2;color:#fff;padding:1px 5px;border-radius:6px;vertical-align:middle">FLEET</span>` : "";
    const manual = b.noAct ? ` <span title="Sin actividad Taxi el último mes — fija la meta a mano" style="font-size:.55rem;background:#f59e0b;color:#fff;padding:1px 5px;border-radius:6px;vertical-align:middle">FIJAR MANUAL</span>` : "";
    const rowStyle = b.noAct ? ' style="background:#fffbeb"' : (b.fleet ? ' style="background:#f1f5f9"' : '');
    return `
      <tr${rowStyle}>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}${badge}${manual}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        ${_pctCell(e.ad, distTotals.ad, b.noAct)}
        <td>${_input(e.partner, e.city, "ad", b.ad)}</td>
        ${_pctCell(e.sh, distTotals.sh, b.noAct)}
        <td>${_input(e.partner, e.city, "sh", b.sh)}</td>
        ${_pctCell(nr, distTotals.nr, b.noAct)}
        <td>${_input(e.partner, e.city, "nr", b.nr)}</td>
      </tr>`;
  }).join("");

  const noGoals = !(+g.ad || +g.sh || +g.nr);
  const hint = noGoals
    ? `<div style="font-size:.78rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin-bottom:8px">⚠️ Ingresa tus metas totales arriba y presiona <strong>"↻ Recalcular distribución"</strong> para repartirlas aquí.</div>`
    : (nManual ? `<div style="font-size:.72rem;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;margin-bottom:8px">⚠️ ${nManual} partner(s) sin actividad Taxi el último mes (marcados <strong>FIJAR MANUAL</strong>): ponles la meta a mano.</div>` : "");

  return `
    ${_secH("⚙️", "#8b5cf6", "Distribución por partner · " + d2s(monthLabel || ""), "Meta KAM × % Cartera (último mes) · editable · Fleet incluido en el reparto")}
    <div class="section">
      ${hint}
      <div class="tbl-wrap" style="max-height:500px;overflow-y:auto">
        <table class="dtbl">
          <thead>
            <tr>
              <th>Partner</th><th>Ciudad</th>
              <th class="tn">% AD</th><th class="tn">AD meta</th>
              <th class="tn">% SH</th><th class="tn">SH meta</th>
              <th class="tn">% N+R</th><th class="tn">N+R meta</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="8" style="text-align:center;color:#aaa;padding:20px">Sin datos.</td></tr>`}</tbody>
          <tfoot style="font-weight:700;background:#f9f9f9">
            <tr>
              <td colspan="2">Suma distribuida (incl. Fleet)</td>
              <td></td><td class="tn" id="calcAggSumAD">${fmt(sumAD)}</td>
              <td></td><td class="tn" id="calcAggSumSH">${fmt(sumSH)}</td>
              <td></td><td class="tn" id="calcAggSumNR">${fmt(sumNR)}</td>
            </tr>
            <tr>
              <td colspan="2" style="color:#666;font-weight:600">Meta KAM · cuadre</td>
              <td></td><td class="tn" id="calcAggCuadreAD">${_calcCuadre(sumAD, +g.ad || 0)}</td>
              <td></td><td class="tn" id="calcAggCuadreSH">${_calcCuadre(sumSH, +g.sh || 0)}</td>
              <td></td><td class="tn" id="calcAggCuadreNR">${_calcCuadre(sumNR, +g.nr || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

// Compara la suma distribuida vs la meta KAM y devuelve el cuadre coloreado.
function _calcCuadre(sum, target) {
  if (!target) return `<span style="color:#aaa">sin meta</span>`;
  const gap = sum - target;
  const ok = Math.abs(gap) <= Math.max(1, target * 0.005);
  const c = ok ? "#10b981" : (gap > 0 ? "#f59e0b" : "#FF0000");
  const tag = ok ? "✓ cuadra" : (gap > 0 ? `+${fmt(gap)}` : `${fmt(gap)}`);
  return `<div style="font-size:.7rem;line-height:1.3">${fmt(target)}<br><span style="color:${c};font-weight:800">${tag}</span></div>`;
}

// ── KPIs Fleet (pestaña Fleet) ────────────────────────────────────────────────
// Metas manuales por partner-ciudad para partners fleet. NO se distribuyen ni van
// al CSV; si se llenan, aparecen en la tarjeta compartible (pestaña Revisar).
// Utilización pre-llenada en 85 (borrable) — la meta estándar.
function _calcSec4b_fleet(agg) {
  const items = [...agg.values()]
    .filter(e => _calcIsFleet(e.partner))
    .sort((a, b) => a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const _inp = (partner, city, metric, ph) => {
    const k = `${partner}|||${city}|||${metric}`;
    const val = CALC_STATE.edits[k] !== undefined ? CALC_STATE.edits[k] : "";
    return `<input type="number" step="0.1" min="0" class="calc-inp" value="${val}" placeholder="${ph}"
      data-pk="${escapeHTML(partner)}" data-city="${escapeHTML(city)}" data-metric="${metric}"
      onchange="calcOnGoalEdit(this)"
      style="width:84px;padding:3px 5px;border:1px solid #ddd;border-radius:4px;font-size:.74rem;text-align:right"/>`;
  };

  const rowsHtml = items.map(e => {
    const ref = _calcFleetRef(e);
    return `
      <tr>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        <td class="tn" style="color:#888">${ref.shcar == null ? "—" : ref.shcar.toFixed(1)}</td>
        <td>${_inp(e.partner, e.city, "shcar", "meta")}</td>
        <td class="tn" style="color:#888">${ref.accept == null ? "—" : ref.accept.toFixed(1) + "%"}</td>
        <td>${_inp(e.partner, e.city, "accept", "meta %")}</td>
        <td>${_inp(e.partner, e.city, "util", "85")}</td>
      </tr>`;
  }).join("");

  return `
    ${_secH("🚗", "#0891b2", "Metas Fleet (KPIs propios)", "Solo partners marcados Fleet · SH/Auto, Aceptación, Utilización · van a la tarjeta compartible")}
    <div class="section">
      <div class="tbl-wrap" style="max-height:420px;overflow-y:auto">
        <table class="dtbl">
          <thead>
            <tr>
              <th>Partner</th><th>Ciudad</th>
              <th class="tn">SH/Auto (3m)</th><th class="tn">Meta SH/Auto</th>
              <th class="tn">Aceptación (3m)</th><th class="tn">Meta Acept. %</th>
              <th class="tn">Meta Utiliz. %</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px">No hay partners marcados como Fleet en este KAM.</td></tr>`}</tbody>
        </table>
      </div>
      <div style="font-size:.7rem;color:#888;margin-top:6px;font-style:italic">
        💡 Utilización viene pre-llenada en <strong>85%</strong> (active cars / total) — ajústala o bórrala donde no aplique. Estos KPIs aparecen en la tarjeta compartible (pestaña <strong>Revisar y compartir</strong>).
      </div>
    </div>`;
}

// ── Distribución de metas TukTuk (editable, pestaña TukTuk) ────────────────────
// KPIs AD / N+R / Cars (branded_active_cars) / SH. Reparte g.tkAd/tkNr/tkCars/tkSh por peso
// dentro de la cartera TukTuk. edit-keys tk_* (disjuntas de taxi). Solo card, no CSV.
function _calcSecTk_distribucion(agg, distTotals, monthLabel) {
  const g = CALC_STATE.kamGoals;
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const _input = (partner, city, metric, base) => {
    const k = `${partner}|||${city}|||${metric}`;
    const val = CALC_STATE.edits[k] !== undefined ? +CALC_STATE.edits[k] : Math.round(base);
    return `<input type="number" step="1" min="0" class="calc-inp" value="${val}"
      data-pk="${escapeHTML(partner)}" data-city="${escapeHTML(city)}" data-metric="${metric}"
      onchange="calcOnGoalEdit(this)"
      style="width:90px;padding:3px 5px;border:1px solid #ddd;border-radius:4px;font-size:.74rem;text-align:right"/>`;
  };

  let sAD = 0, sNR = 0, sCars = 0, sSH = 0; // metas
  let rAD = 0, rNR = 0, rCars = 0, rSH = 0; // referencia (último mes)
  const _ref = v => `<td class="tn" style="color:#888">${fmt(v)}</td>`;
  const rowsHtml = items.map(e => {
    const nr = e.np + e.ns + e.re;
    const b = _calcTkBases(e, g, distTotals);
    const ad   = _calcGoalFor(e.partner, e.city, "tk_ad",   b.ad);
    const nrg  = _calcGoalFor(e.partner, e.city, "tk_nr",   b.nr);
    const cars = _calcGoalFor(e.partner, e.city, "tk_cars", b.cars);
    const sh   = _calcGoalFor(e.partner, e.city, "tk_sh",   b.sh);
    sAD += ad; sNR += nrg; sCars += cars; sSH += sh;
    rAD += e.ad; rNR += nr; rCars += e.bcars; rSH += e.sh;
    return `
      <tr>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        ${_ref(e.ad)}<td>${_input(e.partner, e.city, "tk_ad",   b.ad)}</td>
        ${_ref(nr)}<td>${_input(e.partner, e.city, "tk_nr",   b.nr)}</td>
        ${_ref(e.bcars)}<td>${_input(e.partner, e.city, "tk_cars", b.cars)}</td>
        ${_ref(e.sh)}<td>${_input(e.partner, e.city, "tk_sh",   b.sh)}</td>
      </tr>`;
  }).join("");

  const noGoals = !(+g.tkAd || +g.tkNr || +g.tkCars || +g.tkSh);
  const hint = noGoals
    ? `<div style="font-size:.78rem;color:#6b21a8;background:#faf5ff;border:1px solid #e9d5ff;border-radius:6px;padding:8px 10px;margin-bottom:8px">⚠️ Usa la columna <strong>"últ. mes"</strong> como referencia de lo que hizo cada partner, ingresa tus metas TukTuk arriba y presiona <strong>"↻ Recalcular distribución"</strong>.</div>`
    : "";

  return `
    ${_secH("🛺", "#a855f7", "Distribución TukTuk · " + d2s(monthLabel || ""), "Referencia (último mes) + Meta TukTuk × % Cartera · AD · N+R · Cars (branded) · SH · editable")}
    <div class="section">
      ${hint}
      <div class="tbl-wrap" style="max-height:460px;overflow-y:auto">
        <table class="dtbl">
          <thead>
            <tr>
              <th>Partner</th><th>Ciudad</th>
              <th class="tn">AD (últ)</th><th class="tn">AD meta</th>
              <th class="tn">N+R (últ)</th><th class="tn">N+R meta</th>
              <th class="tn">Cars (últ)</th><th class="tn">Cars meta</th>
              <th class="tn">SH (últ)</th><th class="tn">SH meta</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="10" style="text-align:center;color:#aaa;padding:20px">Sin partners TukTuk en este KAM.</td></tr>`}</tbody>
          <tfoot style="font-weight:700;background:#f9f9f9">
            <tr><td colspan="2">Suma</td>
              <td class="tn" style="color:#888">${fmt(rAD)}</td><td class="tn" id="calcTkSumAD">${fmt(sAD)}</td>
              <td class="tn" style="color:#888">${fmt(rNR)}</td><td class="tn" id="calcTkSumNR">${fmt(sNR)}</td>
              <td class="tn" style="color:#888">${fmt(rCars)}</td><td class="tn" id="calcTkSumCars">${fmt(sCars)}</td>
              <td class="tn" style="color:#888">${fmt(rSH)}</td><td class="tn" id="calcTkSumSH">${fmt(sSH)}</td>
            </tr>
            <tr><td colspan="2" style="color:#666;font-weight:600">Meta TukTuk · cuadre</td>
              <td></td><td class="tn" id="calcTkCuadreAD">${_calcCuadre(sAD, +g.tkAd || 0)}</td>
              <td></td><td class="tn" id="calcTkCuadreNR">${_calcCuadre(sNR, +g.tkNr || 0)}</td>
              <td></td><td class="tn" id="calcTkCuadreCars">${_calcCuadre(sCars, +g.tkCars || 0)}</td>
              <td></td><td class="tn" id="calcTkCuadreSH">${_calcCuadre(sSH, +g.tkSh || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

// ── BLOQUE DE ACCIONES (pestaña Revisar) ──────────────────────────────────────
// Reset o descargar el CSV. La distribución se recalcula con "↻ Recalcular" en cada
// pestaña o al cambiar de pestaña; ya no hay un botón "Aplicar" global.
function _calcSecActions() {
  const canSave = !!STATE.canWrite;
  const kamAll  = CALC_STATE.kam === "all";
  const saveBtn = !canSave
    ? `<button disabled title="Requiere permisos de administrador" style="padding:8px 16px;font-size:.8rem;background:#ccc;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:not-allowed">💾 Actualizar metas (requiere admin)</button>`
    : `<button style="padding:8px 16px;font-size:.8rem;background:#10b981;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer" onclick="calcSaveMetas()">💾 Actualizar metas (guardar en BD)</button>`;
  const kamNote = (canSave && kamAll)
    ? `<div style="font-size:.7rem;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;margin-top:8px">⚠️ Para <strong>guardar</strong>, elige un KAM específico arriba (no "Todos los KAMs").</div>`
    : "";
  return `
    ${_secH("✅", "#10b981", "Actualizar y compartir", "Guarda las metas del KAM directo en la base de datos, descarga la plantilla o comparte la tarjeta")}
    <div class="section">
      <div class="tbl-wrap">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          ${saveBtn}
          <button style="padding:7px 14px;font-size:.78rem;background:#FF0000;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcExportExcel()">📄 Descargar plantilla (CSV)</button>
          <button style="padding:7px 14px;font-size:.78rem;background:#666;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcResetEdits()">↺ Reset ediciones</button>
        </div>
        ${kamNote}
        <div style="font-size:.7rem;color:#888;margin-top:8px;font-style:italic">
          💡 <strong>Actualizar metas</strong> guarda Agregador + Fleet + TukTuk del KAM seleccionado para el próximo mes, directo en la BD (requiere admin). <strong>Reemplaza</strong> las metas de ese mes (no se acumulan): si vuelves a guardar el mismo mes, se sobrescriben. La <strong>plantilla CSV</strong> trae todas las líneas por si prefieres subirla en Configuración → Metas.
        </div>
      </div>
    </div>`;
}

// ── Vista compartible: i18n ES/EN + crecimiento vs último mes ─────────────────
const CALC_MES_EN = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
function _calcMonthLabel(iso, lang) {
  if (!iso || !/^\d{4}-\d{2}$/.test(iso)) return "";
  const [y, mm] = iso.split("-").map(Number);
  const esN = CALC_MES_NOMBRES[mm - 1] || "";
  const es  = esN ? esN.charAt(0) + esN.slice(1).toLowerCase() : "";
  const en  = CALC_MES_EN[mm - 1] || "";
  if (lang === "es") return `${es} ${y}`;
  if (lang === "en") return `${en} ${y}`;
  return es === en ? `${es} ${y}` : `${es} ${y} / ${en} ${y}`;
}

// Etiquetas de la tarjeta. lang: "es" | "en" | "es-en" (bilingüe → une con " / ").
const CALC_EXPORT_STR = {
  proposal:   { es: "Metas Yango — Propuesta", en: "Yango Goals — Proposal" },
  city:       { es: "Ciudad", en: "City" },
  ad:         { es: "Active Drivers", en: "Active Drivers" },
  sh:         { es: "Supply Hours", en: "Supply Hours" },
  nr:         { es: "N+R", en: "N+R" },
  cars:       { es: "Brandeados", en: "Branded" },
  shcar:      { es: "SH/Auto", en: "SH/Car" },
  accept:     { es: "Aceptación", en: "Acceptance" },
  util:       { es: "Utilización", en: "Utilization" },
  fleetKpi:   { es: "Fleet · KPIs de calidad", en: "Fleet · quality KPIs" },
  newBadge:   { es: "nuevo", en: "new" },
  generated:  { es: "Propuesta generada", en: "Proposal generated" },
  legendGoal: { es: "Número grande = meta propuesta", en: "Large number = proposed goal" },
  legendLast: { es: "debajo = resultado del último mes y crecimiento pedido",
                en: "below = last month result and requested growth" }
};
function _calcLab(key, lang) {
  const s = CALC_EXPORT_STR[key];
  if (!s) return key;
  if (lang === "es") return s.es;
  if (lang === "en") return s.en;
  return s.es === s.en ? s.es : `${s.es} / ${s.en}`;
}

// Celda de tabla: meta (número grande) + resultado del último mes y % de crecimiento
// pedido (verde si sube, rojo si baja, gris si es mantener). actual = valor real del
// último mes (aggLast1 ya viene por mes). Sin baseline (actual<=0) → "nuevo/new".
function _calcGoalCell(goal, actual, fmtFn, lang) {
  // Sin meta (goal<=0, p.ej. el KAM aún no ingresó su objetivo): no inventamos un
  // "-100%"; mostramos "—" y el valor del último mes como referencia.
  if (!(goal > 0)) {
    const ref = actual > 0
      ? `<div style="font-size:.6rem;color:#9ca3af;margin-top:2px;white-space:nowrap">${fmtFn(actual)}</div>`
      : "";
    return `<td class="tn" style="padding:7px 12px;text-align:right;vertical-align:top"><div style="font-weight:800;font-size:.95rem;color:#9ca3af">—</div>${ref}</td>`;
  }
  const big = `<div style="font-weight:800;font-size:.95rem;color:#111;line-height:1.15">${fmtFn(goal)}</div>`;
  let sub;
  if (actual > 0) {
    const pct  = ((goal - actual) / actual) * 100;
    const sign = pct >= 0 ? "+" : "";
    const gc   = pct > 0.5 ? "#059669" : pct < -0.5 ? "#dc2626" : "#6b7280";
    const pctT = `${sign}${pct.toLocaleString("es-PE", { maximumFractionDigits: 0 })}%`;
    sub = `<div style="font-size:.6rem;color:#9ca3af;margin-top:2px;white-space:nowrap">${fmtFn(actual)} <span style="color:${gc};font-weight:800">${pctT}</span></div>`;
  } else {
    sub = `<div style="font-size:.6rem;color:#059669;font-weight:800;margin-top:2px">${_calcLab("newBadge", lang)}</div>`;
  }
  return `<td class="tn" style="padding:7px 12px;text-align:right;vertical-align:top">${big}${sub}</td>`;
}

// Leyenda del formato meta / último mes. Bilingüe → dos líneas (no " / " en frase).
function _calcExportLegend(lang) {
  const line  = l => `${CALC_EXPORT_STR.legendGoal[l]} · ${CALC_EXPORT_STR.legendLast[l]}`;
  const style = "margin-top:10px;font-size:.62rem;color:#9ca3af;line-height:1.5";
  if (lang === "es") return `<div style="${style}">${line("es")}</div>`;
  if (lang === "en") return `<div style="${style}">${line("en")}</div>`;
  return `<div style="${style}">${line("es")}<br>${line("en")}</div>`;
}

// ── Vista compartible / descarga por partner (Taxi + TukTuk, pestaña Revisar) ──
function _calcSec5_exportPartner(agg, totals, aggTk, tkTotals, lastMonth, tkLast) {
  const lang = CALC_STATE.exportLang || "es-en";
  const g = CALC_STATE.kamGoals;
  const partners = [...new Set([
    ...[...agg.values()].map(e => e.partner),
    ...[...(aggTk ? aggTk.values() : [])].map(e => e.partner)
  ])].sort();
  if (!partners.length) {
    return `
      ${_secH("📤", "#10b981", "Vista compartible por partner", "Sin partners en este filtro")}
      <div class="section"><div style="font-size:.78rem;color:#aaa;padding:8px 0">No hay partners en el KAM seleccionado con datos.</div></div>`;
  }
  const sel = (CALC_STATE.selPartnerExport && partners.includes(CALC_STATE.selPartnerExport))
    ? CALC_STATE.selPartnerExport
    : partners[0];
  CALC_STATE.selPartnerExport = sel;

  const taxiItems = [...agg.values()].filter(e => e.partner === sel);
  const tkItems   = [...(aggTk ? aggTk.values() : [])].filter(e => e.partner === sel);

  const editVal = (e, k) => CALC_STATE.edits[`${e.partner}|||${e.city}|||${k}`];
  const _th = t => `<th style="text-align:${t.a || "right"};padding:8px 12px;font-size:.74rem">${t.h}</th>`;

  // Bloque Taxi (AD/SH/N+R con crecimiento vs último mes)
  const taxiBlock = taxiItems.length ? (() => {
    const rows = taxiItems.map(e => {
      const b = _calcAggMetaBases(e, g, totals);
      const adGoal = _calcGoalFor(e.partner, e.city, "ad", b.ad);
      const shGoal = _calcGoalFor(e.partner, e.city, "sh", b.sh);
      const nrGoal = _calcGoalFor(e.partner, e.city, "nr", b.nr);
      const nr = e.np + e.ns + e.re;
      return `<tr><td style="font-weight:600;vertical-align:top;padding:7px 12px">${escapeHTML(e.city)}</td>${_calcGoalCell(adGoal, e.ad, fmt, lang)}${_calcGoalCell(shGoal, e.sh, fmtSmart, lang)}${_calcGoalCell(nrGoal, nr, fmt, lang)}</tr>`;
    }).join("");
    const heads = [{h:_calcLab("city",lang),a:"left"},{h:_calcLab("ad",lang)},{h:_calcLab("sh",lang)},{h:_calcLab("nr",lang)}].map(_th).join("");
    return `
      <div style="font-size:.72rem;font-weight:800;color:#b91c1c;margin:4px 0 6px">🚕 Taxi</div>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:12px">
        <thead><tr style="background:#f9f9f9">${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  })() : "";

  // Bloque Fleet (SH/Auto, Aceptación, Utilización) — SOLO si el partner (o alguna de
  // sus subflotas) está marcado Fleet. Se muestran las 3 KPIs siempre; meta editada en
  // negro, sin meta "—" (nudge para fijarla), y debajo la referencia del último mes.
  const isFleetCard = taxiItems.some(e => _calcIsFleet(e.partner));
  const FLEET_KPI = [
    { k: "shcar",  fmt: v => fmt(v),       ref: e => _calcFleetRef(e).shcar },
    { k: "accept", fmt: v => fmt(v) + "%", ref: e => _calcFleetRef(e).accept },
    { k: "util",   fmt: v => fmt(v) + "%", ref: e => null }
  ];
  const fleetBlock = (isFleetCard && taxiItems.length) ? (() => {
    const rows = taxiItems.map(e => {
      const cells = FLEET_KPI.map(fd => {
        const ev = editVal(e, fd.k);
        const hasMeta = ev !== undefined && ev !== "";
        const big = `<div style="font-weight:800;font-size:.95rem;color:${hasMeta ? "#111" : "#9ca3af"}">${hasMeta ? fd.fmt(+ev) : "—"}</div>`;
        const rv = fd.ref(e);
        const sub = (rv != null && isFinite(rv) && rv > 0)
          ? `<div style="font-size:.6rem;color:#9ca3af;margin-top:2px;white-space:nowrap">${fd.fmt(rv)}</div>`
          : "";
        return `<td class="tn" style="text-align:right;padding:7px 12px;vertical-align:top">${big}${sub}</td>`;
      }).join("");
      return `<tr><td style="font-weight:600;vertical-align:top;padding:7px 12px">${escapeHTML(e.city)}</td>${cells}</tr>`;
    }).join("");
    const heads = [{h:_calcLab("city",lang),a:"left"},{h:_calcLab("shcar",lang)},{h:_calcLab("accept",lang)},{h:_calcLab("util",lang)}].map(_th).join("");
    return `
      <div style="font-size:.72rem;font-weight:800;color:#0891b2;margin:4px 0 6px">🚗 ${_calcLab("fleetKpi",lang)}</div>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:12px">
        <thead><tr style="background:#ecfeff">${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  })() : "";

  // Bloque TukTuk (AD/N+R/Cars/SH con crecimiento vs último mes)
  const tkBlock = tkItems.length ? (() => {
    const rows = tkItems.map(e => {
      const b = _calcTkBases(e, g, tkTotals || { ad:0, nr:0, cars:0, sh:0 });
      const adGoal   = _calcGoalFor(e.partner, e.city, "tk_ad",   b.ad);
      const nrGoal   = _calcGoalFor(e.partner, e.city, "tk_nr",   b.nr);
      const carsGoal = _calcGoalFor(e.partner, e.city, "tk_cars", b.cars);
      const shGoal   = _calcGoalFor(e.partner, e.city, "tk_sh",   b.sh);
      const nr = e.np + e.ns + e.re;
      return `<tr><td style="font-weight:600;vertical-align:top;padding:7px 12px">${escapeHTML(e.city)}</td>${_calcGoalCell(adGoal, e.ad, fmt, lang)}${_calcGoalCell(nrGoal, nr, fmt, lang)}${_calcGoalCell(carsGoal, e.bcars, fmt, lang)}${_calcGoalCell(shGoal, e.sh, fmt, lang)}</tr>`;
    }).join("");
    const heads = [{h:_calcLab("city",lang),a:"left"},{h:_calcLab("ad",lang)},{h:_calcLab("nr",lang)},{h:_calcLab("cars",lang)},{h:_calcLab("sh",lang)}].map(_th).join("");
    return `
      <div style="font-size:.72rem;font-weight:800;color:#7e22ce;margin:4px 0 6px">🛺 TukTuk</div>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#faf5ff">${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  })() : "";

  const hasData  = !!(taxiBlock || fleetBlock || tkBlock);
  const refMonth = _calcMonthLabel(lastMonth || tkLast || "", lang);
  const subLabel = { es: "Meta vs último mes", en: "Goal vs last month", "es-en": "Meta vs último mes / Goal vs last month" }[lang];
  const genDate  = new Date().toLocaleDateString(lang === "en" ? "en-US" : "es-PE");
  const langBtns = [["es","ES"],["en","EN"],["es-en","ES/EN"]].map(([code, txt]) => {
    const on = lang === code;
    return `<button onclick="calcSetExportLang('${code}')" style="padding:7px 12px;font-size:.74rem;font-weight:700;border:none;cursor:pointer;background:${on?"#10b981":"#fff"};color:${on?"#fff":"#555"}">${txt}</button>`;
  }).join("");

  return `
    ${_secH("📤", "#10b981", "Vista compartible por partner", "Tarjeta compartible bilingüe · " + subLabel + (refMonth ? " (" + refMonth + ")" : "") + " · sin mezclar otros partners")}
    <div class="section">
      <div style="display:flex;gap:14px;align-items:end;margin-bottom:10px;flex-wrap:wrap">
        <div style="position:relative">
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px">Partner</label>
          <input type="text" id="calcExportSearch" class="sb-inp" placeholder="Buscar partner..." autocomplete="off"
            value="${escapeHTML(sel)}" style="width:240px"
            oninput="calcFilterExportPartners(this.value)"
            onfocus="calcShowExportList()"
            onblur="setTimeout(calcHideExportList, 200)"
            onkeydown="calcExportKeydown(event)"/>
          <div id="calcExportList" style="display:none;position:absolute;top:100%;left:0;width:240px;max-height:280px;overflow-y:auto;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.12);z-index:100;margin-top:2px"></div>
        </div>
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px">Idioma / Language</label>
          <div style="display:inline-flex;border:1px solid #ddd;border-radius:8px;overflow:hidden">${langBtns}</div>
        </div>
        <button style="padding:7px 14px;font-size:.78rem;background:#10b981;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcDownloadPartnerImage()">📥 Descargar Imagen</button>
      </div>

      <div id="calcExportCard" style="background:linear-gradient(135deg,#fff 0%,#fff8f8 100%);border:2px solid #FF0000;border-radius:12px;padding:20px;max-width:560px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:36px;height:36px;background:#FF0000;border-radius:10px;display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="20" height="20"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <div style="font-size:.7rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${_calcLab("proposal", lang)}</div>
            <div style="font-size:1.1rem;font-weight:900;color:#111">${escapeHTML(sel)}</div>
          </div>
        </div>
        ${taxiBlock}${fleetBlock}${tkBlock}
        ${hasData ? _calcExportLegend(lang) : `<div style="font-size:.78rem;color:#aaa;padding:8px 0">Sin datos para este partner.</div>`}
        <div style="margin-top:10px;font-size:.65rem;color:#aaa;font-style:italic">
          ${_calcLab("generated", lang)}: ${genDate}
        </div>
      </div>
    </div>`;
}

// Cambia el idioma de la tarjeta compartible (re-render de la Calculadora).
function calcSetExportLang(lang) {
  CALC_STATE.exportLang = lang;
  renderCalculator();
}

// ── INTERACCIONES ─────────────────────────────────────────────────────────────
function calcSetTab(tab) {
  CALC_STATE.tab = tab;
  renderCalculator();
}

function calcOnKamChange(v) {
  CALC_STATE.kam = v;
  CALC_STATE.tab = "agg";               // vuelve a la pestaña base (evita quedar en una que desaparece)
  CALC_STATE.selPartnerExport = null;
  renderCalculator();
}

function _calcScheduleRerender() {
  if (STATE.curTab !== "calculator") return;
  clearTimeout(CALC_STATE._editDeb);
  const tokenAtSchedule = STATE._tabRenderId;
  CALC_STATE._editDeb = setTimeout(() => {
    CALC_STATE._editDeb = null;
    if (STATE._tabRenderId !== tokenAtSchedule) return;
    if (STATE.curTab !== "calculator") return;
    renderCalculator();
  }, 400);
}

function calcCancelPendingRender() {
  if (CALC_STATE._editDeb) {
    clearTimeout(CALC_STATE._editDeb);
    CALC_STATE._editDeb = null;
  }
}

function calcOnGoalEdit(input) {
  const partner = input.dataset.pk;
  const city    = input.dataset.city;
  const metric  = input.dataset.metric;
  const val     = parseFloat(input.value);
  const k = `${partner}|||${city}|||${metric}`;
  if (isNaN(val)) delete CALC_STATE.edits[k];
  else CALC_STATE.edits[k] = val;
  // No re-render aqui (perderia el focus). El usuario edita libre y luego "Recalcular"
  // o cambia de pestaña. Solo refrescamos el estado en vivo (píldoras + puntos).
  _calcRefreshStatus();
}

function calcOnKamGoalChange(metric, val) {
  CALC_STATE.kamGoals[metric] = parseFloat(val) || 0;
  // No re-render por keystroke: se aplica con "Recalcular distribución" / cambio de pestaña.
  _calcRefreshStatus();
}

// Re-renderiza con metas + edits aplicados. Lo llama "↻ Recalcular distribución".
function calcApplyChanges() {
  renderCalculator();
}

function calcOnExportPartnerChange(v) {
  CALC_STATE.selPartnerExport = v;
  renderCalculator();
}

function calcResetEdits() {
  if (!Object.keys(CALC_STATE.edits).length) return;
  if (!confirm("¿Borrar todas las ediciones manuales y volver a la distribución automática?")) return;
  CALC_STATE.edits = {};
  CALC_STATE._utilSeeded = {};   // permite re-sembrar Utilización = 85
  renderCalculator();
}

// ── CONSTRUCCIÓN DE FILAS DE METAS (fuente única: CSV + guardado directo) ──────
const CALC_MES_NOMBRES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
function _calcNextMonth(monthStr) {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return "2026-01";
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m, 1); // m sin -1 = mes siguiente
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// Mes objetivo como NOMBRE (metas.mes) + año (metas.mes_year).
function _calcNextMonthName(lastMonth) {
  const iso = _calcNextMonth(lastMonth);
  const [y, mm] = iso.split("-").map(Number);
  return { name: CALC_MES_NOMBRES[mm - 1] || iso, year: y, iso };
}

// Construye las filas de metas (Agregador + Fleet + TukTuk) del KAM actual para el
// próximo mes. Una fila por (clid,city). MISMA matemática que la UI (_calcAggMetaBases /
// _calcTkBases / _calcGoalFor) → CSV, guardado directo y pantalla no divergen.
function _calcBuildMetaRows(m) {
  const g = CALC_STATE.kamGoals;
  const { name: mesName, year: mesYear } = _calcNextMonthName(m.lastMonth || "");
  const byKey = new Map();
  const getRow = (partner, city, clid) => {
    const k = `${clid}|||${city}`;
    let r = byKey.get(k);
    if (!r) {
      r = { clid, partner,
            kam: CALC_STATE.kam === "all" ? (getKAMForPartner(partner) || "") : CALC_STATE.kam,
            city, mes: mesName, mes_year: mesYear };
      byKey.set(k, r);
    }
    return r;
  };
  // Agregador (último mes): Fleet incluido en el reparto (denominador = todos).
  for (const e of m.aggLast1.values()) {
    const clid = e.clid || _calcLookupClid(e.partner, e.city);
    if (!clid) continue;
    const b = _calcAggMetaBases(e, g, m.distTot1);
    const r = getRow(e.partner, e.city, clid);
    r.meta_active_drivers = _calcGoalFor(e.partner, e.city, "ad", b.ad);
    r.meta_supply_hours   = _calcGoalFor(e.partner, e.city, "sh", b.sh);
    r.meta_nr             = _calcGoalFor(e.partner, e.city, "nr", b.nr);
  }
  // Fleet KPIs (solo partners fleet, solo si el KAM cargó algún valor).
  for (const e of m.aggLast3.values()) {
    if (!_calcIsFleet(e.partner)) continue;
    const clid = e.clid || _calcLookupClid(e.partner, e.city);
    if (!clid) continue;
    const shcar  = CALC_STATE.edits[`${e.partner}|||${e.city}|||shcar`];
    const accept = CALC_STATE.edits[`${e.partner}|||${e.city}|||accept`];
    const util   = CALC_STATE.edits[`${e.partner}|||${e.city}|||util`];
    if (![shcar, accept, util].some(v => v !== undefined && v !== "")) continue;
    const r = getRow(e.partner, e.city, clid);
    if (shcar  !== undefined && shcar  !== "") r.meta_sh_car      = +shcar;
    if (accept !== undefined && accept !== "") r.meta_acceptance  = +accept;
    if (util   !== undefined && util   !== "") r.meta_utilization = +util;
  }
  // TukTuk (último mes tuktuk).
  for (const e of m.aggTk1.values()) {
    const clid = e.clid || _calcLookupClid(e.partner, e.city);
    if (!clid) continue;
    const b = _calcTkBases(e, g, m.tkCartT1);
    const r = getRow(e.partner, e.city, clid);
    r.meta_tk_ad   = _calcGoalFor(e.partner, e.city, "tk_ad",   b.ad);
    r.meta_tk_nr   = _calcGoalFor(e.partner, e.city, "tk_nr",   b.nr);
    r.meta_tk_cars = _calcGoalFor(e.partner, e.city, "tk_cars", b.cars);
    r.meta_tk_sh   = _calcGoalFor(e.partner, e.city, "tk_sh",   b.sh);
  }
  return { rows: [...byKey.values()], mesName, mesYear };
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
// Plantilla CSV con TODAS las líneas (Agregador + Fleet + TukTuk). Headers alineados
// con uploadMetas → se puede resubir en Configuración → Metas. Blanks donde no aplica.
function calcExportExcel() {
  const m = _calcComputeModel();
  const { rows, mesName, mesYear } = _calcBuildMetaRows(m);
  const header = ["CLID", "PARTNER", "CIUDAD", "MES", "AÑO",
    "ACTIVE DRIVERS", "N+R", "SUPPLY HOURS",
    "META SH/AUTO", "META ACEPTACION", "META UTILIZACION",
    "META TK AD", "META TK N+R", "META TK CARS", "META TK SH"];
  const q   = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const num = v => (v == null ? "" : v);
  const lines = [header.join(",")];
  rows.forEach(r => {
    lines.push([
      q(r.clid), q(r.partner), q(r.city), q(r.mes), num(r.mes_year),
      num(r.meta_active_drivers), num(r.meta_nr), num(r.meta_supply_hours),
      num(r.meta_sh_car), num(r.meta_acceptance), num(r.meta_utilization),
      num(r.meta_tk_ad), num(r.meta_tk_nr), num(r.meta_tk_cars), num(r.meta_tk_sh)
    ].join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `metas_${mesName}_${mesYear}_${CALC_STATE.kam || "all"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showBanner(true, "Plantilla de metas exportada · súbela en Configuración → Metas");
}

// Guarda las metas del KAM directo en Supabase (sin round-trip de Excel).
// read-merge-write: preserva columnas de otras líneas que este guardado no tocó.
async function calcSaveMetas() {
  if (!STATE.canWrite) { alert("Guardar metas requiere rol de KAM o administrador."); return; }
  if (CALC_STATE.kam === "all") { alert("Elige un KAM específico (no 'Todos los KAMs') para guardar sus metas."); return; }
  const m = _calcComputeModel();
  const { rows, mesName, mesYear } = _calcBuildMetaRows(m);
  if (!rows.length) { alert("No hay metas para guardar en este KAM."); return; }

  // Resumen antes de escribir.
  const g = CALC_STATE.kamGoals;
  const a = _calcAggDistSums(m.aggLast1, m.distTot1, g);
  const t = _calcTkDistSums(m.aggTk1, m.tkCartT1, g);
  const nAgg   = rows.filter(r => r.meta_active_drivers != null).length;
  const nFleet = rows.filter(r => r.meta_sh_car != null || r.meta_acceptance != null || r.meta_utilization != null).length;
  const nTk    = rows.filter(r => r.meta_tk_ad != null || r.meta_tk_nr != null || r.meta_tk_cars != null || r.meta_tk_sh != null).length;
  const summary =
    `Guardar metas de ${CALC_STATE.kam} para ${mesName} ${mesYear}\n\n` +
    `• Agregador: ${nAgg} partner-ciudad · AD ${fmt(a.sumAD)} · SH ${fmt(a.sumSH)} · N+R ${fmt(a.sumNR)}\n` +
    (nFleet ? `• Fleet: ${nFleet} partner-ciudad con meta\n` : "") +
    (nTk    ? `• TukTuk: ${nTk} partner-ciudad · AD ${fmt(t.sAD)} · N+R ${fmt(t.sNR)} · Brandeados ${fmt(t.sCars)} · SH ${fmt(t.sSH)}\n` : "") +
    `\nTotal filas: ${rows.length}\n\n` +
    `⚠️ Esto REEMPLAZA las metas de ${mesName} ${mesYear} (no se suman ni acumulan a lo que ya\n` +
    `exista para ese mes). Si guardas otra vez para ${mesName}, se sobrescriben.\n\n` +
    `¿Confirmar y guardar en la base de datos?`;
  if (!confirm(summary)) return;

  showLoad(true, "Guardando metas...");
  try {
    const clids = [...new Set(rows.map(r => r.clid))];
    const { data: existing, error: selErr } = await sb.from("metas")
      .select("*").in("clid", clids).eq("mes", mesName);
    if (selErr) throw selErr;
    const exMap = new Map((existing || []).map(x => [`${x.clid}|||${normCity(x.city)}`, x]));
    // Payload homogéneo (mismas claves en todas las filas) → sin sorpresas de union en
    // PostgREST. r (computado) pisa; ex rellena columnas de otras líneas no tocadas.
    const COLS = ["clid", "partner", "kam", "city", "mes", "mes_year",
      "meta_active_drivers", "meta_nr", "meta_supply_hours",
      "meta_sh_car", "meta_acceptance", "meta_utilization",
      "meta_tk_ad", "meta_tk_nr", "meta_tk_cars", "meta_tk_sh"];
    const payload = rows.map(r => {
      const ex = exMap.get(`${r.clid}|||${r.city}`) || {};
      const merged = { ...ex, ...r };
      const o = {};
      for (const c of COLS) o[c] = merged[c] !== undefined ? merged[c] : null;
      return o;
    });
    const { error } = await sb.from("metas").upsert(payload, { onConflict: "clid,city,mes" });
    if (error) throw error;
    await loadFromSupabase();
    showBanner(true, `Metas de ${CALC_STATE.kam} guardadas para ${mesName} ${mesYear} (${payload.length} filas)`);
    renderCalculator();
    if (STATE.curTab === "metas" && typeof renderMetas === "function") renderMetas();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (/42501|row-level security|permission/i.test(msg)) {
      alert("No tienes permisos para guardar metas (requiere admin).");
    } else {
      alert("Error al guardar metas: " + msg);
    }
  } finally {
    showLoad(false);
  }
}

async function calcDownloadPartnerImage() {
  if (!window.html2canvas) { alert("html2canvas no disponible."); return; }
  const card = document.getElementById("calcExportCard");
  if (!card) return;
  showLoad(true, "Generando imagen...");
  try {
    const canvas = await html2canvas(card, { scale: 2, useCORS: true, backgroundColor: "#fff" });
    const imgData = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = imgData;
    a.download = `meta_${CALC_STATE.selPartnerExport || "partner"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showBanner(true, "Imagen descargada");
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    showLoad(false);
  }
}

// ── COMBOBOX FLOTANTE PARA VISTA COMPARTIBLE ──────────────────────────────────
function calcFilterExportPartners(q) {
  calcShowExportList();
  _calcPaintExportList(q);
}

function calcShowExportList() {
  const list = document.getElementById("calcExportList");
  if (!list) return;
  list.style.display = "block";
  if (!list.innerHTML) {
    const inp = document.getElementById("calcExportSearch");
    _calcPaintExportList(inp ? inp.value : "");
  }
}

function calcHideExportList() {
  const list = document.getElementById("calcExportList");
  if (list) list.style.display = "none";
}

function _calcPaintExportList(q) {
  const list = document.getElementById("calcExportList");
  if (!list) return;
  // Universo = partners con taxi (agg 3M) ∪ partners con TukTuk (filtrados por KAM).
  const tkPartners = (STATE._tuktukMensualPartners || []).filter(p =>
    CALC_STATE.kam === "all" || getKAMForPartner(p) === CALC_STATE.kam);
  const all = [...new Set([
    ...[...(_calcCurrentAgg() || []).values()].map(e => e.partner),
    ...tkPartners
  ])].sort();
  const lower = (q || "").toLowerCase().trim();
  const filtered = lower ? all.filter(p => p.toLowerCase().includes(lower)) : all;
  if (!filtered.length) {
    list.innerHTML = `<div style="padding:8px 12px;font-size:.78rem;color:#aaa">Sin coincidencias</div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 100).map(p => {
    const c = STATE.partnerColors[p] || "#888";
    const sel = p === CALC_STATE.selPartnerExport;
    return `<div class="pv-opt" onmousedown="calcSelectExportPartner('${escapeJSAttr(p)}')"
      style="padding:7px 12px;font-size:.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid #f3f3f3;${sel ? 'background:#fff0f0;font-weight:700' : ''}">
      <span style="width:7px;height:7px;border-radius:50%;background:${c};flex-shrink:0"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(p)}</span>
    </div>`;
  }).join("");
}

function calcSelectExportPartner(p) {
  const inp = document.getElementById("calcExportSearch");
  if (inp) inp.value = p;
  calcHideExportList();
  calcOnExportPartnerChange(p);
}

function calcExportKeydown(e) {
  if (e.key === "Enter") {
    const list = document.getElementById("calcExportList");
    const first = list && list.querySelector(".pv-opt");
    if (first) first.dispatchEvent(new MouseEvent("mousedown"));
    e.preventDefault();
  } else if (e.key === "Escape") {
    calcHideExportList();
  }
}

// Universo de partners para el combobox: agregado de los últimos 3 meses con el filtro KAM actual.
function _calcCurrentAgg() {
  const rows = _calcGetMensualData();
  if (!rows.length) return new Map();
  const last3 = _calcLastNMonths(rows, 3);
  const last3Set = new Set(last3);
  const filteredRows = CALC_STATE.kam === "all"
    ? rows
    : rows.filter(r => (r.kam || getKAMForPartner(r.partner)) === CALC_STATE.kam);
  return _calcAggByPartnerCity(filteredRows, last3Set);
}
