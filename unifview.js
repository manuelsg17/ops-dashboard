// unifview.js — Vista Unificada Rendimiento + Metas

function renderUnifView() {
  const el = document.getElementById("unifviewContent");
  if (!el) return;

  if (!STATE.rawData.length) {
    el.innerHTML = `<div class="empty"><p>Carga datos de <strong>Rendimiento</strong> para usar esta vista.</p></div>`;
    return;
  }

  const from       = document.getElementById("dateFrom").value;
  const to         = document.getElementById("dateTo").value;
  const cityFilter = document.getElementById("cityFilter").value;
  const kamFilter  = document.getElementById("kamFilter").value;
  const sel        = getSel();

  // KAM filter dropdown (local to this view)
  const kams = [...new Set(Object.values(STATE.KAM_MAP))].sort();

  // ── Build performance aggregation (same logic as metas.js) ──────────────
  const perfF = STATE.rawData.filter(r => r.date >= from && r.date <= to);
  const cpMap = {};
  perfF.forEach(r => {
    const k = `${r.partner}|||${r.city}|||${r.date}`;
    if (!cpMap[k]) cpMap[k] = { partner: r.partner, city: r.city, kam: r.kam || STATE.KAM_MAP[Object.keys(STATE.CLID_MAP).find(c => STATE.CLID_MAP[c] === r.partner)] || "", date: r.date, ad: 0, nr: 0, sh: 0 };
    cpMap[k].ad += r.activeDrivers;
    cpMap[k].nr += r.newPartner + r.newService + r.reactivated;
    cpMap[k].sh += r.supplyHours;
  });
  const cpRows = Object.values(cpMap);

  // Projection days
  const maxDate = cpRows.length ? cpRows.map(r => r.date).sort().at(-1) : to;
  const { daysElapsed, daysRemaining } = calcProjectionDays(maxDate);

  // Aggregate by partner (across all cities or filtered city)
  const partnerMap = {};
  cpRows.forEach(r => {
    if (cityFilter !== "all" && r.city !== cityFilter) return;
    if (!partnerMap[r.partner]) {
      partnerMap[r.partner] = {
        partner: r.partner,
        kam: STATE.KAM_MAP[Object.keys(STATE.CLID_MAP).find(c => STATE.CLID_MAP[c] === r.partner)] || r.kam || "",
        ad: 0, nr: 0, sh: 0,
        nrV: [], shV: [],
        lastAD: 0
      };
    }
    partnerMap[r.partner].ad += r.ad;
    partnerMap[r.partner].nr += r.nr;
    partnerMap[r.partner].sh += r.sh;
  });

  // Build per-partner date-sorted vectors for projection
  const byPartnerDate = {};
  cpRows.forEach(r => {
    if (cityFilter !== "all" && r.city !== cityFilter) return;
    const k = `${r.partner}|||${r.date}`;
    if (!byPartnerDate[k]) byPartnerDate[k] = { partner: r.partner, date: r.date, ad: 0, nr: 0, sh: 0 };
    byPartnerDate[k].ad += r.ad;
    byPartnerDate[k].nr += r.nr;
    byPartnerDate[k].sh += r.sh;
  });
  Object.values(byPartnerDate).forEach(row => {
    if (!partnerMap[row.partner]) return;
    partnerMap[row.partner].lastAD = Math.max(partnerMap[row.partner].lastAD || 0, row.ad);
  });
  // Build sorted vectors grouped by partner
  const datesSorted = [...new Set(cpRows.map(r => r.date))].sort();
  Object.keys(partnerMap).forEach(partner => {
    const pd = {};
    Object.values(byPartnerDate).filter(r => r.partner === partner).forEach(r => {
      pd[r.date] = r;
    });
    partnerMap[partner].nrV = datesSorted.map(d => pd[d]?.nr || 0).filter(v => v > 0);
    partnerMap[partner].shV = datesSorted.map(d => pd[d]?.sh || 0).filter(v => v > 0);
  });

  // ── Apply sidebar filters ─────────────────────────────────────────────────
  let rows = Object.values(partnerMap).filter(r => {
    if (kamFilter !== "all" && r.kam !== kamFilter) return false;
    if (sel.length && !sel.includes(r.partner)) return false;
    return true;
  });

  // ── Merge with metas ──────────────────────────────────────────────────────
  const metaByPartner = {};
  STATE.metasData.filter(m => {
    if (kamFilter !== "all" && m.kam !== kamFilter) return false;
    if (sel.length && !sel.includes(m.partner)) return false;
    return true;
  }).forEach(m => {
    if (!metaByPartner[m.partner]) metaByPartner[m.partner] = { mA: 0, mNR: 0, mH: 0 };
    metaByPartner[m.partner].mA  += m.mA;
    metaByPartner[m.partner].mNR += m.mNR;
    metaByPartner[m.partner].mH  += m.mH;
  });

  // Sort by partner name
  rows.sort((a, b) => a.partner.localeCompare(b.partner));

  // ── Render ────────────────────────────────────────────────────────────────
  function pCell(real, meta) {
    if (!meta) return `<td style="color:#aaa;font-size:.72rem;text-align:center">—</td>`;
    const p = (real / meta) * 100;
    const label = p > 100
      ? `<span style="color:#8b5cf6;font-weight:700">${p.toFixed(1)}% 🏆</span>`
      : `<span style="color:${pColor(p)};font-weight:700">${p.toFixed(1)}%</span>`;
    return `<td style="text-align:center;font-size:.78rem">${label}</td>`;
  }

  // KAM subtotal rows
  const kamGroups = {};
  rows.forEach(r => {
    if (!kamGroups[r.kam]) kamGroups[r.kam] = [];
    kamGroups[r.kam].push(r);
  });

  let tbody = "";
  kams.filter(k => kamGroups[k]).forEach(kam => {
    const group = kamGroups[kam];
    const col   = KAM_COLORS[kam] || "#888";
    // KAM header row
    tbody += `
      <tr style="background:${col}18;border-top:2px solid ${col}20">
        <td colspan="10" style="font-size:.78rem;font-weight:700;color:${col};padding:6px 8px">
          <span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block;margin-right:5px"></span>${kam}
          <span style="font-size:.7rem;color:#aaa;font-weight:400">(${group.length} partners)</span>
        </td>
      </tr>`;
    group.forEach(r => {
      const m   = metaByPartner[r.partner];
      const col = STATE.partnerColors[r.partner] || "#ccc";
      const projNR = projA(r.nrV, daysElapsed, daysRemaining);
      const projSH = projA(r.shV, daysElapsed, daysRemaining);
      tbody += `
        <tr class="dtbl-row">
          <td style="font-size:.78rem">
            <span style="width:7px;height:7px;border-radius:50%;background:${col};display:inline-block;margin-right:5px"></span>
            ${r.partner}
          </td>
          <td style="font-size:.78rem;text-align:right">${fmt(r.ad)}</td>
          <td style="font-size:.72rem;color:#aaa;text-align:right">${m ? fmt(m.mA) : "—"}</td>
          ${pCell(r.ad, m?.mA)}
          <td style="font-size:.78rem;text-align:right">${fmt(r.nr)}</td>
          <td style="font-size:.72rem;color:#aaa;text-align:right">${m ? fmt(m.mNR) : "—"}</td>
          ${pCell(r.nr, m?.mNR)}
          <td style="font-size:.78rem;text-align:right">${fmt(r.sh)}</td>
          <td style="font-size:.72rem;color:#aaa;text-align:right">${m ? fmt(m.mH) : "—"}</td>
          ${pCell(r.sh, m?.mH)}
        </tr>`;
    });
    // KAM total row
    const kAD  = group.reduce((s, r) => s + r.ad, 0);
    const kNR  = group.reduce((s, r) => s + r.nr, 0);
    const kSH  = group.reduce((s, r) => s + r.sh, 0);
    const kmA  = group.reduce((s, r) => s + (metaByPartner[r.partner]?.mA  || 0), 0);
    const kmNR = group.reduce((s, r) => s + (metaByPartner[r.partner]?.mNR || 0), 0);
    const kmH  = group.reduce((s, r) => s + (metaByPartner[r.partner]?.mH  || 0), 0);
    tbody += `
      <tr style="background:#f5f5f5;font-weight:700;font-size:.78rem">
        <td style="padding-left:16px;color:${col}">Total ${kam}</td>
        <td style="text-align:right">${fmt(kAD)}</td><td style="text-align:right;color:#aaa">${fmt(kmA)}</td>${pCell(kAD, kmA)}
        <td style="text-align:right">${fmt(kNR)}</td><td style="text-align:right;color:#aaa">${fmt(kmNR)}</td>${pCell(kNR, kmNR)}
        <td style="text-align:right">${fmt(kSH)}</td><td style="text-align:right;color:#aaa">${fmt(kmH)}</td>${pCell(kSH, kmH)}
      </tr>`;
  });

  el.innerHTML = `
    <div style="padding:16px">
      <div style="font-size:.85rem;font-weight:700;color:#555;margin-bottom:12px">
        📊 Rendimiento + Metas unificados
        <span style="font-size:.72rem;font-weight:400;color:#aaa;margin-left:8px">${from} → ${to}</span>
      </div>
      <div class="tbl-wrap">
        <table class="dtbl" style="min-width:700px">
          <thead>
            <tr>
              <th rowspan="2">Partner</th>
              <th colspan="3" style="text-align:center;border-bottom:1px solid #eee">Cond. Activos</th>
              <th colspan="3" style="text-align:center;border-bottom:1px solid #eee">Nuevos + React.</th>
              <th colspan="3" style="text-align:center;border-bottom:1px solid #eee">Hs. Conexión</th>
            </tr>
            <tr>
              <th style="text-align:right">Fact</th><th style="text-align:right">Plan</th><th style="text-align:center">%</th>
              <th style="text-align:right">Fact</th><th style="text-align:right">Plan</th><th style="text-align:center">%</th>
              <th style="text-align:right">Fact</th><th style="text-align:right">Plan</th><th style="text-align:center">%</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>`;
}
