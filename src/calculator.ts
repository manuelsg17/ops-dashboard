//@ts-nocheck
import { ensureHtml2Canvas } from "./shared/lazyLibs.js";
import { t } from "./core/i18n";
import { validarMetas, mensajeMetasInvalidas } from "./domain/metasGuard";
import { logAccess } from "./shared/accessLog.js";
// calculator.js — Calculadora de Metas (flujo por PESTAÑAS de línea de negocio)
// El KAM ingresa su meta TOTAL por línea y se reparte (disgrega) a cada partner+ciudad
// segun su % de representacion en el ULTIMO MES. En vez de un scroll con 6+ tablas,
// se navega por pestañas: Agregador / Fleet / TukTuk / Revisar y compartir.
// Solo se muestra la pestaña activa (primera pantalla corta); la cabecera persistente
// lleva el selector de KAM + una barra de estado con el cuadre EN VIVO de cada línea.
// Las pestañas Fleet/TukTuk solo aparecen si el KAM tiene esos partners.

export const CALC_STATE = {
  kam:        "all",
  tab:        "agg",   // pestaña activa: "agg" | "fleet" | "tk" | "review"
  // Metas editadas manualmente: { "partner|||city|||metric": valor }
  edits:      {},
  // Utilización Fleet sembrada en 85 (default estándar) por key ya sembrada — así
  // el 85 visible en la pestaña Fleet llega a la tarjeta y al guardado; borrable.
  _utilSeeded: {},
  // Metas KAM input manual (formato Yango con pesos) + metas TukTuk (Fase 7)
  kamGoals:   { ad: 0, sh: 0, nr: 0, otherProj: 0, fleetA2: 0 },
  // Idioma de la tarjeta compartible: "es" | "en" | "es-en" (bilingüe, default)
  exportLang: "es-en",

  // ── METAS YA GUARDADAS EN BD (ago 2026) ────────────────────────────────────
  // `saved` = lo que HOY está en la tabla `metas` para el mes objetivo, con la
  // misma forma de clave que `edits` ("partner|||city|||metric"). Se siembra en
  // `edits` al abrir para que el KAM VEA lo que ya cargó en vez de campos en 0
  // (antes la calculadora arrancaba siempre vacía y no había forma de saber qué
  // partners ya tenían meta sin ir a la pestaña Metas).
  saved:      {},
  // Mes+KAM ya sembrado, para no re-sembrar en cada render y pisar lo que el
  // usuario está escribiendo. Formato "MES-AÑO|||kam".
  savedKey:   "",
  // Cómo escribe el botón de guardar:
  //   "edits" → SOLO los (partner,ciudad,KPI) que cambiaron respecto de `saved`.
  //             El resto de las metas del mes queda intacto. Es el default: un
  //             ajuste puntual no debe reescribir el reparto entero.
  //   "full"  → el reparto completo (comportamiento histórico), para cuando se
  //             arma el mes desde cero con un goal de KAM.
  saveMode:   "edits"
};

// Pesos Yango (formato KAM-level)
export const KAM_WEIGHTS = {
  ad:        15,    // %
  sh:        15,
  nr:        27.5,
  otherProj: 35,
  fleetA2:    7.5
};

// Métricas por línea (estáticas). get(e) sobre una fila agregada partner-ciudad.
export const CALC_TAXI_METRICS = [
  { key: "ad", label: "AD",  get: e => e.ad },
  { key: "sh", label: "SH",  get: e => e.sh },
  { key: "nr", label: "N+R", get: e => e.np + e.ns + e.re }
];
// ── HELPER: dataset mensual (rendimiento_mensual) ─────────────────────────────
// Base del reparto = COMBINADO Taxi + TukTuk (decisión de Manuel, ago 2026).
// Antes era solo Taxi y TukTuk tenía su propia meta; ahora TukTuk entra al mismo
// reparto y deja de tener meta propia (pasa a monitoreo de otras métricas).
//
// OJO con el denominador: el goal que escribe el KAM tiene que ser COMBINADO
// también. Si el denominador sube y el goal no, todo partner sin TukTuk pierde
// cuota por pura dilución (medido en Lima jul-2026: 32.527/37.682 = −13,7%).
// Por eso _calcAggGoalsBlock muestra el AD combinado del último mes como referencia.
//
// Delivery (`exclude_from_taxi`) sigue AFUERA: son conjuntos disjuntos verificados
// contra la BD (15 fleetrooms is_tuktuk, 15 exclude_from_taxi, cero solape), y
// rawDataMensual ya excluye ambos, así que el concat da exactamente Taxi+TukTuk.
export function _calcGetMensualData() {
  const taxi = (STATE.rawDataMensual && STATE.rawDataMensual.length)
    ? STATE.rawDataMensual
    : (STATE.rawData || []);
  const tk = STATE.rawDataMensualTuktuk || [];
  return tk.length ? taxi.concat(tk) : taxi;
}

// Devuelve los N últimos meses (claves YYYY-MM) presentes en el dataset
export function _calcLastNMonths(rows, n) {
  const months = [...new Set(rows.map(r => r.date))].sort();
  return months.slice(-n);
}

// Agrega por partner+city sobre un set de meses específicos.
// Devuelve Map<"partner|||city", { clid, trips, sh, ad, np, ns, re, partner, city, kam }>
export function _calcAggByPartnerCity(rows, monthsSet) {
  const out = new Map();
  rows.forEach(r => {
    if (!monthsSet.has(r.date)) return;
    const k = `${r.partner}|||${r.city}`;
    let e = out.get(k);
    if (!e) {
      e = { clid: r.clid || "", partner: r.partner, city: r.city, kam: r.kam,
            trips: 0, sh: 0, ad: 0, np: 0, ns: 0, re: 0, bcars: 0,
            acceptW: 0, intSh: 0, ownedCars: 0, _adByDate: {}, _bcarsByDate: {} };
      out.set(k, e);
    }
    if (!e.clid && r.clid) e.clid = r.clid;
    e.trips += r.trips || 0;
    e.sh    += r.supplyHours || 0;
    // AD y branded cars son SNAPSHOT: los fleetrooms (db_id distintos) de la MISMA
    // fecha se SUMAN (son conductores/autos distintos) y se toma el MÁX entre fechas.
    // Antes se hacía max sobre TODAS las filas → sub-contaba partners multi-fleetroom
    // (tomaba el fleetroom más grande, no la suma). Espeja getRPC (metas.js/Rendimiento).
    e._adByDate[r.date]    = (e._adByDate[r.date]    || 0) + (r.activeDrivers || 0);
    e._bcarsByDate[r.date] = (e._bcarsByDate[r.date] || 0) + (r.brandedActiveCars || 0);
    e.np    += r.newPartner || 0;
    e.ns    += r.newService || 0;
    e.re    += r.reactivated || 0;
    // Referencias fleet (tasas). SH/Auto interno = Σ internal_fleet_sh / Σ owned_fleet_active_cars
    // (MISMA definición que usa el deck/Metas como ACTUAL; antes se usaba sh_per_active_car
    // que medía otra cosa → la meta que fijaba el KAM nunca cuadraba con el actual).
    // Acceptance (0-1) ponderada por viajes.
    e.intSh     += r.internalFleetSh || 0;
    e.ownedCars += r.ownedFleetActiveCars || 0;
    e.acceptW   += (r.acceptanceRate || 0) * (r.trips || 0);
  });
  // Colapsar snapshots: máx sobre fechas de la suma por fecha (suma de fleetrooms).
  for (const e of out.values()) {
    const ads = Object.values(e._adByDate), bcs = Object.values(e._bcarsByDate);
    e.ad    = ads.length ? Math.max(...ads) : 0;
    e.bcars = bcs.length ? Math.max(...bcs) : 0;
    delete e._adByDate; delete e._bcarsByDate;
  }
  return out;
}

// Referencia 3m (promedio ponderado) de los KPIs fleet de un partner-ciudad.
export function _calcFleetRef(e) {
  return {
    shcar:  e.ownedCars > 0 ? e.intSh / e.ownedCars : null,      // SH interno / auto propio (= deck/Metas)
    accept: e.trips > 0 ? (e.acceptW / e.trips) * 100 : null     // % (0-100)
  };
}

// Fallback: busca el CLID de un partner+city en los datasets si la fila agregada no lo tiene.
export function _calcLookupClid(partner, city) {
  const datasets = [STATE.rawDataMensual, STATE.rawData, STATE.rawDataDiario];
  for (const ds of datasets) {
    if (!ds || !ds.length) continue;
    const row = ds.find(r => r.partner === partner && r.city === city && r.clid);
    if (row) return row.clid;
  }
  for (const [clid, p] of Object.entries(STATE.CLID_MAP || {})) {
    if (p === partner) return clid;
  }
  return "";
}

// Totales del KAM (base para repartir): suma de los valores de cada partner+ciudad.
// opts.excludeFleet salta partners fleet (isFleetPartner) → los NO-fleet suman 100%
// (el reparto de agregador no depende de partners fleet). Incluye cars (TukTuk).
export function _calcKamTotals(agg, opts) {
  const skipFleet = opts && opts.excludeFleet;
  let ad = 0, sh = 0, nr = 0, cars = 0;
  for (const e of agg.values()) {
    if (skipFleet && _calcIsFleet(e.partner)) continue;
    ad += e.ad; sh += e.sh; nr += (e.np + e.ns + e.re); cars += e.bcars || 0;
  }
  return { ad, sh, nr, cars };
}
// Totales por CIUDAD para UN mes, sobre TODOS los partners (NO filtrado por KAM):
// es el denominador exacto del "peso de Yego en Lima". Reusa _calcAggByPartnerCity
// (mismo criterio de agregación: AD/cars = max, resto suma) y colapsa por ciudad.
export function _calcCityTotals(month, rows) {
  const aggFull = _calcAggByPartnerCity(rows || [], new Set([month]));
  const byCity = new Map();
  for (const e of aggFull.values()) {
    let c = byCity.get(e.city);
    if (!c) { c = { ad: 0, sh: 0, nr: 0, cars: 0 }; byCity.set(e.city, c); }
    c.ad += e.ad; c.sh += e.sh; c.nr += (e.np + e.ns + e.re); c.cars += e.bcars || 0;
  }
  return byCity;
}
export function _calcShare(val, tot) { return tot > 0 ? val / tot : 0; }
export function _calcIsFleet(partner) { return typeof isFleetPartner === "function" && isFleetPartner(partner); }

// Bases distribuidas de AGREGADOR (AD/SH/N+R) para un partner-ciudad.
// Los partners Fleet SÍ se reparten con la MISMA ecuación (goal × share) y el
// denominador incluye a TODOS (cartTotals) → así no se sobre-exige a los no-fleet.
// `fleet` queda solo como badge. `noAct` marca partners sin actividad Taxi el último
// mes (share 0 → meta 0): se resaltan para fijar la meta a mano (decisión del KAM).
export function _calcAggMetaBases(e, g, cartTotals) {
  const fleet = _calcIsFleet(e.partner);
  const nr = e.np + e.ns + e.re;
  const noAct = (e.ad + e.sh + nr) === 0;
  return {
    ad: (+g.ad || 0) * _calcShare(e.ad, cartTotals.ad),
    sh: (+g.sh || 0) * _calcShare(e.sh, cartTotals.sh),
    nr: (+g.nr || 0) * _calcShare(nr,  cartTotals.nr),
    fleet, noAct
  };
}
// ── METAS YA GUARDADAS ───────────────────────────────────────────────────────
// Lee de STATE.metasData lo que hoy existe en BD para (mesName, mesYear) y lo
// devuelve con la MISMA forma de clave que CALC_STATE.edits, para que sembrar y
// comparar sea trivial. `partner`/`city` de metasData ya vienen normalizados por
// el loader (CLID_MAP + normCity), igual que el agregado de la calculadora, así
// que las claves coinciden sin re-normalizar nada acá.
//
// Columna → métrica: solo las que la calculadora escribe. TukTuk (mtk*) queda
// afuera a propósito: la calculadora ya no las edita (TukTuk entra al reparto
// del agregador desde ago 2026) pero el merge del guardado las preserva.
export function _calcMetasGuardadas(mesName, mesYear) {
  const out = {};
  if (!mesName) return out;
  (STATE.metasData || []).forEach(m => {
    if (m.mes !== mesName) return;
    // Año: si ambos lados lo tienen y difieren, es OTRO año (ver _metasMatchMes
    // en metas.ts). Una fila sin mes_year (upload viejo) no se puede descartar.
    if (mesYear != null && m.mYear != null && m.mYear !== mesYear) return;
    const base = `${m.partner}|||${m.city}`;
    // OJO con las 3 del agregador: el loader hace `+m.meta_active_drivers`, así
    // que un NULL de BD llega como 0 y NO se puede distinguir de una meta de 0
    // real. Se toma >0 como "tiene meta" — una meta de 0 conductores no es una
    // meta, y sembrar 0s falsos llenaría la tabla de valores que nadie cargó.
    // Las de Fleet sí preservan null en el loader, así que ahí basta != null.
    if (m.mA     > 0)     out[`${base}|||ad`]     = m.mA;
    if (m.mNR    > 0)     out[`${base}|||nr`]     = m.mNR;
    if (m.mH     > 0)     out[`${base}|||sh`]     = m.mH;
    if (m.mSHcar != null) out[`${base}|||shcar`]  = m.mSHcar;
    if (m.mAcc   != null) out[`${base}|||accept`] = m.mAcc;
    if (m.mUtil  != null) out[`${base}|||util`]   = m.mUtil;
  });
  return out;
}

// Siembra `saved` en `edits` UNA vez por (mes, KAM): así los inputs muestran lo
// que ya está en BD en vez de 0. No re-siembra en cada render — pisaría lo que
// el usuario está tecleando.
export function _calcSeedGuardadas(mesName, mesYear) {
  const key = `${mesName}-${mesYear}|||${CALC_STATE.kam}`;
  if (CALC_STATE.savedKey === key) return;
  CALC_STATE.savedKey = key;
  CALC_STATE.saved = _calcMetasGuardadas(mesName, mesYear);
  // Solo sembrar donde el usuario todavía no escribió nada en esta sesión.
  Object.keys(CALC_STATE.saved).forEach(k => {
    if (CALC_STATE.edits[k] === undefined) CALC_STATE.edits[k] = CALC_STATE.saved[k];
  });
}

// ¿Este (partner,ciudad,métrica) ya tiene meta guardada en BD para el mes?
export function _calcYaGuardada(partner, city, metric) {
  return CALC_STATE.saved[`${partner}|||${city}|||${metric}`] !== undefined;
}
// ¿Alguna de las métricas del agregador ya está guardada para esa fila?
export function _calcFilaGuardada(partner, city) {
  return ["ad", "sh", "nr"].some(mt => _calcYaGuardada(partner, city, mt));
}

// Meta distribuida o edit manual para un partner+city+metric.
export function _calcGoalFor(partner, city, metric, base) {
  const k = `${partner}|||${city}|||${metric}`;
  if (CALC_STATE.edits[k] !== undefined) return +CALC_STATE.edits[k] || 0;
  return Math.round(base);
}

// Heatmap helpers (% de representación)
export function _calcHeatColor(pct) {
  if (pct >= 20) return "#10b981";
  if (pct >= 10) return "#22c55e";
  if (pct >= 5)  return "#f59e0b";
  if (pct >= 1)  return "#fb923c";
  return "#FF0000";
}
export function _calcHeatBg(pct) {
  if (pct >= 20) return "#bbf7d0";
  if (pct >= 10) return "#d9f99d";
  if (pct >= 5)  return "#fef3c7";
  if (pct >= 1)  return "#fed7aa";
  return "#fecaca";
}

// ── MODELO EN MEMORIA ─────────────────────────────────────────────────────────
// Deriva todos los agregados que necesita la pestaña activa + la barra de estado.
// Barato (todo en memoria); lo llaman renderCalculator Y _calcRefreshStatus.
export function _calcComputeModel() {
  const rows = _calcGetMensualData();
  const allMonths = [...new Set(rows.map(r => r.date))].sort();
  const last3 = allMonths.slice(-3);
  const last3Set = new Set(last3);
  const lastMonth = allMonths[allMonths.length - 1];

  const filteredRows = CALC_STATE.kam === "all"
    ? rows
    : rows.filter(r => (r.kam || getKAMForPartner(r.partner)) === CALC_STATE.kam);

  // Agregados TAXI: 3M para el promedio y las refs fleet; ÚLTIMO MES para
  // representación y reparto (así el % que se ve = el que reparte). distTot1 excluye fleet.
  const aggLast3 = _calcAggByPartnerCity(filteredRows, last3Set);
  const aggLast1 = _calcAggByPartnerCity(filteredRows, new Set([lastMonth]));
  const cartTot1 = _calcKamTotals(aggLast1);
  // Denominador del reparto = TODOS los partners (incl. Fleet). Antes excluía Fleet
  // (distTot1) y eso sobre-exigía a los demás; ahora Fleet se reparte igual (decisión 1).
  const distTot1 = cartTot1;
  // Totales de ciudad sobre la MISMA base combinada que el reparto. Si acá se
  // usara el dataset taxi-only, el "peso en la ciudad" no cerraría con la cuota
  // asignada para los partners que tienen TukTuk.
  const cityTot1 = _calcCityTotals(lastMonth, rows);

  const hasFleet = [...aggLast3.values()].some(e => _calcIsFleet(e.partner));

  return { rows, last3, lastMonth, aggLast3, aggLast1, cartTot1, distTot1, cityTot1, hasFleet };
}

// Array de pestañas visibles (adaptativo). Agregador y Revisar siempre; Fleet solo
// si el KAM lo tiene. La pestaña TukTuk se retiró (ago 2026): TukTuk ya no tiene
// meta propia, entra al reparto del agregador.
export function _calcBuildTabs(m) {
  const tabs = [{ key: "agg", label: t("rend.linea.agg") }];
  if (m.hasFleet) tabs.push({ key: "fleet", label: "Fleet" });
  tabs.push({ key: "review", label: t("calc.tabRevisar") });
  return tabs;
}

// ── ESTADO / CUADRE ───────────────────────────────────────────────────────────
// Cuadre de una métrica: sum distribuida vs meta KAM (misma tolerancia que _calcCuadre).
export function _calcMetricCuadre(sum, target) {
  const hasGoal = target > 0;
  const gap = sum - target;
  const ok = hasGoal && Math.abs(gap) <= Math.max(1, target * 0.005);
  return { sum, target, gap, ok, hasGoal };
}

// Sumas distribuidas de agregador (respeta edits). Incluye Fleet (ahora se reparte
// como el resto) → Σ(todos) = meta KAM y el cuadre balancea.
export function _calcAggDistSums(agg, distTotals, g) {
  let sumAD = 0, sumSH = 0, sumNR = 0;
  for (const e of agg.values()) {
    const b = _calcAggMetaBases(e, g, distTotals);
    sumAD += _calcGoalFor(e.partner, e.city, "ad", b.ad);
    sumSH += _calcGoalFor(e.partner, e.city, "sh", b.sh);
    sumNR += _calcGoalFor(e.partner, e.city, "nr", b.nr);
  }
  return { sumAD, sumSH, sumNR };
}

// Conteo fleet: partner-ciudades con SH/Auto o Aceptación cargados (los KPIs que
// requieren entrada manual). Utilización se excluye porque viene con default 85 →
// contarla inflaría el "con meta" y perdería el sentido del aviso "falta meta".
export function _calcFleetMetaCount(agg) {
  const fleet = [...agg.values()].filter(e => _calcIsFleet(e.partner));
  let filled = 0;
  for (const e of fleet) {
    const has = ["shcar", "accept"].some(mtr => {
      const v = CALC_STATE.edits[`${e.partner}|||${e.city}|||${mtr}`];
      return v !== undefined && v !== "";
    });
    if (has) filled++;
  }
  return { filled, total: fleet.length };
}

// Estado completo de las 3 líneas (para píldoras + puntos de pestaña).
export function _calcComputeStatus(m) {
  const g = CALC_STATE.kamGoals;
  const a = _calcAggDistSums(m.aggLast1, m.distTot1, g);
  const agg = {
    ad: _calcMetricCuadre(a.sumAD, +g.ad || 0),
    sh: _calcMetricCuadre(a.sumSH, +g.sh || 0),
    nr: _calcMetricCuadre(a.sumNR, +g.nr || 0)
  };
  let fleet = null;
  if (m.hasFleet) fleet = _calcFleetMetaCount(m.aggLast3);
  return { agg, fleet, hasFleet: m.hasFleet };
}

// Rollup de una línea agregador/tuktuk a un glifo/color (para el punto de pestaña).
export function _calcLineRollup(line) {
  const parts = Object.values(line).filter(p => p && p.hasGoal);
  if (!parts.length) return { glyph: "○", color: "#aaa" };
  return parts.every(p => p.ok)
    ? { glyph: "✓", color: "#10b981" }
    : { glyph: "⚠", color: "#f59e0b" };
}

// ── CABECERA + BARRA DE ESTADO + BARRA DE PESTAÑAS ────────────────────────────
export function _calcPill(label, body) {
  return `<span class="agy-style-87">
    <b class="agy-style-88">${escapeHTML(label)}</b> ${body}</span>`;
}
// Cuerpo de píldora por línea agregador/tuktuk: por métrica ✓ o el gap coloreado.
export function _calcLinePillBody(line, defs) {
  const anyGoal = defs.some(([, k]) => line[k] && line[k].hasGoal);
  if (!anyGoal) return `<span class="agy-style-89">${escapeHTML(t("calc.sinMetas"))}</span>`;
  return defs.map(([lbl, k]) => {
    const p = line[k];
    if (!p || !p.hasGoal) return `<span class="agy-style-90">${lbl} —</span>`;
    if (p.ok) return `<span class="agy-style-91">${lbl} ✓</span>`;
    const sign = p.gap > 0 ? "+" : "";
    const col  = p.gap > 0 ? "#f59e0b" : "#FF0000";
    return `<span style="color:${col};font-weight:700">${lbl} ${sign}${fmt(p.gap)}</span>`;
  }).join(` <span class="agy-style-77">·</span> `);
}
export function _calcStatusPills(status) {
  const pills = [];
  pills.push(_calcPill(t("rend.linea.agg"), _calcLinePillBody(status.agg, [["AD", "ad"], ["SH", "sh"], ["N+R", "nr"]])));
  if (status.hasFleet && status.fleet) {
    const f = status.fleet;
    const c = f.total === 0 ? "#aaa" : (f.filled >= f.total ? "#10b981" : "#f59e0b");
    pills.push(_calcPill("Fleet", `<span style="color:${c};font-weight:700">${f.filled}/${f.total} ${escapeHTML(t("calc.conMeta"))}</span>`));
  }
  return pills.join("");
}

// Punto de estado de una pestaña (espejo de la píldora).
export function _calcTabDot(key, status) {
  let r = null;
  if (key === "agg") r = _calcLineRollup(status.agg);
  else if (key === "fleet" && status.fleet) {
    if (status.fleet.total === 0) return "";
    const done = status.fleet.filled >= status.fleet.total;
    r = done ? { glyph: "✓", color: "#10b981" } : { glyph: "⚠", color: "#f59e0b" };
  }
  if (!r) return "";
  return `<span style="color:${r.color};margin-right:5px;font-weight:900">${r.glyph}</span>`;
}
export function _calcTabBtns(tabs, active, status) {
  return tabs.map(t =>
    `<button class="mode-btn${t.key === active ? " active" : ""}" class="agy-style-92" data-act="calcSetTab" data-key="${escapeHTML(t.key)}">${_calcTabDot(t.key, status)}${escapeHTML(t.label)}</button>`
  ).join("");
}
export function _calcTabBar(tabs, active, status) {
  return `<div class="mode-toggle-row" id="calcTabBar" class="agy-style-93">${_calcTabBtns(tabs, active, status)}</div>`;
}

export function _calcHeader(m, allKAMs, status) {
  const nextM = _calcNextMonth(m.lastMonth || "");
  return `
    ${_secH("🎯", "#FF0000", t("calc.titulo"), t("calc.sub"))}
    <div class="section">
      <div class="agy-style-94">
        <div>
          <label class="agy-style-95">KAM</label>
          <select id="calcKamSel" class="sb-sel agy-style-96" data-act-change="calcOnKamChange">
            <option value="all" ${CALC_STATE.kam === "all" ? "selected" : ""}>${escapeHTML(t("calc.todosKam"))}</option>
            ${allKAMs.map(k => `<option value="${escapeHTML(k)}" ${CALC_STATE.kam === k ? "selected" : ""}>${escapeHTML(k)}</option>`).join("")}
          </select>
        </div>
        <div class="agy-style-97">
          ${t("calc.metasPara", { m: `<strong>${d2s(nextM)}</strong>`, r: d2s(m.lastMonth || "") })}
        </div>
      </div>
      <div class="agy-style-98">${escapeHTML(t("calc.estadoCuadre"))}</div>
      <div id="calcStatusBar" class="agy-style-99">${_calcStatusPills(status)}</div>
    </div>`;
}

// Refresca las píldoras de estado + los puntos de pestaña + (si está visible) las
// filas "Suma"/"cuadre" DENTRO de la tabla de distribución — sin re-render total
// (patrón in-place → no roba foco). Antes solo se pintaban las píldoras de arriba:
// el usuario editaba una celda, miraba la fila de Suma de la MISMA tabla (la
// referencia más natural) y la veía sin cambiar hasta "Recalcular" → parecía que su
// edición directa no se guardaba (sí se guardaba en CALC_STATE.edits; solo faltaba
// reflejarlo aquí). Marca el botón Recalcular como "pendiente".
export function _calcRefreshStatus() {
  const sb = document.getElementById("calcStatusBar");
  if (!sb) return; // no estamos en la Calculadora
  const m = _calcComputeModel();
  const status = _calcComputeStatus(m);
  sb.innerHTML = _calcStatusPills(status);
  const tb = document.getElementById("calcTabBar");
  if (tb) tb.innerHTML = _calcTabBtns(_calcBuildTabs(m), CALC_STATE.tab, status);
  const rb = document.getElementById("calcRecalcBtn");
  if (rb && !/pendiente|pending|ожида/i.test(rb.textContent)) rb.textContent = t("calc.recalcularPend");

  const g = CALC_STATE.kamGoals;
  if (document.getElementById("calcAggSumAD")) {
    const a = _calcAggDistSums(m.aggLast1, m.distTot1, g);
    document.getElementById("calcAggSumAD").textContent = fmt(a.sumAD);
    document.getElementById("calcAggSumSH").textContent = fmt(a.sumSH);
    document.getElementById("calcAggSumNR").textContent = fmt(a.sumNR);
    document.getElementById("calcAggCuadreAD").innerHTML = _calcCuadre(a.sumAD, +g.ad || 0);
    document.getElementById("calcAggCuadreSH").innerHTML = _calcCuadre(a.sumSH, +g.sh || 0);
    document.getElementById("calcAggCuadreNR").innerHTML = _calcCuadre(a.sumNR, +g.nr || 0);
  }
}

// Botón de recálculo (pestañas con metas → tabla): re-render de la pestaña.
export function _calcRecalcBtn() {
  return `<button id="calcRecalcBtn" class="agy-style-100" data-act="calcApplyChanges">${escapeHTML(t("calc.recalcular"))}</button>`;
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
export function renderCalculator() {
  if (STATE.curTab !== "calculator") return;
  const el = document.getElementById("calculatorContent");
  if (!el) return;
  ensureIndexes();

  const rows = _calcGetMensualData();
  if (!rows.length) {
    el.innerHTML = `
      <div class="empty">
        <p>Carga datos de <strong>Rendimiento Mensual</strong> para usar la Calculadora.</p>
        <p class="agy-style-101">Sugerencia: ve a Configuración → "Actualizar información" → Rendimiento Mensual.</p>
      </div>`;
    return;
  }

  const hasMonthFormat = rows.some(r => /^\d{4}-\d{2}$/.test(r.date || ""));
  if (!hasMonthFormat) {
    el.innerHTML = `
      <div class="empty">
        <p>La calculadora requiere datos en formato <strong>mensual</strong> (YYYY-MM).</p>
        <p class="agy-style-101">
          El dataset actual está en escala <strong>${STATE.curMode}</strong>.
          Cambia a <strong>Mensual</strong> en el sidebar, o sube datos mensuales desde Configuración.
        </p>
      </div>`;
    return;
  }

  const allKAMs = [...new Set(Object.values(STATE.KAM_MAP).map(k => (k || "").trim()).filter(Boolean))].sort();
  const m = _calcComputeModel();

  // Sembrar lo que YA está guardado en BD para el mes objetivo, antes que
  // cualquier otro seeding: así el KAM abre la calculadora viendo sus metas
  // reales (y qué partners ya tienen) en vez de una tabla en 0.
  {
    const { name: _mn, year: _my } = _calcNextMonthName(m.lastMonth || "");
    _calcSeedGuardadas(_mn, _my);
  }

  // Sembrar Utilización Fleet = 85 (default estándar) una vez por partner-ciudad fleet,
  // para que el 85 llegue a la tarjeta compartible y al guardado (no solo al input).
  // Guard: si el KAM la borra, no se re-siembra; calcResetEdits limpia el guard.
  for (const e of m.aggLast3.values()) {
    if (!_calcIsFleet(e.partner)) continue;
    const k = `${e.partner}|||${e.city}|||util`;
    if (CALC_STATE.edits[k] === undefined && !CALC_STATE._utilSeeded[k]) {
      CALC_STATE.edits[k] = 85;
      CALC_STATE._utilSeeded[k] = true;
    }
  }

  // Pestañas adaptativas + clamp (protege un cambio de KAM que quita Fleet/TukTuk).
  const tabs = _calcBuildTabs(m);
  if (!tabs.some(t => t.key === CALC_STATE.tab)) CALC_STATE.tab = "agg";
  const status = _calcComputeStatus(m);

  let body;
  switch (CALC_STATE.tab) {
    case "fleet":  body = _calcTabFleet(m);  break;
    case "review": body = _calcTabReview(m); break;
    default:       body = _calcTabAgg(m);
  }

  el.innerHTML = `
    <div class="agy-style-102">
      ${_calcHeader(m, allKAMs, status)}
      ${_calcTabBar(tabs, CALC_STATE.tab, status)}
      ${body}
    </div>`;
}

// ── PESTAÑA: AGREGADOR ────────────────────────────────────────────────────────
export function _calcTabAgg(m) {
  return `
    <div class="section">${_calcAggGoalsBlock(m)}</div>
    ${_calcPctDetails(m.aggLast1, m.cartTot1, m.cityTot1, CALC_TAXI_METRICS, m.lastMonth)}
    ${_calcRecalcBtn()}
    ${_calcSec4_distribucion(m.aggLast1, m.distTot1, m.lastMonth)}`;
}

// Referencia de la base sobre la que se reparte. Existe para que el KAM vea el
// tamaño real del denominador ANTES de escribir el goal: desde ago-2026 la base
// incluye TukTuk, así que un goal pensado en taxi puro reparte de menos.
export function _calcBaseRefHTML(m) {
  // OJO: NO llamar a esta variable local `t` — tapa el `t` de i18n importado
  // arriba y cualquier t("clave") de aca adentro llamaria a esto, no a la
  // traduccion. Encontrado al barrer el DOM en ingles/ruso: esta era la unica
  // seccion que seguia en espanol pese a que el resto de la pestana ya cambiaba.
  const tot = m.cartTot1 || {};
  if (!(tot.ad > 0)) return "";
  return `
    <div class="agy-style-111" style="margin-top:8px">
      ${t("calc.baseReparto", {
        m: escapeHTML(m.lastMonth || ""),
        ad: `<b>${fmt(tot.ad)}</b>`, sh: `<b>${fmt(Math.round(tot.sh))}</b>`, nr: `<b>${fmt(tot.nr)}</b>`
      })}
    </div>`;
}

// Bloque de metas totales del agregador (Taxi + TukTuk) — lo único que va al CSV.
export function _calcAggGoalsBlock(m) {
  const g = CALC_STATE.kamGoals;
  return `
    <div class="agy-style-103">
      <div class="agy-style-104">
        <div class="agy-style-105">${escapeHTML(t("calc.metasTotales"))}</div>
        <span title="${escapeHTML(t("calc.vaAlCsvTip"))}" class="agy-style-106">${escapeHTML(t("calc.vaAlCsv"))}</span>
      </div>
      <div class="agy-style-107">
        ${_kamGoalInput("ad", t("calc.activeDrivers"), KAM_WEIGHTS.ad, g.ad)}
        ${_kamGoalInput("sh", t("calc.supplyHours"), KAM_WEIGHTS.sh, g.sh)}
        ${_kamGoalInput("nr", t("calc.newReact"), KAM_WEIGHTS.nr, g.nr)}
      </div>
      <details class="agy-style-108">
        <summary class="agy-style-109">${escapeHTML(t("calc.metasPctKam"))}</summary>
        <div class="agy-style-110">
          ${_kamGoalInput("otherProj", t("calc.otherProj"), KAM_WEIGHTS.otherProj, g.otherProj)}
          ${_kamGoalInput("fleetA2", t("calc.fleetA2"), KAM_WEIGHTS.fleetA2, g.fleetA2)}
        </div>
        <div class="agy-style-111">${escapeHTML(t("calc.metasPctKamSub"))}</div>
      </details>
      ${_calcBaseRefHTML(m)}
    </div>`;
}

// ── PESTAÑA: FLEET ────────────────────────────────────────────────────────────
export function _calcTabFleet(m) {
  return _calcSec4b_fleet(m.aggLast3);
}

// ── PESTAÑA: REVISAR Y COMPARTIR ──────────────────────────────────────────────
export function _calcTabReview(m) {
  return `
    ${_calcSecActions()}
    ${_calcSec5_exportPartner(m.aggLast1, m.distTot1, m.lastMonth)}
    ${_calcSec2_promedio3m(m.aggLast3, m.last3)}`;
}

export function _kamGoalInput(metric, label, weight, val) {
  const wtag = (weight === null || weight === undefined) ? "" : ` <span class="agy-style-89">(${weight}%)</span>`;
  return `
    <div>
      <label class="agy-style-114">${escapeHTML(label)}${wtag}</label>
      <input type="number" step="1" min="0" value="${+val || 0}"
        data-act-change="calcOnKamGoalChange" data-act-input="calcOnKamGoalChange" data-metric="${escapeHTML(metric)}"
        class="sb-inp agy-style-115"/>
    </div>`;
}

// ── Promedio 3 últimos meses (referencia colapsable, pestaña Revisar) ─────────
export function _calcSec2_promedio3m(agg, months) {
  const n = months.length || 1;
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const tot = { trips: 0, sh: 0, ad: 0, np: 0, ns: 0, re: 0 };
  items.forEach(e => {
    tot.trips += e.trips / n; tot.sh += e.sh / n; tot.ad += e.ad;
    tot.np += e.np / n; tot.ns += e.ns / n; tot.re += e.re / n;
  });

  const rowsHtml = items.map(e => `
    <tr>
      <td class="agy-style-116">${escapeHTML(e.partner)}</td>
      <td class="agy-style-117">${escapeHTML(e.city)}</td>
      <td class="tn">${fmt(e.trips / n)}</td>
      <td class="tn">${fmt(e.sh / n)}</td>
      <td class="tn">${fmt(e.ad)}</td>
      <td class="tn">${fmt(e.np / n)}</td>
      <td class="tn">${fmt(e.ns / n)}</td>
      <td class="tn">${fmt(e.re / n)}</td>
    </tr>`).join("");

  return `
    <details class="section agy-style-29">
      <summary class="agy-style-118">📊 Promedio 3 meses · referencia (no reparte) · ${items.length} partner-ciudad · KAM: ${CALC_STATE.kam === "all" ? "Todos" : CALC_STATE.kam}</summary>
      <div class="tbl-wrap agy-style-119">
        <table class="dtbl">
          <thead>
            <tr>
              <th>Partner</th><th>Ciudad</th>
              <th class="tn">Trips</th><th class="tn">SH</th>
              <th class="tn">AD (máx)</th><th class="tn">New Partner</th>
              <th class="tn">New Yango</th><th class="tn">Reactivados</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="8" class="agy-style-120">${escapeHTML(t("calc.sinDatos"))}</td></tr>`}</tbody>
          <tfoot class="agy-style-121">
            <tr>
              <td colspan="2">Total ${CALC_STATE.kam === "all" ? "general" : "KAM"}</td>
              <td class="tn">${fmt(tot.trips)}</td>
              <td class="tn">${fmt(tot.sh)}</td>
              <td class="tn">${fmt(tot.ad)}</td>
              <td class="tn">${fmt(tot.np)}</td>
              <td class="tn">${fmt(tot.ns)}</td>
              <td class="tn">${fmt(tot.re)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>`;
}

// ── % Representación (Ciudad + Cartera) — colapsable dentro de su pestaña ──────
// Por cada métrica muestra DOS columnas: % Ciudad (val ÷ total de la ciudad, TODOS
// los partners → "peso de Yego en Lima", exacto) y % Cartera (val ÷ total del KAM
// = base del reparto, suma 100%). Ventana: último mes.
export function _calcPctDetails(agg, cartTotals, cityTotals, metrics, monthLabel) {
  return `
    <details class="section agy-style-122">
      <summary class="agy-style-123">📊 Ver % Ciudad / Cartera · referencia · ${d2s(monthLabel || "")}</summary>
      <div class="agy-style-124">${escapeHTML(t("calc.pesoLeyenda"))}</div>
      ${_calcPctTableHTML(agg, cartTotals, cityTotals, metrics)}
    </details>`;
}
export function _calcPctTableHTML(agg, cartTotals, cityTotals, M) {
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  // Por métrica: Valor (número real del último mes) + % Ciudad + % Cartera.
  const _fmtV = key => (key === "sh" ? fmtSmart : fmt);
  const _valCell = (val, key) => `<td class="tn agy-style-125">${_fmtV(key)(val)}</td>`;
  const _pctCell = (val, tot) => {
    if (!tot) return `<td class="tn agy-style-90">—</td>`;
    const pct = (val / tot) * 100;
    return `<td class="tn" style="background:${_calcHeatBg(pct)};color:${_calcHeatColor(pct)};font-weight:700">${pct.toFixed(1)}%</td>`;
  };

  const rowsHtml = items.map(e => {
    const ct = cityTotals.get(e.city) || {};
    const cells = M.map(mtr => {
      const v = mtr.get(e);
      return _valCell(v, mtr.key) + _pctCell(v, ct[mtr.key]) + _pctCell(v, cartTotals[mtr.key]);   // Valor, % Ciudad, % Cartera
    }).join("");
    return `
      <tr>
        <td class="agy-style-116">${escapeHTML(e.partner)}</td>
        <td class="agy-style-117">${escapeHTML(e.city)}</td>
        ${cells}
      </tr>`;
  }).join("");

  const topHead = M.map(mtr => `<th class="tn" colspan="3">${escapeHTML(mtr.label)}</th>`).join("");
  const subHead = M.map(() => `<th class="tn" title="${escapeHTML(t("calc.valorReal"))}">Valor</th><th class="tn" title="${escapeHTML(t("calc.pesoCiudad"))}">% Ciudad</th><th class="tn" title="${escapeHTML(t("calc.pesoCartera"))}">% Cartera</th>`).join("");
  const footCells = M.map(mtr => `<td class="tn">${_fmtV(mtr.key)(cartTotals[mtr.key] || 0)}</td><td class="tn agy-style-89">—</td><td class="tn">100%</td>`).join("");
  const nCols = 2 + M.length * 3;

  return `
    <div class="tbl-wrap agy-style-126">
      <table class="dtbl">
        <thead>
          <tr><th rowspan="2">Partner</th><th rowspan="2">Ciudad</th>${topHead}</tr>
          <tr>${subHead}</tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="${nCols}" class="agy-style-120">Sin datos.</td></tr>`}</tbody>
        <tfoot class="agy-style-121">
          <tr><td colspan="2">Total cartera</td>${footCells}</tr>
        </tfoot>
      </table>
    </div>`;
}

// ── Distribución de metas AGREGADOR (editable) ────────────────────────────────
// Ventana: último mes (misma que la representación → el % que ves reparte).
// Fleet SÍ se reparte (denominador = todos) y cuenta en el cuadre; queda solo el
// badge FLEET. Los partners sin actividad Taxi el último mes se marcan "FIJAR MANUAL".
export function _calcSec4_distribucion(agg, distTotals, monthLabel) {
  const g = CALC_STATE.kamGoals;
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const _input = (partner, city, metric, base) => {
    const k = `${partner}|||${city}|||${metric}`;
    const val = CALC_STATE.edits[k] !== undefined ? +CALC_STATE.edits[k] : Math.round(base);
    // Marca visual del estado respecto de la BD: sin marca = igual a lo
    // guardado (o nunca guardado y sin tocar); ámbar = distinto de lo guardado
    // (se va a sobrescribir al guardar en modo "solo lo que cambié").
    const sv  = CALC_STATE.saved[k];
    const cls = sv !== undefined && +sv !== +val ? " calc-inp-dirty" : "";
    const ttl = sv !== undefined
      ? ` title="${escapeHTML(t("calc.guardadoEnBD", { v: fmt(+sv) }))}"`
      : "";
    return `<input type="number" step="1" min="0" value="${val}"${ttl}
      data-pk="${escapeHTML(partner)}" data-city="${escapeHTML(city)}" data-metric="${metric}"
      data-act-change="calcOnGoalEdit"
      class="calc-inp agy-style-127${cls}"/>`;
  };
  const _pctCell = (val, tot, noAct) => noAct
    ? `<td class="tn agy-style-128">—</td>`
    : `<td class="tn agy-style-129">${tot > 0 ? ((val / tot) * 100).toFixed(1) + "%" : "—"}</td>`;

  let sumAD = 0, sumSH = 0, sumNR = 0, nManual = 0;
  const rowsHtml = items.map(e => {
    const nr = e.np + e.ns + e.re;
    const b = _calcAggMetaBases(e, g, distTotals);
    const ad = _calcGoalFor(e.partner, e.city, "ad", b.ad);
    const sh = _calcGoalFor(e.partner, e.city, "sh", b.sh);
    const nrg = _calcGoalFor(e.partner, e.city, "nr", b.nr);
    sumAD += ad; sumSH += sh; sumNR += nrg;
    if (b.noAct) nManual++;
    const badge  = b.fleet ? ` <span class="agy-style-130">FLEET</span>` : "";
    const manual = b.noAct ? ` <span title="Sin actividad Taxi el último mes — fija la meta a mano" class="agy-style-131">FIJAR MANUAL</span>` : "";
    // "YA TIENE META": este partner-ciudad ya tiene metas cargadas en BD para el
    // mes objetivo. Antes no había forma de saberlo sin ir a la pestaña Metas.
    const guardada = _calcFilaGuardada(e.partner, e.city)
      ? ` <span class="calc-badge-saved" title="${escapeHTML(t("calc.yaTieneMetaTip"))}">${escapeHTML(t("calc.yaTieneMeta"))}</span>` : "";
    const rowStyle = b.noAct ? ' class="agy-style-132"' : (b.fleet ? ' class="agy-style-133"' : '');
    return `
      <tr${rowStyle}>
        <td class="agy-style-116">${escapeHTML(e.partner)}${badge}${manual}${guardada}</td>
        <td class="agy-style-117">${escapeHTML(e.city)}</td>
        ${_pctCell(e.ad, distTotals.ad, b.noAct)}
        <td>${_input(e.partner, e.city, "ad", b.ad)}</td>
        ${_pctCell(e.sh, distTotals.sh, b.noAct)}
        <td>${_input(e.partner, e.city, "sh", b.sh)}</td>
        ${_pctCell(nr, distTotals.nr, b.noAct)}
        <td>${_input(e.partner, e.city, "nr", b.nr)}</td>
      </tr>`;
  }).join("");

  const noGoals = !(+g.ad || +g.sh || +g.nr);
  const hint = noGoals
    ? t("calc.hintSinMetas")
    : (nManual ? t("calc.hintManual", { n: nManual }) : "");

  return `
    ${_secH("⚙️", "#8b5cf6", t("calc.distribPartner", { m: d2s(monthLabel || "") }), t("calc.distribSub"))}
    <div class="section">
      ${hint}
      <div class="tbl-wrap agy-style-136">
        <table class="dtbl">
          <thead>
            <tr>
              <th>${escapeHTML(t("calc.col.partner"))}</th><th>${escapeHTML(t("calc.col.ciudad"))}</th>
              <th class="tn">% AD</th><th class="tn">AD meta</th>
              <th class="tn">% SH</th><th class="tn">SH meta</th>
              <th class="tn">% N+R</th><th class="tn">N+R meta</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="8" class="agy-style-120">${escapeHTML(t("calc.sinDatos"))}</td></tr>`}</tbody>
          <tfoot class="agy-style-121">
            <tr>
              <td colspan="2">${escapeHTML(t("calc.sumaDist"))}</td>
              <td></td><td class="tn" id="calcAggSumAD">${fmt(sumAD)}</td>
              <td></td><td class="tn" id="calcAggSumSH">${fmt(sumSH)}</td>
              <td></td><td class="tn" id="calcAggSumNR">${fmt(sumNR)}</td>
            </tr>
            <tr>
              <td colspan="2" class="agy-style-137">${escapeHTML(t("calc.metaKamCuadre"))}</td>
              <td></td><td class="tn" id="calcAggCuadreAD">${_calcCuadre(sumAD, +g.ad || 0)}</td>
              <td></td><td class="tn" id="calcAggCuadreSH">${_calcCuadre(sumSH, +g.sh || 0)}</td>
              <td></td><td class="tn" id="calcAggCuadreNR">${_calcCuadre(sumNR, +g.nr || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

// Compara la suma distribuida vs la meta KAM y devuelve el cuadre coloreado.
export function _calcCuadre(sum, target) {
  if (!target) return `<span class="agy-style-89">${escapeHTML(t("calc.sinMeta"))}</span>`;
  const gap = sum - target;
  const ok = Math.abs(gap) <= Math.max(1, target * 0.005);
  const c = ok ? "#10b981" : (gap > 0 ? "#f59e0b" : "#FF0000");
  const tag = ok ? t("calc.cuadra") : (gap > 0 ? `+${fmt(gap)}` : `${fmt(gap)}`);
  return `<div class="agy-style-138">${fmt(target)}<br><span style="color:${c};font-weight:800">${tag}</span></div>`;
}

// ── KPIs Fleet (pestaña Fleet) ────────────────────────────────────────────────
// Metas manuales por partner-ciudad para partners fleet. NO se distribuyen ni van
// al CSV; si se llenan, aparecen en la tarjeta compartible (pestaña Revisar).
// Utilización pre-llenada en 85 (borrable) — la meta estándar.
export function _calcSec4b_fleet(agg) {
  const items = [...agg.values()]
    .filter(e => _calcIsFleet(e.partner))
    .sort((a, b) => a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const _inp = (partner, city, metric, ph) => {
    const k = `${partner}|||${city}|||${metric}`;
    const val = CALC_STATE.edits[k] !== undefined ? CALC_STATE.edits[k] : "";
    return `<input type="number" step="0.1" min="0" class="calc-inp" value="${val}" placeholder="${ph}"
      data-pk="${escapeHTML(partner)}" data-city="${escapeHTML(city)}" data-metric="${metric}"
      data-act-change="calcOnGoalEdit"
      class="agy-style-139"/>`;
  };

  const rowsHtml = items.map(e => {
    const ref = _calcFleetRef(e);
    return `
      <tr>
        <td class="agy-style-116">${escapeHTML(e.partner)}</td>
        <td class="agy-style-117">${escapeHTML(e.city)}</td>
        <td class="tn agy-style-129">${ref.shcar == null ? "—" : ref.shcar.toFixed(1)}</td>
        <td>${_inp(e.partner, e.city, "shcar", "meta")}</td>
        <td class="tn agy-style-129">${ref.accept == null ? "—" : ref.accept.toFixed(1) + "%"}</td>
        <td>${_inp(e.partner, e.city, "accept", "meta %")}</td>
        <td>${_inp(e.partner, e.city, "util", "85")}</td>
      </tr>`;
  }).join("");

  return `
    ${_secH("🚗", "#0284c7", t("calc.metasFleet"), t("calc.metasFleetSub"))}
    <div class="section">
      <div class="tbl-wrap agy-style-140">
        <table class="dtbl">
          <thead>
            <tr>
              <th>${escapeHTML(t("calc.col.partner"))}</th><th>${escapeHTML(t("calc.col.ciudad"))}</th>
              <th class="tn">${escapeHTML(t("calc.shAuto3m"))}</th><th class="tn">${escapeHTML(t("calc.metaShAuto"))}</th>
              <th class="tn">${escapeHTML(t("calc.aceptacion3m"))}</th><th class="tn">${escapeHTML(t("calc.metaAceptPct"))}</th>
              <th class="tn">${escapeHTML(t("calc.metaUtilPct"))}</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="7" class="agy-style-120">${escapeHTML(t("calc.sinFleet"))}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="agy-style-141">
        ${t("calc.utilPrellenada", { r: t("calc.tabRevisar") })}
      </div>
    </div>`;
}

// ── BLOQUE DE ACCIONES (pestaña Revisar) ──────────────────────────────────────
// Reset o descargar el CSV. La distribución se recalcula con "↻ Recalcular" en cada
// pestaña o al cambiar de pestaña; ya no hay un botón "Aplicar" global.
export function _calcSecActions() {
  const canSave = !!STATE.canWrite;
  const kamAll  = CALC_STATE.kam === "all";
  const saveBtn = !canSave
    ? `<button disabled title="${escapeHTML(t("calc.requiereAdmin"))}" class="agy-style-144">${escapeHTML(t("calc.btnGuardarAdmin"))}</button>`
    : `<button class="agy-style-145" data-act="calcSaveMetas">${escapeHTML(t("calc.btnGuardar"))}</button>`;
  const kamNote = (canSave && kamAll)
    ? t("calc.kamNote")
    : "";

  // ── Modo de guardado ───────────────────────────────────────────────────────
  // El default es "solo lo que cambié": un ajuste puntual NO debe reescribir el
  // reparto entero del mes. "Reparto completo" es el comportamiento histórico y
  // se elige a conciencia cuando se arma el mes desde cero.
  const nCambios = _calcContarCambios();
  const modo = CALC_STATE.saveMode;
  const _opt = (val, label, desc) => `
    <label class="calc-mode-opt${modo === val ? " active" : ""}">
      <input type="radio" name="calcSaveMode" value="${val}" ${modo === val ? "checked" : ""}
             data-act-change="calcSetSaveMode" data-mode="${val}"/>
      <span><strong>${escapeHTML(label)}</strong><br><span class="calc-mode-desc">${escapeHTML(desc)}</span></span>
    </label>`;
  const modoHTML = !canSave ? "" : `
    <div class="calc-mode-box">
      <div class="calc-mode-title">${escapeHTML(t("calc.modoTitulo"))}</div>
      ${_opt("edits", t("calc.modoEdits"), t("calc.modoEditsDesc", { n: nCambios }))}
      ${_opt("full",  t("calc.modoFull"),  t("calc.modoFullDesc"))}
    </div>`;

  // ── Zona de peligro: borrar las metas de ESTE KAM para el mes objetivo ─────
  // Admin-only (igual que "Eliminar metas del mes" de la pestaña Metas); el
  // enforcement real es RLS. Deshabilitado con KAM="Todos": borrar las metas de
  // TODOS los KAMs de un mes ya existe en Metas y ahí está con su propio aviso.
  const delBtn = !STATE.isAdmin ? "" : (kamAll
    ? `<button disabled title="${escapeHTML(t("calc.borrarKamNeedKam"))}" class="agy-style-144">${escapeHTML(t("calc.btnBorrarKam"))}</button>`
    : `<button class="agy-style-148" data-act="calcDeleteMetasKam">${escapeHTML(t("calc.btnBorrarKamDe", { k: CALC_STATE.kam }))}</button>`);

  return `
    ${_secH("✅", "#10b981", t("calc.actualizarCompartir"), t("calc.actualizarCompartirSub"))}
    <div class="section">
      <div class="tbl-wrap">
        ${modoHTML}
        <div class="agy-style-147">
          ${saveBtn}
          <button class="agy-style-148" data-act="calcExportExcel">${escapeHTML(t("calc.btnDescargarCsv"))}</button>
          <button class="agy-style-149" data-act="calcResetEdits">${escapeHTML(t("calc.btnResetEdits"))}</button>
          ${delBtn}
        </div>
        ${kamNote}
        <div class="agy-style-150">${t("calc.actualizarHint")}</div>
      </div>
    </div>`;
}

// Cuántos (partner,ciudad,KPI) difieren de lo que hay en BD. Es el conteo que se
// muestra en el modo "solo lo que cambié" y lo que ese modo va a escribir.
export function _calcContarCambios() {
  let n = 0;
  Object.keys(CALC_STATE.edits).forEach(k => {
    const v = CALC_STATE.edits[k];
    if (v === undefined || v === "") return;
    const sv = CALC_STATE.saved[k];
    if (sv === undefined || +sv !== +v) n++;
  });
  return n;
}

export function calcSetSaveMode(mode) {
  if (mode !== "edits" && mode !== "full") return;
  CALC_STATE.saveMode = mode;
  renderCalculator();
}

// ── Vista compartible: i18n ES/EN + crecimiento vs último mes ─────────────────
export const CALC_MES_EN = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
export function _calcMonthLabel(iso, lang) {
  if (!iso || !/^\d{4}-\d{2}$/.test(iso)) return "";
  const [y, mm] = iso.split("-").map(Number);
  const esN = CALC_MES_NOMBRES[mm - 1] || "";
  const es  = esN ? esN.charAt(0) + esN.slice(1).toLowerCase() : "";
  const en  = CALC_MES_EN[mm - 1] || "";
  if (lang === "es") return `${es} ${y}`;
  if (lang === "en") return `${en} ${y}`;
  return es === en ? `${es} ${y}` : `${es} ${y} / ${en} ${y}`;
}

// Etiquetas de la tarjeta. lang: "es" | "en" | "es-en" (bilingüe → une con " / ").
export const CALC_EXPORT_STR = {
  proposal:   { es: "Metas Yango — Propuesta", en: "Yango Goals — Proposal" },
  city:       { es: "Ciudad", en: "City" },
  ad:         { es: "Active Drivers", en: "Active Drivers" },
  sh:         { es: "Supply Hours", en: "Supply Hours" },
  nr:         { es: "N+R", en: "N+R" },
  cars:       { es: "Brandeados", en: "Branded" },
  shcar:      { es: "SH/Auto", en: "SH/Car" },
  accept:     { es: "Aceptación", en: "Acceptance" },
  util:       { es: "Utilización", en: "Utilization" },
  fleetKpi:   { es: "Fleet · KPIs de calidad", en: "Fleet · quality KPIs" },
  newBadge:   { es: "nuevo", en: "new" },
  generated:  { es: "Propuesta generada", en: "Proposal generated" },
  legendGoal: { es: "Número grande = meta propuesta", en: "Large number = proposed goal" },
  legendLast: { es: "debajo = resultado del último mes y crecimiento pedido",
                en: "below = last month result and requested growth" }
};
export function _calcLab(key, lang) {
  const s = CALC_EXPORT_STR[key];
  if (!s) return key;
  if (lang === "es") return s.es;
  if (lang === "en") return s.en;
  return s.es === s.en ? s.es : `${s.es} / ${s.en}`;
}

// Celda de tabla: meta (número grande) + resultado del último mes y % de crecimiento
// pedido (verde si sube, rojo si baja, gris si es mantener). actual = valor real del
// último mes (aggLast1 ya viene por mes). Sin baseline (actual<=0) → "nuevo/new".
export function _calcGoalCell(goal, actual, fmtFn, lang) {
  // Sin meta (goal<=0, p.ej. el KAM aún no ingresó su objetivo): no inventamos un
  // "-100%"; mostramos "—" y el valor del último mes como referencia.
  if (!(goal > 0)) {
    const ref = actual > 0
      ? `<div class="agy-style-151">${fmtFn(actual)}</div>`
      : "";
    return `<td class="tn agy-style-152"><div class="agy-style-153">—</div>${ref}</td>`;
  }
  const big = `<div class="agy-style-154">${fmtFn(goal)}</div>`;
  let sub;
  if (actual > 0) {
    const pct  = ((goal - actual) / actual) * 100;
    const sign = pct >= 0 ? "+" : "";
    const gc   = pct > 0.5 ? "#059669" : pct < -0.5 ? "#dc2626" : "#6b7280";
    const pctT = `${sign}${pct.toLocaleString("es-PE", { maximumFractionDigits: 0 })}%`;
    sub = `<div class="agy-style-151">${fmtFn(actual)} <span style="color:${gc};font-weight:800">${pctT}</span></div>`;
  } else {
    sub = `<div class="agy-style-155">${_calcLab("newBadge", lang)}</div>`;
  }
  return `<td class="tn agy-style-152">${big}${sub}</td>`;
}

// Leyenda del formato meta / último mes. Bilingüe → dos líneas (no " / " en frase).
export function _calcExportLegend(lang) {
  const line  = l => `${CALC_EXPORT_STR.legendGoal[l]} · ${CALC_EXPORT_STR.legendLast[l]}`;
  const style = "margin-top:10px;font-size:.62rem;color:#9ca3af;line-height:1.5";
  if (lang === "es") return `<div style="${style}">${line("es")}</div>`;
  if (lang === "en") return `<div style="${style}">${line("en")}</div>`;
  return `<div style="${style}">${line("es")}<br>${line("en")}</div>`;
}

// ── Vista compartible / descarga por partner (pestaña Revisar) ────────────────
// `agg` ya viene con TukTuk adentro (ago 2026), así que no hay bloque separado:
// un partner con TukTuk aparece con su volumen combinado, igual que en la meta.
export function _calcSec5_exportPartner(agg, totals, lastMonth) {
  const lang = CALC_STATE.exportLang || "es-en";
  const g = CALC_STATE.kamGoals;
  const partners = [...new Set([...agg.values()].map(e => e.partner))].sort();
  if (!partners.length) {
    return `
      ${_secH("📤", "#10b981", t("calc.vistaCompartible"), t("calc.sinPartnersFiltro"))}
      <div class="section"><div class="agy-style-156">${escapeHTML(t("calc.sinPartnersKam"))}</div></div>`;
  }
  const sel = (CALC_STATE.selPartnerExport && partners.includes(CALC_STATE.selPartnerExport))
    ? CALC_STATE.selPartnerExport
    : partners[0];
  CALC_STATE.selPartnerExport = sel;

  const taxiItems = [...agg.values()].filter(e => e.partner === sel);

  const editVal = (e, k) => CALC_STATE.edits[`${e.partner}|||${e.city}|||${k}`];
  const _th = t => `<th style="text-align:${t.a || "right"};padding:8px 12px;font-size:.74rem">${t.h}</th>`;

  // Bloque Taxi (AD/SH/N+R con crecimiento vs último mes)
  const taxiBlock = taxiItems.length ? (() => {
    const rows = taxiItems.map(e => {
      const b = _calcAggMetaBases(e, g, totals);
      const adGoal = _calcGoalFor(e.partner, e.city, "ad", b.ad);
      const shGoal = _calcGoalFor(e.partner, e.city, "sh", b.sh);
      const nrGoal = _calcGoalFor(e.partner, e.city, "nr", b.nr);
      const nr = e.np + e.ns + e.re;
      return `<tr><td class="agy-style-157">${escapeHTML(e.city)}</td>${_calcGoalCell(adGoal, e.ad, fmt, lang)}${_calcGoalCell(shGoal, e.sh, fmtSmart, lang)}${_calcGoalCell(nrGoal, nr, fmt, lang)}</tr>`;
    }).join("");
    const heads = [{h:_calcLab("city",lang),a:"left"},{h:_calcLab("ad",lang)},{h:_calcLab("sh",lang)},{h:_calcLab("nr",lang)}].map(_th).join("");
    return `
      <!-- Desde ago-2026 estas cifras incluyen TukTuk: la etiqueta tiene que decirlo.
           Esta tarjeta se le manda al partner — si dice "Taxi" y el numero trae
           TukTuk adentro, el partner recibe una meta que no puede reconciliar. -->
      <div class="agy-style-158">🚕 Taxi + 🛺 TukTuk</div>
      <table class="agy-style-159">
        <thead><tr class="agy-style-160">${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  })() : "";

  // Bloque Fleet (SH/Auto, Aceptación, Utilización) — SOLO si el partner (o alguna de
  // sus subflotas) está marcado Fleet. Se muestran las 3 KPIs siempre; meta editada en
  // negro, sin meta "—" (nudge para fijarla), y debajo la referencia del último mes.
  const isFleetCard = taxiItems.some(e => _calcIsFleet(e.partner));
  const FLEET_KPI = [
    { k: "shcar",  fmt: v => fmt(v),       ref: e => _calcFleetRef(e).shcar },
    { k: "accept", fmt: v => fmt(v) + "%", ref: e => _calcFleetRef(e).accept },
    { k: "util",   fmt: v => fmt(v) + "%", ref: e => null }
  ];
  const fleetBlock = (isFleetCard && taxiItems.length) ? (() => {
    const rows = taxiItems.map(e => {
      const cells = FLEET_KPI.map(fd => {
        const ev = editVal(e, fd.k);
        const hasMeta = ev !== undefined && ev !== "";
        const big = `<div style="font-weight:800;font-size:.95rem;color:${hasMeta ? "#111" : "#9ca3af"}">${hasMeta ? fd.fmt(+ev) : "—"}</div>`;
        const rv = fd.ref(e);
        const sub = (rv != null && isFinite(rv) && rv > 0)
          ? `<div class="agy-style-151">${fd.fmt(rv)}</div>`
          : "";
        return `<td class="tn agy-style-161">${big}${sub}</td>`;
      }).join("");
      return `<tr><td class="agy-style-157">${escapeHTML(e.city)}</td>${cells}</tr>`;
    }).join("");
    const heads = [{h:_calcLab("city",lang),a:"left"},{h:_calcLab("shcar",lang)},{h:_calcLab("accept",lang)},{h:_calcLab("util",lang)}].map(_th).join("");
    return `
      <div class="agy-style-162">🚗 ${_calcLab("fleetKpi",lang)}</div>
      <table class="agy-style-159">
        <thead><tr class="agy-style-163">${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  })() : "";

  // El bloque TukTuk separado se retiró (ago 2026): esas filas ahora vienen dentro
  // de `agg`, así que el partner ve UNA sola meta combinada en vez de dos tablas
  // que había que sumar mentalmente.
  const hasData  = !!(taxiBlock || fleetBlock);
  const refMonth = _calcMonthLabel(lastMonth || "", lang);
  const subLabel = { es: "Meta vs último mes", en: "Goal vs last month", "es-en": "Meta vs último mes / Goal vs last month" }[lang];
  const genDate  = new Date().toLocaleDateString(lang === "en" ? "en-US" : "es-PE");
  const langBtns = [["es","ES"],["en","EN"],["es-en","ES/EN"]].map(([code, txt]) => {
    const on = lang === code;
    return `<button data-act="calcSetExportLang" data-code="${escapeHTML(code)}" style="padding:7px 12px;font-size:.74rem;font-weight:700;border:none;cursor:pointer;background:${on?"#10b981":"#fff"};color:${on?"#fff":"#555"}">${txt}</button>`;
  }).join("");

  return `
    ${_secH("📤", "#10b981", "Vista compartible por partner", "Tarjeta compartible bilingüe · " + subLabel + (refMonth ? " (" + refMonth + ")" : "") + " · sin mezclar otros partners")}
    <div class="section">
      <div class="agy-style-167">
        <div class="agy-style-168">
          <label class="agy-style-169">Partner</label>
          <input type="text" id="calcExportSearch" class="sb-inp" placeholder="Buscar partner..." autocomplete="off"
            value="${escapeHTML(sel)}" class="agy-style-170"
            data-act-input="calcFilterExportPartners"
            data-act-focus="calcShowExportList"
            data-act-blur="calcHideExportListDelayed"
            data-act-keydown="calcExportKeydown"/>
          <div id="calcExportList" class="agy-style-171"></div>
        </div>
        <div>
          <label class="agy-style-169">Idioma / Language</label>
          <div class="agy-style-172">${langBtns}</div>
        </div>
        <button class="agy-style-173" data-act="calcDownloadPartnerImage">📥 Descargar Imagen</button>
      </div>

      <div id="calcExportCard" class="agy-style-174">
        <div class="agy-style-175">
          <div class="agy-style-176">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="20" height="20"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <div class="agy-style-177">${_calcLab("proposal", lang)}</div>
            <div class="agy-style-178">${escapeHTML(sel)}</div>
          </div>
        </div>
        ${taxiBlock}${fleetBlock}
        ${hasData ? _calcExportLegend(lang) : `<div class="agy-style-156">Sin datos para este partner.</div>`}
        <div class="agy-style-179">
          ${_calcLab("generated", lang)}: ${genDate}
        </div>
      </div>
    </div>`;
}

// Cambia el idioma de la tarjeta compartible (re-render de la Calculadora).
export function calcSetExportLang(lang) {
  CALC_STATE.exportLang = lang;
  renderCalculator();
}

// ── INTERACCIONES ─────────────────────────────────────────────────────────────
export function calcSetTab(tab) {
  CALC_STATE.tab = tab;
  renderCalculator();
}

export function calcOnKamChange(v) {
  CALC_STATE.kam = v;
  CALC_STATE.tab = "agg";               // vuelve a la pestaña base (evita quedar en una que desaparece)
  CALC_STATE.selPartnerExport = null;
  renderCalculator();
}

export function _calcScheduleRerender() {
  if (STATE.curTab !== "calculator") return;
  clearTimeout(CALC_STATE._editDeb);
  const tokenAtSchedule = STATE._tabRenderId;
  CALC_STATE._editDeb = setTimeout(() => {
    CALC_STATE._editDeb = null;
    if (STATE._tabRenderId !== tokenAtSchedule) return;
    if (STATE.curTab !== "calculator") return;
    renderCalculator();
  }, 400);
}

export function calcCancelPendingRender() {
  if (CALC_STATE._editDeb) {
    clearTimeout(CALC_STATE._editDeb);
    CALC_STATE._editDeb = null;
  }
}

export function calcOnGoalEdit(input) {
  const partner = input.dataset.pk;
  const city    = input.dataset.city;
  const metric  = input.dataset.metric;
  const val     = parseFloat(input.value);
  const k = `${partner}|||${city}|||${metric}`;
  if (isNaN(val)) delete CALC_STATE.edits[k];
  else CALC_STATE.edits[k] = val;
  // No re-render aqui (perderia el focus). El usuario edita libre y luego "Recalcular"
  // o cambia de pestaña. Solo refrescamos el estado en vivo (píldoras + puntos).
  _calcRefreshStatus();
}

export function calcOnKamGoalChange(metric, val) {
  CALC_STATE.kamGoals[metric] = parseFloat(val) || 0;
  // No re-render por keystroke: se aplica con "Recalcular distribución" / cambio de pestaña.
  _calcRefreshStatus();
}

// Re-renderiza con metas + edits aplicados. Lo llama "↻ Recalcular distribución".
export function calcApplyChanges() {
  renderCalculator();
}

export function calcOnExportPartnerChange(v) {
  CALC_STATE.selPartnerExport = v;
  renderCalculator();
}

export function calcResetEdits() {
  if (!Object.keys(CALC_STATE.edits).length) return;
  if (!confirm("¿Borrar todas las ediciones manuales y volver a la distribución automática?")) return;
  CALC_STATE.edits = {};
  CALC_STATE._utilSeeded = {};   // permite re-sembrar Utilización = 85
  renderCalculator();
}

// ── CONSTRUCCIÓN DE FILAS DE METAS (fuente única: CSV + guardado directo) ──────
export const CALC_MES_NOMBRES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
export function _calcNextMonth(monthStr) {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return "2026-01";
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m, 1); // m sin -1 = mes siguiente
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// Mes objetivo como NOMBRE (metas.mes) + año (metas.mes_year).
export function _calcNextMonthName(lastMonth) {
  const iso = _calcNextMonth(lastMonth);
  const [y, mm] = iso.split("-").map(Number);
  return { name: CALC_MES_NOMBRES[mm - 1] || iso, year: y, iso };
}

// Construye las filas de metas (Agregador + Fleet) del KAM actual para el próximo
// mes. Una fila por (clid,city). MISMA matemática que la UI (_calcAggMetaBases /
// _calcGoalFor) → CSV, guardado directo y pantalla no divergen.
export function _calcBuildMetaRows(m) {
  const g = CALC_STATE.kamGoals;
  const { name: mesName, year: mesYear } = _calcNextMonthName(m.lastMonth || "");
  const byKey = new Map();
  const getRow = (partner, city, clid) => {
    const k = `${clid}|||${city}`;
    let r = byKey.get(k);
    if (!r) {
      r = { clid, partner,
            kam: CALC_STATE.kam === "all" ? (getKAMForPartner(partner) || "") : CALC_STATE.kam,
            city, mes: mesName, mes_year: mesYear };
      byKey.set(k, r);
    }
    return r;
  };
  // Agregador (último mes): Fleet incluido en el reparto (denominador = todos).
  for (const e of m.aggLast1.values()) {
    const clid = e.clid || _calcLookupClid(e.partner, e.city);
    if (!clid) continue;
    const b = _calcAggMetaBases(e, g, m.distTot1);
    const r = getRow(e.partner, e.city, clid);
    r.meta_active_drivers = _calcGoalFor(e.partner, e.city, "ad", b.ad);
    r.meta_supply_hours   = _calcGoalFor(e.partner, e.city, "sh", b.sh);
    r.meta_nr             = _calcGoalFor(e.partner, e.city, "nr", b.nr);
  }
  // Fleet KPIs (solo partners fleet, solo si el KAM cargó algún valor).
  for (const e of m.aggLast3.values()) {
    if (!_calcIsFleet(e.partner)) continue;
    const clid = e.clid || _calcLookupClid(e.partner, e.city);
    if (!clid) continue;
    const shcar  = CALC_STATE.edits[`${e.partner}|||${e.city}|||shcar`];
    const accept = CALC_STATE.edits[`${e.partner}|||${e.city}|||accept`];
    const util   = CALC_STATE.edits[`${e.partner}|||${e.city}|||util`];
    if (![shcar, accept, util].some(v => v !== undefined && v !== "")) continue;
    const r = getRow(e.partner, e.city, clid);
    if (shcar  !== undefined && shcar  !== "") r.meta_sh_car      = +shcar;
    if (accept !== undefined && accept !== "") r.meta_acceptance  = +accept;
    if (util   !== undefined && util   !== "") r.meta_utilization = +util;
  }
  // TukTuk YA NO tiene meta propia (ago 2026): su volumen entró al reparto del
  // agregador de arriba. Las columnas meta_tk_* quedan en la tabla para no perder
  // el histórico, pero la calculadora deja de escribirlas.
  return { rows: [...byKey.values()], mesName, mesYear };
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
// Plantilla CSV (Agregador + Fleet). Headers alineados con uploadMetas → se puede
// resubir en Configuración → Metas. Blanks donde no aplica.
// Las columnas META TK * ya no se exportan: TukTuk dejó de tener meta propia. Si el
// archivo no las trae, uploadMetas simplemente no toca esas columnas en BD (detecta
// headers opcionales), así que el histórico no se pisa con vacíos.
export function calcExportExcel() {
  logAccess("download_csv", "calculadora");
  const m = _calcComputeModel();
  const { rows, mesName, mesYear } = _calcBuildMetaRows(m);
  const header = ["CLID", "PARTNER", "CIUDAD", "MES", "AÑO",
    "ACTIVE DRIVERS", "N+R", "SUPPLY HOURS",
    "META SH/AUTO", "META ACEPTACION", "META UTILIZACION"];
  const q   = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const num = v => (v == null ? "" : v);
  const lines = [header.join(",")];
  rows.forEach(r => {
    lines.push([
      q(r.clid), q(r.partner), q(r.city), q(r.mes), num(r.mes_year),
      num(r.meta_active_drivers), num(r.meta_nr), num(r.meta_supply_hours),
      num(r.meta_sh_car), num(r.meta_acceptance), num(r.meta_utilization)
    ].join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `metas_${mesName}_${mesYear}_${CALC_STATE.kam || "all"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showBanner(true, "Plantilla de metas exportada · súbela en Configuración → Metas");
}

// Guarda las metas del KAM directo en Supabase (sin round-trip de Excel).
// read-merge-write: preserva columnas de otras líneas que este guardado no tocó.
// Reintenta UNA vez ante un fallo de RED (la promesa de fetch rechaza y postgrest
// lo entrega como "TypeError: Failed to fetch"), nunca ante un error del servidor:
// un 42501 de RLS o un conflicto de esquema no mejoran por insistir, y reintentar
// un rechazo legítimo solo esconde el problema.
//
// Reintentar una ESCRITURA es seguro acá porque el upsert es idempotente: misma
// clave (clid,city,mes) y mismo payload, así que aplicarlo dos veces deja
// exactamente el mismo estado que aplicarlo una. No vale para cualquier escritura.
//
// Nació del incidente del 13-ago-2026: el guardado murió con "Failed to fetch" y
// los logs de Supabase NO tienen rastro del request — nunca salió del navegador.
// Sin evidencia del lado del cliente no se puede ir más lejos, pero un fallo de
// red pasajero no debería costarle al usuario rehacer la carga.
async function _conReintento(fn) {
  const esDeRed = e => /failed to fetch|networkerror|network error|load failed/i
    .test((e && e.message) || String(e || ""));
  try {
    const res = await fn();
    if (res && res.error && esDeRed(res.error)) throw res.error;
    return res;
  } catch (e) {
    if (!esDeRed(e)) throw e;
    await new Promise(r => setTimeout(r, 900));
    return await fn();
  }
}

// Recorta las filas del reparto a SOLO lo que difiere de lo guardado en BD.
// Devuelve filas con únicamente las columnas cambiadas (+ la clave), para que
// el merge de calcSaveMetas preserve todo lo demás tal cual está.
//
// POR QUÉ EXISTE: el reparto siempre produce una fila por partner del KAM, así
// que guardar "para corregir un partner" reescribía las metas de todos. Con
// este filtro, tocar un valor escribe ese valor y nada más.
export function _calcFiltrarSoloCambios(rows) {
  const COL2MET = {
    meta_active_drivers: "ad", meta_nr: "nr", meta_supply_hours: "sh",
    meta_sh_car: "shcar", meta_acceptance: "accept", meta_utilization: "util"
  };
  const out = [];
  rows.forEach(r => {
    const keep = { clid: r.clid, partner: r.partner, kam: r.kam, city: r.city,
                   mes: r.mes, mes_year: r.mes_year };
    let hay = false;
    Object.keys(COL2MET).forEach(col => {
      const k  = `${r.partner}|||${r.city}|||${COL2MET[col]}`;
      // CRÍTICO — la condición es "lo TECLEÓ el usuario", no "difiere del
      // reparto": `_calcGoalFor` devuelve goal × share, y con los objetivos de
      // KAM en 0 (su valor inicial) ese cálculo da 0 para TODOS los partners.
      // Si el filtro mirara `r[col]`, abrir la calculadora y guardar sin cargar
      // objetivos escribiría ceros sobre todo el mes — exactamente el incidente
      // del 13-ago-2026 que motivó domain/metasGuard.ts, pero colándose por
      // debajo de ese freno (que valida totales, no filas parciales).
      // Con `edits` como fuente, un 0 solo se escribe si alguien lo tecleó.
      const ev = CALC_STATE.edits[k];
      if (ev === undefined || ev === "") return;
      const sv = CALC_STATE.saved[k];
      if (sv === undefined || +sv !== +ev) { keep[col] = +ev; hay = true; }
    });
    if (hay) out.push(keep);
  });
  return out;
}

// Valores que BAJAN a 0 respecto de lo guardado. En modo "solo lo que cambié"
// no corre el freno de metasGuard (valida totales de un reparto completo, que
// acá no existe), así que esta es la red de seguridad equivalente: poner 0 a
// mano es válido, pero se avisa explícitamente antes de escribirlo.
export function _calcCerosQueBorran(rows) {
  const COLS = ["meta_active_drivers", "meta_nr", "meta_supply_hours",
                "meta_sh_car", "meta_acceptance", "meta_utilization"];
  const MET  = { meta_active_drivers: "ad", meta_nr: "nr", meta_supply_hours: "sh",
                 meta_sh_car: "shcar", meta_acceptance: "accept", meta_utilization: "util" };
  const LBL  = { ad: "AD", nr: "N+R", sh: "SH", shcar: "SH/Auto", accept: "Aceptación", util: "Utilización" };
  const out = [];
  rows.forEach(r => COLS.forEach(col => {
    if (r[col] == null || +r[col] !== 0) return;
    const sv = CALC_STATE.saved[`${r.partner}|||${r.city}|||${MET[col]}`];
    if (sv !== undefined && +sv > 0) out.push(`${r.partner} (${r.city}) · ${LBL[MET[col]]}: ${fmt(+sv)} → 0`);
  }));
  return out;
}

export async function calcSaveMetas() {
  if (!STATE.canWrite) { alert(t("calc.requiereKamAdmin")); return; }
  if (CALC_STATE.kam === "all") { alert(t("calc.elegirKamEspecifico")); return; }
  const m = _calcComputeModel();
  const built = _calcBuildMetaRows(m);
  const { mesName, mesYear } = built;
  const soloCambios = CALC_STATE.saveMode === "edits";
  const rows = soloCambios ? _calcFiltrarSoloCambios(built.rows) : built.rows;
  if (!rows.length) {
    alert(soloCambios ? t("calc.sinCambiosParaGuardar") : t("calc.sinMetasParaGuardar"));
    return;
  }

  // Resumen antes de escribir.
  const g = CALC_STATE.kamGoals;
  const a = _calcAggDistSums(m.aggLast1, m.distTot1, g);
  const nAgg   = rows.filter(r => r.meta_active_drivers != null).length;
  const nFleet = rows.filter(r => r.meta_sh_car != null || r.meta_acceptance != null || r.meta_utilization != null).length;
  const summary = soloCambios
    ? `Actualizar SOLO lo que cambiaste · ${CALC_STATE.kam} · ${mesName} ${mesYear}\n\n` +
      `• ${rows.length} partner-ciudad con algún valor distinto al guardado\n` +
      (nAgg ? `• Agregador: ${nAgg} fila(s)\n` : "") +
      (nFleet ? `• Fleet: ${nFleet} fila(s)\n` : "") +
      `\nLos KPIs y partners que NO tocaste quedan EXACTAMENTE como están en la\n` +
      `base de datos. Lo que sí tocaste se sobrescribe con el valor nuevo.\n\n` +
      `¿Confirmar?`
    : `Guardar el REPARTO COMPLETO de ${CALC_STATE.kam} para ${mesName} ${mesYear}\n\n` +
      `• Agregador (Taxi + TukTuk): ${nAgg} partner-ciudad · AD ${fmt(a.sumAD)} · SH ${fmt(a.sumSH)} · N+R ${fmt(a.sumNR)}\n` +
      (nFleet ? `• Fleet: ${nFleet} partner-ciudad con meta\n` : "") +
      `\nTotal filas: ${rows.length}\n\n` +
      `⚠️ Esto REEMPLAZA las metas de ${mesName} ${mesYear} de TODOS los partners del\n` +
      `reparto, incluidos los que no tocaste. Si solo querías ajustar algunos,\n` +
      `cancela y elegí "Solo lo que cambié".\n\n` +
      `¿Confirmar y guardar en la base de datos?`;
  // FRENO ANTI-CEROS. La lógica vive en domain/metasGuard.ts (pura y testeada
  // con las filas reales del incidente del 13-ago-2026, cuando un guardado en
  // cero borró las metas de AGOSTO). Acá solo se aplica.
  //
  // Solo corre en modo "reparto completo": valida que el TOTAL de cada métrica
  // del reparto no sea 0, y en modo "solo lo que cambié" no hay reparto — una
  // corrección legítima de un único KPI daría total 0 en los otros dos y
  // quedaría bloqueada. La protección equivalente para ese modo es doble: el
  // filtro solo escribe lo tecleado (ver _calcFiltrarSoloCambios) y los ceros
  // que borran un valor existente se avisan uno por uno acá abajo.
  if (!soloCambios) {
    const chk = validarMetas(rows);
    if (!chk.ok) { alert(mensajeMetasInvalidas(chk.faltantes)); return; }
  } else {
    const ceros = _calcCerosQueBorran(rows);
    if (ceros.length && !confirm(
      `⚠️ Vas a poner en CERO ${ceros.length} meta(s) que hoy tienen un valor cargado:\n\n` +
      ceros.slice(0, 12).join("\n") +
      (ceros.length > 12 ? `\n…y ${ceros.length - 12} más` : "") +
      `\n\nUn 0 se guarda como meta 0, no "borra la fila". ¿Es lo que querés?`
    )) return;
  }

  if (!STATE._mensualLoaded) {
    alert("Los datos mensuales aún se están cargando. Espera unos segundos y vuelve a intentar.");
    return;
  }

  if (!confirm(summary)) return;

  showLoad(true, t("calc.guardandoMetas"));
  try {
    const clids = [...new Set(rows.map(r => r.clid))];
    // ilike, NO eq: la BD tiene casing mixto en `mes` por uploads viejos
    // ("Septiembre" vs "SEPTIEMBRE" — deleteMetasMes ya usa ilike por lo
    // mismo). Con eq, la fila vieja no se veía en el merge y el upsert (cuya
    // UNIQUE es case-sensitive) INSERTABA un duplicado del mismo mes que el
    // cliente luego sumaba dos veces.
    const { data: existing, error: selErr } = await _conReintento(() => sb.from("metas")
      .select("*").in("clid", clids).ilike("mes", mesName));
    if (selErr) throw selErr;
    const exMap = new Map((existing || []).map(x => [`${x.clid}|||${normCity(x.city)}`, x]));
    // Payload homogéneo (mismas claves en todas las filas) → sin sorpresas de union en
    // PostgREST. r (computado) pisa; ex rellena columnas de otras líneas no tocadas.
    // meta_tk_* siguen en la lista A PROPÓSITO aunque la calculadora ya no las
    // escriba: el merge las rellena desde `ex` (lo que ya está en BD), así que el
    // histórico de TukTuk se preserva en vez de quedar en NULL al reguardar.
    const COLS = ["clid", "partner", "kam", "city", "mes", "mes_year",
      "meta_active_drivers", "meta_nr", "meta_supply_hours",
      "meta_sh_car", "meta_acceptance", "meta_utilization",
      "meta_tk_ad", "meta_tk_nr", "meta_tk_cars", "meta_tk_sh"];
    const payload = rows.map(r => {
      const ex = exMap.get(`${r.clid}|||${r.city}`) || {};
      const merged = { ...ex, ...r };
      // Conservar el CASING del `mes` ya existente en BD: la UNIQUE
      // (clid,city,mes) es case-sensitive, así que escribir "SEPTIEMBRE"
      // sobre una fila "Septiembre" no conflictuaba → fila duplicada que el
      // cliente (que normaliza a mayúsculas al cargar) sumaba dos veces.
      if (ex.mes) merged.mes = ex.mes;
      const o = {};
      for (const c of COLS) o[c] = merged[c] !== undefined ? merged[c] : null;
      return o;
    });
    const { error } = await _conReintento(() =>
      sb.from("metas").upsert(payload, { onConflict: "clid,city,mes" }));
    if (error) throw error;
    await loadFromSupabase();
    // Forzar la re-lectura de lo guardado: si no, `saved` queda con el estado
    // ANTERIOR y la próxima comparación "¿cambió?" daría cambios fantasma.
    CALC_STATE.savedKey = "";
    showBanner(true, soloCambios
      ? `${payload.length} meta(s) actualizadas · ${CALC_STATE.kam} · ${mesName} ${mesYear}`
      : `Metas de ${CALC_STATE.kam} guardadas para ${mesName} ${mesYear} (${payload.length} filas)`);
    renderCalculator();
    if (STATE.curTab === "metas" && typeof renderMetas === "function") renderMetas();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (/failed to fetch|networkerror|network error|load failed/i.test(msg)) {
      alert(t("calc.errorRed"));
    } else if (/42501|row-level security|permission/i.test(msg)) {
      alert(t("calc.sinPermisosGuardar"));
    } else {
      alert(t("calc.errorGuardarMetas") + msg);
    }
  } finally {
    showLoad(false);
  }
}

// ── BORRAR LAS METAS DE UN KAM PARA EL MES OBJETIVO ──────────────────────────
// Complemento del "Eliminar metas del mes" de la pestaña Metas, que borra el mes
// ENTERO de todos los KAMs. Acá el alcance es el KAM elegido, para poder rehacer
// su carga sin tocar la de los demás.
//
// Admin-only en la UI; el enforcement real es RLS. Borra por CLID (no por la
// columna `kam` de la tabla, que puede haber quedado desactualizada respecto de
// `partners` si el partner cambió de KAM después de cargarse la meta).
export async function calcDeleteMetasKam() {
  if (!STATE.isAdmin) { alert(t("calc.borrarKamSoloAdmin")); return; }
  if (CALC_STATE.kam === "all") { alert(t("calc.borrarKamNeedKam")); return; }

  const m = _calcComputeModel();
  const { name: mesName, year: mesYear } = _calcNextMonthName(m.lastMonth || "");
  if (!mesName) return;

  // CLIDs que HOY pertenecen a este KAM (fuente de verdad: KAM_MAP/partners).
  const clids = Object.keys(STATE.KAM_MAP || {})
    .filter(c => (STATE.KAM_MAP[c] || "").trim() === CALC_STATE.kam);
  if (!clids.length) { alert(t("calc.borrarKamSinClids", { k: CALC_STATE.kam })); return; }

  // `x.kam` (no KAM_MAP[x.clid]): STATE.metasData NO expone `clid` — el loader
  // lo usa para resolver partner/kam pero no lo copia al objeto. `x.kam` ya
  // viene resuelto contra KAM_MAP ahí mismo, así que es la misma verdad.
  const afectadas = (STATE.metasData || []).filter(x =>
    x.mes === mesName && (mesYear == null || x.mYear == null || x.mYear === mesYear) &&
    (x.kam || "").trim() === CALC_STATE.kam);

  if (!afectadas.length) { alert(t("calc.borrarKamSinMetas", { k: CALC_STATE.kam, m: mesName })); return; }

  if (!confirm(
    `Eliminar las metas de ${CALC_STATE.kam} para ${mesName} ${mesYear}\n\n` +
    `• ${afectadas.length} fila(s) (partner-ciudad)\n` +
    `• Solo de este KAM: las de los demás KAMs no se tocan\n\n` +
    `Esta acción NO se puede deshacer. Después vas a tener que volver a cargar\n` +
    `las metas de ${CALC_STATE.kam} para ${mesName}.\n\n¿Confirmar?`
  )) return;

  showLoad(true, t("calc.borrandoMetas"));
  try {
    // ilike: casing mixto de `mes` en uploads viejos (mismo motivo que el select
    // del guardado y que deleteMetasMes en metas.ts).
    let q = sb.from("metas").delete().in("clid", clids).ilike("mes", mesName);
    if (mesYear != null) q = q.eq("mes_year", mesYear);
    const { error } = await _conReintento(() => q);
    if (error) throw error;
    await loadFromSupabase();
    CALC_STATE.savedKey = "";   // re-leer lo guardado (ahora vacío para este KAM)
    showBanner(true, `Metas de ${CALC_STATE.kam} eliminadas para ${mesName} ${mesYear} (${afectadas.length} filas)`);
    renderCalculator();
    if (STATE.curTab === "metas" && typeof renderMetas === "function") renderMetas();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (/42501|row-level security|permission/i.test(msg)) alert(t("calc.sinPermisosGuardar"));
    else alert(t("calc.errorBorrarMetas") + msg);
  } finally {
    showLoad(false);
  }
}

export async function calcDownloadPartnerImage() {
  const card = document.getElementById("calcExportCard");
  if (!card) return;
  showLoad(true, t("calc.generandoImagen"));
  try {
    await ensureHtml2Canvas();
    const canvas = await html2canvas(card, { scale: 2, useCORS: true, backgroundColor: "#fff" });
    const imgData = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = imgData;
    a.download = `meta_${CALC_STATE.selPartnerExport || "partner"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showBanner(true, t("calc.imagenDescargada"));
  } catch (err) {
    alert(t("calc.error") + err.message);
  } finally {
    showLoad(false);
  }
}

// ── COMBOBOX FLOTANTE PARA VISTA COMPARTIBLE ──────────────────────────────────
export function calcFilterExportPartners(q) {
  calcShowExportList();
  _calcPaintExportList(q);
}

export function calcShowExportList() {
  const list = document.getElementById("calcExportList");
  if (!list) return;
  list.style.display = "block";
  if (!list.innerHTML) {
    const inp = document.getElementById("calcExportSearch");
    _calcPaintExportList(inp ? inp.value : "");
  }
}

export function calcHideExportList() {
  const list = document.getElementById("calcExportList");
  if (list) list.style.display = "none";
}

export function _calcPaintExportList(q) {
  const list = document.getElementById("calcExportList");
  if (!list) return;
  // Universo = partners con taxi (agg 3M) ∪ partners con TukTuk (filtrados por KAM).
  const tkPartners = (STATE._tuktukMensualPartners || []).filter(p =>
    CALC_STATE.kam === "all" || getKAMForPartner(p) === CALC_STATE.kam);
  const all = [...new Set([
    ...[...(_calcCurrentAgg() || []).values()].map(e => e.partner),
    ...tkPartners
  ])].sort();
  const lower = (q || "").toLowerCase().trim();
  const filtered = lower ? all.filter(p => p.toLowerCase().includes(lower)) : all;
  if (!filtered.length) {
    list.innerHTML = `<div class="agy-style-180">Sin coincidencias</div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 100).map(p => {
    const c = STATE.partnerColors[p] || "#888";
    const sel = p === CALC_STATE.selPartnerExport;
    return `<div class="pv-opt" data-act-mousedown="calcSelectExportPartner" data-partner="${escapeHTML(p)}"
      style="padding:7px 12px;font-size:.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid #f3f3f3;${sel ? 'background:#fff0f0;font-weight:700' : ''}">
      <span style="width:7px;height:7px;border-radius:50%;background:${c};flex-shrink:0"></span>
      <span class="agy-style-181">${escapeHTML(p)}</span>
    </div>`;
  }).join("");
}

export function calcSelectExportPartner(p) {
  const inp = document.getElementById("calcExportSearch");
  if (inp) inp.value = p;
  calcHideExportList();
  calcOnExportPartnerChange(p);
}

export function calcExportKeydown(e) {
  if (e.key === "Enter") {
    const list = document.getElementById("calcExportList");
    const first = list && list.querySelector(".pv-opt");
    if (first) first.dispatchEvent(new MouseEvent("mousedown"));
    e.preventDefault();
  } else if (e.key === "Escape") {
    calcHideExportList();
  }
}

// Universo de partners para el combobox: agregado de los últimos 3 meses con el filtro KAM actual.
export function _calcCurrentAgg() {
  const rows = _calcGetMensualData();
  if (!rows.length) return new Map();
  const last3 = _calcLastNMonths(rows, 3);
  const last3Set = new Set(last3);
  const filteredRows = CALC_STATE.kam === "all"
    ? rows
    : rows.filter(r => (r.kam || getKAMForPartner(r.partner)) === CALC_STATE.kam);
  return _calcAggByPartnerCity(filteredRows, last3Set);
}

// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";

registerActions({
  calcSetTab:        d => calcSetTab(d.key),
  calcOnKamChange:   (d, el) => calcOnKamChange(el.value),
  calcApplyChanges, calcSaveMetas, calcExportExcel, calcResetEdits, calcDownloadPartnerImage,
  calcSetSaveMode:     d => calcSetSaveMode(d.mode),
  calcDeleteMetasKam,
  calcOnKamGoalChange: (d, el) => calcOnKamGoalChange(d.metric, el.value),
  calcOnGoalEdit:      (d, el) => calcOnGoalEdit(el),
  calcSetExportLang:   d => calcSetExportLang(d.code),
  calcFilterExportPartners: (d, el) => calcFilterExportPartners(el.value),
  calcExportKeydown:        (d, el, e) => calcExportKeydown(e),
  calcSelectExportPartner:  d => calcSelectExportPartner(d.partner),
  calcShowExportList,
  // blur (focusout) dispara ANTES que el click en un item de la lista, así que
  // hay que darle un margen para que el mousedown del click llegue primero —
  // mismo delay de 200ms que tenía el onblur inline original.
  calcHideExportListDelayed: () => setTimeout(calcHideExportList, 200)
});
