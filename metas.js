// metas.js — Pestaña Metas

function renderMetas() {
  if (!STATE.metasData.length) return;

  const cityFilter = document.getElementById("cityFilter").value;
  const kamFilter  = document.getElementById("kamFilter").value;
  const sel        = getSel();
  const from       = document.getElementById("dateFrom").value;
  const to         = document.getElementById("dateTo").value;

  const metas = STATE.metasData.filter(m => {
    if (kamFilter !== "all" && m.kam !== kamFilter) return false;
    if (sel.length && !sel.includes(m.partner))     return false;
    return true;
  });

  const mesName    = STATE.metasData[0]?.mes || "";
  const weeksTotal = mWeeks(from, to);

  // Build performance data by partner+city+date (full precision)
  const perfF  = STATE.rawData.filter(r => r.date >= from && r.date <= to);
  const cpMap  = {};
  perfF.forEach(r => {
    const k = `${r.partner}|||${r.city}|||${r.date}`;
    if (!cpMap[k]) cpMap[k] = { partner: r.partner, city: r.city, date: r.date, ad: 0, nr: 0, sh: 0 };
    cpMap[k].ad += r.activeDrivers;
    cpMap[k].nr += r.newPartner + r.newService + r.reactivated;
    cpMap[k].sh += r.supplyHours;
  });
  const cpRows    = Object.values(cpMap);
  const weeksDone = [...new Set(cpRows.map(r => r.date))].length || 1;

  function getRPC(partner, city) {
    // If city is empty or "all", aggregate across all cities for this partner
    const rows = cpRows.filter(r =>
      r.partner === partner && (city === "" || city === "all" || r.city === city)
    );
    if (!rows.length) return { ad: 0, nr: 0, sh: 0, lastAD: 0, nrV: [], shV: [] };
    const bd = {};
    rows.forEach(r => {
      if (!bd[r.date]) bd[r.date] = { ad: 0, nr: 0, sh: 0 };
      bd[r.date].ad += r.ad; bd[r.date].nr += r.nr; bd[r.date].sh += r.sh;
    });
    const sorted = Object.keys(bd).sort().map(d => bd[d]);
    return {
      ad:     Math.max(...sorted.map(v => v.ad)),
      nr:     sorted.reduce((s, v) => s + v.nr, 0),
      sh:     sorted.reduce((s, v) => s + v.sh, 0),
      lastAD: sorted[sorted.length - 1]?.ad || 0,
      nrV:    sorted.map(v => v.nr),
      shV:    sorted.map(v => v.sh)
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
        projAD: r.lastAD * 1.4,
        projNR: projA(r.nrV, weeksDone, weeksTotal),
        projSH: projA(r.shV, weeksDone, weeksTotal) });
    });
  } else {
    metas.filter(m => m.city === cityFilter).forEach(m => {
      const r = getRPC(m.partner, m.city);
      combos.push({ partner: m.partner, kam: m.kam, city: m.city,
        mA: m.mA, mNR: m.mNR, mH: m.mH,
        ad: r.ad, nr: r.nr, sh: r.sh,
        projAD: r.lastAD * 1.4,
        projNR: projA(r.nrV, weeksDone, weeksTotal),
        projSH: projA(r.shV, weeksDone, weeksTotal) });
    });
  }

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

  // ── 1. Peru Summary ───────────────────────────────────────────────────────
  html += secH("🎯","#8b5cf6","Cumplimiento de Metas - "+mesName,"Progreso actual vs meta del mes","Peru");
  html += `<div class="section"><div class="metric-row">
    ${metaResCard("Conductores Activos","máx semana",  tAD, tMA, tPAD, "#8b5cf6")}
    ${metaResCard("Nuevos + Reactivados","acumulado mes", tNR, tMNR, tPNR, "#f97316")}
    ${metaResCard("Horas de Conexion","acumulado mes",  tSH, tMH,  tPSH, "#06b6d4")}
  </div></div>`;

  // ── 2. Por Ciudad ─────────────────────────────────────────────────────────
  html += secH("🏙️","#06b6d4","Metas por Ciudad","Progreso y proyección","");
  html += `<div class="section"><div class="city-grid">`;
  CITIES.forEach(city => {
    // Use all metas for this city (ignore cityFilter here to always show all cities)
    const cm = STATE.metasData.filter(m => {
      if (kamFilter !== "all" && m.kam !== kamFilter) return false;
      if (sel.length && !sel.includes(m.partner))     return false;
      return m.city === city;
    });
    if (!cm.length) return;

    // Build city combos using actual city data from rendimiento
    const cityPerfRows = STATE.rawData.filter(r =>
      r.date >= from && r.date <= to &&
      r.city === city &&
      sel.includes(r.partner)
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
    const cpAD = lastAD * 1.4;
    const cpNR = projA(nrV, weeksDone, weeksTotal);
    const cpSH = projA(shV, weeksDone, weeksTotal);

    const cmA  = cm.reduce((s, m) => s + m.mA,  0);
    const cmNR = cm.reduce((s, m) => s + m.mNR, 0);
    const cmH  = cm.reduce((s, m) => s + m.mH,  0);
    const col  = CITY_COLORS[city] || "#888";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${city}
        </div>
        ${miniBar("Cond. Activos",  crAD, cmA,  cpAD)}
        ${miniBar("Nuevos+React",   crNR, cmNR, cpNR)}
        ${miniBar("Hs. Conexion",   crSH, cmH,  cpSH)}
      </div>`;
  });
  html += `</div></div>`;

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  html += secH("👤","#f59e0b","Metas por KAM","Progreso total por responsable","");
  html += `<div class="section"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">`;
  [...new Set(combos.map(c => c.kam))].sort().forEach(kam => {
    const kc   = combos.filter(c => c.kam === kam);
    const km   = metas.filter(m => m.kam === kam);
    if (!kc.length) return;
    const kmA  = km.reduce((s, m) => s + m.mA,  0);
    const kmNR = km.reduce((s, m) => s + m.mNR, 0);
    const kmH  = km.reduce((s, m) => s + m.mH,  0);
    const krAD = kc.reduce((s, c) => s + c.ad,  0);
    const krNR = kc.reduce((s, c) => s + c.nr,  0);
    const krSH = kc.reduce((s, c) => s + c.sh,  0);
    const kpAD = kc.reduce((s, c) => s + c.projAD, 0);
    const kpNR = kc.reduce((s, c) => s + c.projNR, 0);
    const kpSH = kc.reduce((s, c) => s + c.projSH, 0);
    const col  = KAM_COLORS[kam] || "#888";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${kam}
          <span style="font-size:.7rem;font-weight:500;color:#aaa">(${kc.length} cuentas)</span>
        </div>
        ${miniBar("Cond. Activos", krAD, kmA,  kpAD)}
        ${miniBar("Nuevos+React",  krNR, kmNR, kpNR)}
        ${miniBar("Hs. Conexion",  krSH, kmH,  kpSH)}
      </div>`;
  });
  html += `</div></div>`;

  // ── 4. Por Partner ────────────────────────────────────────────────────────
  html += secH("🃏","#FF0000","Metas por Partner","Progreso individual con proyección","");
  html += `<div class="section"><div class="partner-grid">`;
  combos.forEach(c => {
    const col    = STATE.partnerColors[c.partner] || "#ccc";
    const kcolor = KAM_COLORS[c.kam] || "#888";
    html += `
      <div class="pcard" style="border-left-color:${col}">
        <div class="pcard-name">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col};margin-right:5px"></span>
          ${c.partner}
        </div>
        <div class="pcard-sub">
          <span style="width:7px;height:7px;border-radius:50%;background:${kcolor};display:inline-block;margin-right:3px"></span>
          ${c.kam} &nbsp;·&nbsp; ${c.city}
        </div>
        ${miniBarFull("Cond. Activos", c.ad, c.mA,  c.projAD)}
        ${miniBarFull("Nuevos+React",  c.nr, c.mNR, c.projNR)}
        ${miniBarFull("Hs. Conexion",  c.sh, c.mH,  c.projSH)}
      </div>`;
  });
  html += `</div></div>`;

  document.getElementById("metasContent").innerHTML = html;
}
// ── HELPERS ───────────────────────────────────────────────────────────────────
function metaResCard(label, sub, real, meta, proj, color) {
  const p  = meta > 0 ? Math.min((real / meta) * 100, 100) : 0;
  const pp = meta > 0 ? Math.min((proj / meta) * 100, 100) : 0;
  return `
    <div class="meta-sum-card">
      <div class="mcard-label">${label}</div>
      <div class="mcard-sub-label">${sub}</div>
      <div class="mcard-val">${fmt(real)}</div>
      <div style="margin:4px 0">
        <span style="font-size:.85rem;font-weight:700;color:${pColor(p)}">${p.toFixed(1)}% </span>
        <span class="sem ${semCls(p)}"></span>
        <span style="font-size:.72rem;color:#aaa"> de meta ${fmt(meta)}</span>
      </div>
      <div style="margin:8px 0 4px">${barProj(p, pp)}</div>
      <div style="font-size:.72rem;color:${pColor(pp)};margin-top:4px">
        Proyección: <strong>${fmt(proj)}</strong> (${pp.toFixed(1)}%)
      </div>
    </div>`;
}

function miniBar(label, real, meta, proj) {
  const p  = meta > 0 ? Math.min((real / meta) * 100, 100) : 0;
  const pp = meta > 0 ? Math.min((proj / meta) * 100, 100) : 0;
  return `
    <div style="padding:6px 0;border-bottom:1px solid #f5f5f5">
      <div style="display:flex;justify-content:space-between;font-size:.74rem;margin-bottom:4px">
        <span style="color:#777">${label}</span>
        <span style="display:flex;align-items:center;gap:4px">
          <strong style="color:${pColor(p)}">${p.toFixed(1)}%</strong>
          <span class="sem ${semCls(p)}"></span>
        </span>
      </div>
      ${barProj(p, pp)}
      <div style="font-size:.67rem;color:#aaa;margin-top:2px">
        Real: ${fmt(real)} / Meta: ${fmt(meta)} /
        Proy: <span style="color:${pColor(pp)};font-weight:700">${fmt(proj)}</span>
      </div>
    </div>`;
}

function miniBarFull(label, real, meta, proj) {
  const p  = meta > 0 ? Math.min((real / meta) * 100, 100) : 0;
  const pp = meta > 0 ? Math.min((proj / meta) * 100, 100) : 0;
  return `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:.74rem;margin-bottom:3px">
        <span>${label}</span>
        <span style="display:flex;align-items:center;gap:4px">
          <strong style="color:${pColor(p)}">${p.toFixed(1)}%</strong>
          <span class="sem ${semCls(p)}"></span>
        </span>
      </div>
      <div style="font-size:.7rem;color:#777;margin-bottom:3px">
        Real: <strong>${fmt(real)}</strong> / Meta: <strong>${fmt(meta)}</strong>
      </div>
      ${barProj(p, pp)}
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
