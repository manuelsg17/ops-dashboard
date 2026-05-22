// partnerView.js — Vista detallada de un partner individual
// Pensado para reuniones semanales/mensuales con el partner.
// Estructura: header, KPIs globales, sección por ciudad con charts.

const PARTNER_VIEW_STATE = {
  partner: null,
  period:  "auto",   // auto | 3m | 6m | 12m | custom
  charts:  []        // ApexCharts instances
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function _pvDestroyCharts() {
  PARTNER_VIEW_STATE.charts.forEach(c => { try { c.destroy(); } catch(e){} });
  PARTNER_VIEW_STATE.charts = [];
}

// Cuántos puntos mostrar según escala
function _pvDefaultPoints(mode) {
  if (mode === "mensual") return 12;
  if (mode === "diario")  return 30;
  return 13; // semanal
}

// Devuelve las últimas N fechas disponibles (subset de STATE.allDates)
function _pvLastNDates(n) {
  const all = STATE.allDates || [];
  return all.slice(-n);
}

// Agrega rawData filtrado por partner + ciudad, devuelve array { date, ad, nr, sh,
// trips, commission, npPartner (newPartner only), npService (newService only), reactivated }
function _pvSeriesByPartnerCity(partner, city, dates) {
  const datesSet = new Set(dates);
  const byDate = {};
  // Solo rows de este partner y esta ciudad y dentro del rango
  const rows = (STATE._byPartner?.get(partner) || STATE.rawData.filter(r => r.partner === partner))
    .filter(r => r.city === city && datesSet.has(r.date));
  rows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = {
      date: r.date, ad: 0, nr: 0, sh: 0,
      trips: 0, commission: 0,
      npPartner: 0, npService: 0, reactivated: 0
    };
    const e = byDate[r.date];
    // AD es snapshot: max entre CLIDs duplicados del mismo partner+ciudad+fecha
    if ((r.activeDrivers || 0) > e.ad) e.ad = r.activeDrivers || 0;
    e.npPartner   += r.newPartner;
    e.npService   += r.newService;
    e.reactivated += r.reactivated;
    e.nr = e.npPartner + e.npService + e.reactivated;
    e.sh += r.supplyHours;
    e.trips      += r.trips || 0;
    e.commission += r.commission || 0;
  });
  return dates.map(d => byDate[d] || {
    date: d, ad: 0, nr: 0, sh: 0,
    trips: 0, commission: 0,
    npPartner: 0, npService: 0, reactivated: 0
  });
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
function renderPartnerView() {
  const el = document.getElementById("partnerViewContent");
  if (!el) return;
  ensureIndexes();
  _pvDestroyCharts();
  // Reset _seriesCache: la siguiente seccion lo repuebla solo para el render
  // actual. Evita acumulacion sin limite si el usuario navega muchos partners.
  PARTNER_VIEW_STATE._seriesCache = {};

  if (!STATE.rawData.length) {
    el.innerHTML = `<div class="empty"><p>Carga datos de <strong>Rendimiento</strong> para usar Vista Partner.</p></div>`;
    return;
  }

  const partners = STATE.allPartners || [];
  if (!partners.length) {
    el.innerHTML = `<div class="empty"><p>No hay partners cargados.</p></div>`;
    return;
  }

  // Estado: partner seleccionado (default = primero)
  if (!PARTNER_VIEW_STATE.partner || !partners.includes(PARTNER_VIEW_STATE.partner)) {
    PARTNER_VIEW_STATE.partner = partners[0];
  }
  const partner = PARTNER_VIEW_STATE.partner;

  // Período auto-detect por escala
  const period = PARTNER_VIEW_STATE.period;
  const nPoints = period === "auto"
    ? _pvDefaultPoints(STATE.curMode)
    : (period === "3m" ? 3 : period === "6m" ? 6 : period === "12m" ? 12 : 13);
  const dates = _pvLastNDates(nPoints);
  if (!dates.length) {
    el.innerHTML = `<div class="empty"><p>Sin fechas disponibles en este modo.</p></div>`;
    return;
  }

  // Ciudades donde opera este partner (>= 1 row con datos)
  const partnerRows = STATE._byPartner?.get(partner) || STATE.rawData.filter(r => r.partner === partner);
  const citiesOf = [...new Set(partnerRows.map(r => r.city).filter(Boolean))].sort();
  const kam = getKAMForPartner(partner) || partnerRows[0]?.kam || "Sin KAM";

  // Detectar si recibe leads Yango (algún new_from_service > 0 históricamente)
  const recibeLeads = partnerRows.some(r => r.newService > 0);

  // KPIs globales del partner: último período del rango
  const lastDate = dates[dates.length - 1];
  const prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
  const lastRows = partnerRows.filter(r => r.date === lastDate);
  const prevRows = prevDate ? partnerRows.filter(r => r.date === prevDate) : [];
  const tAD = lastRows.reduce((s, r) => Math.max(s, r.activeDrivers), 0);  // max por ciudad
  // Para AD a nivel global mejor sumar ciudades del último period
  const adByCityLast = {};
  lastRows.forEach(r => { adByCityLast[r.city] = (adByCityLast[r.city] || 0) + r.activeDrivers; });
  const tADsum = Object.values(adByCityLast).reduce((s, v) => s + v, 0);
  const tNR = lastRows.reduce((s, r) => s + r.newPartner + r.newService + r.reactivated, 0);
  const tSH = lastRows.reduce((s, r) => s + r.supplyHours, 0);
  const tTr = lastRows.reduce((s, r) => s + (r.trips || 0), 0);
  const tCo = lastRows.reduce((s, r) => s + (r.commission || 0), 0);
  const pAD = prevRows.reduce((acc, r) => { acc[r.city] = (acc[r.city] || 0) + r.activeDrivers; return acc; }, {});
  const pADsum = Object.values(pAD).reduce((s, v) => s + v, 0);
  const pNR = prevRows.reduce((s, r) => s + r.newPartner + r.newService + r.reactivated, 0);
  const pSH = prevRows.reduce((s, r) => s + r.supplyHours, 0);

  // Building HTML
  const partnerColor = STATE.partnerColors[partner] || "#FF0000";
  const periodLabel = STATE.curMode === "mensual" ? `${nPoints} meses`
                    : STATE.curMode === "diario"  ? `${nPoints} días`
                    : `${nPoints} semanas`;

  let html = `
    <div style="padding:0 8px 16px">
      <!-- Controles -->
      <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:8px 0 16px">
        <div style="position:relative">
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">Partner</label>
          <input type="text" id="pvSearch" class="sb-inp" placeholder="Buscar partner..." style="width:240px" autocomplete="off"
            value="${escapeHTML(partner)}"
            oninput="pvFilterPartners(this.value)"
            onfocus="pvShowPartnerList()"
            onblur="setTimeout(pvHidePartnerList, 200)"
            onkeydown="pvSearchKeydown(event)"/>
          <div id="pvPartnerList" style="display:none;position:absolute;top:100%;left:0;width:240px;max-height:280px;overflow-y:auto;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.12);z-index:100;margin-top:2px"></div>
        </div>
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">Período</label>
          <select id="pvPeriodSel" class="sb-sel" style="width:200px" onchange="pvOnPeriodChange(this.value)">
            ${_pvPeriodOptions(period, periodLabel)}
          </select>
        </div>
        <button style="padding:8px 16px;margin-left:auto;background:#FF0000;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:.85rem" onclick="pvDownloadPDF()">
          📤 Descargar PDF
        </button>
      </div>

      <!-- Header partner -->
      <div style="background:linear-gradient(135deg,${partnerColor}10 0%,#fff 100%);border-left:4px solid ${partnerColor};border-radius:10px;padding:14px 18px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span style="width:12px;height:12px;border-radius:50%;background:${partnerColor}"></span>
          <span style="font-size:1.25rem;font-weight:900;color:#111">${escapeHTML(partner)}</span>
          <span style="background:${KAM_COLORS[kam]||"#888"};color:#fff;font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:12px;margin-left:8px">${escapeHTML(kam)}</span>
        </div>
        <div style="font-size:.78rem;color:#666">
          Ciudades: <strong>${citiesOf.map(escapeHTML).join(" · ")}</strong>
          ${recibeLeads ? ` <span style="margin-left:10px;font-size:.7rem;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:8px">★ Recibe leads Yango</span>` : ""}
          <br>Período: ${d2s(dates[0])} → ${d2s(lastDate)} · Escala: <strong>${STATE.curMode}</strong>
        </div>
      </div>

      <!-- Análisis Ejecutivo (KAM Senior) -->
      ${_pvExecutiveSummary({
        partner, citiesOf, dates, recibeLeads, lastDate, prevDate,
        partnerRows, lastRows, prevRows,
        tADsum, pADsum, tNR, pNR, tSH, pSH, tTr, tCo
      })}

      <!-- KPIs globales -->
      ${_secH("⚡", "#FF0000", "KPIs del último período", `${d2s(lastDate)}`)}
      <div class="section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
        ${_pvKpiCard(METRICS.ad.label, tADsum, pADsum, METRICS.ad.color)}
        ${_pvKpiCard(METRICS.nr.label, tNR,    pNR,    METRICS.nr.color)}
        ${_pvKpiCard(METRICS.sh.label, tSH,    pSH,    METRICS.sh.color)}
        ${_pvKpiCard("Viajes",         tTr,    null,   "#10b981")}
        ${_pvKpiCard("Comisión",       tCo,    null,   "#06b6d4", true)}
      </div>

      <!-- Sección por ciudad -->
      ${_secH("🏙️", "#06b6d4", "Detalle por Ciudad", `${citiesOf.length} ciudad${citiesOf.length>1?"es":""} · ${periodLabel}`)}
      <div class="section">
        ${citiesOf.map(city => {
          // Cachear series por ciudad para no recalcular en buildCharts
          if (!PARTNER_VIEW_STATE._seriesCache) PARTNER_VIEW_STATE._seriesCache = {};
          const ck = `${partner}|||${city}|||${dates.join(",")}`;
          if (!PARTNER_VIEW_STATE._seriesCache[ck]) {
            PARTNER_VIEW_STATE._seriesCache[ck] = _pvSeriesByPartnerCity(partner, city, dates);
          }
          return _pvCitySection(partner, city, dates, recibeLeads, PARTNER_VIEW_STATE._seriesCache[ck]);
        }).join("")}
      </div>
    </div>`;

  // Marca de render unica para evitar race conditions de setTimeout
  const renderId = (PARTNER_VIEW_STATE._renderId = (PARTNER_VIEW_STATE._renderId || 0) + 1);
  el.innerHTML = html;

  // Construir charts despues de innerHTML. Si llega otro render antes,
  // el renderId cambia y el setTimeout previo se ignora.
  setTimeout(() => {
    if (renderId !== PARTNER_VIEW_STATE._renderId) return;
    citiesOf.forEach(city => {
      const ck = `${partner}|||${city}|||${dates.join(",")}`;
      const series = PARTNER_VIEW_STATE._seriesCache?.[ck] || _pvSeriesByPartnerCity(partner, city, dates);
      _pvBuildCityCharts(partner, city, dates, recibeLeads, series);
    });
  }, 100);
}

// ── ANALISIS EJECUTIVO (KAM SENIOR) ───────────────────────────────────────────
// Detecta señales relevantes y produce bullets accionables. Pensado para que el
// KAM tenga un "primer vistazo" de qué pasa con el partner y qué hacer esta
// semana. No es IA — son reglas determinísticas basadas en thresholds que un
// KAM senior aplicaria mentalmente. Severidad: red > yellow > green > info.
function _pvExecutiveSummary(ctx) {
  const {
    partner, citiesOf, dates, recibeLeads, lastDate, prevDate,
    partnerRows, lastRows, prevRows,
    tADsum, pADsum, tNR, pNR, tSH, pSH, tTr, tCo
  } = ctx;

  const findings = [];
  const periodoWord = STATE.curMode === "mensual" ? "mes"
                    : STATE.curMode === "diario"  ? "día"
                    : "semana";
  const periodoWordPlural = STATE.curMode === "mensual" ? "meses"
                          : STATE.curMode === "diario"  ? "días"
                          : "semanas";

  // ── 1. Declive consecutivo por ciudad (rojo) ──────────────────────────────
  if (STATE.curMode !== "diario") {
    citiesOf.forEach(city => {
      // Construir apdMap solo para este partner+ciudad
      const cityRows = partnerRows.filter(r => r.city === city);
      const apdMap = new Map();
      const dedup = new Map();
      cityRows.forEach(r => {
        const k = `${r.date}`;
        const ex = dedup.get(k) || { partner, date: r.date, activeDrivers: 0, newPartner: 0, newService: 0, reactivated: 0, supplyHours: 0 };
        if (r.activeDrivers > ex.activeDrivers) ex.activeDrivers = r.activeDrivers;
        ex.newPartner   += r.newPartner;
        ex.newService   += r.newService;
        ex.reactivated  += r.reactivated;
        ex.supplyHours  += r.supplyHours;
        dedup.set(k, ex);
      });
      apdMap.set(partner, [...dedup.values()]);
      if (hasConsecutiveDecline(apdMap, partner)) {
        const n = STATE.declineThreshold || 3;
        const metricLabel = { activeDrivers: "Conductores Activos", supplyHours: "Horas de Conexión", nr: "Nuevos+Reactivados" }[STATE.declineMetric] || STATE.declineMetric;
        findings.push({
          sev: "red",
          icon: "🔴",
          title: `Declive consecutivo en ${cityLabel(city)}`,
          body: `${metricLabel} cayó ${n} ${periodoWordPlural} seguidos.`,
          action: `Visitar al partner esta ${periodoWord}. Auditar conductores activos vs registrados, revisar incidencias recientes y plan de incentivos.`
        });
      }
    });
  }

  // ── 2. Variacion fuerte en AD global ──────────────────────────────────────
  const wowAD = pADsum > 0 ? ((tADsum - pADsum) / pADsum) * 100 : null;
  if (wowAD !== null) {
    if (wowAD <= -15) {
      findings.push({
        sev: "red", icon: "🔴",
        title: `Caída fuerte en Conductores Activos`,
        body: `Bajó ${pADsum.toLocaleString()} → ${tADsum.toLocaleString()} (${wowAD.toFixed(1)}% vs ${periodoWord} anterior).`,
        action: `Acción inmediata: cruzar lista de conductores desconectados y lanzar campaña de reactivación. Confirmar si hay problemas operativos (app, comisión, pago).`
      });
    } else if (wowAD <= -5) {
      findings.push({
        sev: "yellow", icon: "🟡",
        title: `Caída moderada en AD (${wowAD.toFixed(1)}%)`,
        body: `Tendencia negativa de ${pADsum} → ${tADsum}.`,
        action: `Monitorear próximas 2 ${periodoWordPlural}. Revisar mix de turnos y desconexiones recientes con el partner.`
      });
    } else if (wowAD >= 15) {
      findings.push({
        sev: "green", icon: "🟢",
        title: `Crecimiento fuerte en AD (+${wowAD.toFixed(1)}%)`,
        body: `Aumentó ${pADsum.toLocaleString()} → ${tADsum.toLocaleString()}.`,
        action: `Aprovechar momentum: validar capacidad operativa, dar más visibilidad a leads Yango y considerar ampliar metas del próximo ${periodoWord}.`
      });
    }
  }

  // ── 3. N+R: caída a cero ──────────────────────────────────────────────────
  if (tNR === 0 && pNR > 0) {
    findings.push({
      sev: "red", icon: "🔴",
      title: `Cero ingresos de conductores este ${periodoWord}`,
      body: `Había ${pNR} nuevos/reactivados el ${periodoWord} anterior — esta vez 0.`,
      action: `Revisar pipeline de onboarding. ¿Está trabado el proceso de documentación? ¿Algún CLID dejó de cargar drivers?`
    });
  } else if (pNR > 0 && tNR / pNR < 0.4 && pNR >= 5) {
    findings.push({
      sev: "yellow", icon: "🟡",
      title: `Ingresos N+R bajaron fuerte (${tNR} vs ${pNR})`,
      body: `Reducción de más del 60% en nuevos drivers.`,
      action: `Confirmar si fue por estacionalidad o problema operativo. Revisar capacidad de onboarding del partner.`
    });
  }

  // ── 4. Recibe leads Yango pero AD no crece ────────────────────────────────
  if (recibeLeads) {
    const leadsLast = lastRows.reduce((s, r) => s + (r.newService || 0), 0);
    if (leadsLast >= 5 && wowAD !== null && wowAD < 3 && wowAD > -5) {
      findings.push({
        sev: "yellow", icon: "🟡",
        title: `${leadsLast} leads Yango sin reflejarse en AD`,
        body: `El partner está recibiendo leads pero su base de conductores no crece.`,
        action: `Revisar tiempo y tasa de conversión lead→activación. Posible cuello de botella en documentación o capacitación inicial. Comparar con benchmark de partners similares.`
      });
    }
  }

  // ── 5. Cumplimiento de metas ──────────────────────────────────────────────
  const metasPartner = (STATE.metasData || []).filter(m => m.partner === partner);
  if (metasPartner.length) {
    // Suma de metas y de actuales (snapshot del último periodo del rango)
    const meta_ad = metasPartner.reduce((s, m) => s + (m.mA  || 0), 0);
    const meta_nr = metasPartner.reduce((s, m) => s + (m.mNR || 0), 0);
    const meta_sh = metasPartner.reduce((s, m) => s + (m.mH  || 0), 0);
    const checkCumpl = (label, actual, meta, accionBaja, accionAlta) => {
      if (meta <= 0) return;
      const pct = (actual / meta) * 100;
      if (pct < 50) {
        findings.push({
          sev: "red", icon: "🔴",
          title: `${label}: cumplimiento ${pct.toFixed(0)}% (crítico)`,
          body: `${fmt(actual)} de ${fmt(meta)} comprometidos. Gap de ${fmt(meta - actual)}.`,
          action: accionBaja
        });
      } else if (pct < 80) {
        findings.push({
          sev: "yellow", icon: "🟡",
          title: `${label}: cumplimiento ${pct.toFixed(0)}%`,
          body: `${fmt(actual)} de ${fmt(meta)}. Falta ${fmt(meta - actual)} para llegar al 100%.`,
          action: `Acelerar las próximas ${periodoWordPlural}. Confirmar con el partner si la meta sigue siendo realista o necesita ajuste.`
        });
      } else if (pct >= 110) {
        findings.push({
          sev: "green", icon: "🟢",
          title: `${label}: sobre-cumplimiento ${pct.toFixed(0)}%`,
          body: `${fmt(actual)} vs ${fmt(meta)} comprometidos (+${fmt(actual - meta)}).`,
          action: accionAlta
        });
      }
    };
    checkCumpl("Conductores Activos", tADsum, meta_ad,
      `Plan de aceleración: identificar conductores con potencial de reactivación y agendar reunión esta ${periodoWord}.`,
      `Caso de éxito. Documentar qué está funcionando y replicarlo en otros partners del mismo KAM.`);
    checkCumpl("Nuevos+Reactivados", tNR, meta_nr,
      `Revisar pipeline de inducción y velocidad de procesamiento de nuevos drivers.`,
      `Excelente captación. Confirmar que el partner tiene capacidad operativa para sostener el ritmo.`);
    checkCumpl("Horas de Conexión", tSH, meta_sh,
      `Revisar turnos y motivar a conductores con bajo % de online. Posible problema de incentivos.`,
      `Excelente productividad por conductor. Evaluar incrementar leads Yango asignados.`);
  } else if (STATE.metasData && STATE.metasData.length) {
    // Hay metas en el sistema pero este partner no tiene
    findings.push({
      sev: "info", icon: "💡",
      title: `Partner sin metas asignadas`,
      body: `El sistema tiene metas para otros partners pero no para este.`,
      action: `Definir metas mensuales con el partner para tener métricas claras de seguimiento.`
    });
  }

  // ── 6. Brecha entre ciudades (multi-ciudad) ───────────────────────────────
  if (citiesOf.length >= 2) {
    const cityPerf = citiesOf.map(c => {
      const last = lastRows.filter(r => r.city === c);
      const ad = last.reduce((s, r) => s + r.activeDrivers, 0);
      return { city: c, ad };
    }).filter(x => x.ad > 0).sort((a, b) => b.ad - a.ad);
    if (cityPerf.length >= 2) {
      const best = cityPerf[0];
      const worst = cityPerf[cityPerf.length - 1];
      const ratio = best.ad / worst.ad;
      if (ratio >= 2.5) {
        findings.push({
          sev: "yellow", icon: "🟡",
          title: `Brecha grande entre ciudades`,
          body: `${cityLabel(best.city)}: ${best.ad} AD vs ${cityLabel(worst.city)}: ${worst.ad} AD (${ratio.toFixed(1)}x diferencia).`,
          action: `Replicar el modelo de operación de ${cityLabel(best.city)} en ${cityLabel(worst.city)}. Preguntar al partner qué hacen distinto en la mejor ciudad.`
        });
      }
    }
  }

  // ── 7. Comisión baja sin caída en viajes ─────────────────────────────────
  const pTr = prevRows.reduce((s, r) => s + (r.trips || 0), 0);
  const pCo = prevRows.reduce((s, r) => s + (r.commission || 0), 0);
  if (pTr > 0 && pCo > 0) {
    const wowTr = ((tTr - pTr) / pTr) * 100;
    const wowCo = ((tCo - pCo) / pCo) * 100;
    if (wowCo < -10 && wowTr > -3) {
      findings.push({
        sev: "yellow", icon: "🟡",
        title: `Comisión baja sin caer viajes`,
        body: `Viajes ${wowTr >= 0 ? "+" : ""}${wowTr.toFixed(1)}%, comisión ${wowCo.toFixed(1)}%.`,
        action: `Posible cambio en tarifa promedio o mix de servicios. Revisar tipos de viaje predominantes y promociones activas.`
      });
    }
  }

  // ── 8. Si no hay alertas, mostrar mensaje positivo ────────────────────────
  // Pero solo si hay datos suficientes para juzgar
  if (!findings.length && pADsum > 0) {
    findings.push({
      sev: "green", icon: "✅",
      title: "Sin alertas críticas",
      body: "Métricas dentro de parámetros normales en el último período.",
      action: `Mantener seguimiento regular. Buen momento para revisar metas del próximo ${periodoWord} con el partner.`
    });
  }

  // ── Ordenar y limitar a 6 hallazgos máximo ────────────────────────────────
  const sevOrder = { red: 0, yellow: 1, info: 2, green: 3 };
  findings.sort((a, b) => sevOrder[a.sev] - sevOrder[b.sev]);
  const top = findings.slice(0, 6);

  // ── Render ────────────────────────────────────────────────────────────────
  const sevStyle = {
    red:    { bg:"#fff5f5", bd:"#fecaca", tc:"#991b1b" },
    yellow: { bg:"#fffbeb", bd:"#fde68a", tc:"#92400e" },
    green:  { bg:"#f0fdf4", bd:"#86efac", tc:"#166534" },
    info:   { bg:"#f0f9ff", bd:"#bae6fd", tc:"#075985" }
  };

  const items = top.map(f => {
    const s = sevStyle[f.sev] || sevStyle.info;
    return `
      <div style="background:${s.bg};border:1px solid ${s.bd};border-left:4px solid ${s.tc};border-radius:8px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:1rem">${f.icon}</span>
          <span style="font-weight:800;color:${s.tc};font-size:.88rem">${escapeHTML(f.title)}</span>
        </div>
        <div style="font-size:.78rem;color:#333;margin-bottom:6px;line-height:1.4">${escapeHTML(f.body)}</div>
        <div style="font-size:.76rem;color:#555;line-height:1.45">
          <strong style="color:${s.tc}">Acción:</strong> ${escapeHTML(f.action)}
        </div>
      </div>`;
  }).join("");

  const headerSub = `${top.length} ${top.length === 1 ? "hallazgo" : "hallazgos"} priorizados · Mirada de KAM senior sobre el partner`;
  return `
    ${_secH("💼", "#0ea5e9", "Análisis Ejecutivo", headerSub)}
    <div class="section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
      ${items}
    </div>`;
}

function _pvKpiCard(label, cur, prev, color, isMoney = false) {
  const value = isMoney ? `$${fmt(cur)}` : fmt(cur);
  const bdgHtml = prev !== null ? bdgMode(cur, prev, "mb-badge") : "";
  return `
    <div style="background:#fff;border:1px solid #eee;border-top:3px solid ${color};border-radius:10px;padding:10px 12px">
      <div style="font-size:.66rem;color:#666;font-weight:700;text-transform:uppercase;letter-spacing:.4px">${escapeHTML(label)}</div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:2px">
        <span style="font-size:1.15rem;font-weight:900;color:#111">${value}</span>
        ${bdgHtml}
      </div>
    </div>`;
}

function _pvCitySection(partner, city, dates, recibeLeads, seriesCached) {
  const cityColor = CITY_COLORS[city] || "#888";
  const series = seriesCached || _pvSeriesByPartnerCity(partner, city, dates);
  // Tendencia: comparar promedio últimos 3 vs anteriores 3 (si hay datos)
  let trendTxt = "—", trendCol = "#888";
  if (series.length >= 6) {
    const last3 = series.slice(-3);
    const prev3 = series.slice(-6, -3);
    const avgL = last3.reduce((s, x) => s + x.ad, 0) / 3;
    const avgP = prev3.reduce((s, x) => s + x.ad, 0) / 3;
    if (avgP > 0) {
      const chg = ((avgL - avgP) / avgP) * 100;
      trendTxt = `${chg >= 0 ? "↑" : "↓"} ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% AD (últ. 3 vs ant. 3)`;
      trendCol = chg >= 0 ? "#10b981" : "#FF0000";
    }
  }

  const id = city.toLowerCase().replace(/[^a-z0-9]/g, "");

  return `
    <div style="border:1px solid #eee;border-top:3px solid ${cityColor};border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:12px;height:12px;border-radius:50%;background:${cityColor}"></span>
          <span style="font-size:1rem;font-weight:800;color:#111">${escapeHTML(city)}</span>
        </div>
        <span style="font-size:.72rem;color:${trendCol};font-weight:700">${trendTxt}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
        <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(METRICS.ad.label)}</span></div><div id="pv_${id}_ad"></div></div>
        <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(METRICS.sh.label)}</span></div><div id="pv_${id}_sh"></div></div>
        <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(METRICS.nr.label)} ${recibeLeads ? "(desglose)" : ""}</span></div><div id="pv_${id}_nr"></div></div>
        <div class="chart-card"><div class="chart-head"><span class="chart-title">Viajes & Comisión</span></div><div id="pv_${id}_tc"></div></div>
      </div>
    </div>`;
}

function _pvBuildCityCharts(partner, city, dates, recibeLeads, seriesCached) {
  const id = city.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cityColor = CITY_COLORS[city] || "#888";
  const series = seriesCached || _pvSeriesByPartnerCity(partner, city, dates);
  const labels = dates.map(d2s);

  // Chart 1: AD (línea simple)
  _pvSimpleLine(`pv_${id}_ad`, labels, [{ name: "AD", data: series.map(s => s.ad) }], [cityColor]);

  // Chart 2: SH (línea simple)
  _pvSimpleLine(`pv_${id}_sh`, labels, [{ name: "SH", data: series.map(s => s.sh) }], ["#8b5cf6"]);

  // Chart 3: N+R desglosado o agregado
  const nrSeries = recibeLeads
    ? [
        { name: "Nuevos (Partner)",  data: series.map(s => s.npPartner) },
        { name: "Nuevos (Yango)",    data: series.map(s => s.npService) },
        { name: "Reactivados",       data: series.map(s => s.reactivated) }
      ]
    : [
        { name: "Nuevos (Partner)",  data: series.map(s => s.npPartner) },
        { name: "Reactivados",       data: series.map(s => s.reactivated) }
      ];
  const nrColors = recibeLeads ? ["#3b82f6", "#f59e0b", "#10b981"] : ["#3b82f6", "#10b981"];
  _pvStackedColumn(`pv_${id}_nr`, labels, nrSeries, nrColors);

  // Chart 4: Trips & Commission (mixed)
  _pvDualLine(`pv_${id}_tc`, labels,
    [{ name: "Viajes", data: series.map(s => s.trips) },
     { name: "Comisión", data: series.map(s => s.commission) }],
    ["#10b981", "#06b6d4"]);
}

function _pvSimpleLine(elId, labels, series, colors) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  // Marcar el contenedor con clase para que las reglas CSS de fondo claro
  // (styles.css .pv-chart .apexcharts-datalabel-background) apliquen.
  el.classList.add("pv-chart");
  const ch = new ApexCharts(el, {
    series,
    chart: { type: "line", height: 180, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    stroke: { curve: "smooth", width: 2.5 },
    colors,
    markers: { size: 3 },
    // dataLabels: numeros visibles sobre la linea. El FILL del background lo
    // setea ApexCharts segun la serie (negro/oscuro por default) y NO se puede
    // cambiar via API. Forzamos blanco con CSS en styles.css.
    dataLabels: {
      enabled: true,
      formatter: v => fmt(v),
      style: { fontSize: "9px", colors: ["#222"], fontWeight: 700 },
      background: { enabled: true, foreColor: "#222", padding: 3, borderRadius: 3, borderColor: "#e5e5e5", borderWidth: 1, opacity: 1 },
      offsetY: -8
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { formatter: v => fmt(v), style: { fontSize: "10px" } } },
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4 },
    tooltip: { y: { formatter: v => fmt(v) } },
    legend: { show: false }
  });
  ch.render();
  PARTNER_VIEW_STATE.charts.push(ch);
}

function _pvStackedColumn(elId, labels, series, colors) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  const ch = new ApexCharts(el, {
    series,
    chart: { type: "bar", height: 180, stacked: true, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    plotOptions: { bar: { columnWidth: "60%", dataLabels: { position: "center" } } },
    colors,
    // dataLabels chicos para que entren dentro de cada segmento de la barra.
    // Solo se muestran si el valor es >= 3 (evita ruido en segmentos minusculos).
    dataLabels: {
      enabled: true,
      formatter: v => (v >= 3 ? fmt(v) : ""),
      style: { fontSize: "8px", colors: ["#fff"], fontWeight: 700 },
      dropShadow: { enabled: true, top: 1, left: 1, blur: 1, opacity: .35 }
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 } },
    yaxis: { labels: { formatter: v => fmt(v), style: { fontSize: "10px" } } },
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4 },
    tooltip: { y: { formatter: v => fmt(v) } },
    legend: { position: "bottom", fontSize: "10px", itemMargin: { horizontal: 6 } }
  });
  ch.render();
  PARTNER_VIEW_STATE.charts.push(ch);
}

function _pvDualLine(elId, labels, series, colors) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  const ch = new ApexCharts(el, {
    series,
    chart: { type: "line", height: 180, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    stroke: { curve: "smooth", width: [2.5, 2.5] },
    colors,
    markers: { size: 3 },
    dataLabels: {
      enabled: true,
      enabledOnSeries: [0, 1],
      formatter: (v, opts) => opts.seriesIndex === 1 ? "$" + fmt(v) : fmt(v),
      style: { fontSize: "9px", colors: ["#222"], fontWeight: 700 },
      background: { enabled: true, foreColor: "#222", padding: 3, borderRadius: 3, borderColor: "#e5e5e5", borderWidth: 1, opacity: 1 },
      offsetY: -8
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 } },
    yaxis: [
      { seriesName: "Viajes", labels: { formatter: v => fmt(v), style: { fontSize: "10px" } } },
      { opposite: true, seriesName: "Comisión", labels: { formatter: v => "$" + fmt(v), style: { fontSize: "10px" } } }
    ],
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4 },
    tooltip: { y: { formatter: (v, { seriesIndex }) => seriesIndex === 1 ? "$" + fmt(v) : fmt(v) } },
    legend: { position: "bottom", fontSize: "10px" }
  });
  ch.render();
  PARTNER_VIEW_STATE.charts.push(ch);
}

// ── INTERACCIONES ─────────────────────────────────────────────────────────────
function pvOnPartnerChange(p) {
  PARTNER_VIEW_STATE.partner = p;
  renderPartnerView();
}

function pvOnPeriodChange(p) {
  PARTNER_VIEW_STATE.period = p;
  renderPartnerView();
}

// ── COMBOBOX FLOTANTE DE PARTNERS ─────────────────────────────────────────────
// Reemplaza el <select> nativo que se cerraba en cada keystroke. La lista es
// un <div> flotante que NO se re-renderiza (solo cambian items visibles),
// asi que el input nunca pierde focus y se puede hacer click en una opcion.
function pvFilterPartners(q) {
  pvShowPartnerList();
  _pvPaintPartnerList(q);
}

function pvShowPartnerList() {
  const list = document.getElementById("pvPartnerList");
  if (!list) return;
  list.style.display = "block";
  if (!list.innerHTML) {
    const inp = document.getElementById("pvSearch");
    _pvPaintPartnerList(inp ? inp.value : "");
  }
}

function pvHidePartnerList() {
  const list = document.getElementById("pvPartnerList");
  if (list) list.style.display = "none";
}

function _pvPaintPartnerList(q) {
  const list = document.getElementById("pvPartnerList");
  if (!list) return;
  const lower = (q || "").toLowerCase().trim();
  const filtered = lower
    ? STATE.allPartners.filter(p => p.toLowerCase().includes(lower))
    : STATE.allPartners;
  if (!filtered.length) {
    list.innerHTML = `<div style="padding:8px 12px;font-size:.78rem;color:#aaa">Sin coincidencias</div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 100).map(p => {
    const c = STATE.partnerColors[p] || "#888";
    const sel = p === PARTNER_VIEW_STATE.partner;
    return `<div class="pv-opt" onmousedown="pvSelectPartner('${p.replace(/'/g,"\\'")}')"
      style="padding:7px 12px;font-size:.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid #f3f3f3;${sel?'background:#fff0f0;font-weight:700':''}">
      <span style="width:7px;height:7px;border-radius:50%;background:${c};flex-shrink:0"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(p)}</span>
    </div>`;
  }).join("");
}

function pvSelectPartner(p) {
  // onmousedown asegura que esto corra ANTES del onblur del input (que oculta la lista)
  const inp = document.getElementById("pvSearch");
  if (inp) inp.value = p;
  pvHidePartnerList();
  pvOnPartnerChange(p);
}

function pvSearchKeydown(e) {
  if (e.key === "Enter") {
    const list = document.getElementById("pvPartnerList");
    const first = list && list.querySelector(".pv-opt");
    if (first) {
      // Reusar el handler del onmousedown
      first.dispatchEvent(new MouseEvent("mousedown"));
    }
    e.preventDefault();
  } else if (e.key === "Escape") {
    pvHidePartnerList();
  }
}

// ── OPCIONES DINAMICAS DE PERIODO ─────────────────────────────────────────────
// Etiquetas claras segun el modo actual (semanal/mensual/diario). Antes decian
// "Ultimos 3 (cortos)", "Ultimos 6" sin unidad — confuso.
function _pvPeriodOptions(period, periodLabel) {
  const mode = STATE.curMode;
  const unit = mode === "mensual" ? "meses" : mode === "diario" ? "días" : "semanas";
  return `
    <option value="auto" ${period==="auto"?"selected":""}>Auto (${periodLabel})</option>
    <option value="3m"   ${period==="3m" ?"selected":""}>Últim${unit==="meses"?"os 3":unit==="días"?"os 3":"as 3"} ${unit}</option>
    <option value="6m"   ${period==="6m" ?"selected":""}>Últim${unit==="meses"?"os 6":unit==="días"?"os 6":"as 6"} ${unit}</option>
    <option value="12m"  ${period==="12m"?"selected":""}>Últim${unit==="meses"?"os 12":unit==="días"?"os 12":"as 12"} ${unit}</option>`;
}

// ── EXPORT PDF ────────────────────────────────────────────────────────────────
async function pvDownloadPDF() {
  const partner = PARTNER_VIEW_STATE.partner;
  if (!partner) { alert("Selecciona un partner primero."); return; }
  if (!window.jspdf || !window.html2canvas) { alert("Librerias PDF no disponibles."); return; }

  showLoad(true, "Generando PDF...");
  await new Promise(r => setTimeout(r, 200));
  try {
    const content = document.getElementById("partnerViewContent");
    const canvas = await html2canvas(content, { scale: 2, useCORS: true, logging: false, backgroundColor: "#fff" });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
    pdf.save(`${partner}_${STATE.curMode}_${(new Date()).toISOString().slice(0,10)}.pdf`);
    showBanner(true, "PDF descargado");
  } catch (err) {
    alert("Error al generar PDF: " + err.message);
    console.error(err);
  } finally {
    showLoad(false);
  }
}
