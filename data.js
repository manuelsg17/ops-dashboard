// data.js — Toda la lógica de datos

// ── UTILS ─────────────────────────────────────────────────────────────────────
function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},62%,46%)`;
}

// Full-precision number parser — never rounds internally.
// Registra en STATE.parseWarnings cuando una celda no es numérica.
function toN(v, label) {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim();
  if (s === "0") return 0;
  if (s.toUpperCase().endsWith("K")) return (parseFloat(s.slice(0, -1)) || 0) * 1000;
  const n = parseFloat(s.replace(/[,%\s]/g, ""));
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
  if (p === null || p === undefined)
    return `<span class="${cls} b-neu">N/A</span>`;
  if (p === 0)
    return c > 0 ? `<span class="${cls} b-pos">NEW</span>`
                 : `<span class="${cls} b-neu">--</span>`;
  const v = ((c - p) / p) * 100;
  const s = v >= 0 ? "+" : "";
  const a = v >= 0 ? "↑" : "↓";
  return `<span class="${cls} ${v >= 0 ? "b-pos" : "b-neg"}">${a}${s}${v.toFixed(1)}%</span>`;
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

// Calculate days elapsed and remaining using the last data date as week start.
// The file date = start of week → add 6 days → end of that week.
// Then compute days remaining in month from that end date.
function calcProjectionDays(lastDate) {
  if (!lastDate) return { daysElapsed: 28, daysRemaining: 0 };
  const endOfWeek = new Date(lastDate);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  const daysElapsed = endOfWeek.getDate(); // day-of-month at end of current week
  const daysInMonth = new Date(
    endOfWeek.getFullYear(), endOfWeek.getMonth() + 1, 0
  ).getDate();
  const daysRemaining = Math.max(daysInMonth - daysElapsed, 0);
  return { daysElapsed, daysRemaining, daysInMonth };
}

// Day-rate projection: total so far + (avg weekly rate / 7) * remaining days
function projA(vals, daysElapsed, daysRemaining) {
  const v = vals.filter(x => x > 0);
  if (!v.length) return 0;
  const total      = v.reduce((s, x) => s + x, 0);
  if (STATE.curMode === "mensual" || daysRemaining === 0) return total;
  const last3      = v.slice(-3);
  const periodRate = last3.reduce((s, x) => s + x, 0) / last3.length;
  // Diario: cada período = 1 día; Semanal: cada período = 7 días
  const dailyRate  = periodRate / (STATE.curMode === "diario" ? 1 : 7);
  return total + dailyRate * daysRemaining;
}

function sumR(rows, fn) { return rows.reduce((s, r) => s + fn(r), 0); }

// Detects if a partner has strictly declined for N consecutive periods.
// Skips partners with gaps in their date sequence (missing weeks = no false positives).
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
  for (let i = 1; i < last.length; i++) {
    if (last[i][metric] >= last[i - 1][metric]) return false;
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
        STATE.CLID_MAP[r.clid] = r.partner;
        STATE.KAM_MAP[r.clid]  = r.kam;
        if (!KAM_COLORS[r.kam]) KAM_COLORS[r.kam] = hashColor(r.kam);
      });
      rebuildKAMPartners();
    }

    STATE.rawData = (rend || []).map(r => ({
      partner:       STATE.CLID_MAP[r.clid] || r.partner,
      kam:           STATE.KAM_MAP[r.clid] || r.kam || "",
      city:          r.city || "",
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
      city:    m.city || "",
      mes:     m.mes,
      mA:      +m.meta_active_drivers,
      mNR:     +m.meta_nr,
      mH:      +m.meta_supply_hours
    }));

    // 5. Proyectos (tabla puede no existir aún — fallo silencioso)
    try {
      const { data: proyectos } = await sb.from("proyectos").select("*").order("semana", { ascending: false });
      STATE.proyectosData = proyectos || [];
    } catch (_) { STATE.proyectosData = []; }

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
    updateIndexes();
    const warnSuffix = STATE.parseWarnings.size
      ? ` · ⚠ ${STATE.parseWarnings.size} campo(s) inválido(s)` : "";
    showBanner(true, "Datos cargados · " + new Date().toLocaleTimeString("es-PE") + warnSuffix);

    if (STATE.rawData.length)   renderRend();
    if (STATE.metasData.length) renderMetas();

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
      partner:       STATE.CLID_MAP[r.clid] || r.partner,
      kam:           STATE.KAM_MAP[r.clid]  || r.kam || "",
      city:          r.city || "",
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
      partner:       STATE.CLID_MAP[r.clid] || r.partner || r.clid,
      kam:           STATE.KAM_MAP[r.clid]  || r.kam || "",
      city:          r.city || "",
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
    const city = String(row["City"] || row["city"] || row["Ciudad"] || "").trim();

    Object.entries(mesColMap).forEach(([mes, mc]) => {
      const v  = col => col ? toN(row[col]) : 0;
      const ad = v(pick(mc, "active driver"));
      const np = v(pick(mc, "new profile from partner", "new profiles from partner", "from partner"));
      const ns = v(pick(mc, "new profile from service", "new profiles from service", "from service"));
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
    const city = String(row["City"] || row["city"] || row["Ciudad"] || "").trim();

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
}

// Classifies upload errors into user-friendly messages
function describeUploadError(type, err) {
  const base = err.message || "Error desconocido";
  const typeLabel = { rendimiento: "Rendimiento Semanal", rendimientoMensual: "Rendimiento Mensual",
                      rendimientoDiario: "Rendimiento Diario",
                      metas: "Metas", data: "Partners" }[type] || type;
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

      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { raw: false, defval: "" });

      if      (type === "data")               await uploadPartners(json);
      else if (type === "rendimiento")       await uploadRendimiento(json);
      else if (type === "rendimientoMensual") await uploadRendimientoMensual(json);
      else if (type === "rendimientoDiario") await uploadRendimientoDiario(json);
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
    const city = String(row["City"] || row["city"] || row["Ciudad"] || "").trim();

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
// ── UPLOAD METAS ──────────────────────────────────────────────────────────────
async function uploadMetas(rows) {
  const data = rows.map(row => {
    const clid    = String(row["CLID"] || row["clid"] || "").trim();
    const partner = STATE.CLID_MAP[clid]
      || String(row["Partner"] || row["partner"] || "").trim() || clid;
    const kam  = STATE.KAM_MAP[clid] || "";
    return {
      clid, partner, kam,
      mes:  String(row["MES"]    || row["Mes"]    || "").trim(),
      city: String(row["CIUDAD"] || row["Ciudad"] || "").trim(),
      meta_active_drivers: toN(row["ACTIVE DRIVERS"] || row["Active Drivers"] || 0),
      meta_nr:             toN(row["N+R"] || row["n+r"] || 0),
      meta_supply_hours:   toN(row["SUPPLY HOURS"] || row["Supply Hours"] || 0)
    };
  }).filter(r => r.partner && r.mes);

  const { error } = await sb.from("metas")
    .upsert(data, { onConflict: "clid,city,mes" });
  if (error) throw error;
}

// ── UPDATE STATE INDEXES ──────────────────────────────────────────────────────
function updateIndexes() {
  STATE.allDates    = [...new Set(STATE.rawData.map(r => r.date))].sort();
  STATE.allPartners = [...new Set(STATE.rawData.map(r => r.partner))].sort();
  STATE.allPartners.forEach(p => {
    if (!STATE.partnerColors[p]) STATE.partnerColors[p] = hashColor(p);
  });
  // Índice por fecha para getFiltered O(log n) en lugar de O(n)
  STATE._byDate = new Map();
  STATE.rawData.forEach(r => {
    let arr = STATE._byDate.get(r.date);
    if (!arr) { arr = []; STATE._byDate.set(r.date, arr); }
    arr.push(r);
  });
  clearAggCache();
}

// ── AGGREGATION (full precision, no intermediate rounding) ────────────────────
function getFiltered() {
  const city = document.getElementById("cityFilter").value;
  const from = document.getElementById("dateFrom").value;
  const to   = document.getElementById("dateTo").value;
  const selSet = new Set(getSel());
  return STATE.rawData.filter(r =>
    (city === "all" || r.city === city) &&
    r.date >= from && r.date <= to &&
    selSet.has(r.partner)
  );
}

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

// ── AGGREGATION CACHE ─────────────────────────────────────────────────────────
// Cache de un solo slot: evita re-computar cuando el filtro no cambió
// (ej. al volver a la misma tab, o al hacer applyFilters sin cambios reales).
const _C = { key: null, filtered: null, pd: null, byDate: null, cityByDate: {} };

function _filterKey() {
  const city = document.getElementById("cityFilter")?.value  || "";
  const from = document.getElementById("dateFrom")?.value    || "";
  const to   = document.getElementById("dateTo")?.value      || "";
  return `${STATE.curMode}|${city}|${from}|${to}|${getSel().sort().join(",")}`;
}

function clearAggCache() { _C.key = null; }

function getFiltered() {
  const key = _filterKey();
  if (_C.key === key) return _C.filtered;
  const city   = document.getElementById("cityFilter").value;
  const from   = document.getElementById("dateFrom").value;
  const to     = document.getElementById("dateTo").value;
  const selSet = new Set(getSel());

  // Usar índice por fecha si está disponible (O(log n) en lugar de O(n))
  let rows;
  if (STATE._byDate && STATE._byDate.size) {
    rows = [];
    for (const [date, arr] of STATE._byDate) {
      if (date >= from && date <= to) rows.push(...arr);
    }
    if (city !== "all") rows = rows.filter(r => r.city === city);
    rows = rows.filter(r => selSet.has(r.partner));
  } else {
    rows = STATE.rawData.filter(r =>
      (city === "all" || r.city === city) &&
      r.date >= from && r.date <= to &&
      selSet.has(r.partner)
    );
  }

  _C.filtered  = rows;
  _C.key       = key;
  _C.pd        = null;
  _C.byDate    = null;
  _C.cityByDate = {};
  return _C.filtered;
}

function aggPDc(data) {
  if (data === _C.filtered) {
    if (!_C.pd) _C.pd = aggPD(data);
    return _C.pd;
  }
  return aggPD(data);
}

function aggDatec(data) {
  if (data === _C.filtered) {
    if (!_C.byDate) _C.byDate = aggDate(data);
    return _C.byDate;
  }
  return aggDate(data);
}

function aggCityDatec(data, cityKey) {
  if (data === _C.filtered) {
    if (!_C.cityByDate[cityKey]) _C.cityByDate[cityKey] = aggCityDate(data);
    return _C.cityByDate[cityKey];
  }
  return aggCityDate(data);
}
