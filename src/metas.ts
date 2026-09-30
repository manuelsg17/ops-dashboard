//@ts-nocheck
// metas.ts — MOTOR DE METAS (sin pestaña propia desde el 30-sep-2026).
//
// La pestaña Metas se retiró: Desempeño (rendimiento.ts) la reemplaza y lee el
// avance contra la meta de acá (metasResumenPais, metasCuentasLinea), con las
// mismas cuentas que tenía la pestaña. Presentación, portal y Calculadora usan
// _metasMatchMes/_metasMesOrden; data.ts usa _metasFleetActuals. El código de la
// vista (render, PDF, selector de mes, tablas por partner) se borró el mismo día,
// verificado con la huella de números (0 cifras cambiadas en Desempeño, la
// Calculadora y el portal).
import { t, mesLabel, getLang } from "./core/i18n";
// Núcleo de cálculo compartido (snapshot vs flujo, proyecciones, ponderados).
// Import explícito y no global: es el módulo que define QUÉ significa cada
// número, y tiene tests — que se vea de dónde sale.
import {
  snapshotValue, seriesByDate, projectFlow,
  weightedAvg, ratio, tasaAcum, sumarTasa, leerTasa
} from "./domain/metrics.js";
import { reportYM, diasMesReporteDe } from "./shared/mesReporte.js";
import { SIN_KAM, normKamValor } from "./core/config.js";
import { parseLocalDate } from "./core/dates";
import { esMesEnCurso } from "./domain/mesEnCurso";
import { avanceSobreCuota } from "./domain/avanceCuota";
import { mesEnFrase } from "./domain/vsMesAnterior";
import { MES_NOMBRES } from "./core/meses";
import { ordenMes, opcionesMesMeta, mesPorDefecto } from "./domain/mesesMeta";

// ── KAM EFECTIVO DE UNA FILA DE META (B9, sep-2026) ──────────────────────────
// El loader arma `m.kam = KAM_MAP[clid] || m.kam || ""`: cuando el partner tiene
// el KAM VACÍO en `partners`, cae al kam guardado en la propia fila de meta (el
// KAM viejo) o a "". Resultado: con el filtro "No KAM" esas metas no aparecían
// (su kam era "Carla" o ""), y sin filtro se agrupaban bajo el KAM viejo
// mientras Rendimiento y el sidebar las ponían en "No KAM" — el mismo partner en
// dos grupos según la pantalla. Misma precedencia que el resto de la app
// (_lineKamOf / _buildPartnerKAM): partners → flotas/filas → la propia meta.
export function _metasKamDe(m) {
  const k = (m && typeof getKAMForPartner === "function" && getKAMForPartner(m.partner)) || "";
  return k || normKamValor(m && m.kam) || SIN_KAM;
}

function _metasCalcProyOn(mesName, mesYearSel, mesDates) {
  const ord = _metasMesOrden(mesName);
  if (!ord) return false;
  let mes, anio = mesYearSel;
  if (ord >= 100000) { mes = ord % 100; anio = Math.floor(ord / 100); }
  else mes = ord - 2000;
  // Sin año en las metas: el año de los períodos del mes que se están mirando.
  if (anio == null && mesDates && mesDates.length) {
    anio = reportYM(mesDates[mesDates.length - 1], STATE.curMode, parseLocalDate).y;
  }
  return esMesEnCurso(mes, anio);
}

// B1 (sep-2026): la regla vive en domain/mesesMeta.ordenMes — año*100 + mes.
// Con `anio` (metas.mes_year) el orden es real: ENERO 2027 > DICIEMBRE 2026.
// Sin año (llamadores que solo tienen el nombre) devuelve el 2000+mes de
// siempre, que es lo que distingue "nombre" (2001..2012) de "YYYY-MM" (≥100000)
// en _metasFechasDelMes y en el deck.
export function _metasMesOrden(mes, anio = null) {
  return ordenMes(mes, anio);
}

// Mes (y AÑO) que muestra la pestaña: la selección manual si sigue existiendo;
// si no, el ÚLTIMO MES CON DATOS (domain/mesesMeta.mesPorDefecto), no la meta
// más nueva. Antes: orden 2000+mes → en enero abría DICIEMBRE, y con metas
// cargadas por adelantado abría un mes sin ningún dato (pantalla vacía).
export function _metasMesElegido() {
  const ops = opcionesMesMeta(STATE.metasData || []);
  if (!ops.length) return null;
  if (STATE.metasMesSel) {
    const selY = STATE.metasMesSelYear ?? null;
    const hit = ops.find(o => o.mes === STATE.metasMesSel && (selY == null || o.anio === selY));
    if (hit) return hit;
  }
  let ultimo = "";
  for (const d of STATE.allDates || []) if (d > ultimo) ultimo = d;
  const ym = ultimo ? reportYM(ultimo, STATE.curMode, parseLocalDate) : null;
  return mesPorDefecto(ops, ym);
}

// BUG REAL (encontrado en auditoria ago 2026): metas.mes es NOMBRE sin año
// ("AGOSTO") y aunque el loader ya expone mes_year (STATE.metasData[].mYear),
// nada lo usaba — todo el matcheo era por nombre de mes a secas. Con metas de
// AGOSTO 2025 (partner A) y AGOSTO 2026 (partner B) conviviendo en la tabla
// (la UNIQUE es clid,city,mes — distinto clid/city sí coexiste cross-year),
// el tab colapsaba ambos años en una sola opcion "AGOSTO" y SUMABA las metas
// de los dos años. Mismo tipo de bug que ya se arreglo en Presentacion 2.0.
//
// Fix: la seleccion de "mes actual" ahora es (mes, año) compuesta. Legacy: una
// fila con mYear null (uploads viejos sin año) matchea cualquier año — no hay
// forma de saber a cual pertenece, y no vale la pena bloquear data vieja por
// esto.
export function _metasMesActualYear(mesName) {
  // El año ELEGIDO (selector o default por datos) manda: con ENERO 2026 y ENERO
  // 2027 cargados, el máximo a secas hacía imposible ver el 2026.
  const el = _metasMesElegido();
  if (el && el.mes === mesName && el.anio != null) return el.anio;
  const anios = STATE.metasData
    .filter(m => m.mes === mesName && m.mYear != null)
    .map(m => m.mYear);
  return anios.length ? Math.max(...anios) : null;
}
export function _metasMatchMes(m, mesName, mesYearSel) {
  if (m.mes !== mesName) return false;
  if (mesYearSel == null || m.mYear == null) return true; // sin año conocido: no se puede descartar
  return m.mYear === mesYearSel;
}

// ── RANGO DEL SIDEBAR vs MES DE LA META ──────────────────────────────────────
//
// La meta es MENSUAL. El FACT salía del rango del sidebar TAL CUAL, sin recortarlo
// al mes de la meta, así que por defecto (la ventana entera cargada: 16 semanas /
// 6 meses / 90 días) se comparaban VARIOS meses de N+R y horas contra el objetivo
// de UNO. Medido contra producción el 05-sep-2026, rango por defecto 11-may→24-ago
// vs AGOSTO: N+R 64.851 en vez de 11.348 (5,7×) y horas 6,3× — un ~570% de
// cumplimiento que no significaba nada. Y la proyección lo empeoraba: proyectFlow
// extrapola ese total como si se hubiera acumulado en los días transcurridos de UN
// mes (visto: 632% de plan).
//
// Ahora el FACT es la INTERSECCIÓN rango ∩ mes de la meta — la misma regla que ya
// usan el deck (p2DatesMetaEnRango) y el portal del partner. El filtro se sigue
// respetando: si el KAM mira una sola semana, ve esa semana; lo que ya no pasa es
// mezclar meses bajo la etiqueta de uno.
//
// El bucketing es por mes de REPORTE (en semanal, el mes donde cae el jueves),
// igual que el deck y el portal: la semana del Lun 29-jun cuenta en JULIO.
export function _metasFechasDelMes(mesName, mesYearSel, from, to) {
  const ord = mesName ? _metasMesOrden(mesName) : 0;
  if (!ord) return [];
  const todas = (STATE.allDates || []).filter(d => (!from || d >= from) && (!to || d <= to));
  const ym = d => reportYM(d, STATE.curMode, parseLocalDate);
  if (ord >= 100000) {                                   // mes ISO "YYYY-MM"
    const yy = Math.floor(ord / 100), mm = ord % 100;
    return todas.filter(d => { const r = ym(d); return r.y === yy && r.m === mm; });
  }
  const mn = ord - 2000;                                 // nombre de mes sin año
  const cand = todas.filter(d => ym(d).m === mn);
  if (mesYearSel != null) return cand.filter(d => ym(d).y === mesYearSel);
  // Sin año en las metas (uploads viejos): el año más reciente presente en el
  // rango, nunca la mezcla de dos años bajo el mismo nombre de mes.
  const anios = [...new Set(cand.map(d => ym(d).y))].sort();
  const ultimo = anios[anios.length - 1];
  return ultimo == null ? [] : cand.filter(d => ym(d).y === ultimo);
}
// Todos los períodos de ese mes que EXISTEN (ignorando el "Desde" del sidebar,
// pero sin pasar del "Hasta"): el denominador del aviso de cobertura.
export function _metasFechasMesCompleto(mesName, mesYearSel, to) {
  return _metasFechasDelMes(mesName, mesYearSel, "", to);
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
// Se conservan los NUMERADORES Y DENOMINADORES crudos (intSh, owned, accTrips, trips)
// además de las tasas ya calculadas: son imprescindibles para poder re-ponderar
// al agregar por ciudad/KAM/país. Promediar las tasas ya calculadas de varios
// partners daría un número sin significado (un partner con 3 autos pesaría igual
// que uno con 300).
export function _metasFleetActuals(fechas, selSet, cityFilter) {
  const by = new Map();
  let _snap = "";   // último período con dato (B10): "autos propios hoy"
  const _sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  _metasLineDataset("fleet").forEach(r => {
    if (!fechas.has(r.date)) return;
    if (r.date > _snap) _snap = r.date;
    if (cityFilter !== "all" && r.city !== cityFilter) return;
    if (selSet.size && !_lineSelHas(selSet, _sidebar, r.partner)) return;
    const k = `${r.partner}|||${r.city}`;
    let e = by.get(k);
    if (!e) { e = { owned: 0, intSh: 0, trips: 0, _acc: tasaAcum(), branded: 0, _owned: {} }; by.set(k, e); }
    e.owned   += r.ownedFleetActiveCars || 0;
    e.intSh   += r.internalFleetSh || 0;
    e.trips   += r.trips || 0;
    sumarTasa(e._acc, r.acceptanceRate, r.trips);   // sin tasa → fuera de num y den
    e.branded += r.brandedActiveCars || 0;
    // Autos propios por fecha: `owned` de arriba acumula auto-períodos (es el
    // denominador correcto de SH/auto), pero para MOSTRAR "cuántos autos tiene"
    // hace falta el nivel del último período, no la suma sobre el tiempo.
    e._owned[r.date] = (e._owned[r.date] || 0) + (r.ownedFleetActiveCars || 0);
  });
  by.forEach(e => {
    e.shCar     = ratio(e.intSh, e.owned);
    const acc   = leerTasa(e._acc);
    e.accept    = acc == null ? null : acc * 100;
    // Peso de la aceptación al re-ponderar por ciudad/KAM: los viajes de las
    // filas que SÍ traían la tasa, no todos (`trips`).
    e.accTrips  = e._acc.den;
    e.ownedNow  = _snap ? (e._owned[_snap] || 0) : snapshotValue(seriesByDate(e._owned));
    delete e._owned; delete e._acc;
  });
  return by;
}
// Actuales TukTuk por (partner|||city): AD y Brandeados son SNAPSHOT (último
// período); N+R y SH son FLUJO (Σ del rango). Se guardan también las SERIES por
// período: sin ellas no se puede proyectar (la de AD alimenta la proyección plana y las
// de flujo el ritmo lineal). Ver src/domain/metrics.ts.
export function _metasTkActuals(fechas, selSet, cityFilter) {
  const by = new Map();
  let _snap = "";   // último período con dato de la línea en el mes (B10)
  const _sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  _metasLineDataset("tk").forEach(r => {
    if (!fechas.has(r.date)) return;
    if (r.date > _snap) _snap = r.date;
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
  const _ult = [...fechas].sort().at(-1);
  by.forEach(e => _finishSeries(e, _ult, _snap));
  return by;
}
// Actuales COMBINADOS (Taxi+TukTuk) por (partner|||city): AD = snapshot del ÚLTIMO
// período (misma convención que la slide "Avance Combinado" del deck), N+R y SH = Σ
// del rango. Opera sobre el dataset concat — las filas de ambas líneas de una misma
// fecha se suman antes de tomar el snapshot.
export function _metasCombActuals(fechas, selSet, cityFilter) {
  const by = new Map();
  let _snap = "";   // último período con dato de la línea en el mes (B10)
  const _sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  _metasLineDataset("comb").forEach(r => {
    if (!fechas.has(r.date)) return;
    if (r.date > _snap) _snap = r.date;
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
  const _ult = [...fechas].sort().at(-1);
  by.forEach(e => _finishSeries(e, _ult, _snap));
  return by;
}

// Cierra una entrada de actuals: convierte los mapas fecha→valor en series
// ordenadas, saca los snapshots y calcula las proyecciones. Compartido por
// TukTuk y Combinado para que las dos líneas no puedan divergir.
// `snapDate` (B10, sep-2026): el SNAPSHOT (AD, brandeados) se toma en el último
// período del RANGO con dato en la línea, no en el último período de CADA
// partner. Antes, un partner que dejó de operar a mitad de mes seguía aportando
// su último AD (p.ej. el de 3 semanas atrás) al total y a su ciudad — un nivel
// que ya no existe, y que no cuadraba con Rendimiento (que mira la última fecha).
function _finishSeries(e, lastDate, snapDate) {
  const { daysElapsed, daysRemaining } = _metasProjDays(lastDate);
  const adS = seriesByDate(e._ad);
  e.ad     = snapDate ? (e._ad[snapDate] || 0) : snapshotValue(adS);
  e.cars   = e._cars ? (snapDate ? (e._cars[snapDate] || 0) : snapshotValue(seriesByDate(e._cars))) : 0;
  e.projAd = projADbyDate(e._ad);
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
function _metasProjDays(lastDate) {
  if (lastDate) return _metasDiasProy(lastDate);
  const to = document.getElementById("dateTo")?.value || "";
  const dates = (STATE.allDates || []).filter(d => !to || d <= to);
  return _metasDiasProy(dates[dates.length - 1] || to);
}

// Días para proyectar un FLUJO al cierre del mes de reporte de `lastDate`.
// diasMesReporteDe: en escala MENSUAL con el mes EN CURSO la fila es el
// acumulado a la fecha (MTD) y se prorratea hasta el corte de datos (ver
// shared/mesReporte + domain/diasMesEnCurso) — la MISMA regla que el deck y el
// portal. Antes la proyección de N+R y horas quedaba igual al actual.
function _metasDiasProy(lastDate) {
  return diasMesReporteDe(STATE, lastDate, parseLocalDate);
}
// Proyección de un flujo a partir de su serie (camino del agregador). projA
// (data.ts) no extrapola NUNCA en mensual; acá la excepción es el mes en curso,
// que es justo cuando _metasDiasProy devuelve días restantes (> 0) en mensual.
function _metasProjFlujo(vals, daysElapsed, daysRemaining) {
  if (STATE.curMode !== "mensual" || !(daysRemaining > 0)) return projA(vals, daysElapsed, daysRemaining);
  const total = (vals || []).reduce((s, x) => s + (x > 0 ? x : 0), 0);
  return projectFlow(total, daysElapsed, daysRemaining);
}

// ── PRESENTACIÓN (Ola 6, sep-2026) ───────────────────────────────────────────
// Todo lo que pinta Metas sale de acá: tarjetas KPI (ui-kpi), tablas compactas
// por ciudad/KAM, tabla (o tarjetas) por partner y la barra de controles.
//
// REGLA DE LA HUELLA (scripts/huella): cada cifra conserva su `data-num` y el
// MISMO texto que antes (p.ej. "77.0%", "37,248", "1.7M"). El rediseño mueve
// las cifras de lugar, nunca cambia cómo se formatean.
//
// Colores: solo tokens semánticos. El % de cumplimiento usa los MISMOS cortes
// que pColor()/pEstado() vía ui.goalTone (<80 bad · 80–94 warn · 95–99 ok ·
// ≥100 over = sobre meta). Ciudades y KAMs llevan la paleta categórica (--cat-N), nunca el
// rojo de marca; el color de hash del partner queda solo como un puntito.

// Agrega un KPI sobre un conjunto de unidades (partner-ciudad).
// Devuelve null en `actual`/`meta` cuando NINGUNA unidad aportó el dato — eso
// es lo que permite distinguir "sin meta cargada" de "meta cero", que se ven
// igual si se colapsa todo a 0.
function _metasAggKpi(kpi, units) {
  if (kpi.weight) {
    const aw = [], mw = [];
    units.forEach(u => {
      // u.a puede ser null (hay META cargada pero NINGUN actual en el rango:
      // un partner que dejo de operar, o un filtro de fechas que lo deja fuera).
      // La linea de abajo ya lo contemplaba con el ternario, esta no: llamaba
      // kpi.weight(null) y `a.owned` reventaba la pestana ENTERA con un
      // TypeError. Encontrado al sembrar metas Fleet en local para poder
      // verificar la traduccion.
      const w  = u.a ? (kpi.weight(u.a) || 0) : 0;
      const wa = u.a && kpi.actWeight ? (kpi.actWeight(u.a) || 0) : w;
      const av = u.a ? kpi.act(u.a)  : null;
      const mv = u.m ? kpi.meta(u.m) : null;
      if (av != null) aw.push([av, wa]);
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
  if (serieAgregada && hasP) p = projADbyDate(serieAgregada);
  return {
    actual: hasA ? a : null,
    meta:   hasM ? m : null,
    // Sin proyección propia, la mejor estimación es el actual (no 0, que
    // dibujaría una barra de proyección vacía y se leería como "no va a llegar").
    proj:   hasP ? p : (hasA ? a : null)
  };
}

// "vs agosto (mes completo)" (conVs) / "agosto (mes completo)" — el MISMO texto
// en Metas y en Rendimiento (que lo importa de acá). m = mes 1-12.
export function etiquetaMesCompleto(m, conVs = true) {
  const mes = mesEnFrase(m, getLang()) || mesLabel(MES_NOMBRES[m - 1]);
  return t(conVs ? "cmp.vsMesCompleto" : "cmp.mesCompleto", { m: mes });
}
// Universo de unidades de una línea (Fleet / TukTuk / Combinado) — la misma
// para la pestaña y para el resumen país (metasResumenPais).
function _metasLineUnits(metaRows, act) {
  // Universo de unidades a mostrar: toda fila de meta de esta línea, más su
  // actual si existe. Se indexa por (partner, ciudad) — la misma granularidad
  // en la que se cargan las metas.
  const units = metaRows.map(m => ({ m, a: act.get(`${m.partner}|||${m.city}`) || null }));

  // …Y TAMBIÉN las cuentas que tienen ACTIVIDAD pero NINGUNA meta cargada este
  // mes. Antes quedaban fuera por completo, y por eso el "actual" de Metas no
  // cuadraba con el de Rendimiento (reportado por Manuel, sep-2026: 27.200 acá
  // vs 27.324 allá, −124 conductores; N+R 5.608 vs 5.632). Rendimiento parte de
  // la actividad real, Metas partía del plan: dos universos distintos mostrando
  // cifras que se leen como si fueran la misma.
  //
  // `m` sintético (sin ninguna m* de meta) en vez de `m: null`: así las cuatro
  // secciones de abajo —que agrupan por m.city / m.kam y pintan m.partner— siguen
  // funcionando sin tocarlas, y `_metasAggKpi` ya descarta las metas con su
  // `mv != null` (un campo ausente da undefined, que no pasa ese filtro).
  // Resultado: SUMAN al actual, NO suman a la meta.
  const conMeta = new Set(metaRows.map(m => `${m.partner}|||${m.city}`));
  act.forEach((a, key) => {
    if (conMeta.has(key)) return;
    const sep     = key.lastIndexOf("|||");
    const partner = key.slice(0, sep);
    const city    = key.slice(sep + 3);
    units.push({ m: { partner, city, kam: getKAMForPartner(partner) || SIN_KAM, _sinMeta: true }, a });
  });
  return units;
}

// Filtro común de filas de meta de una línea. `mesYearSel` explícito (y no
// leído de la selección de la pestaña): así el resumen que usa Rendimiento no
// depende de qué mes quedó elegido en Metas.
function _metasLineRows(mesName, mesYearSel, hasLineMeta, selSet, cityFilter, kamFilter) {
  return STATE.metasData.filter(m =>
    _metasMatchMes(m, mesName, mesYearSel) &&
    hasLineMeta(m) &&
    (kamFilter === "all" || _metasKamDe(m) === kamFilter) &&
    (!selSet.size || _lineSelHas(selSet, new Set(STATE.sidebarPartners || STATE.allPartners), m.partner)) &&
    (cityFilter === "all" || m.city === cityFilter)
  ).sort((a, b) => a.partner.localeCompare(b.partner));
}

// Descriptor completo de una línea (Fleet / TukTuk / Combinado): actuales,
// filas de meta y KPIs. Lo usan el renderer de la pestaña (_renderMetasLineView)
// y el resumen país (metasResumenPais) — un único armado para los dos.
function _metasLineCfg(line, mesName, mesYearSel, fechas, selSet, cityFilter, kamFilter) {
  const base = { line, mesDates: [...fechas].sort() };
  // Vista Metas Fleet. Sus KPIs son TASAS (SH/auto, aceptación), no cantidades:
  // por eso llevan `weight` y NO llevan proyección — proyectar una tasa al cierre
  // del mes por ritmo lineal no significa nada (una tasa no se acumula).
  if (line === "fleet") return {
    ...base, info: t("metas.fleetSub"),
    act: _metasFleetActuals(fechas, selSet, cityFilter),
    actFn: f => _metasFleetActuals(f, selSet, cityFilter),
    metaRows: _metasLineRows(mesName, mesYearSel,
      m => m.mSHcar != null || m.mAcc != null || m.mUtil != null,
      selSet, cityFilter, kamFilter),
    kpis: [
      { id: "shCar", label: t("metas.kpi.shAuto"), sub: t("metas.pond"),
        meta: m => m.mSHcar, act: a => a.shCar, proj: null,
        weight: a => a.owned, fmtFn: v => fmt(v) },
      { id: "accept", label: t("metas.kpi.aceptacion"), sub: t("metas.pondViajes"),
        meta: m => m.mAcc, act: a => a.accept, proj: null,
        weight: a => a.trips, actWeight: a => a.accTrips, fmtFn: v => fmt(v) + "%" },
      { id: "util", label: t("metas.kpi.utilizacion"), sub: t("metas.soloMeta"),
        meta: m => m.mUtil, act: () => null, proj: null,
        weight: a => a.owned, fmtFn: v => fmt(v) + "%", note: t("metas.sinActual") }
    ],
    // Autos propios: dato de contexto, no un KPI contra meta → en la tarjeta como
    // nota y en la tabla como tooltip del partner.
    partnerNote: (m, a) => a ? t("metas.autosPropios", { n: fmt(a.ownedNow || 0), b: fmt(a.branded || 0) }) : "",
    partnerTip:  (m, a) => a ? t("metas.autosPropios", { n: fmt(a.ownedNow || 0), b: fmt(a.branded || 0) }) : "",
    emptyTitle: t("mt.vacio.fleet", { m: mesLabel(mesName) })
  };
  // Vista Metas TukTuk: KPIs aditivos (AD/N+R/Brandeados/Horas).
  if (line === "tk") return {
    ...base, info: t("metas.tkSub"),
    // % sobre las cuentas con cuota declarada (ver _metasAvanceCuota).
    reglaCuota: true,
    act: _metasTkActuals(fechas, selSet, cityFilter),
    actFn: f => _metasTkActuals(f, selSet, cityFilter),
    metaRows: _metasLineRows(mesName, mesYearSel,
      m => m.mtkAD != null || m.mtkNR != null || m.mtkCars != null || m.mtkSH != null,
      selSet, cityFilter, kamFilter),
    kpis: [
      { id: "ad", label: t("metas.activeDrivers"), sub: t("metas.ultimoPeriodo"),
        meta: m => m.mtkAD, act: a => a.ad, proj: a => a.projAd,
        snapSeries: a => a.adByDate, fmtFn: v => fmt(v) },
      { id: "nr", label: t("metas.nuevosReact"), sub: t("metas.acumulado"),
        meta: m => m.mtkNR, act: a => a.nr, proj: a => a.projNr, fmtFn: v => fmt(v) },
      { id: "cars", label: t("metas.brandeados"), sub: t("metas.ultimoPeriodo"),
        // Brandeados NO lleva snapSeries: su proyección es PLANA (= nivel
        // actual), igual que AD desde ago 2026 — la nota histórica del ×1.4 vive en
        // Active Drivers, no de cualquier snapshot.
        meta: m => m.mtkCars, act: a => a.cars, proj: a => a.cars, fmtFn: v => fmt(v) },
      { id: "sh", label: t("metas.horasConexion"), sub: t("metas.acumulado"),
        meta: m => m.mtkSH, act: a => a.sh, proj: a => a.projSh, fmtFn: v => fmt(v) }
    ],
    emptyTitle: t("mt.vacio.tk", { m: mesLabel(mesName) })
  };
  // Vista Metas COMBINADO (Taxi+TukTuk): actuales sumados de ambas líneas vs meta
  // combinada. Misma fórmula que la slide "Avance Combinado" de Presentación 2.0
  // — si el partner se enfoca en TukTuk, ese avance también cuenta para su meta.
  //
  // META PARAGUAS: mA/mNR/mH YA cubren Taxi + TukTuk juntos (decisión ago 2026,
  // verificada contra la proporción real de cada línea). Sumarles meta_tk_* era
  // contar el objetivo de TukTuk DOS veces: en agosto-2026 TRANSPOTAXI Lima
  // pasaba de 2.661 a 3.785 AD de plan (+42%) y de 651 a 1.015 de N+R (+56%),
  // así que la misma cuenta mostraba ~60% acá y ~86% en el deck. El deck ya usa
  // el paraguas; esta vista y el portal se quedaron atrás.
  //
  // meta_tk_* NO es basura: `meta_tk_nr` sigue siendo la meta del CRITERIO
  // TukTuk (nuevos + reactivados del mes) y se muestra en la vista TukTuk y en
  // el Resumen del deck. Lo que no se puede es sumarla al paraguas.
  const umbrella = v => (v == null || v === 0) ? null : v;
  return {
    ...base, line: "comb", info: t("metas.combSub"),
    act: _metasCombActuals(fechas, selSet, cityFilter),
    actFn: f => _metasCombActuals(f, selSet, cityFilter),
    metaRows: _metasLineRows(mesName, mesYearSel,
      m => (m.mA || 0) > 0 || (m.mNR || 0) > 0 || (m.mH || 0) > 0 ||
           m.mtkAD != null || m.mtkNR != null || m.mtkSH != null,
      selSet, cityFilter, kamFilter),
    kpis: [
      { id: "ad", label: t("metas.activeDrivers"), sub: t("metas.ultimoPeriodo"),
        meta: m => umbrella(m.mA), act: a => a.ad, proj: a => a.projAd,
        tkMeta: m => m.mtkAD, snapSeries: a => a.adByDate, fmtFn: v => fmt(v) },
      { id: "nr", label: t("metas.nuevosReact"), sub: t("metas.acumulado"),
        meta: m => umbrella(m.mNR), act: a => a.nr, proj: a => a.projNr,
        tkMeta: m => m.mtkNR, fmtFn: v => fmt(v) },
      { id: "sh", label: t("metas.horasConexion"), sub: t("metas.acumulado"),
        meta: m => umbrella(m.mH), act: a => a.sh, proj: a => a.projSh,
        tkMeta: m => m.mtkSH, fmtFn: v => fmt(v) }
    ],
    // tkMeta: cuota TukTuk GUARDADA (meta_tk_*), un DESGLOSE de la meta paraguas
    // que se muestra como "de eso TukTuk X" bajo la meta (sep-2026, pedido de
    // Manuel: "ver cuánto le corresponde a su cuota"). Reemplaza al tooltip
    // viejo (mt.pieCombTk), que la describía como una meta APARTE — lectura que
    // quedó mal desde que la Calculadora la escribe como parte del paraguas.
    emptyTitle: t("mt.vacio.comb", { m: mesLabel(mesName) })
  };
}

// ── AGREGADOR: metas y FACT por partner (compartido por la pestaña y el resumen) ──
// Filas de meta del agregador para el mes/filtros.
function _metasAggMetas(mesName, mesYearSel, sel, selSet, cityFilter, kamFilter) {
  return STATE.metasData.filter(m => {
    if (!_metasMatchMes(m, mesName, mesYearSel))    return false;
    if (kamFilter !== "all" && _metasKamDe(m) !== kamFilter) return false;
    // Mismo recorte de ciudad que el FACT: sin esto, con Ciudad=Arequipa los
    // totales de plan (Perú y por KAM) sumaban las metas de TODAS las ciudades
    // contra un FACT solo-Arequipa → % de cumplimiento hundido artificialmente.
    if (cityFilter !== "all" && m.city !== cityFilter) return false;
    if (sel.length && !selSet.has(m.partner))     return false;
    return true;
  });
}
// Proyección de AD del NIVEL (no la suma de las de cada partner): se juntan
// las series por fecha y se toma el máximo del total. Sumar los máximos
// individuales asume que todos los partners picaron la misma semana y
// sobre-estima siempre. Ver la nota en _metasAggKpi.
function _metasProjADde(arr) {
  const merged = {};
  arr.forEach(c => {
    const m = c.adByDate || {};
    Object.keys(m).forEach(d => { merged[d] = (merged[d] || 0) + m[d]; });
  });
  return projADbyDate(merged);
}
// FACT por partner (con y sin meta) sobre un juego de fechas: el del mes de la
// meta y, para el delta de las tarjetas, el de los períodos equivalentes del mes
// anterior.
function _metasAggCombos(metas, fechasX, desde, hasta, conDiag, selSet, cityFilter, kamFilter) {
  const perfF  = getFilteredByDateRange(desde, hasta).filter(r => fechasX.has(r.date));
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
  if (conDiag && perfF.length) {
    if (DEBUG) console.log(`[METAS ${STATE.curMode}] Breakdown N+R en rango ${desde} → ${hasta}:`,
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

  // Proyección al cierre: días transcurridos del MES DE LA META (no del mes
  // calendario de la última fecha — en semanal la del 29-jun reporta en julio).
  const maxDate = cpRows.length ? cpRows.map(r => r.date).sort().at(-1) : ([...fechasX].sort().at(-1) || hasta);
  const { daysElapsed, daysRemaining } = _metasDiasProy(maxDate);

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
      // B10 (sep-2026): el snapshot es el del ÚLTIMO PERÍODO DEL RANGO (maxDate),
      // no el último período con dato de ESTE partner. Con el segundo, un
      // partner que dejó de operar a mitad de mes seguía sumando su último AD
      // al país pero no a su ciudad (que ya miraba la última fecha): en semanal
      // AGOSTO, PUENTE PIEDRA (último dato el 10-ago) inflaba Perú en 166 y
      // Perú ≠ Σ ciudades.
      lastAD: bd[maxDate]?.ad || 0,
      nrV,
      shV,
      adV,      // serie por periodo: alimenta projectSnapshot (proyeccion plana)
      adByDate  // misma serie keyed por fecha, para re-agregar por nivel
    };
  }

  // Build combos (partner+city)
  let combos = [];
  if (cityFilter === "all") {
    const pm = {};
    metas.forEach(m => {
      if (!pm[m.partner]) pm[m.partner] = { partner: m.partner, kam: _metasKamDe(m), mA: 0, mNR: 0, mH: 0 };
      pm[m.partner].mA  += m.mA;
      pm[m.partner].mNR += m.mNR;
      pm[m.partner].mH  += m.mH;
    });
    Object.values(pm).forEach(p => {
      const r = getRPC(p.partner, "all");
      combos.push({ partner: p.partner, kam: p.kam, city: "Todas",
        mA: p.mA, mNR: p.mNR, mH: p.mH,
        ad: r.lastAD, nr: r.nr, sh: r.sh,
        projAD: projADbyDate(r.adByDate),
        adByDate: r.adByDate,
        projNR: _metasProjFlujo(r.nrV, daysElapsed, daysRemaining),
        projSH: _metasProjFlujo(r.shV, daysElapsed, daysRemaining) });
    });
  } else {
    metas.filter(m => m.city === cityFilter).forEach(m => {
      const r = getRPC(m.partner, m.city);
      combos.push({ partner: m.partner, kam: _metasKamDe(m), city: m.city,
        mA: m.mA, mNR: m.mNR, mH: m.mH,
        ad: r.lastAD, nr: r.nr, sh: r.sh,
        projAD: projADbyDate(r.adByDate),
        adByDate: r.adByDate,
        projNR: _metasProjFlujo(r.nrV, daysElapsed, daysRemaining),
        projSH: _metasProjFlujo(r.shV, daysElapsed, daysRemaining) });
    });
  }

  // Agregar partners CON performance pero SIN meta. Su FACT y proyección
  // suman al KAM/Ciudad/Peru aunque no tengan plan asignado. Plan = 0.
  const partnersWithMetaSet = new Set(combos.map(c => c.partner));
  const partnersInPerf = [...new Set(cpRows.map(r => r.partner))]
    .filter(p => selSet.has(p) && !partnersWithMetaSet.has(p));

  partnersInPerf.forEach(p => {
    const partnerKam = getKAMForPartner(p) || SIN_KAM;
    // Si el usuario filtra por KAM, excluir partners sin meta de otros KAMs
    if (kamFilter !== "all" && partnerKam !== kamFilter) return;
    const r = getRPC(p, cityFilter === "all" ? "all" : cityFilter);
    if (r.ad === 0 && r.nr === 0 && r.sh === 0) return;
    combos.push({
      partner: p,
      kam: partnerKam,
      city: cityFilter === "all" ? t("metas.sinPlan") : cityFilter,
      mA: 0, mNR: 0, mH: 0,
      ad: r.lastAD, nr: r.nr, sh: r.sh,
      projAD: projADbyDate(r.adByDate),
      adByDate: r.adByDate,
      projNR: _metasProjFlujo(r.nrV, daysElapsed, daysRemaining),
      projSH: _metasProjFlujo(r.shV, daysElapsed, daysRemaining),
      noMeta: true
    });
  });
  return { perfF, combos, maxDate, daysElapsed, daysRemaining };
}

// Totales país del agregador (tarjetas del resumen).
function _metasAggTotales(metas, combos) {
  return {
    tMA:  metas.reduce((s, m) => s + m.mA,  0),
    tMNR: metas.reduce((s, m) => s + m.mNR, 0),
    tMH:  metas.reduce((s, m) => s + m.mH,  0),
    tAD:  combos.reduce((s, c) => s + c.ad,  0),
    tNR:  combos.reduce((s, c) => s + c.nr,  0),
    tSH:  combos.reduce((s, c) => s + c.sh,  0),
    tPAD: _metasProjADde(combos),
    tPNR: combos.reduce((s, c) => s + c.projNR, 0),
    tPSH: combos.reduce((s, c) => s + c.projSH, 0)
  };
}

// ── RESUMEN PAÍS (única fuente de las tarjetas del resumen) ──────────────────
// Lo usan las tarjetas "Resumen" de esta pestaña Y la barra de avance contra la
// meta de Rendimiento (metasResumenPais). Antes Rendimiento pintaba los
// renderers de Metas fuera de pantalla y leía las cifras del HTML, y la
// proyección dependía de un estado de módulo que dejaba el último render de
// Metas: la barra de Rendimiento mostraba (o no) la proyección según qué se
// hubiera abierto antes en Metas.
function _metasKpiResumen(actual, meta, proj, proyOn, F) {
  return {
    actual, meta,
    pct: actual != null && meta > 0 ? (actual / meta) * 100 : null,
    proj: proyOn ? (proj ?? null) : null,
    F: F || fmt
  };
}
function _metasResumenDeUnits(kpis, units, proyOn, reglaCuota = false) {
  const out = {};
  kpis.forEach(k => {
    if (reglaCuota) { out[k.id] = _metasKpiResumenCuota(_metasAvanceCuota(k, units), proyOn, k.fmtFn); return; }
    const g = _metasAggKpi(k, units);
    out[k.id] = _metasKpiResumen(g.actual, g.meta, g.proj, proyOn, k.fmtFn);
  });
  return out;
}
// Línea TukTuk (decisión de Manuel, 24-sep-2026 — ver domain/avanceCuota): el
// actual es el de TODAS las cuentas, pero el % (y el de la proyección) se mide
// solo sobre las cuentas con la cuota de ese KPI declarada. Antes el % era el
// actual de todas contra la cuota de unas pocas (327%). La misma función arma
// las tarjetas del resumen, las tablas por ciudad/KAM y el anillo de
// Rendimiento (vía metasResumenPais): el % no puede diferir entre pantallas.
function _metasAvanceCuota(k, units) {
  return avanceSobreCuota(units, {
    declarada: u => !!(u.m && !u.m._sinMeta && k.meta(u.m) != null),
    conDato:   u => !!u.a && k.act(u.a) != null,
    agregar:   us => _metasAggKpi(k, us)
  });
}
// `cuota` viaja con el resumen para que quien lo pinte (Metas y Rendimiento)
// diga sobre qué se calculó el %: actual y proyección de las cuentas con cuota,
// y cuántas son de cuántas.
function _metasKpiResumenCuota(r, proyOn, F) {
  return {
    actual: r.actual, meta: r.meta, pct: r.pct,
    proj: proyOn ? (r.proj ?? null) : null,
    pctProj: proyOn ? r.pctProj : null,
    cuota: _metasCuotaInfo(r, proyOn),
    F: F || fmt
  };
}
function _metasCuotaInfo(r, proyOn) {
  return { actual: r.actualCuota, proj: proyOn ? r.projCuota : null, pct: r.pct,
           pctProj: proyOn ? r.pctProj : null, n: r.nCuota, total: r.nTotal };
}
function _metasAggResumen(metas, combos, proyOn) {
  const T = _metasAggTotales(metas, combos);
  return {
    ad: _metasKpiResumen(T.tAD, T.tMA,  T.tPAD, proyOn, fmt),
    nr: _metasKpiResumen(T.tNR, T.tMNR, T.tPNR, proyOn, fmt),
    sh: _metasKpiResumen(T.tSH, T.tMH,  T.tPSH, proyOn, fmt)
  };
}

/**
 * Resumen país de una línea para un mes: por KPI `{ actual, meta, pct, proj, F }`
 * — exactamente las cifras de las tarjetas "Resumen" de la pestaña Metas con
 * los mismos filtros. Sin estado de módulo: la proyección (solo mes en curso,
 * domain/mesEnCurso) se decide en cada llamada.
 *
 *   line     "comb" | "agg" | "fleet" | "tk"
 *   mesName  nombre del mes de la meta ("SEPTIEMBRE") o "YYYY-MM"
 *   anio     año de la meta (metas.mes_year); null = sin año; undefined = el
 *            que elegiría la pestaña Metas
 *   fechas   períodos del mes DENTRO del rango (ver _metasFechasDelMes)
 *   filtros  { city, kam, selected } — los del panel (getCurrentFilters)
 *
 * Devuelve null si no hay metas o no hay períodos; `sinMetas: true` (kpis
 * vacíos) si la línea no tiene ninguna fila de meta ese mes — la pestaña Metas
 * muestra en ese caso el estado vacío, sin tarjetas.
 */
export function metasResumenPais({ line, mesName, anio, fechas, filtros = {} }) {
  if (!mesName || !(STATE.metasData || []).length) return null;
  const mesDates = [...(fechas || [])].sort();
  if (!mesDates.length) return null;
  const mesYearSel = anio !== undefined ? anio : _metasMesActualYear(mesName);
  const fset = new Set(mesDates);
  const cityFilter = filtros.city || "all";
  const kamFilter  = filtros.kam  || "all";
  const sel    = filtros.selected || [];
  const selSet = new Set(sel);
  const proyOn = _metasCalcProyOn(mesName, mesYearSel, mesDates);
  const base = { line, mes: mesName, anio: mesYearSel, proyOn, mesLabel: mesLabel(mesName) };
  if (line === "agg") {
    const metas = _metasAggMetas(mesName, mesYearSel, sel, selSet, cityFilter, kamFilter);
    const { combos } = _metasAggCombos(metas, fset, mesDates[0], mesDates[mesDates.length - 1], false, selSet, cityFilter, kamFilter);
    return { ...base, sinMetas: !metas.length, kpis: _metasAggResumen(metas, combos, proyOn) };
  }
  const cfg = _metasLineCfg(line, mesName, mesYearSel, fset, selSet, cityFilter, kamFilter);
  if (!cfg.metaRows.length) return { ...base, sinMetas: true, kpis: {} };
  return { ...base, sinMetas: false, kpis: _metasResumenDeUnits(cfg.kpis, _metasLineUnits(cfg.metaRows, cfg.act), proyOn, !!cfg.reglaCuota) };
}

/**
 * Cuentas (partner + ciudad) de una línea con su meta y su actual del mes, para
 * Desempeño (29-sep-2026). MISMO universo y MISMO cálculo que la pestaña Metas
 * (_metasLineCfg + _metasLineUnits + _metasResumenDeUnits), así el % de una
 * ciudad, un KAM o un partner no puede diferir entre las dos pantallas.
 * Solo Combinado y TukTuk (Agregador usa otra ruta: ver metasResumenPais).
 *
 * Devuelve { proyOn, cuentas: [{ partner, city, kam, sinMeta, u }], resumen(us) }
 * — `resumen` recibe una lista de `u` y devuelve por KPI { actual, meta, pct, proj }.
 */
export function metasCuentasLinea({ line, mesName, anio, fechas, filtros = {} }) {
  if (line !== "comb" && line !== "tk") return null;
  if (!mesName || !(STATE.metasData || []).length) return null;
  const mesDates = [...(fechas || [])].sort();
  if (!mesDates.length) return null;
  const mesYearSel = anio !== undefined ? anio : _metasMesActualYear(mesName);
  const cfg = _metasLineCfg(line, mesName, mesYearSel, new Set(mesDates), new Set(filtros.selected || []),
    filtros.city || "all", filtros.kam || "all");
  if (!cfg.metaRows.length) return null;
  const proyOn = _metasCalcProyOn(mesName, mesYearSel, mesDates);
  const units = _metasLineUnits(cfg.metaRows, cfg.act);
  return {
    proyOn,
    cuentas: units.map(u => ({ partner: u.m.partner, city: u.m.city, kam: _metasKamDe(u.m), sinMeta: !!u.m._sinMeta, u })),
    resumen: us => _metasResumenDeUnits(cfg.kpis, us, proyOn, !!cfg.reglaCuota)
  };
}
