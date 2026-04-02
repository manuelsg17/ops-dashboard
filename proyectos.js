// proyectos.js — Módulo de tracking de proyectos por partner

// Tipos de proyecto disponibles
const PROYECTO_TIPOS = {
  scouts:         "Scouts",
  contact_center: "Contact Center",
  offline:        "Activaciones Offline",
  online:         "Campaña Online"
};

function renderProyectos() {
  const content = document.getElementById("proyectosContent");
  if (!STATE.rawData.length) {
    content.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
        <p>Carga datos de Rendimiento para activar el módulo de Proyectos</p>
      </div>`;
    return;
  }

  const proyData   = STATE.proyectosData || [];
  const partners   = STATE.allPartners || [];
  const allDates   = [...new Set(STATE.rawData.map(r => r.date))].sort();
  const lastDate   = allDates[allDates.length - 1] || "";

  // Partner filter for projects tab
  const filterP = document.getElementById("proyPartnerFilter")?.value || "all";
  const filterT = document.getElementById("proyTipoFilter")?.value   || "all";

  let html = secH("📋", "#6366f1", "Proyectos por Partner",
    "Tracking semanal de iniciativas de activación y reactivación", "");

  // ── Formulario de ingreso ──────────────────────────────────────────────────
  html += `
    <div class="section" style="margin-bottom:16px">
      <div style="font-size:.8rem;font-weight:700;color:#555;margin-bottom:12px">➕ Registrar actividad de proyecto</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:12px">
        <div>
          <label class="proj-label">Semana (fecha)</label>
          <input type="date" class="crud-input" id="pj_semana" value="${lastDate}"/>
        </div>
        <div>
          <label class="proj-label">Partner</label>
          <select class="sb-sel" id="pj_partner">
            <option value="">Seleccionar...</option>
            ${partners.map(p => `<option value="${p}">${p}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="proj-label">Ciudad</label>
          <select class="sb-sel" id="pj_city">
            <option value="">Todas</option>
            ${CITIES.map(c => `<option value="${c}">${c}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="proj-label">Tipo de proyecto</label>
          <select class="sb-sel" id="pj_tipo" onchange="renderProyectoForm()">
            ${Object.entries(PROYECTO_TIPOS).map(([k,v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="pj_campos"></div>
      <div style="margin-top:12px">
        <button class="crud-btn crud-btn-add" onclick="guardarProyecto()">Guardar registro</button>
      </div>
    </div>`;

  // ── Filtros historial ──────────────────────────────────────────────────────
  html += `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <div style="font-size:.75rem;color:#aaa;font-weight:700">Filtrar historial:</div>
      <select class="sb-sel" id="proyPartnerFilter" onchange="renderProyectos()" style="width:auto;min-width:160px">
        <option value="all">Todos los partners</option>
        ${partners.map(p => `<option value="${p}"${filterP===p?" selected":""}>${p}</option>`).join("")}
      </select>
      <select class="sb-sel" id="proyTipoFilter" onchange="renderProyectos()" style="width:auto;min-width:160px">
        <option value="all">Todos los tipos</option>
        ${Object.entries(PROYECTO_TIPOS).map(([k,v]) => `<option value="${k}"${filterT===k?" selected":""}>${v}</option>`).join("")}
      </select>
    </div>`;

  // ── Historial ──────────────────────────────────────────────────────────────
  let filtered = proyData;
  if (filterP !== "all") filtered = filtered.filter(r => r.partner === filterP);
  if (filterT !== "all") filtered = filtered.filter(r => r.tipo    === filterT);
  filtered = [...filtered].sort((a, b) => (b.semana || "").localeCompare(a.semana || ""));

  if (!filtered.length) {
    html += `<div class="empty" style="padding:24px"><p style="font-size:.85rem;color:#aaa">Sin registros. Usa el formulario de arriba para agregar actividad.</p></div>`;
  } else {
    html += `<div class="section"><div class="tbl-wrap"><table class="dtbl"><thead><tr>
      <th>Semana</th><th>Partner</th><th>Ciudad</th><th>Tipo</th>
      <th>Métrica 1</th><th>Métrica 2</th><th>Métrica 3</th><th></th>
    </tr></thead><tbody>`;

    filtered.forEach(r => {
      const cols = buildProyectoCols(r);
      const pdot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${STATE.partnerColors[r.partner]||"#ccc"};margin-right:5px"></span>`;
      html += `<tr>
        <td style="font-size:.78rem">${d2s(r.semana)}</td>
        <td>${pdot}${r.partner}</td>
        <td style="font-size:.78rem">${r.city || "–"}</td>
        <td><span style="background:#f0f0f0;padding:2px 7px;border-radius:10px;font-size:.72rem">${PROYECTO_TIPOS[r.tipo]||r.tipo}</span></td>
        ${cols.map(c => `<td class="tn" style="font-size:.78rem">${c}</td>`).join("")}
        <td><button class="crud-btn crud-btn-del" onclick="eliminarProyecto(${r.id})">✕</button></td>
      </tr>`;
    });

    html += `</tbody></table></div></div>`;
  }

  content.innerHTML = html;

  // Renderizar campos del formulario según tipo seleccionado
  renderProyectoForm();
}

function buildProyectoCols(r) {
  switch (r.tipo) {
    case "scouts":
      return [
        `Scouts: ${fmt(r.scouts_count||0)}`,
        `Nuevos: ${fmt(r.scouts_new_drivers||0)}`,
        `Conv.: ${fmt(r.scouts_conv_pct||0)}%`
      ];
    case "contact_center":
      return [
        `Llamadas: ${fmt(r.cc_calls||0)}`,
        `Conv.Act. 1v: ${fmt(r.cc_conv_1trip_act||0)}% / 50v: ${fmt(r.cc_conv_50trip_act||0)}%`,
        `Conv.React. 1v: ${fmt(r.cc_conv_1trip_react||0)}% / 50v: ${fmt(r.cc_conv_50trip_react||0)}%`
      ];
    case "offline":
      return [
        `Drivers: ${fmt(r.off_drivers_attracted||0)}`,
        `Conv. 1er viaje: ${fmt(r.off_conv_1trip||0)}%`,
        `Conv. 50 viajes: ${fmt(r.off_conv_50trip||0)}%`
      ];
    case "online":
      return [
        `Registros: ${fmt(r.online_registrations||0)}`,
        `Conv. 1er viaje: ${fmt(r.online_conv_1trip||0)}%`,
        `Conv. 50 viajes: ${fmt(r.online_conv_50trip||0)}%`
      ];
    default: return ["–", "–", "–"];
  }
}

function renderProyectoForm() {
  const tipo = document.getElementById("pj_tipo")?.value || "scouts";
  const el   = document.getElementById("pj_campos");
  if (!el) return;

  const inp = (id, label, placeholder = "0") =>
    `<div>
      <label class="proj-label">${label}</label>
      <input type="number" class="crud-input" id="${id}" placeholder="${placeholder}" min="0" step="any"/>
    </div>`;

  const forms = {
    scouts: `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        ${inp("pj_scouts_count",       "Nº de Scouts")}
        ${inp("pj_scouts_new_drivers", "Nuevos drivers atraídos")}
        ${inp("pj_scouts_conv_pct",    "Conversión (%)", "0.0")}
      </div>`,
    contact_center: `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        ${inp("pj_cc_calls",            "Llamadas realizadas")}
        ${inp("pj_cc_conv_1trip_act",   "Conv. Activación 1er viaje (%)", "0.0")}
        ${inp("pj_cc_conv_50trip_act",  "Conv. Activación 50 viajes (%)", "0.0")}
        ${inp("pj_cc_conv_1trip_react", "Conv. Reactivación 1er viaje (%)", "0.0")}
        ${inp("pj_cc_conv_50trip_react","Conv. Reactivación 50 viajes (%)", "0.0")}
      </div>`,
    offline: `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        ${inp("pj_off_drivers",    "Drivers atraídos")}
        ${inp("pj_off_conv_1trip", "Conv. 1er viaje (%)", "0.0")}
        ${inp("pj_off_conv_50trip","Conv. 50 viajes (%)", "0.0")}
      </div>`,
    online: `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        ${inp("pj_online_regs",      "Registros conseguidos")}
        ${inp("pj_online_conv_1trip","Conv. 1er viaje (%)", "0.0")}
        ${inp("pj_online_conv_50trip","Conv. 50 viajes (%)", "0.0")}
      </div>`
  };
  el.innerHTML = forms[tipo] || "";
}

function n(id) { return parseFloat(document.getElementById(id)?.value || "0") || 0; }

async function guardarProyecto() {
  const semana  = document.getElementById("pj_semana")?.value;
  const partner = document.getElementById("pj_partner")?.value;
  const city    = document.getElementById("pj_city")?.value || "";
  const tipo    = document.getElementById("pj_tipo")?.value;

  if (!semana || !partner || !tipo) {
    showBanner(false, "Completa Semana, Partner y Tipo antes de guardar.");
    return;
  }

  // Build CLID from CLID_MAP
  const clid = Object.entries(STATE.CLID_MAP).find(([, v]) => v === partner)?.[0] || "";

  const row = { semana, partner, clid, city, tipo };

  if (tipo === "scouts") {
    row.scouts_count       = n("pj_scouts_count");
    row.scouts_new_drivers = n("pj_scouts_new_drivers");
    row.scouts_conv_pct    = n("pj_scouts_conv_pct");
  } else if (tipo === "contact_center") {
    row.cc_calls             = n("pj_cc_calls");
    row.cc_conv_1trip_act    = n("pj_cc_conv_1trip_act");
    row.cc_conv_50trip_act   = n("pj_cc_conv_50trip_act");
    row.cc_conv_1trip_react  = n("pj_cc_conv_1trip_react");
    row.cc_conv_50trip_react = n("pj_cc_conv_50trip_react");
  } else if (tipo === "offline") {
    row.off_drivers_attracted = n("pj_off_drivers");
    row.off_conv_1trip        = n("pj_off_conv_1trip");
    row.off_conv_50trip       = n("pj_off_conv_50trip");
  } else if (tipo === "online") {
    row.online_registrations = n("pj_online_regs");
    row.online_conv_1trip    = n("pj_online_conv_1trip");
    row.online_conv_50trip   = n("pj_online_conv_50trip");
  }

  showLoad(true, "Guardando proyecto...");
  const { error } = await sb.from("proyectos").insert([row]);
  showLoad(false);

  if (error) {
    showBanner(false, "Error al guardar: " + error.message);
    return;
  }

  showBanner(true, "Proyecto registrado correctamente.");
  await loadProyectos();
  renderProyectos();
}

async function eliminarProyecto(id) {
  if (!confirm("¿Eliminar este registro de proyecto?")) return;
  showLoad(true, "Eliminando...");
  const { error } = await sb.from("proyectos").delete().eq("id", id);
  showLoad(false);
  if (error) { showBanner(false, "Error al eliminar: " + error.message); return; }
  showBanner(true, "Registro eliminado.");
  await loadProyectos();
  renderProyectos();
}

async function loadProyectos() {
  try {
    const { data, error } = await sb.from("proyectos").select("*").order("semana", { ascending: false });
    if (error) throw error;
    STATE.proyectosData = data || [];
  } catch (e) {
    STATE.proyectosData = [];
  }
}
