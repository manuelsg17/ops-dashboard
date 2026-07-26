//@ts-nocheck
// unifview.js — Vista Unificada Rendimiento + Metas

export function renderUnifView() {
  const el = document.getElementById("unifviewContent");
  if (!el) return;

  ensureIndexes();

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
  const perfF = getFilteredByDateRange(from, to);
  const cpMap = {};
  perfF.forEach(r => {
    const k = `${r.partner}|||${r.city}|||${r.date}`;
    if (!cpMap[k]) cpMap[k] = { partner: r.partner, city: r.city, kam: r.kam || getKAMForPartner(r.partner), date: r.date, ad: 0, nr: 0, sh: 0 };
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
        kam: getKAMForPartner(r.partner) || r.kam || "",
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
    partnerMap[partner].nrV = datesSorted
      .map(d => byPartnerDate[`${partner}|||${d}`]?.nr || 0)
      .filter(v => v > 0);
    partnerMap[partner].shV = datesSorted
      .map(d => byPartnerDate[`${partner}|||${d}`]?.sh || 0)
      .filter(v => v > 0);
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
    if (!meta) return `<td class="agy-style-577">—</td>`;
    const p = (real / meta) * 100;
    const label = p > 100
      ? `<span class="agy-style-578">${p.toFixed(1)}% 🏆</span>`
      : `<span style="color:${pColor(p)};font-weight:700">${p.toFixed(1)}%</span>`;
    return `<td class="agy-style-579">${label}</td>`;
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
          <span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block;margin-right:5px"></span>${escapeHTML(kam)}
          <span class="agy-style-580">(${group.length} partners)</span>
        </td>
      </tr>`;
    group.forEach(r => {
      const m   = metaByPartner[r.partner];
      const col = STATE.partnerColors[r.partner] || "#ccc";
      const projNR = projA(r.nrV, daysElapsed, daysRemaining);
      const projSH = projA(r.shV, daysElapsed, daysRemaining);
      tbody += `
        <tr class="dtbl-row">
          <td class="agy-style-581">
            <span style="width:7px;height:7px;border-radius:50%;background:${col};display:inline-block;margin-right:5px"></span>
            ${escapeHTML(r.partner)}
          </td>
          <td class="agy-style-582">${fmt(r.ad)}</td>
          <td class="agy-style-583">${m ? fmt(m.mA) : "—"}</td>
          ${pCell(r.ad, m?.mA)}
          <td class="agy-style-582">${fmt(r.nr)}</td>
          <td class="agy-style-583">${m ? fmt(m.mNR) : "—"}</td>
          ${pCell(r.nr, m?.mNR)}
          <td class="agy-style-582">${fmt(r.sh)}</td>
          <td class="agy-style-583">${m ? fmt(m.mH) : "—"}</td>
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
      <tr class="agy-style-584">
        <td style="padding-left:16px;color:${col}">Total ${escapeHTML(kam)}</td>
        <td class="agy-style-585">${fmt(kAD)}</td><td class="agy-style-586">${fmt(kmA)}</td>${pCell(kAD, kmA)}
        <td class="agy-style-585">${fmt(kNR)}</td><td class="agy-style-586">${fmt(kmNR)}</td>${pCell(kNR, kmNR)}
        <td class="agy-style-585">${fmt(kSH)}</td><td class="agy-style-586">${fmt(kmH)}</td>${pCell(kSH, kmH)}
      </tr>`;
  });

  el.innerHTML = `
    <div class="agy-style-587">
      <div class="agy-style-588">
        📊 Rendimiento + Metas unificados
        <span class="agy-style-589">${from} → ${to}</span>
      </div>
      <div class="tbl-wrap">
        <table class="dtbl agy-style-590">
          <thead>
            <tr>
              <th rowspan="2">Partner</th>
              <th colspan="3" class="agy-style-591">Cond. Activos</th>
              <th colspan="3" class="agy-style-591">Nuevos + React.</th>
              <th colspan="3" class="agy-style-591">Hs. Conexión</th>
            </tr>
            <tr>
              <th class="agy-style-585">Fact</th><th class="agy-style-585">Plan</th><th class="agy-style-27">%</th>
              <th class="agy-style-585">Fact</th><th class="agy-style-585">Plan</th><th class="agy-style-27">%</th>
              <th class="agy-style-585">Fact</th><th class="agy-style-585">Plan</th><th class="agy-style-27">%</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>`;
}
