// metas.js — Pestaña Metas

// Ordena meses por valor temporal. Acepta nombres ("MAYO","Mayo","may"),
// numeros ("5","05"), o fechas ("2026-05","2026-05-11").
const _METAS_MES_ORDER = {
  enero:1, ene:1, jan:1, january:1,
  febrero:2, feb:2, february:2,
  marzo:3, mar:3, march:3,
  abril:4, abr:4, apr:4, april:4,
  mayo:5, may:5,
  junio:6, jun:6, june:6,
  julio:7, jul:7, july:7,
  agosto:8, ago:8, aug:8, august:8,
  septiembre:9, setiembre:9, sep:9, sept:9, september:9,
  octubre:10, oct:10, october:10,
  noviembre:11, nov:11, november:11,
  diciembre:12, dic:12, dec:12, december:12
};
function _metasMesOrden(mes) {
  if (!mes) return 0;
  const m = String(mes).trim().toLowerCase();
  // Formato "YYYY-MM" o "YYYY-MM-DD"
  const ymMatch = m.match(/^(\d{4})-(\d{1,2})/);
  if (ymMatch) return parseInt(ymMatch[1]) * 100 + parseInt(ymMatch[2]);
  // Nombre de mes
  if (_METAS_MES_ORDER[m]) return 2000 + _METAS_MES_ORDER[m]; // sin año, asumir actual
  // Numero simple "5" o "05"
  const n = parseInt(m);
  if (!isNaN(n) && n >= 1 && n <= 12) return 2000 + n;
  return 0;
}

// Handler del selector de mes. Cambia el mes activo y re-renderiza.
// Valida contra los meses realmente disponibles en STATE.metasData.
function setMetasMes(mes) {
  const disp = [...new Set(STATE.metasData.map(m => (m.mes || "").trim()))]
    .filter(Boolean);
  if (!disp.includes(mes)) {
    console.warn("setMetasMes: mes no disponible", mes, "disp:", disp);
    return;
  }
  STATE.metasMesSel = mes;
  if (STATE.curTab === "metas") renderMetas();
}

// Guard de reentrancia: doble-click o filtros solapados no deben lanzar dos
// renders concurrentes (mismo patron que rendimiento.js).
let _renderMetasBusy = false;
function renderMetas() {
  if (_renderMetasBusy) return;
  if (!STATE.metasData.length) return;
  _renderMetasBusy = true;
  try {
    _renderMetasImpl();
  } finally {
    _renderMetasBusy = false;
  }
}

function _renderMetasImpl() {
  // Garantiza índices secundarios construidos antes de cualquier lookup
  ensureIndexes();

  const cityFilter = document.getElementById("cityFilter").value;
  const kamFilter  = document.getElementById("kamFilter").value;
  const sel        = getSel();
  const from       = document.getElementById("dateFrom").value;
  const to         = document.getElementById("dateTo").value;
  const selSet     = new Set(sel);

  // Detectar el mes MAS RECIENTE de metasData y limitar el render a ese mes.
  // Antes: mostraba metasData[0].mes (primer registro = mes mas antiguo) y
  // sumaba metas de TODOS los meses, inflando %% de cumplimiento.
  const mesesDisponibles = [...new Set(STATE.metasData.map(m => m.mes))]
    .filter(Boolean)
    .sort((a, b) => _metasMesOrden(b) - _metasMesOrden(a));
  // Permitir override manual via STATE.metasMesSel (selector futuro)
  const mesName = STATE.metasMesSel && mesesDisponibles.includes(STATE.metasMesSel)
    ? STATE.metasMesSel
    : (mesesDisponibles[0] || "");

  const metas = STATE.metasData.filter(m => {
    if (m.mes !== mesName)                        return false;
    if (kamFilter !== "all" && m.kam !== kamFilter) return false;
    if (sel.length && !selSet.has(m.partner))     return false;
    return true;
  });

  // Build performance data by partner+city+date (full precision)
  const perfF  = getFilteredByDateRange(from, to);
  const cpMap  = {};
  // Diagnostico: trackear breakdown de los 3 componentes de N+R
  let _diagNP = 0, _diagNS = 0, _diagRE = 0;
  perfF.forEach(r => {
    const k = `${r.partner}|||${r.city}|||${r.date}`;
    if (!cpMap[k]) cpMap[k] = { partner: r.partner, city: r.city, date: r.date, ad: 0, nr: 0, sh: 0 };
    cpMap[k].ad += r.activeDrivers;
    cpMap[k].nr += r.newPartner + r.newService + r.reactivated;
    cpMap[k].sh += r.supplyHours;
    _diagNP += r.newPartner   || 0;
    _diagNS += r.newService   || 0;
    _diagRE += r.reactivated  || 0;
  });
  const cpRows = Object.values(cpMap);

  // Diagnostico de N+R: imprime breakdown y advierte si solo hay reactivados
  // (sintoma de que el upload no capturo new_from_partner / new_from_service)
  if (perfF.length) {
    console.log(`[METAS ${STATE.curMode}] Breakdown N+R en rango ${from} → ${to}:`,
      { newPartner: _diagNP, newService: _diagNS, reactivated: _diagRE,
        total: _diagNP + _diagNS + _diagRE });
    if ((_diagNP + _diagNS) === 0 && _diagRE > 0) {
      console.warn(
        "[METAS] new_from_partner y new_from_service son 0 en la BD. " +
        "El upload del Excel no capturo esas columnas. " +
        "Verifica los nombres de columna en el Excel (deben contener 'from partner', " +
        "'from service' o 'new drivers')."
      );
    }
  }

  // New projection: based on last data date + 6 days = end of current week
  const maxDate = cpRows.length ? cpRows.map(r => r.date).sort().at(-1) : to;
  const { daysElapsed, daysRemaining } = calcProjectionDays(maxDate);

  // Pre-indexar cpRows por partner y por partner+city UNA vez.
  // Antes getRPC hacia cpRows.filter() ~550 veces (O(n) por call).
  // Ahora es O(1) lookup. Reduce ~150-300ms en datasets grandes.
  const cpByPartnerAll  = new Map(); // partner → rows[]   (todas las ciudades)
  const cpByPartnerCity = new Map(); // "partner|||city" → rows[]
  cpRows.forEach(r => {
    let a = cpByPartnerAll.get(r.partner);
    if (!a) { a = []; cpByPartnerAll.set(r.partner, a); }
    a.push(r);
    const k = `${r.partner}|||${r.city}`;
    let b = cpByPartnerCity.get(k);
    if (!b) { b = []; cpByPartnerCity.set(k, b); }
    b.push(r);
  });

  function getRPC(partner, city) {
    const rows = (city === "" || city === "all")
      ? (cpByPartnerAll.get(partner) || [])
      : (cpByPartnerCity.get(`${partner}|||${city}`) || []);
    if (!rows.length) return { ad: 0, nr: 0, sh: 0, lastAD: 0, nrV: [], shV: [] };
    // Agregar por fecha (sumando ciudades cuando city = "all")
    const bd = {};
    rows.forEach(r => {
      if (!bd[r.date]) bd[r.date] = { ad: 0, nr: 0, sh: 0 };
      bd[r.date].ad += r.ad; bd[r.date].nr += r.nr; bd[r.date].sh += r.sh;
    });
    const sortedDates = Object.keys(bd).sort();
    const sorted = sortedDates.map(d => bd[d]);
    // Calcular max/sum en una sola pasada en lugar de 3 pasadas
    let adMax = 0, nrSum = 0, shSum = 0;
    const nrV = [], shV = [];
    for (const v of sorted) {
      if (v.ad > adMax) adMax = v.ad;
      nrSum += v.nr;
      shSum += v.sh;
      nrV.push(v.nr);
      shV.push(v.sh);
    }
    return {
      ad:     adMax,
      nr:     nrSum,
      sh:     shSum,
      lastAD: sorted[sorted.length - 1]?.ad || 0,
      nrV,
      shV
    };
  }

  // Build combos (partner+city)
  let combos = [];
  if (cityFilter === "all") {
    const pm = {};
    metas.forEach(m => {
      if (!pm[m.partner]) pm[m.partner] = { partner: m.partner, kam: m.kam, mA: 0, mNR: 0, mH: 0 };
      pm[m.partner].mA  += m.mA;
      pm[m.partner].mNR += m.mNR;
      pm[m.partner].mH  += m.mH;
    });
    Object.values(pm).forEach(p => {
      const r = getRPC(p.partner, "all");
      combos.push({ partner: p.partner, kam: p.kam, city: "Todas",
        mA: p.mA, mNR: p.mNR, mH: p.mH,
        ad: r.ad, nr: r.nr, sh: r.sh,
        projAD: (STATE.curMode === "mensual" || daysRemaining === 0) ? r.lastAD : r.lastAD * 1.4,
        projNR: projA(r.nrV, daysElapsed, daysRemaining),
        projSH: projA(r.shV, daysElapsed, daysRemaining) });
    });
  } else {
    metas.filter(m => m.city === cityFilter).forEach(m => {
      const r = getRPC(m.partner, m.city);
      combos.push({ partner: m.partner, kam: m.kam, city: m.city,
        mA: m.mA, mNR: m.mNR, mH: m.mH,
        ad: r.ad, nr: r.nr, sh: r.sh,
        projAD: (STATE.curMode === "mensual" || daysRemaining === 0) ? r.lastAD : r.lastAD * 1.4,
        projNR: projA(r.nrV, daysElapsed, daysRemaining),
        projSH: projA(r.shV, daysElapsed, daysRemaining) });
    });
  }

  // Agregar partners CON performance pero SIN meta. Su FACT y proyección
  // suman al KAM/Ciudad/Peru aunque no tengan plan asignado. Plan = 0.
  const partnersWithMetaSet = new Set(combos.map(c => c.partner));
  const partnersInPerf = [...new Set(cpRows.map(r => r.partner))]
    .filter(p => selSet.has(p) && !partnersWithMetaSet.has(p));

  partnersInPerf.forEach(p => {
    const partnerKam = getKAMForPartner(p) || "Sin KAM";
    // Si el usuario filtra por KAM, excluir partners sin meta de otros KAMs
    if (kamFilter !== "all" && partnerKam !== kamFilter) return;
    const r = getRPC(p, cityFilter === "all" ? "all" : cityFilter);
    if (r.ad === 0 && r.nr === 0 && r.sh === 0) return;
    combos.push({
      partner: p,
      kam: partnerKam,
      city: cityFilter === "all" ? "Sin Plan" : cityFilter,
      mA: 0, mNR: 0, mH: 0,
      ad: r.ad, nr: r.nr, sh: r.sh,
      projAD: (STATE.curMode === "mensual" || daysRemaining === 0) ? r.lastAD : r.lastAD * 1.4,
      projNR: projA(r.nrV, daysElapsed, daysRemaining),
      projSH: projA(r.shV, daysElapsed, daysRemaining),
      noMeta: true
    });
  });

  // Totals
  const tMA = metas.reduce((s, m) => s + m.mA,  0);
  const tMNR= metas.reduce((s, m) => s + m.mNR, 0);
  const tMH = metas.reduce((s, m) => s + m.mH,  0);
  const tAD = combos.reduce((s, c) => s + c.ad,  0);
  const tNR = combos.reduce((s, c) => s + c.nr,  0);
  const tSH = combos.reduce((s, c) => s + c.sh,  0);
  const tPAD= combos.reduce((s, c) => s + c.projAD, 0);
  const tPNR= combos.reduce((s, c) => s + c.projNR, 0);
  const tPSH= combos.reduce((s, c) => s + c.projSH, 0);

  document.getElementById("metasEmpty").style.display   = "none";
  document.getElementById("metasContent").style.display = "";

  let html = modeToggleHTML();
  // Selector de mes (solo se muestra si hay 2+ meses cargados)
  const mesSelectorHTML = mesesDisponibles.length > 1
    ? `<div style="display:flex;align-items:center;gap:8px;background:#fff8f8;border:1px solid #fecaca;border-radius:8px;padding:6px 12px">
         <label style="font-size:.72rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.4px">Mes:</label>
         <select onchange="setMetasMes(this.value)" style="border:1px solid #ddd;border-radius:6px;padding:4px 10px;font-size:.82rem;font-weight:600;background:#fff;cursor:pointer">
           ${mesesDisponibles.map(m => `<option value="${m}" ${m===mesName?"selected":""}>${m}</option>`).join("")}
         </select>
       </div>`
    : "";
  // Botón de borrado (solo admin): elimina TODAS las metas del mes mostrado para
  // poder re-subir el Excel. El enforcement real es RLS (is_admin()); este gate
  // solo oculta el botón. data-html2canvas-ignore lo excluye del PDF descargable
  // (el partner no debe verlo). mesAttr va JSON-encodeado por si el mes trae comillas.
  const mesAttr    = escapeHTML(JSON.stringify(mesName));
  const delBtnHTML = STATE.isAdmin
    ? `<button class="apply-btn" data-html2canvas-ignore="true" onclick="deleteMetasMes(${mesAttr})"
         title="Borra todas las metas de ${escapeHTML(mesName)} para re-subir el Excel"
         style="width:auto;padding:7px 14px;font-size:.8rem;background:#FF0000;color:#fff;font-weight:700">
         🗑️ Eliminar metas de ${escapeHTML(mesName)}
       </button>`
    : "";
  html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:12px;flex-wrap:wrap">
    ${mesSelectorHTML}
    <div style="display:flex;gap:8px;align-items:center;margin-left:auto">
      ${delBtnHTML}
      <button class="apply-btn" id="metasPdfBtn" onclick="downloadMetasPDF()" style="width:auto;padding:7px 16px;font-size:.8rem">⬇ Descargar PDF</button>
    </div>
  </div>`;

  // ── 1. Peru Summary ───────────────────────────────────────────────────────
  // Contador de partners en perf SIN meta asignada (sus fact suma al total
  // pero no tienen plan -> %% pueden verse altos sin contexto).
  const noMetaCount = combos.filter(c => c.noMeta).length;
  const noMetaBanner = noMetaCount > 0
    ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:6px 10px;margin:0 0 8px;font-size:.72rem;color:#9a3412">
         ⚠️ <strong>${noMetaCount}</strong> partner${noMetaCount>1?"s":""} con performance pero <strong>sin meta asignada</strong> en ${escapeHTML(mesName)}.
         Su FACT suma al total pero el % de cumplimiento puede verse alto.
       </div>`
    : "";
  html += secH("🎯","#8b5cf6","Cumplimiento de Metas - "+mesName,"Progreso actual vs meta del mes","Peru");
  html += `<div class="section">${noMetaBanner}<div class="metric-row">
    ${metaResCard(METRICS.ad.label, "máx semana",     tAD, tMA,  tPAD, "#8b5cf6")}
    ${metaResCard(METRICS.nr.label, "acumulado mes",  tNR, tMNR, tPNR, "#f97316")}
    ${metaResCard(METRICS.sh.label, "acumulado mes",  tSH, tMH,  tPSH, "#06b6d4")}
  </div></div>`;

  // ── 2. Por Ciudad ─────────────────────────────────────────────────────────
  html += secH("🏙️","#06b6d4","Metas por Ciudad","Progreso y proyección","");
  html += `<div class="section"><div class="city-grid">`;
  CITIES.forEach(city => {
    // Use all metas for this city (ignore cityFilter here to always show all cities)
    const cm = STATE.metasData.filter(m => {
      if (m.mes !== mesName)                        return false;
      if (kamFilter !== "all" && m.kam !== kamFilter) return false;
      if (sel.length && !selSet.has(m.partner))     return false;
      return m.city === city;
    });
    if (!cm.length) return;

    // Build city combos: reusa perfF (ya filtrado por rango de fechas).
    // No dependemos de STATE._byCity para que funcione aunque el indice no este
    // construido (cache stale, race condition al cargar diario/mensual).
    const cityPerfRows = perfF.filter(r =>
      r.city === city && selSet.has(r.partner)
    );
    const cityPerfMap = {};
    cityPerfRows.forEach(r => {
      const k = `${r.partner}|||${r.date}`;
      if (!cityPerfMap[k]) cityPerfMap[k] = { date: r.date, ad: 0, nr: 0, sh: 0 };
      cityPerfMap[k].ad += r.activeDrivers;
      cityPerfMap[k].nr += r.newPartner + r.newService + r.reactivated;
      cityPerfMap[k].sh += r.supplyHours;
    });
    const cityPerf = Object.values(cityPerfMap);
    const cityDates = [...new Set(cityPerf.map(r => r.date))].sort();
    const byDate = {};
    cityPerf.forEach(r => {
      if (!byDate[r.date]) byDate[r.date] = { ad: 0, nr: 0, sh: 0 };
      byDate[r.date].ad += r.ad;
      byDate[r.date].nr += r.nr;
      byDate[r.date].sh += r.sh;
    });
    const sorted = cityDates.map(d => byDate[d]);
    const crAD = sorted.length ? Math.max(...sorted.map(v => v.ad)) : 0;
    const crNR = sorted.reduce((s, v) => s + v.nr, 0);
    const crSH = sorted.reduce((s, v) => s + v.sh, 0);
    const lastAD = sorted.length ? sorted[sorted.length - 1].ad : 0;
    const nrV = sorted.map(v => v.nr);
    const shV = sorted.map(v => v.sh);
    const cpAD = (STATE.curMode === "mensual" || daysRemaining === 0) ? lastAD : lastAD * 1.4;
    const cpNR = projA(nrV, daysElapsed, daysRemaining);
    const cpSH = projA(shV, daysElapsed, daysRemaining);

    const cmA  = cm.reduce((s, m) => s + m.mA,  0);
    const cmNR = cm.reduce((s, m) => s + m.mNR, 0);
    const cmH  = cm.reduce((s, m) => s + m.mH,  0);
    const col  = CITY_COLORS[city] || "#888";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${escapeHTML(cityLabel(city))}
        </div>
        ${miniBar("Cond. Activos",  crAD, cmA,  cpAD)}
        ${miniBar("Nuevos+React",   crNR, cmNR, cpNR)}
        ${miniBar("Hs. Conexión",   crSH, cmH,  cpSH)}
      </div>`;
  });
  html += `</div></div>`;

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  // Partners sin meta ya estan dentro de combos con noMeta=true,
  // suman al FACT del KAM pero no al plan.
  html += secH("👤","#f59e0b","Metas por KAM","Progreso total por responsable","");
  html += `<div class="section"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">`;
  const allKAMs = [...new Set([
    ...combos.map(c => c.kam),
    ...Object.values(STATE.KAM_MAP).filter(k => kamFilter === "all" || k === kamFilter)
  ])].sort();
  allKAMs.forEach(kam => {
    const kc   = combos.filter(c => c.kam === kam);
    const km   = metas.filter(m => m.kam === kam);
    if (!kc.length) return;

    // Partners sin meta de este KAM: ya estan dentro de kc con noMeta=true
    const noGoalPartners = kc.filter(c => c.noMeta).map(c => c.partner);

    const kmA  = km.reduce((s, m) => s + m.mA,  0);
    const kmNR = km.reduce((s, m) => s + m.mNR, 0);
    const kmH  = km.reduce((s, m) => s + m.mH,  0);
    // FACT y proyeccion incluyen partners con y sin meta (todos en kc)
    const krAD = kc.reduce((s, c) => s + c.ad,  0);
    const krNR = kc.reduce((s, c) => s + c.nr,  0);
    const krSH = kc.reduce((s, c) => s + c.sh,  0);
    const kpAD = kc.reduce((s, c) => s + c.projAD, 0);
    const kpNR = kc.reduce((s, c) => s + c.projNR, 0);
    const kpSH = kc.reduce((s, c) => s + c.projSH, 0);
    const col  = KAM_COLORS[kam] || "#888";
    const totalAccounts = kc.length;
    const alertHtml = noGoalPartners.length ? `
      <details style="margin:6px 0">
        <summary style="font-size:.68rem;background:#fff7ed;border:1px solid #fed7aa;border-radius:5px;padding:4px 7px;color:#c2410c;cursor:pointer;list-style:none;display:flex;align-items:center;gap:4px;user-select:none">
          ⚠️ ${noGoalPartners.length} sin meta asignada
          <span style="margin-left:auto;font-size:.6rem;opacity:.7">click para ver</span>
        </summary>
        <div style="font-size:.66rem;background:#fffaf0;border:1px solid #fed7aa;border-top:none;border-radius:0 0 5px 5px;padding:5px 7px;color:#9a3412">
          ${noGoalPartners.map(escapeHTML).join(", ")}
        </div>
      </details>` : "";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${escapeHTML(kam)}
          <span style="font-size:.7rem;font-weight:500;color:#aaa">(${totalAccounts} cuentas)</span>
        </div>
        ${alertHtml}
        ${miniBar("Cond. Activos", krAD, kmA,  kpAD)}
        ${miniBar("Nuevos+React",  krNR, kmNR, kpNR)}
        ${miniBar("Hs. Conexión",  krSH, kmH,  kpSH)}
      </div>`;
  });
  html += `</div></div>`;

  // ── 4. Por Partner ────────────────────────────────────────────────────────
  html += secH("🃏","#FF0000","Metas por Partner","Progreso individual con proyección","");
  html += `<div class="section"><div class="partner-grid">`;
  // Ordenar: primero partners con meta, luego sin meta
  const sortedCombos = [...combos].sort((a, b) =>
    (a.noMeta ? 1 : 0) - (b.noMeta ? 1 : 0)
  );
  sortedCombos.forEach(c => {
    const col    = STATE.partnerColors[c.partner] || "#ccc";
    const kcolor = KAM_COLORS[c.kam] || "#888";
    if (c.noMeta) {
      // Partners SIN meta: mostrar solo FACT, sin plan/proyeccion %
      html += `
        <div class="pcard" style="border-left-color:${col};background:#fafaf9">
          <div class="pcard-name">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col};margin-right:5px"></span>
            ${escapeHTML(c.partner)}
            <span style="font-size:.6rem;font-weight:600;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;padding:1px 5px;border-radius:8px;margin-left:5px">Sin Plan</span>
          </div>
          <div class="pcard-sub">
            <span style="width:7px;height:7px;border-radius:50%;background:${kcolor};display:inline-block;margin-right:3px"></span>
            ${escapeHTML(c.kam)} &nbsp;·&nbsp; ${escapeHTML(c.city)}
          </div>
          <div style="margin:8px 0 4px;font-size:.74rem;color:#555;display:flex;justify-content:space-between">
            <span>Cond. Activos</span><strong>${fmt(c.ad)}</strong>
          </div>
          <div style="margin:4px 0;font-size:.74rem;color:#555;display:flex;justify-content:space-between">
            <span>Nuevos+React</span><strong>${fmt(c.nr)}</strong>
          </div>
          <div style="margin:4px 0;font-size:.74rem;color:#555;display:flex;justify-content:space-between">
            <span>Hs. Conexión</span><strong>${fmt(c.sh)}</strong>
          </div>
          <div style="font-size:.66rem;color:#9a3412;margin-top:6px;font-style:italic">
            * Suma al total del KAM y país aunque no tenga meta.
          </div>
        </div>`;
    } else {
      html += `
        <div class="pcard" style="border-left-color:${col}">
          <div class="pcard-name">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col};margin-right:5px"></span>
            ${escapeHTML(c.partner)}
          </div>
          <div class="pcard-sub">
            <span style="width:7px;height:7px;border-radius:50%;background:${kcolor};display:inline-block;margin-right:3px"></span>
            ${escapeHTML(c.kam)} &nbsp;·&nbsp; ${escapeHTML(c.city)}
          </div>
          ${miniBarFull("Cond. Activos", c.ad, c.mA,  c.projAD)}
          ${miniBarFull("Nuevos+React",  c.nr, c.mNR, c.projNR)}
          ${miniBarFull("Hs. Conexión",  c.sh, c.mH,  c.projSH)}
        </div>`;
    }
  });
  html += `</div></div>`;

  document.getElementById("metasContent").innerHTML = html;
}
// ── HELPERS ───────────────────────────────────────────────────────────────────
function metaResCard(label, sub, real, meta, proj, color) {
  const p   = meta > 0 ? (real / meta) * 100 : 0;
  const pp  = meta > 0 ? (proj / meta) * 100 : 0;
  const pV  = Math.min(p,  100); // visual bar width
  const ppV = Math.min(pp, 100);
  const overBadge = p > 100
    ? `<span style="font-size:.68rem;font-weight:700;color:#fff;background:#8b5cf6;border-radius:4px;padding:1px 5px;margin-left:4px" title="Superas el plan (>100%)">🏆 Overachievement</span>`
    : "";
  const cumplTip = `Cumplimiento = Fact / Plan × 100. Fact: ${fmt(real)} de Plan: ${fmt(meta)}`;
  const projTip = STATE.curMode === "mensual"
    ? `Proyección = valor actual (mes ya cerrado)`
    : `Proyección = total acumulado + (ritmo último 3 períodos / días por período) × días restantes del mes`;
  return `
    <div class="meta-sum-card">
      <div class="mcard-label">${label}</div>
      <div class="mcard-sub-label">${sub}</div>
      <div class="mcard-val">${fmt(real)}</div>
      <div style="margin:4px 0" title="${cumplTip}">
        <span style="font-size:.85rem;font-weight:700;color:${pColor(p)}">${p.toFixed(1)}% </span>
        <span class="sem ${semCls(p)}"></span>
        ${overBadge}
        <span style="font-size:.72rem;color:#aaa"> de plan ${fmt(meta)}</span>
      </div>
      <div style="margin:8px 0 4px">${barProj(pV, ppV)}</div>
      <div style="font-size:.72rem;color:${pColor(pp)};margin-top:4px" title="${projTip}">
        Proyección: <strong>${fmt(proj)}</strong> (${pp.toFixed(1)}%)
      </div>
    </div>`;
}

function miniBar(label, real, meta, proj) {
  const p   = meta > 0 ? (real / meta) * 100 : 0;
  const pp  = meta > 0 ? (proj / meta) * 100 : 0;
  const pV  = Math.min(p,  100);
  const ppV = Math.min(pp, 100);
  const overBadge = p > 100
    ? `<span style="font-size:.63rem;color:#8b5cf6;font-weight:700;margin-left:3px">🏆</span>`
    : "";
  return `
    <div style="padding:6px 0;border-bottom:1px solid #f5f5f5">
      <div style="display:flex;justify-content:space-between;font-size:.74rem;margin-bottom:4px">
        <span style="color:#777">${label}</span>
        <span style="display:flex;align-items:center;gap:4px">
          <strong style="color:${pColor(p)}">${p.toFixed(1)}%</strong>
          <span class="sem ${semCls(p)}"></span>
          ${overBadge}
        </span>
      </div>
      ${barProj(pV, ppV)}
      <div style="font-size:.67rem;color:#aaa;margin-top:2px">
        Fact: ${fmt(real)} / Plan: ${fmt(meta)} /
        Proy: <span style="color:${pColor(pp)};font-weight:700">${fmt(proj)}</span>
      </div>
    </div>`;
}

function miniBarFull(label, real, meta, proj) {
  const p   = meta > 0 ? (real / meta) * 100 : 0;
  const pp  = meta > 0 ? (proj / meta) * 100 : 0;
  const pV  = Math.min(p,  100);
  const ppV = Math.min(pp, 100);
  const overBadge = p > 100
    ? `<span style="font-size:.63rem;color:#8b5cf6;font-weight:700;margin-left:3px">🏆</span>`
    : "";
  return `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:.74rem;margin-bottom:3px">
        <span>${label}</span>
        <span style="display:flex;align-items:center;gap:4px">
          <strong style="color:${pColor(p)}">${p.toFixed(1)}%</strong>
          <span class="sem ${semCls(p)}"></span>
          ${overBadge}
        </span>
      </div>
      <div style="font-size:.7rem;color:#777;margin-bottom:3px">
        Fact: <strong>${fmt(real)}</strong> / Plan: <strong>${fmt(meta)}</strong>
      </div>
      ${barProj(pV, ppV)}
      <div style="font-size:.67rem;color:${pColor(pp)};margin-top:2px">
        Proyección: <strong>${fmt(proj)}</strong> (${pp.toFixed(1)}%)
      </div>
    </div>`;
}

function barProj(pR, pP) {
  let h = `<div class="bar-bg">`;
  if (pP > pR)
    h += `<div class="bar-proj" style="width:${Math.min(pP,100)}%;background:${pColor(pP)}"></div>`;
  h += `<div class="bar-real" style="width:${pR}%;background:${pColor(pR)}"></div>`;
  return h + `</div>`;
}

async function downloadMetasPDF() {
  const content = document.getElementById("metasContent");
  if (!content) return;
  const { jsPDF } = window.jspdf;
  if (!jsPDF || !window.html2canvas) {
    alert("Librerías PDF no disponibles. Recarga la página.");
    return;
  }
  const btn = document.getElementById("metasPdfBtn");
  if (btn) { btn.textContent = "⏳ Generando..."; btn.disabled = true; }

  try {
    const totalH  = content.scrollHeight;
    const pageW   = 1280;
    const pageH   = 720;
    const scale   = 1.5;
    const canvas  = await html2canvas(content, {
      width: content.offsetWidth,
      height: totalH,
      scale,
      useCORS: true,
      logging: false,
      scrollY: -window.scrollY
    });

    const imgData   = canvas.toDataURL("image/jpeg", 0.90);
    const imgW      = canvas.width;
    const imgH      = canvas.height;
    // Fit into landscape A4-ish pages
    const pdfPageW  = 841.89; // A4 landscape pt
    const pdfPageH  = 595.28;
    const ratio     = pdfPageW / imgW;
    const scaledH   = imgH * ratio;
    const pdf       = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    let offsetY     = 0;
    let pageNum     = 0;
    while (offsetY < scaledH) {
      if (pageNum > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, -offsetY, pdfPageW, scaledH);
      offsetY += pdfPageH;
      pageNum++;
    }
    // Usar el mismo mes que muestra renderMetas (mas reciente o seleccion manual)
    const mesesDisp = [...new Set(STATE.metasData.map(m => m.mes))]
      .filter(Boolean)
      .sort((a, b) => _metasMesOrden(b) - _metasMesOrden(a));
    const mes = (STATE.metasMesSel && mesesDisp.includes(STATE.metasMesSel))
      ? STATE.metasMesSel
      : (mesesDisp[0] || "metas");
    pdf.save(`Metas_${mes}.pdf`);
  } catch(err) {
    alert("Error al generar PDF: " + err.message);
  } finally {
    if (btn) { btn.textContent = "⬇ Descargar PDF"; btn.disabled = false; }
  }
}

// ── ELIMINAR METAS DEL MES MOSTRADO ───────────────────────────────────────────
// Borra TODAS las metas del mes que se está viendo (para re-subir el Excel).
// Usa `ilike` sin comodines = igualdad case-insensitive, así cubre el casing
// mixto de uploads viejos ("JUNIO"/"Junio"/"junio") que el loader normaliza a
// UPPERCASE en cliente. Guard de admin defensivo; el enforcement real es RLS.
async function deleteMetasMes(mes) {
  if (!STATE.isAdmin) {
    showBanner(false, "Operación bloqueada: requiere rol admin.");
    return;
  }
  const mesU = (mes || "").trim();
  if (!mesU) return;

  const n = STATE.metasData.filter(m => m.mes === mesU.toUpperCase()).length;
  if (!confirm(
    `¿Confirmas borrar las metas de ${mesU} (${n} registro${n === 1 ? "" : "s"})?\n\n` +
    `Útil para re-subir el Excel corregido. Esta acción NO se puede deshacer.`
  )) return;

  showLoad(true, `Eliminando metas de ${mesU}...`);
  try {
    const { error } = await sb.from("metas").delete().ilike("mes", mesU);
    if (error) throw error;

    // Si el mes borrado era la selección manual del selector, limpiarla para que
    // renderMetas (vía loadFromSupabase) caiga al mes más reciente que quede.
    if (STATE.metasMesSel && STATE.metasMesSel.toUpperCase() === mesU.toUpperCase()) {
      STATE.metasMesSel = null;
    }

    showBanner(true, `Metas de ${mesU} eliminadas. Vuelve a subir el Excel para recargarlas.`);
    await loadFromSupabase();   // refresca STATE.metasData + re-renderiza el tab activo

    // loadFromSupabase solo re-renderiza Metas si quedan filas; si ya no quedan,
    // mostramos el estado vacío explícitamente (si no, queda contenido stale).
    if (STATE.curTab === "metas" && !STATE.metasData.length) {
      const empty = document.getElementById("metasEmpty");
      const cont  = document.getElementById("metasContent");
      if (empty) empty.style.display = "";
      if (cont)  cont.style.display  = "none";
    }
  } catch (err) {
    showBanner(false, `Error al eliminar metas: ${err.message}`);
    console.error("deleteMetasMes:", err.message);
  } finally {
    showLoad(false);
  }
}
