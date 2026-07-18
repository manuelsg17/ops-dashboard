// ops.js — Vista Head de Operaciones

// Guard de reentrancia (mismo patron que rendimiento.js).
let _renderOpsBusy = false;
function renderOps() {
  if (_renderOpsBusy) return;
  _renderOpsBusy = true;
  try {
    _renderOpsImpl();
  } finally {
    _renderOpsBusy = false;
  }
}

function _renderOpsImpl() {
  ensureIndexes();
  if (!STATE.rawData.length) {
    document.getElementById("opsContent").innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <p>Carga datos de Rendimiento para ver la vista de Operaciones</p>
      </div>`;
    return;
  }

  const content  = document.getElementById("opsContent");
  const allDates = STATE.allDates;
  const lastDate = allDates[allDates.length - 1] || "";
  const prevDate = allDates.length > 1 ? allDates[allDates.length - 2] : "";

  // Filtros del sidebar para respetar selección de partners, KAM y ciudad
  const selSet     = new Set(getSel());
  const kamFilter  = document.getElementById("kamFilter")?.value || "all";
  const cityFilter = document.getElementById("cityFilter")?.value || "all";

  let html = modeToggleHTML();

  // ── 1. Resumen por Ciudad ──────────────────────────────────────────────────
  html += secH("🏙️", "#FF0000", "Resumen por Ciudad",
    `Última fecha: ${d2s(lastDate)}  ·  vs período anterior`, "");
  html += `<div class="section"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">`;

  // Precomputar fuera del forEach: rangos de SH y Map de declines (apdFull cacheado)
  const last4Dates = allDates.slice(-4);
  const prev4Dates = allDates.slice(-8, -4);
  const apdFull        = getApdFull();
  const apdByPartner   = new Map();
  apdFull.forEach(r => {
    if (!apdByPartner.has(r.partner)) apdByPartner.set(r.partner, []);
    apdByPartner.get(r.partner).push(r);
  });

  // Deduplicate by partner+city+date
  function citySum(rows, fn) {
    const seen = new Set();
    let sum = 0;
    rows.forEach(r => {
      const k = `${r.partner}|||${r.city}|||${r.date}`;
      if (seen.has(k)) return; seen.add(k);
      sum += fn(r);
    });
    return sum;
  }

  // Helper defensivo: usa indice si existe, sino filtra rawData (1 pasada por ciudad).
  function rowsByCityDate(city, date) {
    if (!date) return [];
    if (STATE._byCityDate) return STATE._byCityDate.get(`${city}|||${date}`) || [];
    return STATE.rawData.filter(r => r.city === city && r.date === date);
  }
  function rowsByCity(city) {
    if (STATE._byCity) return STATE._byCity.get(city) || [];
    return STATE.rawData.filter(r => r.city === city);
  }

  // Filtro centralizado: respeta selSet (partners), kamFilter (KAM seleccionado)
  // y cityFilter (si esta restringido a una ciudad especifica)
  const passSelection = r =>
    selSet.has(r.partner) &&
    (kamFilter === "all" || r.kam === kamFilter || getKAMForPartner(r.partner) === kamFilter);

  CITIES.forEach(city => {
    if (cityFilter !== "all" && cityFilter !== city) return;

    // Filtrar UNA vez por ciudad y luego indexar por fecha.
    // Antes passSelection se llamaba 10+ veces (lastDate, prevDate, 4× last4, 4× prev4).
    const cData = rowsByCity(city).filter(passSelection);
    if (!cData.length) return;

    const cDataByDate = new Map();
    for (const r of cData) {
      let arr = cDataByDate.get(r.date);
      if (!arr) { arr = []; cDataByDate.set(r.date, arr); }
      arr.push(r);
    }

    const lastRows = cDataByDate.get(lastDate) || [];
    const prevRows = cDataByDate.get(prevDate) || [];

    const lAD = citySum(lastRows, r => r.activeDrivers);
    const pAD = citySum(prevRows, r => r.activeDrivers);
    const lNR = lastRows.reduce((s, r) => s + r.newPartner + r.newService + r.reactivated, 0);
    const pNR = prevRows.reduce((s, r) => s + r.newPartner + r.newService + r.reactivated, 0);

    // Supply hours: sum over last 4 / prev 4 dates (lookup O(1) por fecha)
    let lSH = 0, pSH = 0;
    for (const d of last4Dates) {
      const arr = cDataByDate.get(d);
      if (arr) for (const r of arr) lSH += r.supplyHours;
    }
    for (const d of prev4Dates) {
      const arr = cDataByDate.get(d);
      if (arr) for (const r of arr) pSH += r.supplyHours;
    }

    const cityColor = CITY_COLORS[city] || "#888";
    const partnersInCity = [...new Set(cData.map(r => r.partner))].length;

    // Decline alerts in this city — solo entre partners seleccionados
    const decliningPartners = [...new Set(cData.map(r => r.partner))]
      .filter(p => hasConsecutiveDecline(apdByPartner, p));

    html += `
      <div class="mcard" style="border-left:3px solid ${cityColor}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-weight:700;font-size:.9rem;color:#111;display:flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${cityColor};display:inline-block"></span>
            ${cityLabel(city)}
          </div>
          <div style="font-size:.72rem;color:#aaa">${partnersInCity} partners</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div style="text-align:center">
            <div style="font-size:.65rem;color:#aaa;margin-bottom:2px">Activos</div>
            <div style="font-weight:700;font-size:1rem">${fmt(lAD)}</div>
            <div>${bdgMode(lAD, pAD, "mb-badge")}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:.65rem;color:#aaa;margin-bottom:2px">N+R</div>
            <div style="font-weight:700;font-size:1rem">${fmt(lNR)}</div>
            <div>${bdgMode(lNR, pNR, "mb-badge")}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:.65rem;color:#aaa;margin-bottom:2px">Hs. Conexión</div>
            <div style="font-weight:700;font-size:1rem">${fmt(lSH)}</div>
            <div>${bdgMode(lSH, pSH, "mb-badge")}</div>
          </div>
        </div>
        ${decliningPartners.length > 0 ? `
          <div style="margin-top:10px;padding:6px 8px;background:#fff5f5;border-radius:6px;font-size:.72rem;color:#FF0000">
            <span class="decline-badge" style="animation:none">⚠</span>
            ${decliningPartners.length} partner${decliningPartners.length > 1 ? "s en declive" : " en declive"}:
            <span style="font-weight:600">${decliningPartners.join(", ")}</span>
          </div>` : ""}
      </div>`;
  });

  html += `</div></div>`;

  // ── 2. Logro de Metas por Ciudad ──────────────────────────────────────────
  if (STATE.metasData.length) {
    html += secH("🎯", "#8b5cf6", "Logro de Metas por Ciudad",
      "Partners con logro < 50% al cierre del período actual", "");
    html += `<div class="section">`;

    const from = document.getElementById("dateFrom")?.value || STATE.allDates[0];
    const to   = document.getElementById("dateTo")?.value   || lastDate;
    const perfF = getFilteredByDateRange(from, to);

    // Pre-indexar perfF en partner+city → date → metrics. Reemplaza el O(n²)
    // anterior (filter dentro de map dentro de forEach) por O(1) lookup.
    const perfByPartnerCity = new Map();
    perfF.filter(passSelection).forEach(r => {
      const k = `${r.partner}|||${r.city}`;
      let dateMap = perfByPartnerCity.get(k);
      if (!dateMap) { dateMap = new Map(); perfByPartnerCity.set(k, dateMap); }
      let e = dateMap.get(r.date);
      if (!e) { e = { ad: 0, nr: 0, sh: 0 }; dateMap.set(r.date, e); }
      e.ad += r.activeDrivers;
      e.nr += r.newPartner + r.newService + r.reactivated;
      e.sh += r.supplyHours;
    });

    CITIES.forEach(city => {
      if (cityFilter !== "all" && cityFilter !== city) return;
      // Metas filtradas por KAM, partner seleccionado y ciudad
      const cityMetas = STATE.metasData.filter(m => {
        if (kamFilter !== "all" && m.kam !== kamFilter) return false;
        if (!selSet.has(m.partner)) return false;
        return m.city === city;
      });
      if (!cityMetas.length) return;

      const partners = [...new Set(cityMetas.map(m => m.partner))];
      const results  = partners.map(p => {
        const m = cityMetas.filter(x => x.partner === p);
        const mAD = m.reduce((s, x) => s + x.mA, 0);
        const mNR = m.reduce((s, x) => s + x.mNR, 0);
        const mSH = m.reduce((s, x) => s + x.mH, 0);
        // AD = max across dates (snapshot, no acumulativo). NR/SH = sum.
        let rAD = 0, rNR = 0, rSH = 0;
        const dateMap = perfByPartnerCity.get(`${p}|||${city}`);
        if (dateMap) {
          for (const e of dateMap.values()) {
            if (e.ad > rAD) rAD = e.ad;
            rNR += e.nr;
            rSH += e.sh;
          }
        }
        const pAD = mAD > 0 ? Math.min((rAD / mAD) * 100, 100) : null;
        const pNR = mNR > 0 ? Math.min((rNR / mNR) * 100, 100) : null;
        const pSH = mSH > 0 ? Math.min((rSH / mSH) * 100, 100) : null;
        const minP = [pAD, pNR, pSH].filter(x => x !== null);
        const avg  = minP.length ? minP.reduce((a, b) => a + b, 0) / minP.length : null;
        return { p, pAD, pNR, pSH, avg };
      }).sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999));

      const underperforming = results.filter(r => r.avg !== null && r.avg < 50);
      const cityColor = CITY_COLORS[city] || "#888";

      html += `
        <div style="margin-bottom:16px">
          <div style="font-size:.78rem;font-weight:700;color:${cityColor};margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <span style="width:7px;height:7px;border-radius:50%;background:${cityColor};display:inline-block"></span>
            ${cityLabel(city)} — ${underperforming.length > 0 ? `<span style="color:#FF0000">${underperforming.length} partners por debajo del 50%</span>` : `<span style="color:#10b981">Todos ≥ 50% ✓</span>`}
          </div>`;

      if (underperforming.length) {
        html += `<div style="display:flex;flex-wrap:wrap;gap:8px">`;
        underperforming.forEach(r => {
          const pct = r.avg ?? 0;
          html += `
            <div style="background:#fff;border:1px solid #f0f0f0;border-left:3px solid ${pColor(pct)};border-radius:8px;padding:8px 12px;min-width:180px">
              <div style="font-size:.78rem;font-weight:700;color:#333;margin-bottom:4px">${r.p}</div>
              <div style="display:flex;gap:8px;font-size:.7rem">
                ${r.pAD !== null ? `<span style="color:${pColor(r.pAD)}">AD: ${r.pAD.toFixed(0)}%</span>` : ""}
                ${r.pNR !== null ? `<span style="color:${pColor(r.pNR)}">N+R: ${r.pNR.toFixed(0)}%</span>` : ""}
                ${r.pSH !== null ? `<span style="color:${pColor(r.pSH)}">SH: ${r.pSH.toFixed(0)}%</span>` : ""}
              </div>
              <div style="margin-top:5px;height:4px;background:#f0f0f0;border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${pct.toFixed(0)}%;background:${pColor(pct)};border-radius:4px"></div>
              </div>
            </div>`;
        });
        html += `</div>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
  }

  // ── 3. Distribución de Leads Yango ───────────────────────────────────────
  const _lastAll = (STATE._byDate && STATE._byDate.get(lastDate))
    || (lastDate ? STATE.rawData.filter(r => r.date === lastDate) : []);
  const leadsData = _lastAll.filter(r => r.newService > 0);
  if (leadsData.length) {
    html += secH("★", "#f59e0b", "Distribución de Leads Yango",
      `Partners que reciben leads de Yango · ${d2s(lastDate)}`, "");
    html += `<div class="section">`;

    const byCity = {};
    leadsData.forEach(r => {
      if (!byCity[r.city]) byCity[r.city] = [];
      const existing = byCity[r.city].find(x => x.partner === r.partner);
      if (existing) existing.ns += r.newService;
      else byCity[r.city].push({ partner: r.partner, ns: r.newService });
    });

    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">`;
    Object.entries(byCity).forEach(([city, partners]) => {
      const cityColor = CITY_COLORS[city] || "#888";
      const sorted = partners.sort((a, b) => b.ns - a.ns);
      html += `
        <div class="mcard" style="border-left:3px solid ${cityColor}">
          <div style="font-weight:700;font-size:.82rem;margin-bottom:8px;color:${cityColor}">${cityLabel(city)}</div>
          ${sorted.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f5f5f5;font-size:.78rem">
              <span style="color:#333">${escapeHTML(p.partner)}</span>
              <span class="leads-badge">★ ${fmt(p.ns)}</span>
            </div>`).join("")}
        </div>`;
    });
    html += `</div></div>`;
  }

  content.innerHTML = html;
}
