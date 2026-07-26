//@ts-nocheck
// seguimiento.js — Tracker de seguimiento de reuniones (Fase 3).
// Jerarquía: PROYECTO → tareas. Cada tarea: Owner · Task · inicio · fin · resultado
// esperado · status. Tab "Seguimiento" (editor CRUD admin-gated) + Gantt visual
// (timeline por día/semana/mes, marca de hoy, agrupado por proyecto) + slide render-only
// del deck de Presentación 2.0 (entra al PDF). Escrituras admin-gated (RLS 42501).

export const SEG_STATE = { partner: null, draft: [], deleted: [] };

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

// ── RENDER DEL TAB ──────────────────────────────────────────────────────────
export function renderSeguimiento() {
  const host = document.getElementById("tab-seguimiento");
  if (!host) return;
  const partners = _segPartners();
  if (!partners.length) {
    host.innerHTML = `<div class="empty"><p>Carga datos de <strong>Rendimiento</strong> para usar Seguimiento.</p></div>`;
    return;
  }
  if (!SEG_STATE.partner || !partners.includes(SEG_STATE.partner)) {
    SEG_STATE.partner = partners[0]; _segLoadDraft(SEG_STATE.partner);
  }
  const partner = SEG_STATE.partner;
  const kam = (typeof getKAMForPartner === "function" && getKAMForPartner(partner)) || "";
  const isAdmin = !!STATE.isAdmin;
  const order = _segProjectOrder(SEG_STATE.draft);

  const partnerOpts = partners.map(p => `<option value="${escapeHTML(p)}" ${p === partner ? "selected" : ""}>${escapeHTML(p)}</option>`).join("");
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

  const editor = isAdmin ? `
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

  host.innerHTML = `
    <div class="agy-style-573">
      <div class="agy-style-574">
        <div>
          <label class="agy-style-95">Partner</label>
          <select class="sb-sel agy-style-575" data-act-change="segOnPartnerChange">${partnerOpts}</select>
        </div>
        ${kam ? `<span style="background:${(KAM_COLORS && KAM_COLORS[kam]) || "#888"};color:#fff;font-size:.7rem;font-weight:700;padding:5px 10px;border-radius:12px">${escapeHTML(kam)}</span>` : ""}
      </div>

      ${_secH("📋", "#0ea5e9", "Seguimiento de reuniones", "Proyecto → tareas · Owner · fechas · resultado esperado — se comparte en el PDF del partner")}
      ${editor}

      ${_secH("📊", "#10b981", "Gantt", "Línea de tiempo por tarea (día / semana / mes según el rango)")}
      <div class="section"><div id="segGantt">${_segBuildGantt(SEG_STATE.draft, { en: false })}</div></div>
    </div>`;
}

// ── INTERACCIONES ────────────────────────────────────────────────────────────
export function segOnPartnerChange(p) { SEG_STATE.partner = p; _segLoadDraft(p); renderSeguimiento(); }
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
  segSet:            (d, el) => segSet(+d.i, d.field, el.value),
  segDeleteRow:      d => segDeleteRow(+d.i),
  segRenameProject:  (d, el) => segRenameProject(+d.pidx, el.value),
  segAddTaskTo:      d => segAddTaskTo(+d.pidx),
  segDeleteProject:  d => segDeleteProject(+d.pidx),
  segAddProject, segSave,
  segOnPartnerChange: (d, el) => segOnPartnerChange(el.value)
});
