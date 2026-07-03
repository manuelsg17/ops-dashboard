// calculator.js — Calculadora de Metas (flujo TOP-DOWN)
// El KAM ingresa su meta TOTAL y se reparte (disgrega) a cada partner+ciudad
// segun su % de representacion en el ULTIMO MES.
// Secciones (en orden):
//  1) Ingresa tus metas KAM (agregador + TukTuk, formato Yango con pesos) → Distribuir
//  2) % Representacion Ciudad + Cartera (peso del partner en la ciudad y en tu KAM)
//  3) Distribucion de metas agregador (meta KAM x % — editable, valida el cuadre)
//  4) Metas Fleet (KPIs propios)
//  5-6) Representacion + Distribucion TukTuk (si hay flota TukTuk)
//  Bloque de acciones (Aplicar / Reset / Descargar CSV) + tarjeta compartible
//  Al final, colapsable: Promedio 3 meses (referencia, no reparte)

const CALC_STATE = {
  kam:        "all",
  // Metas editadas manualmente: { "partner|||city|||metric": valor }
  edits:      {},
  // Metas KAM input manual (formato Yango con pesos) + metas TukTuk (Fase 7)
  kamGoals:   { ad: 0, sh: 0, nr: 0, otherProj: 0, fleetA2: 0, tkAd: 0, tkNr: 0, tkCars: 0 }
};

// Pesos Yango (formato KAM-level)
const KAM_WEIGHTS = {
  ad:        15,    // %
  sh:        15,
  nr:        27.5,
  otherProj: 35,
  fleetA2:    7.5
};

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
            activeCars: 0, shCarW: 0, acceptW: 0 };
      out.set(k, e);
    }
    if (!e.clid && r.clid) e.clid = r.clid;
    e.trips += r.trips || 0;
    e.sh    += r.supplyHours || 0;
    if ((r.activeDrivers || 0) > e.ad) e.ad = r.activeDrivers || 0;  // AD: snapshot (max)
    if ((r.brandedActiveCars || 0) > e.bcars) e.bcars = r.brandedActiveCars || 0;  // cars TukTuk: snapshot (max)
    e.np    += r.newPartner || 0;
    e.ns    += r.newService || 0;
    e.re    += r.reactivated || 0;
    // Referencias fleet (tasas): sh_per_active_car ponderado por active cars (dato
    // del export, no recalculado), acceptance (0-1) ponderado por viajes.
    e.activeCars += r.activeCars || 0;
    e.shCarW     += (r.shPerActiveCar || 0) * (r.activeCars || 0);
    e.acceptW    += (r.acceptanceRate || 0) * (r.trips || 0);
  });
  return out;
}

// Referencia 3m (promedio ponderado) de los KPIs fleet de un partner-ciudad.
function _calcFleetRef(e) {
  return {
    shcar:  e.activeCars > 0 ? e.shCarW / e.activeCars : null,   // horas/auto activo
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
// Totales TukTuk (AD/N+R/cars) — alias semántico sobre _calcKamTotals.
function _calcTkTotals(agg, opts) { const t = _calcKamTotals(agg, opts); return { ad: t.ad, nr: t.nr, cars: t.cars }; }

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

// Bases distribuidas de AGREGADOR (AD/SH/N+R) para un partner-ciudad. Fleet → 0
// (incremento mínimo, editable) y marcado. distTotals = _calcKamTotals(...,{excludeFleet:true}).
function _calcAggMetaBases(e, g, distTotals) {
  if (_calcIsFleet(e.partner)) return { ad: 0, sh: 0, nr: 0, fleet: true };
  const nr = e.np + e.ns + e.re;
  return {
    ad: (+g.ad || 0) * _calcShare(e.ad, distTotals.ad),
    sh: (+g.sh || 0) * _calcShare(e.sh, distTotals.sh),
    nr: (+g.nr || 0) * _calcShare(nr,  distTotals.nr),
    fleet: false
  };
}
// Bases distribuidas TukTuk (AD/N+R/cars).
function _calcTkBases(e, g, distTotals) {
  const nr = e.np + e.ns + e.re;
  return {
    ad:   (+g.tkAd   || 0) * _calcShare(e.ad,    distTotals.ad),
    nr:   (+g.tkNr   || 0) * _calcShare(nr,      distTotals.nr),
    cars: (+g.tkCars || 0) * _calcShare(e.bcars, distTotals.cars)
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

  const filteredRows = CALC_STATE.kam === "all"
    ? rows
    : rows.filter(r => {
        const k = r.kam || getKAMForPartner(r.partner);
        return k === CALC_STATE.kam;
      });

  const allMonths = [...new Set(rows.map(r => r.date))].sort();
  const last3 = allMonths.slice(-3);
  const last3Set = new Set(last3);
  const lastMonth = allMonths[allMonths.length - 1];

  // Agregados TAXI: 3M para el promedio (sec 2); ÚLTIMO MES para representación y
  // reparto (así el % que se ve = el que reparte). distTot1 excluye fleet → cuadra 100%.
  const aggLast3 = _calcAggByPartnerCity(filteredRows, last3Set);
  const aggLast1 = _calcAggByPartnerCity(filteredRows, new Set([lastMonth]));
  const cartTot1 = _calcKamTotals(aggLast1);
  const distTot1 = _calcKamTotals(aggLast1, { excludeFleet: true });
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
  const hasTk    = tkRows.length > 0;

  const TAXI_METRICS = [
    { key: "ad", label: "AD",  get: e => e.ad },
    { key: "sh", label: "SH",  get: e => e.sh },
    { key: "nr", label: "N+R", get: e => e.np + e.ns + e.re }
  ];
  const TK_METRICS = [
    { key: "ad",   label: "AD",   get: e => e.ad },
    { key: "nr",   label: "N+R",  get: e => e.np + e.ns + e.re },
    { key: "cars", label: "Cars", get: e => e.bcars }
  ];
  const cardNo = hasTk ? 7 : 5;

  el.innerHTML = `
    <div style="padding:0 8px 16px">
      ${_calcSec1_metas(allKAMs, lastMonth, hasTk)}
      ${_calcSec3_pct(aggLast1, cartTot1, cityTot1, lastMonth, { n: 2, icon: "🔥", color: "#f59e0b", title: "% Representación · Ciudad + Cartera", metrics: TAXI_METRICS })}
      ${_calcSec4_distribucion(aggLast1, distTot1, lastMonth, 3)}
      ${_calcSec4b_fleet(aggLast3, 4)}
      ${hasTk ? _calcSec3_pct(aggTk1, tkCartT1, tkCityT1, tkLast1, { n: 5, icon: "🛺", color: "#a855f7", title: "% Representación TukTuk · Ciudad + Cartera", metrics: TK_METRICS }) : ""}
      ${hasTk ? _calcSecTk_distribucion(aggTk1, tkCartT1, tkLast1, 6) : ""}
      ${_calcSecActions()}
      ${_calcSec5_exportPartner(aggLast1, distTot1, aggTk1, tkCartT1, cardNo)}
      ${_calcSec2_promedio3m(aggLast3, last3)}
    </div>`;
}

// ── SECCION 1: Ingresa tus metas KAM ──────────────────────────────────────────
function _calcSec1_metas(allKAMs, lastMonth, hasTk) {
  const g = CALC_STATE.kamGoals;
  const tkBox = hasTk ? `
      <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:12px;margin-top:10px">
        <div style="font-size:.78rem;font-weight:700;color:#7e22ce;margin-bottom:8px">🛺 Metas totales TukTuk (branding cars):</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
          ${_kamGoalInput("tkAd",   "AD (TukTuk)",   null, g.tkAd)}
          ${_kamGoalInput("tkNr",   "N+R (TukTuk)",  null, g.tkNr)}
          ${_kamGoalInput("tkCars", "Cars (branded)",null, g.tkCars)}
        </div>
        <div style="font-size:.7rem;color:#7e22ce;margin-top:8px;font-style:italic">Se reparten entre tus partners con flota TukTuk según su peso. Metas TukTuk viven en la tarjeta del partner (no en el CSV de agregador).</div>
      </div>` : "";
  return `
    ${_secH("🎯", "#FF0000", "1. Ingresa tus metas KAM", "Paso 1 · completa TODAS tus metas (agregador + TukTuk) y presiona Distribuir")}
    <div class="section">
      <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">KAM</label>
          <select id="calcKamSel" class="sb-sel" style="width:200px" onchange="calcOnKamChange(this.value)">
            <option value="all" ${CALC_STATE.kam === "all" ? "selected" : ""}>Todos los KAMs</option>
            ${allKAMs.map(k => `<option value="${escapeHTML(k)}" ${CALC_STATE.kam === k ? "selected" : ""}>${escapeHTML(k)}</option>`).join("")}
          </select>
        </div>
        <div style="font-size:.72rem;color:#666;background:#fef3c7;padding:6px 10px;border-radius:6px;border:1px solid #fcd34d">
          📅 Distribución según último mes: ${d2s(lastMonth || "")}
        </div>
      </div>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px">
        <div style="font-size:.78rem;font-weight:700;color:#92400e;margin-bottom:8px">📥 Metas totales · Agregador (Taxi):</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
          ${_kamGoalInput("ad",        "Active Drivers",       KAM_WEIGHTS.ad,        g.ad)}
          ${_kamGoalInput("sh",        "Supply Hours",         KAM_WEIGHTS.sh,        g.sh)}
          ${_kamGoalInput("nr",        "New + Reactivated",    KAM_WEIGHTS.nr,        g.nr)}
          ${_kamGoalInput("otherProj", "Other Projects (%)",   KAM_WEIGHTS.otherProj, g.otherProj)}
          ${_kamGoalInput("fleetA2",   "Fleet drivers A2 (%)", KAM_WEIGHTS.fleetA2,   g.fleetA2)}
        </div>
        <div style="font-size:.7rem;color:#92400e;margin-top:10px;font-style:italic">
          <strong>AD · SH · N+R</strong> se reparten entre tus partners según su % del último mes.
          <strong>Other Projects</strong> y <strong>Fleet A2</strong> son metas % a nivel KAM (no se reparten por partner).
        </div>
      </div>
      ${tkBox}
      <button id="calcDistBtn" style="width:100%;margin-top:14px;padding:12px;font-size:.9rem;background:#FF0000;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer" onclick="calcApplyChanges()">📊 Distribuir metas</button>
    </div>`;
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

// ── SECCION 2: Promedio 3 últimos meses ───────────────────────────────────────
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

// ── SECCION 3 / 6: % Representación (Ciudad + Cartera) — parametrizable ─────────
// Por cada métrica muestra DOS columnas: % Ciudad (val ÷ total de la ciudad, TODOS
// los partners → "peso de Yego en Lima", exacto) y % Cartera (val ÷ total del KAM
// = base del reparto, suma 100%). Ventana: último mes. opts.metrics = [{key,label,get}],
// cartTotals[key], cityTotals=Map<city,{key:val}>. Reusa _calcHeatBg/_calcHeatColor.
function _calcSec3_pct(agg, cartTotals, cityTotals, monthLabel, opts) {
  const M = opts.metrics;
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const _pctCell = (val, tot) => {
    if (!tot) return `<td class="tn" style="color:#ccc">—</td>`;
    const pct = (val / tot) * 100;
    return `<td class="tn" style="background:${_calcHeatBg(pct)};color:${_calcHeatColor(pct)};font-weight:700">${pct.toFixed(1)}%</td>`;
  };

  const rowsHtml = items.map(e => {
    const ct = cityTotals.get(e.city) || {};
    const cells = M.map(m => {
      const v = m.get(e);
      return _pctCell(v, ct[m.key]) + _pctCell(v, cartTotals[m.key]);   // Ciudad, Cartera
    }).join("");
    return `
      <tr>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        ${cells}
      </tr>`;
  }).join("");

  const topHead = M.map(m => `<th class="tn" colspan="2">${escapeHTML(m.label)}</th>`).join("");
  const subHead = M.map(() => `<th class="tn" title="Peso en la ciudad (todos los KAMs)">% Ciudad</th><th class="tn" title="Peso en tu cartera KAM">% Cartera</th>`).join("");
  const footCells = M.map(() => `<td class="tn" style="color:#aaa">—</td><td class="tn">100%</td>`).join("");
  const nCols = 2 + M.length * 2;

  return `
    ${_secH(opts.icon, opts.color, `${opts.n}. ${opts.title} · ${d2s(monthLabel || "")}`,
            "% Ciudad = peso real de tu partner en la ciudad (todos los partners Yango) · % Cartera = peso en tu KAM (base del reparto) · ventana: último mes")}
    <div class="section">
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
      </div>
    </div>`;
}

// ── SECCION 4: Distribución de metas AGREGADOR (editable) ──────────────────────
// Ventana: último mes (misma que la representación → el % que ves reparte).
// Fleet: base 0 (incremento mínimo, editable) + badge; el cuadre solo cuenta a los
// agregadores no-fleet (distTotals ya los excluyó) → suma 100% de la meta KAM.
function _calcSec4_distribucion(agg, distTotals, monthLabel, n) {
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
  const _pct = (val, tot, fleet) => fleet ? "—" : (tot > 0 ? ((val / tot) * 100).toFixed(1) + "%" : "—");

  let sumAD = 0, sumSH = 0, sumNR = 0;      // agregadores (cuadre)
  let fAD = 0, fSH = 0, fNR = 0;            // fleet (manual, informativo)
  const rowsHtml = items.map(e => {
    const nr = e.np + e.ns + e.re;
    const b = _calcAggMetaBases(e, g, distTotals);
    const ad = _calcGoalFor(e.partner, e.city, "ad", b.ad);
    const sh = _calcGoalFor(e.partner, e.city, "sh", b.sh);
    const nrg = _calcGoalFor(e.partner, e.city, "nr", b.nr);
    if (b.fleet) { fAD += ad; fSH += sh; fNR += nrg; }
    else         { sumAD += ad; sumSH += sh; sumNR += nrg; }
    const badge = b.fleet ? ` <span style="font-size:.58rem;background:#0891b2;color:#fff;padding:1px 5px;border-radius:6px;vertical-align:middle">FLEET</span>` : "";
    return `
      <tr${b.fleet ? ' style="background:#f1f5f9"' : ''}>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}${badge}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        <td class="tn" style="color:#888">${_pct(e.ad, distTotals.ad, b.fleet)}</td>
        <td>${_input(e.partner, e.city, "ad", b.ad)}</td>
        <td class="tn" style="color:#888">${_pct(e.sh, distTotals.sh, b.fleet)}</td>
        <td>${_input(e.partner, e.city, "sh", b.sh)}</td>
        <td class="tn" style="color:#888">${_pct(nr, distTotals.nr, b.fleet)}</td>
        <td>${_input(e.partner, e.city, "nr", b.nr)}</td>
      </tr>`;
  }).join("");

  const noGoals = !(+g.ad || +g.sh || +g.nr);
  const hint = noGoals
    ? `<div style="font-size:.78rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin-bottom:8px">⚠️ Ingresa tus metas KAM en la sección 1 y presiona <strong>"Distribuir metas"</strong> para repartirlas aquí.</div>`
    : "";
  const fleetRow = (fAD || fSH || fNR) ? `
            <tr>
              <td colspan="2" style="color:#0891b2;font-weight:600">Fleet (manual · no cuadra)</td>
              <td></td><td class="tn">${fmt(fAD)}</td>
              <td></td><td class="tn">${fmt(fSH)}</td>
              <td></td><td class="tn">${fmt(fNR)}</td>
            </tr>` : "";

  return `
    ${_secH("⚙️", "#8b5cf6", n + ". Distribución de metas · Agregador · " + d2s(monthLabel || ""), "Paso 2 · Meta KAM × % Cartera (último mes) · editable · los Fleet arrancan en 0 (mínimo)")}
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
              <td colspan="2">Suma agregadores</td>
              <td></td><td class="tn">${fmt(sumAD)}</td>
              <td></td><td class="tn">${fmt(sumSH)}</td>
              <td></td><td class="tn">${fmt(sumNR)}</td>
            </tr>${fleetRow}
            <tr>
              <td colspan="2" style="color:#666;font-weight:600">Meta KAM · cuadre</td>
              <td></td><td class="tn">${_calcCuadre(sumAD, +g.ad || 0)}</td>
              <td></td><td class="tn">${_calcCuadre(sumSH, +g.sh || 0)}</td>
              <td></td><td class="tn">${_calcCuadre(sumNR, +g.nr || 0)}</td>
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

// ── SECCION 4b: KPIs Fleet (opcional) ─────────────────────────────────────────
// Metas manuales por partner-ciudad para partners fleet. NO se distribuyen ni van
// al CSV (la tabla `metas` no las tiene); si se llenan, aparecen en la tarjeta (sec 5).
function _calcSec4b_fleet(agg, n) {
  const items = [...agg.values()]
    .filter(e => _calcIsFleet(e.partner))       // Fase 7: solo partners fleet
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
    ${_secH("🚗", "#0891b2", n + ". Metas Fleet (KPIs propios)", "Solo partners marcados Fleet · SH/Auto, Aceptación, Utilización · van a la tarjeta del partner")}
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
        💡 Utilización: la meta suele ser <strong>85%</strong> (active cars / total) — llénala solo en los partners que aplican. Estos 3 KPIs <strong>no van al CSV</strong>; aparecen solo en la tarjeta compartible (al final). Presiona <strong>"Aplicar cambios"</strong> (bloque de acciones, al final) para reflejarlos.
      </div>
    </div>`;
}

// ── SECCION 7: Distribución de metas TukTuk (editable) ────────────────────────
// KPIs AD / N+R / Cars (branded_active_cars). Reparte g.tkAd/tkNr/tkCars por peso
// dentro de la cartera TukTuk. edit-keys tk_* (disjuntas de taxi). Solo card, no CSV.
function _calcSecTk_distribucion(agg, distTotals, monthLabel, n) {
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

  let sAD = 0, sNR = 0, sCars = 0;
  const rowsHtml = items.map(e => {
    const b = _calcTkBases(e, g, distTotals);
    const ad   = _calcGoalFor(e.partner, e.city, "tk_ad",   b.ad);
    const nrg  = _calcGoalFor(e.partner, e.city, "tk_nr",   b.nr);
    const cars = _calcGoalFor(e.partner, e.city, "tk_cars", b.cars);
    sAD += ad; sNR += nrg; sCars += cars;
    return `
      <tr>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        <td>${_input(e.partner, e.city, "tk_ad",   b.ad)}</td>
        <td>${_input(e.partner, e.city, "tk_nr",   b.nr)}</td>
        <td>${_input(e.partner, e.city, "tk_cars", b.cars)}</td>
      </tr>`;
  }).join("");

  return `
    ${_secH("🛺", "#a855f7", n + ". Distribución de metas · TukTuk · " + d2s(monthLabel || ""), "Meta TukTuk × % Cartera · AD · N+R · Cars (branded) · editable")}
    <div class="section">
      <div class="tbl-wrap" style="max-height:460px;overflow-y:auto">
        <table class="dtbl">
          <thead>
            <tr><th>Partner</th><th>Ciudad</th><th class="tn">AD meta</th><th class="tn">N+R meta</th><th class="tn">Cars meta</th></tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px">Sin partners TukTuk en este KAM.</td></tr>`}</tbody>
          <tfoot style="font-weight:700;background:#f9f9f9">
            <tr><td colspan="2">Suma distribuida</td><td class="tn">${fmt(sAD)}</td><td class="tn">${fmt(sNR)}</td><td class="tn">${fmt(sCars)}</td></tr>
            <tr><td colspan="2" style="color:#666;font-weight:600">Meta TukTuk · cuadre</td>
              <td class="tn">${_calcCuadre(sAD, +g.tkAd || 0)}</td>
              <td class="tn">${_calcCuadre(sNR, +g.tkNr || 0)}</td>
              <td class="tn">${_calcCuadre(sCars, +g.tkCars || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="font-size:.7rem;color:#888;margin-top:6px;font-style:italic">💡 Las metas TukTuk viven en la tarjeta compartible (al final), no en el CSV de agregador.</div>
    </div>`;
}

// ── BLOQUE DE ACCIONES (Paso 3) ───────────────────────────────────────────────
// Consolidado al final del flujo: aplicar edits, resetear o descargar el CSV.
// #calcApplyBtn lo muta _calcMarkDirty (estado "pendiente"). Reemplaza los botones
// que antes vivían dentro de la Sección de distribución agregador.
function _calcSecActions() {
  return `
    ${_secH("✅", "#10b981", "Aplicar y descargar", "Paso 3 · aplica tus cambios, descarga el CSV o comparte la tarjeta")}
    <div class="section">
      <div class="tbl-wrap">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button id="calcApplyBtn" style="padding:7px 14px;font-size:.78rem;background:#10b981;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcApplyChanges()">✓ Aplicar cambios</button>
          <button style="padding:7px 14px;font-size:.78rem;background:#666;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcResetEdits()">↺ Reset ediciones</button>
          <button style="padding:7px 14px;font-size:.78rem;background:#FF0000;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcExportExcel()">📥 Descargar metas (CSV)</button>
        </div>
        <div style="font-size:.7rem;color:#888;margin-top:8px;font-style:italic">
          💡 Edita los valores libremente; al salir de cada celda se guardan. Presiona <strong>"Aplicar cambios"</strong> para refrescar el cuadre y la vista compartible. El CSV es solo de metas agregador (Taxi); Fleet y TukTuk viven en la tarjeta.
        </div>
      </div>
    </div>`;
}

// ── SECCION 8: Vista compartible / descarga por partner (Taxi + TukTuk) ────────
function _calcSec5_exportPartner(agg, totals, aggTk, tkTotals, secNo) {
  const g = CALC_STATE.kamGoals;
  const partners = [...new Set([
    ...[...agg.values()].map(e => e.partner),
    ...[...(aggTk ? aggTk.values() : [])].map(e => e.partner)
  ])].sort();
  if (!partners.length) {
    return `
      ${_secH("📤", "#10b981", `${secNo}. Vista compartible por partner`, "Sin partners en este filtro")}
      <div class="section"><div style="font-size:.78rem;color:#aaa;padding:8px 0">No hay partners en el KAM seleccionado con datos.</div></div>`;
  }
  const sel = (CALC_STATE.selPartnerExport && partners.includes(CALC_STATE.selPartnerExport))
    ? CALC_STATE.selPartnerExport
    : partners[0];
  CALC_STATE.selPartnerExport = sel;

  const taxiItems = [...agg.values()].filter(e => e.partner === sel);
  const tkItems   = [...(aggTk ? aggTk.values() : [])].filter(e => e.partner === sel);

  // KPIs fleet: columnas solo si el partner tiene meta cargada.
  const FLEET_DEFS = [
    { k: "shcar",  h: "SH/Auto",     fmt: v => fmt(v) },
    { k: "accept", h: "Aceptación",  fmt: v => fmt(v) + "%" },
    { k: "util",   h: "Utilización", fmt: v => fmt(v) + "%" }
  ];
  const editVal = (e, k) => CALC_STATE.edits[`${e.partner}|||${e.city}|||${k}`];
  const activeFleet = FLEET_DEFS.filter(fd => taxiItems.some(e => { const v = editVal(e, fd.k); return v !== undefined && v !== ""; }));

  const _th = t => `<th style="text-align:${t.a || "right"};padding:8px 12px;font-size:.74rem">${t.h}</th>`;

  // Bloque Taxi (AD/SH/N+R + fleet activas)
  const taxiBlock = taxiItems.length ? (() => {
    const rows = taxiItems.map(e => {
      const b = _calcAggMetaBases(e, g, totals);
      const adGoal = _calcGoalFor(e.partner, e.city, "ad", b.ad);
      const shGoal = _calcGoalFor(e.partner, e.city, "sh", b.sh);
      const nrGoal = _calcGoalFor(e.partner, e.city, "nr", b.nr);
      const fleetCells = activeFleet.map(fd => { const v = editVal(e, fd.k); return `<td class="tn">${v===undefined||v===""?"—":fd.fmt(+v)}</td>`; }).join("");
      return `<tr><td style="font-weight:600">${escapeHTML(e.city)}</td><td class="tn">${fmt(adGoal)}</td><td class="tn">${fmt(shGoal)}</td><td class="tn">${fmt(nrGoal)}</td>${fleetCells}</tr>`;
    }).join("");
    const heads = [{h:"Ciudad",a:"left"},{h:"Active Drivers"},{h:"Supply Hours"},{h:"N+R"}].concat(activeFleet.map(fd=>({h:fd.h}))).map(_th).join("");
    return `
      <div style="font-size:.72rem;font-weight:800;color:#b91c1c;margin:4px 0 6px">🚕 Taxi</div>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:12px">
        <thead><tr style="background:#f9f9f9">${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  })() : "";

  // Bloque TukTuk (AD/N+R/Cars)
  const tkBlock = tkItems.length ? (() => {
    const rows = tkItems.map(e => {
      const b = _calcTkBases(e, g, tkTotals || { ad:0, nr:0, cars:0 });
      const adGoal   = _calcGoalFor(e.partner, e.city, "tk_ad",   b.ad);
      const nrGoal   = _calcGoalFor(e.partner, e.city, "tk_nr",   b.nr);
      const carsGoal = _calcGoalFor(e.partner, e.city, "tk_cars", b.cars);
      return `<tr><td style="font-weight:600">${escapeHTML(e.city)}</td><td class="tn">${fmt(adGoal)}</td><td class="tn">${fmt(nrGoal)}</td><td class="tn">${fmt(carsGoal)}</td></tr>`;
    }).join("");
    const heads = [{h:"Ciudad",a:"left"},{h:"Active Drivers"},{h:"N+R"},{h:"Cars"}].map(_th).join("");
    return `
      <div style="font-size:.72rem;font-weight:800;color:#7e22ce;margin:4px 0 6px">🛺 TukTuk</div>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#faf5ff">${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  })() : "";

  return `
    ${_secH("📤", "#10b981", `${secNo}. Vista compartible por partner`, "Tarjeta compartible · Taxi + TukTuk (sin mezclar otros partners)")}
    <div class="section">
      <div style="display:flex;gap:10px;align-items:end;margin-bottom:10px;flex-wrap:wrap">
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
        <button style="padding:7px 14px;font-size:.78rem;background:#10b981;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcDownloadPartnerImage()">📥 Descargar Imagen</button>
      </div>

      <div id="calcExportCard" style="background:linear-gradient(135deg,#fff 0%,#fff8f8 100%);border:2px solid #FF0000;border-radius:12px;padding:20px;max-width:560px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:36px;height:36px;background:#FF0000;border-radius:10px;display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="20" height="20"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <div style="font-size:.7rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Metas Yango — Propuesta</div>
            <div style="font-size:1.1rem;font-weight:900;color:#111">${escapeHTML(sel)}</div>
          </div>
        </div>
        ${taxiBlock}${tkBlock}
        ${(!taxiBlock && !tkBlock) ? `<div style="font-size:.78rem;color:#aaa;padding:8px 0">Sin datos para este partner.</div>` : ""}
        <div style="margin-top:10px;font-size:.65rem;color:#aaa;font-style:italic">
          Propuesta generada el ${new Date().toLocaleDateString("es-PE")}
        </div>
      </div>
    </div>`;
}

// ── INTERACCIONES ─────────────────────────────────────────────────────────────
function calcOnKamChange(v) {
  CALC_STATE.kam = v;
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
  // No re-render aqui (perderia el focus). El usuario edita libre y luego "Aplicar".
  _calcMarkDirty();
}

function calcOnKamGoalChange(metric, val) {
  CALC_STATE.kamGoals[metric] = parseFloat(val) || 0;
  // No re-render por keystroke: se aplica con "Distribuir metas" / "Aplicar cambios".
  _calcMarkDirty();
}

// Marca visualmente que hay cambios sin aplicar, sin re-renderizar.
function _calcMarkDirty() {
  const a = document.getElementById("calcApplyBtn");
  if (a) { a.style.background = "#FF0000"; a.textContent = "✓ Aplicar cambios (pendiente)"; }
  const d = document.getElementById("calcDistBtn");
  if (d) d.textContent = "📊 Distribuir metas (pendiente)";
}

// Re-renderiza con metas + edits aplicados. Lo llaman "Distribuir metas" y "Aplicar cambios".
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
  renderCalculator();
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
function calcExportExcel() {
  const rows = _calcGetMensualData();
  const allMonths = [...new Set(rows.map(r => r.date))].sort();
  const lastMonth = allMonths[allMonths.length - 1];
  const filteredRows = CALC_STATE.kam === "all"
    ? rows
    : rows.filter(r => (r.kam || getKAMForPartner(r.partner)) === CALC_STATE.kam);
  // Mismo criterio que la UI (Sección 4): último mes + denominador non-fleet.
  const agg = _calcAggByPartnerCity(filteredRows, new Set([lastMonth]));
  const distTotals = _calcKamTotals(agg, { excludeFleet: true });
  const g = CALC_STATE.kamGoals;

  const lines = ["CLID,PARTNER,CIUDAD,MES,ACTIVE_DRIVERS,SUPPLY_HOURS,N+R"];
  const nextMonth = _calcNextMonth(lastMonth);

  [...agg.values()].forEach(e => {
    const b = _calcAggMetaBases(e, g, distTotals);   // fleet → 0 (o su edit manual)
    const adGoal = _calcGoalFor(e.partner, e.city, "ad", b.ad);
    const shGoal = _calcGoalFor(e.partner, e.city, "sh", b.sh);
    const nrGoal = _calcGoalFor(e.partner, e.city, "nr", b.nr);
    const clid = e.clid || _calcLookupClid(e.partner, e.city);
    lines.push(`"${clid}","${e.partner}","${e.city}","${nextMonth}",${adGoal},${shGoal},${nrGoal}`);
  });

  const csv = lines.join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `metas_propuesta_${nextMonth}_${CALC_STATE.kam || "all"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showBanner(true, "Metas exportadas · súbelas en Configuración → Metas");
}

function _calcNextMonth(monthStr) {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return "2026-01";
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m, 1); // m sin -1 = mes siguiente
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

// ── COMBOBOX FLOTANTE PARA VISTA COMPARTIBLE (Sec 5) ──────────────────────────
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
    return `<div class="pv-opt" onmousedown="calcSelectExportPartner('${p.replace(/'/g, "\\'")}')"
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
