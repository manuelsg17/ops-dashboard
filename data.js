// data.js — Toda la lógica de datos

// ── UTILS ─────────────────────────────────────────────────────────────────────
function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},62%,46%)`;
}

// Normaliza ciudad: trim + UPPERCASE. Llamar SIEMPRE al leer/escribir ciudad
// (BD, uploads, comparaciones). Evita fragmentacion "Lima"/"lima"/"LIMA".
function normCity(c) {
  return String(c || "").trim().toUpperCase();
}
// Para display amigable: "LIMA" -> "Lima". Usar al renderizar en UI.
function cityLabel(c) {
  const s = String(c || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Aplica el mapeo de flotas (STATE.flotasMap) a un array de rows con `clid`.
//
// CONTRATO (importante):
// - La tabla `partners` (Configuracion) es la FUENTE DE VERDAD para nombre y KAM.
// - La tabla `flotas` solo se usa para:
//     1) Excluir CLIDs del dashboard (activo=false)
//     2) Fallback de nombre/KAM SOLO si el CLID no esta configurado en `partners`
// Si un CLID esta en partners, su nombre y KAM vienen de alli y `flotas` no
// los puede sobrescribir. Esto evita que el upload de un Excel de Flotas pise
// la configuracion manual del equipo.
function applyFlotasOverride(rows) {
  const map = STATE && STATE.flotasMap;
  if (!map || !Object.keys(map).length) return rows;
  return rows.reduce((acc, r) => {
    const f = map[r.clid];
    if (f && f.activo === false) return acc;   // flota inactiva → excluir
    if (f) {
      // Nombre: solo fallback si el CLID NO esta en CLID_MAP (partners)
      const enPartners = !!(STATE.CLID_MAP && STATE.CLID_MAP[r.clid]);
      if (f.nombre_asignado && !enPartners) {
        if (!r._partnerOriginal) r._partnerOriginal = r.partner;
        r.partner = f.nombre_asignado;
      }
      // KAM: solo fallback si el CLID NO tiene KAM en KAM_MAP (partners)
      const kamConfig = (STATE.KAM_MAP && STATE.KAM_MAP[r.clid] || "").trim();
      if (f.kam && !kamConfig) r.kam = f.kam;
    }
    acc.push(r);
    return acc;
  }, []);
}

// Escapa caracteres HTML peligrosos en strings de input (partner names, tooltips, etc.).
// Usar SIEMPRE al interpolar valores no controlados en HTML.
function escapeHTML(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Full-precision number parser — never rounds internally.
// Maneja formato ES ("1.234,56") y US ("1,234.56"). Si solo hay un tipo
// de separador, decide por la cantidad de digitos despues del ultimo:
// exactamente 3 = separador de miles; 1-2 = decimal.
// Registra en STATE.parseWarnings cuando una celda no es numerica.
function toN(v, label) {
  if (v === null || v === undefined || v === "") return 0;
  // Si XLSX entregó un número (raw:true), ESE es el valor exacto y completo.
  // No aplicar heurísticas de separador/sufijo: romperían decimales reales
  // (p.ej. 1611576.849 → "1611576.849" → digitsAfter===3 lo trataría como
  // separador de miles → 1611576849, error ×1000). Devolver tal cual.
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (s === "" || s === "0") return 0;

  // Sufijo de magnitud (case-insensitive): K=mil, M/MM=millón, B/G=mil millones.
  // Solo si hay parte numérica antes del sufijo. Convierte "1.8M" → 1800000 y
  // "51.7K" → 51700. ANTES solo se manejaba "K"; "1.8M" caía en parseFloat=1.8,
  // perdiendo el 99.9% del valor (raíz del GMV "clavado"/saltos en el dashboard).
  const sufMatch = s.match(/^([-+]?[\d.,\s]+)(K|MM|M|B|G)$/i);
  if (sufMatch) {
    const mult = { K: 1e3, MM: 1e6, M: 1e6, B: 1e9, G: 1e9 }[sufMatch[2].toUpperCase()];
    return toN(sufMatch[1], label) * mult;
  }

  // Eliminar % y espacios (incluido espacio fino)
  s = s.replace(/[%\s ]/g, "");

  const hasDot   = s.indexOf(".") > -1;
  const hasComma = s.indexOf(",") > -1;

  if (hasDot && hasComma) {
    // Ambos: el ultimo separador es el decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");          // 1.234,56 → 1234.56
    } else {
      s = s.replace(/,/g, "");                              // 1,234.56 → 1234.56
    }
  } else if (hasComma) {
    const commaCount = (s.match(/,/g) || []).length;
    const digitsAfter = s.length - s.lastIndexOf(",") - 1;
    if (commaCount > 1 || digitsAfter === 3) {
      s = s.replace(/,/g, "");                              // 1,234,567 o 1,234 → 1234567 / 1234
    } else {
      s = s.replace(",", ".");                              // 12,5 → 12.5
    }
  } else if (hasDot) {
    const dotCount = (s.match(/\./g) || []).length;
    const digitsAfter = s.length - s.lastIndexOf(".") - 1;
    if (dotCount > 1 || (digitsAfter === 3 && s.indexOf(".") > 0)) {
      s = s.replace(/\./g, "");                              // 1.234.567 o 1.234 → 1234567 / 1234
    }
    // else dejar el punto como decimal
  }

  const n = parseFloat(s);
  if (isNaN(n) && label && STATE?.parseWarnings !== undefined) {
    STATE.parseWarnings.add(label);
  }
  return isNaN(n) ? 0 : n;
}

// Display formatters — max 2 decimal places
function fmt(n) {
  return (n || 0).toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtK(n) {
  return "$" + ((n || 0) / 1000).toLocaleString("es-PE",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "K";
}
// fmtSmart: compresion automatica K/M con 1 decimal fijo.
// Usar para metricas grandes (Supply Hours, Trips, Commission) donde el numero
// completo no entra en charts/KPI cards. Mantiene 1 decimal siempre para no
// hacer redondeos fuertes (12,500 -> "12.5K" en vez de "13K").
// Para Conductores Activos NO usar — el numero exacto es sensible.
function fmtSmart(n) {
  if (n === null || n === undefined || isNaN(n)) return "0";
  const neg = n < 0;
  const abs = Math.abs(n);
  let out;
  if (abs >= 1_000_000) {
    out = (abs / 1_000_000).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "M";
  } else if (abs >= 1_000) {
    out = (abs / 1_000).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "K";
  } else {
    out = fmt(abs);
  }
  return neg ? "-" + out : out;
}
function d2s(d) { return d ? d.split("-").reverse().join("/") : "--"; }

// Badge HTML
function bdg(c, p, cls = "mcard-badge") {
  // Tooltip: contexto del modo para que el usuario sepa contra que se compara
  const compLabel = STATE.curMode === "mensual" ? "mes anterior"
                  : STATE.curMode === "diario"  ? "dia anterior"
                  : "sem. anterior";
  if (p === null || p === undefined)
    return `<span class="${cls} b-neu" title="Sin dato previo (N/A)">N/A</span>`;
  if (p === 0)
    return c > 0 ? `<span class="${cls} b-pos" title="Primer periodo con dato (no hay ${compLabel})">NEW</span>`
                 : `<span class="${cls} b-neu" title="Sin movimiento">--</span>`;
  const v = ((c - p) / p) * 100;
  const s = v >= 0 ? "+" : "";
  const a = v >= 0 ? "↑" : "↓";
  const tooltip = escapeHTML(`Actual: ${fmt(c)} vs ${compLabel}: ${fmt(p)} → ${s}${v.toFixed(1)}%`);
  return `<span class="${cls} ${v >= 0 ? "b-pos" : "b-neg"}" title="${tooltip}">${a}${s}${v.toFixed(1)}%</span>`;
}

// Versión que respeta el modo: en diario no muestra comparativa (no aporta valor día-a-día).
// En semanal y mensual delega a bdg() para mostrar WoW / MoM.
function bdgMode(c, p, cls = "mcard-badge") {
  if (STATE.curMode === "diario") return "";
  return bdg(c, p, cls);
}

// Semaphore
function semCls(p) { return p > 100 ? "sem-g" : p >= 80 ? "sem-g" : p >= 50 ? "sem-y" : "sem-r"; }
function pColor(p) { return p > 100 ? "#8b5cf6" : p >= 80 ? "#10b981" : p >= 50 ? "#f59e0b" : "#FF0000"; }

// Trend over last 3 periods
function trendI(vals) {
  const v = vals.filter(x => x > 0);
  if (v.length < 2) return { i: "→", c: "" };
  const l = v.slice(-3);
  let u = 0, d = 0;
  for (let i = 1; i < l.length; i++) {
    if (l[i] > l[i - 1]) u++;
    else if (l[i] < l[i - 1]) d++;
  }
  if (u > d) return { i: "↑", c: "color:#10b981" };
  if (d > u) return { i: "↓", c: "color:#FF0000" };
  return { i: "→", c: "color:#888" };
}

// Parsea "YYYY-MM-DD" o "YYYY-MM" como fecha LOCAL (medianoche local), no UTC.
// `new Date("2026-06-01")` se interpreta como UTC y en zonas con offset negativo
// (Perú UTC-5) cae el día anterior (2026-05-31), corriendo mes/día. Eso rompía la
// proyección: la semana del 1 de junio parecía "cruzar al mes siguiente" y forzaba
// daysRemaining=0 (Proy = Fact). Construir desde las partes evita el corrimiento.
// Acepta "YYYY-MM" (modo mensual usa date=mes sin día) defaulteando al día 1.
function parseLocalDate(s) {
  const m = String(s).match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  return m ? new Date(+m[1], +m[2] - 1, +(m[3] || 1)) : new Date(s);
}

// Calcula días transcurridos y restantes del mes según el modo:
// - mensual: daysRemaining = 0 (mes ya cerrado)
// - semanal: lastDate = inicio de semana, fin = lastDate + 6 días
// - diario:  lastDate = el día exacto, no se suma nada
function calcProjectionDays(lastDate) {
  if (!lastDate) return { daysElapsed: 28, daysRemaining: 0, daysInMonth: 30 };
  const start  = parseLocalDate(lastDate);   // inicio del periodo = mes de referencia
  const refEnd = parseLocalDate(lastDate);
  if (STATE.curMode === "semanal") {
    // Fin de la semana = inicio + 6 días
    refEnd.setDate(refEnd.getDate() + 6);
  }
  // daysInMonth SIEMPRE del mes del periodo (start), nunca de refEnd: en semanal la
  // semana puede cruzar al mes siguiente y refEnd caería en otro mes → daría los días
  // del mes equivocado e inflaba la proyección de la última semana (p.ej. la última
  // semana de feb cruza a marzo y proyectaba ×31/28 ≈ +10%).
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  let daysElapsed;
  if (STATE.curMode === "diario") {
    daysElapsed = refEnd.getDate();
  } else if (STATE.curMode === "mensual") {
    daysElapsed = daysInMonth;  // mes completo (mes cerrado)
  } else {
    // semanal: si la semana se pasa al mes siguiente, el mes ya está completo
    daysElapsed = (refEnd.getMonth() !== start.getMonth()) ? daysInMonth : refEnd.getDate();
  }
  const daysRemaining = Math.max(daysInMonth - daysElapsed, 0);
  return { daysElapsed, daysRemaining, daysInMonth };
}

// Proyeccion lineal por avance del mes: total acumulado escalado al mes completo
// (total * daysInMonth / daysElapsed). Devuelve `total` tal cual en mensual o si ya
// no quedan dias. Ver detalle en el cuerpo.
function projA(vals, daysElapsed, daysRemaining) {
  const v = vals.filter(x => x > 0);
  if (!v.length) return 0;
  const total = v.reduce((s, x) => s + x, 0);
  if (STATE.curMode === "mensual" || daysRemaining === 0) return total;
  // Proyeccion lineal:
  //   proyeccion = (total acumulado * daysInMonth) / daysElapsed
  // Interpretacion: "si en daysElapsed dias del mes acumule `total`,
  // al ritmo actual acumulare `total * daysInMonth/daysElapsed` al cierre".
  // Mas robusto que promediar las ultimas 3 semanas porque depende del avance
  // real del mes, no del numero de filas en el rango.
  if (daysElapsed <= 0) return total;
  const daysInMonth = daysElapsed + daysRemaining;
  return (total * daysInMonth) / daysElapsed;
}

function sumR(rows, fn) { return rows.reduce((s, r) => s + fn(r), 0); }

// Detects if a partner has strictly declined for N consecutive periods.
// Skips partners with gaps in their date sequence (missing weeks = no false positives).
// Soporta metric "nr" como suma de newPartner + newService + reactivated.
function hasConsecutiveDecline(apdByPartner, partner) {
  const n      = STATE.declineThreshold || 3;
  const metric = STATE.declineMetric || "activeDrivers";
  const rows   = (apdByPartner.get(partner) || [])
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < n) return false;
  const last = rows.slice(-n);
  // Gap check: all consecutive dates should be equidistant (same interval in ms)
  if (last.length >= 2) {
    const interval = new Date(last[1].date) - new Date(last[0].date);
    for (let i = 2; i < last.length; i++) {
      if ((new Date(last[i].date) - new Date(last[i - 1].date)) !== interval) return false;
    }
  }
  // Resolver el valor por metric (soporta "nr" como composite)
  const getVal = r => metric === "nr"
    ? (r.newPartner + r.newService + r.reactivated)
    : r[metric];
  for (let i = 1; i < last.length; i++) {
    if (getVal(last[i]) >= getVal(last[i - 1])) return false;
  }
  return true;
}

// ── REGISTRO DE METRICAS TAXIPARKS ────────────────────────────────────────────
// Fuente unica de verdad: nombre de metrica del export (normalizado) -> columna
// snake_case en BD. Las 7 core conservan su nombre historico (los graficos
// existentes siguen linkeados igual); las ~41 nuevas se agregaron en
// migrations/2026-06-02_taxiparks_kpis_y_conversion.sql.
//
// El match es EXACTO sobre el nombre normalizado (lower + solo [a-z0-9] + espacios)
// para evitar colisiones por substring (ej. "new drivers from partner" vs
// "new profiles from partner").
function _txNorm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function _snakeToCamel(s) { return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()); }

const TX_COL_BY_NORM = {
  // ── core (nombre historico, NO cambiar) ──
  "active drivers": "active_drivers",
  "new drivers from partner": "new_from_partner",
  "new drivers from service": "new_from_service",
  "reactivated drivers": "reactivated",
  "supply hours": "supply_hours",
  "partner commission": "commission",
  "trips": "trips",
  // ── nuevas: conteos / montos ──
  "gmv": "gmv",
  "new drivers": "new_drivers",
  "new drivers from partner with 50 trips": "new_from_partner_50t",
  "new drivers from service with 50 trips": "new_from_service_50t",
  "active cars": "active_cars",
  "branded active cars": "branded_active_cars",
  "owned fleet active cars": "owned_fleet_active_cars",
  "owned fleet branded active cars": "owned_fleet_branded_active_cars",
  "internal fleet sh": "internal_fleet_sh",
  "external fleet sh": "external_fleet_sh",
  "new profiles": "new_profiles",
  "new profiles from partner": "new_profiles_partner",
  "new profiles from partner with 50 trips": "new_profiles_partner_50t",
  "new profiles from service": "new_profiles_service",
  "new profiles from service with 50 trips": "new_profiles_service_50t",
  // ── nuevas: ratios / shares / promedios ──
  "new drivers share": "new_drivers_share",
  "acceptance rate": "acceptance_rate",
  "completion rate": "completion_rate",
  "trips per hour": "trips_per_hour",
  "money per hour": "money_per_hour",
  "avg driver rating": "avg_driver_rating",
  "avg fare after surge": "avg_fare_after_surge",
  "bad rated trips share": "bad_rated_trips_share",
  "fraud trips share": "fraud_trips_share",
  "driver subsidies by gmv": "driver_subsidies_by_gmv",
  "driver support requests share": "driver_support_requests_share",
  "internal fleet sh share": "internal_fleet_sh_share",
  "internal fleet sh per active car": "internal_fleet_sh_per_active_car",
  "sh per active car": "sh_per_active_car",
  "sh per active driver": "sh_per_active_driver",
  "supply hours share": "supply_hours_share",
  "trips share": "trips_share",
  "partner commission share": "commission_share",
  "new profiles from partner reg 1 trip": "new_profiles_partner_reg1",
  "new profiles from partner reg 10 trip": "new_profiles_partner_reg10",
  "new profiles from partner reg 50 trip": "new_profiles_partner_reg50",
  "new profiles from partner reg 100 trip": "new_profiles_partner_reg100",
  "new profiles from service reg 1 trip": "new_profiles_service_reg1",
  "new profiles from service reg 10 trip": "new_profiles_service_reg10",
  "new profiles from service reg 50 trip": "new_profiles_service_reg50",
  "new profiles from service reg 100 trip": "new_profiles_service_reg100"
};

// Columnas que se SUMAN al consolidar duplicados (clid|city|periodo). El resto
// (ratios/shares/promedios) se asignan: ultima ocurrencia con valor gana.
const TX_COUNT_COLS = new Set([
  "active_drivers", "new_drivers", "new_from_partner", "new_from_service", "reactivated",
  "supply_hours", "commission", "trips", "gmv", "new_from_partner_50t", "new_from_service_50t",
  "active_cars", "branded_active_cars", "owned_fleet_active_cars", "owned_fleet_branded_active_cars",
  "internal_fleet_sh", "external_fleet_sh", "new_profiles", "new_profiles_partner",
  "new_profiles_partner_50t", "new_profiles_service", "new_profiles_service_50t"
]);

// Columnas NUEVAS (no-core) que viajan en memoria como camelCase (gmv, acceptanceRate, …).
const TX_NEW_COLS = [
  "gmv", "new_drivers", "new_drivers_share", "new_from_partner_50t", "new_from_service_50t",
  "acceptance_rate", "completion_rate", "trips_per_hour", "money_per_hour", "avg_driver_rating",
  "avg_fare_after_surge", "bad_rated_trips_share", "fraud_trips_share", "driver_subsidies_by_gmv",
  "driver_support_requests_share", "active_cars", "branded_active_cars", "owned_fleet_active_cars",
  "owned_fleet_branded_active_cars", "internal_fleet_sh", "external_fleet_sh", "internal_fleet_sh_share",
  "internal_fleet_sh_per_active_car", "sh_per_active_car", "sh_per_active_driver", "supply_hours_share",
  "trips_share", "commission_share", "new_profiles", "new_profiles_partner", "new_profiles_partner_50t",
  "new_profiles_partner_reg1", "new_profiles_partner_reg10", "new_profiles_partner_reg50", "new_profiles_partner_reg100",
  "new_profiles_service", "new_profiles_service_50t", "new_profiles_service_reg1", "new_profiles_service_reg10",
  "new_profiles_service_reg50", "new_profiles_service_reg100"
];

// Mapea las columnas NUEVAS de una fila BD -> objeto camelCase (null si sin dato).
function txRowExtra(r) {
  const out = {};
  for (const col of TX_NEW_COLS) {
    const v = r[col];
    out[_snakeToCamel(col)] = (v === null || v === undefined || v === "") ? null : +v;
  }
  return out;
}

// Extrae todas las metricas reconocidas de una fila para un periodo.
// mc: { metricLower -> excelColKey }. Devuelve { colSnake: valor }.
function txExtract(row, mc) {
  const out = {};
  // 1) Match EXACTO por nombre normalizado (cubre el export ancho de taxiparks
  //    sin colisiones, p.ej. "new drivers from partner" vs "new profiles from partner").
  for (const [metricName, excelCol] of Object.entries(mc)) {
    const col = TX_COL_BY_NORM[_txNorm(metricName)];
    if (col && out[col] === undefined) out[col] = toN(row[excelCol], metricName);
  }
  // 2) Fallback FUZZY solo para las 7 core (compat con formatos viejos/variantes
  //    cuyos headers no calzan exacto: "Commission", "Viajes", "Active Driver"...).
  //    Solo rellena columnas que el match exacto no encontro.
  const fuzzy = (...needles) => {
    for (const n of needles)
      for (const [mk, excelCol] of Object.entries(mc))
        if (_txNorm(mk).includes(n)) return toN(row[excelCol], mk);
    return undefined;
  };
  const setIf = (col, ...needles) => {
    if (out[col] !== undefined) return;
    const v = fuzzy(...needles);
    if (v !== undefined) out[col] = v;
  };
  setIf("active_drivers", "active driver");
  setIf("new_from_partner", "new drivers from partner", "new profile from partner", "from partner");
  setIf("new_from_service", "new drivers from service", "new profile from service", "from service");
  setIf("reactivated", "reactivat");
  setIf("supply_hours", "supply hour");
  setIf("commission", "commission", "comisi");
  setIf("trips", "trip", "viaje");
  // 3) Compat: si no vinieron las columnas split de "New Drivers" pero si el total,
  //    mandarlo a new_from_partner para que np+ns+re siga cuadrando.
  if (out.new_from_partner === undefined && out.new_from_service === undefined && out.new_drivers !== undefined) {
    out.new_from_partner = out.new_drivers;
  }
  return out;
}

// Consolida `m` dentro de `target` (suma counts, ultima-con-valor gana en ratios).
function txConsolidate(target, m) {
  for (const col in m) {
    const v = m[col];
    if (TX_COUNT_COLS.has(col)) target[col] = (target[col] || 0) + (v || 0);
    else if (target[col] === undefined || (v !== null && v !== undefined && v !== 0)) target[col] = v;
  }
}

// ── PAGINACIÓN PARALELA ───────────────────────────────────────────────────────
// Descarga todas las páginas de una tabla en paralelo (sin esperar página a página)
async function fetchAllPages(table, orderCol) {
  // 1. Contar filas
  const { count, error: cErr } = await sb
    .from(table).select("*", { count: "exact", head: true });
  if (cErr || !count) return []; // fallback a array vacío si falla el count

  const PAGE   = 1000;
  const pages  = Math.ceil(count / PAGE);
  const reqs   = Array.from({ length: pages }, (_, i) =>
    sb.from(table).select("*")
      .order(orderCol, { ascending: true })
      .range(i * PAGE, (i + 1) * PAGE - 1)
  );
  const results = await Promise.all(reqs);
  const rows = [];
  for (const { data, error } of results) {
    if (error) throw error;
    if (data) rows.push(...data);
  }
  return rows;
}

// ── FLEETROOM-AWARE PREDICATES (slicing por sub-flota) ────────────────────────
// Fuente de verdad por fila:
//   - Si la fila tiene db_id real (!=''), manda el tagging del fleetroom
//     (tabla fleetrooms → STATE.FLEETROOM_*).
//   - Si es legacy (db_id=''), cae al flag por CLID (partners.is_tuktuk →
//     CLID_IS_TUKTUK). Asi la data historica sigue funcionando sin db_id.

// TRUE si la fila pertenece a una operacion TukTuk.
function rowIsTuktuk(r) {
  const id = r.db_id;
  if (id) return !!(STATE.FLEETROOM_IS_TUKTUK || {})[id];
  return !!(STATE.CLID_IS_TUKTUK || {})[r.clid];        // fallback legacy
}

// TRUE si la fila debe EXCLUIRSE del calculo Taxi.
// = es tuktuk  O  el fleetroom esta marcado exclude_from_taxi (ej. delivery).
// Para legacy (db_id=''), solo aplica CLID_IS_TUKTUK (no hay exclude por CLID).
function rowExcludedFromTaxi(r) {
  const id = r.db_id;
  if (id) {
    return !!(STATE.FLEETROOM_IS_TUKTUK || {})[id]
        || !!(STATE.FLEETROOM_EXCLUDE_TAXI || {})[id];
  }
  return !!(STATE.CLID_IS_TUKTUK || {})[r.clid];        // fallback legacy
}

// TRUE si la fila pertenece a una sub-flota Fleet (para KPIs Fleet en present2).
function rowIsFleet(r) {
  const id = r.db_id;
  if (id) return !!(STATE.FLEETROOM_IS_FLEET || {})[id];
  return !!(STATE.CLID_IS_FLEET || {})[r.clid];         // fallback legacy
}

// Anti-doble-conteo (no destructivo, load-time): si para una (clid,city,date)
// existe >=1 fila con db_id real, descarta la fila legacy agregada (db_id='')
// de esa misma clave. Evita sumar dos veces cuando un periodo se resubio con
// detalle por fleetroom sin borrar el agregado viejo. La fila legacy sigue en BD.
function dropLegacyAggregateRows(rows) {
  const hasReal = new Set();
  for (const r of rows) {
    if (r.db_id) hasReal.add(`${r.clid}|||${r.city}|||${r.date}`);
  }
  if (!hasReal.size) return rows;                        // nada con detalle: no-op
  return rows.filter(r =>
    r.db_id || !hasReal.has(`${r.clid}|||${r.city}|||${r.date}`)
  );
}

// ── LOAD FROM SUPABASE ────────────────────────────────────────────────────────
async function loadFromSupabase() {
  showLoad(true, "Cargando datos desde Supabase...");
  try {
    // 1. Partners + Rendimiento semanal en paralelo
    const [partners, rend] = await Promise.all([
      sb.from("partners").select("*").then(r => { if (r.error) throw r.error; return r.data; }),
      fetchAllPages("rendimiento", "fecha")
    ]);

    if (partners && partners.length) {
      STATE.CLID_MAP = {};
      STATE.KAM_MAP  = {};
      STATE.CLID_IS_FLEET  = {};
      STATE.CLID_IS_TUKTUK = {};
      partners.forEach(r => {
        // Trim defensivo: si la BD tiene "Manuel " con espacio, se normaliza al cargar
        // (evita KAMs duplicados visualmente identicos pero distintos por whitespace)
        const clidT    = (r.clid    || "").trim();
        const partnerT = (r.partner || "").trim();
        const kamT     = (r.kam     || "").trim();
        STATE.CLID_MAP[clidT] = partnerT;
        STATE.KAM_MAP[clidT]  = kamT;
        STATE.CLID_IS_FLEET[clidT]  = r.is_fleet === true;
        STATE.CLID_IS_TUKTUK[clidT] = r.is_tuktuk === true;
        if (kamT && !KAM_COLORS[kamT]) KAM_COLORS[kamT] = hashColor(kamT);
      });
      rebuildKAMPartners();
    }
    // Invalidar caches que dependen de KAM_MAP/CLID_MAP tras un CRUD
    STATE._partnerKAM = null;

    // Fleetrooms: tagging por sub-flota (keyed by db_id). La tabla puede no
    // existir aun / estar vacia (data legacy sin db_id) → try/catch silencioso.
    // Debe cargarse ANTES de construir rawData (usa FLEETROOM_NAME) y antes de
    // los filtros de slicing (rowIsTuktuk/rowExcludedFromTaxi).
    STATE.FLEETROOM_IS_TUKTUK    = {};
    STATE.FLEETROOM_IS_FLEET     = {};
    STATE.FLEETROOM_EXCLUDE_TAXI = {};
    STATE.FLEETROOM_NAME         = {};
    try {
      const { data: frooms } = await sb.from("fleetrooms").select("*");
      (frooms || []).forEach(f => {
        const id = (f.db_id || "").trim();
        if (!id) return;
        STATE.FLEETROOM_IS_TUKTUK[id]    = f.is_tuktuk === true;
        STATE.FLEETROOM_IS_FLEET[id]     = f.is_fleet === true;
        STATE.FLEETROOM_EXCLUDE_TAXI[id] = f.exclude_from_taxi === true;
        STATE.FLEETROOM_NAME[id]         = (f.name || "").trim();
      });
    } catch (_) { /* tabla fleetrooms no existe aun */ }

    STATE.rawData = (rend || []).map(r => ({
      clid:          (r.clid || "").trim(),
      // Nombre efectivo: Configuracion (partners) gana, sino el que vino de la BD
      partner:       STATE.CLID_MAP[r.clid] || r.partner,
      // Nombre original del Excel: lo que esta en la BD (siempre lo crudo del upload)
      _partnerExcel: r.partner || "",
      kam:           STATE.KAM_MAP[r.clid] || r.kam || "",
      city:          normCity(r.city),
      date:          r.fecha,
      // Fleetroom (sub-flota): db_id estable + nombre (tagging table gana sobre
      // el crudo del Excel). '' en filas legacy sin desglose.
      db_id:         (r.db_id || "").trim(),
      fleetroom:     STATE.FLEETROOM_NAME[(r.db_id || "").trim()] || r.fleetroom || "",
      activeDrivers: +r.active_drivers,
      newPartner:    +r.new_from_partner,
      newService:    +r.new_from_service,
      reactivated:   +r.reactivated,
      supplyHours:   +r.supply_hours,
      commission:    +r.commission,
      trips:         +r.trips,
      ...txRowExtra(r)
    }));

    // 3. Rendimiento mensual → carga diferida (ver loadMensualIfNeeded)

    // 4. Metas
    const { data: metas, error: mErr } = await sb.from("metas").select("*");
    if (mErr) throw mErr;
    STATE.metasData = (metas || []).map(m => ({
      partner: STATE.CLID_MAP[m.clid] || m.partner,
      kam:     STATE.KAM_MAP[m.clid] || m.kam || "",
      city:    normCity(m.city),
      // Normalizar mes a UPPERCASE en cliente: la BD tiene mezcla de "mayo",
      // "Mayo", "MAYO" por uploads viejos. Sin esto, m.mes !== mesName falla
      // por casing y los %% de cumplimiento salen inflados/incompletos.
      mes:     (m.mes || "").trim().toUpperCase(),
      mA:      +m.meta_active_drivers,
      mNR:     +m.meta_nr,
      mH:      +m.meta_supply_hours
    }));

    // 5. Proyectos (tabla puede no existir aún — fallo silencioso)
    try {
      const { data: proyectos } = await sb.from("proyectos").select("*").order("semana", { ascending: false });
      STATE.proyectosData = proyectos || [];
    } catch (_) { STATE.proyectosData = []; }

    // 5b. Flotas (tabla puede no existir aún — fallo silencioso, no es critico)
    // STATE.flotasMap[clid] = { nombre_asignado, kam, ciudad, activo, nombre_original }
    // Si existe, se aplica override: el partner del rendimiento se reemplaza por
    // nombre_asignado, y el KAM tambien si la flota lo define.
    STATE.flotasMap = {};
    try {
      const { data: flotas } = await sb.from("flotas").select("*");
      (flotas || []).forEach(f => {
        const clidT = (f.clid || "").trim();
        if (!clidT) return;
        STATE.flotasMap[clidT] = {
          nombre_asignado: (f.nombre_asignado || "").trim(),
          nombre_original: (f.nombre_original || "").trim(),
          kam:             (f.kam || "").trim(),
          ciudad:          normCity(f.ciudad),
          activo:          f.activo !== false
        };
      });
    } catch (_) { /* tabla no existe aún */ }

    // Aplicar override de flotas a rawData (semanal) + metasData
    STATE.rawData    = applyFlotasOverride(STATE.rawData);
    STATE.metasData  = applyFlotasOverride(STATE.metasData);
    // Reconstruir KAM_PARTNERS para que el sidebar refleje override de flotas
    // (el primer rebuild que corrio dentro del bloque de partners no tenia
    // flotasMap todavia).
    rebuildKAMPartners();

    // Anti-doble-conteo: descartar la fila legacy agregada (db_id='') de una
    // (clid,city,date) si ya existe detalle por fleetroom. Antes de rawDataFull.
    STATE.rawData = dropLegacyAggregateRows(STATE.rawData);

    // 6. Guardar copia completa y aplicar filtro de palabras prohibidas
    STATE.rawDataFull = [...STATE.rawData];

    // Slice TukTuk: se separa de rawDataFull ANTES del filtro de bannedWords,
    // para no depender de esas palabras. Incluye fleetrooms marcados is_tuktuk
    // (por db_id) o, para filas legacy sin db_id, CLIDs is_tuktuk. Estos se
    // EXCLUYEN del resto del dashboard (solo se ven en Presentación 2.0, TukTuk).
    STATE.rawDataTuktuk = STATE.rawDataFull.filter(r => rowIsTuktuk(r));
    STATE._tuktukByCityDate = new Map();
    STATE.rawDataTuktuk.forEach(r => {
      const k = `${r.city}|||${r.date}`;
      let a = STATE._tuktukByCityDate.get(k);
      if (!a) { a = []; STATE._tuktukByCityDate.set(k, a); }
      a.push(r);
    });
    STATE._tuktukPartners = [...new Set(STATE.rawDataTuktuk.map(r => r.partner))].sort();
    STATE._tuktukDates    = [...new Set(STATE.rawDataTuktuk.map(r => r.date))].sort();

    if (STATE.bannedWords && STATE.bannedWords.length) {
      const banned   = STATE.bannedWords.map(w => w.toLowerCase());
      const isBanned = name => banned.some(w => (name || "").toLowerCase().includes(w));
      STATE.rawData  = STATE.rawData.filter(r => !isBanned(r.partner));
    }
    // Excluir del dataset Taxi los fleetrooms tuktuk o exclude_from_taxi (o,
    // legacy, CLIDs is_tuktuk). No contaminan otras pestañas.
    STATE.rawData = STATE.rawData.filter(r => !rowExcludedFromTaxi(r));
    // Referencia fija al dataset semanal filtrado (C6: elimina backup lazy _rawDataSemanal)
    STATE._semanalData = STATE.rawData;

    STATE.parseWarnings.clear();
    updateIndexes();          // construye indices secundarios sobre rawData
    // popSidebarUI > restoreFilters > onKAMChange dispararia un render aqui;
    // suprimimos para hacer un render unico ordenado abajo.
    STATE._suppressRestoreRender = true;
    if (typeof popSidebarUI === "function") popSidebarUI();
    STATE._suppressRestoreRender = false;
    const warnSuffix = STATE.parseWarnings.size
      ? ` · ⚠ ${STATE.parseWarnings.size} campo(s) inválido(s)` : "";
    showBanner(true, "Datos cargados · " + new Date().toLocaleTimeString("es-PE") + warnSuffix);

    // Render solo el tab activo (mismo patron que applyFilters/switchMode).
    // Antes se llamaba renderRend()+renderMetas() incondicional: trabajo
    // desperdiciado si el usuario estaba en otro tab al terminar el upload,
    // y race condition con applyFilters() debounced.
    if (STATE.rawData.length) {
      if (STATE.curTab === "rend")                                        renderRend();
      if (STATE.curTab === "metas"       && STATE.metasData.length)       renderMetas();
      if (STATE.curTab === "ops"         && typeof renderOps === "function")         renderOps();
      if (STATE.curTab === "insights"    && typeof renderInsights === "function")    renderInsights();
      if (STATE.curTab === "unifview"    && typeof renderUnifView === "function")    renderUnifView();
      if (STATE.curTab === "partnerview" && typeof renderPartnerView === "function") renderPartnerView();
      if (STATE.curTab === "calculator"  && typeof renderCalculator === "function")  renderCalculator();
      if (STATE.curTab === "rawdata"     && typeof renderRawData === "function")     renderRawData();
    }

  } catch (err) {
    showBanner(false, "Error al cargar: " + err.message);
    console.error(err);
  }
  showLoad(false);
}

// ── LAZY LOAD MENSUAL ─────────────────────────────────────────────────────────
async function loadMensualIfNeeded() {
  if (STATE._mensualLoaded) return; // ya cargado
  showLoad(true, "Cargando datos mensuales...");
  try {
    const rendM = await fetchAllPages("rendimiento_mensual", "mes");
    STATE.rawDataMensual = rendM.map(r => ({
      clid:          (r.clid || "").trim(),
      partner:       STATE.CLID_MAP[r.clid] || r.partner,
      _partnerExcel: r.partner || "",
      kam:           STATE.KAM_MAP[r.clid]  || r.kam || "",
      city:          normCity(r.city),
      date:          r.mes,
      db_id:         (r.db_id || "").trim(),
      fleetroom:     STATE.FLEETROOM_NAME?.[(r.db_id || "").trim()] || r.fleetroom || "",
      activeDrivers: +r.active_drivers,
      newPartner:    +r.new_from_partner,
      newService:    +r.new_from_service,
      reactivated:   +r.reactivated,
      supplyHours:   +r.supply_hours,
      commission:    +r.commission,
      trips:         +r.trips,
      ...txRowExtra(r)
    }));
    STATE.rawDataMensual = dropLegacyAggregateRows(STATE.rawDataMensual);
    STATE.rawDataMensualFull = [...STATE.rawDataMensual];
    if (STATE.bannedWords && STATE.bannedWords.length) {
      const banned   = STATE.bannedWords.map(w => w.toLowerCase());
      const isBanned = name => banned.some(w => (name || "").toLowerCase().includes(w));
      STATE.rawDataMensual = STATE.rawDataMensual.filter(r => !isBanned(r.partner));
    }
    // Excluir tuktuk/exclude_from_taxi por fleetroom (o CLID legacy).
    STATE.rawDataMensual = STATE.rawDataMensual.filter(r => !rowExcludedFromTaxi(r));
    // Aplicar mapeo de flotas tambien al dataset mensual
    STATE.rawDataMensual = applyFlotasOverride(STATE.rawDataMensual);
    STATE._mensualLoaded = true;
  } catch(err) {
    showBanner(false, "Error al cargar mensual: " + err.message);
  }
  showLoad(false);
}

// ── LAZY LOAD DIARIO ──────────────────────────────────────────────────────────
async function loadDiarioIfNeeded() {
  if (STATE._diarioLoaded) return;
  showLoad(true, "Cargando datos diarios...");
  try {
    const rendD = await fetchAllPages("rendimiento_diario", "date");
    STATE.rawDataDiario = rendD.map(r => ({
      clid:          (r.clid || "").trim(),
      partner:       STATE.CLID_MAP[r.clid] || r.partner || r.clid,
      _partnerExcel: r.partner || "",
      kam:           STATE.KAM_MAP[r.clid]  || r.kam || "",
      city:          normCity(r.city),
      date:          r.date,
      db_id:         (r.db_id || "").trim(),
      fleetroom:     STATE.FLEETROOM_NAME?.[(r.db_id || "").trim()] || r.fleetroom || "",
      activeDrivers: +r.active_drivers || 0,
      newPartner:    +r.new_partner    || 0,
      newService:    +r.new_service    || 0,
      reactivated:   +r.reactivated    || 0,
      supplyHours:   +r.supply_hours   || 0,
      commission:    +r.commission     || 0,
      trips:         +r.trips          || 0,
      ...txRowExtra(r)
    }));
    STATE.rawDataDiario = dropLegacyAggregateRows(STATE.rawDataDiario);
    STATE.rawDataDiarioFull = [...STATE.rawDataDiario];
    if (STATE.bannedWords && STATE.bannedWords.length) {
      const banned   = STATE.bannedWords.map(w => w.toLowerCase());
      const isBanned = name => banned.some(w => (name || "").toLowerCase().includes(w));
      STATE.rawDataDiario = STATE.rawDataDiario.filter(r => !isBanned(r.partner));
    }
    // Excluir tuktuk/exclude_from_taxi por fleetroom (o CLID legacy).
    STATE.rawDataDiario = STATE.rawDataDiario.filter(r => !rowExcludedFromTaxi(r));
    // Aplicar mapeo de flotas tambien al dataset diario
    STATE.rawDataDiario = applyFlotasOverride(STATE.rawDataDiario);
    STATE._diarioLoaded = true;
  } catch (err) {
    showBanner(false, "Error al cargar diario: " + err.message);
  }
  showLoad(false);
}

// ── LAZY LOAD CONVERSION (funnel por CLID, nivel pais) ────────────────────────
async function loadConversionIfNeeded() {
  if (STATE._conversionLoaded) return;
  try {
    const rows = await fetchAllPages("conversion_pais", "mes");
    STATE.conversionData = (rows || []).map(r => {
      const clid = (r.clid || "").trim();
      return {
        clid,
        partner:       STATE.CLID_MAP[clid] || r.partner || "",
        kam:           STATE.KAM_MAP[clid]  || "",
        mes:           r.mes,
        activeDrivers: +r.active_drivers || 0,
        newDrivers:    +r.new_drivers    || 0,
        firstOrder:    r.first_order  == null ? null : +r.first_order,
        n5:            r.n5_success   == null ? null : +r.n5_success,
        n10:           r.n10_success  == null ? null : +r.n10_success,
        n25:           r.n25_success  == null ? null : +r.n25_success,
        n50:           r.n50_success  == null ? null : +r.n50_success,
        n100:          r.n100_success == null ? null : +r.n100_success,
        // Adquisición por canal (conteos de nuevos drivers; 2da pestaña del Excel)
        agencyScouts:    +r.agency_scouts    || 0,
        organicPartner:  +r.organic_partner  || 0,
        organicScouts:   +r.organic_scouts   || 0,
        organicYango:    +r.organic_yango    || 0,
        paidYango:       +r.paid_yango       || 0,
        partnerScouts:   +r.partner_scouts   || 0,
        referralPartner: +r.referral_partner || 0,
        referralYango:   +r.referral_yango   || 0
      };
    });
    STATE._conversionLoaded = true;
  } catch (err) {
    // La tabla puede no existir en entornos viejos — fallo silencioso, no critico.
    STATE.conversionData = [];
    STATE._conversionLoaded = true; // no reintentar en cada render
  }
}

// ── UPLOAD RENDIMIENTO MENSUAL ────────────────────────────────────────────────
async function uploadRendimientoMensual(rows) {
  if (!rows.length) throw new Error("Archivo vacío");

  const keys = Object.keys(rows[0]);
  const mesColMap = {};
  const { cDbId, cName } = _fleetroomCols(keys);

  // Detectar columnas con formato MM.YYYY o DD.MM.YYYY - Métrica
  keys.forEach(k => {
    let iso;
    const m1 = k.match(/^(\d{2})\.(\d{4})\s*-\s*(.+)$/);
    const m2 = k.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(.+)$/);
    if (m1) {
      iso = `${m1[2]}-${m1[1]}`; // MM.YYYY → YYYY-MM
    } else if (m2) {
      iso = `${m2[3]}-${m2[2]}`; // DD.MM.YYYY → YYYY-MM (ignora el día)
    } else return;
    if (!mesColMap[iso]) mesColMap[iso] = {};
    const metrica = m1 ? m1[3].trim().toLowerCase() : m2[4].trim().toLowerCase();
    mesColMap[iso][metrica] = k;
  });

  // Agregar por clid+city+mes para evitar duplicados (registro unico TX_COL_BY_NORM)
  const agg = {};
  rows.forEach(row => {
    const clid    = String(row["CLID"] || row["clid"] || "").trim();
    // Guardamos el partner TAL CUAL del Excel (no lo pisamos con CLID_MAP); la
    // resolucion al nombre configurado se hace al CARGAR desde Supabase.
    const partner = String(row["Partner"] || row["partner"] || "").trim() || clid || "Unknown";
    const kam  = STATE.KAM_MAP[clid] || "";
    const city = normCity(row["City"] || row["city"] || row["Ciudad"]);
    const db_id     = cDbId ? String(row[cDbId] || "").trim() : "";
    const fleetroom = cName ? String(row[cName] || "").trim() : (db_id ? partner : "");

    Object.entries(mesColMap).forEach(([mes, mc]) => {
      const m = txExtract(row, mc);
      if (!Object.values(m).some(v => v)) return;
      const k = `${clid}|||${city}|||${mes}|||${db_id}`;
      if (!agg[k]) agg[k] = { clid, partner, kam, city, mes, db_id, fleetroom };
      txConsolidate(agg[k], m);
    });
  });

  const flat = Object.values(agg);
  if (!flat.length) throw new Error("No se encontraron datos. Verifica que las columnas tengan formato MM.YYYY - Métrica");

  for (let i = 0; i < flat.length; i += 500) {
    const { error } = await sb.from("rendimiento_mensual")
      .upsert(flat.slice(i, i + 500), { onConflict: "clid,city,mes,db_id" });
    if (error) throw error;
  }
  STATE._mensualLoaded = false; // invalidar cache lazy → forzar recarga del dataset mensual
}

// ── UPLOAD RENDIMIENTO DIARIO ─────────────────────────────────────────────────
async function uploadRendimientoDiario(rows) {
  if (!rows.length) throw new Error("Archivo vacío");

  const keys = Object.keys(rows[0]);
  const dateColMap = {};
  const { cDbId, cName } = _fleetroomCols(keys);

  keys.forEach(k => {
    const m = k.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(.+)$/);
    if (!m) return;
    const iso = `${m[3]}-${m[2]}-${m[1]}`; // DD.MM.YYYY → YYYY-MM-DD
    if (!dateColMap[iso]) dateColMap[iso] = {};
    dateColMap[iso][m[4].trim().toLowerCase()] = k;
  });

  const agg = {};
  rows.forEach(row => {
    const clid = String(row["CLID"] || row["clid"] || "").trim();
    const city = normCity(row["City"] || row["city"] || row["Ciudad"]);
    const db_id     = cDbId ? String(row[cDbId] || "").trim() : "";
    const partner   = String(row["Partner"] || row["partner"] || "").trim();
    const fleetroom = cName ? String(row[cName] || "").trim() : (db_id ? partner : "");

    Object.entries(dateColMap).forEach(([date, mc]) => {
      const m = txExtract(row, mc);
      if (!Object.values(m).some(v => v)) return;
      const k = `${clid}|||${city}|||${date}|||${db_id}`;
      if (!agg[k]) agg[k] = { clid, city, date, db_id, fleetroom };
      txConsolidate(agg[k], m);
    });
  });

  // El esquema diario usa new_partner/new_service (no new_from_*) y no tiene
  // columnas partner/kam. Remapear los nombres core antes del upsert.
  // db_id/fleetroom sobreviven en ...rest (no se desestructuran).
  const flat = Object.values(agg).map(o => {
    const { new_from_partner, new_from_service, partner, kam, ...rest } = o;
    if (new_from_partner !== undefined) rest.new_partner = new_from_partner;
    if (new_from_service !== undefined) rest.new_service = new_from_service;
    return rest;
  });
  if (!flat.length) throw new Error("No se encontraron datos. Verifica que las columnas tengan formato DD.MM.YYYY - Métrica");

  for (let i = 0; i < flat.length; i += 500) {
    const { error } = await sb.from("rendimiento_diario")
      .upsert(flat.slice(i, i + 500), { onConflict: "clid,city,date,db_id" });
    if (error) throw error;
  }
  STATE._diarioLoaded = false; // forzar recarga al siguiente switchMode("diario")
}

// ── UPLOAD CONVERSION (funnel por CLID, nivel pais, sin ciudad) ───────────────
// Excel: CLID | Partner(s) | Active Drivers | New Drivers | 01 first_order |
//        02 n5_success | 03 n10_success | 04 n25_success | 05 n50_success | 06 n100_success
// El mes se toma de: (1) prefijo de fecha en algun header, (2) columna MES,
// (3) fallback al mes mas reciente ya cargado (con aviso).
async function uploadConversion(rows) {
  if (!rows.length) throw new Error("Archivo vacío");
  const keys = Object.keys(rows[0]);

  let globalMes = null;
  for (const k of keys) {
    const m2 = k.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const m1 = k.match(/\b(\d{2})\.(\d{4})\b/);
    if (m2) { globalMes = `${m2[3]}-${m2[2]}`; break; }
    if (m1) { globalMes = `${m1[2]}-${m1[1]}`; break; }
  }
  const mesCol = keys.find(k => /^(mes|month)$/i.test(k.trim()));
  if (!globalMes && !mesCol) {
    const all = (STATE.allDates || []).concat((STATE.rawDataMensual || []).map(r => r.date));
    const months = all.map(d => String(d).slice(0, 7)).filter(Boolean).sort();
    globalMes = months.length ? months[months.length - 1] : null;
    if (globalMes) showBanner(true, `Conversión: sin columna MES ni fecha en headers → se asumió el mes ${globalMes}.`);
  }

  // Detecta columna por nombre normalizado (ignora prefijos "01 ", "02 ").
  const pickKey = (...needles) => keys.find(k => {
    const n = _txNorm(k);
    return needles.some(nd => n.includes(nd));
  });
  const cAD   = pickKey("active drivers", "active driver");
  const cND   = pickKey("new drivers", "new driver");
  const cFO   = pickKey("first order");
  const cN5   = pickKey("n5 success");
  const cN10  = pickKey("n10 success");
  const cN25  = pickKey("n25 success");
  const cN50  = pickKey("n50 success");
  const cN100 = pickKey("n100 success");
  // CLID/Partner por nombre normalizado: acepta "Clid", "CLID", "clid",
  // "Partners", etc. (antes se exigia "CLID"/"clid" exacto y "Clid" no calzaba
  // -> todas las filas se descartaban -> "no hay filas validas").
  const cClid    = pickKey("clid");
  const cPartner = pickKey("partners", "partner");

  const seen = new Map();
  rows.forEach(row => {
    const clid    = _clidStr((cClid ? row[cClid] : (row["CLID"] || row["clid"])) || "");
    if (!clid) return;
    const partner = String((cPartner ? row[cPartner] : (row["Partners"] || row["Partner"] || row["partner"])) || "").trim();
    const mes     = mesCol ? String(row[mesCol]).trim() : globalMes;
    if (!mes) return;
    // Funnel a escala 0-100: si XLSX entrego la celda con formato % (fraccion,
    // p.ej. 0.69), la lleva a 69; si ya viene 0-100 la deja. El display agrega "%".
    const pctOf = col => { if (!col) return null; const v = toN(row[col]); return v <= 1.5 ? v * 100 : v; };
    seen.set(`${clid}|||${mes}`, {
      clid, partner, mes,
      active_drivers: cAD ? toN(row[cAD]) : 0,
      new_drivers:    cND ? toN(row[cND]) : 0,
      first_order:    pctOf(cFO),
      n5_success:     pctOf(cN5),
      n10_success:    pctOf(cN10),
      n25_success:    pctOf(cN25),
      n50_success:    pctOf(cN50),
      n100_success:   pctOf(cN100)
    });
  });

  const data = [...seen.values()];
  if (!data.length) throw new Error(
    `No se encontraron filas válidas. CLID detectado: ${cClid || "ninguno"}; ` +
    `funnel first_order: ${cFO || "ninguno"}. Revisa que el Excel tenga una columna CLID ` +
    `y las columnas del funnel (01 first_order, 02 n5_success, …).`);
  for (let i = 0; i < data.length; i += 500) {
    const { error } = await sb.from("conversion_pais")
      .upsert(data.slice(i, i + 500), { onConflict: "clid,mes" });
    if (error) throw error;
  }
  STATE._conversionLoaded = false; // forzar recarga
}

// ── UPLOAD ADQUISICION POR CANAL (2da pestaña del Excel de Conversion) ────────
// Excel: CLID | MAIN PARTNER | Agency Scouts | Organic Partner | Organic Scouts |
//        Organic Yango | Paid Yango | Partner Scouts | Referral Partner |
//        Referral Yango | Suma total
// Mismo grano que conversion_pais (clid, mes). Upsert por (clid, mes) actualizando
// SOLO las columnas de canal (deja intactas las del funnel y viceversa).
async function uploadChannels(rows) {
  if (!rows || !rows.length) return;
  const keys = Object.keys(rows[0]);
  // mes: de header con fecha, columna MES, o el ultimo mes ya cargado (como conversion).
  let globalMes = null;
  for (const k of keys) {
    const m2 = k.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const m1 = k.match(/\b(\d{2})\.(\d{4})\b/);
    if (m2) { globalMes = `${m2[3]}-${m2[2]}`; break; }
    if (m1) { globalMes = `${m1[2]}-${m1[1]}`; break; }
  }
  const mesCol = keys.find(k => /^(mes|month)$/i.test(k.trim()));
  if (!globalMes && !mesCol) {
    const all = (STATE.allDates || []).concat((STATE.rawDataMensual || []).map(r => r.date));
    const months = all.map(d => String(d).slice(0, 7)).filter(Boolean).sort();
    globalMes = months.length ? months[months.length - 1] : null;
  }
  const pickKey = (...needles) => keys.find(k => { const n = _txNorm(k); return needles.some(nd => n.includes(nd)); });
  const cClid    = pickKey("clid");
  const cPartner = pickKey("main partner", "partner");
  const CH = {
    agency_scouts:    pickKey("agency scouts"),
    organic_partner:  pickKey("organic partner"),
    organic_scouts:   pickKey("organic scouts"),
    organic_yango:    pickKey("organic yango", "organic yang"),
    paid_yango:       pickKey("paid yango", "paid yang"),
    partner_scouts:   pickKey("partner scouts"),
    referral_partner: pickKey("referral partner"),
    referral_yango:   pickKey("referral yango", "referral yang")
  };
  const seen = new Map();
  rows.forEach(row => {
    const clid = _clidStr((cClid ? row[cClid] : (row["CLID"] || row["clid"])) || "");
    if (!clid) return;
    const partner = String((cPartner ? row[cPartner] : (row["MAIN PARTNER"] || row["Partner"] || "")) || "").trim();
    const mes = mesCol ? String(row[mesCol]).trim() : globalMes;
    if (!mes) return;
    const rec = { clid, partner, mes };
    for (const [col, key] of Object.entries(CH)) rec[col] = key ? toN(row[key]) : 0;
    seen.set(`${clid}|||${mes}`, rec);
  });
  const data = [...seen.values()];
  if (!data.length) return; // sin filas validas: no critico (la conversion ya cargo)
  for (let i = 0; i < data.length; i += 500) {
    const { error } = await sb.from("conversion_pais")
      .upsert(data.slice(i, i + 500), { onConflict: "clid,mes" });
    if (error) throw error;
  }
  STATE._conversionLoaded = false; // forzar recarga
}

// ── FILE UPLOAD HANDLERS ──────────────────────────────────────────────────────
function initFileHandlers() {
  document.getElementById("fileRend")
    .addEventListener("change", e => handleFile(e.target.files[0], "rendimiento"));
  document.getElementById("fileMetas")
    .addEventListener("change", e => handleFile(e.target.files[0], "metas"));
  document.getElementById("fileData")
    .addEventListener("change", e => handleFile(e.target.files[0], "data"));
  document.getElementById("fileRendMensual")
    .addEventListener("change", e => handleFile(e.target.files[0], "rendimientoMensual"));
  document.getElementById("fileRendDiario")
    .addEventListener("change", e => handleFile(e.target.files[0], "rendimientoDiario"));
  const fF = document.getElementById("fileFlotas");
  if (fF) fF.addEventListener("change", e => handleFile(e.target.files[0], "flotas"));
  const fC = document.getElementById("fileConversion");
  if (fC) fC.addEventListener("change", e => handleFile(e.target.files[0], "conversion"));
}

// Classifies upload errors into user-friendly messages
function describeUploadError(type, err) {
  const base = err.message || "Error desconocido";
  const typeLabel = { rendimiento: "Rendimiento Semanal", rendimientoMensual: "Rendimiento Mensual",
                      rendimientoDiario: "Rendimiento Diario", conversion: "Conversión",
                      metas: "Metas", data: "Partners", flotas: "Flotas" }[type] || type;
  if (base.includes("duplicate") || base.includes("unico") || base.includes("unique"))
    return `Ya existen filas con las mismas claves en ${typeLabel}. Los datos existentes fueron actualizados (upsert).`;
  if (base.includes("JWT") || base.includes("auth") || base.includes("401"))
    return "Error de autenticación. Cierra sesión e inicia de nuevo.";
  if (base.includes("No se encontraron") || base.includes("Archivo vacío"))
    return base;
  if (base.includes("violates") || base.includes("null value"))
    return `Error de formato en ${typeLabel}: hay campos vacíos o columnas incorrectas. Verifica el archivo.`;
  return `Error al procesar ${typeLabel}: ${base}`;
}

async function handleFile(file, type) {
  if (!file) return;

  // Validación de tamaño máximo (10 MB)
  const MAX_MB = 10;
  if (file.size > MAX_MB * 1024 * 1024) {
    showBanner(false, `El archivo excede ${MAX_MB} MB (${(file.size / 1024 / 1024).toFixed(1)} MB). Reduce el tamaño e intenta de nuevo.`);
    return;
  }

  showLoad(true, `Procesando ${type}...`);
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const wb = XLSX.read(ev.target.result, { type: "binary", raw: false, defval: "" });

      // Smart sheet detection
      const sheetNames = wb.SheetNames.map(s => s.toUpperCase());
      let sheetName;
      if (type === "data") {
        sheetName = wb.SheetNames[sheetNames.indexOf("DATOS") >= 0 ? sheetNames.indexOf("DATOS")
          : sheetNames.indexOf("DATA") >= 0 ? sheetNames.indexOf("DATA") : 0];
      } else if (type === "rendimiento" || type === "rendimientoDiario") {
        sheetName = wb.SheetNames[sheetNames.indexOf("RENDIMIENTO") >= 0
          ? sheetNames.indexOf("RENDIMIENTO") : 0];
      } else if (type === "conversion") {
        // La pestaña principal es la de Conversión (funnel); la de canal se lee aparte.
        const ci = sheetNames.findIndex(s => /CONVERSI/.test(s));
        sheetName = wb.SheetNames[ci >= 0 ? ci : 0];
      } else {
        sheetName = wb.SheetNames[sheetNames.indexOf("METAS") >= 0
          ? sheetNames.indexOf("METAS") : 0];
      }

      // raw:true en (casi) todos los uploads: XLSX devuelve el NÚMERO subyacente
      // con precisión completa en vez del texto formateado de display ("1.6M",
      // "51.7K", "1,234,567"). Esto da sumas exactas y conserva CLIDs de 12 dígitos
      // (raw:false los degradaba a notación científica "4.00005E+11").
      // Seguro para rendimiento: los periodos salen de los HEADERS (regex
      // MM.YYYY / DD.MM.YYYY - Métrica), NO de celdas-fecha, así que raw:true no
      // afecta el parseo de fechas. El display sigue redondeando con fmtSmart (K/M).
      // flotas se queda en raw:false (sin números sensibles; evita tocar lo no probado).
      const useRaw = type !== "flotas";
      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName],
        { raw: useRaw, defval: "" });

      if      (type === "data")               await uploadPartners(json);
      else if (type === "rendimiento")       await uploadRendimiento(json);
      else if (type === "rendimientoMensual") await uploadRendimientoMensual(json);
      else if (type === "rendimientoDiario") await uploadRendimientoDiario(json);
      else if (type === "flotas")            await uploadFlotas(json);
      else if (type === "conversion") {
        await uploadConversion(json);
        // 2da pestaña opcional del mismo Excel: adquisición por canal.
        const chIdx = sheetNames.findIndex(s => /ADQUIS|CHANNEL|CANAL/.test(s));
        if (chIdx >= 0) await uploadChannels(
          XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[chIdx]], { raw: useRaw, defval: "" }));
      }
      else                                   await uploadMetas(json);

      await loadFromSupabase();
      // loadFromSupabase NO recarga los datasets lazy (mensual/diario). Si el modo
      // activo es uno de esos, recargarlo y refrescar para reflejar lo recien subido.
      if ((STATE.curMode === "mensual" || STATE.curMode === "diario") && typeof switchMode === "function") {
        await switchMode(STATE.curMode);
      }
    } catch (err) {
      showBanner(false, describeUploadError(type, err));
      console.error(err);
      showLoad(false);
    }
  };
  reader.readAsBinaryString(file);
}

// ── UPLOAD PARTNERS ───────────────────────────────────────────────────────────
async function uploadPartners(rows) {
  const seen = new Set();
  const data = rows.map(r => ({
    clid:    String(r["CLID"]    || r["clid"]    || "").trim(),
    partner: String(r["PARTNER"] || r["Partner"] || r["partner"] || "").trim(),
    kam:     String(r["KAM"]     || r["kam"]     || "").trim(),
    activo:  true
  }))
  .filter(r => r.clid && r.partner && r.kam)
  .filter(r => {
    if (seen.has(r.clid)) return false;
    seen.add(r.clid);
    return true;
  });

  if (!data.length) throw new Error("No se encontraron datos en la hoja DATOS");

  const { error } = await sb.from("partners").upsert(data, { onConflict: "clid" });
  if (error) throw error;
}

// ── UPLOAD FLOTAS ─────────────────────────────────────────────────────────────
// Excel con columnas: CLID | CIUDAD | NOMBRE_ASIGNADO (opcional) | KAM (opcional) | ACTIVO (opcional)
// Si NOMBRE_ASIGNADO esta vacio, se conserva el nombre original del Excel de rendimiento.
//
// Variantes de columna aceptadas (case-insensitive de hecho via fallback list):
//   CLID:            CLID, clid
//   Ciudad:          CIUDAD, Ciudad, CITY, City, city
//   Nombre asignado: NOMBRE_ASIGNADO, Nombre Asignado, nombre_asignado, NOMBRE,
//                    Nombre, ALIAS, Alias, FLOTA, Flota, PARTNER, Partner, partner
//   KAM:             KAM, Kam, kam
//   Activo:          ACTIVO, Activo, activo  (true / false / 1 / 0 / si / no)
async function uploadFlotas(rows) {
  if (!rows.length) throw new Error("Archivo vacío");

  // Helper local: busca en row el primer valor no vacio entre varias keys
  const pick = (r, ...keys) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== "") return r[k];
    }
    return "";
  };

  // Primera pasada: parsear todas las filas (sin dedup aun)
  const skippedNoClid = [];
  const allParsed = rows.map((r, idx) => {
    const clid = _clidStr(pick(r, "CLID", "clid"));
    if (!clid) {
      skippedNoClid.push({ idx: idx + 2 }); // +2: 1 por header, 1 por 0-based
      return null;
    }
    const ciudad          = normCity(pick(r, "CIUDAD", "Ciudad", "CITY", "City", "city"));
    const nombre_asignado = String(pick(r, "NOMBRE_ASIGNADO", "Nombre Asignado", "nombre_asignado", "NOMBRE", "Nombre", "ALIAS", "Alias", "FLOTA", "Flota", "PARTNER", "Partner", "partner")).trim();
    const kam             = String(pick(r, "KAM", "Kam", "kam")).trim();
    const activoRaw       = pick(r, "ACTIVO", "Activo", "activo");
    const activo          = activoRaw === undefined || activoRaw === ""
                              ? true
                              : !/^(0|no|false|inactivo|inactiva)$/i.test(String(activoRaw).trim());
    return {
      clid,
      ciudad,
      nombre_asignado: nombre_asignado || clid,   // si no hay nombre, usar CLID como fallback
      nombre_original: nombre_asignado,           // hoy el Excel solo trae el nombre; el "original" lo infiere rawdata.js
      kam,
      activo
    };
  }).filter(Boolean);

  if (skippedNoClid.length) {
    showBanner(false, `Aviso: ${skippedNoClid.length} fila(s) sin CLID descartada(s).`);
    console.warn("uploadFlotas: filas sin CLID:", skippedNoClid);
  }

  // Dedup por CLID: ultima fila gana (igual que uploadMetas)
  const seen    = new Map();
  const dupKeys = [];
  allParsed.forEach(r => {
    if (seen.has(r.clid)) dupKeys.push({ clid: r.clid, nombre: r.nombre_asignado, ciudad: r.ciudad });
    seen.set(r.clid, r);
  });
  const data = [...seen.values()];

  if (dupKeys.length) {
    const sample = dupKeys.slice(0, 5).map(d => `${d.clid}·${d.nombre || "?"}·${d.ciudad || "?"}`).join("  |  ");
    showBanner(false,
      `Aviso: ${dupKeys.length} fila(s) con CLID duplicado consolidada(s). Se conservo la ULTIMA ocurrencia. Ej: ${sample}` +
      (dupKeys.length > 5 ? "  (ver consola)" : "")
    );
    console.warn("uploadFlotas: duplicados consolidados:", dupKeys);
  }

  if (!data.length) throw new Error("No se encontraron CLIDs validos en el archivo");

  for (let i = 0; i < data.length; i += 500) {
    const { error } = await sb.from("flotas")
      .upsert(data.slice(i, i + 500), { onConflict: "clid" });
    if (error) throw error;
  }
}

// ── ACTUALIZAR UN CAMPO DE UNA FLOTA (edicion inline desde la vista) ──────────
async function updateFlotaField(clid, patch) {
  if (!clid) throw new Error("Falta CLID");
  // Normalizaciones defensivas
  const upd = { ...patch };
  if (upd.ciudad !== undefined) upd.ciudad = normCity(upd.ciudad);
  if (upd.kam    !== undefined) upd.kam    = String(upd.kam || "").trim();
  if (upd.nombre_asignado !== undefined) upd.nombre_asignado = String(upd.nombre_asignado || "").trim();
  const { error } = await sb.from("flotas").update(upd).eq("clid", clid);
  if (error) throw error;
}

// ── CREAR UNA FLOTA NUEVA (cuando no existe registro en la tabla) ─────────────
async function createFlota(clid, partial) {
  if (!clid) throw new Error("Falta CLID");
  const row = {
    clid,
    ciudad:          normCity(partial.ciudad || ""),
    nombre_asignado: String(partial.nombre_asignado || partial.nombre_original || clid).trim(),
    nombre_original: String(partial.nombre_original || "").trim(),
    kam:             String(partial.kam || "").trim(),
    activo:          partial.activo !== false
  };
  const { error } = await sb.from("flotas").insert(row);
  if (error) throw error;
}

// ── MARCAR is_fleet / is_tuktuk POR CLID (desde Vista Flotas) ─────────────────
// Escribe a `partners` (NO a `flotas`) — es un flag independiente del
// edit-mode de flotas. Preserva partner/kam efectivos (fallback si el CLID aun
// no existe en `partners`) y el OTRO flag (para no resetearlo a false).
async function setPartnerFlag(clid, key, value, partnerFallback, kamFallback) {
  if (!clid) throw new Error("Falta CLID");
  const partner  = STATE.CLID_MAP[clid] || partnerFallback || "";
  const kam      = STATE.KAM_MAP[clid]  || kamFallback || "";
  const isFleet  = key === "is_fleet"  ? value : !!(STATE.CLID_IS_FLEET  || {})[clid];
  const isTuktuk = key === "is_tuktuk" ? value : !!(STATE.CLID_IS_TUKTUK || {})[clid];
  const { error } = await sb.from("partners")
    .upsert([{ clid, partner, kam, activo: true, is_fleet: isFleet, is_tuktuk: isTuktuk }], { onConflict: "clid" });
  if (error) throw error;
}

// ── MARCAR is_fleet / is_tuktuk / exclude_from_taxi POR FLEETROOM (db_id) ──────
// Granularidad por sub-flota: escribe a `fleetrooms` (PK db_id). Preserva los
// OTROS dos flags (leidos de STATE.FLEETROOM_*) para no resetearlos a false, y
// el clid/name/kam/city de contexto (para un CLID/fleetroom aun sin fila).
async function setFleetroomFlag(dbId, key, value, ctx = {}) {
  if (!dbId) throw new Error("Falta db_id");
  const isFleet   = key === "is_fleet"          ? value : !!(STATE.FLEETROOM_IS_FLEET     || {})[dbId];
  const isTuktuk  = key === "is_tuktuk"         ? value : !!(STATE.FLEETROOM_IS_TUKTUK    || {})[dbId];
  const excludeTx = key === "exclude_from_taxi" ? value : !!(STATE.FLEETROOM_EXCLUDE_TAXI || {})[dbId];
  const row = {
    db_id: dbId,
    clid:  ctx.clid || null,
    name:  ctx.name || (STATE.FLEETROOM_NAME || {})[dbId] || "",
    kam:   ctx.kam  || null,
    city:  ctx.city ? normCity(ctx.city) : null,
    is_fleet:          isFleet,
    is_tuktuk:         isTuktuk,
    exclude_from_taxi: excludeTx,
    activo:            true
  };
  const { error } = await sb.from("fleetrooms").upsert([row], { onConflict: "db_id" });
  if (error) throw error;
}

// ── UPLOAD RENDIMIENTO (pivot → flat rows) ────────────────────────────────────
async function uploadRendimiento(rows) {
  if (!rows.length) throw new Error("Archivo vacío");

  const keys = Object.keys(rows[0]);
  const dateColMap = {};
  const { cDbId, cName } = _fleetroomCols(keys);

  keys.forEach(k => {
    const m = k.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(.+)$/);
    if (!m) return;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (!dateColMap[iso]) dateColMap[iso] = {};
    dateColMap[iso][m[4].trim().toLowerCase()] = k;
  });

  // Aggregate by clid+city+fecha+db_id to avoid duplicates (registro unico).
  // db_id separa fleetrooms del MISMO clid (antes se colapsaban en 1 fila).
  const agg = {};
  rows.forEach(row => {
    const clid    = String(row["CLID"] || row["clid"] || "").trim();
    // Guardamos el partner TAL CUAL del Excel; la resolucion al nombre
    // configurado se hace al cargar desde BD a memoria.
    const partner = String(row["Partner"] || row["partner"] || "").trim() || clid || "Unknown";
    const kam  = STATE.KAM_MAP[clid] || "";
    const city = normCity(row["City"] || row["city"] || row["Ciudad"]);
    // db_id: id estable de fleetroom (vacio en Excels legacy sin la columna).
    // fleetroom: nombre; columna explicita si existe, sino el Partner del Excel.
    const db_id     = cDbId ? String(row[cDbId] || "").trim() : "";
    const fleetroom = cName ? String(row[cName] || "").trim() : (db_id ? partner : "");

    Object.entries(dateColMap).forEach(([fecha, mc]) => {
      const m = txExtract(row, mc);
      if (!Object.values(m).some(v => v)) return;
      const k = `${clid}|||${city}|||${fecha}|||${db_id}`;
      if (!agg[k]) agg[k] = { clid, partner, kam, city, fecha, db_id, fleetroom };
      txConsolidate(agg[k], m);
    });
  });

  const flat = Object.values(agg);
  if (!flat.length) throw new Error("No se encontraron datos en el archivo");

  // Batch upsert 500 rows at a time
  for (let i = 0; i < flat.length; i += 500) {
    const { error } = await sb.from("rendimiento")
      .upsert(flat.slice(i, i + 500), { onConflict: "clid,city,fecha,db_id" });
    if (error) throw error;
  }
}
// Detecta las columnas db_id (id estable de fleetroom) y nombre de fleetroom
// por header normalizado. Tolerante a casing/espacios ("DB ID", "db_id",
// "Fleetroom", "Sala", "Sub Flota"). Devuelve { cDbId, cName } (claves de
// columna del Excel o undefined). Mismo patron que pickKey de uploadConversion.
function _fleetroomCols(keys) {
  const pick = (except, ...needles) => keys.find(k => {
    if (k === except) return false;
    const n = _txNorm(k);
    return needles.some(nd => n === nd || n.includes(nd));
  });
  const cDbId = pick(null, "db id", "dbid", "fleetroom id", "sala id", "park id", "parkid");
  return {
    cDbId,
    // El nombre del fleetroom suele venir en la columna "Partner" del export de
    // DataLens (City|CLID|db_id|Partner|...); ahi lo toma el uploader como
    // fallback. Solo si el Excel trae una columna EXPLICITA de nombre la usamos.
    // Se excluye la columna db_id para que "fleetroom id" no calce como nombre.
    cName: pick(cDbId, "fleetroom name", "sala", "sub flota", "subflota")
  };
}

// Normaliza un valor de CLID a string entero. Maneja: number (raw),
// string entero, string con decimal trailing, string en notacion cientifica.
// Si detecta cientifica devuelve null (CLID degradado, no usable).
function _clidStr(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return String(Math.trunc(v));
  }
  const s = String(v).trim();
  if (/^-?\d+$/.test(s)) return s;
  if (/^-?\d+\.\d+$/.test(s)) return s.split(".")[0];
  if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) return null; // degradado
  return s;
}

// ── UPLOAD METAS ──────────────────────────────────────────────────────────────
async function uploadMetas(rows) {
  const skippedNoCity = [];
  const skippedBadClid = [];
  const data = rows.map(row => {
    const clid       = _clidStr(row["CLID"] || row["clid"] || "");
    // Captura PARTNER en cualquier casing del Excel
    const partnerXls = String(row["PARTNER"] || row["Partner"] || row["partner"] || "").trim();
    const partner    = (clid && STATE.CLID_MAP[clid]) || partnerXls || clid || "";
    // KAM: 1) lookup en partners (canonico), 2) columna KAM del Excel, 3) vacio.
    // Antes solo se usaba (1) -> partners nuevos sin registro en tabla partners
    // quedaban con kam="" en BD y aparecian como "sin meta asignada" por KAM.
    const kamXls     = String(row["KAM"] || row["Kam"] || row["kam"] || "").trim();
    const kam        = (clid && STATE.KAM_MAP[clid]) || kamXls || "";
    return {
      clid, partner, kam,
      // Mes en UPPERCASE para evitar duplicados "mayo"/"Mayo"/"MAYO" en BD
      mes:  String(row["MES"]    || row["Mes"]    || "").trim().toUpperCase(),
      city: normCity(row["CIUDAD"] || row["Ciudad"]),
      meta_active_drivers: toN(row["ACTIVE DRIVERS"] || row["Active Drivers"] || 0),
      meta_nr:             toN(row["N+R"] || row["n+r"] || 0),
      meta_supply_hours:   toN(row["SUPPLY HOURS"] || row["Supply Hours"] || 0)
    };
  }).filter(r => {
    if (r.clid === null) {
      // CLID en notacion cientifica -> degradado, no recuperable
      skippedBadClid.push({ row: r });
      return false;
    }
    if (!r.partner || !r.mes) return false;
    if (!r.clid) return false;
    if (!r.city) {
      skippedNoCity.push({ partner: r.partner, clid: r.clid, mes: r.mes });
      return false;
    }
    return true;
  });

  if (skippedBadClid.length) {
    showBanner(false,
      `${skippedBadClid.length} fila(s) con CLID en notacion cientifica DESCARTADAS. ` +
      `Formatea la columna CLID como TEXTO en el Excel y resube.`
    );
    console.error("uploadMetas: CLIDs degradados:", skippedBadClid);
  }
  if (skippedNoCity.length) {
    const sample = skippedNoCity.slice(0, 3).map(s => `${s.partner}·${s.mes}`).join("  |  ");
    showBanner(false,
      `Aviso: ${skippedNoCity.length} fila(s) sin CIUDAD ignorada(s). Ej: ${sample}` +
      (skippedNoCity.length > 3 ? "  (ver consola)" : "")
    );
    console.warn("uploadMetas: filas sin city descartadas:", skippedNoCity);
  }

  // Dedupe por (clid, city, mes): mantener la ULTIMA ocurrencia. Postgres falla
  // con "ON CONFLICT DO UPDATE command cannot affect row a second time" si el
  // batch envia 2+ rows que mapean al mismo registro destino (sea por duplicado
  // exacto en el Excel o por constraint UNIQUE en la BD que no incluye `city`).
  const seen     = new Map();   // key -> { row, originalIdx }
  const dupKeys  = [];
  data.forEach((r, idx) => {
    const key = `${r.clid}|||${r.city}|||${r.mes}`;
    if (seen.has(key)) dupKeys.push({ key, partner: r.partner, city: r.city, mes: r.mes });
    seen.set(key, r);   // ultima gana
  });
  const deduped = [...seen.values()];

  if (dupKeys.length) {
    const sample = dupKeys.slice(0, 3)
      .map(d => `${d.partner}·${d.city}·${d.mes}`).join("  |  ");
    showBanner(false,
      `Aviso: ${dupKeys.length} fila(s) duplicada(s) consolidada(s). Ej: ${sample}` +
      (dupKeys.length > 3 ? "  (ver consola para lista completa)" : "")
    );
    console.warn("uploadMetas: duplicados consolidados:", dupKeys);
  }

  const { error } = await sb.from("metas")
    .upsert(deduped, { onConflict: "clid,city,mes" });
  if (error) {
    // Si el constraint en BD es solo (clid,mes) sin city, el error de Postgres
    // sera "cannot affect row a second time". Damos un mensaje accionable.
    if ((error.message || "").includes("affect row a second time")) {
      throw new Error(
        "El UNIQUE constraint de la tabla `metas` no incluye `city`. " +
        "Ejecuta en Supabase SQL:\n" +
        "  ALTER TABLE metas DROP CONSTRAINT IF EXISTS metas_clid_mes_key;\n" +
        "  ALTER TABLE metas ADD CONSTRAINT metas_clid_city_mes_key UNIQUE (clid, city, mes);"
      );
    }
    throw error;
  }
}

// ── UPDATE STATE INDEXES ──────────────────────────────────────────────────────
function updateIndexes() {
  STATE.allDates    = [...new Set(STATE.rawData.map(r => r.date))].sort();
  STATE.allPartners = [...new Set(STATE.rawData.map(r => r.partner))].sort();
  STATE.allPartners.forEach(p => {
    if (!STATE.partnerColors[p]) STATE.partnerColors[p] = hashColor(p);
  });
  // Índices secundarios — todas las consultas frecuentes evitan filter() sobre rawData
  STATE._byDate     = new Map();
  STATE._byPartner  = new Map();
  STATE._byCity     = new Map();
  STATE._byCityDate = new Map();
  STATE._partnerKAM = new Map();
  STATE._partnerIsFleet = new Map();
  STATE.rawData.forEach(r => {
    // _byDate
    let a = STATE._byDate.get(r.date);
    if (!a) { a = []; STATE._byDate.set(r.date, a); }
    a.push(r);
    // _byPartner
    let b = STATE._byPartner.get(r.partner);
    if (!b) { b = []; STATE._byPartner.set(r.partner, b); }
    b.push(r);
    // _byCity
    let c = STATE._byCity.get(r.city);
    if (!c) { c = []; STATE._byCity.set(r.city, c); }
    c.push(r);
    // _byCityDate
    const cdKey = `${r.city}|||${r.date}`;
    let d = STATE._byCityDate.get(cdKey);
    if (!d) { d = []; STATE._byCityDate.set(cdKey, d); }
    d.push(r);
    // _partnerKAM (primer kam no vacío gana)
    if (r.kam && !STATE._partnerKAM.has(r.partner)) {
      STATE._partnerKAM.set(r.partner, r.kam);
    }
    // _partnerIsFleet: true si ALGÚN CLID del partner tiene is_fleet=true
    if ((STATE.CLID_IS_FLEET || {})[r.clid] && !STATE._partnerIsFleet.get(r.partner)) {
      STATE._partnerIsFleet.set(r.partner, true);
    }
  });
  STATE._apdFull = null;   // dataset cambió → invalidar agregado completo
  clearAggCache();
}

// ── HELPERS DE ACCESO ─────────────────────────────────────────────────────────
// Garantiza que los índices secundarios existan antes de leerlos. Si un caller
// se ejecuta antes que updateIndexes (race condition o cache stale), construye
// los índices on-demand. Es no-op si ya están listos.
function ensureIndexes() {
  if (!STATE._byCity || !STATE._byDate) updateIndexes();
}

function getKAMForPartner(partner) {
  if (STATE._partnerKAM?.has(partner)) return STATE._partnerKAM.get(partner);
  // Lazy-build _partnerKAM si fue invalidado o aun no construido (O(n) una sola vez,
  // luego O(1) en lookups subsecuentes). Evita el find() lineal en hot paths.
  if (!STATE._partnerKAM) {
    STATE._partnerKAM = new Map();
    Object.entries(STATE.KAM_MAP).forEach(([clid, kam]) => {
      const p = STATE.CLID_MAP[clid];
      const kamT = (kam || "").trim();
      if (p && kamT && !STATE._partnerKAM.has(p)) {
        STATE._partnerKAM.set(p, kamT);
      }
    });
  }
  return STATE._partnerKAM.get(partner) || "";
}

// Partner es Fleet si ALGÚN CLID suyo tiene is_fleet=true (flag manual en Config).
// Memoizado en updateIndexes (_partnerIsFleet); lazy-build si aún no existe.
function isFleetPartner(partner) {
  if (STATE._partnerIsFleet?.has(partner)) return STATE._partnerIsFleet.get(partner);
  if (!STATE._partnerIsFleet) STATE._partnerIsFleet = new Map();
  const map = STATE.CLID_IS_FLEET || {};
  Object.entries(STATE.CLID_MAP || {}).forEach(([clid, p]) => {
    if (p && map[clid] && !STATE._partnerIsFleet.has(p)) STATE._partnerIsFleet.set(p, true);
  });
  return STATE._partnerIsFleet.get(partner) || false;
}

function getFilteredByDateRange(from, to) {
  if (!STATE._byDate || !STATE._byDate.size) {
    return STATE.rawData.filter(r => r.date >= from && r.date <= to);
  }
  const rows = [];
  for (const [date, arr] of STATE._byDate) {
    if (date >= from && date <= to) rows.push(...arr);
  }
  return rows;
}

function getApdFull() {
  if (!STATE._apdFull) STATE._apdFull = aggPD(STATE.rawData);
  return STATE._apdFull;
}

// ── AGGREGATION (full precision, no intermediate rounding) ────────────────────
// getFiltered() definido mas abajo (version cacheada). La version sin cache fue
// removida porque era sobrescrita silenciosamente por la cacheada al final del
// archivo, causando confusion al editar.

// Step 1: dedup by partner+city+date (consolidates multiple CLIDs)
// Step 2: collapse into partner+date (sums across cities)
function aggPD(data) {
  const s1 = {};
  data.forEach(r => {
    const k = `${r.partner}|||${r.city}|||${r.date}`;
    if (!s1[k]) s1[k] = { partner: r.partner, kam: r.kam, city: r.city, date: r.date,
      ad: 0, np: 0, ns: 0, re: 0, sh: 0, co: 0, tr: 0 };
    const e = s1[k];
    e.ad += r.activeDrivers; e.np += r.newPartner; e.ns += r.newService;
    e.re += r.reactivated;   e.sh += r.supplyHours; e.co += r.commission; e.tr += r.trips;
  });
  const s2 = {};
  Object.values(s1).forEach(r => {
    const k = `${r.partner}|||${r.date}`;
    if (!s2[k]) s2[k] = { partner: r.partner, kam: r.kam, date: r.date,
      activeDrivers: 0, newPartner: 0, newService: 0,
      reactivated: 0, supplyHours: 0, commission: 0, trips: 0 };
    const e = s2[k];
    e.activeDrivers += r.ad; e.newPartner += r.np; e.newService += r.ns;
    e.reactivated   += r.re; e.supplyHours += r.sh; e.commission += r.co; e.trips += r.tr;
  });
  return Object.values(s2).sort((a, b) => a.date.localeCompare(b.date));
}

// date → partner → metrics  (for chart series)
function aggDate(data) {
  const s1 = {};
  data.forEach(r => {
    const k = `${r.partner}|||${r.city}|||${r.date}`;
    if (!s1[k]) s1[k] = { partner: r.partner, date: r.date,
      ad: 0, np: 0, ns: 0, re: 0, sh: 0, co: 0 };
    const e = s1[k];
    e.ad += r.activeDrivers; e.np += r.newPartner; e.ns += r.newService;
    e.re += r.reactivated;   e.sh += r.supplyHours; e.co += r.commission;
  });
  const m = {};
  Object.values(s1).forEach(r => {
    if (!m[r.date]) m[r.date] = {};
    if (!m[r.date][r.partner]) m[r.date][r.partner] = {
      activeDrivers: 0, newPartner: 0, newService: 0,
      reactivated: 0, supplyHours: 0, commission: 0 };
    const e = m[r.date][r.partner];
    e.activeDrivers += r.ad; e.newPartner += r.np; e.newService += r.ns;
    e.reactivated   += r.re; e.supplyHours += r.sh; e.commission += r.co;
  });
  return m;
}

// date → {ad, nr, sh}  (for city line charts)
function aggCityDate(data) {
  const s1 = {};
  data.forEach(r => {
    const k = `${r.partner}|||${r.city}|||${r.date}`;
    if (!s1[k]) s1[k] = { date: r.date, ad: 0, nr: 0, sh: 0 };
    s1[k].ad += r.activeDrivers;
    s1[k].nr += r.newPartner + r.newService + r.reactivated;
    s1[k].sh += r.supplyHours;
  });
  const m = {};
  Object.values(s1).forEach(r => {
    if (!m[r.date]) m[r.date] = { ad: 0, nr: 0, sh: 0 };
    m[r.date].ad += r.ad; m[r.date].nr += r.nr; m[r.date].sh += r.sh;
  });
  return m;
}

// ── FILTROS CENTRALIZADOS ─────────────────────────────────────────────────────
// Lectura unica de los inputs del sidebar. Usar SIEMPRE en lugar de leer el DOM
// directo desde cada modulo: si cambia el HTML, solo se actualiza aqui.
function getCurrentFilters() {
  return {
    city: document.getElementById("cityFilter")?.value || "all",
    from: document.getElementById("dateFrom")?.value   || "",
    to:   document.getElementById("dateTo")?.value     || "",
    kam:  document.getElementById("kamFilter")?.value  || "all",
    selected: getSel()
  };
}

// ── AGGREGATION CACHE ─────────────────────────────────────────────────────────
// LRU de 4 slots. Evita re-computar cuando se alterna entre filtros recientes
// (ej. usuario cambia ciudad A -> B -> A, o vuelve a un tab con filtros previos).
// El slot 0 es el "actual" — aggPDc/aggDatec/aggCityDatec lo usan para sub-caches.
const _CACHE_SIZE = 4;
const _CACHE = [];   // [{ key, filtered, pd, byDate, cityByDate }, ...] (slot 0 = most recent)

function _filterKey() {
  const f = getCurrentFilters();
  return `${STATE.curMode}|${f.city}|${f.from}|${f.to}|${f.selected.slice().sort().join(",")}`;
}

function clearAggCache() { _CACHE.length = 0; }

// Slot "current" (top of LRU). Mantiene compatibilidad con aggPDc/aggDatec/aggCityDatec
// que comparaban contra _C.filtered. Se actualiza al final de getFiltered().
const _C = { filtered: null, pd: null, byDate: null, cityByDate: {} };

function getFiltered() {
  const key = _filterKey();
  // Hit en LRU: promover a slot 0 y restaurar _C
  const hitIdx = _CACHE.findIndex(s => s.key === key);
  if (hitIdx >= 0) {
    const slot = _CACHE[hitIdx];
    if (hitIdx > 0) {
      _CACHE.splice(hitIdx, 1);
      _CACHE.unshift(slot);
    }
    _C.filtered   = slot.filtered;
    _C.pd         = slot.pd;
    _C.byDate     = slot.byDate;
    _C.cityByDate = slot.cityByDate;
    return slot.filtered;
  }

  const f = getCurrentFilters();
  const selSet = new Set(f.selected);

  // Usar índice por fecha si está disponible (O(log n) en lugar de O(n))
  let rows;
  if (STATE._byDate && STATE._byDate.size) {
    rows = [];
    for (const [date, arr] of STATE._byDate) {
      if (date >= f.from && date <= f.to) rows.push(...arr);
    }
    if (f.city !== "all") rows = rows.filter(r => r.city === f.city);
    rows = rows.filter(r => selSet.has(r.partner));
  } else {
    rows = STATE.rawData.filter(r =>
      (f.city === "all" || r.city === f.city) &&
      r.date >= f.from && r.date <= f.to &&
      selSet.has(r.partner)
    );
  }

  // Crear nuevo slot y meterlo al frente
  const slot = { key, filtered: rows, pd: null, byDate: null, cityByDate: {} };
  _CACHE.unshift(slot);
  if (_CACHE.length > _CACHE_SIZE) _CACHE.length = _CACHE_SIZE;

  _C.filtered   = rows;
  _C.pd         = null;
  _C.byDate     = null;
  _C.cityByDate = {};
  return rows;
}

function aggPDc(data) {
  if (data === _C.filtered) {
    if (!_C.pd) _C.pd = aggPD(data);
    // Sincronizar con el slot 0 para que el LRU conserve los sub-caches
    if (_CACHE[0]) _CACHE[0].pd = _C.pd;
    return _C.pd;
  }
  return aggPD(data);
}

function aggDatec(data) {
  if (data === _C.filtered) {
    if (!_C.byDate) _C.byDate = aggDate(data);
    if (_CACHE[0]) _CACHE[0].byDate = _C.byDate;
    return _C.byDate;
  }
  return aggDate(data);
}

function aggCityDatec(data, cityKey) {
  if (data === _C.filtered) {
    if (!_C.cityByDate[cityKey]) _C.cityByDate[cityKey] = aggCityDate(data);
    if (_CACHE[0]) _CACHE[0].cityByDate = _C.cityByDate;
    return _C.cityByDate[cityKey];
  }
  return aggCityDate(data);
}
