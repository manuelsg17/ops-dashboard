//@ts-nocheck
import { ensureHtml2Canvas } from "./shared/lazyLibs.js";
import { opcionesCapturaClara, tokenClaro } from "./shared/exportClaro";
import { t, mesLabel, kamLabel, getLang } from "./core/i18n";
import { btn, badge, alertBox, emptyState, icon, segmented } from "./shared/ui";
import { confirmDialog, alertDialog } from "./shared/confirmDialog";
import { parseNumInput, rawNumText } from "./calcNumInput";
import { MES_NOMBRES, mesNombre } from "./core/meses";
import { EXPORT_STR, pick, fmtL, fmtSmartL, localeDe, ciudadL, exportLang } from "./core/i18nExport";
import { validarMetas, mensajeMetasInvalidas } from "./domain/metasGuard";
import { repartirPorLinea, pesoNaturalTk, splitPorFraccion } from "./domain/repartoLinea.js";
import { hayProgresoSinGuardar, draftAplica, debePreseleccionarKam } from "./domain/calcDraft.js";
import { detectarCambiosTk, hayCambiosTk, mensajeCambiosTk, claveFila, TK_PARAGUAS } from "./domain/desgloseTk.js";
import { SIN_KAM } from "./core/config.js";
import { tasaAcum, sumarTasa, leerTasa } from "./domain/metrics.js";
import { logAccess } from "./shared/accessLog.js";
import { dn } from "./shared/huella";
import { alCerrarSesion } from "./shared/sesion";
import { upsertMetas } from "./shared/upsertMetas";
import { cityLabel } from "./core/format";
import { ATAJOS_META, metaAtajo, variacionPct, textoVariacion, estadoCelda, soltarCeldas, ordenarUnidades } from "./domain/calcPlanilla";
import { absolutoTk, sumaPorcionesTk } from "./domain/tkResumen";
// calculator.ts — Calculadora de Metas (planilla viva, fase 8 sep-2026)
// El KAM ingresa su meta TOTAL y se reparte (disgrega) a cada partner+ciudad
// segun su % de representacion en el ULTIMO MES. La pantalla es UNA planilla
// partida: a la izquierda (fija al hacer scroll) el KAM y el mes, las tres
// metas con atajos (+5% / +10% / +15% / igual que el mes base), los ajustes
// avanzados (% TukTuk, cómo guardar, eliminar), el cuadre y Guardar; a la
// derecha el reparto, que se recalcula EN VIVO mientras se escribe.
// Historia: pestañas (Agregador / Fleet / Revisar) → cinco pasos apilados
// (Ola 6) → esta planilla (prototipo "Elegida" que eligió Manuel el 24-sep).
// La matemática del reparto y del guardado NO cambió con ninguno de los tres.

export const CALC_STATE = {
  kam:        "all",
  // Metas editadas manualmente: { "partner|||city|||metric": valor }
  edits:      {},
  // Utilización Fleet sembrada en 85 (default estándar) por key ya sembrada — así
  // el 85 visible en la pestaña Fleet llega a la tarjeta y al guardado; borrable.
  _utilSeeded: {},
  // Metas KAM input manual (formato Yango con pesos) + metas TukTuk (Fase 7)
  kamGoals:   { ad: 0, sh: 0, nr: 0, otherProj: 0, fleetA2: 0 },
  // % DECLARADO de la meta que corresponde a TukTuk, por KPI (0-100).
  //
  // Viene de la tabla que baja PnL junto con las metas del mes ("% Metas TukTuk"
  // por KAM). NO se deriva del fact a propósito: es el número que el KAM declara
  // en los Loyalty Programs, así que manda sobre el peso natural (decisión de
  // Manuel, sep 2026). La pantalla muestra los dos y la brecha entre ellos.
  // 0 en los tres = cartera sin TukTuk (caso Álvaro), reparto de un solo pozo.
  tkPct:      { ad: 0, sh: 0, nr: 0 },
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
  saveMode:   "edits",

  // ── PRESELECCIÓN DE KAM Y DRAFT ENTRE RECARGAS (sep 2026) ──────────────────
  // true en cuanto el usuario TOCA el selector de KAM (a mano, o confirma un
  // cambio) — a partir de ahí el auto-select de STATE.myKam deja de escribir
  // CALC_STATE.kam en cada render. Sin este freno, cada re-render (dispara con
  // cada tecla, ver _calcScheduleRerender) revertiría al KAM logueado apenas el
  // usuario mirara la meta de otro.
  _kamTouched: false,
  // "MES-AÑO" del mes objetivo del render más reciente (lo fija renderCalculator
  // junto a _calcSeedGuardadas). Clave del draft de abajo: sin el mes, un
  // borrador de julio reaparecería sobre agosto y pisaría números de otro ciclo.
  _mesKey:     "",
  // true tras el primer intento de cargar el draft de localStorage en esta
  // carga de página. Ver _calcCargarDraftSiAplica: el draft solo debe aplicarse
  // UNA vez, para sobrevivir un F5 — no en cada re-render, donde pisaría lo que
  // el usuario esté escribiendo en ese momento.
  _draftIntentado: false,

  // ── PLANILLA (fase 8, sep-2026) ────────────────────────────────────────────
  // Solo estado de PANTALLA: qué muestra la columna derecha ("agg" = reparto,
  // "fleet" = KPIs Fleet, "tarjetas" = tarjetas para partners) y qué
  // desplegables quedaron abiertos (se repinta entero tras varias acciones y
  // un <details> cerrándose solo desorienta).
  vista:       "agg",
  advOpen:     false,
  refOpen:     false,
  pctKamOpen:  false,
  // Sección TukTuk: null = todavía no la tocó nadie → abierta si NO hay %
  // declarado (ahí hay algo que hacer), cerrada si ya está declarado.
  tkOpen:      null,
  _tkOpenReset: false
};

// I2: al cerrar sesión, CALC_STATE vuelve a su estado inicial. Sin esto, salir y
// entrar con OTRO usuario sin recargar dejaba las metas a medio cargar, las
// ediciones y el KAM del anterior en memoria (el draft de localStorage ya se
// borraba en el logout; el objeto en memoria no).
const _CALC_STATE_INICIAL = JSON.stringify(CALC_STATE);
alCerrarSesion(() => {
  for (const k of Object.keys(CALC_STATE)) delete CALC_STATE[k];
  Object.assign(CALC_STATE, JSON.parse(_CALC_STATE_INICIAL));
});

// Única llave de localStorage para "lo que el KAM cargó y todavía no guardó":
// meta global (kamGoals) + % TukTuk (tkPct). UN solo borrador, no uno por KAM —
// ver _calcResetParaNuevoKam: cambiar de KAM lo borra a propósito ("empezar de
// cero con el perfil del otro KAM", pedido explícito de Manuel), así que no hace
// falta (ni conviene) mantener una gaveta por persona.
const CALC_DRAFT_KEY = "yangoCalcDraft";

// Guarda kamGoals + tkPct para sobrevivir un F5. Se llama desde los dos
// handlers de input (calcOnKamGoalChange / calcOnTkPctChange) — no hay que
// esperar a "Recalcular" ni a guardar en BD, un F5 a mitad de tipear no debería
// borrar lo ya escrito.
export function _calcGuardarDraft() {
  if (CALC_STATE.kam === "all" || !CALC_STATE._mesKey) return;   // nada que atar al draft
  lsSet(CALC_DRAFT_KEY, JSON.stringify({
    kam: CALC_STATE.kam, mesKey: CALC_STATE._mesKey,
    kamGoals: CALC_STATE.kamGoals, tkPct: CALC_STATE.tkPct
  }));
}

export function _calcBorrarDraft() {
  try { localStorage.removeItem(CALC_DRAFT_KEY); } catch {}
}

// Aplica el draft guardado, si corresponde. Solo una vez por carga de página
// (_draftIntentado) — la REGLA de si corresponde (mismo KAM, mismo mes, nada
// tecleado todavía) vive en domain/calcDraft.ts, con tests.
export function _calcCargarDraftSiAplica() {
  if (CALC_STATE._draftIntentado) return;
  CALC_STATE._draftIntentado = true;
  let d;
  try { d = JSON.parse(lsGet(CALC_DRAFT_KEY) || "null"); } catch { return; }
  if (!draftAplica(d, CALC_STATE.kam, CALC_STATE._mesKey)) return;
  // Si YA hay algo cargado en memoria (llegó acá por otro camino que no sea un
  // reload) no pisar nada: el draft es solo para sobrevivir una recarga, nunca
  // para revertir una edición en curso.
  if (hayProgresoSinGuardar(CALC_STATE.kamGoals, CALC_STATE.tkPct, 0)) return;
  if (d.kamGoals) CALC_STATE.kamGoals = { ...CALC_STATE.kamGoals, ...d.kamGoals };
  if (d.tkPct)    CALC_STATE.tkPct    = { ...CALC_STATE.tkPct,    ...d.tkPct };
}

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
// Por eso el paso 2 (_calcBaseRefHTML) muestra la base combinada del último mes como referencia.
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
            // Porción TUKTUK de la unidad, aparte del total. NO es una bandera:
            // hay partners que operan Taxi Y TukTuk en la MISMA ciudad (Lizzo,
            // ArequipaGo y YEGO en Lima, verificado contra la BD), así que la
            // unidad (partner, ciudad) no se puede clasificar de un solo lado.
            // Lo consume el carve-out de domain/repartoLinea.ts.
            adTk: 0, shTk: 0, nrTk: 0,
            _accept: tasaAcum(), intSh: 0, ownedCars: 0, _adByDate: {}, _bcarsByDate: {}, _adTkByDate: {} };
      out.set(k, e);
    }
    if (!e.clid && r.clid) e.clid = r.clid;
    const esTk = typeof rowIsTuktuk === "function" && rowIsTuktuk(r);
    e.trips += r.trips || 0;
    e.sh    += r.supplyHours || 0;
    if (esTk) {
      e.shTk += r.supplyHours || 0;
      e.nrTk += (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0);
      e._adTkByDate[r.date] = (e._adTkByDate[r.date] || 0) + (r.activeDrivers || 0);
    }
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
    // Acceptance (0-1) ponderada por viajes, solo de las filas que traen la tasa.
    e.intSh     += r.internalFleetSh || 0;
    e.ownedCars += r.ownedFleetActiveCars || 0;
    sumarTasa(e._accept, r.acceptanceRate, r.trips);
  });
  // Colapsar snapshots: máx sobre fechas de la suma por fecha (suma de fleetrooms).
  for (const e of out.values()) {
    const ads = Object.values(e._adByDate), bcs = Object.values(e._bcarsByDate);
    e.ad    = ads.length ? Math.max(...ads) : 0;
    e.bcars = bcs.length ? Math.max(...bcs) : 0;
    // El AD TukTuk se colapsa con el MISMO criterio que el total (máx entre
    // fechas de la suma por fecha). Tomar otra cosa —por ejemplo la suma— haría
    // que la porción superara al total y el reparto le robaría peso al resto.
    const adTk = Object.values(e._adTkByDate);
    e.adTk = adTk.length ? Math.max(...adTk) : 0;
    delete e._adByDate; delete e._bcarsByDate; delete e._adTkByDate;
  }
  return out;
}

// Referencia 3m (promedio ponderado) de los KPIs fleet de un partner-ciudad.
export function _calcFleetRef(e) {
  const acc = leerTasa(e._accept);
  return {
    shcar:  e.ownedCars > 0 ? e.intSh / e.ownedCars : null,      // SH interno / auto propio (= deck/Metas)
    accept: acc == null ? null : acc * 100                       // % (0-100)
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
// KAM efectivo de una fila para el filtro de la Calculadora.
//
// ORDEN IMPORTANTE: `partners` PRIMERO (getKAMForPartner), el kam de la fila
// después. Estaba al revés —`r.kam || getKAMForPartner(...)`— y eso hacía que un
// partner cuyo KAM se hubiera vaciado en Configuración siguiera repartiéndose
// bajo su KAM anterior, porque la fila de rendimiento conserva el valor viejo
// del Excel hasta la próxima ingesta. Mismo criterio que `_lineKamOf` de
// Rendimiento; el fallback final es SIN_KAM para que ninguna fila quede fuera de
// todos los grupos (si no, sus números aparecen en el total del país sin
// pertenecer a nadie y la suma de los KAMs no cierra).
export function _calcKamDe(r) {
  return getKAMForPartner(r.partner) || (r.kam || "").trim() || SIN_KAM;
}
// KAM que se escribe en `metas.kam`. Nunca SIN_KAM: ese es un bucket de la UI
// para poder VER y filtrar a los partners sin responsable, no un nombre válido.
export function _calcKamGuardar(partner) {
  const k = CALC_STATE.kam === "all" ? (getKAMForPartner(partner) || "") : CALC_STATE.kam;
  return k === SIN_KAM ? "" : k;
}
export function _calcShare(val, tot) { return tot > 0 ? val / tot : 0; }
export function _calcIsFleet(partner) { return typeof isFleetPartner === "function" && isFleetPartner(partner); }

// Unidades de reparto de un KPI, con su porción TukTuk separada.
const _CALC_KPI_VALS = {
  ad: e => ({ valTotal: e.ad, valTk: e.adTk || 0 }),
  sh: e => ({ valTotal: e.sh, valTk: e.shTk || 0 }),
  nr: e => ({ valTotal: e.np + e.ns + e.re, valTk: e.nrTk || 0 })
};
export function _calcUnidades(agg, kpi) {
  const val = _CALC_KPI_VALS[kpi];
  return [...agg.values()].map(e => ({ key: `${e.partner}|||${e.city}`, ...val(e) }));
}

// ¿Hay algún % de TukTuk declarado? Si no, el carve-out NO se aplica.
//
// ESTO NO ES UN DETALLE: con el carve-out activo y 0% declarado, las unidades
// TukTuk recibirían meta CERO y su cuota se repartiría entre las de Taxi. Para
// un KAM que todavía no cargó la tabla de PnL eso cambiaría sus metas sin que
// hubiera pedido nada. Sin declarar, se mantiene el reparto histórico de un solo
// pozo sobre la base combinada, donde TukTuk se lleva su peso natural.
export function _calcTieneTkPct() {
  const p = CALC_STATE.tkPct || {};
  return (+p.ad > 0) || (+p.sh > 0) || (+p.nr > 0);
}

// Cuotas por unidad con carve-out de TukTuk. `null` = sin % declarado → los
// llamadores usan la matemática histórica.
export function _calcRepartoDe(agg, g) {
  if (!_calcTieneTkPct()) return null;
  const p = CALC_STATE.tkPct || {};
  const out = new Map();
  const avisos = [];
  ["ad", "sh", "nr"].forEach(kpi => {
    const r = repartirPorLinea(+g[kpi] || 0, (+p[kpi] || 0) / 100, _calcUnidades(agg, kpi));
    r.avisos.forEach(a => { if (!avisos.includes(a)) avisos.push(a); });
    r.cuotas.forEach(c => {
      let o = out.get(c.key);
      if (!o) { o = {}; out.set(c.key, o); }
      o[kpi] = c.total;
      o[kpi + "Tk"] = c.tk;
    });
  });
  out._avisos = avisos;
  return out;
}

// Bases distribuidas de AGREGADOR (AD/SH/N+R) para un partner-ciudad.
// Los partners Fleet SÍ se reparten con la MISMA ecuación (goal × share) y el
// denominador incluye a TODOS (cartTotals) → así no se sobre-exige a los no-fleet.
// `fleet` queda solo como badge. `noAct` marca partners sin actividad Taxi el último
// mes (share 0 → meta 0): se resaltan para fijar la meta a mano (decisión del KAM).
//
// `reparto` (opcional): mapa de cuotas con carve-out de TukTuk (ver
// _calcRepartoDe). Cuando viene, manda — el % declarado por PnL tiene prioridad
// sobre el peso natural. Cuando no, se usa el reparto histórico de un solo pozo.
export function _calcAggMetaBases(e, g, cartTotals, reparto) {
  const fleet = _calcIsFleet(e.partner);
  const nr = e.np + e.ns + e.re;
  const noAct = (e.ad + e.sh + nr) === 0;
  const cuota = reparto && reparto.get(`${e.partner}|||${e.city}`);
  if (cuota) {
    return {
      ad: cuota.ad || 0, sh: cuota.sh || 0, nr: cuota.nr || 0,
      // Porción TukTuk de cada cuota → se guarda en meta_tk_* para el Loyalty Program.
      adTk: cuota.adTk || 0, shTk: cuota.shTk || 0, nrTk: cuota.nrTk || 0,
      fleet, noAct
    };
  }
  return {
    ad: (+g.ad || 0) * _calcShare(e.ad, cartTotals.ad),
    sh: (+g.sh || 0) * _calcShare(e.sh, cartTotals.sh),
    nr: (+g.nr || 0) * _calcShare(nr,  cartTotals.nr),
    adTk: 0, shTk: 0, nrTk: 0,
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

  // MODO DE GUARDADO POR DEFECTO, según si el mes ya existe o se arma de cero.
  //
  // EL CALLEJÓN SIN SALIDA QUE ESTO EVITA: "Solo lo que cambié" escribe
  // únicamente las celdas que el KAM TECLEÓ a mano (a propósito — ver
  // _calcFiltrarSoloCambios). Pero el camino natural para armar el mes es cargar
  // la meta global, apretar "Recalcular" y guardar, SIN tocar ninguna celda.
  // Con "edits" fijo por defecto, ese recorrido terminaba en "No hay cambios
  // para guardar" y no se guardaba nada, después de haber hecho todo bien.
  //
  // Mes SIN metas en BD  → no hay nada que proteger → "Reparto completo".
  // Mes CON metas        → "Solo lo que cambié", que es el freno que evita pisar
  //                        el reparto entero por un ajuste puntual.
  // El KAM puede cambiarlo con los radios; esto solo elige el punto de partida.
  CALC_STATE.saveMode = Object.keys(CALC_STATE.saved).length ? "edits" : "full";
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

// ── Campos numéricos con formato ─────────────────────────────────────────────
// Los campos de meta muestran la cifra con miles (mismo fmt() que el resto de
// la app) y la cruda al editar: ver calcNumFocus/calcNumBlur y calcNumInput.ts.
export function _calcFmtIn(v) {
  const n = +v;
  return Number.isFinite(n) ? fmt(n) : "";
}

// Mes "YYYY-MM" → "Octubre 2026" en el idioma de la interfaz.
export function _calcMesTxt(iso) {
  if (!iso || !/^\d{4}-\d{2}$/.test(iso)) return "";
  const [y, mm] = iso.split("-").map(Number);
  return `${mesNombre(mm - 1, getLang())} ${y}`;
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
    : rows.filter(r => _calcKamDe(r) === CALC_STATE.kam);

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
  const reparto = _calcRepartoDe(agg, g);
  for (const e of agg.values()) {
    const b = _calcAggMetaBases(e, g, distTotals, reparto);
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
  // TukTuk: porción repartida (Σ de la tabla) vs el absoluto declarado.
  const tk = _calcTieneTkPct() ? { sum: _calcTkTotales(m) || { ad: 0, sh: 0, nr: 0 } } : null;
  return { agg, fleet, hasFleet: m.hasFleet, tk };
}

// ── CUADRE (panel izquierdo) ─────────────────────────────────────────────────
// La suma del reparto contra la meta del KAM, por KPI, con la MISMA tolerancia
// de siempre (_calcMetricCuadre). Antes eran píldoras en el paso 4 y una fila
// "Meta KAM · cuadre" al pie de la tabla; ahora vive junto a las metas, que es
// donde se mira mientras se escribe.
const _CALC_K3 = ["ad", "sh", "nr"];
function _calcCorto(k) {
  if (k === "sh") return t("calc.cortoHoras");
  return k === "ad" ? "AD" : "N+R";
}

// ¿Hay alguna celda del agregador tecleada a mano (distinta de lo guardado)?
// Solo sirve para explicar un "no cuadra": una celda fijada no sigue el reparto.
export function _calcHayFijadas() {
  return Object.keys(CALC_STATE.edits).some(k =>
    /\|\|\|(ad|sh|nr)$/.test(k) && estadoCelda(CALC_STATE.edits[k], CALC_STATE.saved[k]).fijada);
}

export function _calcCuadreBox(status) {
  const g = CALC_STATE.kamGoals;
  const P = _CALC_K3.map(k => ({ k, p: status.agg[k] }));
  const cargadas = P.filter(x => x.p && x.p.hasGoal);
  const malas = cargadas.filter(x => !x.p.ok);
  const item = ({ k, p }) => !p.hasGoal
    ? `<span class="calc-cuadre-box__it is-none">${escapeHTML(_calcCorto(k))}: ${escapeHTML(t("calc.sinMeta"))}</span>`
    : `<span class="calc-cuadre-box__it">${escapeHTML(_calcCorto(k))} <strong class="ui-num">${fmt(p.sum)}</strong> / <span class="ui-num">${fmt(p.target)}</span>` +
      (p.ok ? "" : ` <span class="ui-num calc-cuadre-box__gap">(${p.gap > 0 ? "+" : ""}${fmt(p.gap)})</span>`) + `</span>`;
  let tone = "ok", ico = "check-circle", head = t("calc.cuadraCorto"), extra = "";
  if (!cargadas.length) { tone = "none"; ico = "minus"; head = t("calc.cuadreVacio"); }
  else if (malas.length) {
    tone = "warn"; ico = "alert-triangle"; head = t("calc.noCuadra");
    if (_calcHayFijadas()) extra = t("calc.cuadreFijadasHint");
  }
  const items = cargadas.length
    ? `<span class="calc-cuadre-box__items">${P.map(item).join(`<span class="calc-cuadre-box__sep" aria-hidden="true">·</span>`)}</span>`
    : "";
  let fleet = "";
  if (status.hasFleet && status.fleet) {
    const f = status.fleet;
    const ft = f.total === 0 ? "neutral" : (f.filled >= f.total ? "ok" : "warn");
    fleet = badge(`Fleet: ${f.filled}/${f.total} ${t("calc.conMeta")}`, ft, { icon: "car" });
  }
  // TukTuk: siempre una línea, para que el estado se vea también acá. No cambia
  // el veredicto de arriba (la porción TukTuk es un DESGLOSE de la meta, no una
  // meta aparte): solo muestra lo repartido vs lo declarado.
  let tkLine;
  const tkIco = icon("tuktuk", { size: 12 });
  if (!status.tk) {
    tkLine = `<span class="calc-cuadre-box__tk is-none">${tkIco}${escapeHTML(t("calc.tk.cuadreSin"))}</span>`;
  } else {
    const parts = _CALC_K3.filter(k => _calcTkAbs(k) != null).map(k => {
      const q = _calcMetricCuadre(status.tk.sum[k], _calcTkAbs(k));
      return `<span class="calc-cuadre-box__it">${escapeHTML(_calcCorto(k))} <strong class="ui-num">${fmt(q.sum)}</strong> / <span class="ui-num">${fmt(q.target)}</span>` +
        (q.ok ? "" : ` <span class="ui-num calc-cuadre-box__gap">(${q.gap > 0 ? "+" : ""}${fmt(q.gap)})</span>`) + `</span>`;
    });
    tkLine = `<span class="calc-cuadre-box__tk">${tkIco}<strong>TukTuk</strong>` +
      (parts.length ? parts.join(`<span class="calc-cuadre-box__sep" aria-hidden="true">·</span>`)
                    : `<span>${escapeHTML(t("calc.tk.cuadreSinMeta"))}</span>`) + `</span>`;
  }
  // Huella de números: el mismo texto que antes llevaba la fila de cuadre de la
  // tabla (meta + "Cuadra" o la diferencia), para que la huella no cambie.
  const huella = _CALC_K3.map(k =>
    `<span hidden${dn(`calc.dist.cuadre.${k}`)}>${_calcCuadre(status.agg[k].sum, +g[k] || 0)}</span>`).join("");
  return `<div class="calc-cuadre-box calc-cuadre-box--${tone}">${icon(ico, { size: 16 })}` +
    `<div class="calc-cuadre-box__txt"><span class="calc-cuadre-box__top"><strong class="calc-cuadre-box__head">${escapeHTML(head)}</strong>${fleet}</span>${items}${tkLine}` +
    (extra ? `<span class="calc-cuadre-box__hint">${escapeHTML(extra)}</span>` : "") +
    `</div></div>${huella}`;
}

// ── REFRESCO EN VIVO ─────────────────────────────────────────────────────────
// Dos niveles, los dos SIN repintar la pantalla entera (un repintado completo
// se lleva el foco del campo que se está escribiendo):
//
//   _calcRefreshStatus  → en el lugar: cuadre, pistas bajo cada meta, absolutos
//                         del % TukTuk, totales de la tabla y conteo del modo
//                         "Solo lo que cambié". Lo llama la edición de una celda.
//   _calcRepintarVivo   → lo anterior + la TABLA de reparto (y la tarjeta, si es
//                         lo que se está viendo). Lo llaman las metas del panel y
//                         el % TukTuk, con un debounce corto: el reparto se
//                         recalcula mientras se escribe, sin botón "Recalcular".
//
// Es seguro repintar la tabla en ese caso porque el foco está en el PANEL (otro
// contenedor); si por algún motivo estuviera dentro de la tabla, se salta.
export function _calcRefreshStatus() {
  const box = document.getElementById("calcCuadre");
  if (!box) return; // no estamos en la Calculadora
  const m = _calcComputeModel();
  const status = _calcComputeStatus(m);
  box.innerHTML = _calcCuadreBox(status);

  _CALC_K3.forEach(k => {
    const h = document.getElementById("calcGoalHint_" + k);
    if (h) h.innerHTML = _calcGoalHint(k, m);
  });

  const g = CALC_STATE.kamGoals;
  // "= 1,700" bajo cada % TukTuk: sigue a la meta y al % mientras se escriben.
  document.querySelectorAll("#calculatorContent [data-tkabs]").forEach(el => {
    const k = el.getAttribute("data-tkabs");
    const decl = +(CALC_STATE.tkPct || {})[k] || 0;
    const goal = +g[k] || 0;
    const on = decl > 0 && goal > 0;
    el.hidden = !on;
    el.textContent = on ? `= ${fmt(Math.round(goal * decl / 100))}` : "";
  });

  const tkB = document.getElementById("calcTkBadge");
  if (tkB) tkB.innerHTML = _calcTkBadgeHTML();
  const tkE = document.getElementById("calcTkEstado");
  if (tkE) tkE.innerHTML = _calcTkEstadoHTML();

  const res = document.getElementById("calcAdvRes");
  if (res) res.textContent = _calcResumenAvanzados();
  const desc = document.getElementById("calcModoEditsDesc");
  if (desc) desc.textContent = t("calc.modoEditsDesc2", { n: _calcContarCambios() });
  const hueco = document.getElementById("calcHuecoTk");
  if (hueco) hueco.innerHTML = STATE.canWrite ? _calcAvisoHuecoTk(m) : "";

  if (document.getElementById("calcAggSumAD")) {
    const a = _calcAggDistSums(m.aggLast1, m.distTot1, g);
    document.getElementById("calcAggSumAD").textContent = fmt(a.sumAD);
    document.getElementById("calcAggSumSH").textContent = fmt(a.sumSH);
    document.getElementById("calcAggSumNR").textContent = fmt(a.sumNR);
    const cam = document.getElementById("calcAggCambioAD");
    if (cam) cam.innerHTML = _calcCambioHTML(a.sumAD, (m.cartTot1 || {}).ad || 0);
  }
}

export function _calcProgramarVivo() {
  clearTimeout(CALC_STATE._vivoT);
  CALC_STATE._vivoT = setTimeout(_calcRepintarVivo, 250);
}

export function _calcRepintarVivo() {
  clearTimeout(CALC_STATE._vivoT);
  CALC_STATE._vivoT = null;
  if (STATE.curTab !== "calculator") return;
  if (!document.getElementById("calcCuadre")) return;
  const act = document.activeElement;
  const m = _calcComputeModel();

  const dist = document.getElementById("calcDist");
  if (dist && !(act && dist.contains(act))) {
    const wrap = dist.querySelector(".calc-dist-wrap");
    const top = wrap ? wrap.scrollTop : 0, left = wrap ? wrap.scrollLeft : 0;
    dist.innerHTML = _calcVistaActual(m) === "fleet"
      ? _calcSec4b_fleet(m.aggLast3)
      : _calcSec4_distribucion(m.aggLast1, m.distTot1, m.lastMonth);
    const w2 = dist.querySelector(".calc-dist-wrap");
    if (w2) { w2.scrollTop = top; w2.scrollLeft = left; }
  }
  const avisos = document.getElementById("calcTkAvisos");
  if (avisos) avisos.innerHTML = _calcTkAvisosHTML(m);
  const share = document.getElementById("calcShareWrap");
  if (share && !(act && share.contains(act))) {
    share.innerHTML = _calcSec5_exportPartner(m.aggLast1, m.distTot1, m.lastMonth);
  }
  _calcRefreshStatus();
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
// UNA pantalla partida (fase 8, sep-2026; antes cinco pasos apilados):
//   izquierda (fija al hacer scroll) → KAM y mes, las tres metas con atajos,
//                "Ajustes avanzados" (% TukTuk, cómo guardar, metas % KAM,
//                eliminar), el cuadre y las acciones (Guardar / Tarjetas).
//   derecha → el reparto en vivo (Agregador | Fleet), la referencia plegada y,
//                a pedido, las tarjetas para los partners.
// Por debajo de 1100 px el panel pasa arriba de la tabla (CSS).
export function renderCalculator() {
  if (STATE.curTab !== "calculator") return;
  const el = document.getElementById("calculatorContent");
  if (!el) return;
  ensureIndexes();

  const rows = _calcGetMensualData();
  if (!rows.length) {
    el.innerHTML = emptyState({ icon: "calculator", title: t("calc.vacio2"), text: t("calc.vacioSub") });
    return;
  }

  const hasMonthFormat = rows.some(r => /^\d{4}-\d{2}$/.test(r.date || ""));
  if (!hasMonthFormat) {
    el.innerHTML = emptyState({
      icon: "calendar", title: t("calc.requiereMensual2"),
      text: t("calc.requiereMensualSub2", { e: t(`mode.${STATE.curMode}`) })
    });
    return;
  }

  const allKAMs = [...new Set(Object.values(STATE.KAM_MAP).map(k => (k || "").trim()).filter(Boolean))].sort();

  // PRESELECCIONAR el KAM logueado (STATE.myKam, ver auth.ts), UNA sola vez por
  // sesión: apenas el usuario toca el selector a mano (_kamTouched, incluido un
  // cambio confirmado vía calcOnKamChange) esto deja de correr para siempre. Sin
  // el freno, cada re-render revertiría al KAM del login apenas alguien mirara
  // la meta de otro. Un admin sin `myKam` sigue viendo "Todos los KAMs".
  if (debePreseleccionarKam(CALC_STATE._kamTouched, STATE.myKam, CALC_STATE.kam, allKAMs)) {
    CALC_STATE.kam = STATE.myKam;
  }

  const m = _calcComputeModel();

  // Sembrar lo que YA está guardado en BD para el mes objetivo, antes que
  // cualquier otro seeding: así el KAM abre la calculadora viendo sus metas
  // reales (y qué partners ya tienen) en vez de una tabla en 0.
  {
    const { name: _mn, year: _my } = _calcNextMonthName(m.lastMonth || "");
    CALC_STATE._mesKey = `${_mn}-${_my}`;
    _calcSeedGuardadas(_mn, _my);
    // Restaura kamGoals/tkPct de un F5 — solo si el KAM y el mes coinciden
    // exactamente con el draft guardado, y solo la primera vez en esta carga
    // de página (ver _calcCargarDraftSiAplica).
    _calcCargarDraftSiAplica();
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

  _calcLeerUiDelDom();
  clearTimeout(CALC_STATE._vivoT);   // lo que estuviera pendiente queda incluido acá
  CALC_STATE._vivoT = null;
  const status = _calcComputeStatus(m);

  el.innerHTML = `
    <div class="calc">
      <div class="calc-planilla">
        ${_calcPanel(m, allKAMs, status)}
        <section class="calc-main" id="calcMain" aria-labelledby="calcMainT">${_calcMainHTML(m)}</section>
      </div>
    </div>`;
}

// Los <details> se abren y cierran sin pasar por una acción; antes de repintar
// se lee cómo quedaron para no cerrarlos solos.
function _calcLeerUiDelDom() {
  const leer = (id, campo) => { const d = document.getElementById(id); if (d) CALC_STATE[campo] = !!d.open; };
  leer("calcAdv", "advOpen");
  // Tras cambiar de KAM (todo de cero) la sección TukTuk vuelve a su default.
  if (CALC_STATE._tkOpenReset) CALC_STATE._tkOpenReset = false;
  else leer("calcTk", "tkOpen");
  leer("calcRef", "refOpen");
  leer("calcPctKam", "pctKamOpen");
}

// Fleet solo existe si el KAM tiene partners Fleet; si no, vuelve al reparto.
export function _calcVistaActual(m) {
  const v = CALC_STATE.vista;
  if (v === "fleet" && !m.hasFleet) return "agg";
  return v === "fleet" || v === "tarjetas" ? v : "agg";
}

// ── PANEL IZQUIERDO ──────────────────────────────────────────────────────────
export function _calcPanel(m, allKAMs, status) {
  const nextM = _calcNextMonth(m.lastMonth || "");
  const kamAll = CALC_STATE.kam === "all";
  return `
    <aside class="calc-side ui-card" aria-label="${escapeHTML(t("calc.panelAria"))}">
      <div class="calc-side__who">
        <div class="ui-field">
          <label class="ui-field__label" for="calcKamSel">${escapeHTML(t("calc.kamLabel"))}</label>
          <select id="calcKamSel" class="ui-select" data-act-change="calcOnKamChange">
            <option value="all" ${kamAll ? "selected" : ""}>${escapeHTML(t("calc.todosKam"))}</option>
            ${allKAMs.map(k => `<option value="${escapeHTML(k)}" ${CALC_STATE.kam === k ? "selected" : ""}>${escapeHTML(kamLabel(k))}</option>`).join("")}
          </select>
        </div>
        <div class="ui-field">
          <span class="ui-field__label">${escapeHTML(t("calc.mesObjetivo"))}</span>
          <div class="calc-mes">
            ${icon("calendar", { size: 16 })}
            <span class="calc-mes__val">${escapeHTML(_calcMesTxt(nextM))}</span>
            <span class="calc-mes__sub">${escapeHTML(t("calc.repartoSegun", { r: _calcMesTxt(m.lastMonth || "") }))}</span>
          </div>
        </div>
      </div>
      ${kamAll ? alertBox({ tone: "info", text: t("calc.kamTodosAviso") }) : ""}
      <div class="calc-side__block">
        <div class="calc-side__h">${escapeHTML(t("calc.metasDelMes"))}</div>
        <p class="calc-side__sub">${escapeHTML(t("calc.metasDelMesSub"))}</p>
        <div class="calc-side__goals">${_CALC_K3.map(k => _kamGoalInput(k, m)).join("")}</div>
      </div>
      ${_calcTkSeccion(m)}
      ${_calcAvanzados(m)}
      ${_calcAccionesPanel(status)}
    </aside>`;
}

// Nombre del mes base (el último con datos), para los atajos y las pistas.
function _calcMesBaseNombre(m) {
  const iso = m.lastMonth || "";
  if (!/^\d{4}-\d{2}$/.test(iso)) return "";
  return mesNombre(+iso.slice(5, 7) - 1, getLang());
}

// Pista bajo cada meta: cuánto hizo la cartera el mes base — la MISMA base
// sobre la que se reparte (m.cartTot1, Taxi + TukTuk) — y cuánto pide la meta
// contra eso. Reemplaza la línea "Base del reparto…" de antes: el número está
// al lado del campo que lo usa.
export function _calcGoalHint(metric, m) {
  const base = +((m.cartTot1 || {})[metric]) || 0;
  const goal = +CALC_STATE.kamGoals[metric] || 0;
  const v = variacionPct(goal, base);
  const kamTxt = CALC_STATE.kam === "all" ? t("calc.todosKam") : kamLabel(CALC_STATE.kam);
  const txt = t("calc.hintBase", {
    m: escapeHTML(_calcMesTxt(m.lastMonth || "")), kam: escapeHTML(kamTxt),
    v: `<strong class="ui-num">${fmt(Math.round(base))}</strong>`
  });
  return v == null ? txt
    : `${txt} <span class="calc-tone--${v >= 0 ? "ok" : "bad"} ui-num">(${textoVariacion(v)})</span>`;
}

// Campo de meta global: número con miles (ver _calcFmtIn / calcNumFocus), atajos
// sobre la base del mes y la pista con la variación. El peso de la métrica en
// el esquema de KAM (KAM_WEIGHTS) queda en el title de la etiqueta.
export function _kamGoalInput(metric, m) {
  const id = `calcGoal_${metric}`;
  const val = +CALC_STATE.kamGoals[metric] || 0;
  const base = +((m.cartTot1 || {})[metric]) || 0;
  const mesBase = _calcMesBaseNombre(m);
  const chip = f => {
    const v = metaAtajo(base, f);
    const lbl = f === 1 ? t("calc.atajoIgual", { m: mesBase }) : `+${Math.round((f - 1) * 100)}%`;
    return `<button type="button" class="calc-qchip" data-act="calcAtajo" data-metric="${metric}" data-f="${f}"` +
      (v == null ? " disabled" : ` title="${escapeHTML(t("calc.atajoTip", { v: fmt(v) }))}"`) + `>${escapeHTML(lbl)}</button>`;
  };
  const ph = base > 0 ? ` placeholder="${escapeHTML(t("calc.phEj", { v: fmt(Math.round(base * 1.1)) }))}"` : "";
  return `
    <div class="calc-goal">
      <label class="ui-field__label" for="${id}" title="${escapeHTML(t("calc.peso", { w: KAM_WEIGHTS[metric] }))}">${escapeHTML(t(`calc.goal.${metric}`))}</label>
      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"${ph}
        value="${escapeHTML(val ? _calcFmtIn(val) : "")}" data-raw="${escapeHTML(val ? rawNumText(val) : "")}"
        data-act-change="calcOnKamGoalChange" data-act-input="calcOnKamGoalChange"
        data-act-focus="calcNumFocus" data-act-blur="calcNumBlur" data-act-keydown="calcNumKeydown"
        data-metric="${metric}" class="ui-input calc-num calc-goal__in"/>
      <div class="calc-goal__chips" role="group" aria-label="${escapeHTML(t("calc.atajosAria"))}">${ATAJOS_META.map(chip).join("")}</div>
      <div class="ui-field__hint calc-goal__hint" id="calcGoalHint_${metric}">${_calcGoalHint(metric, m)}</div>
    </div>`;
}

// ── AJUSTES AVANZADOS (plegado) ──────────────────────────────────────────────
// Lo que no se toca todos los meses: cómo guardar, las metas % del KAM
// (referencia) y, para un admin, eliminar las metas del KAM. El % TukTuk de PnL
// salió de acá (sep-2026, pedido de Manuel: "no veo a TukTuk y no me queda
// claro si llené su data o no") a su propia sección, siempre a la vista. El resumen
// muestra el modo de guardado elegido: es lo único de acá que cambia qué se
// escribe al apretar Guardar, así que tiene que verse sin abrir nada.
export function _calcAvanzados(m) {
  const canSave = !!STATE.canWrite;
  return `
    <details class="calc-adv" id="calcAdv"${CALC_STATE.advOpen ? " open" : ""}>
      <summary class="calc-adv__sum"><span class="calc-adv__t">${escapeHTML(t("calc.avanzados"))}</span><span class="calc-adv__res" id="calcAdvRes">${escapeHTML(_calcResumenAvanzados())}</span></summary>
      <div class="calc-adv__body">
        ${canSave ? `<section class="calc-adv__sec">${_calcModoHTML()}<div id="calcHuecoTk">${_calcAvisoHuecoTk(m)}</div>
          <p class="calc-help">${escapeHTML(t("calc.actualizarHint2"))}</p></section>` : ""}
        <details class="calc-details" id="calcPctKam"${CALC_STATE.pctKamOpen ? " open" : ""}>
          <summary>${escapeHTML(t("calc.metasPctKam"))}</summary>
          <div class="calc-details__body">
            ${_kamPctInput("otherProj", t("calc.otherProj"))}
            ${_kamPctInput("fleetA2", t("calc.fleetA2"))}
            <p class="calc-help">${escapeHTML(t("calc.metasPctKamSub"))}</p>
          </div>
        </details>
        ${_calcBorrarHTML()}
      </div>
    </details>`;
}

function _calcResumenAvanzados() {
  return STATE.canWrite ? t(CALC_STATE.saveMode === "full" ? "calc.modoFull" : "calc.modoEdits") : "";
}

// Metas % a nivel KAM (Otros proyectos, Fleet A2): referencia, no se reparten.
function _kamPctInput(metric, label) {
  const id = `calcGoal_${metric}`;
  const val = +CALC_STATE.kamGoals[metric] || 0;
  return `
    <div class="ui-field">
      <label class="ui-field__label" for="${id}">${escapeHTML(label)}</label>
      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
        value="${escapeHTML(_calcFmtIn(val))}" data-raw="${escapeHTML(rawNumText(val))}"
        data-act-change="calcOnKamGoalChange" data-act-input="calcOnKamGoalChange"
        data-act-focus="calcNumFocus" data-act-blur="calcNumBlur" data-act-keydown="calcNumKeydown"
        data-metric="${metric}" class="ui-input ui-input--sm calc-num"/>
      <span class="ui-field__hint">${escapeHTML(t("calc.peso", { w: KAM_WEIGHTS[metric] }))}</span>
    </div>`;
}

// ── Modo de guardado ─────────────────────────────────────────────────────────
// "Solo lo que cambié": un ajuste puntual NO debe reescribir el reparto entero
// del mes. "Reparto completo" es el comportamiento histórico y se elige a
// conciencia cuando se arma el mes desde cero. El default depende de si el mes
// ya tiene metas (ver _calcSeedGuardadas) — eso NO cambió.
function _calcModoHTML() {
  const modo = CALC_STATE.saveMode;
  const _opt = (val, label, desc, descId) => `
    <label class="calc-mode${modo === val ? " is-on" : ""}">
      <input type="radio" name="calcSaveMode" value="${val}" ${modo === val ? "checked" : ""}
             data-act-change="calcSetSaveMode" data-mode="${val}"/>
      <span class="calc-mode__txt"><span class="calc-mode__label">${escapeHTML(label)}</span><span class="calc-mode__desc"${descId ? ` id="${descId}"` : ""}>${escapeHTML(desc)}</span></span>
    </label>`;
  return `
    <fieldset class="calc-modes">
      <legend class="calc-adv__h">${escapeHTML(t("calc.modoTitulo"))}</legend>
      ${_opt("edits", t("calc.modoEdits"), t("calc.modoEditsDesc2", { n: _calcContarCambios() }), "calcModoEditsDesc")}
      ${_opt("full",  t("calc.modoFull"),  t("calc.modoFullDesc2"))}
    </fieldset>`;
}

// ── Eliminar las metas de ESTE KAM para el mes objetivo (admin) ──────────────
// Igual que "Eliminar metas del mes" de la pestaña Metas; el enforcement real es
// RLS. Deshabilitado con KAM="Todos". Pide teclear el nombre del KAM
// (calcDeleteMetasKam, decisión de Manuel 24-sep-2026).
function _calcBorrarHTML() {
  if (!STATE.isAdmin) return "";
  const kamAll = CALC_STATE.kam === "all";
  const b = kamAll
    ? btn({ label: t("calc.btnBorrarKam2"), variant: "danger", icon: "trash", size: "sm", disabled: true, title: t("calc.borrarKamNeedKam") })
    : btn({ label: t("calc.btnBorrarKamDe2", { k: kamLabel(CALC_STATE.kam) }), variant: "danger", icon: "trash", size: "sm", act: "calcDeleteMetasKam" });
  return `
    <section class="calc-adv__sec calc-adv__sec--danger">
      <h3 class="calc-adv__h">${escapeHTML(t("calc.borrarTitulo"))}</h3>
      <p class="calc-help">${escapeHTML(t("calc.borrarAyuda"))}</p>
      <div>${b}</div>
    </section>`;
}

// ── Acciones del panel ───────────────────────────────────────────────────────
// Guardar es la ÚNICA acción primaria de la pantalla (rojo de marca). Las
// tarjetas para partners son secundarias: cambian la columna derecha.
// El cuadre va en el MISMO pie fijo que Guardar: mientras se escriben las
// metas (o se baja por el panel) siempre se ve si el reparto cierra.
export function _calcAccionesPanel(status) {
  const canSave = !!STATE.canWrite;
  const kamAll  = CALC_STATE.kam === "all";
  const saveBtn = canSave
    ? btn({ label: t("calc.btnGuardar2"), variant: "primary", icon: "save", act: "calcSaveMetas" })
    : btn({ label: t("calc.btnGuardar2"), variant: "primary", icon: "lock", disabled: true, title: t("calc.requiereKamAdmin") });
  const enTarjetas = CALC_STATE.vista === "tarjetas";
  const tarjetas = btn({
    label: enTarjetas ? t("calc.volverReparto") : t("calc.btnTarjetas"),
    icon: enTarjetas ? "table" : "image", act: "calcVerTarjetas"
  });
  return `
    <div class="calc-side__actions">
      <div id="calcCuadre" role="status">${_calcCuadreBox(status)}</div>
      ${!canSave ? alertBox({ tone: "info", text: t("calc.requiereKamAdmin") }) : ""}
      ${canSave && kamAll ? alertBox({ tone: "warn", text: t("calc.kamNote3") }) : ""}
      <div class="calc-side__btns">${saveBtn}${tarjetas}</div>
    </div>`;
}

// ── SECCIÓN TUKTUK (panel izquierdo, siempre a la vista) ────────────────────
// Feedback de Manuel (sep-2026): "no veo a TukTuk y no me queda claro si llené
// su data o no". El % vivía dentro de "Ajustes avanzados", plegado, con una
// pista chica en el resumen. Ahora es una sección propia justo debajo de las
// tres metas y el ESTADO va en el <summary>: se lee sin abrir nada. Arranca
// abierta si no hay % declarado (hay algo que hacer) y cerrada si ya lo está.
// SOLO pantalla: la matemática (_calcTieneTkPct / _calcRepartoDe) no cambia.
const _calcPctTxt = v => String(Math.round((+v || 0) * 100) / 100);

// Absoluto que sale del % declarado (lo que va al Loyalty Program). La MISMA
// cuenta que el "= 1,700" bajo cada campo (_calcTkPctBlock / _calcRefreshStatus).
function _calcTkAbs(k) {
  return absolutoTk((CALC_STATE.kamGoals || {})[k], (CALC_STATE.tkPct || {})[k]);
}

function _calcTkBadgeHTML() {
  return _calcTieneTkPct()
    ? badge(t("calc.tk.declarado"), "ok", { icon: "check-circle" })
    : badge(t("calc.tk.sinDeclarar"), "warn", { icon: "alert-triangle" });
}

// Una línea: sin declarar → qué pasa (peso natural, no se guarda desglose);
// declarado → los tres % con su absoluto ("AD 17% = 1,700 · Horas 20.2% = …").
function _calcTkEstadoHTML() {
  if (!_calcTieneTkPct()) return escapeHTML(t("calc.tk.sinDeclararTxt"));
  const p = CALC_STATE.tkPct || {};
  return _CALC_K3.map(k => {
    const abs = _calcTkAbs(k);
    return `<span class="calc-tk__it">${escapeHTML(_calcCorto(k))} <strong class="ui-num">${escapeHTML(_calcPctTxt(p[k]))}%</strong>` +
      (abs == null ? "" : ` = <strong class="ui-num"${dn("calc.tk.abs", k)}>${fmt(abs)}</strong>`) + `</span>`;
  }).join(`<span class="calc-tk__sep" aria-hidden="true">·</span>`);
}

export function _calcTkSeccion(m) {
  const activo = _calcTieneTkPct();
  const open = CALC_STATE.tkOpen == null ? !activo : !!CALC_STATE.tkOpen;
  return `
    <details class="calc-tk" id="calcTk"${open ? " open" : ""}>
      <summary class="calc-tk__sum">
        <span class="calc-tk__top">
          <span class="calc-tk__t" id="calcTkT">${icon("tuktuk", { size: 14 })}${escapeHTML(t("calc.tk.titulo"))}</span>
          <span id="calcTkBadge">${_calcTkBadgeHTML()}</span>
        </span>
        <span class="calc-tk__estado" id="calcTkEstado">${_calcTkEstadoHTML()}</span>
      </summary>
      <div class="calc-tk__body" role="group" aria-labelledby="calcTkT">${_calcTkPctBlock(m)}</div>
    </details>`;
}

// Totales de la porción TukTuk del reparto: la suma EXACTA de las sub-líneas
// "TukTuk" de la tabla (mismo redondeo por fila, mismas filas), para que el
// cuadre y la tabla no se contradigan. null = sin % declarado.
export function _calcTkTotales(m) {
  const g = CALC_STATE.kamGoals;
  const reparto = _calcRepartoDe(m.aggLast1, g);
  if (!reparto) return null;
  return sumaPorcionesTk([...m.aggLast1.values()].map(e => _calcAggMetaBases(e, g, m.distTot1, reparto)));
}

// ── % TUKTUK DECLARADO POR PnL ───────────────────────────────────────────────
// Junto con las metas del mes, PnL baja qué PORCENTAJE de cada KPI corresponde a
// TukTuk. Ese número se declara en los Loyalty Programs, así que MANDA sobre el
// peso natural de la cartera (decisión de Manuel, sep 2026).
//
// La pantalla muestra los DOS —declarado y real— porque la brecha es información:
// medida contra producción en agosto son ~0,3pp para Manuel, que sobre 15.473 AD
// son 46 conductores. Si la brecha fuera grande, casi seguro falta taggear un
// fleetroom como TukTuk, y eso hay que ver antes de repartir, no después.
//
// Vacío (0 en los tres) = no declarado → reparto histórico de un solo pozo, donde
// TukTuk se lleva su peso natural. Así un KAM que todavía no cargó la tabla no ve
// cambiar sus metas sin haber pedido nada.
export function _calcTkPctBlock(m) {
  const p = CALC_STATE.tkPct || {};
  const g = CALC_STATE.kamGoals || {};
  // MISMO ORDEN que las metas de arriba (AD, SH, N+R), no el de la tabla de
  // PnL: dos grupos de tres campos con las mismas etiquetas en órdenes
  // distintos se cruzan al copiar y no hay nada en pantalla que lo delate.
  // fmt y NO fmtSmart: este número se copia al Loyalty Program, y "101.0K" no
  // se puede declarar. Va exacto aunque ocupe más.
  const fila = k => {
    const nat = pesoNaturalTk(_calcUnidades(m.aggLast1, k));
    const decl = +p[k] || 0;
    // Sin base medible se muestra "—", no 0,0%: un cero acá invita a declarar un
    // cero que nadie midió.
    const natTxt = nat == null ? "—" : (nat * 100).toFixed(1) + "%";
    const gap = (nat == null || !decl) ? null : decl - nat * 100;
    const gapTxt = gap == null ? ""
      : ` · <span title="${escapeHTML(t("calc.tkPctBrechaTip"))}">${gap >= 0 ? "+" : ""}${gap.toFixed(1)} pp</span>`;
    // El ABSOLUTO que sale de ese %: el número que el KAM declara en el Loyalty
    // Program, y además desambigua el campo ("17 % = 1.701": nadie escribe 1701
    // donde va 17). Se actualiza en vivo (_calcRefreshStatus).
    const on = decl > 0 && +g[k] > 0;
    const abs = on ? `= ${fmt(Math.round(+g[k] * decl / 100))}` : "";
    const id = `calcTk_${k}`;
    return `
      <div class="ui-field calc-tkpct__f">
        <label class="ui-field__label" for="${id}" title="${escapeHTML(t(`calc.goal.${k}`))}">${escapeHTML(_calcCorto(k))} (%)</label>
        <div class="calc-suffix">
          <input id="${id}" type="number" step="0.1" min="0" max="100" value="${decl || ""}"
            placeholder="0.0" inputmode="decimal" aria-label="${escapeHTML(t(`calc.goal.${k}`))} (%)"
            data-act-change="calcOnTkPctChange" data-act-input="calcOnTkPctChange" data-metric="${k}"
            class="ui-input ui-input--sm calc-suffix__input"/>
          <span class="calc-suffix__txt" aria-hidden="true">%</span>
        </div>
        <div class="calc-tkpct__abs ui-num" data-tkabs="${k}"${on ? "" : " hidden"}>${escapeHTML(abs)}</div>
        <span class="ui-field__hint">${escapeHTML(t("calc.tkPctReal", { v: natTxt }))}${gapTxt}</span>
      </div>`;
  };
  return `
    <div class="calc-tkpct">${_CALC_K3.map(fila).join("")}</div>
    <div id="calcTkAvisos">${_calcTkAvisosHTML(m)}</div>
    <p class="calc-help">${escapeHTML(t("calc.tkPctSub"))}</p>`;
}

// Avisos del reparto (pozo TukTuk sin dónde caer, % fuera de rango), al lado
// del input que los causa. Un aviso que solo existe en el objeto de retorno no
// es un aviso.
function _calcTkAvisosHTML(m) {
  if (!_calcTieneTkPct()) return "";
  const rep = _calcRepartoDe(m.aggLast1, CALC_STATE.kamGoals);
  return ((rep && rep._avisos) || []).map(a => alertBox({ tone: "warn", text: a })).join("");
}

// ── COLUMNA DERECHA ──────────────────────────────────────────────────────────
export function _calcMainHTML(m) {
  const vista = _calcVistaActual(m);
  const kamAll = CALC_STATE.kam === "all";
  const kamTxt = kamLabel(CALC_STATE.kam);
  if (vista === "tarjetas") {
    return `
      <div class="calc-main__head">
        <div class="calc-main__titles">
          <h2 class="calc-main__title" id="calcMainT">${escapeHTML(t("calc.btnTarjetas"))}</h2>
          <p class="calc-main__sub">${escapeHTML(t("calc.tarjetasSubHead"))}</p>
        </div>
        <div class="calc-main__tools">${btn({ label: t("calc.volverReparto"), icon: "chevron-left", variant: "ghost", size: "sm", act: "calcVerTarjetas" })}</div>
      </div>
      <div id="calcShareWrap">${_calcSec5_exportPartner(m.aggLast1, m.distTot1, m.lastMonth)}</div>`;
  }
  const titulo = vista === "fleet" ? t("calc.metasFleet")
    : (kamAll ? t("calc.repartoTodos") : t("calc.repartoDe", { kam: kamTxt }));
  const sub = vista === "fleet" ? t("calc.metasFleetSub")
    : t("calc.repartoSub", { n: m.aggLast1.size, m: _calcMesTxt(m.lastMonth || "") });
  const seg = m.hasFleet ? segmented({
    ariaLabel: t("calc.vistaAria"), act: "calcSetVista", value: vista,
    options: [{ value: "agg", label: t("calc.vistaAgg"), icon: "taxi" }, { value: "fleet", label: "Fleet", icon: "car" }]
  }) : "";
  const leyenda = vista === "agg" ? `
      <div class="calc-legend">
        <span class="calc-legend__it"><span class="calc-legend__sw calc-legend__sw--fija" aria-hidden="true"></span>${escapeHTML(t("calc.leyendaFija"))}</span>
        <span class="calc-legend__it"><span class="calc-legend__sw calc-legend__sw--dirty" aria-hidden="true"></span>${escapeHTML(t("calc.leyendaDistinta"))}</span>
      </div>` : "";
  return `
    <div class="calc-main__head">
      <div class="calc-main__titles">
        <h2 class="calc-main__title" id="calcMainT">${escapeHTML(titulo)}</h2>
        <p class="calc-main__sub">${escapeHTML(sub)}</p>
      </div>
      <div class="calc-main__tools">
        ${seg}
        ${btn({ label: t("calc.btnCsvCorto"), icon: "download", variant: "ghost", size: "sm", act: "calcExportExcel", title: t("calc.btnDescargarCsv2") })}
        ${btn({ label: t("calc.btnResetEdits2"), icon: "refresh", variant: "ghost", size: "sm", act: "calcResetEdits" })}
      </div>
    </div>
    ${leyenda}
    <div id="calcDist">${vista === "fleet" ? _calcSec4b_fleet(m.aggLast3) : _calcSec4_distribucion(m.aggLast1, m.distTot1, m.lastMonth)}</div>
    ${_calcReferencia(m)}`;
}

// ── Distribución de metas AGREGADOR (editable) ────────────────────────────────
// Ventana: último mes (misma que la representación → el % que ves reparte).
// Fleet SÍ se reparte (denominador = todos) y cuenta en el cuadre; queda solo el
// badge Fleet. Los partners sin actividad Taxi el último mes se marcan "Fijar a mano".
//
// Una celda tecleada MANDA sobre el reparto (_calcGoalFor) y NO redistribuye el
// resto: por eso se tiñe ("fijado a mano") y el cuadre del panel avisa si la
// suma deja de cerrar. Eso es la matemática de siempre; la pantalla solo lo dice.
const _CALC_KPI_LBL = { ad: "AD", sh: "SH", nr: "N+R" };
// Rótulo de la porción TukTuk (sub-línea bajo cada meta, totales y nota).
// "TukTuk" es nombre de producto: igual en los tres idiomas. Sin ícono a
// propósito: con él la sub-línea pasa el ancho del campo y la tabla desborda.
const _CALC_TK_TAG = `<span class="calc-tk-tag">TukTuk</span>`;

// Punto de color del partner: paleta categórica por hash del nombre (nunca el
// rojo de marca), estable entre repintados.
function _calcDot(p) {
  let h = 0;
  for (const ch of String(p)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `<span class="calc-dot" style="background:var(--cat-${(Math.abs(h) % 9) + 1})" aria-hidden="true"></span>`;
}

// "+16.9%" (verde si la meta sube, rojo si baja) o "—" sin base.
export function _calcCambioHTML(meta, base) {
  const v = variacionPct(+meta || 0, +base || 0);
  if (v == null) return `<span class="calc-cell-muted">—</span>`;
  return `<span class="calc-cambio calc-tone--${v >= 0 ? "ok" : "bad"}">${textoVariacion(v)}</span>`;
}

function _calcEstadoFila(partner, city) {
  const est = {};
  _CALC_K3.forEach(k => {
    const key = `${partner}|||${city}|||${k}`;
    est[k] = estadoCelda(CALC_STATE.edits[key], CALC_STATE.saved[key]);
  });
  est.fija = _CALC_K3.some(k => est[k].fijada);
  return est;
}

// Etiquetas de la fila: Fleet, "Fijar a mano" (sin actividad), "Ya tiene meta"
// y "Soltar" si alguna celda está fijada a mano.
function _calcTagsFila(e, b, fija) {
  const tags = [];
  if (b.fleet) tags.push(badge("Fleet", "neutral", { icon: "car" }));
  if (b.noAct) tags.push(`<span title="${escapeHTML(t("calc.fijarManualTip"))}">${badge(t("calc.badgeFijar"), "warn")}</span>`);
  // "Ya tiene meta": este partner-ciudad ya tiene metas cargadas en BD para el
  // mes objetivo. Antes no había forma de saberlo sin ir a la pestaña Metas.
  if (_calcFilaGuardada(e.partner, e.city)) tags.push(`<span title="${escapeHTML(t("calc.yaTieneMetaTip"))}">${badge(t("calc.badgeTieneMeta"), "info")}</span>`);
  if (fija) tags.push(`<button type="button" class="ui-link-btn calc-soltar" data-act="calcSoltarFila" data-pk="${escapeHTML(e.partner)}" data-city="${escapeHTML(e.city)}" title="${escapeHTML(t("calc.soltarTip"))}">${escapeHTML(t("calc.soltar"))}</button>`);
  return tags.join("");
}

// El campo muestra la meta con miles; la huella de números (shared/huella.ts)
// lee la cifra CRUDA del <span hidden> de al lado — el mismo valor que antes
// llevaba el value del <input type="number">, así la huella no cambia.
function _calcInputMeta(partner, city, metric, base, est) {
  const k = `${partner}|||${city}|||${metric}`;
  const val = CALC_STATE.edits[k] !== undefined ? +CALC_STATE.edits[k] : Math.round(base);
  // Ámbar = distinto de lo guardado: se sobrescribe al guardar.
  const sv  = CALC_STATE.saved[k];
  const cls = est.sobrescribe ? " calc-inp-dirty" : "";
  const ttl = sv !== undefined
    ? ` title="${escapeHTML(t("calc.guardadoEnBD", { v: fmt(+sv) }))}"`
    : "";
  const aria = `${t("calc.col.kpiMeta", { k: _CALC_KPI_LBL[metric] })} · ${partner} · ${cityLabel(city)}`;
  return `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
      value="${escapeHTML(_calcFmtIn(val))}" data-raw="${escapeHTML(String(val))}"${ttl} aria-label="${escapeHTML(aria)}"
      data-pk="${escapeHTML(partner)}" data-city="${escapeHTML(city)}" data-metric="${metric}"
      data-act-change="calcOnGoalEdit" data-act-focus="calcNumFocus" data-act-blur="calcNumBlur" data-act-keydown="calcNumKeydown"
      class="ui-input ui-input--sm calc-num calc-num--cell${cls}"/><span hidden${dn("calc.dist", metric, `${partner}@${city}`)}>${escapeHTML(String(val))}</span>`;
}

export function _calcSec4_distribucion(agg, distTotals, monthLabel) {
  const g = CALC_STATE.kamGoals;
  const items = ordenarUnidades([...agg.values()]);

  let sumAD = 0, sumSH = 0, sumNR = 0, nManual = 0, baseAD = 0;
  // El reparto se calcula sobre `agg` (la cartera COMPLETA), no sobre `items`
  // (que viene ordenado para la tabla): los pozos y los pesos tienen que salir
  // del universo entero o las cuotas no suman la meta.
  const reparto = _calcRepartoDe(agg, g);
  const tkTot = { ad: 0, sh: 0, nr: 0 };
  const rowsHtml = items.map(e => {
    const b = _calcAggMetaBases(e, g, distTotals, reparto);
    const ad = _calcGoalFor(e.partner, e.city, "ad", b.ad);
    const sh = _calcGoalFor(e.partner, e.city, "sh", b.sh);
    const nrg = _calcGoalFor(e.partner, e.city, "nr", b.nr);
    sumAD += ad; sumSH += sh; sumNR += nrg; baseAD += e.ad;
    if (b.noAct) nManual++;
    const est = _calcEstadoFila(e.partner, e.city);
    const ent = `${e.partner}@${e.city}`;
    // Cuánto de esta meta es TukTuk. Es EL número que el KAM carga en el Loyalty
    // Program de ese partner. Solo con % declarado y en las unidades que tienen
    // porción TukTuk — en las demás sería ruido.
    const tkSub = k => (reparto && b[k + "Tk"] > 0)
      ? `<div class="calc-tk-sub" title="${escapeHTML(t("calc.tkDeEsta"))}">${_CALC_TK_TAG}` +
        `<span class="ui-num"${dn("calc.dist", k + "Tk", ent)}>${escapeHTML(fmt(Math.round(b[k + "Tk"])))}</span></div>`
      : "";
    if (reparto) _CALC_K3.forEach(k => { if (b[k + "Tk"] > 0) tkTot[k] += Math.round(b[k + "Tk"]); });
    const celda = (k, base) => `<td class="ui-num calc-cell-input${est[k].fijada ? " calc-cell--fija" : ""}">${_calcInputMeta(e.partner, e.city, k, base, est[k])}${tkSub(k)}</td>`;
    const cls = [b.noAct ? "calc-row--manual" : "", est.fija ? "calc-row--fija" : ""].filter(Boolean).join(" ");
    return `
      <tr${cls ? ` class="${cls}"` : ""}>
        <td class="calc-cell-partner"><div class="calc-partner"><span class="calc-partner__name">${_calcDot(e.partner)}<span>${escapeHTML(e.partner)}</span></span><span class="calc-partner__tags">${_calcTagsFila(e, b, est.fija)}</span></div></td>
        <td class="calc-cell-city">${escapeHTML(cityLabel(e.city))}</td>
        ${celda("ad", b.ad)}
        <td class="ui-num calc-cell-muted"${dn("calc.dist.realAd", ent)}>${fmt(e.ad)}</td>
        <td class="ui-num calc-cell-cambio">${_calcCambioHTML(ad, e.ad)}</td>
        ${celda("sh", b.sh)}
        ${celda("nr", b.nr)}
      </tr>`;
  }).join("");

  const noGoals = !(+g.ad || +g.sh || +g.nr);
  const hint = noGoals
    ? alertBox({ tone: "info", text: t("calc.hintSinMetas3") })
    : (nManual ? alertBox({ tone: "warn", text: t("calc.hintManual2", { n: nManual }) }) : "");
  const mesCorto = /^\d{4}-\d{2}$/.test(monthLabel || "") ? mesNombre(+monthLabel.slice(5, 7) - 1, getLang(), { corto: true }) : "";
  const totalLbl = CALC_STATE.kam === "all" ? t("calc.totalGeneral") : t("calc.totalDe", { kam: kamLabel(CALC_STATE.kam) });
  // Totales de la porción TukTuk bajo cada total (misma suma que el cuadre).
  const tkTotSub = k => reparto
    ? `<div class="calc-tk-sub">${_CALC_TK_TAG}<span class="ui-num"${dn("calc.dist.total", k + "Tk")}>${fmt(tkTot[k])}</span></div>`
    : "";
  // Qué es la sub-línea: una sola vez, arriba de la tabla (solo con % declarado).
  const tkNota = reparto
    ? `<p class="calc-tk-nota">${_CALC_TK_TAG}<span>${escapeHTML(t("calc.tk.notaTabla"))}</span></p>`
    : "";

  return `
    ${hint}
    ${tkNota}
    <div class="ui-table-wrap ui-table-wrap--scroll calc-dist-wrap">
      <table class="ui-table ui-table--sticky-first calc-dist">
        <caption class="ui-sr-only">${escapeHTML(t("calc.distribPartner", { m: _calcMesTxt(monthLabel || "") }))}</caption>
        <thead>
          <tr>
            <th scope="col">${escapeHTML(t("calc.col.partner"))}</th><th scope="col">${escapeHTML(t("calc.col.ciudad"))}</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.col.metaKpi", { k: "AD" }))}</th>
            <th scope="col" class="ui-num" title="${escapeHTML(t("calc.valorReal"))}">${escapeHTML(t("calc.col.real", { m: mesCorto }))}</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.col.cambio"))}</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.col.metaKpi", { k: "SH" }))}</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.col.metaKpi", { k: "N+R" }))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="7" class="calc-empty-cell">${escapeHTML(t("calc.sinDatos"))}</td></tr>`}</tbody>
        <tfoot>
          <tr class="calc-total-row">
            <th scope="row">${escapeHTML(totalLbl)}</th><td></td>
            <td class="ui-num"><span id="calcAggSumAD"${dn("calc.dist.total.ad")}>${fmt(sumAD)}</span>${tkTotSub("ad")}</td>
            <td class="ui-num"${dn("calc.dist.total.realAd")}>${fmt(baseAD)}</td>
            <td class="ui-num" id="calcAggCambioAD">${_calcCambioHTML(sumAD, baseAD)}</td>
            <td class="ui-num"><span id="calcAggSumSH"${dn("calc.dist.total.sh")}>${fmt(sumSH)}</span>${tkTotSub("sh")}</td>
            <td class="ui-num"><span id="calcAggSumNR"${dn("calc.dist.total.nr")}>${fmt(sumNR)}</span>${tkTotSub("nr")}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

// Actualiza EN EL LUGAR la fila de una celda recién editada (tinte, "Soltar",
// cambio vs el mes base). No se repinta la fila: el `change` corre mientras el
// foco todavía está en ese campo y rehacerla lo tiraría (Tab a la celda de al
// lado incluida).
function _calcActualizarFila(input) {
  const tr = input.closest("tr");
  if (!tr) return;
  const partner = input.dataset.pk, city = input.dataset.city;
  const est = _calcEstadoFila(partner, city);
  tr.classList.toggle("calc-row--fija", est.fija);
  tr.querySelectorAll("input[data-metric]").forEach(inp => {
    const k = inp.dataset.metric;
    if (!est[k]) return;
    inp.classList.toggle("calc-inp-dirty", est[k].sobrescribe);
    const td = inp.closest("td");
    if (td) td.classList.toggle("calc-cell--fija", est[k].fijada);
  });
  const m = _calcComputeModel();
  const e = m.aggLast1.get(`${partner}|||${city}`);
  if (!e) return;
  const b = _calcAggMetaBases(e, CALC_STATE.kamGoals, m.distTot1, _calcRepartoDe(m.aggLast1, CALC_STATE.kamGoals));
  const tags = tr.querySelector(".calc-partner__tags");
  if (tags) tags.innerHTML = _calcTagsFila(e, b, est.fija);
  const cam = tr.querySelector(".calc-cell-cambio");
  if (cam) cam.innerHTML = _calcCambioHTML(_calcGoalFor(partner, city, "ad", b.ad), e.ad);
}

// Compara la suma distribuida vs la meta KAM y devuelve el cuadre: la meta y
// debajo "Cuadra" (verde) o la diferencia (ámbar si sobra, rojo si falta).
// Misma tolerancia que _calcMetricCuadre. Hoy solo alimenta la huella de
// números (panel de cuadre, <span hidden>).
export function _calcCuadre(sum, target) {
  if (!target) return `<span class="calc-cell-muted">${escapeHTML(t("calc.sinMeta"))}</span>`;
  const gap = sum - target;
  const ok = Math.abs(gap) <= Math.max(1, target * 0.005);
  const tone = ok ? "ok" : (gap > 0 ? "warn" : "bad");
  const tag = ok
    ? `${icon("check", { size: 12, strokeWidth: 2.5 })}${escapeHTML(t("calc.cuadraCorto"))}`
    : (gap > 0 ? `+${fmt(gap)}` : `${fmt(gap)}`);
  return `<div class="calc-cuadre-cell"><span class="calc-cuadre-cell__meta">${fmt(target)}</span><span class="calc-cuadre-cell__tag calc-tone--${tone}">${tag}</span></div>`;
}

// ── KPIs Fleet (vista "Fleet", solo si el KAM tiene partners Fleet) ───────────
// Metas manuales por partner-ciudad para partners fleet. NO se distribuyen ni van
// al CSV; si se llenan, aparecen en la tarjeta compartible.
// Utilización pre-llenada en 85 (borrable) — la meta estándar.
export function _calcSec4b_fleet(agg) {
  const items = [...agg.values()]
    .filter(e => _calcIsFleet(e.partner))
    .sort((a, b) => a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const _inp = (partner, city, metric, ph, aria) => {
    const k = `${partner}|||${city}|||${metric}`;
    const val = CALC_STATE.edits[k] !== undefined ? CALC_STATE.edits[k] : "";
    return `<input type="number" step="0.1" min="0" value="${escapeHTML(String(val))}" placeholder="${escapeHTML(ph)}"
      aria-label="${escapeHTML(`${aria} · ${partner} · ${cityLabel(city)}`)}"
      data-pk="${escapeHTML(partner)}" data-city="${escapeHTML(city)}" data-metric="${metric}"
      data-act-change="calcOnGoalEdit"
      class="ui-input ui-input--sm calc-num calc-num--cell calc-num--fleet"/>`;
  };

  const rowsHtml = items.map(e => {
    const ref = _calcFleetRef(e);
    return `
      <tr>
        <td class="calc-cell-partner"><div class="calc-partner"><span class="calc-partner__name">${_calcDot(e.partner)}<span>${escapeHTML(e.partner)}</span></span><span class="calc-partner__tags">${badge("Fleet", "neutral", { icon: "car" })}</span></div></td>
        <td class="calc-cell-city">${escapeHTML(cityLabel(e.city))}</td>
        <td class="ui-num calc-cell-muted">${ref.shcar == null ? "—" : ref.shcar.toFixed(1)}</td>
        <td class="ui-num calc-cell-input">${_inp(e.partner, e.city, "shcar", t("calc.phMeta"), t("calc.metaShAuto"))}</td>
        <td class="ui-num calc-cell-muted">${ref.accept == null ? "—" : ref.accept.toFixed(1) + "%"}</td>
        <td class="ui-num calc-cell-input">${_inp(e.partner, e.city, "accept", t("calc.phMetaPct"), t("calc.metaAceptPct"))}</td>
        <td class="ui-num calc-cell-input">${_inp(e.partner, e.city, "util", "85", t("calc.metaUtilPct"))}</td>
      </tr>`;
  }).join("");

  return `
    <div class="ui-table-wrap ui-table-wrap--scroll calc-dist-wrap">
      <table class="ui-table ui-table--sticky-first calc-fleet">
        <thead>
          <tr>
            <th scope="col">${escapeHTML(t("calc.col.partner"))}</th><th scope="col">${escapeHTML(t("calc.col.ciudad"))}</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.shAuto3m"))}</th><th scope="col" class="ui-num">${escapeHTML(t("calc.metaShAuto"))}</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.aceptacion3m"))}</th><th scope="col" class="ui-num">${escapeHTML(t("calc.metaAceptPct"))}</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.metaUtilPct"))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="7" class="calc-empty-cell">${escapeHTML(t("calc.sinFleet"))}</td></tr>`}</tbody>
      </table>
    </div>
    <p class="calc-help">${escapeHTML(t("calc.utilPrellenada3"))}</p>`;
}

// ── REFERENCIA (plegada) ─────────────────────────────────────────────────────
// % de ciudad y de cartera del mes base + promedio de 3 meses. Nada de esto
// reparte: está para contrastar. El % de cartera es el peso con el que se
// reparte (antes eran tres columnas de la tabla de reparto).
export function _calcReferencia(m) {
  const kamTxt = CALC_STATE.kam === "all" ? t("calc.todosKam") : kamLabel(CALC_STATE.kam);
  return `
    <details class="calc-details calc-ref" id="calcRef"${CALC_STATE.refOpen ? " open" : ""}>
      <summary>${escapeHTML(t("calc.verReferencia"))}</summary>
      <div class="calc-details__body">
        <h3 class="calc-sub__title">${escapeHTML(t("calc.refPct", { m: _calcMesTxt(m.lastMonth || "") }))}</h3>
        <p class="calc-help">${escapeHTML(t("calc.pesoLeyenda"))}</p>
        ${_calcPctTableHTML(m.aggLast1, m.cartTot1, m.cityTot1, CALC_TAXI_METRICS)}
        <h3 class="calc-sub__title">${escapeHTML(t("calc.ref3m", { n: m.aggLast3.size, k: kamTxt }))}</h3>
        ${_calcTabla3m(m.aggLast3, m.last3)}
      </div>
    </details>`;
}

// Por métrica: Valor (número real del último mes) + % Ciudad (val ÷ total de la
// ciudad, TODOS los partners → "peso de Yego en Lima", exacto) + % Cartera
// (val ÷ total del KAM = base del reparto, suma 100%).
// Sin semáforo a propósito: un peso chico no es "malo", es un partner chico.
const _CALC_PCT_NUM = { ad: "pctAd", sh: "pctSh", nr: "pctNr" };
export function _calcPctTableHTML(agg, cartTotals, cityTotals, M) {
  const items = [...agg.values()].sort((a, b) =>
    a.partner.localeCompare(b.partner) || a.city.localeCompare(b.city));

  const _fmtV = key => (key === "sh" ? fmtSmart : fmt);
  const _valCell = (val, key) => `<td class="ui-num calc-cell-strong">${_fmtV(key)(val)}</td>`;
  const _pctCell = (val, tot) => {
    if (!tot) return `<td class="ui-num calc-cell-muted">—</td>`;
    return `<td class="ui-num">${((val / tot) * 100).toFixed(1)}%</td>`;
  };
  // % Cartera = el peso con el que se reparte. Lleva la clave de huella que
  // antes tenía la columna "% AD/SH/N+R" de la tabla de reparto, con el MISMO
  // formato (sin actividad el último mes → "—", no 0.0%).
  const _carteraCell = (val, tot, noAct, numKey) => noAct
    ? `<td class="ui-num calc-cell-warn"${dn(numKey)}>—</td>`
    : `<td class="ui-num"${dn(numKey)}>${tot > 0 ? ((val / tot) * 100).toFixed(1) + "%" : "—"}</td>`;

  const rowsHtml = items.map(e => {
    const ct = cityTotals.get(e.city) || {};
    const noAct = (e.ad + e.sh + (e.np + e.ns + e.re)) === 0;
    const cells = M.map(mtr => {
      const v = mtr.get(e);
      return _valCell(v, mtr.key) + _pctCell(v, ct[mtr.key]) +
        _carteraCell(v, cartTotals[mtr.key], noAct, `calc.dist.${_CALC_PCT_NUM[mtr.key]}.${e.partner}@${e.city}`);
    }).join("");
    return `
      <tr>
        <td class="calc-cell-partner">${escapeHTML(e.partner)}</td>
        <td class="calc-cell-city">${escapeHTML(cityLabel(e.city))}</td>
        ${cells}
      </tr>`;
  }).join("");

  const topHead = M.map(mtr => `<th scope="colgroup" class="ui-num calc-th-group" colspan="3">${escapeHTML(mtr.label)}</th>`).join("");
  const subHead = M.map(() =>
    `<th scope="col" class="ui-num" title="${escapeHTML(t("calc.valorReal"))}">${escapeHTML(t("calc.col.valor"))}</th>` +
    `<th scope="col" class="ui-num" title="${escapeHTML(t("calc.pesoCiudad"))}">${escapeHTML(t("calc.col.pctCiudad"))}</th>` +
    `<th scope="col" class="ui-num" title="${escapeHTML(t("calc.pesoCartera"))}">${escapeHTML(t("calc.col.pctCartera"))}</th>`).join("");
  const footCells = M.map(mtr => `<td class="ui-num">${_fmtV(mtr.key)(cartTotals[mtr.key] || 0)}</td><td class="ui-num calc-cell-muted">—</td><td class="ui-num">100%</td>`).join("");
  const nCols = 2 + M.length * 3;

  return `
    <div class="ui-table-wrap ui-table-wrap--scroll">
      <table class="ui-table calc-ref-table calc-ref-table--pct">
        <thead>
          <tr><th scope="col" rowspan="2">${escapeHTML(t("calc.col.partner"))}</th><th scope="col" rowspan="2">${escapeHTML(t("calc.col.ciudad"))}</th>${topHead}</tr>
          <tr class="calc-thead-sub">${subHead}</tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="${nCols}" class="calc-empty-cell">${escapeHTML(t("estado.sinDatos"))}.</td></tr>`}</tbody>
        <tfoot>
          <tr class="calc-total-row"><th scope="row" colspan="2">${escapeHTML(t("calc.totalCartera"))}</th>${footCells}</tr>
        </tfoot>
      </table>
    </div>`;
}

// Promedio de los 3 últimos meses (referencia, no reparte).
export function _calcTabla3m(agg, months) {
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
      <td class="calc-cell-partner">${escapeHTML(e.partner)}</td>
      <td class="calc-cell-city">${escapeHTML(cityLabel(e.city))}</td>
      <td class="ui-num">${fmt(e.trips / n)}</td>
      <td class="ui-num">${fmt(e.sh / n)}</td>
      <td class="ui-num">${fmt(e.ad)}</td>
      <td class="ui-num">${fmt(e.np / n)}</td>
      <td class="ui-num">${fmt(e.ns / n)}</td>
      <td class="ui-num">${fmt(e.re / n)}</td>
    </tr>`).join("");

  return `
    <div class="ui-table-wrap ui-table-wrap--scroll">
      <table class="ui-table ui-table--sticky-first calc-ref-table">
        <thead>
          <tr>
            <th scope="col">${escapeHTML(t("calc.col.partner"))}</th><th scope="col">${escapeHTML(t("calc.col.ciudad"))}</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.col.viajes"))}</th><th scope="col" class="ui-num">SH</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.col.adMax"))}</th><th scope="col" class="ui-num">${escapeHTML(t("calc.col.newPartner"))}</th>
            <th scope="col" class="ui-num">${escapeHTML(t("calc.col.newYango"))}</th><th scope="col" class="ui-num">${escapeHTML(t("calc.col.reactivados"))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="8" class="calc-empty-cell">${escapeHTML(t("calc.sinDatos"))}</td></tr>`}</tbody>
        <tfoot>
          <tr class="calc-total-row">
            <th scope="row" colspan="2">${escapeHTML(CALC_STATE.kam === "all" ? t("calc.totalGeneral") : t("calc.totalKam"))}</th>
            <td class="ui-num">${fmt(tot.trips)}</td>
            <td class="ui-num">${fmt(tot.sh)}</td>
            <td class="ui-num">${fmt(tot.ad)}</td>
            <td class="ui-num">${fmt(tot.np)}</td>
            <td class="ui-num">${fmt(tot.ns)}</td>
            <td class="ui-num">${fmt(tot.re)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

// ¿Cuántas filas del mes objetivo, de la cartera en pantalla, tienen desglose
// TukTuk (meta_tk_ad/_nr/_sh) guardado? Solo alimenta el aviso del hueco
// conocido de "Solo lo que cambié" (ver _calcAvisoHuecoTk); no decide nada.
export function _calcFilasConDesgloseTk(m) {
  const { name, year } = _calcNextMonthName(m.lastMonth || "");
  const enPantalla = new Set([...m.aggLast1.values()].map(e => `${e.partner}|||${e.city}`));
  return (STATE.metasData || []).filter(x =>
    x.mes === name && (year == null || x.mYear == null || x.mYear === year) &&
    enPantalla.has(`${x.partner}|||${x.city}`) &&
    (x.mtkAD != null || x.mtkNR != null || x.mtkSH != null)).length;
}

// HUECO CONOCIDO (CLAUDE.md, "Aviso antes de borrar o reescribir el desglose
// TukTuk"): en "Solo lo que cambié", volver el % a 0 SIN tocar ninguna celda no
// genera filas → el desglose viejo queda en la base. Ese modo no puede
// expresarlo sin romper "solo lo que tecleaste", así que no se cambia el
// guardado: se AVISA en pantalla que para limpiarlo hace falta "Reparto completo".
export function _calcAvisoHuecoTk(m) {
  if (CALC_STATE.saveMode !== "edits" || _calcTieneTkPct()) return "";
  const n = _calcFilasConDesgloseTk(m);
  if (!n) return "";
  return alertBox({ tone: "info", title: t("calc.huecoTkTitulo"), text: t("calc.huecoTkTexto", { n }) });
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

// Como _calcContarCambios, pero SIN el 85 de Utilización Fleet auto-sembrado.
//
// POR QUÉ HACE FALTA UNA VERSIÓN DISTINTA. Ese 85 SIEMPRE aparece como "cambio"
// para cualquier KAM con partners Fleet sin utilización guardada — es un
// default reproducible (`_calcRefreshStatus`/renderCalculator lo vuelve a
// sembrar solo con verlo), no algo que el usuario tecleó. Contarlo en el badge
// "cuadre en vivo" y al guardar es CORRECTO (para eso existe: "que el 85
// visible en la tarjeta llegue al guardado"). Pero para decidir si avisar antes
// de cambiar de KAM es un falso positivo: se detectó probando el flujo real —
// entrar como un KAM con Fleet, sin tocar nada, disparaba el aviso de "vas a
// perder tu progreso" por un valor que ni siquiera se veía en pantalla.
export function _calcContarCambiosReales() {
  let n = 0;
  Object.keys(CALC_STATE.edits).forEach(k => {
    if (CALC_STATE._utilSeeded[k]) return;
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

// ── Vista compartible: i18n ES/EN/RU + crecimiento vs último mes ──────────────
// Meses: tabla única de core/meses.ts. El ruso nunca se combina con otro idioma
// (ver CALC_EXPORT_STR); "es-en" une con " / " solo si los nombres difieren.
export function _calcMonthLabel(iso, lang) {
  if (!iso || !/^\d{4}-\d{2}$/.test(iso)) return "";
  const [y, mm] = iso.split("-").map(Number);
  if (mm < 1 || mm > 12) return "";
  if (lang === "es" || lang === "en" || lang === "ru") return `${mesNombre(mm - 1, lang)} ${y}`;
  const es = mesNombre(mm - 1, "es"), en = mesNombre(mm - 1, "en");
  return es === en ? `${es} ${y}` : `${es} ${y} / ${en} ${y}`;
}

// Etiquetas de la tarjeta. lang: "es" | "en" | "ru" | "es-en" (bilingüe → une
// con " / "; el ruso nunca se combina, siempre va solo — mezclar cirílico con
// otro alfabeto en la misma línea es ilegible, a diferencia de ES/EN que
// comparten alfabeto).
// Solo las frases PROPIAS de la tarjeta. Los nombres de KPI y "Ciudad" salen de
// core/i18nExport (EXPORT_STR), los mismos del deck: antes la tarjeta decía
// "Active Drivers" en español y el deck "Conductores Activos" para la misma
// métrica, en dos documentos que recibe el mismo partner.
export const CALC_EXPORT_STR = {
  proposal:    { es: "Metas Yango — Propuesta", en: "Yango Goals — Proposal", ru: "Цели Yango — Предложение" },
  // Los tres títulos de bloque comparten estructura ("Meta <línea>") a propósito:
  // son lo primero que el partner lee de cada tabla, y tienen que dejar clara la
  // línea de negocio ANTES de cualquier número — es la razón de ser de este pedido
  // (separar Taxi/TukTuk/Fleet en vez de un combinado que hay que desarmar a mano).
  taxiTitle:   { es: "Meta Taxi", en: "Taxi Goal", ru: "Цель Такси" },
  tuktukTitle: { es: "Meta TukTuk", en: "TukTuk Goal", ru: "Цель TukTuk" },
  // Combinado sigue existiendo para el KAM que TODAVÍA no declaró el % de PnL
  // (ver splitActivo en _calcSec5_exportPartner) — sin split no hay de dónde
  // sacar dos números fieles, así que se mantiene el título que ya tenía.
  combinedTitle: { es: "Meta Taxi + TukTuk", en: "Taxi + TukTuk Goal", ru: "Цель Такси + TukTuk" },
  fleetKpi:    { es: "Meta Fleet · KPIs de calidad", en: "Fleet Goal · quality KPIs", ru: "Цель Fleet · KPI качества" },
  newBadge:    { es: "nuevo", en: "new", ru: "новое" },
  generated:   { es: "Propuesta generada", en: "Proposal generated", ru: "Предложение создано" },
  noData:      { es: "Sin datos para este partner.", en: "No data for this partner.", ru: "Нет данных по этому партнёру." },
  goalVsLast:  { es: "Meta vs último mes", en: "Goal vs last month", ru: "Цель vs прошлый месяц" },
  legendGoal:  { es: "Número grande = meta propuesta", en: "Large number = proposed goal", ru: "Крупное число = предложенная цель" },
  legendLast:  { es: "debajo = resultado del último mes y crecimiento pedido",
                 en: "below = last month result and requested growth",
                 ru: "ниже = результат прошлого месяца и запрошенный рост" }
};
// Claves de la tarjeta que resuelven a una etiqueta compartida de EXPORT_STR.
const _CALC_LAB_COMPARTIDA = {
  city: "ciudad", ad: "kpi.ad", sh: "kpi.sh", nr: "kpi.nrCorto", cars: "kpi.cars",
  shcar: "kpi.shcar", accept: "kpi.accept", util: "kpi.util"
};
// lang: "es" | "en" | "ru" | "es-en" (bilingüe → une con " / "; el ruso nunca
// se combina, siempre va solo — mezclar cirílico con otro alfabeto en la misma
// línea es ilegible, a diferencia de ES/EN que comparten alfabeto).
export function _calcLab(key, lang) {
  const s = CALC_EXPORT_STR[key] || EXPORT_STR[_CALC_LAB_COMPARTIDA[key]];
  if (!s) return key;
  if (lang === "es" || lang === "en" || lang === "ru") return pick(s, lang);
  const es = pick(s, "es"), en = pick(s, "en");
  return es === en ? es : `${es} / ${en}`;
}
// Idioma de los NÚMEROS de la tarjeta: la bilingüe ES/EN usa el formato de
// siempre (es-PE); en/ru, el suyo ("2 415" y "12,5" en ruso).
export function _calcNumLang(lang) { return exportLang(lang); }

// Celda de tabla: meta (número grande) + resultado del último mes y % de crecimiento
// pedido (verde si sube, rojo si baja, gris si es mantener). actual = valor real del
// último mes (aggLast1 ya viene por mes). Sin baseline (actual<=0) → "nuevo/new".
export function _calcGoalCell(goal, actual, fmtFn, lang) {
  // Sin meta (goal<=0, p.ej. el KAM aún no ingresó su objetivo): no inventamos un
  // "-100%"; mostramos "—" y el valor del último mes como referencia.
  if (!(goal > 0)) {
    const ref = actual > 0
      ? `<div class="calc-card__last">${fmtFn(actual)}</div>`
      : "";
    return `<td class="calc-card__cell"><div class="calc-card__goal calc-card__goal--none">—</div>${ref}</td>`;
  }
  const big = `<div class="calc-card__goal">${fmtFn(goal)}</div>`;
  let sub;
  if (actual > 0) {
    const pct  = ((goal - actual) / actual) * 100;
    const sign = pct >= 0 ? "+" : "";
    const dir  = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
    const pctT = `${sign}${pct.toLocaleString(localeDe(_calcNumLang(lang)), { maximumFractionDigits: 0 })}%`;
    sub = `<div class="calc-card__last">${fmtFn(actual)} <span class="calc-card__delta calc-card__delta--${dir}">${pctT}</span></div>`;
  } else {
    sub = `<div class="calc-card__new">${_calcLab("newBadge", lang)}</div>`;
  }
  return `<td class="calc-card__cell">${big}${sub}</td>`;
}

// Leyenda del formato meta / último mes. Bilingüe → dos líneas (no " / " en frase).
export function _calcExportLegend(lang) {
  const line  = l => `${pick(CALC_EXPORT_STR.legendGoal, l)} · ${pick(CALC_EXPORT_STR.legendLast, l)}`;
  if (lang === "es") return `<div class="calc-card__legend">${line("es")}</div>`;
  if (lang === "en") return `<div class="calc-card__legend">${line("en")}</div>`;
  if (lang === "ru") return `<div class="calc-card__legend">${line("ru")}</div>`;
  return `<div class="calc-card__legend">${line("es")}<br>${line("en")}</div>`;
}

// ── Vista compartible / descarga por partner ("Tarjetas para partners") ─────
// `agg` ya viene con TukTuk adentro (ago 2026): sin % declarado, un partner con
// TukTuk aparece con su volumen combinado; con % declarado, en dos tablas.
//
// Estilo (Ola 6): superficies neutras y tokens; el rojo Yango SOLO en el logo
// (elemento de marca). Cada línea de negocio lleva un filete de la paleta
// categórica — nunca el rojo de marca — y ya no un emoji: los emojis cambian de
// dibujo según el sistema operativo de quien exporta.
export function _calcSec5_exportPartner(agg, totals, lastMonth) {
  const lang = CALC_STATE.exportLang || "es-en";
  const nl = _calcNumLang(lang);
  const fN = v => fmtL(v, nl), fS = v => fmtSmartL(v, nl);
  const ciu = c => escapeHTML(ciudadL(c, nl));
  const g = CALC_STATE.kamGoals;
  const partners = [...new Set([...agg.values()].map(e => e.partner))].sort();
  // El título ("Tarjetas para partners") lo pone el encabezado de la columna
  // derecha (_calcMainHTML); acá solo va qué compara la tarjeta.
  const cabecera = sub => `
    <div class="calc-share">
      <p class="calc-sub__text">${escapeHTML(sub)}</p>`;
  if (!partners.length) {
    return `${cabecera(t("calc.sinPartnersFiltro"))}
      ${emptyState({ icon: "image", title: t("calc.sinPartnersKam") })}
    </div>`;
  }
  const sel = (CALC_STATE.selPartnerExport && partners.includes(CALC_STATE.selPartnerExport))
    ? CALC_STATE.selPartnerExport
    : partners[0];
  CALC_STATE.selPartnerExport = sel;

  const taxiItems = [...agg.values()].filter(e => e.partner === sel);
  // OJO: el reparto se calcula sobre `agg` COMPLETO y no sobre `taxiItems`. Esta
  // tarjeta muestra UN partner, pero su cuota sale de su peso dentro de toda la
  // cartera. Calcularlo sobre el filtro le daría el 100% del pozo a ese partner.
  const repartoExp = _calcRepartoDe(agg, g);

  const editVal = (e, k) => CALC_STATE.edits[`${e.partner}|||${e.city}|||${k}`];
  const _th = c => `<th class="${c.a === "left" ? "is-left" : ""}">${c.h}</th>`;
  const _tabla = (titulo, filas, linea) => `
    <div class="calc-card__block calc-card__block--${linea}">
      <div class="calc-card__title">${titulo}</div>
      <table class="calc-card__table">
        <thead><tr>${[{h:_calcLab("city",lang),a:"left"},{h:_calcLab("ad",lang)},{h:_calcLab("sh",lang)},{h:_calcLab("nr",lang)}].map(_th).join("")}</tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;

  // ¿Hay una porción TukTuk REAL para separar? Solo cuando el KAM declaró el %
  // de PnL (repartoExp !== null, ver _calcRepartoDe): ahí SÍ hay dos números
  // fieles que mostrar. Sin declarar, cualquier separación sería una estimación
  // inventada para la tarjeta que ni siquiera coincide con lo que se guardaría
  // en `meta_tk_*` (NULL sin declarar) — mejor mostrar el combinado de siempre
  // antes que un número que no está respaldado por ningún lado.
  const splitActivo = !!repartoExp;

  let taxiBlock = "", tkBlock = "";
  if (taxiItems.length && !splitActivo) {
    // Sin % declarado: comportamiento histórico, un solo combinado.
    // Desde ago-2026 estas cifras incluyen TukTuk: la etiqueta tiene que
    // decirlo. Esta tarjeta se le manda al partner — si dice "Taxi" y el
    // número trae TukTuk adentro, el partner recibe una meta que no puede
    // reconciliar.
    const rows = taxiItems.map(e => {
      const b = _calcAggMetaBases(e, g, totals, repartoExp);
      const adGoal = _calcGoalFor(e.partner, e.city, "ad", b.ad);
      const shGoal = _calcGoalFor(e.partner, e.city, "sh", b.sh);
      const nrGoal = _calcGoalFor(e.partner, e.city, "nr", b.nr);
      const nr = e.np + e.ns + e.re;
      return `<tr><td class="calc-card__city">${ciu(e.city)}</td>${_calcGoalCell(adGoal, e.ad, fN, lang)}${_calcGoalCell(shGoal, e.sh, fS, lang)}${_calcGoalCell(nrGoal, nr, fN, lang)}</tr>`;
    }).join("");
    taxiBlock = _tabla(_calcLab("combinedTitle", lang), rows, "taxi");
  } else if (taxiItems.length) {
    // Con % declarado: DOS tablas fieles, no una estimación. El goal se separa
    // en la MISMA proporción que calculó el carve-out (repartoLinea.ts) — así
    // si el KAM ajusta a mano el total en la tabla de distribución, la parte
    // TukTuk escala con él en vez de quedar pegada al número de antes del
    // ajuste. El actual (línea de abajo, "resultado del último mes") usa la
    // cifra REAL de cada línea — no una proporción — porque para eso sí hay un
    // dato fiel: cuánto hizo TukTuk el mes pasado se mide, no se estima.
    const filasTaxi = [], filasTk = [];
    taxiItems.forEach(e => {
      const b = _calcAggMetaBases(e, g, totals, repartoExp);
      const adGoal = _calcGoalFor(e.partner, e.city, "ad", b.ad);
      const shGoal = _calcGoalFor(e.partner, e.city, "sh", b.sh);
      const nrGoal = _calcGoalFor(e.partner, e.city, "nr", b.nr);
      const nr = e.np + e.ns + e.re;

      // splitPorFraccion (domain/repartoLinea.ts) redondea el secundario
      // (TukTuk) primero y resta para el principal — nunca al revés, porque
      // redondear los dos lados por separado puede no sumar el total exacto
      // (así se vio, en pantalla, "2.414,64 conductores" en la fila partida).
      const { principal: adTaxiGoal, secundario: adTkGoal } = splitPorFraccion(adGoal, b.ad > 0 ? b.adTk / b.ad : 0);
      const { principal: shTaxiGoal, secundario: shTkGoal } = splitPorFraccion(shGoal, b.sh > 0 ? b.shTk / b.sh : 0);
      const { principal: nrTaxiGoal, secundario: nrTkGoal } = splitPorFraccion(nrGoal, b.nr > 0 ? b.nrTk / b.nr : 0);

      const adTkAct = e.adTk || 0, shTkAct = e.shTk || 0, nrTkAct = e.nrTk || 0;
      const adTaxiAct = e.ad - adTkAct, shTaxiAct = e.sh - shTkAct, nrTaxiAct = nr - nrTkAct;

      // "Si es que tiene": una ciudad 100% TukTuk no aparece en la tabla Taxi
      // (y viceversa) — una fila en 0 no es información, es ruido que el
      // partner tiene que descartar a ojo.
      if (adTaxiGoal > 0 || adTaxiAct > 0 || shTaxiGoal > 0 || shTaxiAct > 0 || nrTaxiGoal > 0 || nrTaxiAct > 0) {
        filasTaxi.push(`<tr><td class="calc-card__city">${ciu(e.city)}</td>${_calcGoalCell(adTaxiGoal, adTaxiAct, fN, lang)}${_calcGoalCell(shTaxiGoal, shTaxiAct, fS, lang)}${_calcGoalCell(nrTaxiGoal, nrTaxiAct, fN, lang)}</tr>`);
      }
      if (adTkGoal > 0 || adTkAct > 0 || shTkGoal > 0 || shTkAct > 0 || nrTkGoal > 0 || nrTkAct > 0) {
        filasTk.push(`<tr><td class="calc-card__city">${ciu(e.city)}</td>${_calcGoalCell(adTkGoal, adTkAct, fN, lang)}${_calcGoalCell(shTkGoal, shTkAct, fS, lang)}${_calcGoalCell(nrTkGoal, nrTkAct, fN, lang)}</tr>`);
      }
    });
    if (filasTaxi.length) taxiBlock = _tabla(_calcLab("taxiTitle", lang), filasTaxi.join(""), "taxi");
    if (filasTk.length)   tkBlock   = _tabla(_calcLab("tuktukTitle", lang), filasTk.join(""), "tuktuk");
  }

  // Bloque Fleet (SH/Auto, Aceptación, Utilización) — SOLO si el partner (o alguna de
  // sus subflotas) está marcado Fleet. Se muestran las 3 KPIs siempre; meta editada
  // resaltada, sin meta "—" (nudge para fijarla), y debajo la referencia del último mes.
  const isFleetCard = taxiItems.some(e => _calcIsFleet(e.partner));
  const FLEET_KPI = [
    { k: "shcar",  fmt: v => fN(v),       ref: e => _calcFleetRef(e).shcar },
    { k: "accept", fmt: v => fN(v) + "%", ref: e => _calcFleetRef(e).accept },
    { k: "util",   fmt: v => fN(v) + "%", ref: () => null }
  ];
  const fleetBlock = (isFleetCard && taxiItems.length) ? (() => {
    const rows = taxiItems.map(e => {
      const cells = FLEET_KPI.map(fd => {
        const ev = editVal(e, fd.k);
        const hasMeta = ev !== undefined && ev !== "";
        const big = `<div class="calc-card__goal${hasMeta ? "" : " calc-card__goal--none"}">${hasMeta ? fd.fmt(+ev) : "—"}</div>`;
        const rv = fd.ref(e);
        const sub = (rv != null && isFinite(rv) && rv > 0)
          ? `<div class="calc-card__last">${fd.fmt(rv)}</div>`
          : "";
        return `<td class="calc-card__cell">${big}${sub}</td>`;
      }).join("");
      return `<tr><td class="calc-card__city">${ciu(e.city)}</td>${cells}</tr>`;
    }).join("");
    const heads = [{h:_calcLab("city",lang),a:"left"},{h:_calcLab("shcar",lang)},{h:_calcLab("accept",lang)},{h:_calcLab("util",lang)}].map(_th).join("");
    return `
      <div class="calc-card__block calc-card__block--fleet">
        <div class="calc-card__title">${_calcLab("fleetKpi",lang)}</div>
        <table class="calc-card__table">
          <thead><tr>${heads}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  })() : "";

  // Bloque TukTuk separado (sep 2026, pedido explícito): vuelve a existir en
  // paralelo al combinado — se muestra UNO u OTRO según `splitActivo`, nunca
  // los dos (ver arriba). "Si es que tiene" aplica a las tres líneas por igual:
  // Fleet ya era condicional (isFleetCard), TukTuk ahora lo es de la misma forma.
  const hasData  = !!(taxiBlock || tkBlock || fleetBlock);
  const refMonth = _calcMonthLabel(lastMonth || "", lang);
  const subLabel = _calcLab("goalVsLast", lang);
  const genDate  = new Date().toLocaleDateString(localeDe(nl));
  // RU no se combina con nada (ver el comentario de CALC_EXPORT_STR): cirílico
  // mezclado con otro alfabeto en la misma línea es ilegible, a diferencia de
  // ES/EN que comparten alfabeto y sí tienen su combo bilingüe de siempre.
  const langSeg = segmented({
    options: [["es", "ES"], ["en", "EN"], ["es-en", "ES/EN"], ["ru", "RU"]].map(([value, label]) => ({ value, label })),
    value: lang, act: "calcSetExportLang", ariaLabel: t("calc.idiomaTarjeta")
  });
  const kamTip = t("calc.descargarTodasTip", { kam: CALC_STATE.kam === "all" ? t("calc.unKamElegilo") : kamLabel(CALC_STATE.kam) });

  return `${cabecera(t("calc.tarjetaSub", { s: subLabel + (refMonth ? " (" + refMonth + ")" : "") }))}
      <div class="calc-share__controls">
        <div class="ui-field calc-combo">
          <label class="ui-field__label" for="calcExportSearch">${escapeHTML(t("calc.col.partner"))}</label>
          <input type="text" id="calcExportSearch" class="ui-input" placeholder="${escapeHTML(t("calc.buscarPartner"))}" autocomplete="off"
            value="${escapeHTML(sel)}" role="combobox" aria-autocomplete="list" aria-controls="calcExportList" aria-expanded="false"
            data-act-input="calcFilterExportPartners"
            data-act-focus="calcShowExportList"
            data-act-blur="calcHideExportListDelayed"
            data-act-keydown="calcExportKeydown"/>
          <div id="calcExportList" class="calc-combo__list" role="listbox"></div>
        </div>
        <div class="ui-field">
          <span class="ui-field__label">${escapeHTML(t("calc.idiomaTarjeta"))}</span>
          ${langSeg}
        </div>
        <div class="calc-share__btns">
          ${btn({ label: t("calc.descargarImagen2"), icon: "image", act: "calcDownloadPartnerImage" })}
          ${btn({ label: t("calc.descargarTodas2", { n: partners.length }), icon: "download", act: "calcDownloadAllPartnerImages", title: kamTip })}
        </div>
      </div>

      <div class="calc-card-wrap">
        <div id="calcExportCard" class="calc-card">
          <div class="calc-card__head">
            <div class="calc-card__logo">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="20" height="20" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
            <div class="calc-card__who">
              <div class="calc-card__eyebrow">${_calcLab("proposal", lang)}</div>
              <div class="calc-card__partner">${escapeHTML(sel)}</div>
            </div>
          </div>
          ${taxiBlock}${tkBlock}${fleetBlock}
          ${hasData ? _calcExportLegend(lang) : `<div class="calc-card__nodata">${_calcLab("noData", lang)}</div>`}
          <div class="calc-card__foot">
            ${_calcLab("generated", lang)}: ${genDate}
          </div>
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

// ¿Hay algo en pantalla que se perdería si el KAM cambia ahora? La REGLA vive
// en domain/calcDraft.ts (con tests); acá solo se le pasan los tres datos que
// necesita de CALC_STATE.
export function _calcTieneProgresoSinGuardar() {
  return hayProgresoSinGuardar(CALC_STATE.kamGoals, CALC_STATE.tkPct, _calcContarCambiosReales());
}

// Empezar de cero con el perfil del otro KAM (pedido explícito de Manuel, sep
// 2026): todo lo que es volátil de la SESIÓN se limpia. Lo que ya está en BD no
// se toca —_calcSeedGuardadas lo vuelve a traer para el KAM nuevo apenas
// savedKey se invalida— así que nada de esto borra una meta ya guardada.
export function _calcResetParaNuevoKam() {
  CALC_STATE.kamGoals  = { ad: 0, sh: 0, nr: 0, otherProj: 0, fleetA2: 0 };
  CALC_STATE.tkPct     = { ad: 0, sh: 0, nr: 0 };
  CALC_STATE.edits     = {};
  CALC_STATE._utilSeeded = {};
  CALC_STATE.saved     = {};
  CALC_STATE.savedKey  = "";     // fuerza a _calcSeedGuardadas a releer la BD del KAM nuevo
  CALC_STATE.selPartnerExport = null;
  CALC_STATE.tkOpen = null;
  CALC_STATE._tkOpenReset = true;
  _calcBorrarDraft();
}

// ── DIÁLOGOS EN LA PÁGINA (Ola 6) ────────────────────────────────────────────
// Reemplazan los confirm()/alert() nativos con la MISMA decisión: confirmar
// sigue adelante; cancelar, Esc o clic afuera = no pasa nada. Todos se esperan
// (await) antes de seguir.
function _calcAviso(titulo, cuerpo, tone) {
  return alertDialog({ title: titulo, body: cuerpo, tone: tone || "info" });
}
// Diálogo con una LISTA larga (filas que se borran/reescriben, ceros): el
// cuerpo se desplaza por dentro y los botones quedan siempre a la vista.
// confirmDialog agrega el velo al final de <body> de forma síncrona, así que
// el último hijo de <body> es el diálogo recién abierto.
function _calcConLista(p) {
  const bd = document.body.lastElementChild;
  if (bd && bd.classList.contains("ui-dialog-backdrop")) bd.classList.add("calc-dlg-lista");
  return p;
}

export async function calcOnKamChange(v) {
  if (v === CALC_STATE.kam) return;
  if (_calcTieneProgresoSinGuardar()) {
    const ok = await confirmDialog({
      title: t("calc.dlg.cambioKamTitulo"), body: t("calc.confirmCambioKam"),
      confirmLabel: t("calc.dlg.cambioKamOk")
    });
    if (!ok) {
      // El <select> nativo ya actualizó su texto visible antes de disparar el
      // evento change; si el usuario se arrepiente hay que devolverlo a mano o
      // quedaría mostrando un KAM distinto del que sigue activo en CALC_STATE.
      const sel = document.getElementById("calcKamSel");
      if (sel) sel.value = CALC_STATE.kam;
      return;
    }
  }
  CALC_STATE._kamTouched = true;   // a partir de acá, el auto-select por login no vuelve a pisar la elección
  CALC_STATE.kam = v;
  _calcResetParaNuevoKam();
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
  // parseNumInput y no parseFloat: el campo puede traer la cifra con miles
  // ("3,851" pegado tal como se ve) y parseFloat leería 3.
  const val     = parseNumInput(input.value);
  const k = `${partner}|||${city}|||${metric}`;
  if (isNaN(val)) delete CALC_STATE.edits[k];
  else CALC_STATE.edits[k] = val;
  // Cifra cruda para el próximo foco + la copia que lee la huella de números.
  const raw = isNaN(val) ? "" : rawNumText(val);
  input.dataset.raw = raw;
  const huella = input.nextElementSibling;
  if (huella && huella.hasAttribute("data-num")) huella.textContent = raw;
  // No se repinta la tabla (perdería el foco, ver _calcActualizarFila): se
  // actualiza la fila en el lugar (tinte "fijado a mano", ámbar si pisa lo
  // guardado, "Soltar", cambio) y después el cuadre y los totales.
  if (["ad", "sh", "nr"].includes(metric)) _calcActualizarFila(input);
  else {
    const sv = CALC_STATE.saved[k];
    input.classList.toggle("calc-inp-dirty", sv !== undefined && !isNaN(val) && +sv !== val);
  }
  _calcRefreshStatus();
}

export function calcOnKamGoalChange(metric, val) {
  const v = parseNumInput(val);
  CALC_STATE.kamGoals[metric] = Number.isFinite(v) ? v : 0;
  // Persistido en cada tecla, no solo al guardar: un F5 a mitad de tipear las
  // tres metas no debería obligar a escribirlas de nuevo.
  _calcGuardarDraft();
  // El reparto se recalcula EN VIVO (fase 8): con un debounce corto se repinta
  // la tabla de la derecha, no la pantalla — el foco sigue en este campo.
  _calcProgramarVivo();
}

export function calcOnTkPctChange(metric, val) {
  // Se recorta acá además de en repartirPorLinea: el input tiene min/max pero el
  // atributo HTML no impide escribir cualquier cosa a mano ni pegar un valor.
  const v = parseFloat(val);
  CALC_STATE.tkPct[metric] = Number.isFinite(v) ? Math.min(Math.max(v, 0), 100) : 0;
  _calcGuardarDraft();
  // Mismo criterio que la meta del KAM: reparto en vivo con debounce.
  _calcProgramarVivo();
}

// Atajo de meta ("+5%", "+10%", "+15%", "Igual que {mes}"): base del mes × factor,
// sobre la MISMA base del reparto (m.cartTot1). Redondea como el resto de la
// Calculadora (domain/calcPlanilla.ts#metaAtajo). Es lo mismo que escribir ese
// número en el campo: mismo draft, mismo repintado en vivo.
export function calcAtajo(metric, f) {
  if (!["ad", "sh", "nr"].includes(metric)) return;
  const m = _calcComputeModel();
  const v = metaAtajo(+((m.cartTot1 || {})[metric]) || 0, +f);
  if (v == null) return;
  CALC_STATE.kamGoals[metric] = v;
  const inp = document.getElementById(`calcGoal_${metric}`);
  if (inp) {
    inp.dataset.raw = rawNumText(v);
    inp.value = document.activeElement === inp ? rawNumText(v) : _calcFmtIn(v);
  }
  _calcGuardarDraft();
  _calcRepintarVivo();
}

// Columna derecha: reparto de Agregador o KPIs Fleet (segmentado).
export function calcSetVista(v) {
  if (v !== "agg" && v !== "fleet") return;
  CALC_STATE.vista = v;
  renderCalculator();
}

// "Tarjetas para partners" (panel) ↔ volver al reparto.
export function calcVerTarjetas() {
  CALC_STATE.vista = CALC_STATE.vista === "tarjetas" ? "agg" : "tarjetas";
  renderCalculator();
  // Con el panel apilado arriba (pantalla angosta) la columna derecha queda
  // más abajo: llevarla a la vista.
  const main = document.getElementById("calcMain");
  const side = document.querySelector(".calc-side");
  if (main && side && side.getBoundingClientRect().bottom <= main.getBoundingClientRect().top + 1) {
    main.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// "Soltar" una fila: sus celdas vuelven a lo que había antes de teclearlas —
// lo guardado en la base, o el reparto automático (domain/calcPlanilla.ts).
export function calcSoltarFila(partner, city) {
  const claves = ["ad", "sh", "nr"].map(k => `${partner}|||${city}|||${k}`);
  CALC_STATE.edits = soltarCeldas(CALC_STATE.edits, CALC_STATE.saved, claves);
  _calcRepintarVivo();
}

// ── Campos con formato de miles: crudo al editar, con miles al salir ─────────
// El valor "de verdad" vive en data-raw (y en CALC_STATE); lo que se ve fuera
// del foco es solo presentación. `change` corre ANTES que `focusout`, así que
// cuando llega el blur el handler de cambio ya guardó el número.
export function calcNumFocus(el) {
  if (!el || el.dataset.raw == null) return;
  el.value = el.dataset.raw;
  try { el.select(); } catch {}
}
export function calcNumBlur(el) {
  if (!el) return;
  const v = parseNumInput(el.value);
  if (Number.isFinite(v)) {
    el.dataset.raw = rawNumText(v);
    el.value = _calcFmtIn(v);
  } else if (!String(el.value).trim()) {
    el.dataset.raw = "";
    el.value = "";
  }
}
// Enter = confirmar el campo (dispara change + blur), como en una planilla.
export function calcNumKeydown(e, el) {
  if (e.key === "Enter") { e.preventDefault(); el.blur(); }
}

// Re-renderiza con metas + edits aplicados. Ya no hay botón "Recalcular" (el
// reparto se actualiza en vivo); queda como API para quien necesite forzar un
// repintado completo (scripts de verificación, huella).
export function calcApplyChanges() {
  renderCalculator();
}

export function calcOnExportPartnerChange(v) {
  CALC_STATE.selPartnerExport = v;
  renderCalculator();
}

export async function calcResetEdits() {
  if (!Object.keys(CALC_STATE.edits).length) return;
  if (!(await confirmDialog({
    title: t("calc.dlg.resetTitulo"), body: t("calc.confirmResetEdits"),
    confirmLabel: t("calc.dlg.resetOk"), danger: true
  }))) return;
  CALC_STATE.edits = {};
  CALC_STATE._utilSeeded = {};   // permite re-sembrar Utilización = 85
  renderCalculator();
}

// ── CONSTRUCCIÓN DE FILAS DE METAS (fuente única: CSV + guardado directo) ──────
// Claves de BD de metas.mes: la tabla única de core/meses.ts (nunca se traduce).
export const CALC_MES_NOMBRES = MES_NOMBRES;
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
            // SIN_KAM es un bucket de la UI, no un KAM real: a la BD va "" para
            // que `metas.kam` siga significando "persona a cargo" y no aparezca
            // un KAM llamado "No KAM" en los reportes.
            kam: _calcKamGuardar(partner),
            city, mes: mesName, mes_year: mesYear };
      byKey.set(k, r);
    }
    return r;
  };
  // Agregador (último mes): Fleet incluido en el reparto (denominador = todos).
  const repartoSave = _calcRepartoDe(m.aggLast1, g);
  for (const e of m.aggLast1.values()) {
    const clid = e.clid || _calcLookupClid(e.partner, e.city);
    if (!clid) continue;
    const b = _calcAggMetaBases(e, g, m.distTot1, repartoSave);
    const r = getRow(e.partner, e.city, clid);
    const adGoal = _calcGoalFor(e.partner, e.city, "ad", b.ad);
    const shGoal = _calcGoalFor(e.partner, e.city, "sh", b.sh);
    const nrGoal = _calcGoalFor(e.partner, e.city, "nr", b.nr);
    r.meta_active_drivers = adGoal;
    r.meta_supply_hours   = shGoal;
    r.meta_nr             = nrGoal;

    // META TUKTUK (meta_tk_*): la PORCIÓN TukTuk de la cuota, no una meta aparte.
    //
    // La meta paraguas (meta_active_drivers/_nr/_supply_hours) sigue cubriendo
    // Taxi + TukTuk JUNTOS — no se le suma nada. `meta_tk_*` es un DESGLOSE de
    // ese mismo número, y existe porque es lo que se declara en los Loyalty
    // Programs. Sumarlas daría doble conteo; ese error ya se cometió una vez
    // (ver metasGuard) y por eso queda escrito acá.
    //
    // BUG REAL corregido acá (encontrado probando el guardado, no en los tests):
    // esto escribía `Math.round(b.adTk)` — el desglose CALCULADO sin pasar por
    // `_calcGoalFor` — mientras el paraguas de arriba SÍ respeta un edit manual.
    // Si el KAM ajustaba el total a mano por DEBAJO de lo calculado (ej. una
    // unidad 100% TukTuk cuyo total se corrigió de 573 a 371), el desglose
    // quedaba en 573: **`meta_tk_ad > meta_active_drivers` en la base real**,
    // justo la clase de dato que `domain/metasGuard` existe para evitar. Ahora
    // se parte el `adGoal` YA RESUELTO (con el edit si lo hay) por la misma
    // proporción que calculó el reparto — mismo criterio que la tarjeta del
    // partner (splitPorFraccion, domain/repartoLinea.ts): el desglose nunca
    // puede superar al total porque sale de partir ESE número, no de uno viejo.
    //
    // Solo se escribe si el KAM declaró un %: sin carve-out no hay una porción
    // TukTuk identificable, y escribir un 0 se leería como "la meta TukTuk es
    // cero" en vez de "no se declaró".
    if (repartoSave) {
      const { secundario: adTk } = splitPorFraccion(adGoal, b.ad > 0 ? b.adTk / b.ad : 0);
      const { secundario: shTk } = splitPorFraccion(shGoal, b.sh > 0 ? b.shTk / b.sh : 0);
      const { secundario: nrTk } = splitPorFraccion(nrGoal, b.nr > 0 ? b.nrTk / b.nr : 0);
      if (adTk > 0) r.meta_tk_ad = adTk;
      if (nrTk > 0) r.meta_tk_nr = nrTk;
      if (shTk > 0) r.meta_tk_sh = shTk;
    }
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
  // agregador de arriba. Desde sep-2026 meta_tk_ad/_nr/_sh vuelven a escribirse,
  // pero como DESGLOSE de la meta paraguas (bloque de arriba), y al guardar se
  // alinean con lo que ve el KAM previa confirmación (domain/desgloseTk.ts).
  return { rows: [...byKey.values()], mesName, mesYear };
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
// Plantilla CSV (Agregador + Fleet). Headers alineados con uploadMetas → se puede
// resubir en Configuración → Metas. Blanks donde no aplica.
// Las columnas META TK * SÍ se exportan (sep 2026, carve-out de TukTuk): un KAM
// que declaró el % de PnL y bajó este CSV para revisarlo antes de subirlo en
// Configuración → Metas tiene que poder volver a subirlo sin perder ese
// desglose. `uploadMetas` ya sabe leer estos headers (opcionales) desde antes
// — el hueco real estaba acá, en que esta plantilla nunca los escribía, así
// que ida y vuelta por CSV borraba en silencio lo que el botón de guardado
// directo sí preservaba.
export function calcExportExcel() {
  logAccess("download_csv", "calculadora");
  const m = _calcComputeModel();
  const { rows, mesName, mesYear } = _calcBuildMetaRows(m);
  const header = ["CLID", "PARTNER", "CIUDAD", "MES", "AÑO",
    "ACTIVE DRIVERS", "N+R", "SUPPLY HOURS",
    "META SH/AUTO", "META ACEPTACION", "META UTILIZACION",
    "META TK AD", "META TK N+R", "META TK SH"];
  const q   = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const num = v => (v == null ? "" : v);
  const lines = [header.join(",")];
  rows.forEach(r => {
    lines.push([
      q(r.clid), q(r.partner), q(r.city), q(r.mes), num(r.mes_year),
      num(r.meta_active_drivers), num(r.meta_nr), num(r.meta_supply_hours),
      num(r.meta_sh_car), num(r.meta_acceptance), num(r.meta_utilization),
      num(r.meta_tk_ad), num(r.meta_tk_nr), num(r.meta_tk_sh)
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
  showBanner(true, t("calc.plantillaExportada"));
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
    // Desglose TukTuk de los totales que SÍ viajan: sale de la fila completa
    // (split del MISMO total tecleado, ver _calcBuildMetaRows), así la base
    // queda igual a lo que el KAM ve. Solo el del total que cambió — el de un
    // total que no se reescribe partiría un número que no es el de la base.
    // Qué pasa con lo que ya estaba guardado lo decide domain/desgloseTk.ts.
    Object.keys(TK_PARAGUAS).forEach(tk => {
      if (keep[TK_PARAGUAS[tk]] !== undefined && r[tk] !== undefined) keep[tk] = r[tk];
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
  if (!STATE.canWrite) { await _calcAviso(t("calc.dlg.sinPermisoTitulo"), t("calc.requiereKamAdmin")); return; }
  if (CALC_STATE.kam === "all") { await _calcAviso(t("calc.dlg.elegirKamTitulo"), t("calc.elegirKamEspecifico")); return; }
  const m = _calcComputeModel();
  const built = _calcBuildMetaRows(m);
  const { mesName, mesYear } = built;
  const soloCambios = CALC_STATE.saveMode === "edits";
  const rows = soloCambios ? _calcFiltrarSoloCambios(built.rows) : built.rows;
  if (!rows.length) {
    await _calcAviso(t("calc.dlg.nadaTitulo"), soloCambios ? t("calc.sinCambiosParaGuardar2") : t("calc.sinMetasParaGuardar"));
    return;
  }

  // Resumen antes de escribir.
  const g = CALC_STATE.kamGoals;
  const a = _calcAggDistSums(m.aggLast1, m.distTot1, g);
  const nAgg   = rows.filter(r => r.meta_active_drivers != null).length;
  const nFleet = rows.filter(r => r.meta_sh_car != null || r.meta_acceptance != null || r.meta_utilization != null).length;
  const mesTxt = `${mesLabel(mesName)} ${mesYear}`;
  // Título del diálogo = la primera línea de siempre; cuerpo = el resto.
  const summaryTitulo = soloCambios
    ? t("calc.conf.soloCab", { kam: CALC_STATE.kam, mes: mesTxt })
    : t("calc.conf.completoCab", { kam: CALC_STATE.kam, mes: mesTxt });
  const summary = soloCambios
    ? t("calc.conf.soloFilas", { n: rows.length }) + "\n" +
      (nAgg ? t("calc.conf.aggFilas", { n: nAgg }) + "\n" : "") +
      (nFleet ? t("calc.conf.fleetFilas", { n: nFleet }) + "\n" : "") +
      "\n" + t("calc.conf.soloPie")
    : t("calc.conf.completoAgg", { n: nAgg, ad: fmt(a.sumAD), sh: fmt(a.sumSH), nr: fmt(a.sumNR) }) + "\n" +
      // El desglose TukTuk también se escribe, así que también se confirma: es
      // lo que el KAM va a declarar en los Loyalty Programs y no debería
      // enterarse después de haber apretado guardar.
      (_calcTieneTkPct()
        ? t("calc.conf.completoTk", {
            ad: fmt(Math.round(a.sumAD * (+CALC_STATE.tkPct.ad || 0) / 100)),
            sh: fmt(Math.round(a.sumSH * (+CALC_STATE.tkPct.sh || 0) / 100)),
            nr: fmt(Math.round(a.sumNR * (+CALC_STATE.tkPct.nr || 0) / 100)) }) + "\n"
        : "") +
      (nFleet ? t("calc.conf.completoFleet", { n: nFleet }) + "\n" : "") +
      "\n" + t("calc.conf.completoTotal", { n: rows.length }) + "\n\n" +
      t("calc.conf.completoPie", { mes: mesTxt });
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
    if (!chk.ok) { await _calcAviso(t("calc.dlg.metasCeroTitulo"), mensajeMetasInvalidas(chk.faltantes), "bad"); return; }
  } else {
    const ceros = _calcCerosQueBorran(rows);
    if (ceros.length && !(await _calcConLista(confirmDialog({
      title: t("calc.dlg.cerosTitulo"),
      body: t("calc.conf.cerosCab", { n: ceros.length }) + "\n\n" +
        ceros.slice(0, 12).join("\n") +
        (ceros.length > 12 ? "\n" + t("calc.conf.yMas", { n: ceros.length - 12 }) : "") +
        "\n\n" + t("calc.conf.cerosPie"),
      confirmLabel: t("calc.dlg.cerosOk"), danger: true
    })))) return;
  }

  if (!STATE._mensualLoaded) {
    await _calcAviso(t("calc.dlg.cargandoTitulo"), t("calc.mensualCargando"));
    return;
  }

  if (!(await confirmDialog({
    title: summaryTitulo, body: summary, confirmLabel: t("calc.dlg.guardarOk")
  }))) return;

  showLoad(true, t("calc.guardandoMetas"));
  try {
    const clids = [...new Set(rows.map(r => r.clid))];
    // ilike, NO eq: la BD tiene casing mixto en `mes` por uploads viejos
    // ("Septiembre" vs "SEPTIEMBRE" — deleteMetasMes ya usa ilike por lo
    // mismo). Con eq, la fila vieja no se veía en el merge y el upsert (cuya
    // UNIQUE es case-sensitive) INSERTABA un duplicado del mismo mes que el
    // cliente luego sumaba dos veces.
    //
    // Y por AÑO (B1): sin `mes_year`, guardar ENERO 2027 leía la fila de ENERO
    // 2026 como "existente", la fusionaba (heredando sus columnas Fleet y
    // meta_tk_cars) y el upsert la PISABA. Desde la migración 2026-09-23 la
    // UNIQUE es (clid, city, mes, mes_year) y mes_year es NOT NULL.
    const { data: existing, error: selErr } = await _conReintento(() => sb.from("metas")
      .select("*").in("clid", clids).ilike("mes", mesName).eq("mes_year", mesYear));
    if (selErr) throw selErr;
    const exMap = new Map((existing || []).map(x => [claveFila(x.clid, normCity(x.city)), x]));

    // DESGLOSE TUKTUK: ¿este guardado BORRA o REESCRIBE uno ya guardado?
    // (decisión de Manuel: avisar y pedir confirmación). La regla vive en
    // domain/desgloseTk.ts; acá solo el I/O.
    //
    // POR QUÉ ACÁ y no antes del confirm del resumen: hace falta lo que hay en
    // la base, y este select es una LECTURA — el aviso sigue saliendo antes de
    // cualquier escritura. Dejarlo dentro de este try conserva el reintento
    // (_conReintento) y la clasificación de errores sin duplicarlos, y compara
    // contra la base lo más cerca posible del upsert (otro KAM/admin pudo haber
    // guardado mientras este tenía la pantalla abierta).
    const tkPct = _calcTieneTkPct();
    const cambiosTk = detectarCambiosTk(rows, exMap, tkPct);
    if (hayCambiosTk(cambiosTk)) {
      showLoad(false);
      if (!(await _calcConLista(confirmDialog({
        title: t("calc.dlg.tkTitulo"),
        body: mensajeCambiosTk(cambiosTk,
          { kam: CALC_STATE.kam, mes: mesName, anio: mesYear, hayPctDeclarado: tkPct }, fmt),
        confirmLabel: t("calc.dlg.tkOk"), danger: true
      })))) return;
      showLoad(true, t("calc.guardandoMetas"));
    }
    // Payload homogéneo (mismas claves en todas las filas) → sin sorpresas de union en
    // PostgREST. r (computado) pisa; ex rellena columnas de otras líneas no tocadas.
    // meta_tk_*: el merge las rellena desde `ex` (lo que ya está en BD) SALVO las
    // que están en alcance de `cambiosTk.aplicar` (su total paraguas viaja en esta
    // fila): esas quedan con el valor que ve el KAM, NULL incluido — con la
    // confirmación de arriba si pisan algo. `meta_tk_cars` la calculadora no la
    // toca nunca: siempre se preserva.
    const COLS = ["clid", "partner", "kam", "city", "mes", "mes_year",
      "meta_active_drivers", "meta_nr", "meta_supply_hours",
      "meta_sh_car", "meta_acceptance", "meta_utilization",
      "meta_tk_ad", "meta_tk_nr", "meta_tk_cars", "meta_tk_sh"];
    const payload = rows.map(r => {
      const clave = claveFila(r.clid, r.city);
      const ex = exMap.get(clave) || {};
      const merged = { ...ex, ...r, ...cambiosTk.aplicar.get(clave) };
      // Conservar el CASING del `mes` ya existente en BD: la UNIQUE
      // (clid,city,mes) es case-sensitive, así que escribir "SEPTIEMBRE"
      // sobre una fila "Septiembre" no conflictuaba → fila duplicada que el
      // cliente (que normaliza a mayúsculas al cargar) sumaba dos veces.
      if (ex.mes) merged.mes = ex.mes;
      const o = {};
      for (const c of COLS) o[c] = merged[c] !== undefined ? merged[c] : null;
      return o;
    });
    // upsertMetas: clave con año, o la anterior si la migración aún no se aplicó.
    const { error } = await _conReintento(() => upsertMetas(sb, payload));
    if (error) throw error;
    const refrescoOk = await loadFromSupabase();
    // Forzar la re-lectura de lo guardado: si no, `saved` queda con el estado
    // ANTERIOR y la próxima comparación "¿cambió?" daría cambios fantasma.
    CALC_STATE.savedKey = "";
    // El upsert YA se confirmó arriba, así que el guardado está bien pase lo que
    // pase acá. Si el refresco falló, decirlo en vez de pintar el verde de
    // siempre: con el banner verde sobre una pantalla que no muestra las metas,
    // lo razonable es concluir "no se guardó" y volver a guardar — que es
    // justamente lo que pasó (reporte de Manuel, 15-sep-2026).
    showBanner(refrescoOk, refrescoOk
      ? (soloCambios
        ? t("calc.okActualizadas", { n: payload.length, kam: CALC_STATE.kam, mes: mesTxt })
        : t("calc.okGuardadas", { n: payload.length, kam: CALC_STATE.kam, mes: mesTxt }))
      : t("calc.okSinRefresco", { n: payload.length, mes: mesTxt }));
    renderCalculator();
    if (STATE.curTab === "metas" && typeof renderMetas === "function") renderMetas();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    // El "Guardando…" se quita ANTES del aviso: con el diálogo abierto encima
    // del cargador parecería que todavía está guardando.
    showLoad(false);
    const titulo = t("calc.dlg.noGuardoTitulo");
    if (/failed to fetch|networkerror|network error|load failed/i.test(msg)) {
      await _calcAviso(titulo, t("calc.errorRed"), "bad");
    } else if (/42501|row-level security|permission/i.test(msg)) {
      await _calcAviso(titulo, t("calc.sinPermisosGuardar"), "bad");
    } else {
      await _calcAviso(titulo, t("calc.errorGuardarMetas") + msg, "bad");
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
  if (!STATE.isAdmin) { await _calcAviso(t("calc.dlg.sinPermisoTitulo"), t("calc.borrarKamSoloAdmin")); return; }
  if (CALC_STATE.kam === "all") { await _calcAviso(t("calc.dlg.elegirKamTitulo"), t("calc.borrarKamNeedKam")); return; }

  const m = _calcComputeModel();
  const { name: mesName, year: mesYear } = _calcNextMonthName(m.lastMonth || "");
  if (!mesName) return;

  // FILAS afectadas = las metas de ese (mes, año) cuyo KAM, con la MISMA
  // definición que usa la Calculadora para armar la cartera (_calcKamDe:
  // partners → flotas → kam de la fila), es el KAM elegido. B7: antes se
  // CONTABAN por `x.kam` pero se BORRABAN por los CLIDs de KAM_MAP, así que un
  // partner cuyo KAM venía de `flotas` (o de la propia fila) figuraba en el
  // "N eliminadas" y seguía en la base. Ahora se borra exactamente lo contado,
  // por id, y se informa lo que la base dice que borró.
  const afectadas = (STATE.metasData || []).filter(x =>
    x.mes === mesName && (mesYear == null || x.mYear == null || x.mYear === mesYear) &&
    _calcKamDe(x) === CALC_STATE.kam);

  if (!afectadas.length) { await _calcAviso(t("calc.dlg.nadaBorrarTitulo"), t("calc.borrarKamSinMetas", { k: CALC_STATE.kam, m: mesName })); return; }

  const mesTxt = `${mesLabel(mesName)} ${mesYear ?? ""}`.trim();
  // Hay que TECLEAR el nombre del KAM (tal cual se ve en el selector; da igual
  // mayúsculas/minúsculas): lo irreversible no se acepta por reflejo. Decisión
  // de Manuel (24-sep-2026). Cancelar o un nombre que no coincide = no pasa nada.
  const kamTxt = kamLabel(CALC_STATE.kam);
  if (!(await confirmDialog({
    title: t("calc.dlg.borrarTitulo", { kam: kamTxt, mes: mesTxt }),
    body: t("calc.conf.borrarKam", { kam: kamTxt, mes: mesTxt, n: afectadas.length, m: mesLabel(mesName) }),
    confirmLabel: t("calc.dlg.borrarOk", { n: afectadas.length }), danger: true,
    requireText: kamTxt, requireTextIgnoreCase: true
  }))) return;

  showLoad(true, t("calc.borrandoMetas"));
  try {
    // 1) Ubicar en la base las MISMAS filas que se contaron (clid + ciudad
    //    normalizada, mes sin importar el casing, el año elegido o NULL legacy).
    const clids = [...new Set(afectadas.map(x => x.clid).filter(Boolean))];
    const claves = new Set(afectadas.map(x => claveFila(x.clid, x.city)));
    let sel = sb.from("metas").select("id, clid, city, mes_year").in("clid", clids).ilike("mes", mesName);
    if (mesYear != null) sel = sel.or(`mes_year.eq.${mesYear},mes_year.is.null`);
    const { data: enBase, error: selErr } = await _conReintento(() => sel);
    if (selErr) throw selErr;
    const ids = (enBase || []).filter(r => claves.has(claveFila(r.clid, normCity(r.city)))).map(r => r.id);
    if (!ids.length) throw new Error(t("calc.errFilasYaNoEstan"));
    // 2) Borrar por id y pedir de vuelta lo borrado: RLS bloquea un DELETE sin
    //    error (0 filas), así que el conteo real sale de la respuesta.
    const { data: borradas, error } = await _conReintento(() =>
      sb.from("metas").delete().in("id", ids).select("id"));
    if (error) throw error;
    const nBorradas = (borradas || []).length;
    if (!nBorradas) throw new Error("42501: " + t("calc.errNadaBorrado"));
    const refrescoOk = await loadFromSupabase();
    CALC_STATE.savedKey = "";   // re-leer lo guardado (ahora vacío para este KAM)
    const parcial = nBorradas !== afectadas.length
      ? " — " + t("calc.borradoParcial", { n: afectadas.length }) : "";
    showBanner(refrescoOk && !parcial, refrescoOk
      ? t("calc.okBorradas", { kam: CALC_STATE.kam, mes: mesTxt, n: nBorradas }) + parcial
      : t("calc.okBorradasSinRefresco", { mes: mesTxt, n: nBorradas }) + parcial);
    renderCalculator();
    if (STATE.curTab === "metas" && typeof renderMetas === "function") renderMetas();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    showLoad(false);
    const titulo = t("calc.dlg.noBorroTitulo");
    if (/42501|row-level security|permission/i.test(msg)) await _calcAviso(titulo, t("calc.sinPermisosGuardar"), "bad");
    else await _calcAviso(titulo, t("calc.errorBorrarMetas") + msg, "bad");
  } finally {
    showLoad(false);
  }
}

// Captura #calcExportCard tal cual está en el DOM en ese instante y dispara la
// descarga del PNG. Compartido por la descarga de UNA tarjeta y por "todas".
async function _calcCapturarYDescargar(card, nombrePartner) {
  // Fondo = el token de superficie EN CLARO (no un hex fijo): la tarjeta tiene
  // esquinas redondeadas y el PNG no debe quedar con esquinas transparentes.
  // La tarjeta se le manda al partner: sale clara aunque la app esté en oscuro.
  const fondo = tokenClaro("--color-surface", "#ffffff");
  const canvas = await html2canvas(card, opcionesCapturaClara({ scale: 2, useCORS: true, backgroundColor: fondo }));
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `meta_${nombrePartner || "partner"}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function calcDownloadPartnerImage() {
  const card = document.getElementById("calcExportCard");
  if (!card) return;
  showLoad(true, t("calc.generandoImagen"));
  try {
    await ensureHtml2Canvas();
    await _calcCapturarYDescargar(card, CALC_STATE.selPartnerExport);
    showBanner(true, t("calc.imagenDescargada"));
  } catch (err) {
    showLoad(false);
    await _calcAviso(t("calc.dlg.imagenErrorTitulo"), t("calc.error") + err.message, "bad");
  } finally {
    showLoad(false);
  }
}

// Descarga UNA imagen por cada partner de la cartera del KAM activo, en el
// idioma que ya está elegido en el toggle ES/EN/ES-EN/RU — no hace falta
// tocar nada más, la tarjeta siempre lee CALC_STATE.exportLang.
//
// Por qué partner por partner y no una sola captura larga: cada tarjeta es lo
// que se le manda a UN partner puntual; juntarlas en una imagen mezclaría la
// meta de uno con la de otro, exactamente lo que el diseño de la tarjeta evita
// a propósito ("sin mezclar otros partners").
//
// Secuencial, no en paralelo: disparar muchos `a.click()` de descarga seguidos
// activa el bloqueo de "este sitio quiere descargar varios archivos" del
// navegador, y generar todos los canvas a la vez es innecesariamente pesado en
// memoria. Una pausa corta entre cada una alcanza para que el navegador las
// procese sin bloquearlas.
export async function calcDownloadAllPartnerImages() {
  if (CALC_STATE.kam === "all") { await _calcAviso(t("calc.dlg.elegirKamTitulo"), t("calc.eligeKamTarjetas")); return; }
  const m = _calcComputeModel();
  // MISMO universo que arma la tarjeta individual (_calcSec5_exportPartner):
  // los partners con datos del KAM en el último mes. No el universo más amplio
  // del buscador (que además suma partners TukTuk de una ventana más larga) —
  // ahí sí podría tocar un partner sin nada que mostrar este mes.
  const partners = [...new Set([...m.aggLast1.values()].map(e => e.partner))].sort();
  if (!partners.length) { await _calcAviso(t("calc.dlg.sinPartnersTitulo"), t("calc.sinPartnersKam")); return; }

  const selOriginal = CALC_STATE.selPartnerExport;
  let n = 0;
  try {
    await ensureHtml2Canvas();
    for (const p of partners) {
      showLoad(true, t("calc.generandoImagenN", { n: n + 1, total: partners.length, p }));
      CALC_STATE.selPartnerExport = p;
      renderCalculator();
      // Un frame para que el card recién reasignado termine de pintar antes
      // de capturarlo — sin esto, html2canvas puede capturar el partner
      // ANTERIOR todavía en pantalla.
      await new Promise(r => requestAnimationFrame(r));
      const card = document.getElementById("calcExportCard");
      // Sin ninguna tabla adentro = "Sin datos para este partner" (caso raro:
      // un partner que entró a `agg` sin que ninguna de sus filas tenga
      // actividad ni meta calculable). Saltarlo, no descargar una imagen vacía.
      if (!card || !card.querySelector("table")) continue;
      await _calcCapturarYDescargar(card, p);
      n++;
      await new Promise(r => setTimeout(r, 350));
    }
    showBanner(true, t("calc.imagenesDescargadas", { n }));
  } catch (err) {
    showLoad(false);
    await _calcAviso(t("calc.dlg.imagenErrorTitulo"), t("calc.error") + err.message, "bad");
  } finally {
    CALC_STATE.selPartnerExport = selOriginal;
    renderCalculator();
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
  const inpA = document.getElementById("calcExportSearch");
  if (inpA) inpA.setAttribute("aria-expanded", "true");
  if (!list.innerHTML) {
    const inp = document.getElementById("calcExportSearch");
    _calcPaintExportList(inp ? inp.value : "");
  }
}

export function calcHideExportList() {
  const list = document.getElementById("calcExportList");
  if (list) list.style.display = "none";
  const inp = document.getElementById("calcExportSearch");
  if (inp) inp.setAttribute("aria-expanded", "false");
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
    list.innerHTML = `<div class="calc-combo__empty">${escapeHTML(t("seg.sinCoincidencias"))}</div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 100).map(p => {
    const sel = p === CALC_STATE.selPartnerExport;
    return `<div class="calc-combo__opt${sel ? " is-sel" : ""}" role="option" aria-selected="${sel}"
      data-act-mousedown="calcSelectExportPartner" data-partner="${escapeHTML(p)}">${escapeHTML(p)}</div>`;
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
    const first = list && list.querySelector(".calc-combo__opt");
    if (first) first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
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
    : rows.filter(r => _calcKamDe(r) === CALC_STATE.kam);
  return _calcAggByPartnerCity(filteredRows, last3Set);
}

// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";

registerActions({
  calcOnKamChange:   (d, el) => calcOnKamChange(el.value),
  calcNumFocus:      (d, el) => calcNumFocus(el),
  calcNumBlur:       (d, el) => calcNumBlur(el),
  calcNumKeydown:    (d, el, e) => calcNumKeydown(e, el),
  calcApplyChanges, calcSaveMetas, calcExportExcel, calcResetEdits, calcDownloadPartnerImage,
  calcDownloadAllPartnerImages,
  calcSetSaveMode:     d => calcSetSaveMode(d.mode),
  calcDeleteMetasKam,
  calcOnKamGoalChange: (d, el) => calcOnKamGoalChange(d.metric, el.value),
  calcOnTkPctChange:   (d, el) => calcOnTkPctChange(d.metric, el.value),
  calcOnGoalEdit:      (d, el) => calcOnGoalEdit(el),
  calcAtajo:           d => calcAtajo(d.metric, d.f),
  calcSetVista:        d => calcSetVista(d.value),
  calcVerTarjetas,
  calcSoltarFila:      d => calcSoltarFila(d.pk, d.city),
  // `value` = el segmentado de idioma de la tarjeta (ui.segmented); `code` = compatibilidad.
  calcSetExportLang:   d => calcSetExportLang(d.value || d.code),
  calcFilterExportPartners: (d, el) => calcFilterExportPartners(el.value),
  calcExportKeydown:        (d, el, e) => calcExportKeydown(e),
  calcSelectExportPartner:  d => calcSelectExportPartner(d.partner),
  calcShowExportList,
  // blur (focusout) dispara ANTES que el click en un item de la lista, así que
  // hay que darle un margen para que el mousedown del click llegue primero —
  // mismo delay de 200ms que tenía el onblur inline original.
  calcHideExportListDelayed: () => setTimeout(calcHideExportList, 200)
});
