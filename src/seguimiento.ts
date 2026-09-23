//@ts-nocheck
import { t, getLang, kamLabel } from "./core/i18n";
import { xl, pick } from "./core/i18nExport";
import { mesNombre } from "./core/meses";
import { iconSvg } from "./shared/icons";
import { emptyState, btn, badge, alertBox, rawHtml } from "./shared/ui";
import { confirmDialog, alertDialog } from "./shared/confirmDialog";
// seguimiento.js — Tracker de seguimiento de reuniones (Fase 3).
// Jerarquía: PROYECTO → tareas. Cada tarea: Owner · Task · inicio · fin · resultado
// esperado · status. Tab "Seguimiento" (editor CRUD admin-gated) + Gantt visual
// (timeline por día/semana/mes, marca de hoy, agrupado por proyecto) + slide render-only
// del deck de Presentación 2.0 (entra al PDF). Escrituras admin-gated (RLS 42501).
//
// Diseño (Ola 6, sep-2026): componentes del sistema (ui-kpi, ui-table,
// ui-segmented, ui-btn, diálogos en página) y estilos propios en
// src/styles/views/seguimiento.css (prefijo sg-). Colores SOLO de tokens: el
// estado usa los semánticos (info/ok/bad) y el proyecto la paleta categórica.

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

// Etiqueta y tooltip de cada vista: t("seg.view.<k>") / t("seg.view.<k>Tip").
export const SEG_VIEWS = [
  { k: "resumen", icon: "chart-bar" },
  { k: "kanban",  icon: "list-check" },
  { k: "gantt",   icon: "calendar" },
  { k: "editor",  icon: "edit" }
];

// `key` es el valor de la BD (seguimiento.status) y no se traduce. El texto de
// cada estado vive en core/i18nExport (EXPORT_STR "seg.st.<key>") porque el
// Gantt lo dibuja tanto la pestaña como la hoja del deck.
// `color`: token CSS (se usa en style="" de barras y puntos; html2canvas lo
// resuelve por getComputedStyle, así que el PDF del deck lo respeta).
export const SEG_STATUS = [
  { key: "pendiente", color: "var(--cat-other)" },
  { key: "en_curso",  color: "var(--color-info-solid)" },
  { key: "hecho",     color: "var(--color-ok-solid)" },
  { key: "bloqueado", color: "var(--color-bad-solid)" }
];
export function _segStatus(k) { return SEG_STATUS.find(s => s.key === k) || SEG_STATUS[0]; }
export function _segStatusColor(k) { return _segStatus(k).color; }
// `lang`: "es" | "en" | "ru" — el de la interfaz en la pestaña, el del deck en el PDF.
export function _segStatusLabel(k, lang) { return xl(`seg.st.${_segStatus(k).key}`, lang); }
// Color de un proyecto: paleta categórica de los tokens (9 colores). Dentro de
// un partner se asigna por el ORDEN ALFABÉTICO de sus proyectos guardados —
// así dos proyectos del mismo partner nunca comparten color (con un hash de 9
// colores chocaban seguido) y el mismo proyecto conserva el suyo en el resumen,
// el kanban, el Gantt y la hoja del deck. Sin partner, o un proyecto recién
// creado que todavía no está en la base: hash del nombre.
export function _segProjColor(name, partner) {
  const n = name || "";
  if (partner != null) {
    const lista = [...new Set((STATE.seguimientoData || [])
      .filter(r => r.partner === partner).map(r => r.project || ""))].sort();
    const i = lista.indexOf(n);
    if (i >= 0) return `var(--cat-${(i % 9) + 1})`;
  }
  const s = "proj:" + n;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `var(--cat-${(Math.abs(h) % 9) + 1})`;
}

// sidebarPartners = Taxi ∪ solo-TukTuk: con allPartners (solo Taxi) un partner
// solo-TukTuk (caso PIAGGIO) no se podía elegir para cargarle seguimiento.
export function _segPartners() { return (STATE.sidebarPartners || STATE.allPartners || []).slice().sort(); }

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
  SEG_STATE._draftBase = JSON.stringify(SEG_STATE.draft);
}

// ¿Hay ediciones sin guardar en el draft del partner actual? (I12) Antes, elegir
// otro partner recargaba el draft y descartaba en silencio lo tecleado.
export function _segDraftSucio() {
  if (!SEG_STATE.partner) return false;
  return (SEG_STATE.deleted || []).length > 0 ||
    JSON.stringify(SEG_STATE.draft || []) !== (SEG_STATE._draftBase ?? "[]");
}

// Orden de proyectos (primera aparición en el draft/rows). "" → grupo "Sin proyecto".
export function _segProjectOrder(rows) {
  const seen = new Set(), out = [];
  (rows || []).forEach(r => { const p = r.project || ""; if (!seen.has(p)) { seen.add(p); out.push(p); } });
  return out;
}
export function _segProjLabel(p, lang) { return p || xl("seg.sinProyecto", lang); }

// ── Fechas / timeline ─────────────────────────────────────────────────────────
export function _segParseDate(s) {
  if (!s) return null;
  const p = String(s).slice(0, 10).split("-").map(Number);
  if (p.length < 3 || !p[0]) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}
export function _segToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function _segFmtD(d) { return d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` : "—"; }
// Meses cortos: tabla única de core/meses.ts.
export function _segMonths(lang) {
  return Array.from({ length: 12 }, (_, i) => mesNombre(i, lang, { corto: true }));
}
// Columnas del Gantt: DÍA si el rango es corto (≤24d), SEMANA si medio (≤168d), MES si largo.
export function _segTimeline(rows, lang) {
  const ds = [];
  rows.forEach(r => { const a = _segParseDate(r.start_date), b = _segParseDate(r.end_date); if (a) ds.push(+a); if (b) ds.push(+b); });
  if (!ds.length) return null;
  const min = new Date(Math.min(...ds)), max = new Date(Math.max(...ds));
  const spanDays = (max - min) / 86400000;
  const cols = [], MO = _segMonths(lang);
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

// ── GANTT reutilizable (tab + PDF). rows = filas del partner; opts.lang idioma ────
// ("es" | "en" | "ru"): el de la interfaz en la pestaña, el del deck en el PDF.
// Estilos: clases sg-gantt* (seguimiento.css, cargado siempre desde vendor.ts,
// así que también aplican dentro del deck). Solo quedan en style="" los colores
// y radios que dependen del dato (estado/proyecto de cada barra).
export function _segBuildGantt(rows, opts) {
  opts = opts || {};
  const lang = opts.lang || "es";
  const X = k => xl(k, lang);
  const tasks = (rows || []).filter(r => (r.task || "").trim());
  if (!tasks.length) {
    return `<div class="sg-gantt-empty">${escapeHTML(X("seg.sinTareas"))}</div>`;
  }
  const tl = _segTimeline(tasks, lang);
  const today = _segToday();
  const todayIdx = tl ? tl.cols.findIndex(c => today >= c.s && today <= c.e) : -1;
  const order = _segProjectOrder(tasks);

  const hoy = i => (i === todayIdx ? " sg-gantt__today" : "");
  const th = (s, cls) => `<th class="sg-gantt__th${cls || ""}">${escapeHTML(s)}</th>`;
  const headTimeline = tl ? tl.cols.map((c, i) => th(c.label, " sg-gantt__th--col" + hoy(i))).join("") : "";

  // Cuerpo agrupado por proyecto: fila de encabezado (barra-span del proyecto) + tareas.
  const body = order.map(proj => {
    const gTasks = tasks.filter(r => (r.project || "") === proj);
    const bars = gTasks.map(r => _segBar(r, tl)).filter(Boolean);
    const pBs = bars.length ? Math.min(...bars.map(b => b.bs)) : -1;
    const pBe = bars.length ? Math.max(...bars.map(b => b.be)) : -1;
    const pCol = _segProjColor(proj, opts.partner);
    const nDone = gTasks.filter(r => r.status === "hecho").length;
    const projTimeline = tl ? tl.cols.map((c, i) => {
      const on = pBs >= 0 && i >= pBs && i <= pBe;
      return `<td class="sg-gantt__cell${hoy(i)}">${on ? `<div class="sg-gantt__span" style="background:${pCol}"></div>` : ""}</td>`;
    }).join("") : "";
    const projHead = `<tr class="sg-gantt__proj">
      <td colspan="2" class="sg-gantt__proj-cell">
        <span class="sg-dot sg-dot--sq" style="background:${pCol}"></span>
        <span class="sg-gantt__proj-name">${escapeHTML(_segProjLabel(proj, lang))}</span>
        <span class="sg-gantt__proj-count">${nDone}/${gTasks.length} ${escapeHTML(X("seg.hechas"))}</span>
      </td>${projTimeline}</tr>`;

    const taskRows = gTasks.map(r => {
      const stC = _segStatusColor(r.status), stL = _segStatusLabel(r.status, lang);
      const a = _segParseDate(r.start_date), b = _segParseDate(r.end_date);
      const bar = _segBar(r, tl);
      const dateTxt = (a || b) ? `${_segFmtD(a)}${(b && +b !== +(a || b)) ? " → " + _segFmtD(b) : ""}` : "";
      const meta = [
        r.owner ? `<span class="sg-meta">${iconSvg("user", { size: 11 })}${escapeHTML(r.owner)}</span>` : "",
        dateTxt ? `<span class="sg-meta">${iconSvg("calendar", { size: 11 })}${dateTxt}</span>` : ""
      ].filter(Boolean).join("");
      const cells = tl ? tl.cols.map((c, i) => {
        const on = bar && i >= bar.bs && i <= bar.be;
        if (!on) return `<td class="sg-gantt__cell${hoy(i)}"></td>`;
        const first = i === bar.bs, last = i === bar.be;
        const radius = `${first ? "5px" : "0"} ${last ? "5px" : "0"} ${last ? "5px" : "0"} ${first ? "5px" : "0"}`;
        return `<td class="sg-gantt__cell${hoy(i)}"><div class="sg-gantt__bar" style="background:${stC};border-radius:${radius}"></div></td>`;
      }).join("") : "";
      return `<tr class="sg-gantt__task">
        <td class="sg-gantt__name">
          <div class="sg-gantt__task-t">${escapeHTML(r.task)}</div>
          ${meta ? `<div class="sg-gantt__meta">${meta}</div>` : ""}
          ${r.expected_result ? `<div class="sg-gantt__goal">${iconSvg("target", { size: 11 })}<span>${escapeHTML(r.expected_result)}</span></div>` : ""}
        </td>
        <td class="sg-gantt__st"><span class="sg-pill" style="background:${stC}">${escapeHTML(stL)}</span></td>
        ${cells}</tr>`;
    }).join("");
    return projHead + taskRows;
  }).join("");

  // Leyenda (inline-block → segura en el PDF).
  const item = (color, label) => `<span class="sg-legend__item"><span class="sg-dot sg-dot--sq" style="background:${color}"></span>${escapeHTML(label)}</span>`;
  const legend = `<div class="sg-legend">
    ${SEG_STATUS.map(s => item(s.color, _segStatusLabel(s.key, lang))).join("")}
    ${todayIdx >= 0 ? `<span class="sg-legend__item sg-legend__today"><span class="sg-legend__today-mark"></span>${escapeHTML(X("seg.hoy"))}</span>` : ""}
  </div>`;

  return `${legend}<div class="sg-gantt">
    <table class="sg-gantt__table">
      <colgroup><col class="sg-gantt__col-name"/><col class="sg-gantt__col-st"/></colgroup>
      <thead><tr>${th(X("seg.tarea"), " sg-gantt__th--name")}${th(X("seg.estado"))}${headTimeline}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

// Solo el Gantt (repinta #segGantt desde el draft, sin re-render del editor → no pierde foco).
export function _segRenderGantt() {
  const g = document.getElementById("segGantt");
  if (g) g.innerHTML = _segBuildGantt(SEG_STATE.draft, { lang: getLang(), partner: SEG_STATE.partner });
}

// Encabezado de sección de la pestaña (sin emojis ni iconos de color).
function _sgH(title, sub, right = "") {
  return `<div class="sg-sec__head"><div><h2 class="sg-sec__title">${escapeHTML(title)}</h2>` +
    (sub ? `<p class="sg-sec__sub">${escapeHTML(sub)}</p>` : "") + `</div>${right}</div>`;
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
    return `<button type="button" class="ui-segmented__btn" aria-pressed="${on}"${dis ? " disabled" : ""}
      title="${escapeHTML(dis ? t("seg.eligePartner") : t(`seg.view.${v.k}Tip`))}"
      ${dis ? "" : `data-act="segSetView" data-view="${v.k}"`}>${iconSvg(v.icon, { size: 14 })}<span>${escapeHTML(t(`seg.view.${v.k}`))}</span></button>`;
  }).join("");

  const partner = SEG_STATE.partner;
  const kam = partner ? _segKamOf(partner) : "";
  const contexto = partner ? `<div class="sg-context">
      <span class="ui-chip"><span class="ui-chip__key">${escapeHTML(t("seg.partner"))}:</span><span class="ui-chip__val" title="${escapeHTML(partner)}">${escapeHTML(partner)}</span>
        <button type="button" class="ui-chip__remove" data-act="segClearPartner" aria-label="${escapeHTML(t("seg.volverTodos"))}" title="${escapeHTML(t("seg.volverTodos"))}">${iconSvg("x", { size: 12 })}</button></span>
      ${kam ? badge(t("seg.kamDe", { k: kamLabel(kam) }), "neutral", { icon: "user" }) : ""}
    </div>` : "";

  return `
    <div class="sg-toolbar ui-card">
      <div class="ui-field sg-field sg-field--search">
        <label class="ui-field__label" for="segSearch">${escapeHTML(t("seg.partner"))}</label>
        <div class="sg-search">
          <span class="sg-search__icon">${iconSvg("search", { size: 14 })}</span>
          <input id="segSearch" type="text" class="ui-input ui-input--sm sg-search__input" autocomplete="off"
            role="combobox" aria-controls="segPartnerList" aria-autocomplete="list"
            placeholder="${escapeHTML(t("seg.phBuscar"))}"
            value="${escapeHTML(SEG_STATE.partner || SEG_STATE.search || "")}"
            data-act-input="segFilterPartners" data-act-focus="segShowPartnerList"
            data-act-blur="segHidePartnerListDelayed" data-act-keydown="segSearchKeydown"/>
          <div id="segPartnerList" class="sg-partner-list" role="listbox"></div>
        </div>
      </div>
      <div class="ui-field sg-field">
        <label class="ui-field__label" for="segKam">KAM</label>
        <select id="segKam" class="ui-select ui-select--sm" data-act-change="segSetKam">
          <option value="all"${SEG_STATE.kam === "all" ? " selected" : ""}>${escapeHTML(t("seg.todos"))}</option>
          ${kams.map(k => `<option value="${escapeHTML(k)}"${SEG_STATE.kam === k ? " selected" : ""}>${escapeHTML(kamLabel(k))}</option>`).join("")}
        </select>
      </div>
      <div class="ui-field sg-field">
        <span class="ui-field__label">${escapeHTML(t("seg.lblVista"))}</span>
        <div class="ui-segmented" role="group" aria-label="${escapeHTML(t("seg.lblVista"))}">${viewBtns}</div>
      </div>
      ${contexto}
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
    return emptyState({
      icon: "list-check",
      title: SEG_STATE.kam !== "all" ? t("seg.vacioKam", { kam: kamLabel(SEG_STATE.kam) }) : t("seg.vacio"),
      text: t("seg.vacioAccion"),
      action: btn({ label: t("seg.vacioBtn"), variant: "primary", icon: "search", act: "segFocusSearch" })
    });
  }

  // Tono semántico solo cuando hay algo que señalar: 0 vencidas no es rojo.
  const kpi = (label, val, tone, tip) => `
    <div class="ui-kpi sg-kpi sg-kpi--${val ? tone : "none"}" title="${escapeHTML(tip)}">
      <div class="ui-kpi__label">${escapeHTML(label)}</div>
      <div class="ui-kpi__row"><span class="ui-kpi__value">${fmt(val)}</span></div>
      <div class="ui-kpi__sub">${escapeHTML(tip)}</div>
    </div>`;

  let html = `<div class="ui-kpi-grid sg-kpis">
    ${kpi(t("seg.kpi.vencidas"), totalOverdue, "bad", t("seg.kpi.vencidasTip"))}
    ${kpi(t("seg.kpi.bloqueadas"), totalBlocked, "warn", t("seg.kpi.bloqueadasTip"))}
    ${kpi(t("seg.kpi.abiertas"), totalOpen, "info", t("seg.kpi.abiertasTip"))}
    ${kpi(t("seg.kpi.hechas"), totalDone, "ok", t("seg.kpi.hechasTip"))}
  </div>`;

  html += `<section class="sg-sec">` + _sgH(t("seg.conSeg", { n: rows.length }),
    sinTareas ? t(sinTareas === 1 ? "seg.sinTareas1" : "seg.sinTareasN", { n: sinTareas })
              : t("seg.todosConSeg"));

  const lang = getLang();
  html += `<div class="ui-table-wrap"><table class="ui-table ui-table--sticky-first sg-summary">
    <thead><tr>
      <th>${escapeHTML(t("seg.partner"))}</th><th>KAM</th><th class="ui-num">${escapeHTML(t("seg.th.proyectos"))}</th>
      <th class="ui-num" title="${escapeHTML(t("seg.th.vencidasTip"))}">${escapeHTML(t("seg.kpi.vencidas"))}</th>
      ${SEG_STATUS.map(st => `<th class="ui-num">${escapeHTML(_segStatusLabel(st.key, lang))}</th>`).join("")}
      <th class="ui-num">${escapeHTML(t("seg.th.proxima"))}</th><th><span class="ui-sr-only">${escapeHTML(t("seg.abrir"))}</span></th>
    </tr></thead><tbody>`;

  rows.forEach(r => {
    const done = r.byStatus.hecho, pct = r.total ? (done / r.total) * 100 : 0;
    const cell = (n, tone) => n
      ? `<td class="ui-num"><span class="sg-count sg-count--${tone}">${fmt(n)}</span></td>`
      : `<td class="ui-num"><span class="sg-count sg-count--zero">0</span></td>`;
    const tip = t("seg.progresoTip", { d: fmt(done), t: fmt(r.total), p: pct.toFixed(0) });
    html += `<tr class="${r.overdue ? "sg-row--alert" : ""}">
      <td class="sg-summary__partner">
        <div class="sg-summary__name">${escapeHTML(r.partner)}</div>
        <div class="sg-summary__progress" title="${escapeHTML(tip)}">
          <div class="ui-progress ui-progress--ok" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="${escapeHTML(tip)}">
            <div class="ui-progress__bar" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="sg-summary__frac">${fmt(done)}/${fmt(r.total)}</span>
        </div>
      </td>
      <td>${escapeHTML(r.kam ? kamLabel(r.kam) : "—")}</td>
      <td class="ui-num">${fmt(r.projects.size)}</td>
      ${r.overdue ? `<td class="ui-num">${badge(fmt(r.overdue), "bad", { icon: "alert-triangle" })}</td>` : cell(0)}
      ${cell(r.byStatus.pendiente, "neutral")}
      ${cell(r.byStatus.en_curso, "info")}
      ${cell(done, "ok")}
      ${cell(r.byStatus.bloqueado, "bad")}
      <td class="ui-num">${r.nextDue ? _segFmtD(r.nextDue) : "—"}</td>
      <td class="sg-summary__act">${btn({ label: t("seg.abrir"), size: "sm", variant: "secondary", icon: "arrow-right",
        act: "segOpenPartner", data: { partner: r.partner }, title: t("seg.abrirTip", { p: r.partner }) })}</td>
    </tr>`;
  });
  html += `</tbody></table></div></section>`;
  return html;
}

// ── VISTA KANBAN ─────────────────────────────────────────────────────────────
// Una columna por estado. Funciona global (todos los partners del filtro) o
// acotado a uno — el caso global es el que sirve para la reunión semanal de
// KAMs: "qué está bloqueado en toda mi cartera".
function _segRenderKanban(tasks) {
  const scoped = SEG_STATE.partner ? tasks.filter(r => r.partner === SEG_STATE.partner) : tasks;
  if (!scoped.length) {
    return emptyState({
      icon: "list-check", title: t("seg.kanbanVacio"),
      text: SEG_STATE.partner ? t("seg.vacioAccion") : ""
    });
  }
  const lang = getLang();
  const cols = SEG_STATUS.map(st => {
    const items = scoped.filter(r => (r.status || "pendiente") === st.key)
      .sort((a, b) => {
        // Vencidas arriba, después por fecha de entrega más próxima.
        const ao = _segIsOverdue(a) ? 0 : 1, bo = _segIsOverdue(b) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return String(a.end_date || "9999").localeCompare(String(b.end_date || "9999"));
      });
    // OJO: la variable de la tarjeta NO puede llamarse `t` — tapaba a t() (i18n)
    // y el Kanban reventaba ("t is not a function") apenas había una vencida.
    const cards = items.map(task => {
      const over = _segIsOverdue(task);
      const end  = _segParseDate(task.end_date);
      return `<article class="sg-card${over ? " sg-card--overdue" : ""}">
        ${SEG_STATE.partner ? "" : `<div class="sg-card__partner">${escapeHTML(task.partner || "—")}</div>`}
        <div class="sg-card__task">${escapeHTML(task.task)}</div>
        <div class="sg-card__meta">
          ${task.project ? `<span class="sg-card__proj"><span class="sg-dot" style="background:${_segProjColor(task.project, task.partner)}"></span>${escapeHTML(task.project)}</span>` : ""}
          ${task.owner ? `<span class="sg-meta">${iconSvg("user", { size: 12 })}${escapeHTML(task.owner)}</span>` : ""}
          ${end ? `<span class="sg-meta${over ? " sg-meta--bad" : ""}">${iconSvg("calendar", { size: 12 })}${_segFmtD(end)}</span>` : ""}
          ${over ? badge(t("seg.vencida"), "bad") : ""}
        </div>
        ${task.expected_result ? `<div class="sg-card__goal">${iconSvg("target", { size: 12 })}<span>${escapeHTML(task.expected_result)}</span></div>` : ""}
      </article>`;
    }).join("");
    return `<section class="sg-col" aria-label="${escapeHTML(_segStatusLabel(st.key, lang))}">
      <header class="sg-col__head">
        <span class="sg-dot" style="background:${st.color}"></span>
        <span class="sg-col__title">${escapeHTML(_segStatusLabel(st.key, lang))}</span>
        <span class="sg-col__count">${items.length}</span>
      </header>
      <div class="sg-col__body">${cards || `<div class="sg-col__empty">—</div>`}</div>
    </section>`;
  }).join("");
  return `<div class="sg-kanban">${cols}</div>`;
}

// ── VISTA EDITOR (admin) ─────────────────────────────────────────────────────
function _segRenderEditor(partner, isAdmin) {
  if (!isAdmin) return alertBox({ tone: "info", text: t("seg.soloLectura") });
  const order = _segProjectOrder(SEG_STATE.draft);
  const statusOpts = st => SEG_STATUS.map(s => `<option value="${s.key}" ${s.key === st ? "selected" : ""}>${escapeHTML(_segStatusLabel(s.key, getLang()))}</option>`).join("");

  const taskRowHtml = i => {
    const r = SEG_STATE.draft[i];
    return `<tr class="sg-ed__task">
      <td><input class="ui-input ui-input--sm sg-ed__owner" value="${escapeHTML(r.owner)}" data-act-input="segSet" data-i="${i}" data-field="owner" placeholder="${escapeHTML(t("seg.th.owner"))}" aria-label="${escapeHTML(t("seg.th.owner"))}"/></td>
      <td><input class="ui-input ui-input--sm sg-ed__task-in" value="${escapeHTML(r.task)}" data-act-input="segSet" data-i="${i}" data-field="task" placeholder="${escapeHTML(t("seg.ph.tarea"))}" aria-label="${escapeHTML(t("seg.th.tarea"))}"/></td>
      <td><input class="ui-input ui-input--sm sg-ed__date" type="date" value="${escapeHTML(r.start_date)}" data-act-change="segSet" data-i="${i}" data-field="start_date" aria-label="${escapeHTML(t("seg.th.inicio"))}"/></td>
      <td><input class="ui-input ui-input--sm sg-ed__date" type="date" value="${escapeHTML(r.end_date)}" data-act-change="segSet" data-i="${i}" data-field="end_date" aria-label="${escapeHTML(t("seg.th.fin"))}"/></td>
      <td><input class="ui-input ui-input--sm sg-ed__res" value="${escapeHTML(r.expected_result)}" data-act-input="segSet" data-i="${i}" data-field="expected_result" placeholder="${escapeHTML(t("seg.th.resultado"))}" aria-label="${escapeHTML(t("seg.th.resultado"))}"/></td>
      <td><select class="ui-select ui-select--sm sg-ed__st" data-act-change="segSet" data-i="${i}" data-field="status" aria-label="${escapeHTML(t("seg.th.estado"))}">${statusOpts(r.status)}</select></td>
      <td class="sg-ed__del">${btn({ label: t("seg.eliminarTarea"), iconOnly: true, icon: "trash", variant: "ghost", size: "sm", act: "segDeleteRow", data: { i } })}</td>
    </tr>`;
  };
  const groupsHtml = order.map((proj, pIdx) => {
    const idxs = SEG_STATE.draft.map((r, i) => i).filter(i => (SEG_STATE.draft[i].project || "") === proj);
    return `<tr class="sg-ed__proj"><td colspan="7">
        <div class="sg-ed__proj-row">
          <span class="sg-dot sg-dot--sq" style="background:${_segProjColor(proj, partner)}"></span>
          <input class="ui-input ui-input--sm sg-ed__proj-name" value="${escapeHTML(proj)}" data-act-change="segRenameProject" data-pidx="${pIdx}" placeholder="${escapeHTML(t("seg.ph.proyecto"))}" aria-label="${escapeHTML(t("seg.ph.proyecto"))}"/>
          ${btn({ label: t("seg.masTarea"), icon: "plus", variant: "ghost", size: "sm", act: "segAddTaskTo", data: { pidx: pIdx } })}
          ${btn({ label: t("seg.eliminarProyecto"), icon: "trash", variant: "danger", size: "sm", act: "segDeleteProject", data: { pidx: pIdx }, title: t("seg.eliminarProyectoTip") })}
        </div></td></tr>${idxs.map(taskRowHtml).join("")}`;
  }).join("");

  const hayAlgo = SEG_STATE.draft.length || (SEG_STATE.deleted || []).length;
  const acciones = `<div class="sg-ed__actions">
      ${btn({ label: t("seg.btnProyecto"), icon: "plus", variant: "secondary", act: "segAddProject" })}
      ${btn({ label: t("seg.btnTareaSuelta"), icon: "plus", variant: "secondary", act: "segAddTaskTo", data: { pidx: -1 } })}
      ${btn({ label: t("seg.btnGuardar"), icon: "save", variant: "primary", act: "segSave" })}
      <span class="sg-ed__note">${t("seg.noGuardado")}</span>
    </div>`;

  if (!SEG_STATE.draft.length) {
    return emptyState({
      icon: "list-check", title: t("seg.sinProyectos"), text: t("seg.editorVacioTxt", { p: partner }),
      action: rawHtml(btn({ label: t("seg.btnProyecto"), icon: "plus", variant: "primary", act: "segAddProject" }))
    }) + (hayAlgo ? acciones : "");
  }
  return `<div class="ui-table-wrap sg-ed">
      <table class="ui-table sg-ed__table">
        <thead><tr>
          <th>${escapeHTML(t("seg.th.owner"))}</th><th>${escapeHTML(t("seg.th.tarea"))}</th>
          <th>${escapeHTML(t("seg.th.inicio"))}</th><th>${escapeHTML(t("seg.th.fin"))}</th>
          <th>${escapeHTML(t("seg.th.resultado"))}</th><th>${escapeHTML(t("seg.th.estado"))}</th><th><span class="ui-sr-only">${escapeHTML(t("seg.eliminarTarea"))}</span></th>
        </tr></thead>
        <tbody>${groupsHtml}</tbody>
      </table>
    </div>${acciones}`;
}

function _segGanttSection(partner, isAdmin, sub) {
  if (!_segRealTasks(SEG_STATE.draft).length) {
    return emptyState({
      icon: "calendar", title: t("seg.ganttVacio", { p: partner }),
      text: isAdmin ? t("seg.ganttVacioTxt") : "",
      action: isAdmin ? btn({ label: t("seg.ganttCrear"), icon: "plus", variant: "primary", act: "segSetView", data: { view: "editor" } }) : undefined
    });
  }
  return `<section class="sg-sec ui-card sg-sec--card">` + _sgH(`Gantt · ${partner}`, sub) +
    `<div id="segGantt">${_segBuildGantt(SEG_STATE.draft, { lang: getLang(), partner: SEG_STATE.partner })}</div></section>`;
}

// ── RENDER DEL TAB ──────────────────────────────────────────────────────────
export function renderSeguimiento() {
  const host = document.getElementById("tab-seguimiento");
  if (!host) return;
  const partners = _segPartners();
  if (!partners.length) {
    host.innerHTML = `<div class="sg">${emptyState({ icon: "database", title: t("seg.cargaRendTit"), text: t("seg.cargaRendTxt") })}</div>`;
    return;
  }
  // OJO: acá antes se auto-seleccionaba partners[0] si no había partner elegido.
  // Eso es justamente lo que hacía que la pestaña abriera en el editor de un
  // partner cualquiera (el primero alfabético, casi siempre sin tareas) y diera
  // la sensación de "está todo vacío". Ahora partner=null es un estado válido y
  // significa "todos" — el resumen y el kanban lo entienden.
  const tasks   = _segFilteredTasks();
  const partner = SEG_STATE.partner;
  const isAdmin = !!STATE.isAdmin;

  // Cuerpo según la vista activa. Solo Gantt y Editor usan el `draft` del
  // partner seleccionado; Resumen y Kanban leen directo de STATE.seguimientoData
  // (así el kanban global no depende de haber cargado ningún draft).
  let body = "";
  if (SEG_STATE.view === "resumen") {
    body = _segRenderResumen(tasks);
  } else if (SEG_STATE.view === "kanban") {
    body = _segRenderKanban(tasks);
  } else if (SEG_STATE.view === "gantt") {
    body = _segGanttSection(partner, isAdmin, t("seg.ganttSub"));
  } else {
    body = `<section class="sg-sec">` + _sgH(t("seg.editorTit", { p: partner }), t("seg.editorSub")) +
      _segRenderEditor(partner, isAdmin) + `</section>` +
      (SEG_STATE.draft.length
        ? `<section class="sg-sec ui-card sg-sec--card">` + _sgH("Gantt", t("seg.ganttVivo")) +
          `<div id="segGantt">${_segBuildGantt(SEG_STATE.draft, { lang: getLang(), partner: SEG_STATE.partner })}</div></section>`
        : `<div id="segGantt" hidden></div>`);
  }

  host.innerHTML = `
    <div class="sg">
      ${_segControlsHTML()}
      <div id="segBody" class="sg-body">${body}</div>
    </div>`;
}

// ── DIÁLOGOS ─────────────────────────────────────────────────────────────────
// Salir con cambios sin guardar (I12): antes, elegir otro partner recargaba el
// draft y descartaba en silencio lo tecleado. true = se puede cambiar.
async function _segPuedeSalir(nuevo) {
  if (nuevo === SEG_STATE.partner || !_segDraftSucio()) return true;
  return confirmDialog({
    title: t("seg.dlg.salirTit"), body: t("seg.confirmSalir", { p: SEG_STATE.partner }),
    confirmLabel: t("seg.dlg.descartar"), danger: true
  });
}

// Pedir un texto en la página (reemplazo de prompt()). Mismo contrato que el
// nativo: null = canceló; "" = aceptó vacío. Mismas reglas que confirmDialog:
// DOM con createElement/textContent (CSP), Esc cancela, Enter acepta, foco
// atrapado y devuelto al cerrar.
function _segPedirTexto(o) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const backdrop = el("div", "ui-dialog-backdrop");
    const dialog = el("div", "ui-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const h = el("h2", "ui-dialog__title", o.title);
    h.id = "segDlgT";
    dialog.setAttribute("aria-labelledby", h.id);
    const field = el("label", "ui-field");
    const lbl = el("span", "ui-field__label", o.label);
    const input = el("input", "ui-input");
    input.type = "text"; input.autocomplete = "off"; input.value = o.value || "";
    if (o.placeholder) input.placeholder = o.placeholder;
    field.append(lbl, input);
    const actions = el("div", "ui-dialog__actions");
    const cancel = el("button", "ui-btn ui-btn--secondary", o.cancelLabel || t("dialogo.cancelar"));
    const ok = el("button", "ui-btn ui-btn--primary", o.okLabel || t("dialogo.confirmar"));
    cancel.type = ok.type = "button";
    actions.append(cancel, ok);
    dialog.append(h, field, actions);
    backdrop.appendChild(dialog);
    let done = false;
    const close = v => {
      if (done) return;
      done = true;
      backdrop.remove();
      if (prevFocus && typeof prevFocus.focus === "function" && document.contains(prevFocus)) prevFocus.focus();
      resolve(v);
    };
    cancel.addEventListener("click", () => close(null));
    ok.addEventListener("click", () => close(input.value));
    backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) close(null); });
    backdrop.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); close(null); return; }
      if (e.key === "Enter" && e.target === input) { e.preventDefault(); close(input.value); return; }
      if (e.key === "Tab") {
        const items = [input, cancel, ok];
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
      }
    });
    document.body.appendChild(backdrop);
    input.focus();
  });
}

// ── INTERACCIONES ────────────────────────────────────────────────────────────
export async function segOnPartnerChange(p) {
  if (!(await _segPuedeSalir(p))) { renderSeguimiento(); return; }   // revierte el control
  SEG_STATE.partner = p; _segLoadDraft(p); renderSeguimiento();
}

export function segSetView(v) { SEG_STATE.view = v; renderSeguimiento(); }
export function segSetKam(k)  { SEG_STATE.kam  = k; renderSeguimiento(); }

// Volver a "todos": limpia partner Y búsqueda (dejar la búsqueda puesta haría
// que el resumen siguiera mostrando un solo partner y pareciera que el botón
// no hizo nada).
export async function segClearPartner() {
  if (!(await _segPuedeSalir(null))) return;
  SEG_STATE.partner = null; SEG_STATE.search = ""; SEG_STATE.draft = []; SEG_STATE.deleted = [];
  if (SEG_STATE.view === "gantt" || SEG_STATE.view === "editor") SEG_STATE.view = "resumen";
  renderSeguimiento();
}

// "Abrir" del resumen: seleccionar el partner y saltar a su Gantt — el paso
// natural después de detectar que algo está vencido.
export async function segOpenPartner(p) {
  if (!(await _segPuedeSalir(p))) return;
  SEG_STATE.partner = p; SEG_STATE.search = "";
  _segLoadDraft(p);
  SEG_STATE.view = "gantt";
  renderSeguimiento();
}

// Acción del estado vacío: llevar el foco al buscador y abrir la lista.
export function segFocusSearch() {
  const i = document.getElementById("segSearch");
  if (!i) return;
  i.focus();
  segShowPartnerList();
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
  if (!a.length && !b.length) { list.innerHTML = `<div class="sg-opt sg-opt--empty">${escapeHTML(t("seg.sinCoincidencias"))}</div>`; return; }
  const opt = (p, has) => {
    const sel = p === SEG_STATE.partner;
    return `<div class="sg-opt${sel ? " sg-opt--sel" : ""}" role="option" aria-selected="${sel}" data-partner="${escapeHTML(p)}" data-act-mousedown="segSelectPartner">
      <span class="sg-opt__name">${escapeHTML(p)}</span>
      ${has ? `<span class="sg-opt__tag">${escapeHTML(t("seg.conSegTag"))}</span>` : ""}
    </div>`;
  };
  list.innerHTML = a.slice(0, 60).map(p => opt(p, true)).join("")
                 + b.slice(0, 60).map(p => opt(p, false)).join("");
}
// La búsqueda también filtra el Resumen/Kanban global (_segFilteredTasks), pero
// antes solo se repintaba la lista flotante: el cuerpo seguía mostrando todos
// hasta el próximo render (I12). Se repinta SOLO el cuerpo, no los controles,
// para que el <input> conserve el foco mientras se tipea.
export function segFilterPartners(q) {
  SEG_STATE.search = q; _segPaintPartnerList(q); segShowPartnerList();
  if (SEG_STATE.partner) return;   // con partner elegido el cuerpo no depende de la búsqueda
  const b = document.getElementById("segBody");
  if (!b) return;
  if (SEG_STATE.view === "resumen")     b.innerHTML = _segRenderResumen(_segFilteredTasks());
  else if (SEG_STATE.view === "kanban") b.innerHTML = _segRenderKanban(_segFilteredTasks());
}
export function segShowPartnerList() {
  const l = document.getElementById("segPartnerList");
  if (!l) return;
  l.classList.add("sg-partner-list--open");
  if (!l.innerHTML) { const i = document.getElementById("segSearch"); _segPaintPartnerList(i ? i.value : ""); }
}
export function segHidePartnerList() { const l = document.getElementById("segPartnerList"); if (l) l.classList.remove("sg-partner-list--open"); }
// El blur del input dispara ANTES del click en la opción; el delay le da tiempo
// al mousedown de la opción a correr. Mismo truco que Presentación 2.0.
export function segHidePartnerListDelayed() { setTimeout(segHidePartnerList, 150); }
export async function segSelectPartner(p) {
  segHidePartnerList();
  if (!(await _segPuedeSalir(p))) {
    const i = document.getElementById("segSearch"); if (i) i.value = SEG_STATE.partner || "";
    return;
  }
  SEG_STATE.partner = p; SEG_STATE.search = "";
  _segLoadDraft(p);
  // Desde el resumen, elegir un partner salta al Gantt: es la vista útil una vez
  // que ya sabes de quién estás hablando.
  if (SEG_STATE.view === "resumen") SEG_STATE.view = "gantt";
  renderSeguimiento();
}
export function segSearchKeydown(e) {
  if (e.key === "Enter") {
    const f = document.querySelector("#segPartnerList .sg-opt[data-partner]");
    if (f) f.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    e.preventDefault();
  } else if (e.key === "Escape") { segHidePartnerList(); }
}
export function segSet(i, field, val) { if (SEG_STATE.draft[i]) { SEG_STATE.draft[i][field] = val; _segRenderGantt(); } }
export async function segAddProject() {
  const name = await _segPedirTexto({
    title: t("seg.dlg.nuevoProyectoTit"), label: t("seg.promptProyecto"),
    placeholder: t("seg.ph.proyecto"), okLabel: t("seg.dlg.crear")
  });
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
export async function segDeleteProject(pIdx) {
  const order = _segProjectOrder(SEG_STATE.draft);
  const name = order[pIdx]; if (name === undefined) return;
  const gTasks = SEG_STATE.draft.filter(r => (r.project || "") === name);
  const ok = await confirmDialog({
    title: t("seg.dlg.eliminarProyectoTit"),
    body: t("seg.confirmEliminarProyecto", { p: _segProjLabel(name, getLang()), n: gTasks.length }),
    confirmLabel: t("seg.dlg.eliminar"), danger: true
  });
  if (!ok) return;
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
  if (!STATE.isAdmin) { await alertDialog({ title: t("seg.dlg.errTit"), body: t("seg.errAdmin"), tone: "bad" }); return; }
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

  const ok = await confirmDialog({
    title: t("seg.dlg.guardarTit"),
    body: t("seg.confirmGuardar", { p: partner, n: rows.length, d: SEG_STATE.deleted.length }),
    confirmLabel: t("seg.btnGuardar")
  });
  if (!ok) return;

  let errMsg = null;
  showLoad(true, t("seg.guardando"));
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
    const refrescoOk = await loadFromSupabase();
    _segLoadDraft(partner);
    // Mismo criterio que calcSaveMetas: el guardado ya está confirmado, pero si
    // el refresco falló hay que decirlo — un banner verde sobre una pantalla sin
    // los cambios invita a guardar de nuevo sin necesidad.
    const uno = rows.length === 1;
    showBanner(refrescoOk, refrescoOk
      ? t(uno ? "seg.guardadoOk1" : "seg.guardadoOkN", { p: partner, n: rows.length })
      : t(uno ? "seg.guardadoSinRefresco1" : "seg.guardadoSinRefrescoN", { p: partner, n: rows.length }));
    renderSeguimiento();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    errMsg = /42501|row-level security|permission/i.test(msg) ? t("seg.errPermiso") : t("seg.errGuardar") + msg;
  } finally {
    showLoad(false);
  }
  // Después de quitar el overlay de carga: el diálogo no queda tapado.
  if (errMsg) await alertDialog({ title: t("seg.dlg.errTit"), body: errMsg, tone: "bad" });
}

// ── SLIDE DEL DECK (Presentación 2.0) — render-only, entra al PDF ──────────────
export function p2PartnerHasSeguimiento(partner) {
  return (STATE.seguimientoData || []).some(r => r.partner === partner && (r.task || "").trim());
}
export function buildSlide2Seguimiento(partner, idx) {
  // El idioma del deck es de PRESENT2_STATE (el del partner), no el de la app.
  const L = (typeof PRESENT2_STATE !== "undefined" ? PRESENT2_STATE.lang : "es") || "es";
  const T = (es, en, ru) => pick({ es, en, ru }, L);
  const rows = (STATE.seguimientoData || []).filter(r => r.partner === partner);
  const header = (typeof p2BrandHeader === "function")
    ? p2BrandHeader(partner, T("Seguimiento · Próximos pasos", "Follow-up · Next steps", "Сопровождение · Следующие шаги"),
        T("Proyecto → tareas · owner · fechas · resultado esperado",
          "Project → tasks · owner · dates · expected result",
          "Проект → задачи · ответственный · сроки · ожидаемый результат"))
    : `<h2>${escapeHTML(partner)} — ${T("Seguimiento", "Follow-up", "Сопровождение")}</h2>`;
  const footer = (typeof p2BrandFooter === "function") ? p2BrandFooter(idx) : "";
  return `<div class="agy-style-365">
    ${header}
    <div class="sg-slide__body">${_segBuildGantt(rows, { lang: L, partner })}</div>
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
  segFocusSearch,
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
