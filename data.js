// data.js — Toda la lógica de datos

// ── UTILS ─────────────────────────────────────────────────────────────────────
function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},62%,46%)`;
}

// Full-precision number parser — never rounds internally
function toN(v) {
  const s = String(v || 0).trim();
  if (s.toUpperCase().endsWith("K")) return (parseFloat(s.slice(0, -1)) || 0) * 1000;
  return parseFloat(s.replace(/[,%\s]/g, "")) || 0;
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
function semCls(p) { return p >= 80 ? "sem-g" : p >= 50 ? "sem-y" : "sem-r"; }
function pColor(p) { return p >= 80 ? "#10b981" : p >= 50 ? "#f59e0b" : "#FF0000"; }

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

// Linear projection — full precision, rounding only at display via fmt()
function projA(vals, weeksDone, weeksTotal) {
  const v = vals.filter(x => x > 0);
  if (!v.length) return 0;
  const left = Math.max(weeksTotal - weeksDone, 0);
  const last3 = v.slice(-3);
  const rate  = last3.reduce((s, x) => s + x, 0) / last3.length;
  return v.reduce((s, x) => s + x, 0) + rate * left;
}

// Estimate total weeks in month from date range
function mWeeks(from, to) {
  if (!from || !to) return 4;
  return (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24) > 28 ? 5 : 4;
}

function sumR(rows, fn) { return rows.reduce((s, r) => s + fn(r), 0); }

// Detects if a partner has strictly declined for N consecutive periods
// Uses STATE.declineThreshold (default 3) and STATE.declineMetric (default "activeDrivers")
function hasConsecutiveDecline(apd, partner) {
  const n      = STATE.declineThreshold || 3;
  const metric = STATE.declineMetric || "activeDrivers";
  const rows   = apd
    .filter(r => r.partner === partner)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < n) return false;
  const last = rows.slice(-n);
  for (let i = 1; i < last.length; i++) {
    if (last[i][metric] >= last[i - 1][metric]) return false;
  }
  return true;
}

// ── LOAD FROM SUPABASE ────────────────────────────────────────────────────────
async function loadFromSupabase() {
  showLoad(true, "Cargando datos desde Supabase...");
  try {
    // 1. Partners
    const { data: partners, error: pErr } = await sb.from("partners").select("*");
    if (pErr) throw pErr;
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

    // 2. Rendimiento semanal
    let rend = [], rendPage = 0, rendDone = false;
while (!rendDone) {
  const { data: page, error: pageErr } = await sb
    .from("rendimiento").select("*")
    .order("fecha", { ascending: true })
    .range(rendPage * 1000, (rendPage + 1) * 1000 - 1);
  if (pageErr) throw pageErr;
  if (!page || page.length === 0) { rendDone = true; break; }
  rend = rend.concat(page);
  if (page.length < 1000) rendDone = true;
  rendPage++;
}
    STATE.rawData = (rend || []).map(r => ({
      partner:       r.partner,
      kam:           r.kam || "",
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

    // 3. Rendimiento mensual
   let rendM = [], rendMPage = 0, rendMDone = false;
while (!rendMDone) {
  const { data: pageM, error: pageMErr } = await sb
    .from("rendimiento_mensual").select("*")
    .order("mes", { ascending: true })
    .range(rendMPage * 1000, (rendMPage + 1) * 1000 - 1);
  if (pageMErr) throw pageMErr;
  if (!pageM || pageM.length === 0) { rendMDone = true; break; }
  rendM = rendM.concat(pageM);
  if (pageM.length < 1000) rendMDone = true;
  rendMPage++;
}
    STATE.rawDataMensual = (rendM || []).map(r => ({
      partner:       r.partner,
      kam:           r.kam || "",
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

    // 4. Metas
    const { data: metas, error: mErr } = await sb.from("metas").select("*");
    if (mErr) throw mErr;
    STATE.metasData = (metas || []).map(m => ({
      partner: m.partner,
      kam:     m.kam || "",
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

    updateIndexes();
    showBanner(true, "Datos cargados · " + new Date().toLocaleTimeString("es-PE"));

    if (STATE.rawData.length)   renderRend();
    if (STATE.metasData.length) renderMetas();

  } catch (err) {
    showBanner(false, "Error al cargar: " + err.message);
    console.error(err);
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
}

// Classifies upload errors into user-friendly messages
function describeUploadError(type, err) {
  const base = err.message || "Error desconocido";
  const typeLabel = { rendimiento: "Rendimiento Semanal", rendimientoMensual: "Rendimiento Mensual",
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
      } else if (type === "rendimiento") {
        sheetName = wb.SheetNames[sheetNames.indexOf("RENDIMIENTO") >= 0
          ? sheetNames.indexOf("RENDIMIENTO") : 0];
      } else {
        sheetName = wb.SheetNames[sheetNames.indexOf("METAS") >= 0
          ? sheetNames.indexOf("METAS") : 0];
      }

      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { raw: false, defval: "" });

      if (type === "data")                  await uploadPartners(json);
else if (type === "rendimiento")      await uploadRendimiento(json);
else if (type === "rendimientoMensual") await uploadRendimientoMensual(json);
else                                  await uploadMetas(json);

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
}

// ── AGGREGATION (full precision, no intermediate rounding) ────────────────────
function getFiltered() {
  const city = document.getElementById("cityFilter").value;
  const from = document.getElementById("dateFrom").value;
  const to   = document.getElementById("dateTo").value;
  const sel  = getSel();
  return STATE.rawData.filter(r =>
    (city === "all" || r.city === city) &&
    r.date >= from && r.date <= to &&
    sel.includes(r.partner)
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
