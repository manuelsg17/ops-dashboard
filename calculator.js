// calculator.js — Calculadora de Metas (flujo TOP-DOWN)
// El KAM ingresa su meta TOTAL y se reparte (disgrega) a cada partner+ciudad
// segun su % de representacion en el promedio de los ultimos 3 meses.
// Secciones (en orden):
//  1) Ingresa tus metas KAM (totales del jefe, formato Yango con pesos)
//  2) Promedio ultimos 3 meses por partner+ciudad
//  3) % Representacion (peso de cada partner+ciudad en el total del KAM)
//  4) Distribucion de metas (meta KAM x % — editable, valida el cuadre)
//  5) Descarga / vista compartible por partner

const CALC_STATE = {
  kam:        "all",
  // Metas editadas manualmente: { "partner|||city|||metric": valor }
  edits:      {},
  // Metas KAM input manual (formato Yango con pesos)
  kamGoals:   { ad: 0, sh: 0, nr: 0, otherProj: 0, fleetA2: 0 }
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
            trips: 0, sh: 0, ad: 0, np: 0, ns: 0, re: 0 };
      out.set(k, e);
    }
    if (!e.clid && r.clid) e.clid = r.clid;
    e.trips += r.trips || 0;
    e.sh    += r.supplyHours || 0;
    if ((r.activeDrivers || 0) > e.ad) e.ad = r.activeDrivers || 0;  // AD: snapshot (max)
    e.np    += r.newPartner || 0;
    e.ns    += r.newService || 0;
    e.re    += r.reactivated || 0;
  });
  return out;
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

// Totales del KAM (base para repartir): suma de los valores 3m de cada partner+ciudad.
// nr = nuevos partner + nuevos yango + reactivados. (Para el % la /n se cancela.)
function _calcKamTotals(agg) {
  let ad = 0, sh = 0, nr = 0;
  for (const e of agg.values()) { ad += e.ad; sh += e.sh; nr += (e.np + e.ns + e.re); }
  return { ad, sh, nr };
}
function _calcShare(val, tot) { return tot > 0 ? val / tot : 0; }

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

  // Base unica de todo el flujo: agregado 3 meses del KAM seleccionado.
  const aggLast3 = _calcAggByPartnerCity(filteredRows, last3Set);
  const totals = _calcKamTotals(aggLast3);

  el.innerHTML = `
    <div style="padding:0 8px 16px">
      ${_calcSec1_metas(allKAMs, last3)}
      ${_calcSec2_promedio3m(aggLast3, last3)}
      ${_calcSec3_pct(aggLast3, totals)}
      ${_calcSec4_distribucion(aggLast3, totals)}
      ${_calcSec5_exportPartner(aggLast3, totals)}
    </div>`;
}

// ── SECCION 1: Ingresa tus metas KAM ──────────────────────────────────────────
function _calcSec1_metas(allKAMs, last3) {
  const g = CALC_STATE.kamGoals;
  return `
    ${_secH("🎯", "#FF0000", "1. Ingresa tus metas KAM", "Las que te dio tu jefe (formato Yango con pesos)")}
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
          📅 Distribución según promedio de: ${last3.map(d2s).join(" · ")}
        </div>
      </div>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px">
        <div style="font-size:.78rem;font-weight:700;color:#92400e;margin-bottom:8px">📥 Metas totales del KAM:</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
          ${_kamGoalInput("ad",        "Active Drivers",       KAM_WEIGHTS.ad,        g.ad)}
          ${_kamGoalInput("sh",        "Supply Hours",         KAM_WEIGHTS.sh,        g.sh)}
          ${_kamGoalInput("nr",        "New + Reactivated",    KAM_WEIGHTS.nr,        g.nr)}
          ${_kamGoalInput("otherProj", "Other Projects (%)",   KAM_WEIGHTS.otherProj, g.otherProj)}
          ${_kamGoalInput("fleetA2",   "Fleet drivers A2 (%)", KAM_WEIGHTS.fleetA2,   g.fleetA2)}
        </div>
        <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center">
          <button id="calcDistBtn" style="padding:8px 16px;font-size:.8rem;background:#FF0000;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer" onclick="calcApplyChanges()">📊 Distribuir metas</button>
          <span style="font-size:.7rem;color:#888;font-style:italic;max-width:520px">
            <strong>AD · SH · N+R</strong> se reparten entre tus partners según su % de los últimos 3 meses.
            <strong>Other Projects</strong> y <strong>Fleet A2</strong> son metas % a nivel KAM (no se reparten por partner).
          </span>
        </div>
      </div>
    </div>`;
}

function _kamGoalInput(metric, label, weight, val) {
  return `
    <div>
      <label style="font-size:.66rem;color:#666;font-weight:700;display:block;margin-bottom:3px">${escapeHTML(label)} <span style="color:#aaa">(${weight}%)</span></label>
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
    ${_secH("📊", "#06b6d4", "2. Promedio 3 últimos meses", `${items.length} partner-ciudad · KAM: ${CALC_STATE.kam === "all" ? "Todos" : CALC_STATE.kam}`)}
    <div class="section">
      <div class="tbl-wrap" style="max-height:400px;overflow-y:auto">
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
    </div>`;
}

// ── SECCION 3: % Representación (base de la distribución) ──────────────────────
function _calcSec3_pct(agg, totals) {
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const _cell = (val, tot) => {
    if (!tot) return `<td class="tn" style="color:#ccc">—</td>`;
    const pct = (val / tot) * 100;
    return `<td class="tn" style="background:${_calcHeatBg(pct)};color:${_calcHeatColor(pct)};font-weight:700">${pct.toFixed(1)}%</td>`;
  };

  const rowsHtml = items.map(e => {
    const nr = e.np + e.ns + e.re;
    return `
      <tr>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        ${_cell(e.ad, totals.ad)}
        ${_cell(e.sh, totals.sh)}
        ${_cell(nr,  totals.nr)}
      </tr>`;
  }).join("");

  return `
    ${_secH("🔥", "#f59e0b", "3. % Representación (base de la distribución)", "Peso de cada partner-ciudad en el total del KAM · suma 100% por métrica")}
    <div class="section">
      <div class="tbl-wrap" style="max-height:400px;overflow-y:auto">
        <table class="dtbl">
          <thead>
            <tr><th>Partner</th><th>Ciudad</th><th class="tn">% AD</th><th class="tn">% SH</th><th class="tn">% N+R</th></tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px">Sin datos.</td></tr>`}</tbody>
          <tfoot style="font-weight:700;background:#f9f9f9">
            <tr><td colspan="2">Total KAM</td><td class="tn">100%</td><td class="tn">100%</td><td class="tn">100%</td></tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

// ── SECCION 4: Distribución de metas (editable) ───────────────────────────────
function _calcSec4_distribucion(agg, totals) {
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
  const _pct = (val, tot) => tot > 0 ? ((val / tot) * 100).toFixed(1) + "%" : "—";

  let sumAD = 0, sumSH = 0, sumNR = 0;
  const rowsHtml = items.map(e => {
    const nr = e.np + e.ns + e.re;
    const adBase = (+g.ad || 0) * _calcShare(e.ad, totals.ad);
    const shBase = (+g.sh || 0) * _calcShare(e.sh, totals.sh);
    const nrBase = (+g.nr || 0) * _calcShare(nr,  totals.nr);
    sumAD += _calcGoalFor(e.partner, e.city, "ad", adBase);
    sumSH += _calcGoalFor(e.partner, e.city, "sh", shBase);
    sumNR += _calcGoalFor(e.partner, e.city, "nr", nrBase);
    return `
      <tr>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        <td class="tn" style="color:#888">${_pct(e.ad, totals.ad)}</td>
        <td>${_input(e.partner, e.city, "ad", adBase)}</td>
        <td class="tn" style="color:#888">${_pct(e.sh, totals.sh)}</td>
        <td>${_input(e.partner, e.city, "sh", shBase)}</td>
        <td class="tn" style="color:#888">${_pct(nr, totals.nr)}</td>
        <td>${_input(e.partner, e.city, "nr", nrBase)}</td>
      </tr>`;
  }).join("");

  const noGoals = !(+g.ad || +g.sh || +g.nr);
  const hint = noGoals
    ? `<div style="font-size:.78rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin-bottom:8px">⚠️ Ingresa tus metas KAM en la sección 1 y presiona <strong>"Distribuir metas"</strong> para repartirlas aquí.</div>`
    : "";

  return `
    ${_secH("⚙️", "#8b5cf6", "4. Distribución de metas (editable)", "Meta KAM × % de representación · cada celda es editable")}
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
              <td colspan="2">Suma distribuida</td>
              <td></td><td class="tn">${fmt(sumAD)}</td>
              <td></td><td class="tn">${fmt(sumSH)}</td>
              <td></td><td class="tn">${fmt(sumNR)}</td>
            </tr>
            <tr>
              <td colspan="2" style="color:#666;font-weight:600">Meta KAM · cuadre</td>
              <td></td><td class="tn">${_calcCuadre(sumAD, +g.ad || 0)}</td>
              <td></td><td class="tn">${_calcCuadre(sumSH, +g.sh || 0)}</td>
              <td></td><td class="tn">${_calcCuadre(sumNR, +g.nr || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
        <button id="calcApplyBtn" style="padding:7px 14px;font-size:.78rem;background:#10b981;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcApplyChanges()">✓ Aplicar cambios</button>
        <button style="padding:7px 14px;font-size:.78rem;background:#666;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcResetEdits()">↺ Reset ediciones</button>
        <button style="padding:7px 14px;font-size:.78rem;background:#FF0000;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer" onclick="calcExportExcel()">📥 Descargar metas (CSV)</button>
      </div>
      <div style="font-size:.7rem;color:#888;margin-top:6px;font-style:italic">
        💡 Edita los valores libremente; al salir de cada celda se guardan. Presiona <strong>"Aplicar cambios"</strong> para refrescar el cuadre y la vista compartible.
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

// ── SECCION 5: Vista compartible / descarga por partner ───────────────────────
function _calcSec5_exportPartner(agg, totals) {
  const g = CALC_STATE.kamGoals;
  const partners = [...new Set([...agg.values()].map(e => e.partner))].sort();
  if (!partners.length) {
    return `
      ${_secH("📤", "#10b981", "5. Vista compartible por partner", "Sin partners en este filtro")}
      <div class="section"><div style="font-size:.78rem;color:#aaa;padding:8px 0">No hay partners en el KAM seleccionado con datos en los últimos 3 meses.</div></div>`;
  }
  const sel = (CALC_STATE.selPartnerExport && partners.includes(CALC_STATE.selPartnerExport))
    ? CALC_STATE.selPartnerExport
    : partners[0];
  CALC_STATE.selPartnerExport = sel;

  const partnerItems = [...agg.values()].filter(e => e.partner === sel);
  const cityRows = partnerItems.map(e => {
    const nr = e.np + e.ns + e.re;
    const adGoal = _calcGoalFor(e.partner, e.city, "ad", (+g.ad || 0) * _calcShare(e.ad, totals.ad));
    const shGoal = _calcGoalFor(e.partner, e.city, "sh", (+g.sh || 0) * _calcShare(e.sh, totals.sh));
    const nrGoal = _calcGoalFor(e.partner, e.city, "nr", (+g.nr || 0) * _calcShare(nr,  totals.nr));
    return `
      <tr>
        <td style="font-weight:600">${escapeHTML(e.city)}</td>
        <td class="tn">${fmt(adGoal)}</td>
        <td class="tn">${fmt(shGoal)}</td>
        <td class="tn">${fmt(nrGoal)}</td>
      </tr>`;
  }).join("");

  return `
    ${_secH("📤", "#10b981", "5. Vista compartible por partner", "Tarjeta compartible (sin mezclar otros partners)")}
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
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:#f9f9f9">
              <th style="text-align:left;padding:8px 12px;font-size:.74rem">Ciudad</th>
              <th style="text-align:right;padding:8px 12px;font-size:.74rem">Active Drivers</th>
              <th style="text-align:right;padding:8px 12px;font-size:.74rem">Supply Hours</th>
              <th style="text-align:right;padding:8px 12px;font-size:.74rem">N+R</th>
            </tr>
          </thead>
          <tbody>${cityRows}</tbody>
        </table>
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
  const last3 = _calcLastNMonths(rows, 3);
  const last3Set = new Set(last3);
  const filteredRows = CALC_STATE.kam === "all"
    ? rows
    : rows.filter(r => (r.kam || getKAMForPartner(r.partner)) === CALC_STATE.kam);
  const agg = _calcAggByPartnerCity(filteredRows, last3Set);
  const totals = _calcKamTotals(agg);
  const g = CALC_STATE.kamGoals;

  const lines = ["CLID,PARTNER,CIUDAD,MES,ACTIVE_DRIVERS,SUPPLY_HOURS,N+R"];
  const nextMonth = _calcNextMonth(last3[last3.length - 1]);

  [...agg.values()].forEach(e => {
    const nr = e.np + e.ns + e.re;
    const adGoal = _calcGoalFor(e.partner, e.city, "ad", (+g.ad || 0) * _calcShare(e.ad, totals.ad));
    const shGoal = _calcGoalFor(e.partner, e.city, "sh", (+g.sh || 0) * _calcShare(e.sh, totals.sh));
    const nrGoal = _calcGoalFor(e.partner, e.city, "nr", (+g.nr || 0) * _calcShare(nr,  totals.nr));
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
  const all = [...new Set([...(_calcCurrentAgg() || []).values()].map(e => e.partner))].sort();
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
