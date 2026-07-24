// fleetexterno.js — Tab "Fleet Externo": EXPLORADOR de la Supabase de un colega.
// Con un SEGUNDO cliente de solo-lectura (anon key), descubre TODAS las tablas y
// columnas expuestas (vía el OpenAPI de PostgREST) y deja navegar cualquiera. Es
// la base para, sobre esa data completa, construir las vistas/KPIs de fleet.
// La config (URL + anon key) se pega desde la UI y vive en localStorage (no se
// commitea). NUNCA usar service_role ni password aquí — el frontend es público.

const FLEET_EXT_STATE = {
  search: "",        // buscador dentro de la tabla seleccionada
  tableFilter: "",   // filtro de la lista de tablas
  table: "",         // tabla actualmente seleccionada
  schema: null,      // [{ name, cols:[{name,type}] }]
  schemaLoaded: false,
  schemaError: null
};
let _fleetExtClientCache = null;

function _fleetExtClient() {
  if (_fleetExtClientCache) return _fleetExtClientCache;
  if (typeof supabase === "undefined" || !supabase.createClient) return null;
  _fleetExtClientCache = supabase.createClient(FLEET_EXT.url, FLEET_EXT.anonKey);
  return _fleetExtClientCache;
}

// Descubre el esquema: GET {url}/rest/v1/ → OpenAPI con todas las tablas/vistas que
// el rol anónimo puede leer, con sus columnas y tipos.
async function loadFleetExtSchema(force) {
  if (!FLEET_EXT.enabled) { FLEET_EXT_STATE.schemaLoaded = true; return; }
  if (FLEET_EXT_STATE.schemaLoaded && !force) return;
  FLEET_EXT_STATE.schemaError = null;
  try {
    const base = FLEET_EXT.url.replace(/\/$/, "") + "/rest/v1/";
    const res = await fetch(base, { headers: { apikey: FLEET_EXT.anonKey, Authorization: "Bearer " + FLEET_EXT.anonKey } });
    if (!res.ok) throw new Error("HTTP " + res.status + " al leer el esquema (¿anon key o grants?).");
    const spec = await res.json();
    const defs = spec.definitions || (spec.components && spec.components.schemas) || {};
    const tables = Object.keys(defs).map(name => {
      const props = (defs[name] && defs[name].properties) || {};
      return { name, cols: Object.keys(props).map(c => ({ name: c, type: (props[c].format || props[c].type || "") })) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    FLEET_EXT_STATE.schema = tables;
    // Selección inicial: la guardada, o la primera que tenga "fleet" en el nombre, o la 1ra.
    if (!FLEET_EXT_STATE.table) {
      const fleety = tables.find(t => /fleet|flota|car|auto/i.test(t.name));
      FLEET_EXT_STATE.table = FLEET_EXT.table || (fleety && fleety.name) || (tables[0] && tables[0].name) || "";
    }
  } catch (e) {
    FLEET_EXT_STATE.schema = null;
    FLEET_EXT_STATE.schemaError = (e && e.message) ? e.message : String(e);
  } finally {
    FLEET_EXT_STATE.schemaLoaded = true;
  }
}

// Lee las filas de la tabla seleccionada.
async function loadFleetExterno(force) {
  const table = FLEET_EXT_STATE.table || FLEET_EXT.table;
  if (!FLEET_EXT.enabled || !table) {
    STATE.fleetExterno = []; STATE.fleetExternoCols = []; STATE.fleetExternoError = null; STATE.fleetExternoLoaded = true;
    return;
  }
  if (STATE.fleetExternoLoaded && !force) return;
  STATE.fleetExternoError = null;
  try {
    const cli = _fleetExtClient();
    if (!cli) throw new Error("La librería de Supabase no está cargada.");
    const { data, error } = await cli.from(table).select("*").limit(5000);
    if (error) throw error;
    STATE.fleetExterno     = data || [];
    STATE.fleetExternoCols = STATE.fleetExterno.length ? Object.keys(STATE.fleetExterno[0]) : [];
  } catch (e) {
    STATE.fleetExterno = []; STATE.fleetExternoCols = [];
    STATE.fleetExternoError = (e && e.message) ? e.message : String(e);
  } finally {
    STATE.fleetExternoLoaded = true;
  }
}

// ── RENDER (orquestador) ───────────────────────────────────────────────────────
function renderFleetExterno() {
  const el = document.getElementById("fleetExternoContent");
  if (!el) return;

  if (!FLEET_EXT.enabled) { el.innerHTML = _fleetExtSetupPanel(); return; }

  if (!FLEET_EXT_STATE.schemaLoaded) {
    el.innerHTML = secH("🛞", "#0ea5e9", "Fleet Externo", "Descubriendo el esquema de la base del colega…", "") +
      `<div class="section" style="color:#64748b;font-size:.85rem;padding:14px">⏳ Leyendo tablas y columnas disponibles…</div>`;
    loadFleetExtSchema().then(() => renderFleetExterno());
    return;
  }
  if (FLEET_EXT_STATE.schemaError) { el.innerHTML = _fleetExtErrorPanel(FLEET_EXT_STATE.schemaError, true); return; }

  // Esquema OK → cargar la tabla seleccionada si falta
  if (!STATE.fleetExternoLoaded) {
    el.innerHTML = _fleetExtExplorer(true);   // esqueleto con "cargando" en el panel de datos
    loadFleetExterno().then(() => renderFleetExterno());
    return;
  }
  el.innerHTML = _fleetExtExplorer(false);
}

// ── PANELES ────────────────────────────────────────────────────────────────────
function _fleetExtSetupPanel() {
  return secH("🛞", "#0ea5e9", "Fleet Externo", "Conectar la base del colega (solo-lectura, en vivo) y explorar toda su data de fleet", "") + `
    <div class="section" style="max-width:720px">
      <div style="font-size:.8rem;color:#334155;background:#f0f9ff;border-left:3px solid #0ea5e9;padding:10px 14px;border-radius:6px;margin-bottom:14px">
        Tu dashboard leerá <strong>en vivo</strong> la base del colega con un segundo cliente de <strong>solo-lectura</strong> y te mostrará <strong>todas las tablas y columnas</strong> que expongas. La <strong>anon key es pública</strong> (la protege el RLS/grants del colega) y se guarda solo en <strong>tu navegador</strong>.
        <div style="margin-top:8px;color:#991b1b"><strong>Nunca</strong> pegues aquí la <code>service_role</code> ni la contraseña de la BD — el frontend es público.</div>
        <div style="margin-top:8px">Como tenés acceso total, en la Supabase del colega: <strong>Settings → API</strong> te da la URL y la <strong>anon key</strong>; y en el <strong>SQL editor</strong> habilitá lectura de las tablas de fleet al rol anónimo, p. ej.:
          <pre style="white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:8px 10px;border-radius:6px;margin-top:6px;font-size:.72rem">grant usage on schema public to anon;
grant select on all tables in schema public to anon;
-- (o table por table: grant select on public.fleet_x to anon;)</pre>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;max-width:560px">
        <label style="font-size:.78rem;color:#475569">URL del proyecto
          <input id="fleetExtUrl" class="crud-input" placeholder="https://xxxx.supabase.co" style="width:100%;margin-top:3px"/>
        </label>
        <label style="font-size:.78rem;color:#475569">Anon / publishable key
          <input id="fleetExtKey" class="crud-input" placeholder="eyJhbGciOi…" style="width:100%;margin-top:3px"/>
        </label>
        <div><button class="crud-btn" onclick="fleetExtSaveConfig()" style="background:#0ea5e9;color:#fff;border-color:#0ea5e9;font-weight:700">Conectar y explorar</button></div>
      </div>
    </div>`;
}

function _fleetExtErrorPanel(msg, isSchema) {
  return secH("🛞", "#ef4444", "Fleet Externo", isSchema ? "No se pudo descubrir el esquema" : "No se pudo leer la tabla", "") + `
    <div class="section" style="max-width:720px">
      <div style="font-size:.82rem;color:#991b1b;background:#fff5f5;border-left:3px solid #ef4444;padding:10px 14px;border-radius:6px">
        <strong>Error:</strong> ${escapeHTML(msg)}
        <ul style="margin:8px 0 0 18px;color:#7f1d1d">
          <li><em>permission denied</em> / vacío: faltan los <strong>grants de SELECT</strong> al rol anónimo (o RLS sin policy).</li>
          <li><em>401 / Invalid API key</em>: la anon key no corresponde a esa URL.</li>
          <li>Error de red/CORS: revisá la URL del proyecto.</li>
        </ul>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="crud-btn" onclick="fleetExtReload()" style="background:#0ea5e9;color:#fff;border-color:#0ea5e9">↻ Reintentar</button>
        <button class="crud-btn" onclick="fleetExtClearConfig()">Reconfigurar</button>
      </div>
    </div>`;
}

// Explorador: lista de tablas (izq) + datos de la tabla seleccionada (der/abajo).
function _fleetExtExplorer(loadingData) {
  const tables = FLEET_EXT_STATE.schema || [];
  const host   = (FLEET_EXT.url || "").replace(/^https?:\/\//, "");
  const tf     = (FLEET_EXT_STATE.tableFilter || "").toLowerCase().trim();
  const shown  = tf ? tables.filter(t => t.name.toLowerCase().includes(tf)) : tables;
  const sel    = FLEET_EXT_STATE.table;
  const selCols = (tables.find(t => t.name === sel) || {}).cols || [];

  let html = secH("🛞", "#0ea5e9", "Fleet Externo",
    `${fmt(tables.length)} tabla(s) descubierta(s) · <span style="font-family:monospace">${escapeHTML(host)}</span> · solo-lectura, en vivo`, "");

  // Barra: filtro de tablas + reconfigurar + refrescar esquema
  html += `
    <div class="section" style="margin-bottom:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="crud-input" id="fleetExtTableFilter" placeholder="Filtrar tablas… (ej. fleet)" value="${(FLEET_EXT_STATE.tableFilter||"").replace(/"/g,"&quot;")}" oninput="fleetExtTableFilterInput(this)" style="min-width:200px;max-width:300px"/>
        <span style="font-size:.72rem;color:#94a3b8">${fmt(shown.length)} de ${fmt(tables.length)}</span>
        <button class="crud-btn" onclick="fleetExtReload()" style="margin-left:auto;padding:4px 10px">↻ Refrescar esquema</button>
        <button class="crud-btn" onclick="fleetExtClearConfig()" style="padding:4px 10px">Reconfigurar</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;max-height:120px;overflow:auto">
        ${shown.map(t => {
          const on = t.name === sel;
          return `<button onclick="selectFleetExtTable('${escapeJSAttr(t.name)}')" class="crud-btn" title="${fmt(t.cols.length)} columnas"
            style="padding:3px 10px;font-size:.74rem;${on ? "background:#0ea5e9;color:#fff;border-color:#0ea5e9;font-weight:700" : ""}">${escapeHTML(t.name)} <span style="opacity:.7">· ${fmt(t.cols.length)}</span></button>`;
        }).join("") || `<span style="color:#94a3b8;font-size:.78rem">Sin tablas (revisá los grants de SELECT al rol anónimo).</span>`}
      </div>
    </div>`;

  if (!sel) return html + `<div class="section" style="color:#64748b;font-size:.85rem;padding:14px">Elegí una tabla para ver su data.</div>`;

  // Columnas de la tabla seleccionada (del esquema)
  html += `
    <details class="section" style="margin-bottom:10px">
      <summary style="cursor:pointer;font-size:.8rem;font-weight:700;color:#334155">📋 Columnas de <code>${escapeHTML(sel)}</code> (${fmt(selCols.length)})</summary>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        ${selCols.map(c => `<span style="font-size:.7rem;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:2px 8px"><strong>${escapeHTML(c.name)}</strong><span style="color:#94a3b8"> ${escapeHTML(c.type)}</span></span>`).join("")}
      </div>
    </details>`;

  // Panel de datos de la tabla seleccionada
  if (loadingData) {
    html += `<div class="section" style="color:#64748b;font-size:.85rem;padding:14px">⏳ Cargando <code>${escapeHTML(sel)}</code>…</div>`;
    return html;
  }
  if (STATE.fleetExternoError) {
    html += `<div class="section"><div style="font-size:.82rem;color:#991b1b;background:#fff5f5;border-left:3px solid #ef4444;padding:10px 14px;border-radius:6px"><strong>Error al leer <code>${escapeHTML(sel)}</code>:</strong> ${escapeHTML(STATE.fleetExternoError)}</div></div>`;
    return html;
  }

  const rows = STATE.fleetExterno || [], cols = STATE.fleetExternoCols || [];
  const q = (FLEET_EXT_STATE.search || "").toLowerCase().trim();
  const filtered = q ? rows.filter(r => cols.some(c => String(r[c] ?? "").toLowerCase().includes(q))) : rows;

  html += `
    <div class="section" style="margin-bottom:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <strong style="font-size:.82rem">${escapeHTML(sel)}</strong>
        <span style="font-size:.72rem;color:#94a3b8">${fmt(rows.length)} fila(s) · ${fmt(cols.length)} col.</span>
        <input class="crud-input" id="fleetExtSearch" placeholder="Buscar en la tabla…" value="${(FLEET_EXT_STATE.search||"").replace(/"/g,"&quot;")}" oninput="fleetExtSearchInput(this)" style="flex:1;min-width:160px;max-width:260px"/>
        <button class="crud-btn" onclick="loadFleetExterno(true).then(renderFleetExterno)" style="padding:4px 10px">↻ Datos</button>
        <button class="crud-btn" onclick="exportFleetExtCSV()" style="background:#f0fdf4;border-color:#86efac;color:#166534;padding:4px 10px">⬇ CSV</button>
      </div>
    </div>`;

  if (!rows.length) {
    html += `<div class="section" style="color:#64748b;font-size:.85rem;padding:14px"><code>${escapeHTML(sel)}</code> no devolvió filas.</div>`;
    return html;
  }

  const cell = v => (v === null || v === undefined) ? "—" : (typeof v === "number" ? fmt(v) : escapeHTML(String(v)));
  html += `<div class="tbl-wrap"><table class="dtbl"><thead><tr>${cols.map(c => `<th style="white-space:nowrap">${escapeHTML(c)}</th>`).join("")}</tr></thead><tbody>`;
  filtered.slice(0, 300).forEach(r => {
    html += `<tr>${cols.map(c => `<td class="${typeof r[c] === "number" ? "tn" : ""}">${cell(r[c])}</td>`).join("")}</tr>`;
  });
  html += `</tbody></table></div>`;
  if (filtered.length > 300) html += `<div style="text-align:center;color:#aaa;padding:10px;font-size:.75rem;font-style:italic">Mostrando 300 de ${fmt(filtered.length)}. Usá el buscador.</div>`;
  return html;
}

// ── ACCIONES ───────────────────────────────────────────────────────────────────
function selectFleetExtTable(name) {
  FLEET_EXT_STATE.table = name;
  FLEET_EXT_STATE.search = "";
  STATE.fleetExternoLoaded = false;
  STATE.fleetExternoError = null;
  // Persistir la última tabla elegida en la config local
  try {
    const s = JSON.parse(localStorage.getItem("yangoFleetExtConfig") || "{}");
    s.table = name; localStorage.setItem("yangoFleetExtConfig", JSON.stringify(s)); FLEET_EXT.table = name;
  } catch (_) {}
  renderFleetExterno();
}

function fleetExtReload() {
  FLEET_EXT_STATE.schemaLoaded = false; FLEET_EXT_STATE.schemaError = null;
  STATE.fleetExternoLoaded = false; STATE.fleetExternoError = null;
  renderFleetExterno();
}

function fleetExtSaveConfig() {
  const url     = (document.getElementById("fleetExtUrl")?.value || "").trim();
  const anonKey = (document.getElementById("fleetExtKey")?.value || "").trim();
  if (!url || !anonKey) { showBanner(false, "Completá URL y anon key."); return; }
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) { showBanner(false, "La URL debe ser https://xxxx.supabase.co"); return; }
  const clean = url.replace(/\/$/, "");
  localStorage.setItem("yangoFleetExtConfig", JSON.stringify({ url: clean, anonKey }));
  Object.assign(FLEET_EXT, { enabled: true, url: clean, anonKey, table: "" });
  _fleetExtClientCache = null;
  Object.assign(FLEET_EXT_STATE, { table: "", schema: null, schemaLoaded: false, schemaError: null });
  STATE.fleetExternoLoaded = false; STATE.fleetExternoError = null;
  showBanner(true, "Conectado ✓");
  renderFleetExterno();
}

function fleetExtClearConfig() {
  localStorage.removeItem("yangoFleetExtConfig");
  Object.assign(FLEET_EXT, { enabled: false, url: "", anonKey: "", table: "" });
  _fleetExtClientCache = null;
  Object.assign(FLEET_EXT_STATE, { search: "", tableFilter: "", table: "", schema: null, schemaLoaded: false, schemaError: null });
  STATE.fleetExterno = []; STATE.fleetExternoCols = []; STATE.fleetExternoLoaded = false; STATE.fleetExternoError = null;
  renderFleetExterno();
}

// Inputs sin perder foco (mismo patrón que Data Raw).
function _fleetExtRefocus(inp) {
  const id = inp.id, pos = inp.selectionStart;
  renderFleetExterno();
  const el = id && document.getElementById(id);
  if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} }
}
function fleetExtSearchInput(inp)      { FLEET_EXT_STATE.search = inp.value;      _fleetExtRefocus(inp); }
function fleetExtTableFilterInput(inp) { FLEET_EXT_STATE.tableFilter = inp.value; _fleetExtRefocus(inp); }

function exportFleetExtCSV() {
  const rows = STATE.fleetExterno || [], cols = STATE.fleetExternoCols || [];
  if (!rows.length) { showBanner(false, "No hay data para exportar."); return; }
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map(esc).join(",")];
  rows.forEach(r => lines.push(cols.map(c => esc(r[c])).join(",")));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `fleet_externo_${FLEET_EXT_STATE.table || "data"}.csv`;
  a.click(); URL.revokeObjectURL(url);
}
