// rendimiento.js — Pestaña Rendimiento

function renderRend() {
  if (!STATE.rawData.length) return;

  // Destruir charts existentes ANTES de borrar sus DIVs con innerHTML
  // (evita instancias huérfanas y memory leak en cada re-render)
  destroyAllCharts();

  const filtered  = getFiltered();
  const apd       = aggPDc(filtered);
  const byDate    = aggDatec(filtered);
  const dates     = [...new Set(apd.map(r => r.date))].sort();
  const partners  = getSel();
  const empty     = document.getElementById("rendEmpty");
  const content   = document.getElementById("rendContent");

  if (!partners.length || !filtered.length) {
    empty.style.display   = "";
    content.style.display = "none";
    return;
  }
  empty.style.display   = "none";
  content.style.display = "";

  // Cachear filtered por ciudad (se usa 3 veces: secciones 2, 4 y los charts)
  const filteredByCity = {};
  CITIES.forEach(city => {
    filteredByCity[city] = filtered.filter(r => r.city === city);
  });

  // lastDate = fecha "Hasta" del filtro
  const toDate   = document.getElementById("dateTo").value;
  const lastDate = dates.filter(d => d <= toDate).slice(-1)[0] || dates[dates.length - 1] || "";

  // prevDate = semana inmediatamente anterior a lastDate en TODOS los datos
  const allDates = STATE.allDates;
  const lastIdx  = allDates.indexOf(lastDate);
  const prevDate = lastIdx > 0 ? allDates[lastIdx - 1] : "";

  // prevRows: datos de prevDate fuera del rango filtrado
  const cityFilter = document.getElementById("cityFilter").value;
  const selSet     = new Set(getSel());
  const _prevAll = STATE._byDate?.get(prevDate) || [];
  const prevFiltered = _prevAll.filter(r =>
    (cityFilter === "all" || r.city === cityFilter) &&
    selSet.has(r.partner)
  );
  const prevAPD = aggPD(prevFiltered);

  const lastRows = apd.filter(r => r.date === lastDate);
  const prevRows = prevAPD;

  const tAD = sumR(lastRows, r => r.activeDrivers);
  const pAD = sumR(prevRows, r => r.activeDrivers);
  const tNR = sumR(apd,      r => r.newPartner + r.newService + r.reactivated);
  const lNR = sumR(lastRows, r => r.newPartner + r.newService + r.reactivated);
  const pNR = sumR(prevRows, r => r.newPartner + r.newService + r.reactivated);
  const tSH = sumR(apd,      r => r.supplyHours);
  const lSH = sumR(lastRows, r => r.supplyHours);
  const pSH = sumR(prevRows, r => r.supplyHours);

  let html = modeToggleHTML();

  // ── 1. Peru General ────────────────────────────────────────────────────────
  html += secH("🇵🇪", "#FF0000",
    "Peru - Vista General",
    "Activos: última semana  |  N+R y Horas: acumulado del rango",
    d2s(lastDate));
  html += `<div class="section"><div class="metric-row">
    ${mkMetricCard("Conductores Activos","📊",tAD,pAD,apd,lastRows,prevRows,"ad","#FF0000",false)}
    ${mkMetricCard("Nuevos + Reactivados","🆕",tNR,lNR,apd,lastRows,prevRows,"nr","#f97316",true)}
    ${mkMetricCard("Horas de Conexion","⏱️",tSH,lSH,apd,lastRows,prevRows,"sh","#8b5cf6",true)}
  </div></div>`;

  // ── 2. Por Ciudad ──────────────────────────────────────────────────────────
  html += secH("🏙️", "#06b6d4", "Por Ciudad", "Rendimiento y comparativo WoW", "");
  html += `<div class="section"><div class="city-grid">`;
  CITIES.forEach(city => {
    const cr = filteredByCity[city];
    if (!cr.length) return;
    const ca   = aggPD(cr);
    const cL   = ca.filter(r => r.date === lastDate);
    // prevDate para ciudad: lookup O(1) por _byCityDate
    const cPraw = (STATE._byCityDate?.get(`${city}|||${prevDate}`) || [])
      .filter(r => selSet.has(r.partner));
    const cP   = aggPD(cPraw);
    const cAD  = sumR(cL,  r => r.activeDrivers);
    const cNR  = sumR(cL,  r => r.newPartner + r.newService + r.reactivated);
    const cSH  = sumR(cL,  r => r.supplyHours);
    const cpAD = sumR(cP,  r => r.activeDrivers);
    const cpNR = sumR(cP,  r => r.newPartner + r.newService + r.reactivated);
    const cpSH = sumR(cP,  r => r.supplyHours);
    const col  = CITY_COLORS[city] || "#888";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${city}
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">Conductores Activos</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmt(cAD)}</span>${bdg(cAD,cpAD,"mb-badge")}</div>
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">Nuevos + Reactivados</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmt(cNR)}</span>${bdg(cNR,cpNR,"mb-badge")}</div>
        </div>
        <div class="city-kpi">
          <span class="city-kpi-label">Horas de Conexion</span>
          <div class="city-kpi-right"><span class="city-kpi-val">${fmt(cSH)}</span>${bdg(cSH,cpSH,"mb-badge")}</div>
        </div>
      </div>`;
  });
  html += `</div></div>`;

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  html += secH("👤", "#f59e0b", "Por KAM", "Rendimiento por responsable", "");
  html += `<div class="section"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">`;
  [...new Set(Object.values(STATE.KAM_MAP))].sort().forEach(kam => {
    const kpSet = new Set(STATE.KAM_PARTNERS[kam] || []);
    const kL  = lastRows.filter(r => kpSet.has(r.partner));
    const kP  = prevRows.filter(r => kpSet.has(r.partner));
    if (!kL.length) return;
    const kAD  = sumR(kL, r => r.activeDrivers);
    const kNR  = sumR(kL, r => r.newPartner + r.newService + r.reactivated);
    const kSH  = sumR(kL, r => r.supplyHours);
    const kpAD = sumR(kP, r => r.activeDrivers);
    const kpNR = sumR(kP, r => r.newPartner + r.newService + r.reactivated);
    const col  = KAM_COLORS[kam] || "#888";
    html += `
      <div class="mcard" style="border-left:3px solid ${col}">
        <div class="mcard-label"><span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block"></span> ${kam}</div>
        <div class="mcard-val">${fmt(kAD)}</div>
        <div>${bdg(kAD,kpAD)} <span style="font-size:.72rem;color:#aaa;margin-left:5px">Activos</span></div>
        <div class="mcard-breakdown">
          <div class="mb-row"><span class="mb-name">N+R</span><span class="mb-val">${fmt(kNR)}</span>${bdg(kNR,kpNR,"mb-badge")}</div>
          <div class="mb-row"><span class="mb-name">Hs. Conexion</span><span class="mb-val">${fmt(kSH)}</span></div>
        </div>
      </div>`;
  });
  html += `</div></div>`;

  // ── 4. Tendencias ─────────────────────────────────────────────────────────
  html += secH("📈", "#10b981", "Tendencias", "Peru y ciudades · 3 KPIs principales", "");
  html += `<div class="section">`;
  html += `<div style="font-weight:700;font-size:.78rem;color:#666;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">Peru Total</div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Conductores Activos</span><button class="png-btn" onclick="dlChart('chP_ad','AD_Peru')">PNG</button></div><div id="chP_ad"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Nuevos + Reactivados</span><button class="png-btn" onclick="dlChart('chP_nr','NR_Peru')">PNG</button></div><div id="chP_nr"></div></div>
    <div class="chart-card"><div class="chart-head"><span class="chart-title">Horas de Conexion</span><button class="png-btn" onclick="dlChart('chP_sh','SH_Peru')">PNG</button></div><div id="chP_sh"></div></div>
  </div>`;
  CITIES.forEach(city => {
    const cr = filteredByCity[city];
    if (!cr.length) return;
    const cid = city.toLowerCase();
    const col = CITY_COLORS[city] || "#888";
    html += `<div style="font-weight:700;font-size:.78rem;color:${col};margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">${city}</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
      <div class="chart-card"><div class="chart-head"><span class="chart-title">Conductores Activos</span><button class="png-btn" onclick="dlChart('ch_${cid}_ad','AD_${city}')">PNG</button></div><div id="ch_${cid}_ad"></div></div>
      <div class="chart-card"><div class="chart-head"><span class="chart-title">Nuevos + Reactivados</span><button class="png-btn" onclick="dlChart('ch_${cid}_nr','NR_${city}')">PNG</button></div><div id="ch_${cid}_nr"></div></div>
      <div class="chart-card"><div class="chart-head"><span class="chart-title">Horas de Conexion</span><button class="png-btn" onclick="dlChart('ch_${cid}_sh','SH_${city}')">PNG</button></div><div id="ch_${cid}_sh"></div></div>
    </div>`;
  });
  html += `</div>`;

  // ── 5. Tabla ───────────────────────────────────────────────────────────────
  // Resumen de leads Yango para el encabezado
  const leadsSet  = new Set(apd.filter(r => r.date === lastDate && r.newService > 0).map(r => r.partner));
  const leadsNote = leadsSet.size > 0
    ? `<div class="leads-summary">★ ${leadsSet.size} partner${leadsSet.size > 1 ? "s reciben" : " recibe"} leads de Yango esta semana</div>`
    : "";
  html += secH("📋", "#6366f1", "Tabla de Partners", "Click en columna para ordenar", "");
  html += `<div class="section">${leadsNote}<div class="tbl-wrap"><div id="tblContainer"></div></div></div>`;

  // ── 6. Tarjetas por Partner ────────────────────────────────────────────────
  html += secH("🃏", "#FF0000", "KPIs por Partner", "Detalle del último período", "");
  html += `<div class="section"><div class="partner-grid" id="partnerCards"></div></div>`;

  content.innerHTML = html;

  buildMultiLine("chP_ad", dates, partners, byDate, "ad", "#FF0000");
  buildMultiLine("chP_nr", dates, partners, byDate, "nr", "#f97316");
  buildMultiLine("chP_sh", dates, partners, byDate, "sh", "#8b5cf6");

  CITIES.forEach(city => {
    const cr = filteredByCity[city];
    if (!cr.length) return;
    const cid = city.toLowerCase();
    const col = CITY_COLORS[city] || "#888";
    const cbd = aggCityDatec(cr, city);
    buildSingleLine(`ch_${cid}_ad`, dates, cbd, "ad", col, city);
    buildSingleLine(`ch_${cid}_nr`, dates, cbd, "nr", col, city);
    buildSingleLine(`ch_${cid}_sh`, dates, cbd, "sh", col, city);
  });

  buildTable(apd, lastDate, prevDate, partners);
  buildPartnerCards(apd, lastDate, prevDate, partners, partners);
}

// ── METRIC CARD ───────────────────────────────────────────────────────────────
function mkMetricCard(label, icon, val, prevWk, apd, lastRows, prevRows, metric, color, isCum) {
  function gv(rows) {
    if (metric === "nr") return sumR(rows, r => r.newPartner + r.newService + r.reactivated);
    if (metric === "sh") return sumR(rows, r => r.supplyHours);
    return sumR(rows, r => r.activeDrivers);
  }
  const lwVal = gv(lastRows);
  const pwVal = gv(prevRows);

  let html = `
    <div class="mcard" style="border-top:3px solid ${color}">
      <div class="mcard-label">${icon} ${label}</div>
      <div class="mcard-sub-label">${isCum ? "acumulado rango" : "última semana"}</div>
      <div class="mcard-val">${fmt(val)}</div>
      <div style="margin-top:4px">${bdg(lwVal, pwVal)}
        <span style="font-size:.7rem;color:#bbb;margin-left:5px">vs ${STATE.curMode === 'mensual' ? 'mes' : 'sem.'} anterior</span>
      </div>
      <div class="mcard-breakdown">`;

  [...new Set(Object.values(STATE.KAM_MAP))].sort().forEach(kam => {
    const kpSet = new Set(STATE.KAM_PARTNERS[kam] || []);
    const kl   = lastRows.filter(r => kpSet.has(r.partner));
    const kAll = apd.filter(r => kpSet.has(r.partner));
    const kpr  = prevRows.filter(r => kpSet.has(r.partner));
    if (!kl.length && !kAll.length) return;
    const kv  = gv(kl, kAll);
    const kpv = gv(kpr, kpr);
    if (!kv) return;
    const dot = KAM_COLORS[kam] || "#888";
    html += `<div class="mb-row">
      <span class="mb-name"><span class="mb-dot" style="background:${dot}"></span>${kam}</span>
      <span class="mb-val">${fmt(kv)}</span>${bdg(kv, kpv, "mb-badge")}
    </div>`;
  });

  html += `</div></div>`;
  return html;
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
function buildTable(apd, lastDate, prevDate, sel) {
  const selSet = new Set(sel);
  const lR    = apd.filter(r => r.date === lastDate);
  const pRraw = (STATE._byDate?.get(prevDate) || []).filter(r => selSet.has(r.partner));
  const pR    = aggPD(pRraw);
  // Use full history (all dates) for decline detection, ignoring date range filter
  if (!STATE._apdFull) {
    STATE._apdFull = aggPD(STATE.rawData);
  }
  const apdFull = STATE._apdFull.filter(r => selSet.has(r.partner));
  const partners = [...new Set(apd.map(r => r.partner))];

  const apdByPartner = new Map();
  apdFull.forEach(r => {
    if (!apdByPartner.has(r.partner)) apdByPartner.set(r.partner, []);
    apdByPartner.get(r.partner).push(r);
  });

  STATE.curSummaries = partners.map(p => {
    const l    = lR.filter(r => r.partner === p);
    const pr   = pR.filter(r => r.partner === p);
    const rows = apd.filter(r => r.partner === p).sort((a, b) => a.date.localeCompare(b.date));
    return {
      partner:      p,
      kam:          (l[0] || {}).kam || "",
      ad:           sumR(l,  r => r.activeDrivers),
      nr:           sumR(l,  r => r.newPartner + r.newService + r.reactivated),
      sh:           sumR(l,  r => r.supplyHours),
      co:           sumR(l,  r => r.commission),
      ns:           sumR(l,  r => r.newService),
      pad:          sumR(pr, r => r.activeDrivers),
      pnr:          sumR(pr, r => r.newPartner + r.newService + r.reactivated),
      tAD:          trendI(rows.map(r => r.activeDrivers)),
      declineAlert: hasConsecutiveDecline(apdByPartner, p)
    };
  });
  renderTable();
}

function renderTable() {
  const sorted = STATE.curSummaries.slice().sort((a, b) => {
    const va = a[STATE.tblSort.col], vb = b[STATE.tblSort.col];
    if (typeof va === "string")
      return STATE.tblSort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return STATE.tblSort.dir === "asc" ? va - vb : vb - va;
  });

  const cols = [
    { k: "partner", l: "Partner" }, { k: "kam", l: "KAM" },
    { k: "ad", l: "Cond. Activos" }, { k: "nr", l: "Nuevos+React" },
    { k: "sh", l: "Hs. Conexion" },  { k: "co", l: "Comision" },
    { k: "ns", l: "Leads Yango" }
  ];

  let h = `<table class="dtbl"><thead><tr>`;
  cols.forEach(c => {
    const s = STATE.tblSort.col === c.k ? (STATE.tblSort.dir === "asc" ? "sa" : "sd") : "";
    h += `<th class="${s}" onclick="sortTbl('${c.k}')">${c.l}</th>`;
  });
  h += `<th>WoW</th><th>Tend.</th></tr></thead><tbody>`;

  sorted.forEach(r => {
    const pd      = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${STATE.partnerColors[r.partner]||"#ccc"};margin-right:5px"></span>`;
    const kd      = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${KAM_COLORS[r.kam]||"#ccc"};margin-right:4px"></span>`;
    const alertBd = r.declineAlert
      ? `<span class="decline-badge" title="Declive ${STATE.declineThreshold} períodos consecutivos (${STATE.declineMetric === 'activeDrivers' ? 'Activos' : STATE.declineMetric === 'supplyHours' ? 'Horas' : 'N+R'})">⚠</span>`
      : "";
    const nsCell  = r.ns > 0
      ? `<span class="leads-badge" title="Recibe leads de Yango">★ ${fmt(r.ns)}</span>`
      : `<span style="color:#ccc">${fmt(r.ns)}</span>`;
    h += `<tr data-partner="${r.partner}"${r.ns > 0 ? ' class="leads-row"' : ""}>
      <td>${pd}${alertBd}${r.partner}</td><td>${kd}${r.kam}</td>
      <td class="tn">${fmt(r.ad)}</td><td class="tn">${fmt(r.nr)}</td>
      <td class="tn">${fmt(r.sh)}</td><td class="tn">${fmtK(r.co)}</td>
      <td class="tn">${nsCell}</td>
      <td class="tn">${bdg(r.ad, r.pad, "tbadge")}</td>
      <td style="text-align:center;font-size:.85rem"><span style="${r.tAD.c}">${r.tAD.i}</span></td>
    </tr>`;
  });
  h += `</tbody></table>`;
  const el = document.getElementById("tblContainer");
  if (el) el.innerHTML = h;
}

function sortTbl(col) {
  if (STATE.tblSort.col === col)
    STATE.tblSort.dir = STATE.tblSort.dir === "asc" ? "desc" : "asc";
  else { STATE.tblSort.col = col; STATE.tblSort.dir = "desc"; }

  // Intentar reordenar filas existentes sin reconstruir el HTML
  const tbody = document.querySelector("#tblContainer tbody");
  if (!tbody || !STATE.curSummaries.length) { renderTable(); return; }

  const dir = STATE.tblSort.dir === "asc" ? 1 : -1;
  const k   = STATE.tblSort.col;
  const sorted = STATE.curSummaries.slice().sort((a, b) => {
    const av = a[k], bv = b[k];
    return (typeof av === "string" ? av.localeCompare(bv) : (av - bv)) * dir;
  });

  // Actualizar indicadores de orden en cabeceras
  const colKeys = ["partner","kam","ad","nr","sh","co","ns"];
  document.querySelectorAll("#tblContainer th").forEach((th, i) => {
    if (i < colKeys.length) {
      th.className = STATE.tblSort.col === colKeys[i]
        ? (STATE.tblSort.dir === "asc" ? "sa" : "sd") : "";
    }
  });

  // Reordenar <tr> existentes vía DocumentFragment (cero re-parse de HTML)
  const rowMap = new Map(
    [...tbody.querySelectorAll("tr")].map(tr => [tr.dataset.partner, tr])
  );
  const frag = document.createDocumentFragment();
  sorted.forEach(s => { const tr = rowMap.get(s.partner); if (tr) frag.appendChild(tr); });
  tbody.appendChild(frag);
}

// ── PARTNER CARDS ─────────────────────────────────────────────────────────────
function buildPartnerCards(apd, lastDate, prevDate, partners, sel) {
  const grid = document.getElementById("partnerCards");
  if (!grid) return;

  const selSet  = new Set(sel);
  const prevRaw = (STATE._byDate?.get(prevDate) || []).filter(r => selSet.has(r.partner));
  const prevAPD = aggPD(prevRaw);
  const frag    = document.createDocumentFragment();

  partners.forEach(partner => {
    const rows = apd.filter(r => r.partner === partner)
                    .sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return;
    const last    = rows[rows.length - 1];
    const prevRow = prevAPD.find(r => r.partner === partner) || null;
    const col     = STATE.partnerColors[partner] || "#FF0000";
    const kc      = KAM_COLORS[last.kam] || "#888";

    const lastNR = last.newPartner + last.newService + last.reactivated;
    const prevNR = prevRow ? prevRow.newPartner + prevRow.newService + prevRow.reactivated : null;
    const tA = trendI(rows.map(r => r.activeDrivers));
    const tN = trendI(rows.map(r => r.newPartner + r.newService + r.reactivated));
    const tH = trendI(rows.map(r => r.supplyHours));

    const card = document.createElement("div");
    card.className         = "pcard";
    card.style.borderLeftColor = col;
    card.innerHTML = `
      <div class="pcard-name">
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col};margin-right:5px"></span>
        ${partner}
      </div>
      <div class="pcard-sub">
        <span style="width:7px;height:7px;border-radius:50%;background:${kc};display:inline-block;margin-right:3px"></span>
        ${last.kam} &nbsp;·&nbsp; ${prevRow ? d2s(prevDate) + " → " : ""}${d2s(lastDate)}
      </div>
      <div class="pcard-kpis">
        <div class="pk">
          <div class="pk-label">Cond. Activos</div>
          <div class="pk-val">${fmt(last.activeDrivers)}</div>
          ${bdg(last.activeDrivers, prevRow?.activeDrivers ?? null, "mb-badge")}
          <span style="${tA.c}">${tA.i}</span>
        </div>
        <div class="pk">
          <div class="pk-label">Hs. Conexion</div>
          <div class="pk-val">${fmt(last.supplyHours)}</div>
          ${bdg(last.supplyHours, prevRow?.supplyHours ?? null, "mb-badge")}
          <span style="${tH.c}">${tH.i}</span>
        </div>
        <div class="pk-wide">
          <div class="pk-label">
            Nuevos + Reactivados &nbsp;
            ${bdg(lastNR, prevNR, "mb-badge")}
            <span style="${tN.c}">${tN.i}</span>
          </div>
          <div class="pk-sub-grid">
            <div>
              <div class="pk-sub-label">Partner</div>
              <div class="pk-sub-val">${fmt(last.newPartner)}</div>
              ${bdg(last.newPartner, prevRow?.newPartner ?? null, "mb-badge")}
            </div>
            <div>
              <div class="pk-sub-label">Servicio</div>
              <div class="pk-sub-val">${fmt(last.newService)}</div>
              ${bdg(last.newService, prevRow?.newService ?? null, "mb-badge")}
            </div>
            <div>
              <div class="pk-sub-label">Reactivados</div>
              <div class="pk-sub-val">${fmt(last.reactivated)}</div>
              ${bdg(last.reactivated, prevRow?.reactivated ?? null, "mb-badge")}
            </div>
          </div>
        </div>
      </div>`;
    frag.appendChild(card);
  });
  grid.appendChild(frag); // un solo reflow al final
}

// ── SECTION HEADER ─────────────────────────────────────────────────────────────
function secH(icon, bg, title, sub, tag) {
  return `<div class="sh">
    <div class="sh-icon" style="background:${bg}20">${icon}</div>
    <div>
      <div class="sh-title">${title}</div>
      <div class="sh-sub">${sub}</div>
    </div>
    ${tag ? `<span class="sh-tag">${tag}</span>` : ""}
  </div>`;
}