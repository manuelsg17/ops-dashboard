//@ts-nocheck
// seguimiento.js — Tracker de seguimiento de reuniones (Fase 3).
// Jerarquía: PROYECTO → tareas. Cada tarea: Owner · Task · inicio · fin · resultado
// esperado · status. Tab "Seguimiento" (editor CRUD admin-gated) + Gantt visual
// (timeline por día/semana/mes, marca de hoy, agrupado por proyecto) + slide render-only
// del deck de Presentación 2.0 (entra al PDF). Escrituras admin-gated (RLS 42501).

// view: qué se está mirando. "resumen" es el default a propósito — antes la
// pestaña abría directo en el editor de UN partner (el primero alfabético), así
// que al entrar no se veía quién tiene seguimiento ni qué está pendiente. El
// resumen responde eso de una: quién tiene tareas, en qué estado, qué está
// vencido.
// partner: null = "todos" (el resumen y el kanban son globales; el Gantt y el
// editor sí necesitan un partner concreto).
export const SEG_STATE = {
  partner: null, draft: [], deleted: [],
  view: "resumen", kam: "all", search: ""
};

export const SEG_VIEWS = [
  { k: "resumen", emoji: "📊", label: "Resumen",     tip: "Quién tiene seguimiento, en qué estado y qué está vencido" },
  { k: "kanban",  emoji: "🗂️", label: "Kanban",      tip: "Tareas por estado — arrastrá el foco a lo que está trabado" },
  { k: "gantt",   emoji: "📅", label: "Gantt",       tip: "Línea de tiempo por tarea (requiere elegir un partner)" },
  { k: "editor",  emoji: "✏️", label: "Editar",      tip: "Crear y modificar proyectos y tareas (requiere elegir un partner)" }
];

export const SEG_STATUS = [
  { key: "pendiente", es: "Pendiente", en: "Pending",     color: "#9ca3af" },
  { key: "en_curso",  es: "En curso",  en: "In progress", color: "#3b82f6" },
  { key: "hecho",     es: "Hecho",     en: "Done",        color: "#10b981" },
  { key: "bloqueado", es: "Bloqueado", en: "Blocked",     color: "#ef4444" }
];
export function _segStatus(k) { return SEG_STATUS.find(s => s.key === k) || SEG_STATUS[0]; }
export function _segStatusColor(k) { return _segStatus(k).color; }
export function _segStatusLabel(k, en) { const s = _segStatus(k); return en ? s.en : s.es; }
export function _segProjColor(name) { return (typeof hashColor === "function") ? hashColor("proj:" + (name || "")) : "#64748b"; }

export function _segPartners() { return (STATE.allPartners || []).slice().sort(); }

// ── AGREGADOS PARA LAS VISTAS DE TABLERO ─────────────────────────────────────

// Una tarea "cuenta" si tiene texto. Las filas sin `task` son borradores vacíos
// del editor y no deben aparecer en ningún conteo.
export function _segRealTasks(rows) {
  return (rows || []).filter(r => (r.task || "").trim());
}

// Vencida = tiene fecha de fin, ya pasó, y no está hecha. Es la señal que el KAM
// necesita ver primero; "bloqueado" es un estado declarado, esto es un hecho.
export function _segIsOverdue(r) {
  if (r.status === "hecho") return false;
  const end = _segParseDate(r.end_date);
  return !!end && end < _segToday();
}

export function _segKamOf(partner) {
  return (typeof getKAMForPartner === "function" && getKAMForPartner(partner)) || "";
}

// Todas las tareas visibles según los filtros activos (KAM + búsqueda de
// partner). NO filtra por SEG_STATE.partner: eso lo decide cada vista.
export function _segFilteredTasks() {
  const q = (SEG_STATE.search || "").toLowerCase().trim();
  return _segRealTasks(STATE.seguimientoData).filter(r => {
    if (SEG_STATE.kam !== "all" && _segKamOf(r.partner) !== SEG_STATE.kam) return false;
    if (q && !String(r.partner || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

// Resumen por partner: conteos por estado, vencidas y próxima fecha de entrega.
// Ordenado por urgencia (vencidas primero, después bloqueadas) — el orden ES la
// priorización, no un detalle estético.
export function _segSummaryByPartner(tasks) {
  const by = new Map();
  (tasks || []).forEach(r => {
    const p = r.partner || "—";
    let e = by.get(p);
    if (!e) {
      e = { partner: p, kam: _segKamOf(p), total: 0, overdue: 0, nextDue: null,
            byStatus: { pendiente: 0, en_curso: 0, hecho: 0, bloqueado: 0 },
            projects: new Set() };
      by.set(p, e);
    }
    e.total++;
    e.byStatus[r.status] = (e.byStatus[r.status] || 0) + 1;
    if (r.project) e.projects.add(r.project);
    if (_segIsOverdue(r)) e.overdue++;
    const end = _segParseDate(r.end_date);
    if (end && r.status !== "hecho" && (!e.nextDue || end < e.nextDue)) e.nextDue = end;
  });
  return [...by.values()].sort((a, b) =>
    (b.overdue - a.overdue) ||
    (b.byStatus.bloqueado - a.byStatus.bloqueado) ||
    (b.total - a.total) ||
    a.partner.localeCompare(b.partner)
  );
}

// Partners CON tareas — es la lista que importa en esta pestaña (la del sidebar
// trae los ~69 partners del dashboard, la mayoría sin seguimiento cargado).
export function _segPartnersWithTasks() {
  return [...new Set(_segRealTasks(STATE.seguimientoData).map(r => r.partner))].filter(Boolean).sort();
}

// Copia editable de las filas del partner (draft). Se recarga al cambiar de partner o
// tras guardar; NO se pisa en re-render (para no perder ediciones en curso).
export function _segLoadDraft(partner) {
  SEG_STATE.draft = (STATE.seguimientoData || [])
    .filter(r => r.partner === partner)
    .sort((a, b) => String(a.project || "").localeCompare(String(b.project || ""))
      || (a.sort_order || 0) - (b.sort_order || 0)
      || String(a.start_date || "").localeCompare(String(b.start_date || "")))
    .map(r => ({
      id: r.id, project: r.project || "", owner: r.owner || "", task: r.task || "",
      start_date: (r.start_date || "").slice(0, 10), end_date: (r.end_date || "").slice(0, 10),
      expected_result: r.expected_result || "", status: r.status || "pendiente",
      city: r.city || "", clid: r.clid || ""
    }));
  SEG_STATE.deleted = [];
}

// Orden de proyectos (primera aparición en el draft/rows). "" → grupo "Sin proyecto".
export function _segProjectOrder(rows) {
  const seen = new Set(), out = [];
  (rows || []).forEach(r => { const p = r.project || ""; if (!seen.has(p)) { seen.add(p); out.push(p); } });
  return out;
}
export function _segProjLabel(p, en) { return p || (en ? "No project" : "Sin proyecto"); }

// ── Fechas / timeline ─────────────────────────────────────────────────────────
export function _segParseDate(s) {
  if (!s) return null;
  const p = String(s).slice(0, 10).split("-").map(Number);
  if (p.length < 3 || !p[0]) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}
export function _segToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function _segFmtD(d) { return d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` : "—"; }
export function _segMonths(en) {
  return en ? ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
            : ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
}
// Columnas del Gantt: DÍA si el rango es corto (≤24d), SEMANA si medio (≤168d), MES si largo.
export function _segTimeline(rows, en) {
  const ds = [];
  rows.forEach(r => { const a = _segParseDate(r.start_date), b = _segParseDate(r.end_date); if (a) ds.push(+a); if (b) ds.push(+b); });
  if (!ds.length) return null;
  const min = new Date(Math.min(...ds)), max = new Date(Math.max(...ds));
  const spanDays = (max - min) / 86400000;
  const cols = [], MO = _segMonths(en);
  if (spanDays <= 24) {
    const d = new Date(min.getFullYear(), min.getMonth(), min.getDate());
    while (d <= max) { const s = new Date(d), e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59); cols.push({ s, e, label: _segFmtD(s) }); d.setDate(d.getDate() + 1); }
    return { cols, bucket: "day" };
  }
  if (spanDays <= 168) {
    const d = new Date(min); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow);   // snap a lunes
    while (d <= max) { const s = new Date(d), e = new Date(d); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59); cols.push({ s, e, label: _segFmtD(s) }); d.setDate(d.getDate() + 7); }
    return { cols, bucket: "week" };
  }
  const d = new Date(min.getFullYear(), min.getMonth(), 1);
  while (d <= max) { const s = new Date(d), e = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59); cols.push({ s, e, label: `${MO[s.getMonth()]} ${String(s.getFullYear()).slice(2)}` }); d.setMonth(d.getMonth() + 1); }
  return { cols, bucket: "month" };
}
// Índice [inicio,fin] de columnas que ocupa una tarea (o null si no tiene fechas).
export function _segBar(r, tl) {
  const a = _segParseDate(r.start_date), b = _segParseDate(r.end_date), ts = a || b, te = b || a;
  if (!tl || !ts || !te) return null;
  let bs = -1, be = -1;
  for (let i = 0; i < tl.cols.length; i++) { if (tl.cols[i].e >= ts && bs < 0) bs = i; if (tl.cols[i].s <= te) be = i; }
  if (bs < 0) bs = 0; if (be < bs) be = bs;
  return { bs, be };
}

// ── GANTT reutilizable (tab + PDF). rows = filas del partner; opts.en idioma. ────
export function _segBuildGantt(rows, opts) {
  opts = opts || {};
  const en = !!opts.en;
  const tasks = (rows || []).filter(r => (r.task || "").trim());
  if (!tasks.length) {
    return `<div class="agy-style-537">${en ? "No follow-up tasks yet." : "Aún no hay tareas de seguimiento."}</div>`;
  }
  const tl = _segTimeline(tasks, en);
  const nCol = tl ? tl.cols.length : 0;
  const today = _segToday();
  const todayIdx = tl ? tl.cols.findIndex(c => today >= c.s && today <= c.e) : -1;
  const order = _segProjectOrder(tasks);

  const brdToday = i => (i === todayIdx ? "border-left:2px solid rgba(255,0,0,.5);" : "");
  const th = (s, i) => `<th style="text-align:center;padding:4px 5px;border-bottom:2px solid #eee;background:#fafafa;font-size:.56rem;font-weight:700;color:${i === todayIdx ? "#FF0000" : "#666"};white-space:nowrap;${i != null ? brdToday(i) : ""}">${escapeHTML(s)}</th>`;
  const headTimeline = tl ? tl.cols.map((c, i) => th(c.label, i)).join("") : "";

  // Cuerpo agrupado por proyecto: fila de encabezado (barra-span del proyecto) + tareas.
  const body = order.map(proj => {
    const gTasks = tasks.filter(r => (r.project || "") === proj);
    const bars = gTasks.map(r => _segBar(r, tl)).filter(Boolean);
    const pBs = bars.length ? Math.min(...bars.map(b => b.bs)) : -1;
    const pBe = bars.length ? Math.max(...bars.map(b => b.be)) : -1;
    const pCol = _segProjColor(proj);
    const nDone = gTasks.filter(r => r.status === "hecho").length;
    const projTimeline = tl ? tl.cols.map((c, i) => {
      const on = pBs >= 0 && i >= pBs && i <= pBe;
      return `<td style="padding:1px 2px;${brdToday(i)}"><div style="height:8px;border-radius:4px;background:${on ? pCol + "55" : "transparent"}"></div></td>`;
    }).join("") : "";
    const projHead = `<tr>
      <td colspan="2" class="agy-style-538">
        <span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${pCol};vertical-align:middle;margin-right:6px"></span>
        <span class="agy-style-539">${escapeHTML(_segProjLabel(proj, en))}</span>
        <span class="agy-style-540">${nDone}/${gTasks.length} ${en ? "done" : "hechas"}</span>
      </td>${projTimeline}</tr>`;

    const taskRows = gTasks.map(r => {
      const stC = _segStatusColor(r.status), stL = _segStatusLabel(r.status, en);
      const a = _segParseDate(r.start_date), b = _segParseDate(r.end_date);
      const bar = _segBar(r, tl);
      const dateTxt = (a || b) ? `📅 ${_segFmtD(a)}${(b && +b !== +(a || b)) ? " → " + _segFmtD(b) : ""}` : "";
      const cells = tl ? tl.cols.map((c, i) => {
        const on = bar && i >= bar.bs && i <= bar.be;
        const first = bar && i === bar.bs, last = bar && i === bar.be;
        const radius = on ? `${first ? "5px" : "0"} ${last ? "5px" : "0"} ${last ? "5px" : "0"} ${first ? "5px" : "0"}` : "0";
        return `<td style="padding:2px 2px;vertical-align:middle;${brdToday(i)}"><div style="height:13px;border-radius:${radius};background:${on ? stC : "transparent"}"></div></td>`;
      }).join("") : "";
      return `<tr>
        <td class="agy-style-541">
          <div class="agy-style-542">${escapeHTML(r.task)}</div>
          <div class="agy-style-543">${r.owner ? "👤 " + escapeHTML(r.owner) : ""}${r.owner && dateTxt ? " · " : ""}${dateTxt}</div>
          ${r.expected_result ? `<div class="agy-style-544">🎯 ${escapeHTML(r.expected_result)}</div>` : ""}
        </td>
        <td class="agy-style-545">
          <span style="display:inline-block;font-size:.58rem;font-weight:700;color:#fff;background:${stC};padding:2px 8px;border-radius:10px;white-space:nowrap">${escapeHTML(stL)}</span></td>
        ${cells}</tr>`;
    }).join("");
    return projHead + taskRows;
  }).join("");

  // Leyenda (inline-block → segura en el PDF).
  const chip = (color, label) => `<span class="agy-style-546"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};vertical-align:middle;margin-right:4px"></span>${escapeHTML(label)}</span>`;
  const legend = `<div class="agy-style-122">
    ${SEG_STATUS.map(s => chip(s.color, en ? s.en : s.es)).join("")}
    ${todayIdx >= 0 ? `<span class="agy-style-547"><span class="agy-style-548"></span>${en ? "Today" : "Hoy"}</span>` : ""}
  </div>`;

  return `${legend}<div class="agy-style-321">
    <table class="agy-style-373">
      <colgroup><col style="width:${tl ? "minmax(200px,1fr)" : "60%"}"/><col class="agy-style-549"/></colgroup>
      <thead><tr>${th(en ? "Task" : "Tarea")}${th(en ? "Status" : "Estado")}${headTimeline}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

// Solo el Gantt (repinta #segGantt desde el draft, sin re-render del editor → no pierde foco).
export function _segRenderGantt() {
  const g = document.getElementById("segGantt");
  if (g) g.innerHTML = _segBuildGantt(SEG_STATE.draft, { en: false });
}

// ── BARRA DE CONTROL (buscador de partner + KAM + selector de vista) ─────────
// El buscador replica el patrón de Presentación 2.0 (input + lista flotante +
// mousedown antes del blur) porque es el que el usuario ya conoce de esa
// pestaña; duplicar el patrón visual sería peor que reusarlo aunque el código
// viva en otro archivo.
function _segControlsHTML() {
  const kams = [...new Set(_segPartnersWithTasks().map(_segKamOf))].filter(Boolean).sort();
  const viewBtns = SEG_VIEWS.map(v => {
    const on  = SEG_STATE.view === v.k;
    // Gantt y Editor operan sobre UN partner: sin partner elegido no tienen qué
    // mostrar, así que se deshabilitan en vez de renderizar un vacío confuso.
    const needsPartner = v.k === "gantt" || v.k === "editor";
    const dis = needsPartner && !SEG_STATE.partner;
    return `<button class="mode-btn${on ? " active" : ""}" ${dis ? "disabled" : ""}
      title="${dis ? "Elegí un partner primero" : escapeHTML(v.tip)}"
      ${dis ? "" : `data-act="segSetView" data-view="${v.k}"`}
      style="${dis ? "opacity:.4;cursor:not-allowed" : ""}">${v.emoji} ${v.label}</button>`;
  }).join("");

  return `
    <div class="seg-controls">
      <div class="seg-ctl-field seg-ctl-search">
        <label class="agy-style-95">Partner</label>
        <input id="segSearch" type="text" class="sb-inp" autocomplete="off"
          placeholder="Todos — escribí para buscar…"
          value="${escapeHTML(SEG_STATE.partner || SEG_STATE.search || "")}"
          data-act-input="segFilterPartners" data-act-focus="segShowPartnerList"
          data-act-blur="segHidePartnerListDelayed" data-act-keydown="segSearchKeydown"/>
        <div id="segPartnerList" class="seg-partner-list"></div>
      </div>
      <div class="seg-ctl-field">
        <label class="agy-style-95">KAM</label>
        <select class="sb-sel" data-act-change="segSetKam">
          <option value="all"${SEG_STATE.kam === "all" ? " selected" : ""}>Todos</option>
          ${kams.map(k => `<option value="${escapeHTML(k)}"${SEG_STATE.kam === k ? " selected" : ""}>${escapeHTML(k)}</option>`).join("")}
        </select>
      </div>
      <div class="seg-ctl-field seg-ctl-views">
        <label class="agy-style-95">Vista</label>
        <div class="mode-toggle-row">${viewBtns}</div>
      </div>
      ${SEG_STATE.partner ? `<button class="mode-btn seg-clear" data-act="segClearPartner" title="Volver a ver todos los partners">✕ ${escapeHTML(SEG_STATE.partner)}</button>` : ""}
    </div>`;
}

// ── VISTA RESUMEN ────────────────────────────────────────────────────────────
// La pantalla que faltaba: al entrar, quién tiene seguimiento y qué está en
// rojo. Todo lo demás (kanban, gantt, editor) se alcanza desde acá.
function _segRenderResumen(tasks) {
  const rows = _segSummaryByPartner(tasks);
  const totalOverdue = rows.reduce((s, r) => s + r.overdue, 0);
  const totalBlocked = rows.reduce((s, r) => s + r.byStatus.bloqueado, 0);
  const totalOpen    = rows.reduce((s, r) => s + r.total - r.byStatus.hecho, 0);
  const totalDone    = rows.reduce((s, r) => s + r.byStatus.hecho, 0);
  const sinTareas    = _segPartners().filter(p => !rows.some(r => r.partner === p)).length;

  if (!rows.length) {
    return `<div class="section"><div class="agy-style-224">
      No hay tareas de seguimiento cargadas${SEG_STATE.kam !== "all" ? ` para <strong>${escapeHTML(SEG_STATE.kam)}</strong>` : ""}.<br>
      Elegí un partner arriba y usá <strong>✏️ Editar</strong> para crear el primer proyecto.
    </div></div>`;
  }

  const kpi = (label, val, color, tip) => `
    <div class="mcard" style="border-top:3px solid ${color}" title="${escapeHTML(tip)}">
      <div class="mcard-label">${label}</div>
      <div class="mcard-val" style="color:${color}">${fmt(val)}</div>
    </div>`;

  let html = `<div class="section"><div class="metric-row">
    ${kpi("⚠️ Vencidas", totalOverdue, totalOverdue ? "#ef4444" : "#9ca3af", "Tareas con fecha de fin pasada que no están hechas")}
    ${kpi("🚫 Bloqueadas", totalBlocked, totalBlocked ? "#f59e0b" : "#9ca3af", "Tareas marcadas como bloqueadas")}
    ${kpi("📋 Abiertas", totalOpen, "#3b82f6", "Tareas que no están hechas")}
    ${kpi("✅ Hechas", totalDone, "#10b981", "Tareas completadas")}
  </div></div>`;

  html += _secH("👥", "#0ea5e9", `Partners con seguimiento (${rows.length})`,
    sinTareas ? `${sinTareas} partner${sinTareas === 1 ? "" : "es"} del dashboard todavía sin ninguna tarea cargada`
              : "Todos los partners del dashboard tienen seguimiento");

  html += `<div class="section"><div class="tbl-wrap"><table class="dtbl seg-summary">
    <thead><tr>
      <th>Partner</th><th>KAM</th><th>Proyectos</th>
      <th title="Fecha de fin pasada y sin terminar">⚠️ Vencidas</th>
      <th>Pendiente</th><th>En curso</th><th>Bloqueado</th><th>Hecho</th>
      <th>Próxima entrega</th><th></th>
    </tr></thead><tbody>`;

  rows.forEach(r => {
    const pcol = STATE.partnerColors[r.partner] || "#ccc";
    const kcol = KAM_COLORS[r.kam] || "#ccc";
    const done = r.byStatus.hecho, pct = r.total ? (done / r.total) * 100 : 0;
    const cell = (n, color) => n
      ? `<td class="tn"><span style="color:${color};font-weight:700">${fmt(n)}</span></td>`
      : `<td class="tn agy-style-90">0</td>`;
    html += `<tr class="${r.overdue ? "seg-row-alert" : ""}">
      <td><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${pcol};margin-right:5px"></span>${escapeHTML(r.partner)}
        <div class="seg-progress" title="${fmt(done)} de ${fmt(r.total)} tareas hechas (${pct.toFixed(0)}%)">
          <div class="seg-progress-fill" style="width:${pct.toFixed(1)}%"></div>
        </div>
      </td>
      <td><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${kcol};margin-right:4px"></span>${escapeHTML(r.kam || "—")}</td>
      <td class="tn">${fmt(r.projects.size)}</td>
      ${cell(r.overdue, "#ef4444")}
      ${cell(r.byStatus.pendiente, "#6b7280")}
      ${cell(r.byStatus.en_curso, "#3b82f6")}
      ${cell(r.byStatus.bloqueado, "#ef4444")}
      ${cell(done, "#10b981")}
      <td class="tn">${r.nextDue ? _segFmtD(r.nextDue) : "—"}</td>
      <td><button class="mode-btn seg-open" data-act="segOpenPartner" data-partner="${escapeHTML(r.partner)}" title="Ver el Gantt y las tareas de ${escapeHTML(r.partner)}">Abrir →</button></td>
    </tr>`;
  });
  html += `</tbody></table></div></div>`;
  return html;
}

// ── VISTA KANBAN ─────────────────────────────────────────────────────────────
// Una columna por estado. Funciona global (todos los partners del filtro) o
// acotado a uno — el caso global es el que sirve para la reunión semanal de
// KAMs: "qué está bloqueado en toda mi cartera".
function _segRenderKanban(tasks) {
  const scoped = SEG_STATE.partner ? tasks.filter(t => t.partner === SEG_STATE.partner) : tasks;
  if (!scoped.length) {
    return `<div class="section"><div class="agy-style-224">Sin tareas para el filtro actual.</div></div>`;
  }
  const cols = SEG_STATUS.map(st => {
    const items = scoped.filter(t => (t.status || "pendiente") === st.key)
      .sort((a, b) => {
        // Vencidas arriba, después por fecha de entrega más próxima.
        const ao = _segIsOverdue(a) ? 0 : 1, bo = _segIsOverdue(b) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return String(a.end_date || "9999").localeCompare(String(b.end_date || "9999"));
      });
    const cards = items.map(t => {
      const pcol = STATE.partnerColors[t.partner] || "#ccc";
      const over = _segIsOverdue(t);
      const end  = _segParseDate(t.end_date);
      return `<div class="seg-card${over ? " seg-card-overdue" : ""}" style="border-left-color:${pcol}">
        ${SEG_STATE.partner ? "" : `<div class="seg-card-partner">${escapeHTML(t.partner || "—")}</div>`}
        <div class="seg-card-task">${escapeHTML(t.task)}</div>
        <div class="seg-card-meta">
          ${t.project ? `<span class="seg-chip" style="background:${_segProjColor(t.project)}22;color:${_segProjColor(t.project)}">${escapeHTML(t.project)}</span>` : ""}
          ${t.owner ? `<span>👤 ${escapeHTML(t.owner)}</span>` : ""}
          ${end ? `<span${over ? ' class="seg-overdue-txt" title="Vencida"' : ""}>📅 ${_segFmtD(end)}</span>` : ""}
        </div>
        ${t.expected_result ? `<div class="seg-card-goal">🎯 ${escapeHTML(t.expected_result)}</div>` : ""}
      </div>`;
    }).join("");
    return `<div class="seg-col">
      <div class="seg-col-head" style="border-bottom-color:${st.color}">
        <span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${st.color};margin-right:6px"></span>
        ${st.es}<span class="seg-col-count">${items.length}</span>
      </div>
      <div class="seg-col-body">${cards || `<div class="seg-col-empty">—</div>`}</div>
    </div>`;
  }).join("");
  return `<div class="section"><div class="seg-kanban">${cols}</div></div>`;
}

// ── RENDER DEL TAB ──────────────────────────────────────────────────────────
export function renderSeguimiento() {
  const host = document.getElementById("tab-seguimiento");
  if (!host) return;
  const partners = _segPartners();
  if (!partners.length) {
    host.innerHTML = `<div class="empty"><p>Carga datos de <strong>Rendimiento</strong> para usar Seguimiento.</p></div>`;
    return;
  }
  // OJO: acá antes se auto-seleccionaba partners[0] si no había partner elegido.
  // Eso es justamente lo que hacía que la pestaña abriera en el editor de un
  // partner cualquiera (el primero alfabético, casi siempre sin tareas) y diera
  // la sensación de "está todo vacío". Ahora partner=null es un estado válido y
  // significa "todos" — el resumen y el kanban lo entienden.
  const tasks   = _segFilteredTasks();
  const partner = SEG_STATE.partner;
  const kam     = partner ? _segKamOf(partner) : "";
  const isAdmin = !!STATE.isAdmin;
  const order   = _segProjectOrder(SEG_STATE.draft);

  const statusOpts = st => SEG_STATUS.map(s => `<option value="${s.key}" ${s.key === st ? "selected" : ""}>${s.es}</option>`).join("");

  // Editor (admin) agrupado por proyecto.
  const taskRowHtml = i => {
    const r = SEG_STATE.draft[i];
    return `<tr>
      <td class="agy-style-550"><input class="crud-input agy-style-551" value="${escapeHTML(r.owner)}" data-act-input="segSet" data-i="${i}" data-field="owner" placeholder="Owner"/></td>
      <td class="agy-style-552"><input class="crud-input agy-style-434" value="${escapeHTML(r.task)}" data-act-input="segSet" data-i="${i}" data-field="task" placeholder="Tarea / next step"/></td>
      <td class="agy-style-552"><input class="crud-input" type="date" class="agy-style-553" value="${escapeHTML(r.start_date)}" data-act-change="segSet" data-i="${i}" data-field="start_date"/></td>
      <td class="agy-style-552"><input class="crud-input" type="date" class="agy-style-553" value="${escapeHTML(r.end_date)}" data-act-change="segSet" data-i="${i}" data-field="end_date"/></td>
      <td class="agy-style-552"><input class="crud-input agy-style-554" value="${escapeHTML(r.expected_result)}" data-act-input="segSet" data-i="${i}" data-field="expected_result" placeholder="Resultado esperado"/></td>
      <td class="agy-style-552"><select class="crud-input agy-style-555" data-act-change="segSet" data-i="${i}" data-field="status">${statusOpts(r.status)}</select></td>
      <td class="agy-style-552"><button data-act="segDeleteRow" data-i="${i}" title="Eliminar tarea" class="agy-style-556">✕</button></td>
    </tr>`;
  };
  const groupsHtml = order.map((proj, pIdx) => {
    const idxs = SEG_STATE.draft.map((r, i) => i).filter(i => (SEG_STATE.draft[i].project || "") === proj);
    const pCol = _segProjColor(proj);
    const headerCells = `
      <td colspan="7" class="agy-style-557">
        <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${pCol};vertical-align:middle;margin-right:6px"></span>
        <input class="crud-input agy-style-558" value="${escapeHTML(proj)}" data-act-change="segRenameProject" data-pidx="${pIdx}" placeholder="Nombre del proyecto (Sin proyecto)"/>
        <button data-act="segAddTaskTo" data-pidx="${pIdx}" class="agy-style-559">+ tarea</button>
        <button data-act="segDeleteProject" data-pidx="${pIdx}" title="Eliminar proyecto y sus tareas" class="agy-style-560">🗑 proyecto</button>
      </td>`;
    return `<tr>${headerCells}</tr>${idxs.map(taskRowHtml).join("")}`;
  }).join("");

  const editor = !partner ? "" : isAdmin ? `
    <div class="agy-style-561">
      <table class="agy-style-562">
        <thead><tr class="agy-style-563">
          <th class="agy-style-564">Owner</th><th class="agy-style-565">Tarea</th>
          <th class="agy-style-565">Inicio</th><th class="agy-style-565">Fin</th>
          <th class="agy-style-565">Resultado esperado</th><th class="agy-style-565">Estado</th><th></th>
        </tr></thead>
        <tbody>${groupsHtml || `<tr><td colspan="7" class="agy-style-566">Sin proyectos ni tareas. Creá el primer proyecto ↓</td></tr>`}</tbody>
      </table>
    </div>
    <div class="agy-style-567">
      <button data-act="segAddProject" class="agy-style-568">📁 + Proyecto</button>
      <button data-act="segAddTaskTo" data-pidx="-1" class="agy-style-569">+ Tarea suelta</button>
      <button data-act="segSave" class="agy-style-570">💾 Guardar</button>
      <span class="agy-style-571">Los cambios no se guardan hasta presionar <strong>Guardar</strong>.</span>
    </div>`
    : `<div class="agy-style-572">🔒 Solo lectura — editar el seguimiento requiere permisos de administrador.</div>`;

  // Cuerpo según la vista activa. Solo Gantt y Editor usan el `draft` del
  // partner seleccionado; Resumen y Kanban leen directo de STATE.seguimientoData
  // (así el kanban global no depende de haber cargado ningún draft).
  let body = "";
  if (SEG_STATE.view === "resumen") {
    body = _segRenderResumen(tasks);
  } else if (SEG_STATE.view === "kanban") {
    body = _segRenderKanban(tasks);
  } else if (SEG_STATE.view === "gantt") {
    body = _secH("📊", "#10b981", `Gantt · ${partner}`,
             "Línea de tiempo por tarea (día / semana / mes según el rango)")
         + `<div class="section"><div id="segGantt">${_segBuildGantt(SEG_STATE.draft, { en: false })}</div></div>`;
  } else {
    body = _secH("📋", "#0ea5e9", `Seguimiento · ${partner}`,
             "Proyecto → tareas · Owner · fechas · resultado esperado — se comparte en el PDF del partner")
         + editor
         + _secH("📊", "#10b981", "Gantt", "Se actualiza mientras editás")
         + `<div class="section"><div id="segGantt">${_segBuildGantt(SEG_STATE.draft, { en: false })}</div></div>`;
  }

  host.innerHTML = `
    <div class="agy-style-573">
      ${_segControlsHTML()}
      ${partner && kam ? `<div class="seg-kam-badge"><span style="background:${(KAM_COLORS && KAM_COLORS[kam]) || "#888"}">${escapeHTML(kam)}</span></div>` : ""}
      ${body}
    </div>`;
}

// ── INTERACCIONES ────────────────────────────────────────────────────────────
export function segOnPartnerChange(p) { SEG_STATE.partner = p; _segLoadDraft(p); renderSeguimiento(); }

export function segSetView(v) { SEG_STATE.view = v; renderSeguimiento(); }
export function segSetKam(k)  { SEG_STATE.kam  = k; renderSeguimiento(); }

// Volver a "todos": limpia partner Y búsqueda (dejar la búsqueda puesta haría
// que el resumen siguiera mostrando un solo partner y pareciera que el botón
// no hizo nada).
export function segClearPartner() {
  SEG_STATE.partner = null; SEG_STATE.search = ""; SEG_STATE.draft = []; SEG_STATE.deleted = [];
  if (SEG_STATE.view === "gantt" || SEG_STATE.view === "editor") SEG_STATE.view = "resumen";
  renderSeguimiento();
}

// "Abrir →" del resumen: seleccionar el partner y saltar a su Gantt — el paso
// natural después de detectar que algo está vencido.
export function segOpenPartner(p) {
  SEG_STATE.partner = p; SEG_STATE.search = "";
  _segLoadDraft(p);
  SEG_STATE.view = "gantt";
  renderSeguimiento();
}

// ── BUSCADOR DE PARTNER (mismo patrón que Presentación 2.0) ─────────────────
// La lista ofrece PRIMERO los partners que ya tienen tareas (que es lo que se
// busca el 90% de las veces) y después el resto, para poder empezar uno nuevo.
export function _segPaintPartnerList(q) {
  const list = document.getElementById("segPartnerList");
  if (!list) return;
  const lower = (q || "").toLowerCase().trim();
  const withTasks = _segPartnersWithTasks();
  const wt = new Set(withTasks);
  const rest = _segPartners().filter(p => !wt.has(p));
  const match = p => !lower || p.toLowerCase().includes(lower);
  const a = withTasks.filter(match), b = rest.filter(match);
  if (!a.length && !b.length) { list.innerHTML = `<div class="agy-style-180">Sin coincidencias</div>`; return; }
  const opt = (p, has) => {
    const sel = p === SEG_STATE.partner;
    return `<div class="pv-opt seg-opt${sel ? " seg-opt-sel" : ""}" data-partner="${escapeHTML(p)}" data-act-mousedown="segSelectPartner">
      <span class="seg-opt-dot" style="background:${STATE.partnerColors[p] || "#ccc"}"></span>
      <span class="agy-style-181">${escapeHTML(p)}</span>
      ${has ? `<span class="seg-opt-tag">con seguimiento</span>` : ""}
    </div>`;
  };
  list.innerHTML = a.slice(0, 60).map(p => opt(p, true)).join("")
                 + b.slice(0, 60).map(p => opt(p, false)).join("");
}
export function segFilterPartners(q) { SEG_STATE.search = q; _segPaintPartnerList(q); segShowPartnerList(); }
export function segShowPartnerList() {
  const l = document.getElementById("segPartnerList");
  if (!l) return;
  l.style.display = "block";
  if (!l.innerHTML) { const i = document.getElementById("segSearch"); _segPaintPartnerList(i ? i.value : ""); }
}
export function segHidePartnerList() { const l = document.getElementById("segPartnerList"); if (l) l.style.display = "none"; }
// El blur del input dispara ANTES del click en la opción; el delay le da tiempo
// al mousedown de la opción a correr. Mismo truco que Presentación 2.0.
export function segHidePartnerListDelayed() { setTimeout(segHidePartnerList, 150); }
export function segSelectPartner(p) {
  SEG_STATE.partner = p; SEG_STATE.search = "";
  _segLoadDraft(p);
  segHidePartnerList();
  // Desde el resumen, elegir un partner salta al Gantt: es la vista útil una vez
  // que ya sabés de quién estás hablando.
  if (SEG_STATE.view === "resumen") SEG_STATE.view = "gantt";
  renderSeguimiento();
}
export function segSearchKeydown(e) {
  if (e.key === "Enter") {
    const f = document.querySelector("#segPartnerList .seg-opt");
    if (f) f.dispatchEvent(new MouseEvent("mousedown"));
    e.preventDefault();
  } else if (e.key === "Escape") { segHidePartnerList(); }
}
export function segSet(i, field, val) { if (SEG_STATE.draft[i]) { SEG_STATE.draft[i][field] = val; _segRenderGantt(); } }
export function segAddProject() {
  const name = prompt("Nombre del proyecto:", "");
  if (name === null) return;
  SEG_STATE.draft.push({ project: (name || "").trim(), owner: "", task: "", start_date: "", end_date: "", expected_result: "", status: "pendiente" });
  renderSeguimiento();
}
export function segAddTaskTo(pIdx) {
  const order = _segProjectOrder(SEG_STATE.draft);
  const project = pIdx >= 0 && pIdx < order.length ? order[pIdx] : "";
  SEG_STATE.draft.push({ project, owner: "", task: "", start_date: "", end_date: "", expected_result: "", status: "pendiente" });
  renderSeguimiento();
}
export function segRenameProject(pIdx, newName) {
  const order = _segProjectOrder(SEG_STATE.draft);
  const oldName = order[pIdx]; if (oldName === undefined) return;
  const nn = (newName || "").trim();
  SEG_STATE.draft.forEach(r => { if ((r.project || "") === oldName) r.project = nn; });
  renderSeguimiento();
}
export function segDeleteProject(pIdx) {
  const order = _segProjectOrder(SEG_STATE.draft);
  const name = order[pIdx]; if (name === undefined) return;
  const gTasks = SEG_STATE.draft.filter(r => (r.project || "") === name);
  if (!confirm(`Eliminar el proyecto "${_segProjLabel(name, false)}" y sus ${gTasks.length} tarea(s)?`)) return;
  gTasks.forEach(r => { if (r.id) SEG_STATE.deleted.push(r.id); });
  SEG_STATE.draft = SEG_STATE.draft.filter(r => (r.project || "") !== name);
  renderSeguimiento();
}
export function segDeleteRow(i) {
  const r = SEG_STATE.draft[i];
  if (r && r.id) SEG_STATE.deleted.push(r.id);
  SEG_STATE.draft.splice(i, 1);
  renderSeguimiento();
}

// ── GUARDAR (admin-gated: insert nuevas · upsert existentes · delete removidas) ─
export async function segSave() {
  if (!STATE.isAdmin) { alert("Guardar el seguimiento requiere permisos de administrador."); return; }
  const partner = SEG_STATE.partner;
  const kam = (typeof getKAMForPartner === "function" && getKAMForPartner(partner)) || "";
  const rows = SEG_STATE.draft.filter(r => (r.task || "").trim());
  const nowIso = new Date().toISOString();
  const base = (r, i) => ({
    kam, partner, project: (r.project || "").trim() || null,
    clid: r.clid || null, city: r.city || null,
    owner: (r.owner || "").trim() || null, task: r.task.trim(),
    start_date: r.start_date || null, end_date: r.end_date || null,
    expected_result: (r.expected_result || "").trim() || null,
    status: r.status || "pendiente", sort_order: i, updated_at: nowIso
  });
  const toInsert = rows.map((r, i) => base(r, i)).filter((_, i) => !rows[i].id);
  const toUpsert = rows.map((r, i) => ({ id: rows[i].id, ...base(r, i) })).filter(x => x.id);

  if (!confirm(`Guardar seguimiento de ${partner}\n\n• ${rows.length} tarea(s)\n• ${SEG_STATE.deleted.length} a eliminar\n\n¿Confirmar?`)) return;

  showLoad(true, "Guardando seguimiento...");
  try {
    if (SEG_STATE.deleted.length) {
      const { error } = await sb.from("seguimiento").delete().in("id", SEG_STATE.deleted);
      if (error) throw error;
    }
    if (toUpsert.length) {
      const { error } = await sb.from("seguimiento").upsert(toUpsert, { onConflict: "id" });
      if (error) throw error;
    }
    if (toInsert.length) {
      const { error } = await sb.from("seguimiento").insert(toInsert);
      if (error) throw error;
    }
    await loadFromSupabase();
    _segLoadDraft(partner);
    showBanner(true, `Seguimiento de ${partner} guardado (${rows.length} tarea${rows.length === 1 ? "" : "s"})`);
    renderSeguimiento();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (/42501|row-level security|permission/i.test(msg)) alert("No tienes permisos para guardar (requiere admin).");
    else alert("Error al guardar seguimiento: " + msg);
  } finally {
    showLoad(false);
  }
}

// ── SLIDE DEL DECK (Presentación 2.0) — render-only, entra al PDF ──────────────
export function p2PartnerHasSeguimiento(partner) {
  return (STATE.seguimientoData || []).some(r => r.partner === partner && (r.task || "").trim());
}
export function buildSlide2Seguimiento(partner, idx) {
  const es = !(typeof PRESENT2_STATE !== "undefined" && PRESENT2_STATE.lang === "en");
  const en = !es;
  const rows = (STATE.seguimientoData || []).filter(r => r.partner === partner);
  const header = (typeof p2BrandHeader === "function")
    ? p2BrandHeader(partner, en ? "Follow-up · Next steps" : "Seguimiento · Próximos pasos",
        en ? "Project → tasks · owner · dates · expected result" : "Proyecto → tareas · owner · fechas · resultado esperado")
    : `<h2>${escapeHTML(partner)} — ${en ? "Follow-up" : "Seguimiento"}</h2>`;
  const footer = (typeof p2BrandFooter === "function") ? p2BrandFooter(idx) : "";
  return `<div class="agy-style-365">
    ${header}
    <div class="agy-style-576">${_segBuildGantt(rows, { en })}</div>
    ${footer}
  </div>`;
}

// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";

registerActions({
  segSetView:        d => segSetView(d.view),
  segSetKam:         (d, el) => segSetKam(el.value),
  segClearPartner,
  segOpenPartner:    d => segOpenPartner(d.partner),
  segFilterPartners: (d, el) => segFilterPartners(el.value),
  segShowPartnerList,
  segHidePartnerListDelayed,
  segSelectPartner:  d => segSelectPartner(d.partner),
  segSearchKeydown:  (d, el, e) => segSearchKeydown(e),
  segSet:            (d, el) => segSet(+d.i, d.field, el.value),
  segDeleteRow:      d => segDeleteRow(+d.i),
  segRenameProject:  (d, el) => segRenameProject(+d.pidx, el.value),
  segAddTaskTo:      d => segAddTaskTo(+d.pidx),
  segDeleteProject:  d => segDeleteProject(+d.pidx),
  segAddProject, segSave,
  segOnPartnerChange: (d, el) => segOnPartnerChange(el.value)
});
