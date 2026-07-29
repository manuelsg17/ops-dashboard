//@ts-nocheck
import { ensurePdfLibs } from "./shared/lazyLibs.js";
import { logAccess } from "./shared/accessLog.js";
// Núcleo de cálculo compartido (snapshot vs flujo, proyecciones, ponderados).
// Import explícito y no global: es el módulo que define QUÉ significa cada
// número, y tiene tests — que se vea de dónde sale.
import {
  snapshotValue, seriesByDate, projectSnapshot, projectFlow,
  weightedAvg, ratio, sumKpis
} from "./domain/metrics.js";
// metas.js — Pestaña Metas

// Ordena meses por valor temporal. Acepta nombres ("MAYO","Mayo","may"),
// numeros ("5","05"), o fechas ("2026-05","2026-05-11").
export const _METAS_MES_ORDER = {
  enero:1, ene:1, jan:1, january:1,
  febrero:2, feb:2, february:2,
  marzo:3, mar:3, march:3,
  abril:4, abr:4, apr:4, april:4,
  mayo:5, may:5,
  junio:6, jun:6, june:6,
  julio:7, jul:7, july:7,
  agosto:8, ago:8, aug:8, august:8,
  septiembre:9, setiembre:9, sep:9, sept:9, september:9,
  octubre:10, oct:10, october:10,
  noviembre:11, nov:11, november:11,
  diciembre:12, dic:12, dec:12, december:12
};
export function _metasMesOrden(mes) {
  if (!mes) return 0;
  const m = String(mes).trim().toLowerCase();
  // Formato "YYYY-MM" o "YYYY-MM-DD"
  const ymMatch = m.match(/^(\d{4})-(\d{1,2})/);
  if (ymMatch) return parseInt(ymMatch[1]) * 100 + parseInt(ymMatch[2]);
  // Nombre de mes
  if (_METAS_MES_ORDER[m]) return 2000 + _METAS_MES_ORDER[m]; // sin año, asumir actual
  // Numero simple "5" o "05"
  const n = parseInt(m);
  if (!isNaN(n) && n >= 1 && n <= 12) return 2000 + n;
  return 0;
}

// Handler del selector de mes. Cambia el mes activo y re-renderiza.
// Valida contra los meses realmente disponibles en STATE.metasData.
export function setMetasMes(mes) {
  const disp = [...new Set(STATE.metasData.map(m => (m.mes || "").trim()))]
    .filter(Boolean);
  if (!disp.includes(mes)) {
    if (DEBUG) console.warn("setMetasMes: mes no disponible", mes, "disp:", disp);
    return;
  }
  STATE.metasMesSel = mes;
  if (STATE.curTab === "metas") renderMetas();
}

// ── LÍNEA DE NEGOCIO EN METAS (Agregador / Fleet / TukTuk) — Fase 3 ────────────
// Independiente de Rendimiento (STATE.metasLine propio). Diario no trae db_id → cae
// a Agregador. Actuales de Fleet/TukTuk salen de los slices materializados (Fase 2).
export function _metasLine() {
  // Ver la nota en rendimiento._rendLine: el diario ya trae db_id, así que las
  // 4 líneas funcionan en las 3 escalas.
  return STATE.metasLine || "comb";
}
export function setMetasLine(line) {
  if ((STATE.metasLine || "comb") === line) return;
  STATE.metasLine = line;
  if (STATE.curTab === "metas") renderMetas();
}
export function metasLineToggleHTML() {
  const line   = _metasLine();
  const diario = false;   // las 4 líneas ya funcionan en las 3 escalas
  const defs = [
    { k: "comb",  emoji: "🔀", label: "Combinado", tip: "Taxi + TukTuk sumados vs meta combinada — avance total del partner" },
    { k: "agg",   emoji: "📊", label: "Agregador", tip: "Metas Taxi (AD, N+R, Horas)" },
    { k: "fleet", emoji: "🚗", label: "Fleet",     tip: "Metas de flota (SH/auto, aceptación, utilización)" },
    { k: "tk",    emoji: "🛺", label: "TukTuk",    tip: "Metas TukTuk (AD, N+R, Brandeados)" }
  ];
  const btns = defs.map(d => {
    const on  = line === d.k;
    const dis = diario && d.k !== "agg";
    return `<button class="mode-btn${on ? " active" : ""}" ${dis ? "disabled" : ""}
      title="${dis ? "Sin datos diarios por sub-flota — usa escala semanal o mensual" : escapeHTML(d.tip)}"
      ${dis ? "" : `data-act="setMetasLine" data-line="${escapeHTML(d.k)}"`}
      style="${dis ? "opacity:.4;cursor:not-allowed" : ""}">${d.emoji} ${d.label}</button>`;
  }).join("");
  const note = diario
    ? `<span class="agy-style-213">Fleet/TukTuk/Combinado requieren escala semanal o mensual</span>`
    : "";
  return `<div class="mode-toggle-row agy-style-214">${btns}${note}</div>`;
}

// Slice de performance de la línea para la escala actual (Fase 2).
// "comb" = Taxi + TukTuk (disjuntos: TukTuk se excluye de rawData al cargar → sin doble conteo).
export function _metasLineDataset(line) {
  const slice = base => {
    const m = STATE.curMode;
    if (m === "mensual") return STATE["rawDataMensual" + base] || [];
    if (m === "diario")  return STATE["rawDataDiario"  + base] || [];
    return STATE["rawData" + base] || [];
  };
  if (line === "fleet") return slice("Fleet");
  if (line === "tk")    return slice("Tuktuk");
  if (line === "comb")  return STATE.rawData.concat(slice("Tuktuk"));
  return STATE.rawData;
}
// Actuales Fleet por (partner|||city) en [from,to]: SH/auto interno y aceptación
// ponderados (Σ internalFleetSh / Σ ownedCars; Σ(rate×trips)/Σtrips) — igual que
// presentacion2.p2FleetSeries / rendimiento._rendFleetAgg.
//
// Se conservan los NUMERADORES Y DENOMINADORES crudos (intSh, owned, accW, trips)
// además de las tasas ya calculadas: son imprescindibles para poder re-ponderar
// al agregar por ciudad/KAM/país. Promediar las tasas ya calculadas de varios
// partners daría un número sin significado (un partner con 3 autos pesaría igual
// que uno con 300).
export function _metasFleetActuals(from, to, selSet, cityFilter) {
  const by = new Map();
  const _sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  _metasLineDataset("fleet").forEach(r => {
    if (r.date < from || r.date > to) return;
    if (cityFilter !== "all" && r.city !== cityFilter) return;
    if (selSet.size && !_lineSelHas(selSet, _sidebar, r.partner)) return;
    const k = `${r.partner}|||${r.city}`;
    let e = by.get(k);
    if (!e) { e = { owned: 0, intSh: 0, trips: 0, accW: 0, branded: 0, _owned: {} }; by.set(k, e); }
    e.owned   += r.ownedFleetActiveCars || 0;
    e.intSh   += r.internalFleetSh || 0;
    e.trips   += r.trips || 0;
    e.accW    += (r.acceptanceRate || 0) * (r.trips || 0);
    e.branded += r.brandedActiveCars || 0;
    // Autos propios por fecha: `owned` de arriba acumula auto-períodos (es el
    // denominador correcto de SH/auto), pero para MOSTRAR "cuántos autos tiene"
    // hace falta el nivel del último período, no la suma sobre el tiempo.
    e._owned[r.date] = (e._owned[r.date] || 0) + (r.ownedFleetActiveCars || 0);
  });
  by.forEach(e => {
    e.shCar     = ratio(e.intSh, e.owned);
    e.accept    = ratio(e.accW, e.trips) * 100;
    e.ownedNow  = snapshotValue(seriesByDate(e._owned));
    delete e._owned;
  });
  return by;
}
// Actuales TukTuk por (partner|||city): AD y Brandeados son SNAPSHOT (último
// período); N+R y SH son FLUJO (Σ del rango). Se guardan también las SERIES por
// período: sin ellas no se puede proyectar (la de AD alimenta el máx × 1.4 y las
// de flujo el ritmo lineal). Ver src/domain/metrics.ts.
export function _metasTkActuals(from, to, selSet, cityFilter) {
  const by = new Map();
  const _sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  _metasLineDataset("tk").forEach(r => {
    if (r.date < from || r.date > to) return;
    if (cityFilter !== "all" && r.city !== cityFilter) return;
    if (selSet.size && !_lineSelHas(selSet, _sidebar, r.partner)) return;
    const k = `${r.partner}|||${r.city}`;
    let e = by.get(k);
    if (!e) { e = { _ad: {}, _cars: {}, _nr: {}, _sh: {}, nr: 0, sh: 0 }; by.set(k, e); }
    e._ad[r.date]   = (e._ad[r.date]   || 0) + (r.activeDrivers || 0);
    e._cars[r.date] = (e._cars[r.date] || 0) + (r.brandedActiveCars || 0);
    const nr = (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0);
    e._nr[r.date] = (e._nr[r.date] || 0) + nr;
    e._sh[r.date] = (e._sh[r.date] || 0) + (r.supplyHours || 0);
    e.nr += nr;
    e.sh += r.supplyHours || 0;   // acumulado del rango, igual que N+R (no es snapshot)
  });
  by.forEach(e => _finishSeries(e));
  return by;
}
// Actuales COMBINADOS (Taxi+TukTuk) por (partner|||city): AD = snapshot del ÚLTIMO
// período (misma convención que la slide "Avance Combinado" del deck), N+R y SH = Σ
// del rango. Opera sobre el dataset concat — las filas de ambas líneas de una misma
// fecha se suman antes de tomar el snapshot.
export function _metasCombActuals(from, to, selSet, cityFilter) {
  const by = new Map();
  const _sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  _metasLineDataset("comb").forEach(r => {
    if (r.date < from || r.date > to) return;
    if (cityFilter !== "all" && r.city !== cityFilter) return;
    if (selSet.size && !_lineSelHas(selSet, _sidebar, r.partner)) return;
    const k = `${r.partner}|||${r.city}`;
    let e = by.get(k);
    if (!e) { e = { _ad: {}, _cars: {}, _nr: {}, _sh: {}, nr: 0, sh: 0 }; by.set(k, e); }
    e._ad[r.date] = (e._ad[r.date] || 0) + (r.activeDrivers || 0);
    const nr = (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0);
    e._nr[r.date] = (e._nr[r.date] || 0) + nr;
    e._sh[r.date] = (e._sh[r.date] || 0) + (r.supplyHours || 0);
    e.nr += nr;
    e.sh += r.supplyHours || 0;
  });
  by.forEach(e => _finishSeries(e));
  return by;
}

// Cierra una entrada de actuals: convierte los mapas fecha→valor en series
// ordenadas, saca los snapshots y calcula las proyecciones. Compartido por
// TukTuk y Combinado para que las dos líneas no puedan divergir.
function _finishSeries(e) {
  const { daysElapsed, daysRemaining } = _metasProjDays();
  const adS = seriesByDate(e._ad);
  e.ad     = snapshotValue(adS);
  e.cars   = e._cars ? snapshotValue(seriesByDate(e._cars)) : 0;
  e.projAd = projectSnapshot(adS);
  e.projNr = projectFlow(e.nr, daysElapsed, daysRemaining);
  e.projSh = projectFlow(e.sh, daysElapsed, daysRemaining);
  // La serie por fecha SE CONSERVA (no se borra) porque la proyección de un
  // SNAPSHOT no se puede sumar hacia arriba: ver _metasAggKpi.
  e.adByDate   = e._ad;
  e.carsByDate = e._cars || {};
  delete e._ad; delete e._cars; delete e._nr; delete e._sh;
}

// Días transcurridos/restantes del mes de referencia, tomando la última fecha
// realmente visible en el filtro. Se calcula una vez por render (cachear acá
// evitaría recalcularlo por cada partner, pero el costo es despreciable frente
// a la claridad de no tener estado suelto).
function _metasProjDays() {
  const to = document.getElementById("dateTo")?.value || "";
  const dates = (STATE.allDates || []).filter(d => !to || d <= to);
  return calcProjectionDays(dates[dates.length - 1] || to);
}

// Fila meta-vs-actual para un KPI de tasa/valor (sin proyección). meta null → oculta.
export function _metaLineRow(label, actual, meta, fmtFn, metaOnlyNote) {
  if (meta == null && actual == null) return "";
  if (meta == null) {  // solo actual (sin meta cargada)
    return `<div class="agy-style-215">
      <div class="agy-style-216"><span>${label}</span>
        <span class="agy-style-217">${fmtFn(actual)} · <em class="agy-style-22">sin meta</em></span></div></div>`;
  }
  if (actual == null) {  // solo meta (ej. Utilización, sin actual medible)
    return `<div class="agy-style-215">
      <div class="agy-style-216"><span>${label}</span>
        <span><strong class="agy-style-218">${fmtFn(meta)}</strong> <span class="agy-style-219">meta${metaOnlyNote ? " · " + metaOnlyNote : ""}</span></span></div></div>`;
  }
  const p  = meta > 0 ? (actual / meta) * 100 : 0;
  const pV = Math.min(p, 100);
  const over = p > 100 ? `<span class="agy-style-220">🏆</span>` : "";
  return `
    <div class="agy-style-196">
      <div class="agy-style-221">
        <span>${label}</span>
        <span class="agy-style-222">
          <strong style="color:${pColor(p)}">${p.toFixed(1)}%</strong>
          <span class="sem ${semCls(p)}"></span>${over}
        </span>
      </div>
      <div class="agy-style-223">
        Fact: <strong>${fmtFn(actual)}</strong> / Meta: <strong>${fmtFn(meta)}</strong>
      </div>
      ${barProj(pV, pV)}
    </div>`;
}

// ── VISTAS DE LÍNEA (Fleet / TukTuk / Combinado) ─────────────────────────────
//
// Las tres comparten EXACTAMENTE la misma estructura que Agregador —
// General (Perú) → Ciudad → KAM → Partner — porque el usuario navega entre
// líneas con el toggle y saltar de un layout a otro hace que se pierda: antes
// Fleet arrancaba directo en tarjetas de partner y TukTuk/Combinado mostraban
// un resumen país y nada más.
//
// El renderer es uno solo (`_renderMetasLineView`); cada línea solo aporta su
// descriptor de KPIs. Así, un arreglo en cómo se agrega o proyecta un número
// vale para las tres a la vez.

// Descriptor de un KPI de línea:
//   label   → texto visible
//   meta(m) → valor de meta de una fila de `metas` (null = ese partner no tiene
//             esta meta; NO es lo mismo que meta 0)
//   act(a)  → valor actual de una entrada de actuals (null = sin actual medible)
//   proj(a) → proyección al cierre (null = no aplica, ej. tasas)
//   fmtFn   → formateo del número
//   weight(a) → SOLO para KPIs de TASA. Al agregar por ciudad/KAM/país la tasa
//             se re-pondera por este denominador en vez de sumarse. Sin esto,
//             un partner con 3 autos pesaría lo mismo que uno con 300.
//   note    → nota al pie cuando el KPI es solo-meta

// Agrega un KPI sobre un conjunto de unidades (partner-ciudad).
// Devuelve null en `actual`/`meta` cuando NINGUNA unidad aportó el dato — eso
// es lo que permite distinguir "sin meta cargada" de "meta cero", que se ven
// igual si se colapsa todo a 0.
function _metasAggKpi(kpi, units) {
  if (kpi.weight) {
    const aw = [], mw = [];
    units.forEach(u => {
      const w  = kpi.weight(u.a) || 0;
      const av = u.a ? kpi.act(u.a)  : null;
      const mv = u.m ? kpi.meta(u.m) : null;
      if (av != null) aw.push([av, w]);
      if (mv != null) mw.push([mv, w]);
    });
    return {
      actual: aw.length ? weightedAvg(aw) : null,
      meta:   mw.length ? weightedAvg(mw) : null,
      proj:   null
    };
  }
  let a = 0, m = 0, p = 0, hasA = false, hasM = false, hasP = false;
  // Proyección de un SNAPSHOT (Active Drivers): NO se suman las proyecciones de
  // cada unidad — se reconstruye la serie del NIVEL que se está mostrando y se
  // toma su máximo.
  //
  // POR QUÉ IMPORTA (caso real, Lizzo): Lima pico 2.490 en una semana y Arequipa
  // 229 en OTRA. Sumar los máximos da 2.769, un número que nunca ocurrió; el
  // máximo de la serie total es 2.762, que sí es una semana real. La regla de
  // negocio dice "la semana con el número más alto de AD", así que la única
  // lectura fiel es la segunda. Sumar hacia arriba asumía que todas las ciudades
  // (y todos los partners) picaban el mismo día, y sobre-estimaba siempre.
  const serieAgregada = kpi.snapSeries ? {} : null;
  units.forEach(u => {
    const av = u.a ? kpi.act(u.a) : null;
    if (av != null) { a += av; hasA = true; }
    const mv = u.m ? kpi.meta(u.m) : null;
    if (mv != null) { m += mv; hasM = true; }
    if (serieAgregada) {
      const byDate = u.a ? kpi.snapSeries(u.a) : null;
      if (byDate) {
        Object.keys(byDate).forEach(d => { serieAgregada[d] = (serieAgregada[d] || 0) + byDate[d]; });
        hasP = true;
      }
      return;
    }
    const pv = (u.a && kpi.proj) ? kpi.proj(u.a) : null;
    if (pv != null) { p += pv; hasP = true; }
  });
  if (serieAgregada && hasP) p = projectSnapshot(seriesByDate(serieAgregada));
  return {
    actual: hasA ? a : null,
    meta:   hasM ? m : null,
    // Sin proyección propia, la mejor estimación es el actual (no 0, que
    // dibujaría una barra de proyección vacía y se leería como "no va a llegar").
    proj:   hasP ? p : (hasA ? a : null)
  };
}

// Aviso de escala: la META es MENSUAL, así que el % de cumplimiento solo se lee
// derecho en escala mensual. En diario y semanal el FACT de Active Drivers es un
// SNAPSHOT del período (los activos de UN día / de UNA semana) contra un
// objetivo de MES entero — comparación que da un porcentaje bajo por
// construcción, aunque el mes vaya perfecto.
//
// Caso real que motivó esto (jul 2026): el mismo negocio mostraba 25,6% en
// diario y 54,9% en semanal. Ninguno de los dos era el cumplimiento real.
function _metasEscalaAviso() {
  const m = STATE.curMode;
  if (m === "mensual") return "";
  const esDiario = m === "diario";
  const unidad   = esDiario ? "un día" : "una semana";
  return `<div class="metas-escala-aviso">
    <span class="mea-ico">${esDiario ? "📅" : "🗓️"}</span>
    <div>
      <strong>Los % de cumplimiento no son comparables en esta escala.</strong>
      La meta del mes se compara contra <strong>Conductores Activos de ${unidad}</strong>:
      un conductor que maneja varios días cuenta una sola vez en el mes, pero acá se lo
      mide en un período mucho más corto. El porcentaje va a verse bajo aunque el mes
      vaya bien.
      <span class="mea-hint">Nuevos+Reactivados y Horas sí acumulan, así que esos avanzan
      normal. Para leer el cumplimiento real, cambiá la escala a <strong>Mensual</strong>.</span>
    </div>
  </div>`;
}

// Barra de controles de Metas: selector de mes + borrado (admin) + PDF.
// Vive acá porque la usan TANTO el agregador como las vistas de línea — antes
// solo la pintaba el agregador, así que cambiar a Fleet/TukTuk/Combinado hacía
// desaparecer el selector de mes y el botón de PDF sin ninguna razón.
function _metasControlsHTML(mesName, mesesDisponibles) {
  // Selector de mes (solo si hay 2+ meses cargados)
  const mesSelectorHTML = mesesDisponibles.length > 1
    ? `<div class="agy-style-231">
         <label class="agy-style-232">Mes:</label>
         <select data-act-change="setMetasMes" class="agy-style-233">
           ${mesesDisponibles.map(m => `<option value="${escapeHTML(m)}" ${m === mesName ? "selected" : ""}>${escapeHTML(m)}</option>`).join("")}
         </select>
       </div>`
    : "";
  // Botón de borrado (solo admin): elimina TODAS las metas del mes mostrado para
  // poder re-subir el Excel. El enforcement real es RLS (is_admin()); este gate
  // solo oculta el botón. data-html2canvas-ignore lo excluye del PDF descargable
  // (el partner no debe verlo).
  const delBtnHTML = STATE.isAdmin
    ? `<button class="apply-btn agy-style-234" data-html2canvas-ignore="true" data-act="deleteMetasMes" data-mes="${escapeHTML(mesName)}"
         title="Borra todas las metas de ${escapeHTML(mesName)} para re-subir el Excel">
         🗑️ Eliminar metas de ${escapeHTML(mesName)}
       </button>`
    : "";
  return `<div class="agy-style-235">
    ${mesSelectorHTML}
    <div class="agy-style-236">
      ${delBtnHTML}
      <button class="apply-btn agy-style-237" id="metasPdfBtn" data-act="downloadMetasPDF">⬇ Descargar PDF</button>
    </div>
  </div>`;
}

// Renderer común de una línea. `cfg`:
//   icon/color/title/sub  → cabecera
//   metaRows              → filas de STATE.metasData del mes/filtros, ya acotadas
//   act                   → Map "partner|||city" → actual
//   kpis                  → descriptores (arriba)
//   emptyHint             → qué hacer si no hay metas de esta línea
function _renderMetasLineView(cfg) {
  const { mesName, icon, color, title, sub, metaRows, act, kpis, emptyHint } = cfg;

  let html = metasLineToggleHTML();
  html += _metasControlsHTML(mesName, cfg.mesesDisponibles || []);
  html += _metasEscalaAviso();
  html += secH(icon, color, title + " — " + mesName, sub, "Peru");

  if (!metaRows.length) {
    html += `<div class="section"><div class="agy-style-224">${emptyHint}</div></div>`;
    return html;
  }

  // Universo de unidades a mostrar: toda fila de meta de esta línea, más su
  // actual si existe. Se indexa por (partner, ciudad) — la misma granularidad
  // en la que se cargan las metas.
  const units = metaRows.map(m => ({ m, a: act.get(`${m.partner}|||${m.city}`) || null }));

  // ── 1. General (Perú) ─────────────────────────────────────────────────────
  html += `<div class="section"><div class="metric-row agy-style-226">`;
  kpis.forEach(k => {
    const g = _metasAggKpi(k, units);
    if (g.meta == null && g.actual == null) return;
    html += metaResCard(k.label, k.sub || "", g.actual, g.meta, g.proj, k.color || color, k.fmtFn);
  });
  html += `</div></div>`;

  // ── 2. Por Ciudad ─────────────────────────────────────────────────────────
  const byCity = new Map();
  units.forEach(u => {
    const c = u.m.city || "";
    if (!c) return;
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(u);
  });
  if (byCity.size) {
    html += secH("🏙️", "#06b6d4", title + " por Ciudad", "Progreso y proyección", "");
    html += `<div class="section"><div class="city-grid">`;
    // Orden: CITIES primero (orden canónico del dashboard), después cualquier
    // ciudad que aparezca en metas y no esté en esa lista — que existan es un
    // dato de la BD, no un motivo para esconderlas.
    const cityOrder = [...CITIES.filter(c => byCity.has(c)),
                       ...[...byCity.keys()].filter(c => !CITIES.includes(c)).sort()];
    cityOrder.forEach(city => {
      const us  = byCity.get(city) || [];
      const col = CITY_COLORS[city] || "#888";
      let rows = "";
      kpis.forEach(k => {
        const g = _metasAggKpi(k, us);
        if (g.meta == null && g.actual == null) return;
        rows += miniBar(k.label, g.actual, g.meta, g.proj, k.fmtFn);
      });
      html += `
        <div class="city-card" style="border-top-color:${col}">
          <div class="city-name">
            <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
            ${escapeHTML(cityLabel(city))}
            <span class="agy-style-244">(${us.length} cuenta${us.length === 1 ? "" : "s"})</span>
          </div>
          ${rows}
        </div>`;
    });
    html += `</div></div>`;
  }

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  const byKam = new Map();
  units.forEach(u => {
    const k = u.m.kam || "Sin KAM";
    if (!byKam.has(k)) byKam.set(k, []);
    byKam.get(k).push(u);
  });
  if (byKam.size) {
    html += secH("👤", "#f59e0b", title + " por KAM", "Progreso total por responsable", "");
    html += `<div class="section"><div class="agy-style-239">`;
    [...byKam.keys()].sort().forEach(kam => {
      const us  = byKam.get(kam) || [];
      const col = KAM_COLORS[kam] || "#888";
      let rows = "";
      kpis.forEach(k => {
        const g = _metasAggKpi(k, us);
        if (g.meta == null && g.actual == null) return;
        rows += miniBar(k.label, g.actual, g.meta, g.proj, k.fmtFn);
      });
      html += `
        <div class="city-card" style="border-top-color:${col}">
          <div class="city-name">
            <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
            ${escapeHTML(kam)}
            <span class="agy-style-244">(${us.length} cuenta${us.length === 1 ? "" : "s"})</span>
          </div>
          ${rows}
        </div>`;
    });
    html += `</div></div>`;
  }

  // ── 4. Por Partner ────────────────────────────────────────────────────────
  html += secH("🃏", color, title + " por Partner", "Meta vs actual individual", "");
  html += `<div class="section"><div class="partner-grid">`;
  units.forEach(u => {
    const m      = u.m;
    const a      = u.a;
    const col    = STATE.partnerColors[m.partner] || color;
    const kcolor = KAM_COLORS[m.kam] || "#888";
    let rows = "";
    kpis.forEach(k => {
      const mv = k.meta(m);
      const av = a ? k.act(a) : null;
      rows += _metaLineRow(k.label, mv != null ? av : null, mv, k.fmtFn, k.note);
    });
    html += `
      <div class="pcard" style="border-left-color:${col}">
        <div class="pcard-name">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col};margin-right:5px"></span>
          ${escapeHTML(m.partner)}
          <span class="agy-style-227">${icon} ${escapeHTML(cfg.badge || title)}</span>
        </div>
        <div class="pcard-sub">
          <span style="width:7px;height:7px;border-radius:50%;background:${kcolor};display:inline-block;margin-right:3px"></span>
          ${escapeHTML(m.kam)} &nbsp;·&nbsp; ${escapeHTML(m.city)}
        </div>
        ${rows}
        ${cfg.partnerFoot ? cfg.partnerFoot(m, a) : ""}
      </div>`;
  });
  html += `</div></div>`;
  return html;
}

// Filtro común de filas de meta de una línea.
function _metasLineRows(mesName, hasLineMeta, selSet, cityFilter, kamFilter) {
  return STATE.metasData.filter(m =>
    m.mes === mesName &&
    hasLineMeta(m) &&
    (kamFilter === "all" || m.kam === kamFilter) &&
    (!selSet.size || _lineSelHas(selSet, new Set(STATE.sidebarPartners || STATE.allPartners), m.partner)) &&
    (cityFilter === "all" || m.city === cityFilter)
  ).sort((a, b) => a.partner.localeCompare(b.partner));
}

// Vista Metas Fleet. Sus KPIs son TASAS (SH/auto, aceptación), no cantidades:
// por eso llevan `weight` y NO llevan proyección — proyectar una tasa al cierre
// del mes por ritmo lineal no significa nada (una tasa no se acumula).
export function _renderMetasFleet(mesName, from, to, selSet, cityFilter, kamFilter, mesesDisponibles) {
  return _renderMetasLineView({
    mesName, mesesDisponibles, icon: "🚗", color: "#0891b2", title: "Metas Fleet", badge: "Fleet",
    sub: "Meta de flota vs actual del rango · SH/auto (interno), aceptación, utilización · las tasas se ponderan por autos/viajes al agrupar",
    act: _metasFleetActuals(from, to, selSet, cityFilter),
    metaRows: _metasLineRows(mesName,
      m => m.mSHcar != null || m.mAcc != null || m.mUtil != null,
      selSet, cityFilter, kamFilter),
    kpis: [
      { label: "SH / Auto (interno)", sub: "ponderado",
        meta: m => m.mSHcar, act: a => a.shCar, proj: null,
        weight: a => a.owned, fmtFn: v => fmt(v) },
      { label: "Aceptación", sub: "ponderado por viajes",
        meta: m => m.mAcc, act: a => a.accept, proj: null,
        weight: a => a.trips, fmtFn: v => fmt(v) + "%" },
      { label: "Utilización", sub: "solo meta",
        meta: m => m.mUtil, act: () => null, proj: null,
        weight: a => a.owned, fmtFn: v => fmt(v) + "%", note: "sin actual medible" }
    ],
    partnerFoot: (m, a) => a
      ? `<div class="agy-style-230">Autos propios (último período): <strong>${fmt(a.ownedNow || 0)}</strong> · brandeados ${fmt(a.branded || 0)}</div>`
      : "",
    emptyHint: `No hay metas <strong>Fleet</strong> cargadas para ${escapeHTML(mesName)}.<br>
      Genéralas desde la <strong>Calculadora → Fleet</strong> y guárdalas, o ajusta el filtro.`
  });
}

// Vista Metas TukTuk: KPIs aditivos (AD/N+R/Brandeados/Horas).
export function _renderMetasTk(mesName, from, to, selSet, cityFilter, kamFilter, mesesDisponibles) {
  return _renderMetasLineView({
    mesName, mesesDisponibles, icon: "🛺", color: "#7e22ce", title: "Metas TukTuk", badge: "TukTuk",
    sub: "Meta TukTuk vs actual del rango · Active Drivers, N+R, Brandeados, Horas de Conexión",
    act: _metasTkActuals(from, to, selSet, cityFilter),
    metaRows: _metasLineRows(mesName,
      m => m.mtkAD != null || m.mtkNR != null || m.mtkCars != null || m.mtkSH != null,
      selSet, cityFilter, kamFilter),
    kpis: [
      { label: "Active Drivers", sub: "último período", color: "#7e22ce",
        meta: m => m.mtkAD, act: a => a.ad, proj: a => a.projAd,
        snapSeries: a => a.adByDate, fmtFn: v => fmt(v) },
      { label: "Nuevos + React", sub: "acumulado", color: "#f97316",
        meta: m => m.mtkNR, act: a => a.nr, proj: a => a.projNr, fmtFn: v => fmt(v) },
      { label: "Brandeados", sub: "último período", color: "#0891b2",
        // Brandeados NO lleva snapSeries: su proyección es PLANA (= nivel
        // actual), no máx × 1.4 — el factor 1.4 es una regla específica de
        // Active Drivers, no de cualquier snapshot.
        meta: m => m.mtkCars, act: a => a.cars, proj: a => a.cars, fmtFn: v => fmt(v) },
      { label: "Horas Conexión", sub: "acumulado", color: "#8b5cf6",
        meta: m => m.mtkSH, act: a => a.sh, proj: a => a.projSh, fmtFn: v => fmtSmart(v) }
    ],
    emptyHint: `No hay metas <strong>TukTuk</strong> cargadas para ${escapeHTML(mesName)}.<br>
      Genéralas desde la <strong>Calculadora → TukTuk</strong> y guárdalas, o ajusta el filtro.`
  });
}

// Vista Metas COMBINADO (Taxi+TukTuk): actuales sumados de ambas líneas vs meta
// combinada (meta agregador + meta TukTuk). Misma fórmula que la slide "Avance
// Combinado" de Presentación 2.0 — si el partner se enfoca en TukTuk, ese avance
// también cuenta para su meta.
export function _renderMetasComb(mesName, from, to, selSet, cityFilter, kamFilter, mesesDisponibles) {
  // Meta combinada = meta Taxi + meta TukTuk. `null` cuando NINGUNA de las dos
  // existe (para no dibujar una meta 0 inventada en un partner que simplemente
  // no tiene ese KPI cargado).
  const sumMeta = (taxi, tk) => (taxi == null && tk == null) ? null : (taxi || 0) + (tk || 0);
  return _renderMetasLineView({
    mesName, mesesDisponibles, icon: "🔀", color: "#8b5cf6", title: "Metas Combinado", badge: "Combinado",
    sub: "Actual del RANGO seleccionado (ambas líneas sumadas) vs meta combinada · si el partner empuja TukTuk también avanza su meta · para % reales usa el preset del mes de la meta",
    act: _metasCombActuals(from, to, selSet, cityFilter),
    metaRows: _metasLineRows(mesName,
      m => (m.mA || 0) > 0 || (m.mNR || 0) > 0 || (m.mH || 0) > 0 ||
           m.mtkAD != null || m.mtkNR != null || m.mtkSH != null,
      selSet, cityFilter, kamFilter),
    kpis: [
      { label: "Active Drivers", sub: "último período", color: "#8b5cf6",
        meta: m => sumMeta(m.mA || null, m.mtkAD), act: a => a.ad, proj: a => a.projAd,
        snapSeries: a => a.adByDate, fmtFn: v => fmt(v) },
      { label: "Nuevos + React", sub: "acumulado", color: "#f97316",
        meta: m => sumMeta(m.mNR || null, m.mtkNR), act: a => a.nr, proj: a => a.projNr, fmtFn: v => fmt(v) },
      { label: "Horas Conexión", sub: "acumulado", color: "#0891b2",
        meta: m => sumMeta(m.mH || null, m.mtkSH), act: a => a.sh, proj: a => a.projSh, fmtFn: v => fmtSmart(v) }
    ],
    partnerFoot: m => {
      const hasTk = m.mtkAD != null || m.mtkNR != null || m.mtkSH != null;
      return hasTk
        ? `<div class="agy-style-230">Meta = Taxi ${fmt(m.mA || 0)} + TukTuk ${fmt(m.mtkAD || 0)} AD · N+R ${fmt(m.mNR || 0)}+${fmt(m.mtkNR || 0)} · SH ${fmtSmart(m.mH || 0)}+${fmtSmart(m.mtkSH || 0)}</div>`
        : `<div class="agy-style-230" title="Este partner no tiene metas TukTuk — su combinado equivale al agregador">Sin metas TukTuk · el combinado equivale al agregador</div>`;
    },
    emptyHint: `No hay metas cargadas para ${escapeHTML(mesName)} con el filtro actual.<br>
      Genéralas desde la <strong>Calculadora</strong> y guárdalas, o ajusta el filtro.`
  });
}

// Guard de reentrancia: doble-click o filtros solapados no deben lanzar dos
// renders concurrentes (mismo patron que rendimiento.js).
export let _renderMetasBusy = false;
export function renderMetas() {
  if (_renderMetasBusy) return;
  if (!STATE.metasData.length) return;
  _renderMetasBusy = true;
  try {
    _renderMetasImpl();
  } finally {
    _renderMetasBusy = false;
  }
}

export function _renderMetasImpl() {
  // Garantiza índices secundarios construidos antes de cualquier lookup
  ensureIndexes();

  const cityFilter = document.getElementById("cityFilter").value;
  const kamFilter  = document.getElementById("kamFilter").value;
  const sel        = getSel();
  const from       = document.getElementById("dateFrom").value;
  const to         = document.getElementById("dateTo").value;
  const selSet     = new Set(sel);

  // Detectar el mes MAS RECIENTE de metasData y limitar el render a ese mes.
  // Antes: mostraba metasData[0].mes (primer registro = mes mas antiguo) y
  // sumaba metas de TODOS los meses, inflando %% de cumplimiento.
  const mesesDisponibles = [...new Set(STATE.metasData.map(m => m.mes))]
    .filter(Boolean)
    .sort((a, b) => _metasMesOrden(b) - _metasMesOrden(a));
  // Permitir override manual via STATE.metasMesSel (selector futuro)
  const mesName = STATE.metasMesSel && mesesDisponibles.includes(STATE.metasMesSel)
    ? STATE.metasMesSel
    : (mesesDisponibles[0] || "");

  // Fase 3: líneas Fleet / TukTuk. Vista dedicada (meta vs actual de la línea) que
  // reemplaza el cuerpo de Metas. El agregador sigue con el flujo de abajo intacto.
  if (_metasLine() !== "agg") {
    document.getElementById("metasEmpty").style.display   = "none";
    document.getElementById("metasContent").style.display = "";
    const _line = _metasLine();
    document.getElementById("metasContent").innerHTML =
        _line === "fleet" ? _renderMetasFleet(mesName, from, to, selSet, cityFilter, kamFilter, mesesDisponibles)
      : _line === "comb"  ? _renderMetasComb(mesName, from, to, selSet, cityFilter, kamFilter, mesesDisponibles)
      :                     _renderMetasTk(mesName, from, to, selSet, cityFilter, kamFilter, mesesDisponibles);
    return;
  }

  const metas = STATE.metasData.filter(m => {
    if (m.mes !== mesName)                        return false;
    if (kamFilter !== "all" && m.kam !== kamFilter) return false;
    if (sel.length && !selSet.has(m.partner))     return false;
    return true;
  });

  // Build performance data by partner+city+date (full precision)
  const perfF  = getFilteredByDateRange(from, to);
  const cpMap  = {};
  // Diagnostico: trackear breakdown de los 3 componentes de N+R
  let _diagNP = 0, _diagNS = 0, _diagRE = 0;
  perfF.forEach(r => {
    const k = `${r.partner}|||${r.city}|||${r.date}`;
    if (!cpMap[k]) cpMap[k] = { partner: r.partner, city: r.city, date: r.date, ad: 0, nr: 0, sh: 0 };
    cpMap[k].ad += r.activeDrivers;
    cpMap[k].nr += r.newPartner + r.newService + r.reactivated;
    cpMap[k].sh += r.supplyHours;
    _diagNP += r.newPartner   || 0;
    _diagNS += r.newService   || 0;
    _diagRE += r.reactivated  || 0;
  });
  const cpRows = Object.values(cpMap);

  // Diagnostico de N+R: imprime breakdown y advierte si solo hay reactivados
  // (sintoma de que el upload no capturo new_from_partner / new_from_service)
  if (perfF.length) {
    if (DEBUG) console.log(`[METAS ${STATE.curMode}] Breakdown N+R en rango ${from} → ${to}:`,
      { newPartner: _diagNP, newService: _diagNS, reactivated: _diagRE,
        total: _diagNP + _diagNS + _diagRE });
    if ((_diagNP + _diagNS) === 0 && _diagRE > 0) {
      console.warn(
        "[METAS] new_from_partner y new_from_service son 0 en la BD. " +
        "El upload del Excel no capturo esas columnas. " +
        "Verifica los nombres de columna en el Excel (deben contener 'from partner', " +
        "'from service' o 'new drivers')."
      );
    }
  }

  // New projection: based on last data date + 6 days = end of current week
  const maxDate = cpRows.length ? cpRows.map(r => r.date).sort().at(-1) : to;
  const { daysElapsed, daysRemaining } = calcProjectionDays(maxDate);

  // Pre-indexar cpRows por partner y por partner+city UNA vez.
  // Antes getRPC hacia cpRows.filter() ~550 veces (O(n) por call).
  // Ahora es O(1) lookup. Reduce ~150-300ms en datasets grandes.
  const cpByPartnerAll  = new Map(); // partner → rows[]   (todas las ciudades)
  const cpByPartnerCity = new Map(); // "partner|||city" → rows[]
  cpRows.forEach(r => {
    let a = cpByPartnerAll.get(r.partner);
    if (!a) { a = []; cpByPartnerAll.set(r.partner, a); }
    a.push(r);
    const k = `${r.partner}|||${r.city}`;
    let b = cpByPartnerCity.get(k);
    if (!b) { b = []; cpByPartnerCity.set(k, b); }
    b.push(r);
  });

  function getRPC(partner, city) {
    const rows = (city === "" || city === "all")
      ? (cpByPartnerAll.get(partner) || [])
      : (cpByPartnerCity.get(`${partner}|||${city}`) || []);
    if (!rows.length) return { ad: 0, nr: 0, sh: 0, lastAD: 0, nrV: [], shV: [], adV: [], adByDate: {} };
    // Agregar por fecha (sumando ciudades cuando city = "all")
    const bd = {};
    rows.forEach(r => {
      if (!bd[r.date]) bd[r.date] = { ad: 0, nr: 0, sh: 0 };
      bd[r.date].ad += r.ad; bd[r.date].nr += r.nr; bd[r.date].sh += r.sh;
    });
    const sortedDates = Object.keys(bd).sort();
    const sorted = sortedDates.map(d => bd[d]);
    // Mapa fecha -> AD: hace falta para proyectar a nivel ciudad/KAM/país sobre
    // la serie AGREGADA de ese nivel, en vez de sumar proyecciones por partner
    // (ver la nota larga en _metasAggKpi).
    const adByDate = {};
    sortedDates.forEach(d => { adByDate[d] = bd[d].ad; });
    // Calcular max/sum en una sola pasada en lugar de 3 pasadas
    let adMax = 0, nrSum = 0, shSum = 0;
    const nrV = [], shV = [], adV = [];
    for (const v of sorted) {
      if (v.ad > adMax) adMax = v.ad;
      nrSum += v.nr;
      shSum += v.sh;
      nrV.push(v.nr);
      shV.push(v.sh);
      adV.push(v.ad);
    }
    return {
      ad:     adMax,
      nr:     nrSum,
      sh:     shSum,
      lastAD: sorted[sorted.length - 1]?.ad || 0,
      nrV,
      shV,
      adV,      // serie por periodo: alimenta projectSnapshot (max x 1.4)
      adByDate  // misma serie keyed por fecha, para re-agregar por nivel
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
        ad: r.lastAD, nr: r.nr, sh: r.sh,
        projAD: projectSnapshot(r.adV),
      adByDate: r.adByDate,
        adByDate: r.adByDate,
        projNR: projA(r.nrV, daysElapsed, daysRemaining),
        projSH: projA(r.shV, daysElapsed, daysRemaining) });
    });
  } else {
    metas.filter(m => m.city === cityFilter).forEach(m => {
      const r = getRPC(m.partner, m.city);
      combos.push({ partner: m.partner, kam: m.kam, city: m.city,
        mA: m.mA, mNR: m.mNR, mH: m.mH,
        ad: r.lastAD, nr: r.nr, sh: r.sh,
        projAD: projectSnapshot(r.adV),
      adByDate: r.adByDate,
        adByDate: r.adByDate,
        projNR: projA(r.nrV, daysElapsed, daysRemaining),
        projSH: projA(r.shV, daysElapsed, daysRemaining) });
    });
  }

  // Agregar partners CON performance pero SIN meta. Su FACT y proyección
  // suman al KAM/Ciudad/Peru aunque no tengan plan asignado. Plan = 0.
  const partnersWithMetaSet = new Set(combos.map(c => c.partner));
  const partnersInPerf = [...new Set(cpRows.map(r => r.partner))]
    .filter(p => selSet.has(p) && !partnersWithMetaSet.has(p));

  partnersInPerf.forEach(p => {
    const partnerKam = getKAMForPartner(p) || "Sin KAM";
    // Si el usuario filtra por KAM, excluir partners sin meta de otros KAMs
    if (kamFilter !== "all" && partnerKam !== kamFilter) return;
    const r = getRPC(p, cityFilter === "all" ? "all" : cityFilter);
    if (r.ad === 0 && r.nr === 0 && r.sh === 0) return;
    combos.push({
      partner: p,
      kam: partnerKam,
      city: cityFilter === "all" ? "Sin Plan" : cityFilter,
      mA: 0, mNR: 0, mH: 0,
      ad: r.lastAD, nr: r.nr, sh: r.sh,
      projAD: projectSnapshot(r.adV),
      adByDate: r.adByDate,
      projNR: projA(r.nrV, daysElapsed, daysRemaining),
      projSH: projA(r.shV, daysElapsed, daysRemaining),
      noMeta: true
    });
  });

  // Totals
  const tMA = metas.reduce((s, m) => s + m.mA,  0);
  const tMNR= metas.reduce((s, m) => s + m.mNR, 0);
  const tMH = metas.reduce((s, m) => s + m.mH,  0);
  const tAD = combos.reduce((s, c) => s + c.ad,  0);
  const tNR = combos.reduce((s, c) => s + c.nr,  0);
  const tSH = combos.reduce((s, c) => s + c.sh,  0);
  // Proyección de AD del NIVEL (no la suma de las de cada partner): se juntan
  // las series por fecha y se toma el máximo del total. Sumar los máximos
  // individuales asume que todos los partners picaron la misma semana y
  // sobre-estima siempre. Ver la nota en _metasAggKpi.
  const _projADde = (arr) => {
    const merged = {};
    arr.forEach(c => {
      const m = c.adByDate || {};
      Object.keys(m).forEach(d => { merged[d] = (merged[d] || 0) + m[d]; });
    });
    return projectSnapshot(seriesByDate(merged));
  };
  const tPAD= _projADde(combos);
  const tPNR= combos.reduce((s, c) => s + c.projNR, 0);
  const tPSH= combos.reduce((s, c) => s + c.projSH, 0);

  document.getElementById("metasEmpty").style.display   = "none";
  document.getElementById("metasContent").style.display = "";

  let html = metasLineToggleHTML();
  html += _metasControlsHTML(mesName, mesesDisponibles);
  html += _metasEscalaAviso();

  // ── 1. Peru Summary ───────────────────────────────────────────────────────
  // Contador de partners en perf SIN meta asignada (sus fact suma al total
  // pero no tienen plan -> %% pueden verse altos sin contexto).
  const noMetaCount = combos.filter(c => c.noMeta).length;
  const noMetaBanner = noMetaCount > 0
    ? `<div class="agy-style-238">
         ⚠️ <strong>${noMetaCount}</strong> partner${noMetaCount>1?"s":""} con performance pero <strong>sin meta asignada</strong> en ${escapeHTML(mesName)}.
         Su FACT suma al total pero el % de cumplimiento puede verse alto.
       </div>`
    : "";
  html += secH("🎯","#8b5cf6","Cumplimiento de Metas - "+mesName,"Progreso actual vs meta del mes","Peru");
  html += `<div class="section">${noMetaBanner}<div class="metric-row">
    ${metaResCard(METRICS.ad.label, "última semana",  tAD, tMA,  tPAD, "#8b5cf6")}
    ${metaResCard(METRICS.nr.label, "acumulado mes",  tNR, tMNR, tPNR, "#f97316")}
    ${metaResCard(METRICS.sh.label, "acumulado mes",  tSH, tMH,  tPSH, "#06b6d4")}
  </div></div>`;

  // ── 2. Por Ciudad ─────────────────────────────────────────────────────────
  html += secH("🏙️","#06b6d4","Metas por Ciudad","Progreso y proyección","");
  html += `<div class="section"><div class="city-grid">`;
  CITIES.forEach(city => {
    // Use all metas for this city (ignore cityFilter here to always show all cities)
    const cm = STATE.metasData.filter(m => {
      if (m.mes !== mesName)                        return false;
      if (kamFilter !== "all" && m.kam !== kamFilter) return false;
      if (sel.length && !selSet.has(m.partner))     return false;
      return m.city === city;
    });
    if (!cm.length) return;

    // Build city combos: reusa perfF (ya filtrado por rango de fechas).
    // No dependemos de STATE._byCity para que funcione aunque el indice no este
    // construido (cache stale, race condition al cargar diario/mensual).
    const cityPerfRows = perfF.filter(r =>
      r.city === city && selSet.has(r.partner)
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
    // AD = SNAPSHOT: el FACT es el ÚLTIMO período (nivel actual), no el máx del
    // rango — así cuadra con la slide del deck y con KPIs por Nivel. La
    // PROYECCIÓN sí usa el máx × 1.4 (regla de negocio, ver
    // AD_PROJECTION_FACTOR en domain/metrics.ts): el techo demostrado del
    // partner estima mejor el cierre que un último dato que puede ser un valle.
    // N+R/SH son flujos: se acumulan y se proyectan por ritmo lineal.
    const lastAD = sorted.length ? sorted[sorted.length - 1].ad : 0;
    const crAD = lastAD;
    const crNR = sorted.reduce((s, v) => s + v.nr, 0);
    const crSH = sorted.reduce((s, v) => s + v.sh, 0);
    const nrV = sorted.map(v => v.nr);
    const shV = sorted.map(v => v.sh);
    const cpAD = projectSnapshot(sorted.map(v => v.ad));
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
          ${escapeHTML(cityLabel(city))}
        </div>
        ${miniBar("Cond. Activos",  crAD, cmA,  cpAD)}
        ${miniBar("Nuevos+React",   crNR, cmNR, cpNR)}
        ${miniBar("Hs. Conexión",   crSH, cmH,  cpSH)}
      </div>`;
  });
  html += `</div></div>`;

  // ── 3. Por KAM ────────────────────────────────────────────────────────────
  // Partners sin meta ya estan dentro de combos con noMeta=true,
  // suman al FACT del KAM pero no al plan.
  html += secH("👤","#f59e0b","Metas por KAM","Progreso total por responsable","");
  html += `<div class="section"><div class="agy-style-239">`;
  const allKAMs = [...new Set([
    ...combos.map(c => c.kam),
    ...Object.values(STATE.KAM_MAP).filter(k => kamFilter === "all" || k === kamFilter)
  ])].sort();
  allKAMs.forEach(kam => {
    const kc   = combos.filter(c => c.kam === kam);
    const km   = metas.filter(m => m.kam === kam);
    if (!kc.length) return;

    // Partners sin meta de este KAM: ya estan dentro de kc con noMeta=true
    const noGoalPartners = kc.filter(c => c.noMeta).map(c => c.partner);

    const kmA  = km.reduce((s, m) => s + m.mA,  0);
    const kmNR = km.reduce((s, m) => s + m.mNR, 0);
    const kmH  = km.reduce((s, m) => s + m.mH,  0);
    // FACT y proyeccion incluyen partners con y sin meta (todos en kc)
    const krAD = kc.reduce((s, c) => s + c.ad,  0);
    const krNR = kc.reduce((s, c) => s + c.nr,  0);
    const krSH = kc.reduce((s, c) => s + c.sh,  0);
    const kpAD = _projADde(kc);
    const kpNR = kc.reduce((s, c) => s + c.projNR, 0);
    const kpSH = kc.reduce((s, c) => s + c.projSH, 0);
    const col  = KAM_COLORS[kam] || "#888";
    const totalAccounts = kc.length;
    const alertHtml = noGoalPartners.length ? `
      <details class="agy-style-240">
        <summary class="agy-style-241">
          ⚠️ ${noGoalPartners.length} sin meta asignada
          <span class="agy-style-242">click para ver</span>
        </summary>
        <div class="agy-style-243">
          ${noGoalPartners.map(escapeHTML).join(", ")}
        </div>
      </details>` : "";
    html += `
      <div class="city-card" style="border-top-color:${col}">
        <div class="city-name">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>
          ${escapeHTML(kam)}
          <span class="agy-style-244">(${totalAccounts} cuentas)</span>
        </div>
        ${alertHtml}
        ${miniBar("Cond. Activos", krAD, kmA,  kpAD)}
        ${miniBar("Nuevos+React",  krNR, kmNR, kpNR)}
        ${miniBar("Hs. Conexión",  krSH, kmH,  kpSH)}
      </div>`;
  });
  html += `</div></div>`;

  // ── 4. Por Partner ────────────────────────────────────────────────────────
  html += secH("🃏","#FF0000","Metas por Partner","Progreso individual con proyección","");
  html += `<div class="section"><div class="partner-grid">`;
  // Ordenar: primero partners con meta, luego sin meta
  const sortedCombos = [...combos].sort((a, b) =>
    (a.noMeta ? 1 : 0) - (b.noMeta ? 1 : 0)
  );
  sortedCombos.forEach(c => {
    const col    = STATE.partnerColors[c.partner] || "#ccc";
    const kcolor = KAM_COLORS[c.kam] || "#888";
    if (c.noMeta) {
      // Partners SIN meta: mostrar solo FACT, sin plan/proyeccion %
      html += `
        <div class="pcard" style="border-left-color:${col};background:#fafaf9">
          <div class="pcard-name">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col};margin-right:5px"></span>
            ${escapeHTML(c.partner)}
            <span class="agy-style-245">Sin Plan</span>
          </div>
          <div class="pcard-sub">
            <span style="width:7px;height:7px;border-radius:50%;background:${kcolor};display:inline-block;margin-right:3px"></span>
            ${escapeHTML(c.kam)} &nbsp;·&nbsp; ${escapeHTML(c.city)}
          </div>
          <div class="agy-style-246">
            <span>Cond. Activos</span><strong>${fmt(c.ad)}</strong>
          </div>
          <div class="agy-style-247">
            <span>Nuevos+React</span><strong>${fmt(c.nr)}</strong>
          </div>
          <div class="agy-style-247">
            <span>Hs. Conexión</span><strong>${fmt(c.sh)}</strong>
          </div>
          <div class="agy-style-248">
            * Suma al total del KAM y país aunque no tenga meta.
          </div>
        </div>`;
    } else {
      html += `
        <div class="pcard" style="border-left-color:${col}">
          <div class="pcard-name">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col};margin-right:5px"></span>
            ${escapeHTML(c.partner)}
          </div>
          <div class="pcard-sub">
            <span style="width:7px;height:7px;border-radius:50%;background:${kcolor};display:inline-block;margin-right:3px"></span>
            ${escapeHTML(c.kam)} &nbsp;·&nbsp; ${escapeHTML(c.city)}
          </div>
          ${miniBarFull("Cond. Activos", c.ad, c.mA,  c.projAD)}
          ${miniBarFull("Nuevos+React",  c.nr, c.mNR, c.projNR)}
          ${miniBarFull("Hs. Conexión",  c.sh, c.mH,  c.projSH)}
        </div>`;
    }
  });
  html += `</div></div>`;

  document.getElementById("metasContent").innerHTML = html;
}
// ── HELPERS ───────────────────────────────────────────────────────────────────
// fmtFn opcional: Fleet muestra TASAS (%, SH/auto), no cantidades — con fmt()
// a secas "88.4%" se veria como "88". Default fmt() para no tocar los callers
// del agregador.
export function metaResCard(label, sub, real, meta, proj, color, fmtFn) {
  const F   = fmtFn || fmt;
  // KPI solo-meta (ej. Utilización de Fleet: hay objetivo pero el dato real no
  // llega en el export). Mostrarlo con el camino normal daría "0.0% de plan",
  // que se lee como "no estamos llegando" cuando en realidad no se está
  // midiendo. Se muestra el plan y se dice explícitamente que no hay actual.
  // KPI SIN META cargada (ej. un partner con actividad TukTuk pero sin metas
  // TukTuk del mes). El camino normal daria "0.0% de plan 0" en rojo y una
  // "Proyeccion: 1.104,6 (0.0%)" — se lee como incumplimiento grave cuando en
  // realidad no hay plan contra que medir. Se muestra el valor y se dice.
  if (real != null && !(meta > 0)) {
    return `
      <div class="meta-sum-card">
        <div class="mcard-label">${label}</div>
        <div class="mcard-sub-label">${sub}</div>
        <div class="mcard-val">${F(real || 0)}</div>
        <div class="agy-style-250"><span class="agy-style-251">sin meta cargada para este mes</span></div>
        ${proj == null ? "" : `<div style="font-size:.72rem;color:#888;margin-top:4px">Proyección: <strong>${F(proj)}</strong></div>`}
      </div>`;
  }
  if (real == null) {
    return `
      <div class="meta-sum-card">
        <div class="mcard-label">${label}</div>
        <div class="mcard-sub-label">${sub}</div>
        <div class="mcard-val" style="color:${color}">${F(meta || 0)}</div>
        <div class="agy-style-250"><span class="agy-style-251">meta · sin actual medible</span></div>
      </div>`;
  }
  const p   = meta > 0 ? (real / meta) * 100 : 0;
  const pp  = meta > 0 ? (proj / meta) * 100 : 0;
  const pV  = Math.min(p,  100); // visual bar width
  const ppV = Math.min(pp, 100);
  const overBadge = p > 100
    ? `<span class="agy-style-249" title="Superas el plan (>100%)">🏆 Overachievement</span>`
    : "";
  const cumplTip = `Cumplimiento = Fact / Plan × 100. Fact: ${F(real)} de Plan: ${F(meta)}`;
  // Dos reglas distintas y a propósito: los FLUJOS (N+R, horas) se extrapolan
  // por ritmo del mes; los SNAPSHOTS (Active Drivers) usan el máximo del rango
  // × 1.4. Ver domain/metrics.ts.
  const projTip = STATE.curMode === "mensual"
    ? `Proyección = valor actual (mes ya cerrado)`
    : `Flujos (N+R, horas): total acumulado × días del mes / días transcurridos. `
      + `Active Drivers: período de mayor AD del rango × 1.4.`;
  return `
    <div class="meta-sum-card">
      <div class="mcard-label">${label}</div>
      <div class="mcard-sub-label">${sub}</div>
      <div class="mcard-val">${F(real)}</div>
      <div class="agy-style-250" title="${cumplTip}">
        <span style="font-size:.85rem;font-weight:700;color:${pColor(p)}">${p.toFixed(1)}% </span>
        <span class="sem ${semCls(p)}"></span>
        ${overBadge}
        <span class="agy-style-251"> de plan ${F(meta)}</span>
      </div>
      <div class="agy-style-252">${barProj(pV, proj == null ? pV : ppV)}</div>
      ${proj == null ? "" : `<div style="font-size:.72rem;color:${pColor(pp)};margin-top:4px" title="${projTip}">
        Proyección: <strong>${F(proj)}</strong> (${pp.toFixed(1)}%)
      </div>`}
    </div>`;
}

export function miniBar(label, real, meta, proj, fmtFn) {
  const F   = fmtFn || fmt;
  if (real != null && !(meta > 0)) {   // sin meta — ver la nota en metaResCard
    return `<div class="agy-style-253">
      <div class="agy-style-254">
        <span class="agy-style-255">${label}</span>
        <span class="agy-style-222"><strong>${F(real || 0)}</strong></span>
      </div>
      <div class="agy-style-256">sin meta cargada</div>
    </div>`;
  }
  if (real == null) {   // solo meta — ver la nota en metaResCard
    return `<div class="agy-style-253">
      <div class="agy-style-254">
        <span class="agy-style-255">${label}</span>
        <span class="agy-style-222"><strong>${F(meta || 0)}</strong></span>
      </div>
      <div class="agy-style-256">meta · sin actual medible</div>
    </div>`;
  }
  const p   = meta > 0 ? (real / meta) * 100 : 0;
  const pp  = meta > 0 ? (proj / meta) * 100 : 0;
  const pV  = Math.min(p,  100);
  const ppV = Math.min(pp, 100);
  const overBadge = p > 100
    ? `<span class="agy-style-220">🏆</span>`
    : "";
  return `
    <div class="agy-style-253">
      <div class="agy-style-254">
        <span class="agy-style-255">${label}</span>
        <span class="agy-style-222">
          <strong style="color:${pColor(p)}">${p.toFixed(1)}%</strong>
          <span class="sem ${semCls(p)}"></span>
          ${overBadge}
        </span>
      </div>
      ${barProj(pV, proj == null ? pV : ppV)}
      <div class="agy-style-256">
        Fact: ${F(real)} / Plan: ${F(meta)}${proj == null ? "" : ` /
        Proy: <span style="color:${pColor(pp)};font-weight:700">${F(proj)}</span>`}
      </div>
    </div>`;
}

export function miniBarFull(label, real, meta, proj, fmtFn) {
  const F   = fmtFn || fmt;
  const p   = meta > 0 ? (real / meta) * 100 : 0;
  const pp  = meta > 0 ? (proj / meta) * 100 : 0;
  const pV  = Math.min(p,  100);
  const ppV = Math.min(pp, 100);
  const overBadge = p > 100
    ? `<span class="agy-style-220">🏆</span>`
    : "";
  return `
    <div class="agy-style-196">
      <div class="agy-style-221">
        <span>${label}</span>
        <span class="agy-style-222">
          <strong style="color:${pColor(p)}">${p.toFixed(1)}%</strong>
          <span class="sem ${semCls(p)}"></span>
          ${overBadge}
        </span>
      </div>
      <div class="agy-style-223">
        Fact: <strong>${F(real)}</strong> / Plan: <strong>${F(meta)}</strong>
      </div>
      ${barProj(pV, ppV)}
      <div style="font-size:.67rem;color:${pColor(pp)};margin-top:2px">
        Proyección: <strong>${F(proj)}</strong> (${pp.toFixed(1)}%)
      </div>
    </div>`;
}

export function barProj(pR, pP) {
  let h = `<div class="bar-bg">`;
  if (pP > pR)
    h += `<div class="bar-proj" style="width:${Math.min(pP,100)}%;background:${pColor(pP)}"></div>`;
  h += `<div class="bar-real" style="width:${pR}%;background:${pColor(pR)}"></div>`;
  return h + `</div>`;
}

export async function downloadMetasPDF() {
  logAccess("download_pdf", "metas");
  const content = document.getElementById("metasContent");
  if (!content) return;
  const btn = document.getElementById("metasPdfBtn");
  if (btn) { btn.textContent = "⏳ Generando..."; btn.disabled = true; }

  try {
    await ensurePdfLibs();
    const { jsPDF } = window.jspdf;
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
    // Usar el mismo mes que muestra renderMetas (mas reciente o seleccion manual)
    const mesesDisp = [...new Set(STATE.metasData.map(m => m.mes))]
      .filter(Boolean)
      .sort((a, b) => _metasMesOrden(b) - _metasMesOrden(a));
    const mes = (STATE.metasMesSel && mesesDisp.includes(STATE.metasMesSel))
      ? STATE.metasMesSel
      : (mesesDisp[0] || "metas");
    stampPDF(pdf, `Metas — ${mes}`);
    pdf.save(`Metas_${mes}.pdf`);
  } catch(err) {
    alert("Error al generar PDF: " + err.message);
  } finally {
    if (btn) { btn.textContent = "⬇ Descargar PDF"; btn.disabled = false; }
  }
}

// ── ELIMINAR METAS DEL MES MOSTRADO ───────────────────────────────────────────
// Borra TODAS las metas del mes que se está viendo (para re-subir el Excel).
// Usa `ilike` sin comodines = igualdad case-insensitive, así cubre el casing
// mixto de uploads viejos ("JUNIO"/"Junio"/"junio") que el loader normaliza a
// UPPERCASE en cliente. Guard de admin defensivo; el enforcement real es RLS.
export async function deleteMetasMes(mes) {
  if (!STATE.isAdmin) {
    showBanner(false, "Operación bloqueada: requiere rol admin.");
    return;
  }
  const mesU = (mes || "").trim();
  if (!mesU) return;

  const n = STATE.metasData.filter(m => m.mes === mesU.toUpperCase()).length;
  if (!confirm(
    `¿Confirmas borrar las metas de ${mesU} (${n} registro${n === 1 ? "" : "s"})?\n\n` +
    `Útil para re-subir el Excel corregido. Esta acción NO se puede deshacer.`
  )) return;

  showLoad(true, `Eliminando metas de ${mesU}...`);
  try {
    const { error } = await sb.from("metas").delete().ilike("mes", mesU);
    if (error) throw error;

    // Si el mes borrado era la selección manual del selector, limpiarla para que
    // renderMetas (vía loadFromSupabase) caiga al mes más reciente que quede.
    if (STATE.metasMesSel && STATE.metasMesSel.toUpperCase() === mesU.toUpperCase()) {
      STATE.metasMesSel = null;
    }

    showBanner(true, `Metas de ${mesU} eliminadas. Vuelve a subir el Excel para recargarlas.`);
    await loadFromSupabase();   // refresca STATE.metasData + re-renderiza el tab activo

    // loadFromSupabase solo re-renderiza Metas si quedan filas; si ya no quedan,
    // mostramos el estado vacío explícitamente (si no, queda contenido stale).
    if (STATE.curTab === "metas" && !STATE.metasData.length) {
      const empty = document.getElementById("metasEmpty");
      const cont  = document.getElementById("metasContent");
      if (empty) empty.style.display = "";
      if (cont)  cont.style.display  = "none";
    }
  } catch (err) {
    showBanner(false, `Error al eliminar metas: ${err.message}`);
    console.error("deleteMetasMes:", err.message);
  } finally {
    showLoad(false);
  }
}

// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";
import { stampPDF } from "./shared/pdfmeta.js";

registerActions({
  setMetasLine:    d => setMetasLine(d.line),
  setMetasMes:     (d, el) => setMetasMes(el.value),
  deleteMetasMes:  d => deleteMetasMes(d.mes),
  downloadMetasPDF
});
