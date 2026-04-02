// presentacion.js — Pestaña Presentación v3

let PRESENT_STATE = {
  partner:   null,
  slide:     0,
  lang:      "es",
  aiSummary: { es: null, en: null },
  charts:    []
};

const SLIDE_NAMES_ES = ["Carátula", "KPIs", "Tendencia", "Ranking", "Resumen", "vs Ciudad"];
const SLIDE_NAMES_EN = ["Cover",    "KPIs", "Trend",     "Ranking", "Summary", "vs City"];

// ── HELPERS ───────────────────────────────────────────────────────────────────
function destroyPresentCharts() {
  PRESENT_STATE.charts.forEach(c => { try { c.destroy(); } catch(e){} });
  PRESENT_STATE.charts = [];
}

function getLast4Dates(to) {
  const all = [...new Set(STATE.rawData.map(r => r.date))].sort();
  const idx = all.findIndex(d => d > to);
  const end = idx === -1 ? all.length - 1 : idx - 1;
  return all.slice(Math.max(0, end - 3), end + 1);
}

function getWoW(vals) {
  // Returns array of WoW % for each index (null for first)
  return vals.map((v, i) => {
    if (i === 0) return null;
    const prev = vals[i-1];
    if (!prev) return null;
    return ((v - prev) / prev * 100);
  });
}

function wowColor(pct) {
  if (pct === null) return "#aaa";
  return pct >= 0 ? "#10b981" : "#FF0000";
}

function getPartnerVals(partner, city, dates, metricFn) {
  return dates.map(d =>
    STATE.rawData.filter(r => r.partner===partner && r.city===city && r.date===d)
      .reduce((s,r) => s + metricFn(r), 0)
  );
}

function getCityVals(city, dates, metricFn) {
  return dates.map(d =>
    STATE.rawData.filter(r => r.city===city && r.date===d)
      .reduce((s,r) => s + metricFn(r), 0)
  );
}

function buildMiniChart(canvasId, dates, partnerVals, cityVals, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const pMax   = Math.max(...partnerVals, 1);
  const cMax   = Math.max(...cityVals, 1);
  const cNorm  = cityVals.map(v => (v/cMax)*pMax);
  const pWoW   = getWoW(partnerVals);
  const cWoW   = getWoW(cityVals);

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: dates.map(d => d2s(d)),
      datasets: [
        {
          label: "Partner",
          data: partnerVals,
          borderColor: color,
          backgroundColor: color + "20",
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: pWoW.map(w => wowColor(w)),
          pointBorderColor: pWoW.map(w => wowColor(w)),
          tension: 0.3,
          fill: true
        },
        {
          label: "Ciudad",
          data: cNorm,
          borderColor: "#bbb",
          borderWidth: 1.5,
          borderDash: [4,4],
          pointRadius: 3,
          pointBackgroundColor: cWoW.map(w => wowColor(w)),
          pointBorderColor: cWoW.map(w => wowColor(w)),
          tension: 0.3,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const wow = ctx.datasetIndex === 0 ? pWoW[ctx.dataIndex] : cWoW[ctx.dataIndex];
              const wStr = wow !== null ? ` (${wow>=0?"+":""}${wow.toFixed(1)}%)` : "";
              return ctx.datasetIndex === 0
                ? `Partner: ${fmt(ctx.raw)}${wStr}`
                : `Ciudad: tendencia${wStr}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { font:{size:8}, maxRotation:0 }, grid: { display:false } },
        y: { ticks: { font:{size:8}, callback: v => fmt(v) }, grid: { color:"#f5f5f5" } }
      }
    }
  });
  PRESENT_STATE.charts.push(chart);
}

function buildBigChart(canvasId, dates, partnerVals, cityDatasets, color, label) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const pWoW = getWoW(partnerVals);

  const datasets = [
    {
      label,
      data: partnerVals,
      borderColor: color,
      backgroundColor: color + "20",
      borderWidth: 2.5,
      pointRadius: 5,
      pointBackgroundColor: pWoW.map(w => wowColor(w)),
      pointBorderColor: pWoW.map(w => wowColor(w)),
      tension: 0.3,
      fill: true
    },
    ...cityDatasets
  ];

  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: dates.map(d => d2s(d)), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "bottom", labels: { font:{size:9}, boxWidth:12 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const wow = getWoW(ctx.dataset.data)[ctx.dataIndex];
              const wStr = wow !== null ? ` (${wow>=0?"+":""}${wow.toFixed(1)}%)` : "";
              return `${ctx.dataset.label}: ${fmt(ctx.raw)}${wStr}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { font:{size:9} }, grid: { display:false } },
        y: { ticks: { font:{size:9}, callback: v => fmt(v) }, grid: { color:"#f5f5f5" } }
      }
    }
  });
  PRESENT_STATE.charts.push(chart);
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
function renderPresent() {
  destroyPresentCharts();
  const el = document.getElementById("presentContent");
  if (!STATE.rawData.length) {
    el.innerHTML = `<div class="empty"><p>Carga datos para comenzar</p></div>`;
    return;
  }

  const partners   = STATE.allPartners;
  const sel        = PRESENT_STATE.partner || partners[0];
  const mode       = STATE.curMode;
  const from       = document.getElementById("dateFrom").value;
  const to         = document.getElementById("dateTo").value;
  const es         = PRESENT_STATE.lang === "es";
  const slideNames = es ? SLIDE_NAMES_ES : SLIDE_NAMES_EN;

  el.innerHTML = `
    <div style="min-height:100vh;background:#f2f2f2;padding:20px;display:flex;flex-direction:column">
      <!-- Controles -->
      <div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div>
          <label style="font-size:.72rem;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Partner</label>
          <input id="presentPartnerSearch" type="text" class="sb-inp" style="width:200px;margin-bottom:4px" placeholder="${es?"Buscar partner...":"Search partner..."}" oninput="filterPresentPartners(this.value)"/>
          <select id="presentPartnerSel" class="sb-sel" style="width:200px" onchange="onPresentPartnerChange(this.value)">
            ${partners.map(p => `<option value="${p}" ${p===sel?"selected":""}>${p}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:.72rem;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">${es?"Idioma":"Language"}</label>
          <div class="mode-toggle">
            <button class="mode-btn ${PRESENT_STATE.lang==='es'?'active':''}" onclick="setPresentLang('es')">ES</button>
            <button class="mode-btn ${PRESENT_STATE.lang==='en'?'active':''}" onclick="setPresentLang('en')">EN</button>
          </div>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:flex-end">
          <button onclick="switchTab('rend')" style="padding:8px 16px;border-radius:8px;font-size:.82rem;font-weight:600;border:2px solid #e5e5e5;background:#fff;color:#555;cursor:pointer">← ${es?"Volver":"Back"}</button>
          <button class="apply-btn" style="width:auto;padding:8px 18px" onclick="downloadPresentPDF()">⬇ ${es?"Descargar PDF":"Download PDF"}</button>
        </div>
      </div>

      <!-- Navegación -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <button class="png-btn" onclick="prevSlide()" style="padding:6px 12px">◀</button>
        ${slideNames.map((s,i) => `
          <button onclick="goSlide(${i})" style="padding:6px 14px;border-radius:6px;font-size:.78rem;font-weight:600;border:2px solid ${PRESENT_STATE.slide===i?'#FF0000':'#e5e5e5'};background:${PRESENT_STATE.slide===i?'#FF0000':'#fff'};color:${PRESENT_STATE.slide===i?'#fff':'#555'};cursor:pointer">${s}</button>
        `).join("")}
        <button class="png-btn" onclick="nextSlide()" style="padding:6px 12px">▶</button>
      </div>

      <!-- Slide 16:9 -->
      <div id="slideContainer" style="width:100%;aspect-ratio:16/9;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.12);overflow:hidden">
        <div id="slideInner" style="width:100%;height:100%"></div>
      </div>
    </div>
    <div id="printSlides" style="display:none"></div>`;

  renderSlide(sel, from, to, mode);
}

function onPresentPartnerChange(p) {
  PRESENT_STATE.partner   = p;
  PRESENT_STATE.aiSummary = { es: null, en: null };
  renderPresent();
}

function filterPresentPartners(q) {
  const sel = document.getElementById("presentPartnerSel");
  if (!sel) return;
  [...sel.options].forEach(o => {
    o.style.display = o.value.toLowerCase().includes(q.toLowerCase()) ? "" : "none";
  });
}

function setPresentLang(lang) { PRESENT_STATE.lang = lang; renderPresent(); }
function prevSlide() { PRESENT_STATE.slide = Math.max(0, PRESENT_STATE.slide - 1); renderPresent(); }
function nextSlide() { PRESENT_STATE.slide = Math.min(5, PRESENT_STATE.slide + 1); renderPresent(); }
function goSlide(i)  { PRESENT_STATE.slide = i; renderPresent(); }

// ── RENDER SLIDE ──────────────────────────────────────────────────────────────
function renderSlide(partner, from, to, mode) {
  const el = document.getElementById("slideInner");
  if (!el) return;
  switch (PRESENT_STATE.slide) {
    case 0: el.innerHTML = buildSlide0(partner, from, to, mode); break;
    case 1: el.innerHTML = buildSlide1(partner, from, to, mode);
            setTimeout(() => buildSlide1Charts(partner, to), 100); break;
    case 2: el.innerHTML = buildSlide2(partner, from, to, mode);
            setTimeout(() => buildSlide2Charts(partner, to), 100); break;
    case 3: el.innerHTML = buildSlide3(partner, from, to, mode); break;
    case 4: renderSlide4(el, partner, from, to, mode); break;
    case 5: el.innerHTML = buildSlide5(partner, from, to, mode); break;
  }
}

// ── SLIDE 0: CARÁTULA ─────────────────────────────────────────────────────────
function buildSlide0(partner, from, to, mode) {
  const col       = STATE.partnerColors[partner] || "#FF0000";
  const kam       = Object.entries(STATE.KAM_MAP).find(([c]) => STATE.CLID_MAP[c] === partner)?.[1] || "";
  const cities    = [...new Set(STATE.rawData.filter(r => r.partner === partner).map(r => r.city))].join(" · ");
  const es        = PRESENT_STATE.lang === "es";
  const modeLabel = mode === "mensual"
    ? (es ? "Avance Mensual" : "Monthly Update")
    : (es ? "Avance Semanal" : "Weekly Update");
  const dateLabel = mode === "mensual"
    ? `${to.slice(5,7)}.${to.slice(0,4)}`
    : d2s(to);

  return `
    <div style="width:100%;height:100%;background:linear-gradient(135deg,#1a1a1a 0%,#2d2d2d 100%);display:flex;flex-direction:column;justify-content:center;align-items:center;position:relative;overflow:hidden">
      <div style="position:absolute;top:-80px;right:-80px;width:320px;height:320px;border-radius:50%;background:${col};opacity:.08"></div>
      <div style="position:absolute;bottom:-60px;left:-60px;width:240px;height:240px;border-radius:50%;background:#FF0000;opacity:.06"></div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px">
        <div style="width:48px;height:48px;background:#FF0000;border-radius:12px;display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="26" height="26"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div style="color:#fff;font-weight:900;font-size:1.4rem;letter-spacing:-1px">YANGO <span style="color:#FF0000">Partners</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:14px;height:14px;border-radius:50%;background:${col}"></div>
        <div style="color:#fff;font-weight:900;font-size:2.4rem;letter-spacing:-1px">${partner}</div>
      </div>
      <div style="color:#FF0000;font-weight:700;font-size:1.1rem;margin-bottom:8px">${modeLabel} · ${dateLabel}</div>
      <div style="color:#aaa;font-size:.85rem;margin-bottom:24px">${cities}</div>
      <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:8px 20px;color:#ccc;font-size:.8rem">
        Account Manager: <strong style="color:#fff">${kam}</strong>
      </div>
    </div>`;
}

// ── SLIDE 1: KPIs POR CIUDAD ──────────────────────────────────────────────────
function buildSlide1(partner, from, to, mode) {
  const es       = PRESENT_STATE.lang === "es";
  const cities   = [...new Set(STATE.rawData.filter(r => r.partner === partner).map(r => r.city))];
  const allDates = [...new Set(STATE.rawData.map(r => r.date))].sort();
  const lastDate = allDates.filter(d => d <= to).slice(-1)[0] || to;
  const lastIdx  = allDates.indexOf(lastDate);
  const prevDate = lastIdx > 0 ? allDates[lastIdx - 1] : "";
  const wowLabel = mode === "mensual"
    ? (es ? "vs mes ant." : "vs prev month")
    : (es ? "vs sem. ant." : "vs prev week");

  const metrics = [
    { key:"ad", label: es?"Conductores Activos":"Active Drivers",   color:"#FF0000", fn: r=>r.activeDrivers },
    { key:"nr", label: es?"Nuevos + Reactivados":"New+Reactivated", color:"#f97316", fn: r=>r.newPartner+r.newService+r.reactivated },
    { key:"sh", label: es?"Horas de Conexión":"Supply Hours",        color:"#8b5cf6", fn: r=>r.supplyHours }
  ];

  return `
    <div style="width:100%;height:100%;background:#fff;padding:16px 20px;display:flex;flex-direction:column;overflow:hidden">
      <div style="font-weight:900;font-size:.9rem;color:#111;margin-bottom:2px">
        ${partner} <span style="color:#aaa;font-weight:400;font-size:.72rem">· ${es?"KPIs por Ciudad":"KPIs by City"} · ${d2s(from)} → ${d2s(to)}</span>
      </div>
      <div style="font-size:.62rem;color:#aaa;margin-bottom:8px;display:flex;gap:16px">
        <span style="display:inline-flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:14px;height:2px;background:#FF0000;border-radius:2px"></span>
          ${es?"Partner (puntos = WoW)":"Partner (dots = WoW)"}
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:14px;height:1px;background:#bbb;border-top:1px dashed #bbb"></span>
          ${es?"Ciudad — tendencia (puntos = WoW ciudad)":"City — trend (dots = city WoW)"}
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981"></span>${es?"positivo":"positive"}
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#FF0000;margin-left:4px"></span>${es?"negativo":"negative"}
        </span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${cities.length},1fr);gap:10px;flex:1;min-height:0">
        ${cities.map(city => {
          const col = CITY_COLORS[city] || "#888";
          return `
            <div style="border-top:3px solid ${col};padding-top:6px;display:flex;flex-direction:column;gap:5px;min-height:0">
              <div style="font-weight:800;font-size:.82rem;color:${col}">${city}</div>
              ${metrics.map(m => {
                const pLast = STATE.rawData.filter(r => r.partner===partner && r.city===city && r.date===lastDate);
                const pPrev = STATE.rawData.filter(r => r.partner===partner && r.city===city && r.date===prevDate);
                const cLast = STATE.rawData.filter(r => r.city===city && r.date===lastDate);
                const cPrev = STATE.rawData.filter(r => r.city===city && r.date===prevDate);
                const pValL = pLast.reduce((s,r)=>s+m.fn(r),0);
                const pValP = pPrev.reduce((s,r)=>s+m.fn(r),0);
                const cValL = cLast.reduce((s,r)=>s+m.fn(r),0);
                const cValP = cPrev.reduce((s,r)=>s+m.fn(r),0);
                const pWoW  = pValP>0 ? ((pValL-pValP)/pValP*100).toFixed(1) : null;
                const cWoW  = cValP>0 ? ((cValL-cValP)/cValP*100).toFixed(1) : null;
                const pColor = pWoW===null?"#aaa":+pWoW>=0?"#10b981":"#FF0000";
                const cColor = cWoW===null?"#aaa":+cWoW>=0?"#10b981":"#FF0000";
                const pSign  = pWoW!==null&&+pWoW>=0?"+":"";
                const cSign  = cWoW!==null&&+cWoW>=0?"+":"";
                return `
                  <div style="flex:1;min-height:0;background:#fafafa;border-radius:6px;padding:5px 7px;display:flex;flex-direction:column">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                      <span style="font-size:.6rem;color:#aaa;font-weight:700;text-transform:uppercase;letter-spacing:.3px">${m.label}</span>
                      <span style="font-size:.66rem;font-weight:700;color:${pColor};background:${pColor}18;padding:1px 5px;border-radius:6px">
                        ${pWoW!==null?pSign+pWoW+"%":"NEW"}
                      </span>
                    </div>
                    <div style="font-weight:900;font-size:.88rem;color:#111;margin-bottom:3px">${fmt(pValL)}</div>
                    <div style="flex:1;min-height:60px;position:relative">
                      <canvas id="mc_${city}_${m.key}" style="width:100%;height:100%"></canvas>
                    </div>
                    <div style="font-size:.58rem;color:#aaa;margin-top:2px;display:flex;justify-content:space-between">
                      <span>${wowLabel} ${es?"ciudad":"city"}:</span>
                      <span style="color:${cColor};font-weight:700">${cWoW!==null?cSign+cWoW+"%":"N/A"}</span>
                    </div>
                  </div>`;
              }).join("")}
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

function buildSlide1Charts(partner, to) {
  const cities  = [...new Set(STATE.rawData.filter(r => r.partner === partner).map(r => r.city))];
  const dates   = getLast4Dates(to);
  const metrics = [
    { key:"ad", color:"#FF0000", fn: r=>r.activeDrivers },
    { key:"nr", color:"#f97316", fn: r=>r.newPartner+r.newService+r.reactivated },
    { key:"sh", color:"#8b5cf6", fn: r=>r.supplyHours }
  ];
  cities.forEach(city => {
    metrics.forEach(m => {
      const pVals = getPartnerVals(partner, city, dates, m.fn);
      const cVals = getCityVals(city, dates, m.fn);
      buildMiniChart(`mc_${city}_${m.key}`, dates, pVals, cVals, m.color);
    });
  });
}

// ── SLIDE 2: TENDENCIA ────────────────────────────────────────────────────────
function buildSlide2(partner, from, to, mode) {
  const es     = PRESENT_STATE.lang === "es";
  const metrics = [
    { key:"ad", label: es?"Conductores Activos":"Active Drivers",   color:"#FF0000" },
    { key:"nr", label: es?"Nuevos + Reactivados":"New+Reactivated", color:"#f97316" },
    { key:"sh", label: es?"Horas de Conexión":"Supply Hours",        color:"#8b5cf6" }
  ];

  return `
    <div style="width:100%;height:100%;background:#fff;padding:16px 20px;display:flex;flex-direction:column;overflow:hidden">
      <div style="font-weight:900;font-size:.9rem;color:#111;margin-bottom:2px">
        ${partner} <span style="color:#aaa;font-weight:400;font-size:.72rem">· ${es?"Tendencia — Últimas semanas":"Trend — Last weeks"}</span>
      </div>
      <div style="font-size:.62rem;color:#aaa;margin-bottom:8px">${d2s(from)} → ${d2s(to)} · ${es?"puntos coloreados = WoW/MoM":"colored dots = WoW/MoM"} · <span style="color:#10b981">●</span> ${es?"positivo":"positive"} <span style="color:#FF0000">●</span> ${es?"negativo":"negative"}</div>

      <!-- Top row: 2 charts -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:0 0 46%;min-height:0">
        ${metrics.slice(0,2).map(m => `
          <div style="background:#fafafa;border-radius:10px;padding:10px;display:flex;flex-direction:column;min-height:0">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:6px">
              <div style="width:8px;height:8px;border-radius:50%;background:${m.color}"></div>
              <span style="font-size:.68rem;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.3px">${m.label}</span>
            </div>
            <div style="flex:1;min-height:0;position:relative">
              <canvas id="bc_${m.key}" style="width:100%;height:100%"></canvas>
            </div>
          </div>`).join("")}
      </div>

      <!-- Bottom row: 1 chart centered -->
      <div style="display:flex;justify-content:center;flex:0 0 46%;min-height:0;margin-top:8px">
        <div style="width:50%;background:#fafafa;border-radius:10px;padding:10px;display:flex;flex-direction:column;min-height:0">
          <div style="display:flex;align-items:center;gap:5px;margin-bottom:6px">
            <div style="width:8px;height:8px;border-radius:50%;background:${metrics[2].color}"></div>
            <span style="font-size:.68rem;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.3px">${metrics[2].label}</span>
          </div>
          <div style="flex:1;min-height:0;position:relative">
            <canvas id="bc_${metrics[2].key}" style="width:100%;height:100%"></canvas>
          </div>
        </div>
      </div>
    </div>`;
}

function buildSlide2Charts(partner, to) {
  const cities  = [...new Set(STATE.rawData.filter(r => r.partner === partner).map(r => r.city))];
  const dates   = getLast4Dates(to);
  const metrics = [
    { key:"ad", color:"#FF0000", fn: r=>r.activeDrivers },
    { key:"nr", color:"#f97316", fn: r=>r.newPartner+r.newService+r.reactivated },
    { key:"sh", color:"#8b5cf6", fn: r=>r.supplyHours }
  ];

  metrics.forEach(m => {
    const pTotal = dates.map(d =>
      STATE.rawData.filter(r => r.partner===partner && r.date===d)
        .reduce((s,r)=>s+m.fn(r),0)
    );
    const cityDatasets = cities.map(city => {
      const cVals = getCityVals(city, dates, m.fn);
      const pMax  = Math.max(...pTotal, 1);
      const cMax  = Math.max(...cVals, 1);
      const cNorm = cVals.map(v => (v/cMax)*pMax);
      const cWoW  = getWoW(cVals);
      const col   = CITY_COLORS[city] || "#888";
      return {
        label: city,
        data: cNorm,
        borderColor: col,
        borderWidth: 1.5,
        borderDash: [5,5],
        pointRadius: 4,
        pointBackgroundColor: cWoW.map(w => wowColor(w)),
        pointBorderColor: cWoW.map(w => wowColor(w)),
        tension: 0.3,
        fill: false
      };
    });
    buildBigChart(`bc_${m.key}`, dates, pTotal, cityDatasets, m.color, partner);
  });
}

// ── SLIDE 3: RANKING ──────────────────────────────────────────────────────────
function buildSlide3(partner, from, to, mode) {
  const es       = PRESENT_STATE.lang === "es";
  const allDates = [...new Set(STATE.rawData.map(r => r.date))].sort();
  const lastDate = allDates.filter(d => d <= to).slice(-1)[0] || to;
  const cities   = [...new Set(STATE.rawData.filter(r => r.partner === partner).map(r => r.city))];

  function getRanking(city, metricFn) {
    const pm = {};
    STATE.rawData.filter(r => r.city===city && r.date===lastDate).forEach(r => {
      if (!pm[r.partner]) pm[r.partner] = 0;
      pm[r.partner] += metricFn(r);
    });
    return Object.entries(pm).map(([p,v]) => ({partner:p,val:v})).sort((a,b)=>b.val-a.val);
  }

  const metrics = [
    { label: es?"Cond. Activos":"Active Drivers",  fn: r=>r.activeDrivers },
    { label: es?"Nuevos+React":"New+Reactivated",  fn: r=>r.newPartner+r.newService+r.reactivated },
    { label: es?"Hs. Conexión":"Supply Hours",      fn: r=>r.supplyHours }
  ];

  return `
    <div style="width:100%;height:100%;background:#fff;padding:16px 20px;display:flex;flex-direction:column;overflow:hidden">
      <div style="font-weight:900;font-size:.9rem;color:#111;margin-bottom:2px">
        ${partner} <span style="color:#aaa;font-weight:400;font-size:.72rem">· ${es?"Ranking por Ciudad":"City Ranking"} · ${d2s(lastDate)}</span>
      </div>
      <div style="font-size:.62rem;color:#aaa;margin-bottom:8px">${es?"Posición vs competidores":"Position vs competitors"}</div>
      <div style="display:grid;grid-template-columns:repeat(${cities.length},1fr);gap:10px;flex:1;min-height:0">
        ${cities.map(city => {
          const col = CITY_COLORS[city] || "#888";
          return `
            <div style="border-top:3px solid ${col};padding-top:6px;display:flex;flex-direction:column;gap:6px">
              <div style="font-weight:800;font-size:.82rem;color:${col}">${city}</div>
              ${metrics.map(m => {
                const ranking = getRanking(city, m.fn);
                const idx     = ranking.findIndex(r => r.partner===partner);
                if (idx===-1) return "";
                const pos    = idx+1;
                const total  = ranking.length;
                const myVal  = ranking[idx].val;
                const prev   = idx>0 ? ranking[idx-1] : null;
                const next   = idx<ranking.length-1 ? ranking[idx+1] : null;
                const pColor = pos===1?"#f59e0b":pos<=3?"#10b981":"#555";
                const pct    = Math.round((1-(pos-1)/total)*100);
                return `
                  <div style="background:#fafafa;border-radius:6px;padding:7px 9px;flex:1">
                    <div style="font-size:.6rem;color:#aaa;font-weight:700;text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px">${m.label}</div>
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                      <span style="font-size:1.2rem;font-weight:900;color:${pColor}">#${pos}</span>
                      <span style="font-size:.65rem;color:#aaa">${es?"de":"of"} ${total}</span>
                      <span style="margin-left:auto;font-size:.62rem;background:${pColor}20;color:${pColor};padding:1px 5px;border-radius:6px;font-weight:700">Top ${100-pct+1}%</span>
                    </div>
                    <div style="background:#eee;border-radius:4px;height:3px;margin-bottom:5px">
                      <div style="background:${pColor};height:3px;border-radius:4px;width:${pct}%"></div>
                    </div>
                    ${prev?`<div style="font-size:.6rem;color:#aaa">▲ ${es?"ant":"prev"}: <strong>+${fmt(prev.val-myVal)}</strong></div>`:`<div style="font-size:.6rem;color:#f59e0b">🏆 ${es?"Líder":"Leader"}</div>`}
                    ${next?`<div style="font-size:.6rem;color:#aaa">▼ ${es?"sig":"next"}: <strong style="color:#10b981">-${fmt(myVal-next.val)}</strong></div>`:`<div style="font-size:.6rem;color:#aaa">${es?"Último lugar":"Last place"}</div>`}
                  </div>`;
              }).join("")}
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

// ── SLIDE 4: RESUMEN EJECUTIVO ────────────────────────────────────────────────
async function renderSlide4(el, partner, from, to, mode) {
  const es   = PRESENT_STATE.lang === "es";
  const lang = PRESENT_STATE.lang;

  el.innerHTML = `
    <div style="width:100%;height:100%;background:#fff;padding:28px 32px;display:flex;flex-direction:column">
      <div style="font-weight:900;font-size:1rem;color:#111;margin-bottom:16px">
        ${partner} <span style="color:#aaa;font-weight:400;font-size:.8rem">· ${es?"Resumen Ejecutivo":"Executive Summary"}</span>
      </div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center">
        <div style="text-align:center;color:#aaa">
          <div class="spinner" style="margin:0 auto 12px"></div>
          <div style="font-size:.85rem">${es?"Generando resumen con IA...":"Generating AI summary..."}</div>
        </div>
      </div>
    </div>`;

  if (PRESENT_STATE.aiSummary[lang]) {
    showAISummary(el, partner, PRESENT_STATE.aiSummary[lang], lang);
    return;
  }

  const allDates = [...new Set(STATE.rawData.map(r => r.date))].sort();
  const lastDate = allDates.filter(d => d <= to).slice(-1)[0] || to;
  const prevIdx  = allDates.indexOf(lastDate);
  const prevDate = prevIdx > 0 ? allDates[prevIdx-1] : "";
  const cities   = [...new Set(STATE.rawData.filter(r => r.partner === partner).map(r => r.city))];

  const cityData = cities.map(city => {
    const pL = STATE.rawData.filter(r => r.partner===partner && r.city===city && r.date===lastDate);
    const pP = STATE.rawData.filter(r => r.partner===partner && r.city===city && r.date===prevDate);
    return {
      city,
      lAD: pL.reduce((s,r)=>s+r.activeDrivers,0), pAD: pP.reduce((s,r)=>s+r.activeDrivers,0),
      lNR: pL.reduce((s,r)=>s+r.newPartner+r.newService+r.reactivated,0),
      pNR: pP.reduce((s,r)=>s+r.newPartner+r.newService+r.reactivated,0),
      lSH: pL.reduce((s,r)=>s+r.supplyHours,0), pSH: pP.reduce((s,r)=>s+r.supplyHours,0),
      rAD: getRankPos(city,partner,r=>r.activeDrivers,lastDate),
      rNR: getRankPos(city,partner,r=>r.newPartner+r.newService+r.reactivated,lastDate),
      rSH: getRankPos(city,partner,r=>r.supplyHours,lastDate)
    };
  });

  const modeStr = mode==="mensual"?(es?"mensual":"monthly"):(es?"semanal":"weekly");
  const prompt  = lang==="es"
    ? `Eres un analista de operaciones de Yango Peru. Genera un resumen ejecutivo CONCISO (máximo 5 bullets) para presentar al partner "${partner}" sobre su rendimiento ${modeStr} al ${d2s(lastDate)}. Datos: ${JSON.stringify(cityData)}. Incluye: puntos fuertes, áreas de mejora, y una recomendación accionable. Solo bullets, sin intro.`
    : `You are a Yango Peru operations analyst. Generate a CONCISE executive summary (max 5 bullets) for partner "${partner}" about their ${modeStr} performance as of ${d2s(lastDate)}. Data: ${JSON.stringify(cityData)}. Strengths, improvements, one recommendation. Only bullets.`;

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ prompt })
    });
    const data = await response.json();
    PRESENT_STATE.aiSummary[lang] = data.text || "";
    showAISummary(el, partner, PRESENT_STATE.aiSummary[lang], lang);
  } catch(err) {
    el.innerHTML = `<div style="padding:28px;color:#FF0000">${es?"Error al generar resumen.":"Error generating summary."}</div>`;
  }
}

function getRankPos(city, partner, metricFn, lastDate) {
  const pm = {};
  STATE.rawData.filter(r => r.city===city && r.date===lastDate).forEach(r => {
    if (!pm[r.partner]) pm[r.partner] = 0;
    pm[r.partner] += metricFn(r);
  });
  const sorted = Object.entries(pm).sort((a,b)=>b[1]-a[1]);
  const idx = sorted.findIndex(([p]) => p===partner);
  return { pos: idx+1, total: sorted.length };
}

function showAISummary(el, partner, text, lang) {
  const es    = lang === "es";
  const lines = text.split("\n").filter(l => l.trim());
  el.innerHTML = `
    <div style="width:100%;height:100%;background:linear-gradient(135deg,#fff 0%,#fafafa 100%);padding:28px 32px;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <div style="width:36px;height:36px;background:#FF000015;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.1rem">🎯</div>
        <div>
          <div style="font-weight:900;font-size:1rem;color:#111">${partner}</div>
          <div style="font-size:.72rem;color:#aaa">${es?"Resumen Ejecutivo · Generado con IA":"Executive Summary · AI Generated"}</div>
        </div>
        <button onclick="regenerateSummary()" style="margin-left:auto;padding:5px 12px;border-radius:6px;font-size:.72rem;font-weight:600;border:1px solid #e5e5e5;background:#fff;cursor:pointer;color:#555">
          ${es?"↺ Regenerar":"↺ Regenerate"}
        </button>
      </div>
      <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px">
        ${lines.map(line => {
          const clean = line.replace(/^[-•*]\s*/,"").replace(/\*\*/g,"");
          return `<div style="display:flex;gap:10px;padding:10px 14px;background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.05);border-left:3px solid #FF0000">
            <span style="color:#FF0000;font-size:.9rem;flex-shrink:0">●</span>
            <span style="font-size:.82rem;color:#333;line-height:1.5">${clean}</span>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

function regenerateSummary() {
  PRESENT_STATE.aiSummary = { es: null, en: null };
  renderPresent();
}

// ── SLIDE 5: COMPARATIVO CIUDAD VS PARTNER ───────────────────────────────────
function buildSlide5(partner, from, to, mode) {
  const es      = PRESENT_STATE.lang === "es";
  const col     = STATE.partnerColors[partner] || "#FF0000";
  const dates   = getLast4Dates(to);
  const cities  = [...new Set(STATE.rawData.filter(r => r.partner === partner).map(r => r.city))].sort();

  const metrics = [
    { key: "ad", label: es ? "Conductores Activos" : "Active Drivers",    fn: r => r.activeDrivers },
    { key: "nr", label: es ? "Nuevos + Reactivados" : "New + Reactivated", fn: r => r.newPartner + r.newService + r.reactivated },
    { key: "sh", label: es ? "Horas de Conexión" : "Supply Hours",         fn: r => r.supplyHours }
  ];

  function wowStr(vals, idx) {
    if (idx === 0 || !vals[idx - 1]) return `<span style="color:#aaa">–</span>`;
    const pct = ((vals[idx] - vals[idx - 1]) / vals[idx - 1]) * 100;
    const col = pct > 0 ? "#10b981" : pct < 0 ? "#FF0000" : "#888";
    const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
    return `<span style="color:${col};font-weight:700">${arrow}${pct.toFixed(1)}%</span>`;
  }

  function vsIcon(pVals, cVals, idx) {
    if (idx === 0 || !pVals[idx-1] || !cVals[idx-1]) return "";
    const pPct = ((pVals[idx] - pVals[idx-1]) / pVals[idx-1]) * 100;
    const cPct = ((cVals[idx] - cVals[idx-1]) / cVals[idx-1]) * 100;
    if (pPct >= cPct) return `<span style="color:#10b981;font-size:.8rem" title="Partner supera ciudad">✓</span>`;
    return `<span style="color:#FF0000;font-size:.8rem" title="Partner por debajo de ciudad">✗</span>`;
  }

  let cityTables = cities.slice(0, 3).map(city => {
    const rows = metrics.map(m => {
      const pVals = getPartnerVals(partner, city, dates, m.fn);
      const cVals = getCityVals(city, dates, m.fn);
      const cells = dates.map((d, i) => `
        <td style="text-align:center;padding:5px 8px;font-size:.72rem;border-bottom:1px solid #f5f5f5">
          <div style="font-size:.65rem;color:#bbb;margin-bottom:2px">${d2s(d)}</div>
          <div>${wowStr(pVals, i)}</div>
          <div style="color:#aaa;font-size:.65rem">Ciudad: ${wowStr(cVals, i)} ${vsIcon(pVals, cVals, i)}</div>
        </td>`).join("");
      return `<tr>
        <td style="font-size:.72rem;font-weight:600;color:#555;padding:5px 10px;white-space:nowrap;border-bottom:1px solid #f5f5f5">${m.label}</td>
        ${cells}
      </tr>`;
    }).join("");

    const cityColor = CITY_COLORS[city] || "#888";
    return `
      <div style="flex:1;min-width:0">
        <div style="font-size:.8rem;font-weight:700;color:${cityColor};margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:50%;background:${cityColor};display:inline-block"></span>
          ${city}
        </div>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
          <colgroup><col style="width:38%"/>${dates.map(()=>'<col/>').join("")}</colgroup>
          ${rows}
        </table>
      </div>`;
  }).join("");

  return `
    <div style="width:100%;height:100%;background:#f9f9fb;padding:24px 28px;display:flex;flex-direction:column;font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <div style="width:32px;height:32px;background:${col}20;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1rem">📊</div>
        <div>
          <div style="font-weight:900;font-size:.95rem;color:#111">${partner}</div>
          <div style="font-size:.72rem;color:#aaa">${es ? "Comparativo WoW vs Ciudad · últimas " + dates.length + " semanas" : "WoW Comparison vs City · last " + dates.length + " periods"}</div>
        </div>
        <div style="margin-left:auto;font-size:.68rem;color:#bbb;text-align:right">
          ✓ <span style="color:#10b981">${es?"Partner supera ciudad":"Partner above city"}</span> &nbsp;
          ✗ <span style="color:#FF0000">${es?"Partner por debajo":"Partner below city"}</span>
        </div>
      </div>
      <div style="display:flex;gap:14px;flex:1;align-items:flex-start">
        ${cityTables || `<div style="color:#aaa;font-size:.85rem">${es?"Sin datos de ciudad disponibles.":"No city data available."}</div>`}
      </div>
    </div>`;
}

// ── PDF DOWNLOAD ──────────────────────────────────────────────────────────────
async function downloadPresentPDF() {
  destroyPresentCharts();
  await new Promise(r => setTimeout(r, 100));

  const partner = PRESENT_STATE.partner || STATE.allPartners[0];
  const from    = document.getElementById("dateFrom").value;
  const to      = document.getElementById("dateTo").value;
  const mode    = STATE.curMode;
  const lang    = PRESENT_STATE.lang;
  const es      = lang === "es";
  const slideNames = es ? SLIDE_NAMES_ES : SLIDE_NAMES_EN;

  const prog = document.createElement("div");
  prog.style.cssText = "position:fixed;inset:0;background:rgba(255,255,255,.95);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px";
  prog.innerHTML = `
    <div style="width:36px;height:36px;border:4px solid #eee;border-top-color:#FF0000;border-radius:50%;animation:spin .7s linear infinite"></div>
    <div id="progMsg" style="font-weight:700;color:#333;font-size:.95rem">${es?"Preparando PDF...":"Preparing PDF..."}</div>
    <div style="width:300px;height:8px;background:#f0f0f0;border-radius:20px;overflow:hidden">
      <div id="progBar" style="height:100%;width:0%;background:#FF0000;border-radius:20px;transition:width .3s"></div>
    </div>
    <div id="progPct" style="font-size:.8rem;color:#aaa">0%</div>`;
  document.body.appendChild(prog);

  function setProgress(pct, msg) {
    document.getElementById("progBar").style.width = pct + "%";
    document.getElementById("progPct").textContent = pct + "%";
    if (msg) document.getElementById("progMsg").textContent = msg;
  }

  try {
    setProgress(5, es?"Generando resumen IA...":"Generating AI summary...");

    if (!PRESENT_STATE.aiSummary[lang]) {
      const allDates = [...new Set(STATE.rawData.map(r => r.date))].sort();
      const lastDate = allDates.filter(d => d <= to).slice(-1)[0] || to;
      const prevIdx  = allDates.indexOf(lastDate);
      const prevDate = prevIdx > 0 ? allDates[prevIdx-1] : "";
      const cities   = [...new Set(STATE.rawData.filter(r => r.partner===partner).map(r => r.city))];
      const cityData = cities.map(city => {
        const pL = STATE.rawData.filter(r => r.partner===partner && r.city===city && r.date===lastDate);
        const pP = STATE.rawData.filter(r => r.partner===partner && r.city===city && r.date===prevDate);
        return {
          city,
          lAD: pL.reduce((s,r)=>s+r.activeDrivers,0), pAD: pP.reduce((s,r)=>s+r.activeDrivers,0),
          lNR: pL.reduce((s,r)=>s+r.newPartner+r.newService+r.reactivated,0),
          pNR: pP.reduce((s,r)=>s+r.newPartner+r.newService+r.reactivated,0),
          lSH: pL.reduce((s,r)=>s+r.supplyHours,0), pSH: pP.reduce((s,r)=>s+r.supplyHours,0),
          rAD: getRankPos(city,partner,r=>r.activeDrivers,lastDate),
          rNR: getRankPos(city,partner,r=>r.newPartner+r.newService+r.reactivated,lastDate),
          rSH: getRankPos(city,partner,r=>r.supplyHours,lastDate)
        };
      });
      const modeStr = mode==="mensual"?(es?"mensual":"monthly"):(es?"semanal":"weekly");
      const prompt = lang==="es"
        ? `Eres un analista de Yango Peru. 5 bullets concisos para "${partner}" sobre su rendimiento ${modeStr} al ${d2s(lastDate)}. Datos: ${JSON.stringify(cityData)}. Solo bullets.`
        : `Yango Peru analyst. 5 concise bullets for "${partner}" ${modeStr} performance as of ${d2s(lastDate)}. Data: ${JSON.stringify(cityData)}. Only bullets.`;
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-summary`, {
          method:"POST",
          headers:{"Content-Type":"application/json","Authorization":`Bearer ${SUPABASE_ANON_KEY}`},
          body: JSON.stringify({ prompt })
        });
        const d = await r.json();
        PRESENT_STATE.aiSummary[lang] = d.text || (es?"No se pudo generar.":"Could not generate.");
      } catch(e) {
        PRESENT_STATE.aiSummary[lang] = es?"• No se pudo generar el resumen.":"• Could not generate summary.";
      }
    }

    const aiText = PRESENT_STATE.aiSummary[lang] || "";
    const lines  = aiText.split("\n").filter(l => l.trim());

    const s4html = `
      <div style="width:100%;height:100%;background:#fff;padding:48px 56px;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px">
          <div style="width:36px;height:36px;background:#FF000015;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.1rem">🎯</div>
          <div>
            <div style="font-weight:900;font-size:1.1rem;color:#111">${partner}</div>
            <div style="font-size:.8rem;color:#aaa">${es?"Resumen Ejecutivo":"Executive Summary"}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${lines.map(line => {
            const clean = line.replace(/^[-•*]\s*/,"").replace(/\*\*/g,"");
            return `<div style="display:flex;gap:12px;padding:12px 16px;background:#fff;border-radius:8px;border:1px solid #f0f0f0;border-left:3px solid #FF0000">
              <span style="color:#FF0000;font-size:1rem;flex-shrink:0">●</span>
              <span style="font-size:.9rem;color:#333;line-height:1.6">${clean}</span>
            </div>`;
          }).join("")}
        </div>
      </div>`;

    const allSlides = [
      { html: buildSlide0(partner,from,to,mode), hasCharts:false, chartFn:null, name:slideNames[0] },
      { html: buildSlide1(partner,from,to,mode), hasCharts:true,  chartFn:()=>buildSlide1Charts(partner,to), name:slideNames[1] },
      { html: buildSlide2(partner,from,to,mode), hasCharts:true,  chartFn:()=>buildSlide2Charts(partner,to), name:slideNames[2] },
      { html: buildSlide3(partner,from,to,mode), hasCharts:false, chartFn:null, name:slideNames[3] },
      { html: s4html,                            hasCharts:false, chartFn:null, name:slideNames[4] },
      { html: buildSlide5(partner,from,to,mode), hasCharts:false, chartFn:null, name:slideNames[5] }
    ];

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation:"landscape", unit:"px", format:[1280,720] });
    let pageNum = 0;

    for (let i = 0; i < allSlides.length; i++) {
      const s = allSlides[i];
      setProgress(15 + Math.round(i * (85 / allSlides.length)), `${es?"Renderizando":"Rendering"}: ${s.name}...`);

const div = document.createElement("div");
      if (s.hasCharts) {
        div.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:720px;overflow:hidden;background:#fff;z-index:99998;";
      } else {
        div.style.cssText = "position:fixed;left:-9999px;top:0;width:1280px;height:720px;overflow:hidden;background:#fff;";
      }
      div.innerHTML = s.html;
      document.body.appendChild(div);
      await new Promise(r => setTimeout(r, 300));

     if (s.hasCharts && s.chartFn) {
        s.chartFn();
        const waitTime = i === 1 ? 4000 : 2500;
        await new Promise(r => setTimeout(r, waitTime));
      }

      const canvas = await html2canvas(div, { width:1280, height:720, scale:1.5, useCORS:true, logging:false });

      if (s.hasCharts) {
        div.querySelectorAll("canvas").forEach(c => { const ch = Chart.getChart(c); if(ch) ch.destroy(); });
      }
      document.body.removeChild(div);

      if (pageNum > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 1280, 720);
      pageNum++;
      setProgress(15 + Math.round((i+1) * (85 / allSlides.length)), `${s.name} ✓`);
    }

    setProgress(100, es?"¡Listo! Descargando...":"Done! Downloading...");
    await new Promise(r => setTimeout(r, 400));
    pdf.save(`${partner}_${mode==="mensual"?"Mensual":"Semanal"}_${to}.pdf`);

  } catch(err) {
    console.error(err);
    alert(es?"Error al generar PDF: "+err.message:"Error generating PDF: "+err.message);
  }

  document.body.removeChild(prog);
}