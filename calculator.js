// calculator.js — Calculadora de Metas
// Ayuda al KAM a setear metas mensuales por partner+ciudad.
// 5 secciones:
//  1) Promedio 3 últimos meses por partner+ciudad
//  2) % representación vs total de la ciudad (heatmap)
//  3) Generador de metas (multiplicador editable manualmente)
//  4) Validación: meta KAM vs suma de metas-partners (con pesos Yango)
//  5) Vista exportable por partner

const CALC_STATE = {
  kam:        "all",
  multiplier: 1.10,
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
  // Si estamos en otra escala, intentar usar rawDataMensual si esta cargada
  if (STATE.rawDataMensual && STATE.rawDataMensual.length) {
    return STATE.rawDataMensual;
  }
  // Fallback: usar rawData actual (modo activo)
  return STATE.rawData || [];
}

// Devuelve los N últimos meses (claves YYYY-MM) presentes en el dataset
function _calcLastNMonths(rows, n) {
  const months = [...new Set(rows.map(r => r.date))].sort();
  return months.slice(-n);
}

// Agrega por partner+city sobre un set de meses específicos
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
    // Si el primer row no traia CLID y un row posterior si, capturarlo
    if (!e.clid && r.clid) e.clid = r.clid;
    e.trips += r.trips || 0;
    e.sh    += r.supplyHours || 0;
    // AD: max across months (snapshot)
    if ((r.activeDrivers || 0) > e.ad) e.ad = r.activeDrivers || 0;
    e.np    += r.newPartner || 0;
    e.ns    += r.newService || 0;
    e.re    += r.reactivated || 0;
  });
  return out;
}

// Fallback: busca el CLID de un partner+city en STATE.rawData si la fila
// agregada no lo tiene (caso: el row vino de un dataset que no incluye clid).
function _calcLookupClid(partner, city) {
  const datasets = [STATE.rawDataMensual, STATE.rawData, STATE.rawDataDiario];
  for (const ds of datasets) {
    if (!ds || !ds.length) continue;
    const row = ds.find(r => r.partner === partner && r.city === city && r.clid);
    if (row) return row.clid;
  }
  // Ultimo fallback: scan inverso de CLID_MAP por partner (toma el primero)
  for (const [clid, p] of Object.entries(STATE.CLID_MAP || {})) {
    if (p === partner) return clid;
  }
  return "";
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
function renderCalculator() {
  // Guard: si por algun motivo (timer reentrante, RAF tardio) se invoca cuando
  // ya no estamos en Calculadora, abortar. Evita reflow pesado en DOM oculto.
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

  // Validar formato YYYY-MM en las dates. Si no, no es data mensual valida.
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

  const allKAMs = [...new Set(Object.values(STATE.KAM_MAP).map(k => (k||"").trim()).filter(Boolean))].sort();

  // Filtrar por KAM (si CALC_STATE.kam !== "all")
  const filteredRows = CALC_STATE.kam === "all"
    ? rows
    : rows.filter(r => {
        const k = r.kam || getKAMForPartner(r.partner);
        return k === CALC_STATE.kam;
      });

  // Bug #6+7: cachear meses y aggregaciones (1 sola pasada por dataset)
  const allMonths = [...new Set(rows.map(r => r.date))].sort();
  const last3 = allMonths.slice(-3);
  const last1 = allMonths.slice(-1);
  const last3Set = new Set(last3);
  const last1Set = new Set(last1);

  // Aggregaciones cacheadas para esta render
  const aggLast3 = _calcAggByPartnerCity(filteredRows, last3Set);
  const aggLast1 = _calcAggByPartnerCity(filteredRows, last1Set);
  const aggAllLast3 = _calcAggByPartnerCity(rows, last3Set);  // sin filtro KAM para totales de ciudad

  let html = `
    <div style="padding:0 8px 16px">
      <!-- Controles -->
      <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:8px 0 16px">
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">KAM</label>
          <select id="calcKamSel" class="sb-sel" style="width:180px" onchange="calcOnKamChange(this.value)">
            <option value="all" ${CALC_STATE.kam==="all"?"selected":""}>Todos los KAMs</option>
            ${allKAMs.map(k => `<option value="${escapeHTML(k)}" ${CALC_STATE.kam===k?"selected":""}>${escapeHTML(k)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">Multiplicador global</label>
          <input id="calcMultiplier" type="number" step="0.05" min="0.5" max="3" value="${CALC_STATE.multiplier}"
            class="sb-inp" style="width:110px" onchange="calcOnMultiplierChange(this.value)"/>
        </div>
        <div style="font-size:.72rem;color:#666;background:#fef3c7;padding:6px 10px;border-radius:6px;border:1px solid #fcd34d">
          📅 Promedios: ${last3.map(d2s).join(" · ")}
        </div>
      </div>

      ${_calcSec1_promedio3m(aggLast3, last3)}
      ${_calcSec2_pctCiudad(aggAllLast3, last3)}
      ${_calcSec3_generador(aggLast1, last1)}
      ${_calcSec4_validacionKAM(aggLast1, last1)}
      ${_calcSec5_exportPartner(aggLast1, last1)}
    </div>`;

  el.innerHTML = html;
}

// ── SECCION 1: Promedio 3 últimos meses ───────────────────────────────────────
function _calcSec1_promedio3m(agg, months) {
  const n = months.length || 1;

  // Sort partners by partner+city
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city)
  );

  // Totales del KAM (suma)
  const tot = { trips: 0, sh: 0, ad: 0, np: 0, ns: 0, re: 0 };
  items.forEach(e => {
    tot.trips += e.trips / n;
    tot.sh    += e.sh / n;
    tot.ad    += e.ad;       // AD ya es max, no se promedia
    tot.np    += e.np / n;
    tot.ns    += e.ns / n;
    tot.re    += e.re / n;
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
    ${_secH("📊", "#06b6d4", "1. Promedio 3 últimos meses", `${items.length} partner-ciudad · KAM: ${CALC_STATE.kam === "all" ? "Todos" : CALC_STATE.kam}`)}
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

// ── SECCION 2: % Representación vs Ciudad (heatmap) ───────────────────────────
function _calcSec2_pctCiudad(aggAll, months) {

  // Total por ciudad por métrica
  const cityTotals = {};
  for (const e of aggAll.values()) {
    if (!cityTotals[e.city]) cityTotals[e.city] = { trips: 0, sh: 0, ad: 0, np: 0, ns: 0, re: 0 };
    const t = cityTotals[e.city];
    t.trips += e.trips; t.sh += e.sh; t.ad += e.ad;
    t.np += e.np; t.ns += e.ns; t.re += e.re;
  }

  // Filtrar items por KAM (solo para mostrar la fila del KAM seleccionado)
  const items = [...aggAll.values()].filter(e => {
    if (CALC_STATE.kam === "all") return true;
    const k = e.kam || getKAMForPartner(e.partner);
    return k === CALC_STATE.kam;
  }).sort((a, b) => a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  // Color heatmap: 0% rojo → 20% naranja → 50% verde fuerte
  function _heatColor(pct) {
    if (pct >= 20) return "#10b981";
    if (pct >= 10) return "#22c55e";
    if (pct >= 5)  return "#f59e0b";
    if (pct >= 1)  return "#fb923c";
    return "#FF0000";
  }
  function _heatBg(pct) {
    if (pct >= 20) return "#bbf7d0";
    if (pct >= 10) return "#d9f99d";
    if (pct >= 5)  return "#fef3c7";
    if (pct >= 1)  return "#fed7aa";
    return "#fecaca";
  }
  function _cell(val, total) {
    if (!total) return `<td class="tn" style="color:#ccc">—</td>`;
    const pct = (val / total) * 100;
    return `<td class="tn" style="background:${_heatBg(pct)};color:${_heatColor(pct)};font-weight:700">${pct.toFixed(2)}%</td>`;
  }

  const rowsHtml = items.map(e => {
    const ct = cityTotals[e.city] || {};
    return `
      <tr>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        ${_cell(e.trips, ct.trips)}
        ${_cell(e.sh,    ct.sh)}
        ${_cell(e.ad,    ct.ad)}
        ${_cell(e.np,    ct.np)}
        ${_cell(e.ns,    ct.ns)}
        ${_cell(e.re,    ct.re)}
      </tr>`;
  }).join("");

  return `
    ${_secH("🔥", "#f59e0b", "2. % Representación vs Ciudad", "Tu peso en cada ciudad (heatmap rojo→verde)")}
    <div class="section">
      <div class="tbl-wrap" style="max-height:400px;overflow-y:auto">
        <table class="dtbl">
          <thead>
            <tr>
              <th>Partner</th><th>Ciudad</th>
              <th class="tn">Trips</th><th class="tn">SH</th>
              <th class="tn">AD</th><th class="tn">New Partner</th>
              <th class="tn">New Yango</th><th class="tn">Reactivados</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="8" style="text-align:center;color:#aaa;padding:20px">Sin datos.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

// ── SECCION 3: Generador de Metas ─────────────────────────────────────────────
function _calcSec3_generador(agg, months) {
  const m = CALC_STATE.multiplier || 1.1;

  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city)
  );

  // Helper: obtener valor editado o calcular default (base * multiplicador)
  function _calcGoal(partner, city, metric, base) {
    const k = `${partner}|||${city}|||${metric}`;
    if (CALC_STATE.edits[k] !== undefined) return CALC_STATE.edits[k];
    return Math.round(base * m);
  }
  function _input(partner, city, metric, base) {
    const k = `${partner}|||${city}|||${metric}`;
    const val = _calcGoal(partner, city, metric, base);
    return `<input type="number" step="1" min="0" class="calc-inp" value="${val}"
      data-pk="${escapeHTML(partner)}" data-city="${escapeHTML(city)}" data-metric="${metric}"
      onchange="calcOnGoalEdit(this)"
      style="width:90px;padding:3px 5px;border:1px solid #ddd;border-radius:4px;font-size:.74rem;text-align:right"/>`;
  }

  const rowsHtml = items.map(e => {
    const nr = e.np + e.ns + e.re;
    return `
      <tr>
        <td style="font-size:.75rem;font-weight:600">${escapeHTML(e.partner)}</td>
        <td style="font-size:.72rem;color:#666">${escapeHTML(e.city)}</td>
        <td class="tn" style="color:#888">${fmt(e.ad)}</td>
        <td>${_input(e.partner, e.city, "ad", e.ad)}</td>
        <td class="tn" style="color:#888">${fmt(e.sh)}</td>
        <td>${_input(e.partner, e.city, "sh", e.sh)}</td>
        <td class="tn" style="color:#888">${fmt(nr)}</td>
        <td>${_input(e.partner, e.city, "nr", nr)}</td>
      </tr>`;
  }).join("");

  return `
    ${_secH("⚙️", "#8b5cf6", "3. Generador de Metas", `Base: último mes · Multiplicador: ${m}× (+${((m-1)*100).toFixed(0)}%). Cada celda es editable.`)}
    <div class="section">
      <div class="tbl-wrap" style="max-height:500px;overflow-y:auto">
        <table class="dtbl">
          <thead>
            <tr>
              <th>Partner</th><th>Ciudad</th>
              <th class="tn">AD base</th><th class="tn">AD meta</th>
              <th class="tn">SH base</th><th class="tn">SH meta</th>
              <th class="tn">N+R base</th><th class="tn">N+R meta</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="8" style="text-align:center;color:#aaa;padding:20px">Sin datos.</td></tr>`}</tbody>
        </table>
      </div>
      <div style="display:flex;gap:10px;margin-top:10px">
        <button class="apply-btn" style="width:auto;padding:7px 14px;font-size:.78rem;background:#666" onclick="calcResetEdits()">↺ Reset ediciones</button>
        <button class="apply-btn" style="width:auto;padding:7px 14px;font-size:.78rem" onclick="calcExportExcel()">📥 Exportar Excel para subir</button>
      </div>
    </div>`;
}

// ── SECCION 4: Validación contra meta KAM ─────────────────────────────────────
function _calcSec4_validacionKAM(agg, months) {
  if (CALC_STATE.kam === "all") {
    return `
      ${_secH("🎯", "#FF0000", "4. Validación contra meta KAM", "Selecciona un KAM arriba para validar contra sus metas")}
      <div class="section"><div style="font-size:.78rem;color:#aaa;padding:8px 0">⚠️ Filtra por un KAM específico arriba para usar esta sección.</div></div>`;
  }
  const m = CALC_STATE.multiplier || 1.1;

  // Suma de las metas propuestas (usa edits o base * m)
  let sumAD = 0, sumSH = 0, sumNR = 0;
  for (const e of agg.values()) {
    const nrBase = e.np + e.ns + e.re;
    const adGoal = CALC_STATE.edits[`${e.partner}|||${e.city}|||ad`] ?? Math.round(e.ad * m);
    const shGoal = CALC_STATE.edits[`${e.partner}|||${e.city}|||sh`] ?? Math.round(e.sh * m);
    const nrGoal = CALC_STATE.edits[`${e.partner}|||${e.city}|||nr`] ?? Math.round(nrBase * m);
    sumAD += (+adGoal || 0);
    sumSH += (+shGoal || 0);
    sumNR += (+nrGoal || 0);
  }

  const g = CALC_STATE.kamGoals;
  function _row(label, weight, sumPartners, target) {
    const cubre = target > 0 ? (sumPartners / target) * 100 : 0;
    const status = target === 0 ? { c: "#aaa", e: "—", t: "Sin meta" }
                 : cubre >= 100  ? { c: "#10b981", e: "✅", t: "Cubre" }
                 : cubre >= 95   ? { c: "#f59e0b", e: "⚠️", t: "Ajustado" }
                 : { c: "#FF0000", e: "🔴", t: "Insuficiente" };
    const gap = target - sumPartners;
    return `
      <tr>
        <td style="font-weight:600">${escapeHTML(label)}</td>
        <td class="tn">${weight}%</td>
        <td class="tn">${fmt(target)}</td>
        <td class="tn">${fmt(sumPartners)}</td>
        <td class="tn"><strong style="color:${status.c}">${cubre.toFixed(1)}%</strong></td>
        <td class="tn" style="color:${status.c};font-weight:700">${gap >= 0 ? "+" : ""}${fmt(gap)}</td>
        <td><span style="color:${status.c};font-weight:700">${status.e} ${status.t}</span></td>
      </tr>`;
  }

  return `
    ${_secH("🎯", "#FF0000", "4. Validación contra meta KAM", `KAM: ${escapeHTML(CALC_STATE.kam)} · pesos formato Yango`)}
    <div class="section">
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;margin-bottom:12px">
        <div style="font-size:.78rem;font-weight:700;color:#92400e;margin-bottom:8px">📥 Ingresa tus metas KAM (las que te dio tu jefe):</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
          ${_kamGoalInput("ad",        "Active Drivers",     KAM_WEIGHTS.ad,        g.ad)}
          ${_kamGoalInput("sh",        "Supply Hours",       KAM_WEIGHTS.sh,        g.sh)}
          ${_kamGoalInput("nr",        "New + Reactivated",  KAM_WEIGHTS.nr,        g.nr)}
          ${_kamGoalInput("otherProj", "Other Projects (%)", KAM_WEIGHTS.otherProj, g.otherProj)}
          ${_kamGoalInput("fleetA2",   "Fleet drivers A2 (%)", KAM_WEIGHTS.fleetA2, g.fleetA2)}
        </div>
      </div>

      <div class="tbl-wrap">
        <table class="dtbl">
          <thead>
            <tr>
              <th>KPI</th><th class="tn">Peso</th><th class="tn">Meta KAM</th>
              <th class="tn">Suma partners</th><th class="tn">% cubierto</th>
              <th class="tn">Gap</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${_row("Active Drivers",    KAM_WEIGHTS.ad, sumAD, +g.ad || 0)}
            ${_row("Supply Hours",      KAM_WEIGHTS.sh, sumSH, +g.sh || 0)}
            ${_row("New + Reactivated", KAM_WEIGHTS.nr, sumNR, +g.nr || 0)}
            <tr style="color:#aaa">
              <td>Other Projects</td><td class="tn">${KAM_WEIGHTS.otherProj}%</td>
              <td class="tn">${g.otherProj}%</td>
              <td colspan="3" style="text-align:center;font-style:italic">No se calcula automáticamente</td>
              <td>—</td>
            </tr>
            <tr style="color:#aaa">
              <td>Fleet drivers A2</td><td class="tn">${KAM_WEIGHTS.fleetA2}%</td>
              <td class="tn">${g.fleetA2}%</td>
              <td colspan="3" style="text-align:center;font-style:italic">No se calcula automáticamente</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function _kamGoalInput(metric, label, weight, val) {
  return `
    <div>
      <label style="font-size:.66rem;color:#666;font-weight:700;display:block;margin-bottom:3px">${escapeHTML(label)} <span style="color:#aaa">(${weight}%)</span></label>
      <input type="number" step="1" min="0" value="${+val || 0}"
        oninput="calcOnKamGoalChange('${metric}', this.value)"
        class="sb-inp" style="width:100%;padding:5px 8px;font-size:.78rem"/>
    </div>`;
}

// ── SECCION 5: Vista exportable por partner ──────────────────────────────────
function _calcSec5_exportPartner(agg, months) {
  const partners = [...new Set([...agg.values()].map(e => e.partner))].sort();
  if (!partners.length) {
    return `
      ${_secH("📤", "#10b981", "5. Vista exportable por partner", "Sin partners en este filtro")}
      <div class="section"><div style="font-size:.78rem;color:#aaa;padding:8px 0">No hay partners en el KAM seleccionado con datos en el último mes.</div></div>`;
  }
  // Bug #5: validar que selPartnerExport esté en partners filtrados.
  // Si el partner antiguo no existe en el nuevo KAM, fallback al primero.
  const sel = (CALC_STATE.selPartnerExport && partners.includes(CALC_STATE.selPartnerExport))
    ? CALC_STATE.selPartnerExport
    : partners[0];
  CALC_STATE.selPartnerExport = sel;

  const partnerItems = [...agg.values()].filter(e => e.partner === sel);
  const m = CALC_STATE.multiplier || 1.1;

  const cityRows = partnerItems.map(e => {
    const nrBase = e.np + e.ns + e.re;
    const adGoal = CALC_STATE.edits[`${e.partner}|||${e.city}|||ad`] ?? Math.round(e.ad * m);
    const shGoal = CALC_STATE.edits[`${e.partner}|||${e.city}|||sh`] ?? Math.round(e.sh * m);
    const nrGoal = CALC_STATE.edits[`${e.partner}|||${e.city}|||nr`] ?? Math.round(nrBase * m);
    return `
      <tr>
        <td style="font-weight:600">${escapeHTML(e.city)}</td>
        <td class="tn">${fmt(adGoal)}</td>
        <td class="tn">${fmt(shGoal)}</td>
        <td class="tn">${fmt(nrGoal)}</td>
      </tr>`;
  }).join("");

  return `
    ${_secH("📤", "#10b981", "5. Vista exportable por partner", "Tarjeta compartible (sin mezclar otros partners)")}
    <div class="section">
      <div style="display:flex;gap:10px;align-items:end;margin-bottom:10px">
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px">Partner</label>
          <select id="calcExportPartner" class="sb-sel" style="width:220px" onchange="calcOnExportPartnerChange(this.value)">
            ${partners.map(p => `<option value="${escapeHTML(p)}" ${p===sel?"selected":""}>${escapeHTML(p)}</option>`).join("")}
          </select>
        </div>
        <button class="apply-btn" style="width:auto;padding:7px 14px;font-size:.78rem" onclick="calcDownloadPartnerImage()">📥 Descargar Imagen/PDF</button>
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
  // Reset selected partner for export
  CALC_STATE.selPartnerExport = null;
  renderCalculator();
}

function calcOnMultiplierChange(v) {
  const n = parseFloat(v);
  if (!isNaN(n) && n > 0) CALC_STATE.multiplier = n;
  renderCalculator();
}

function _calcScheduleRerender() {
  // Guard temprano: si ya no estamos en Calculadora, no encolar.
  if (STATE.curTab !== "calculator") return;
  clearTimeout(CALC_STATE._editDeb);
  // Capturamos el token global. Si el usuario cambia de tab antes del disparo,
  // el token cambiara y el render se aborta.
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
  // Render diferido (sólo si seguimos en Calculadora)
  _calcScheduleRerender();
}

function calcOnKamGoalChange(metric, val) {
  CALC_STATE.kamGoals[metric] = parseFloat(val) || 0;
  _calcScheduleRerender();
}

function calcOnExportPartnerChange(v) {
  CALC_STATE.selPartnerExport = v;
  renderCalculator();
}

function calcResetEdits() {
  if (!Object.keys(CALC_STATE.edits).length) return;
  if (!confirm("¿Borrar todas las ediciones manuales y volver al multiplicador global?")) return;
  CALC_STATE.edits = {};
  renderCalculator();
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
function calcExportExcel() {
  // Genera CSV con formato listo para subir como rendimiento_mensual (placeholder)
  // o como metas. Por ahora exporta como CSV de metas en formato simple.
  const rows = _calcGetMensualData();
  const last1 = _calcLastNMonths(rows, 1);
  const monthsSet = new Set(last1);
  const agg = _calcAggByPartnerCity(rows, monthsSet);
  const m = CALC_STATE.multiplier || 1.1;

  const lines = ["CLID,PARTNER,CIUDAD,MES,ACTIVE_DRIVERS,SUPPLY_HOURS,N+R"];
  const nextMonth = _calcNextMonth(last1[0]);

  [...agg.values()].forEach(e => {
    if (CALC_STATE.kam !== "all") {
      const k = e.kam || getKAMForPartner(e.partner);
      if (k !== CALC_STATE.kam) return;
    }
    const nrBase = e.np + e.ns + e.re;
    const adGoal = CALC_STATE.edits[`${e.partner}|||${e.city}|||ad`] ?? Math.round(e.ad * m);
    const shGoal = CALC_STATE.edits[`${e.partner}|||${e.city}|||sh`] ?? Math.round(e.sh * m);
    const nrGoal = CALC_STATE.edits[`${e.partner}|||${e.city}|||nr`] ?? Math.round(nrBase * m);
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
  showBanner(true, "Excel exportado · súbelo en Configuración → Metas");
}

function _calcNextMonth(monthStr) {
  // monthStr formato YYYY-MM. Retorna el mes siguiente.
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
