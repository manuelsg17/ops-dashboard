// insights.js — Sección Análisis para reuniones
// 4 módulos: Resumen Ejecutivo · Top Movers · Brecha vs Meta · Alertas
//
// Respeta filtros del sidebar: dateFrom/dateTo, cityFilter, kamFilter, selSet.
// Todos los nombres de partners/KAMs pasan por escapeHTML() (XSS-safe).

// ── HELPERS COMUNES ───────────────────────────────────────────────────────────

// Lee el conjunto de filtros activos desde el sidebar
function _readFilters() {
  return {
    from:       document.getElementById("dateFrom")?.value || (STATE.allDates[0] || ""),
    to:         document.getElementById("dateTo")?.value   || (STATE.allDates.at(-1) || ""),
    cityFilter: document.getElementById("cityFilter")?.value || "all",
    kamFilter:  document.getElementById("kamFilter")?.value  || "all",
    selSet:     new Set(getSel())
  };
}

// Predicado: ¿la fila pasa los filtros sidebar (excluyendo fechas)?
function _passesSidebar(r, f) {
  if (!f.selSet.has(r.partner)) return false;
  if (f.cityFilter !== "all" && r.city !== f.cityFilter) return false;
  if (f.kamFilter !== "all") {
    const kam = r.kam || getKAMForPartner(r.partner);
    if (kam !== f.kamFilter) return false;
  }
  return true;
}

// Agrega rows en map { partner: { ad, nr, sh, kam } } aplicando max(AD) y sum(NR,SH).
function _aggPartnerRange(rows) {
  const byPartnerDate = new Map();
  rows.forEach(r => {
    const k = `${r.partner}|||${r.date}`;
    let e = byPartnerDate.get(k);
    if (!e) { e = { partner: r.partner, kam: r.kam, ad: 0, nr: 0, sh: 0 }; byPartnerDate.set(k, e); }
    e.ad += r.activeDrivers;
    e.nr += r.newPartner + r.newService + r.reactivated;
    e.sh += r.supplyHours;
  });
  const out = new Map();
  for (const e of byPartnerDate.values()) {
    let agg = out.get(e.partner);
    if (!agg) { agg = { partner: e.partner, kam: e.kam, ad: 0, nr: 0, sh: 0 }; out.set(e.partner, agg); }
    if (e.ad > agg.ad) agg.ad = e.ad;
    agg.nr += e.nr;
    agg.sh += e.sh;
  }
  return out;
}

function _pctChg(cur, prev) {
  if (prev === 0 || prev === null || prev === undefined) return null;
  return ((cur - prev) / prev) * 100;
}

function _fmtPct(p) {
  if (p === null || p === undefined || isNaN(p)) return "N/A";
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(1)}%`;
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
// Guard de reentrancia (mismo patron que rendimiento.js).
let _renderInsightsBusy = false;
function renderInsights() {
  if (_renderInsightsBusy) return;
  _renderInsightsBusy = true;
  try {
    _renderInsightsImpl();
  } finally {
    _renderInsightsBusy = false;
  }
}

function _renderInsightsImpl() {
  const el = document.getElementById("insightsContent");
  if (!el) return;
  ensureIndexes();

  if (!STATE.rawData.length) {
    el.innerHTML = `<div class="empty"><p>Carga datos de <strong>Rendimiento</strong> para ver Insights.</p></div>`;
    return;
  }

  const f = _readFilters();
  // Dataset filtrado por rango de fechas + sidebar
  const rangeRows = getFilteredByDateRange(f.from, f.to).filter(r => _passesSidebar(r, f));

  // Resumen del estado para el copia-al-portapapeles (en STATE, no window)
  STATE._insightsCtx = { f, rangeRows };

  let html = `
    <div style="padding:0 8px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:8px 0 14px">
        <div>
          <div style="font-size:1.15rem;font-weight:900;color:#111">💡 Insights para tu reunión</div>
          <div style="font-size:.78rem;color:#666">
            Rango: <strong>${d2s(f.from)} → ${d2s(f.to)}</strong>
            · Escala: <strong>${escapeHTML(STATE.curMode)}</strong>
            ${f.kamFilter !== "all" ? `· KAM: <strong>${escapeHTML(f.kamFilter)}</strong>` : ""}
            ${f.cityFilter !== "all" ? `· Ciudad: <strong>${escapeHTML(f.cityFilter)}</strong>` : ""}
          </div>
        </div>
        <button class="apply-btn" style="width:auto;padding:7px 16px;font-size:.8rem" onclick="copyInsightsSummary()">
          📋 Copiar Resumen
        </button>
      </div>
      ${_modResumen(f, rangeRows)}
      ${_modTopMovers(f)}
      ${_modBrecha(f, rangeRows)}
      ${_modAlertas(f, rangeRows)}
    </div>`;
  el.innerHTML = html;
}

// ── MÓDULO 1: RESUMEN EJECUTIVO ───────────────────────────────────────────────
function _modResumen(f, rangeRows) {
  const allDates = STATE.allDates;
  if (allDates.length < 1) return "";
  // lastDate = max fecha dentro del rango filtrado
  const datesInRange = [...new Set(rangeRows.map(r => r.date))].sort();
  const lastDate = datesInRange.at(-1) || allDates.at(-1);
  // prevDate = fecha anterior en allDates (no necesariamente dentro del rango)
  const lastIdx = allDates.indexOf(lastDate);
  const prevDate = lastIdx > 0 ? allDates[lastIdx - 1] : null;

  const lastRows = rangeRows.filter(r => r.date === lastDate);
  const prevAll  = prevDate ? (STATE._byDate?.get(prevDate) || STATE.rawData.filter(r => r.date === prevDate)) : [];
  const prevRows = prevAll.filter(r => _passesSidebar(r, f));

  const sumF = (rows, fn) => rows.reduce((s, r) => s + fn(r), 0);
  const lAD = sumF(lastRows, r => r.activeDrivers);
  const pAD = sumF(prevRows, r => r.activeDrivers);
  const lNR = sumF(lastRows, r => r.newPartner + r.newService + r.reactivated);
  const pNR = sumF(prevRows, r => r.newPartner + r.newService + r.reactivated);
  const lSH = sumF(lastRows, r => r.supplyHours);
  const pSH = sumF(prevRows, r => r.supplyHours);

  const chgAD = _pctChg(lAD, pAD);
  const chgNR = _pctChg(lNR, pNR);
  const chgSH = _pctChg(lSH, pSH);

  const periodo = STATE.curMode === "mensual" ? "mes"
                : STATE.curMode === "diario"  ? "día"
                : "semana";
  const periodAnt = `${periodo} anterior`;

  const bueno = [], malo = [], accion = [];

  if (chgAD !== null) {
    if (chgAD >= 5)       bueno.push(`Conductores Activos creció ${_fmtPct(chgAD)} vs ${periodAnt} (${fmt(lAD)} vs ${fmt(pAD)}).`);
    else if (chgAD <= -5) malo.push(`Conductores Activos cayó ${_fmtPct(chgAD)} vs ${periodAnt} (${fmt(lAD)} vs ${fmt(pAD)}).`);
  }
  if (chgNR !== null) {
    if (chgNR >= 10)       bueno.push(`Nuevos + Reactivados subió ${_fmtPct(chgNR)} (${fmt(lNR)} vs ${fmt(pNR)}).`);
    else if (chgNR <= -10) malo.push(`Nuevos + Reactivados bajó ${_fmtPct(chgNR)} (${fmt(lNR)} vs ${fmt(pNR)}).`);
  }
  if (chgSH !== null) {
    if (chgSH >= 5)       bueno.push(`Horas de Conexión subió ${_fmtPct(chgSH)} (${fmt(lSH)} vs ${fmt(pSH)}).`);
    else if (chgSH <= -5) malo.push(`Horas de Conexión bajó ${_fmtPct(chgSH)} (${fmt(lSH)} vs ${fmt(pSH)}).`);
  }

  // Top y peor KAM por AD (solo si no hay filtro de KAM)
  if (f.kamFilter === "all") {
    const kamMap = {};
    lastRows.forEach(r => {
      const k = r.kam || getKAMForPartner(r.partner);
      if (!k) return;
      if (!kamMap[k]) kamMap[k] = { l: 0, p: 0 };
      kamMap[k].l += r.activeDrivers;
    });
    prevRows.forEach(r => {
      const k = r.kam || getKAMForPartner(r.partner);
      if (!k || !kamMap[k]) return;
      kamMap[k].p += r.activeDrivers;
    });
    const kamChanges = Object.entries(kamMap)
      .map(([k, v]) => ({ kam: k, chg: _pctChg(v.l, v.p) }))
      .filter(x => x.chg !== null);
    const topKAM = kamChanges.slice().sort((a, b) => b.chg - a.chg)[0];
    const lowKAM = kamChanges.slice().sort((a, b) => a.chg - b.chg)[0];
    if (topKAM && topKAM.chg >= 5)
      bueno.push(`KAM <strong>${escapeHTML(topKAM.kam)}</strong> lidera el período con ${_fmtPct(topKAM.chg)} en AD.`);
    if (lowKAM && lowKAM.chg <= -5)
      accion.push(`Revisar con KAM <strong>${escapeHTML(lowKAM.kam)}</strong>: cayó ${_fmtPct(lowKAM.chg)} en AD.`);
  }

  // Declives (sobre full history pero filtrados por selSet/kam/city)
  if (!STATE._apdFull) STATE._apdFull = aggPD(STATE.rawData);
  const apdByP = new Map();
  STATE._apdFull.forEach(r => {
    if (!f.selSet.has(r.partner)) return;
    if (f.kamFilter !== "all") {
      const k = r.kam || getKAMForPartner(r.partner);
      if (k !== f.kamFilter) return;
    }
    if (!apdByP.has(r.partner)) apdByP.set(r.partner, []);
    apdByP.get(r.partner).push(r);
  });
  const declining = [...apdByP.keys()].filter(p => hasConsecutiveDecline(apdByP, p));
  if (declining.length) {
    const listed = declining.slice(0, 5).map(escapeHTML).join(", ");
    accion.push(`<strong>${declining.length}</strong> partner${declining.length>1?"s":""} en declive ${STATE.declineThreshold}+ períodos: ${listed}${declining.length>5?` y ${declining.length-5} más`:""}.`);
  }

  if (!bueno.length)  bueno.push(`Sin cambios destacables al alza vs ${periodAnt}.`);
  if (!malo.length)   malo.push(`Sin cambios destacables a la baja vs ${periodAnt}.`);
  if (!accion.length) accion.push(`No hay acciones urgentes detectadas en el período.`);

  // Guardar en STATE (no window) para copyInsightsSummary
  STATE._insightsCtx.resumen = { bueno, malo, accion, lastDate };

  const _bullets = arr => arr.map(b => `<li style="margin:4px 0;line-height:1.4">${b}</li>`).join("");

  return `
    ${_secH("📋", "#10b981", "Resumen Ejecutivo", `Fecha de referencia: ${d2s(lastDate)}`)}
    <div class="section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px">
        <div style="font-size:.85rem;font-weight:700;color:#065f46;margin-bottom:6px">🏆 Lo bueno</div>
        <ul style="margin:0;padding-left:18px;font-size:.78rem;color:#166534">${_bullets(bueno)}</ul>
      </div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 14px">
        <div style="font-size:.85rem;font-weight:700;color:#991b1b;margin-bottom:6px">⚠️ Lo malo</div>
        <ul style="margin:0;padding-left:18px;font-size:.78rem;color:#7f1d1d">${_bullets(malo)}</ul>
      </div>
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:12px 14px">
        <div style="font-size:.85rem;font-weight:700;color:#92400e;margin-bottom:6px">🎯 Lo accionable</div>
        <ul style="margin:0;padding-left:18px;font-size:.78rem;color:#78350f">${_bullets(accion)}</ul>
      </div>
    </div>`;
}

// ── MÓDULO 2: TOP MOVERS ──────────────────────────────────────────────────────
function _modTopMovers(f) {
  const allDates = STATE.allDates;
  if (allDates.length < 2) {
    return `${_secH("📊", "#06b6d4", "Top Movers", "Necesitas al menos 2 períodos para comparar")}
      <div class="section"><div style="font-size:.78rem;color:#aaa">Sin datos suficientes.</div></div>`;
  }
  const lastDate = allDates.at(-1);
  const prevDate = allDates.at(-2);
  const lastAll = STATE._byDate?.get(lastDate) || STATE.rawData.filter(r => r.date === lastDate);
  const prevAll = STATE._byDate?.get(prevDate) || STATE.rawData.filter(r => r.date === prevDate);
  const lastRows = lastAll.filter(r => _passesSidebar(r, f));
  const prevRows = prevAll.filter(r => _passesSidebar(r, f));

  const lastByP = _aggPartnerRange(lastRows);
  const prevByP = _aggPartnerRange(prevRows);

  const metrics = [
    { key: "ad", label: METRICS.ad.label, color: METRICS.ad.color },
    { key: "nr", label: METRICS.nr.label, color: METRICS.nr.color },
    { key: "sh", label: METRICS.sh.label, color: METRICS.sh.color }
  ];

  const N = 5;
  let cards = "";

  metrics.forEach(m => {
    const changes = [];
    for (const [partner, l] of lastByP) {
      const p = prevByP.get(partner);
      const prev = p ? p[m.key] : 0;
      const cur  = l[m.key];
      if (cur === 0 && prev === 0) continue;
      const chg = _pctChg(cur, prev);
      const abs = cur - prev;
      changes.push({ partner, cur, prev, chg, abs });
    }
    const subieron = changes.filter(x => x.abs > 0).sort((a, b) => b.abs - a.abs).slice(0, N);
    const bajaron  = changes.filter(x => x.abs < 0).sort((a, b) => a.abs - b.abs).slice(0, N);

    const row = (x, sign) => {
      const c = sign === "up" ? "#10b981" : "#FF0000";
      const arr = sign === "up" ? "↑" : "↓";
      const chgTxt = x.chg !== null ? _fmtPct(x.chg) : "NEW";
      const safe = escapeHTML(x.partner);
      return `
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f5f5f5;font-size:.74rem">
          <span style="color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${safe}">${safe}</span>
          <span style="color:#888;font-size:.7rem">${fmt(x.cur)}</span>
          <span style="color:${c};font-weight:700">${arr} ${chgTxt}</span>
        </div>`;
    };

    cards += `
      <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="width:10px;height:10px;border-radius:50%;background:${m.color}"></span>
          <span style="font-size:.85rem;font-weight:700;color:#111">${escapeHTML(m.label)}</span>
        </div>
        <div style="font-size:.66rem;color:#10b981;font-weight:700;text-transform:uppercase;margin:6px 0 3px">↑ Top ${N} subieron</div>
        ${subieron.length ? subieron.map(x => row(x, "up")).join("") : `<div style="font-size:.72rem;color:#aaa;padding:5px 0">Sin subidas significativas</div>`}
        <div style="font-size:.66rem;color:#FF0000;font-weight:700;text-transform:uppercase;margin:10px 0 3px">↓ Top ${N} bajaron</div>
        ${bajaron.length ? bajaron.map(x => row(x, "down")).join("") : `<div style="font-size:.72rem;color:#aaa;padding:5px 0">Sin caídas significativas</div>`}
      </div>`;
  });

  return `
    ${_secH("📊", "#06b6d4", "Top Movers", `${d2s(prevDate)} → ${d2s(lastDate)}`)}
    <div class="section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">
      ${cards}
    </div>`;
}

// ── MÓDULO 3: BRECHA VS META ──────────────────────────────────────────────────
function _modBrecha(f, rangeRows) {
  if (!STATE.metasData.length) {
    return `${_secH("🎯", "#8b5cf6", "Brecha vs Meta", "Carga el archivo de Metas para ver esta sección")}
      <div class="section"><div style="font-size:.78rem;color:#aaa">Sin metas cargadas.</div></div>`;
  }
  const maxDate = rangeRows.length ? rangeRows.map(r => r.date).sort().at(-1) : f.to;
  const { daysElapsed, daysRemaining } = calcProjectionDays(maxDate);

  // Solo los KAMs que pasan el filtro
  const kams = [...new Set(Object.values(STATE.KAM_MAP))]
    .filter(k => f.kamFilter === "all" || k === f.kamFilter)
    .sort();
  const byKAM = {};
  kams.forEach(k => { byKAM[k] = { mAD: 0, mNR: 0, mSH: 0, rAD: 0, rNR: 0, rSH: 0, partners: new Set() }; });

  STATE.metasData.forEach(m => {
    const k = m.kam || "";
    if (!byKAM[k]) return;
    if (!f.selSet.has(m.partner)) return;
    if (f.cityFilter !== "all" && m.city !== f.cityFilter) return;
    byKAM[k].mAD += m.mA;
    byKAM[k].mNR += m.mNR;
    byKAM[k].mSH += m.mH;
  });

  const partnerAgg = _aggPartnerRange(rangeRows);
  for (const [partner, v] of partnerAgg) {
    const k = v.kam || getKAMForPartner(partner);
    if (!byKAM[k]) continue;
    byKAM[k].rAD += v.ad;
    byKAM[k].rNR += v.nr;
    byKAM[k].rSH += v.sh;
    byKAM[k].partners.add(partner);
  }

  function _semaforo(real, meta, proj) {
    if (!meta) return { color: "#aaa", emoji: "—", label: "Sin meta" };
    const pp = (proj / meta) * 100;
    if (pp >= 100) return { color: "#10b981", emoji: "✅", label: "On track" };
    if (pp >= 85)  return { color: "#f59e0b", emoji: "⚠️", label: "Ajustado" };
    return            { color: "#FF0000", emoji: "🔴", label: "En riesgo" };
  }

  function _row(k, v) {
    const projAD = (STATE.curMode === "mensual" || daysRemaining === 0) ? v.rAD : v.rAD * 1.4;
    const projNR = (STATE.curMode === "mensual" || daysRemaining === 0)
      ? v.rNR : v.rNR + (v.rNR / Math.max(daysElapsed, 1)) * daysRemaining;
    const projSH = (STATE.curMode === "mensual" || daysRemaining === 0)
      ? v.rSH : v.rSH + (v.rSH / Math.max(daysElapsed, 1)) * daysRemaining;

    function _miniBar(label, real, meta, proj) {
      const pct = meta > 0 ? (real / meta) * 100 : 0;
      const ppc = meta > 0 ? (proj / meta) * 100 : 0;
      const sem = _semaforo(real, meta, proj);
      const gap = meta - real;
      const needPerDay = (gap > 0 && daysRemaining > 0) ? (gap / daysRemaining) : null;
      return `
        <div style="padding:6px 0;border-bottom:1px solid #f5f5f5">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:.74rem;margin-bottom:3px">
            <span style="color:#555;font-weight:600">${escapeHTML(label)}</span>
            <span style="display:flex;align-items:center;gap:6px">
              <span style="color:${sem.color};font-weight:700">${sem.emoji} ${sem.label}</span>
              <strong style="color:${pColor(pct)};min-width:50px;text-align:right">${pct.toFixed(1)}%</strong>
            </span>
          </div>
          <div style="font-size:.66rem;color:#888;display:flex;justify-content:space-between;gap:8px">
            <span>Fact: <strong>${fmt(real)}</strong> · Plan: <strong>${fmt(meta)}</strong></span>
            <span>Proy: <strong style="color:${pColor(ppc)}">${fmt(proj)}</strong> (${ppc.toFixed(0)}%)</span>
          </div>
          ${needPerDay !== null ? `<div style="font-size:.66rem;color:#666;margin-top:2px">📌 Para cerrar al 100%: necesitas <strong>${fmt(needPerDay)}</strong>/día en los ${daysRemaining} días restantes</div>` : ""}
        </div>`;
    }

    const col = KAM_COLORS[k] || "#888";
    return `
      <div style="background:#fff;border:1px solid #eee;border-top:3px solid ${col};border-radius:10px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="width:10px;height:10px;border-radius:50%;background:${col}"></span>
          <span style="font-size:.92rem;font-weight:800;color:#111">${escapeHTML(k)}</span>
          <span style="font-size:.7rem;color:#aaa;margin-left:auto">${v.partners.size} cuentas</span>
        </div>
        ${_miniBar(METRICS.ad.label, v.rAD, v.mAD, projAD)}
        ${_miniBar(METRICS.nr.label, v.rNR, v.mNR, projNR)}
        ${_miniBar(METRICS.sh.label, v.rSH, v.mSH, projSH)}
      </div>`;
  }

  const cards = kams
    .filter(k => byKAM[k].partners.size > 0 || byKAM[k].mAD > 0)
    .map(k => _row(k, byKAM[k]))
    .join("");

  return `
    ${_secH("🎯", "#8b5cf6", "Brecha vs Meta — por KAM", `${daysElapsed} días transcurridos · ${daysRemaining} restantes del mes`)}
    <div class="section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">
      ${cards || `<div style="font-size:.78rem;color:#aaa">Sin datos de metas en el rango filtrado.</div>`}
    </div>`;
}

// ── MÓDULO 4: ALERTAS ACCIONABLES ─────────────────────────────────────────────
function _modAlertas(f, rangeRows) {
  const allDates = STATE.allDates;
  if (allDates.length < 2) return "";
  const lastDate = allDates.at(-1);
  const prevDate = allDates.at(-2);

  const lastAll = STATE._byDate?.get(lastDate) || STATE.rawData.filter(r => r.date === lastDate);
  const prevAll = STATE._byDate?.get(prevDate) || STATE.rawData.filter(r => r.date === prevDate);
  const lastRows = lastAll.filter(r => _passesSidebar(r, f));
  const prevRows = prevAll.filter(r => _passesSidebar(r, f));
  const lastByP = _aggPartnerRange(lastRows);
  const prevByP = _aggPartnerRange(prevRows);

  if (!STATE._apdFull) STATE._apdFull = aggPD(STATE.rawData);
  const apdByP = new Map();
  STATE._apdFull.forEach(r => {
    if (!f.selSet.has(r.partner)) return;
    if (f.kamFilter !== "all") {
      const k = r.kam || getKAMForPartner(r.partner);
      if (k !== f.kamFilter) return;
    }
    if (!apdByP.has(r.partner)) apdByP.set(r.partner, []);
    apdByP.get(r.partner).push(r);
  });

  const alerts = [];

  for (const p of apdByP.keys()) {
    if (hasConsecutiveDecline(apdByP, p)) {
      const cur = lastByP.get(p);
      if (cur) {
        alerts.push({
          urg: "alta",
          icon: "🔴",
          color: "#FF0000",
          title: `Declive ${STATE.declineThreshold}+ períodos: ${p}`,
          detail: `AD actual: ${fmt(cur.ad)}. KAM: ${cur.kam || getKAMForPartner(p) || "Sin KAM"}.`,
          action: `Contactar al partner para entender la caída sostenida.`
        });
      }
    }
  }

  for (const [partner, cur] of lastByP) {
    const prev = prevByP.get(partner);
    if (!prev) continue;
    const chgNR = _pctChg(cur.nr, prev.nr);
    if (chgNR !== null && chgNR >= 50 && cur.nr >= 5) {
      alerts.push({
        urg: "buena",
        icon: "🟢",
        color: "#10b981",
        title: `Sobre-cumplimiento N+R: ${partner}`,
        detail: `Subió ${_fmtPct(chgNR)} (${fmt(prev.nr)} → ${fmt(cur.nr)}). KAM: ${cur.kam || getKAMForPartner(partner) || "Sin KAM"}.`,
        action: `Estudiar qué hizo este partner para replicarlo en otros.`
      });
    }
  }

  for (const [partner, cur] of lastByP) {
    const prev = prevByP.get(partner);
    if (!prev || prev.ad === 0) continue;
    const chgAD = _pctChg(cur.ad, prev.ad);
    if (chgAD !== null && chgAD <= -20) {
      alerts.push({
        urg: "media",
        icon: "⚠️",
        color: "#f59e0b",
        title: `Caída fuerte AD: ${partner}`,
        detail: `AD bajó ${_fmtPct(chgAD)} (${fmt(prev.ad)} → ${fmt(cur.ad)}). KAM: ${cur.kam || getKAMForPartner(partner) || "Sin KAM"}.`,
        action: `Revisar disponibilidad de drivers y posibles bloqueos.`
      });
    }
  }

  const urgOrder = { alta: 0, media: 1, buena: 2 };
  alerts.sort((a, b) => urgOrder[a.urg] - urgOrder[b.urg]);

  STATE._insightsCtx.alerts = alerts;

  if (!alerts.length) {
    return `${_secH("🚨", "#FF0000", "Alertas Accionables", "Lista priorizada por urgencia")}
      <div class="section"><div style="font-size:.78rem;color:#10b981;padding:8px 0">✅ Sin alertas en el período actual.</div></div>`;
  }

  const items = alerts.map(a => `
    <div style="background:#fff;border:1px solid #eee;border-left:4px solid ${a.color};border-radius:8px;padding:10px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <span style="font-size:1rem">${a.icon}</span>
        <div style="flex:1">
          <div style="font-size:.82rem;font-weight:700;color:#111;margin-bottom:3px">${escapeHTML(a.title)}</div>
          <div style="font-size:.72rem;color:#666;margin-bottom:4px">${escapeHTML(a.detail)}</div>
          <div style="font-size:.72rem;color:${a.color};font-style:italic"><strong>Acción:</strong> ${escapeHTML(a.action)}</div>
        </div>
      </div>
    </div>`).join("");

  return `
    ${_secH("🚨", "#FF0000", "Alertas Accionables", `${alerts.length} alerta${alerts.length>1?"s":""} priorizadas`)}
    <div class="section">${items}</div>`;
}

// ── COPIAR RESUMEN AL PORTAPAPELES ────────────────────────────────────────────
function copyInsightsSummary() {
  // Re-renderizar para asegurar estado fresco (evita phantom state)
  renderInsights();
  const ctx = STATE._insightsCtx;
  if (!ctx || !ctx.resumen) { alert("No se pudo generar el resumen. Recarga Insights."); return; }
  const r = ctx.resumen;
  const a = ctx.alerts || [];

  const stripHtml = s => String(s).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const lines = [];
  lines.push(`📊 RESUMEN — ${d2s(r.lastDate)} (${STATE.curMode})`);
  if (ctx.f.kamFilter !== "all") lines.push(`KAM: ${ctx.f.kamFilter}`);
  if (ctx.f.cityFilter !== "all") lines.push(`Ciudad: ${ctx.f.cityFilter}`);
  lines.push("");
  lines.push("🏆 LO BUENO:");
  r.bueno.forEach(b => lines.push(`  • ${stripHtml(b)}`));
  lines.push("");
  lines.push("⚠️ LO MALO:");
  r.malo.forEach(b => lines.push(`  • ${stripHtml(b)}`));
  lines.push("");
  lines.push("🎯 LO ACCIONABLE:");
  r.accion.forEach(b => lines.push(`  • ${stripHtml(b)}`));
  if (a.length) {
    lines.push("");
    lines.push("🚨 ALERTAS:");
    a.slice(0, 10).forEach(x => lines.push(`  ${x.icon} ${stripHtml(x.title)} — ${stripHtml(x.action)}`));
  }
  const txt = lines.join("\n");

  // Fallback para navegadores sin clipboard API (HTTP no-localhost)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => {
      showBanner(true, "Resumen copiado al portapapeles · pega en Slack/email");
    }).catch(() => _fallbackCopy(txt));
  } else {
    _fallbackCopy(txt);
  }
}

function _fallbackCopy(txt) {
  const ta = document.createElement("textarea");
  ta.value = txt;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    showBanner(true, "Resumen copiado al portapapeles");
  } catch (err) {
    alert("No se pudo copiar automáticamente. Texto:\n\n" + txt);
  }
  document.body.removeChild(ta);
}

// ── HELPER: Section header local ──────────────────────────────────────────────
function _secH(emoji, color, title, subtitle) {
  return `
    <div style="display:flex;align-items:center;gap:10px;margin:18px 0 8px;padding:0 4px">
      <div style="font-size:1.1rem">${emoji}</div>
      <div style="flex:1">
        <div style="font-size:.92rem;font-weight:800;color:#111">${escapeHTML(title)}</div>
        <div style="font-size:.7rem;color:#888">${escapeHTML(subtitle)}</div>
      </div>
    </div>`;
}
