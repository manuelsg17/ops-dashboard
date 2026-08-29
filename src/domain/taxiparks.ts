//@ts-nocheck
// domain/taxiparks.ts — Parser del reporte de taxiparks (DataLens "Custom
// Partner Report"). PURO: no lee STATE, no toca el DOM, no habla con Supabase.
//
// POR QUE VIVE ACA Y NO EN data.ts: este parseo tiene que correr en DOS
// lugares — el navegador (subida manual del Excel) y el servidor (la Edge
// Function `ingest-taxiparks`, que recibe el reporte de la tarea programada
// "Dashboard OPS" de kam-managment). Si cada lado tuviera su copia del mapeo de
// las 50 measures, tarde o temprano divergen y el mismo reporte entraria con
// numeros distintos segun por donde se cargo. Mismo criterio que domain/metrics.
//
// ── FORMATO DE ENTRADA (wide) ───────────────────────────────────────────────
// Una fila por (CLID, ciudad, sub-flota) y una COLUMNA por cada combinacion
// fecha x measure:
//
//   City | CLID | db_id | Partner | "01.07.2026 - Active Drivers" | "01.07.2026 - GMV" | ...
//
// El header de fecha es DD.MM.YYYY (formato del export de DataLens).
//
// ── PRECISION (no tocar sin leer esto) ──────────────────────────────────────
// `toN` expande sufijos K/M/B y devuelve los numeros TAL CUAL cuando ya vienen
// como number. Ese passthrough es intencional: un dashboard que lee el valor de
// display ("1.8M") en vez del crudo pierde el 99.9% del valor — fue la causa
// real del GMV "clavado" que se corrigio en jun 2026. Ver la memoria del
// proyecto `excel-upload-full-precision`.

// Normaliza un nombre de measure para el match (case/espacios/simbolos).
export function _txNorm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }


export const TX_COL_BY_NORM = {
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

export const TX_COUNT_COLS = new Set([
  "active_drivers", "new_drivers", "new_from_partner", "new_from_service", "reactivated",
  "supply_hours", "commission", "trips", "gmv", "new_from_partner_50t", "new_from_service_50t",
  "active_cars", "branded_active_cars", "owned_fleet_active_cars", "owned_fleet_branded_active_cars",
  "internal_fleet_sh", "external_fleet_sh", "new_profiles", "new_profiles_partner",
  "new_profiles_partner_50t", "new_profiles_service", "new_profiles_service_50t"
]);

export function toN(v: any, label?: string, onWarn?: (l: string) => void): number {
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
    return toN(sufMatch[1], label, onWarn) * mult;   // propagar el aviso
  }

  // Un valor con % es un PORCENTAJE: "91.45%" son 0.9145, no 91.45.
  //
  // BUG REAL (jul 2026, carga automatica): antes solo se borraba el simbolo y
  // el numero quedaba x100. Con Excel nunca se noto porque XLSX con raw:true
  // entrega la fraccion cruda (0.9145) y el % es solo formato de celda; recien
  // al llegar el dato como STRING desde JSON aparecio. Toda la semana del 20/07
  // entro con las tasas x100.
  const esPorcentaje = s.includes("%");
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
    // "0,914" y "91,450%" son SIEMPRE decimales aunque tengan 3 dígitos tras la
    // coma: nadie escribe "0 mil novecientos catorce", y un % nunca trae
    // separador de miles. Sin esta excepción, una tasa que llega como STRING
    // con exactamente 3 decimales (camino JSON de ingest-taxiparks, el mismo
    // del bug del 20/07) se multiplicaba ×1000 en silencio.
    const intPartC = s.slice(0, s.indexOf(",")).replace(/[+-]/g, "");
    const fraccionC = esPorcentaje || intPartC === "0" || intPartC === "";
    if (!fraccionC && (commaCount > 1 || digitsAfter === 3)) {
      s = s.replace(/,/g, "");                              // 1,234,567 o 1,234 → 1234567 / 1234
    } else {
      s = s.replace(",", ".");                              // 12,5 / 0,914 / 91,450% → decimal
    }
  } else if (hasDot) {
    const dotCount = (s.match(/\./g) || []).length;
    const digitsAfter = s.length - s.lastIndexOf(".") - 1;
    // Misma excepción que la rama de coma: "0.914" y "91.450%" son decimales.
    const intPartD = s.slice(0, s.indexOf(".")).replace(/[+-]/g, "");
    const fraccionD = esPorcentaje || intPartD === "0" || intPartD === "";
    if (!fraccionD && (dotCount > 1 || (digitsAfter === 3 && s.indexOf(".") > 0))) {
      s = s.replace(/\./g, "");                              // 1.234.567 o 1.234 → 1234567 / 1234
    }
    // else dejar el punto como decimal
  }

  const n = parseFloat(s);
  // Aviso por CALLBACK en vez de escribir STATE: es lo unico que ataba esta
  // funcion al navegador. En el servidor no se pasa nada y no pasa nada.
  if (isNaN(n) && label && typeof onWarn === "function") onWarn(label);
  if (isNaN(n)) return 0;
  return esPorcentaje ? n / 100 : n;
}

export function txExtract(row: any, mc: any, onWarn?: (l: string) => void): Record<string, number> {
  const out = {};
  // 1) Match EXACTO por nombre normalizado (cubre el export ancho de taxiparks
  //    sin colisiones, p.ej. "new drivers from partner" vs "new profiles from partner").
  for (const [metricName, excelCol] of Object.entries(mc)) {
    const col = TX_COL_BY_NORM[_txNorm(metricName)];
    if (col && out[col] === undefined) out[col] = toN(row[excelCol], metricName, onWarn);
  }
  // 2) Fallback FUZZY solo para las 7 core (compat con formatos viejos/variantes
  //    cuyos headers no calzan exacto: "Commission", "Viajes", "Active Driver"...).
  //    Solo rellena columnas que el match exacto no encontro.
  const fuzzy = (...needles) => {
    for (const n of needles)
      for (const [mk, excelCol] of Object.entries(mc))
        if (_txNorm(mk).includes(n)) return toN(row[excelCol], mk, onWarn);
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

export function txConsolidate(target, m) {
  for (const col in m) {
    const v = m[col];
    if (TX_COUNT_COLS.has(col)) target[col] = (target[col] || 0) + (v || 0);
    else if (target[col] === undefined || (v !== null && v !== undefined && v !== 0)) target[col] = v;
  }
}

export function _clidStr(v) {
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

export function _fleetroomCols(keys) {
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


// Ciudad canonica: mayusculas sin espacios (espeja core/format.normCity, que no
// se importa para que este modulo no dependa de nada del navegador).
export function normCityValue(c) {
  return String(c || "").trim().toUpperCase();
}

// ── ENTRADA PRINCIPAL ───────────────────────────────────────────────────────
// Convierte las filas WIDE del reporte en las filas LARGAS que espera la BD:
// una por (clid, city, fecha, db_id), que es exactamente la clave UNIQUE de
// `rendimiento` / `rendimiento_mensual` / `rendimiento_diario`.
//
// opts:
//   kamOf(clid)  -> KAM a guardar en la fila. En el navegador viene de
//                   STATE.KAM_MAP; en el servidor se puede omitir (la vista
//                   resuelve el KAM real desde `partners` al leer, asi que este
//                   campo es solo un respaldo del Excel).
//   dateField    -> "fecha" (semanal) | "mes" (mensual) | "date" (diario).
//   onWarn(label)-> se llama por cada measure que no se pudo parsear.
export function parseTaxiparksWide(rows: any[], opts: {
  dateField?: string;
  kamOf?: (clid: string) => string;
  onWarn?: (label: string) => void;
} = {}): Record<string, any>[] {
  if (!rows || !rows.length) throw new Error("Reporte vacio");
  const dateField = opts.dateField || "fecha";
  const kamOf     = opts.kamOf || (() => "");
  const onWarn    = opts.onWarn;

  const keys = Object.keys(rows[0]);
  const { cDbId, cName } = _fleetroomCols(keys);

  // Mapa fecha ISO -> { measureNormalizada: claveDeColumna }
  const dateColMap = {};
  keys.forEach(k => {
    const m = k.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(.+)$/);
    if (!m) return;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (!dateColMap[iso]) dateColMap[iso] = {};
    dateColMap[iso][m[4].trim().toLowerCase()] = k;
  });
  if (!Object.keys(dateColMap).length) {
    throw new Error('Ninguna columna con formato "DD.MM.YYYY - Measure": revisa el export');
  }

  const agg = {};
  rows.forEach(row => {
    const clid = _clidStr(row["CLID"] || row["clid"] || "");
    // El partner se guarda TAL CUAL viene del reporte; la resolucion al nombre
    // configurado en `partners` se hace al leer desde la BD, no al escribir.
    const partner = String(row["Partner"] || row["partner"] || "").trim() || clid || "Unknown";
    const city    = normCityValue(row["City"] || row["city"] || row["Ciudad"]);
    const db_id   = cDbId ? String(row[cDbId] || "").trim() : "";
    const fleetroom = cName ? String(row[cName] || "").trim() : (db_id ? partner : "");

    Object.entries(dateColMap).forEach(([fecha, mc]) => {
      const m = txExtract(row, mc, onWarn);
      // Fila sin ningun valor para esa fecha: no se escribe (el reporte trae
      // la grilla completa aunque el partner no haya operado ese periodo).
      if (!Object.values(m).some(v => v)) return;
      const k = `${clid}|||${city}|||${fecha}|||${db_id}`;
      if (!agg[k]) {
        agg[k] = { clid, partner, kam: kamOf(clid) || "", city, db_id, fleetroom };
        agg[k][dateField] = fecha;
      }
      txConsolidate(agg[k], m);
    });
  });

  const flat = Object.values(agg);
  if (!flat.length) throw new Error("No se encontraron datos en el reporte");
  return flat;
}

// ── COBERTURA DE KPIs ───────────────────────────────────────────────────────
// Todas las columnas que el reporte PUEDE traer. Sirve para responder "¿vinieron
// los 48 KPIs?" comparando contra lo que realmente entro.
export const TX_ALL_COLS: string[] = [...new Set(Object.values(TX_COL_BY_NORM))];

// Que columnas trajeron AL MENOS UN valor distinto de 0/null en el lote.
// Devuelve tambien las que faltaron, que es lo accionable: si una measure deja
// de venir (cambio de nombre en DataLens, se saco del chart), entra como 0 y
// nadie se entera hasta que un grafico se ve plano.
export function coberturaKpis(flat: Record<string, any>[]) {
  const vistos = new Set<string>();
  for (const fila of flat) {
    for (const col of TX_ALL_COLS) {
      const v = fila[col];
      if (v !== undefined && v !== null && v !== 0) vistos.add(col);
    }
  }
  const faltantes = TX_ALL_COLS.filter(c => !vistos.has(c));
  return { total: TX_ALL_COLS.length, ok: vistos.size, faltantes, vistos: [...vistos] };
}

// ── FORMATO LONG ────────────────────────────────────────────────────────────
// Una fila por (clid, ciudad, sub-flota, PERIODO) con las measures como claves,
// usando los MISMOS nombres que el reporte de DataLens ("Active Drivers", …).
//
// POR QUE LOS NOMBRES SE MANTIENEN COMO EN DATALENS: si el llamador mandara ya
// `active_drivers`, tendria que conocer el mapeo de las 50 measures — o sea una
// SEGUNDA copia del mapeo, del lado de kam-managment, que es justo lo que este
// modulo existe para evitar. El pivot lo hace el llamador; el mapeo, nosotros.
//
//   { "city":"Lima", "clid":"400…", "db_id":"077…", "partner":"Lizzo",
//     "date":"2026-07-01", "Active Drivers":2490, "GMV":"1.8M", … }
export function parseTaxiparksLong(records: any[], opts: {
  dateField?: string;
  kamOf?: (clid: string) => string;
  onWarn?: (label: string) => void;
} = {}): Record<string, any>[] {
  if (!records || !records.length) throw new Error("Reporte vacio");
  const dateField = opts.dateField || "fecha";
  const kamOf     = opts.kamOf || (() => "");
  const onWarn    = opts.onWarn;

  const agg: Record<string, any> = {};
  let sinFecha = 0;
  records.forEach(rec => {
    const fecha = _fechaISO(rec.date ?? rec.fecha ?? rec.mes ?? rec.periodo ?? rec.Date);
    if (!fecha) { sinFecha++; return; }
    const clid  = _clidStr(rec.clid ?? rec.CLID ?? "");
    const city  = normCityValue(rec.city ?? rec.City ?? rec.Ciudad);
    const db_id = String(rec.db_id ?? rec.dbId ?? rec["db id"] ?? "").trim();
    const partner = String(rec.partner ?? rec.Partner ?? "").trim() || clid || "Unknown";
    const fleetroom = String(rec.fleetroom ?? rec.Fleetroom ?? "").trim() || (db_id ? partner : "");

    // Las claves que no son measures conocidas se IGNORAN (no se escriben a la
    // base): el llamador no puede inyectar columnas arbitrarias.
    const mc: Record<string, string> = {};
    Object.keys(rec).forEach(k => { mc[k.trim().toLowerCase()] = k; });
    const m = txExtract(rec, mc, onWarn);
    if (!Object.values(m).some(v => v)) return;

    const k = `${clid}|||${city}|||${fecha}|||${db_id}`;
    if (!agg[k]) {
      agg[k] = { clid, partner, kam: kamOf(clid) || "", city, db_id, fleetroom };
      agg[k][dateField] = fecha;
    }
    txConsolidate(agg[k], m);
  });

  if (sinFecha && onWarn) onWarn(`${sinFecha} registro(s) sin fecha reconocible`);
  const flat = Object.values(agg);
  if (!flat.length) throw new Error("No se encontraron datos en el reporte");
  return flat;
}

// Acepta ISO (2026-07-01), DD.MM.YYYY y YYYY-MM. Devuelve "" si no reconoce.
export function _fechaISO(v: any): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s))        return s;         // mensual
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

// ── ADAPTACION AL ESQUEMA DE CADA TABLA ─────────────────────────────────────
// Las tres tablas NO tienen las mismas columnas. Verificado contra la BD:
//
//   columna              rendimiento  rendimiento_mensual  rendimiento_diario
//   kam                       si              si                  NO
//   partner                   si              si                  NO
//   new_from_partner          si              si            se llama new_partner
//   new_from_service          si              si            se llama new_service
//
// El parser produce SIEMPRE el vocabulario de semanal/mensual (que es el del
// reporte); esta funcion lo traduce al esquema real de la tabla destino. Sin
// esto, un upsert a rendimiento_diario falla con "column kam does not exist" —
// y Postgres reporta de a UN error por vez, asi que se arregla uno y aparece el
// siguiente. Pasó exactamente eso al conectar la carga automatica.
//
// Vive acá y no en el uploader del navegador porque los DOS caminos —la subida
// manual y la Edge Function— escriben a las mismas tablas y necesitan la misma
// traduccion.
export function adaptarEsquema(flat: Record<string, any>[], escala: string): Record<string, any>[] {
  if (escala !== "diario") return flat;
  return flat.map(o => {
    // partner y kam se DESCARTAN (la tabla diaria no los tiene). No se pierde
    // informacion util: la app resuelve ambos desde `partners` por clid al leer.
    const { new_from_partner, new_from_service, partner, kam, ...rest } = o;
    if (new_from_partner !== undefined) rest.new_partner = new_from_partner;
    if (new_from_service !== undefined) rest.new_service = new_from_service;
    return rest;
  });
}

// ── SANIDAD DE TASAS ────────────────────────────────────────────────────────
// Estas columnas se guardan como FRACCION (0-1) en toda la historia. Si llegan
// como porcentaje (0-100), los calculos del dashboard —que multiplican por 100
// al mostrar— dan valores x100 y las graficas se vuelven ilegibles.
//
// No se corrige en silencio a proposito: dividir por 100 "por las dudas"
// rompería un dato legitimamente mayor a 1. Se AVISA y quien manda el reporte
// decide.
export const TX_RATE_COLS = [
  "acceptance_rate", "completion_rate", "bad_rated_trips_share",
  "fraud_trips_share", "new_drivers_share", "supply_hours_share",
  "trips_share", "commission_share", "driver_subsidies_by_gmv",
  "driver_support_requests_share"
];

// Columnas de tasa que parecen venir en escala 0-100 en vez de 0-1. Umbral:
// mas del 20% de las filas con valor > 1.5. Un caso aislado puede ser un dato
// raro; la mayoria del lote es un cambio de unidad.
export function detectarTasasEnPorcentaje(flat: Record<string, any>[]): string[] {
  const sospechosas: string[] = [];
  for (const col of TX_RATE_COLS) {
    let conValor = 0, fueraDeRango = 0;
    for (const f of flat) {
      const v = f[col];
      if (v === undefined || v === null || v === 0) continue;
      conValor++;
      if (v > 1.5) fueraDeRango++;
    }
    if (conValor >= 5 && fueraDeRango / conValor > 0.2) sospechosas.push(col);
  }
  return sospechosas;
}
