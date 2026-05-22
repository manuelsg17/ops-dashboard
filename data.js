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
// - Sobreescribe `partner` con nombre_asignado (guarda original en _partnerOriginal)
// - Sobreescribe `kam`  con el de la flota (si tiene)
// - Filtra rows cuya flota tiene activo=false
// Llamar despues de cualquier carga/upload que toque rawData, metas, mensual o diario.
function applyFlotasOverride(rows) {
  const map = STATE && STATE.flotasMap;
  if (!map || !Object.keys(map).length) return rows;
  return rows.reduce((acc, r) => {
    const f = map[r.clid];
    if (f && f.activo === false) return acc;   // flota inactiva → excluir
    if (f) {
      if (f.nombre_asignado) {
        if (!r._partnerOriginal) r._partnerOriginal = r.partner;
        r.partner = f.nombre_asignado;
      }
      if (f.kam) r.kam = f.kam;
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
  let s = String(v).trim();
  if (s === "0") return 0;

  // Sufijo K → multiplicar por 1000 (case-insensitive)
  if (s.toUpperCase().endsWith("K")) {
    return toN(s.slice(0, -1), label) * 1000;
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

// Calcula días transcurridos y restantes del mes según el modo:
// - mensual: daysRemaining = 0 (mes ya cerrado)
// - semanal: lastDate = inicio de semana, fin = lastDate + 6 días
// - diario:  lastDate = el día exacto, no se suma nada
function calcProjectionDays(lastDate) {
  if (!lastDate) return { daysElapsed: 28, daysRemaining: 0, daysInMonth: 30 };
  const refEnd = new Date(lastDate);
  if (STATE.curMode === "semanal") {
    // Fin de la semana = inicio + 6 días
    refEnd.setDate(refEnd.getDate() + 6);
  }
  // En diario y mensual, refEnd ya es el último día relevante
  const daysInMonth = new Date(refEnd.getFullYear(), refEnd.getMonth() + 1, 0).getDate();
  // Si refEnd cayó fuera del mes (semana cruza al mes siguiente), tope al final del mes
  let daysElapsed;
  if (STATE.curMode === "diario") {
    daysElapsed = refEnd.getDate();
  } else if (STATE.curMode === "mensual") {
    daysElapsed = daysInMonth;  // mes completo
  } else {
    // semanal: si la semana se pasa al mes siguiente, considerar el mes completo
    const lastDateObj = new Date(lastDate);
    if (refEnd.getMonth() !== lastDateObj.getMonth()) {
      daysElapsed = new Date(lastDateObj.getFullYear(), lastDateObj.getMonth() + 1, 0).getDate();
    } else {
      daysElapsed = refEnd.getDate();
    }
  }
  const daysRemaining = Math.max(daysInMonth - daysElapsed, 0);
  return { daysElapsed, daysRemaining, daysInMonth };
}

// Day-rate projection: total so far + (avg weekly rate / 7) * remaining days
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
      partners.forEach(r => {
        // Trim defensivo: si la BD tiene "Manuel " con espacio, se normaliza al cargar
        // (evita KAMs duplicados visualmente identicos pero distintos por whitespace)
        const clidT    = (r.clid    || "").trim();
        const partnerT = (r.partner || "").trim();
        const kamT     = (r.kam     || "").trim();
        STATE.CLID_MAP[clidT] = partnerT;
        STATE.KAM_MAP[clidT]  = kamT;
        if (kamT && !KAM_COLORS[kamT]) KAM_COLORS[kamT] = hashColor(kamT);
      });
      rebuildKAMPartners();
    }
    // Invalidar caches que dependen de KAM_MAP/CLID_MAP tras un CRUD
    STATE._partnerKAM = null;

    STATE.rawData = (rend || []).map(r => ({
      clid:          (r.clid || "").trim(),
      partner:       STATE.CLID_MAP[r.clid] || r.partner,
      kam:           STATE.KAM_MAP[r.clid] || r.kam || "",
      city:          normCity(r.city),
      date:          r.fecha,
      activeDrivers: +r.active_drivers,
      newPartner:    +r.new_from_partner,
      newService:    +r.new_from_service,
      reactivated:   +r.reactivated,
      supplyHours:   +r.supply_hours,
      commission:    +r.commission,
      trips:         +r.trips
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

    // 6. Guardar copia completa y aplicar filtro de palabras prohibidas
    STATE.rawDataFull = [...STATE.rawData];
    if (STATE.bannedWords && STATE.bannedWords.length) {
      const banned   = STATE.bannedWords.map(w => w.toLowerCase());
      const isBanned = name => banned.some(w => (name || "").toLowerCase().includes(w));
      STATE.rawData  = STATE.rawData.filter(r => !isBanned(r.partner));
    }
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
      kam:           STATE.KAM_MAP[r.clid]  || r.kam || "",
      city:          normCity(r.city),
      date:          r.mes,
      activeDrivers: +r.active_drivers,
      newPartner:    +r.new_from_partner,
      newService:    +r.new_from_service,
      reactivated:   +r.reactivated,
      supplyHours:   +r.supply_hours,
      commission:    +r.commission,
      trips:         +r.trips
    }));
    STATE.rawDataMensualFull = [...STATE.rawDataMensual];
    if (STATE.bannedWords && STATE.bannedWords.length) {
      const banned   = STATE.bannedWords.map(w => w.toLowerCase());
      const isBanned = name => banned.some(w => (name || "").toLowerCase().includes(w));
      STATE.rawDataMensual = STATE.rawDataMensual.filter(r => !isBanned(r.partner));
    }
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
      kam:           STATE.KAM_MAP[r.clid]  || r.kam || "",
      city:          normCity(r.city),
      date:          r.date,
      activeDrivers: +r.active_drivers || 0,
      newPartner:    +r.new_partner    || 0,
      newService:    +r.new_service    || 0,
      reactivated:   +r.reactivated    || 0,
      supplyHours:   +r.supply_hours   || 0,
      commission:    +r.commission     || 0,
      trips:         +r.trips          || 0
    }));
    STATE.rawDataDiarioFull = [...STATE.rawDataDiario];
    if (STATE.bannedWords && STATE.bannedWords.length) {
      const banned   = STATE.bannedWords.map(w => w.toLowerCase());
      const isBanned = name => banned.some(w => (name || "").toLowerCase().includes(w));
      STATE.rawDataDiario = STATE.rawDataDiario.filter(r => !isBanned(r.partner));
    }
    // Aplicar mapeo de flotas tambien al dataset diario
    STATE.rawDataDiario = applyFlotasOverride(STATE.rawDataDiario);
    STATE._diarioLoaded = true;
  } catch (err) {
    showBanner(false, "Error al cargar diario: " + err.message);
  }
  showLoad(false);
}

// ── UPLOAD RENDIMIENTO MENSUAL ────────────────────────────────────────────────
async function uploadRendimientoMensual(rows) {
  if (!rows.length) throw new Error("Archivo vacío");

  const keys = Object.keys(rows[0]);
  const mesColMap = {};

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

  function pick(mc, ...needles) {
    for (const n of needles)
      for (const [mk, col] of Object.entries(mc))
        if (mk.includes(n)) return col;
    return null;
  }

  // Agregar por clid+city+mes para evitar duplicados
  const agg = {};
  rows.forEach(row => {
    const clid    = String(row["CLID"] || row["clid"] || "").trim();
    const partner = STATE.CLID_MAP[clid]
      || String(row["Partner"] || row["partner"] || "").trim()
      || clid || "Unknown";
    const kam  = STATE.KAM_MAP[clid] || "";
    const city = normCity(row["City"] || row["city"] || row["Ciudad"]);

    Object.entries(mesColMap).forEach(([mes, mc]) => {
      const v  = col => col ? toN(row[col]) : 0;
      const ad = v(pick(mc, "active driver"));
      let   np = v(pick(mc, "new profile from partner", "new profiles from partner", "from partner"));
      let   ns = v(pick(mc, "new profile from service", "new profiles from service", "from service"));
      // Si no hay np ni ns separados, intentar capturar "new drivers" combinado
      // (formato comun de region profile de Yango). Lo guardamos en np para que
      // np + ns + re siga sumando el total correcto sin perder datos.
      if (np === 0 && ns === 0) {
        np = v(pick(mc, "new drivers", "nuevos conductores", "new conductor"));
      }
      const re = v(pick(mc, "reactivat"));
      const sh = v(pick(mc, "supply hour"));
      const co = v(pick(mc, "commission", "comisi"));
      const tr = v(pick(mc, "trip", "viaje"));

      if (ad || np || ns || re || sh || co || tr) {
        const k = `${clid}|||${city}|||${mes}`;
        if (!agg[k]) agg[k] = { clid, partner, kam, city, mes,
          active_drivers: 0, new_from_partner: 0, new_from_service: 0,
          reactivated: 0, supply_hours: 0, commission: 0, trips: 0 };
        agg[k].active_drivers   += ad;
        agg[k].new_from_partner += np;
        agg[k].new_from_service += ns;
        agg[k].reactivated      += re;
        agg[k].supply_hours     += sh;
        agg[k].commission       += co;
        agg[k].trips            += tr;
      }
    });
  });

  const flat = Object.values(agg);
  if (!flat.length) throw new Error("No se encontraron datos. Verifica que las columnas tengan formato MM.YYYY - Métrica");

  for (let i = 0; i < flat.length; i += 500) {
    const { error } = await sb.from("rendimiento_mensual")
      .upsert(flat.slice(i, i + 500), { onConflict: "clid,city,mes" });
    if (error) throw error;
  }
}

// ── UPLOAD RENDIMIENTO DIARIO ─────────────────────────────────────────────────
async function uploadRendimientoDiario(rows) {
  if (!rows.length) throw new Error("Archivo vacío");

  const keys = Object.keys(rows[0]);
  const dateColMap = {};

  keys.forEach(k => {
    const m = k.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(.+)$/);
    if (!m) return;
    const iso = `${m[3]}-${m[2]}-${m[1]}`; // DD.MM.YYYY → YYYY-MM-DD
    if (!dateColMap[iso]) dateColMap[iso] = {};
    dateColMap[iso][m[4].trim().toLowerCase()] = k;
  });

  function pick(mc, ...needles) {
    for (const n of needles)
      for (const [mk, col] of Object.entries(mc))
        if (mk.includes(n)) return col;
    return null;
  }

  const agg = {};
  rows.forEach(row => {
    const clid = String(row["CLID"] || row["clid"] || "").trim();
    const city = normCity(row["City"] || row["city"] || row["Ciudad"]);

    Object.entries(dateColMap).forEach(([date, mc]) => {
      const v  = col => col ? toN(row[col]) : 0;
      const ad = v(pick(mc, "active driver"));
      const np = v(pick(mc, "new profile from partner", "new profiles from partner", "from partner"));
      const ns = v(pick(mc, "new profile from service", "new profiles from service", "from service"));
      const re = v(pick(mc, "reactivat"));
      const sh = v(pick(mc, "supply hour"));
      const co = v(pick(mc, "commission", "comisi"));
      const tr = v(pick(mc, "trip", "viaje"));

      if (ad || np || ns || re || sh || co || tr) {
        const k = `${clid}|||${city}|||${date}`;
        if (!agg[k]) agg[k] = { clid, city, date,
          active_drivers: 0, new_partner: 0, new_service: 0,
          reactivated: 0, supply_hours: 0, commission: 0, trips: 0 };
        agg[k].active_drivers += ad;
        agg[k].new_partner    += np;
        agg[k].new_service    += ns;
        agg[k].reactivated    += re;
        agg[k].supply_hours   += sh;
        agg[k].commission     += co;
        agg[k].trips          += tr;
      }
    });
  });

  const flat = Object.values(agg);
  if (!flat.length) throw new Error("No se encontraron datos. Verifica que las columnas tengan formato DD.MM.YYYY - Métrica");

  for (let i = 0; i < flat.length; i += 500) {
    const { error } = await sb.from("rendimiento_diario")
      .upsert(flat.slice(i, i + 500), { onConflict: "clid,city,date" });
    if (error) throw error;
  }
  STATE._diarioLoaded = false; // forzar recarga al siguiente switchMode("diario")
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
}

// Classifies upload errors into user-friendly messages
function describeUploadError(type, err) {
  const base = err.message || "Error desconocido";
  const typeLabel = { rendimiento: "Rendimiento Semanal", rendimientoMensual: "Rendimiento Mensual",
                      rendimientoDiario: "Rendimiento Diario",
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
      } else {
        sheetName = wb.SheetNames[sheetNames.indexOf("METAS") >= 0
          ? sheetNames.indexOf("METAS") : 0];
      }

      // raw:true para metas/partners: conserva precision de CLID (12 digitos).
      // Con raw:false Excel a veces formatea CLIDs largos en notacion cientifica
      // ("4.00005E+11") perdiendo digitos -> CLID degradado en BD.
      // Para rendimiento mantenemos raw:false por compatibilidad con formatos de fecha.
      const useRaw = type === "data" || type === "metas";
      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName],
        { raw: useRaw, defval: "" });

      if      (type === "data")               await uploadPartners(json);
      else if (type === "rendimiento")       await uploadRendimiento(json);
      else if (type === "rendimientoMensual") await uploadRendimientoMensual(json);
      else if (type === "rendimientoDiario") await uploadRendimientoDiario(json);
      else if (type === "flotas")            await uploadFlotas(json);
      else                                   await uploadMetas(json);

      await loadFromSupabase();
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

// ── UPLOAD RENDIMIENTO (pivot → flat rows) ────────────────────────────────────
async function uploadRendimiento(rows) {
  if (!rows.length) throw new Error("Archivo vacío");

  const keys = Object.keys(rows[0]);
  const dateColMap = {};

  keys.forEach(k => {
    const m = k.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(.+)$/);
    if (!m) return;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (!dateColMap[iso]) dateColMap[iso] = {};
    dateColMap[iso][m[4].trim().toLowerCase()] = k;
  });

  function pick(mc, ...needles) {
    for (const n of needles)
      for (const [mk, col] of Object.entries(mc))
        if (mk.includes(n)) return col;
    return null;
  }

  // Aggregate by clid+city+fecha to avoid duplicates
  const agg = {};
  rows.forEach(row => {
    const clid    = String(row["CLID"] || row["clid"] || "").trim();
    const partner = STATE.CLID_MAP[clid]
      || String(row["Partner"] || row["partner"] || "").trim()
      || clid || "Unknown";
    const kam  = STATE.KAM_MAP[clid] || "";
    const city = normCity(row["City"] || row["city"] || row["Ciudad"]);

    Object.entries(dateColMap).forEach(([fecha, mc]) => {
      const v   = col => col ? toN(row[col]) : 0;
      const ad  = v(pick(mc, "active driver"));
      const np  = v(pick(mc, "new profile from partner", "new profiles from partner", "from partner"));
      const ns  = v(pick(mc, "new profile from service", "new profiles from service", "from service"));
      const re  = v(pick(mc, "reactivat"));
      const sh  = v(pick(mc, "supply hour"));
      const co  = v(pick(mc, "commission", "comisi"));
      const tr  = v(pick(mc, "trip", "viaje"));

      if (ad || np || ns || re || sh || co || tr) {
        const k = `${clid}|||${city}|||${fecha}`;
        if (!agg[k]) agg[k] = { clid, partner, kam, city, fecha,
          active_drivers: 0, new_from_partner: 0, new_from_service: 0,
          reactivated: 0, supply_hours: 0, commission: 0, trips: 0 };
        agg[k].active_drivers   += ad;
        agg[k].new_from_partner += np;
        agg[k].new_from_service += ns;
        agg[k].reactivated      += re;
        agg[k].supply_hours     += sh;
        agg[k].commission       += co;
        agg[k].trips            += tr;
      }
    });
  });

  const flat = Object.values(agg);
  if (!flat.length) throw new Error("No se encontraron datos en el archivo");

  // Batch upsert 500 rows at a time
  for (let i = 0; i < flat.length; i += 500) {
    const { error } = await sb.from("rendimiento")
      .upsert(flat.slice(i, i + 500), { onConflict: "clid,city,fecha" });
    if (error) throw error;
  }
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
