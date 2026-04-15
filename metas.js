// metas.js — Pestaña Metas

function renderMetas() {
  if (!STATE.metasData.length) return;

  const cityFilter = document.getElementById("cityFilter").value;
  const kamFilter  = document.getElementById("kamFilter").value;
  const sel        = getSel();
  const from       = document.getElementById("dateFrom").value;
  const to         = document.getElementById("dateTo").value;
  const selSet     = new Set(sel);

  const metas = STATE.metasData.filter(m => {
    if (kamFilter !== "all" && m.kam !== kamFilter) return false;
    if (sel.length && !selSet.has(m.partner))     return false;
    return true;
  });

  const mesName = STATE.metasData[0]?.mes || "";

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
  const cpRows = Object.values(cpMap);

  // New projection: based on last data date + 6 days = end of current week
  const maxDate = cpRows.length ? cpRows.map(r => r.date).sort().at(-1) : to;
  const { daysElapsed, daysRemaining } = calcProjectionDays(maxDate);

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
  html += `<div style="display:flex;justify-content:flex-end;margin-bottom:8px">
    <button class="apply-btn" onclick="downloadMetasPDF()" style="width:auto;padding:7px 16px;font-size:.8rem">⬇ Descargar PDF</button>
  </div>`;

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
      if (sel.length && !selSet.has(m.partner))     return false;
      return m.city === city;
    });
    if (!cm.length) return;

    // Build city combos using actual city data from rendimiento
    const cityPerfRows = STATE.rawData.filter(r =>
      r.date >= from && r.date <= to &&
      r.city === city &&
      selSet.has(r.partner)
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
          ${city}
        </div>
        ${miniBar("Cond. Activos",  crAD, cmA,  cpAD)}
        ${miniBar("Nuevos+React",   crNR, cmNR, cpNR)}
        ${miniBar("Hs. Conexion",   crSH, cmH,  cpSH)}
      </div>`;
  });
  html += `</div></div>`;

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  // Partners assigned to KAM (from config) but without goals in metas
  const partnersWithMeta = new Set(metas.map(m => m.partner));
  html += secH("👤","#f59e0b","Metas por KAM","Progreso total por responsable","");
  html += `<div class="section"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">`;
  const allKAMs = [...new Set([
    ...combos.map(c => c.kam),
    ...Object.values(STATE.KAM_MAP).filter(k => kamFilter === "all" || k === kamFilter)
  ])].sort();
  allKAMs.forEach(kam => {
    const kc   = combos.filter(c => c.kam === kam);
    const km   = metas.filter(m => m.kam === kam);

    // Find partners linked to this KAM (from config) but without goals
    const kamPartnersConfig = STATE.KAM_PARTNERS[kam] ? [...STATE.KAM_PARTNERS[kam]] : [];
    const noGoalPartners = kamPartnersConfig.filter(p =>
      !partnersWithMeta.has(p) && cpRows.some(r => r.partner === p)
    );

    // Include no-goal partners' actual performance in KAM totals
    let extraAD = 0, extraNR = 0, extraSH = 0;
    noGoalPartners.forEach(p => {
      const r = getRPC(p, cityFilter === "all" ? "all" : cityFilter);
      extraAD += r.ad; extraNR += r.nr; extraSH += r.sh;
    });

    if (!kc.length && !noGoalPartners.length) return;
    const kmA  = km.reduce((s, m) => s + m.mA,  0);
    const kmNR = km.reduce((s, m) => s + m.mNR, 0);
    const kmH  = km.reduce((s, m) => s + m.mH,  0);
    const krAD = kc.reduce((s, c) => s + c.ad,  0) + extraAD;
    const krNR = kc.reduce((s, c) => s + c.nr,  0) + extraNR;
    const krSH = kc.reduce((s, c) => s + c.sh,  0) + extraSH;
    const kpAD = kc.reduce((s, c) => s + c.projAD, 0);
    const kpNR = kc.reduce((s, c) => s + c.projNR, 0);
    const kpSH = kc.reduce((s, c) => s + c.projSH, 0);
    const col  = KAM_COLORS[kam] || "#888";
    const totalAccounts = kc.length + noGoalPartners.length;
    const alertHtml = noGoalPartners.length ? `
      <div style="font-size:.68rem;background:#fff7ed;border:1px solid #fed7aa;border-radius:5px;padding:5px 7px;margin:6px 0;color:#c2410c">
        ⚠️ Sin meta asignada (incluido en global): <strong>${noGoalPartners.join(", ")}</strong>
      </div>` : "";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${kam}
          <span style="font-size:.7rem;font-weight:500;color:#aaa">(${totalAccounts} cuentas)</span>
        </div>
        ${alertHtml}
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
  const p   = meta > 0 ? (real / meta) * 100 : 0;
  const pp  = meta > 0 ? (proj / meta) * 100 : 0;
  const pV  = Math.min(p,  100); // visual bar width
  const ppV = Math.min(pp, 100);
  const overBadge = p > 100
    ? `<span style="font-size:.68rem;font-weight:700;color:#fff;background:#8b5cf6;border-radius:4px;padding:1px 5px;margin-left:4px">🏆 Overachievement</span>`
    : "";
  return `
    <div class="meta-sum-card">
      <div class="mcard-label">${label}</div>
      <div class="mcard-sub-label">${sub}</div>
      <div class="mcard-val">${fmt(real)}</div>
      <div style="margin:4px 0">
        <span style="font-size:.85rem;font-weight:700;color:${pColor(p)}">${p.toFixed(1)}% </span>
        <span class="sem ${semCls(p)}"></span>
        ${overBadge}
        <span style="font-size:.72rem;color:#aaa"> de plan ${fmt(meta)}</span>
      </div>
      <div style="margin:8px 0 4px">${barProj(pV, ppV)}</div>
      <div style="font-size:.72rem;color:${pColor(pp)};margin-top:4px">
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
  const btn = document.querySelector("#metasContent .apply-btn");
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
    const mes = STATE.metasData[0]?.mes || "metas";
    pdf.save(`Metas_${mes}.pdf`);
  } catch(err) {
    alert("Error al generar PDF: " + err.message);
  } finally {
    if (btn) { btn.textContent = "⬇ Descargar PDF"; btn.disabled = false; }
  }
}
