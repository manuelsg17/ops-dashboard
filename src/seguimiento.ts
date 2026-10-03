//@ts-nocheck
import { t, getLang, kamLabel } from "./core/i18n";
import { xl, pick } from "./core/i18nExport";
import { mesNombre } from "./core/meses";
import { iconSvg } from "./shared/icons";
import { emptyState, btn } from "./shared/ui";
import { confirmDialog, alertDialog } from "./shared/confirmDialog";
import { SIN_KAM } from "./core/config.js";
import { userCan } from "./auth.js";
import { LISTAS_SEG, ordenLista, moverTarjeta, ordenAlFinal, vencida, vencePronto, checklistDe, avanceChecklist, kanbanDeck, fechaCierre, visibleParaPartner, necesitaAlPartner, motivoVisible } from "./domain/tableroSeg";
// seguimiento.ts — Seguimiento de tareas con los partners, TIPO TRELLO (1-oct-2026).
//
// Manuel eligió la propuesta "A · Clásico" de la maqueta ?ui=tablero
// (src/dev/tablero.ts): un TABLERO POR PARTNER con listas por estado (Por hacer ·
// En curso · Bloqueado · Hecho), tarjetas que se arrastran entre listas, alta
// rápida al pie de cada lista y la tarjeta abierta en una ventana con
// descripción, checklist, comentarios, proyecto, responsable y fechas. Encima,
// "Mi cartera" (todas las tarjetas de los partners del KAM, para la reunión
// semanal) y el "Cronograma" (el Gantt de siempre, que es también la hoja del
// deck de Presentación).
//
// Modelo (tabla `seguimiento`, una fila = una tarjeta): task = título, status =
// lista, sort_order = orden dentro de la lista, expected_result = descripción,
// owner = responsable, project = etiqueta, start/end_date, checklist (jsonb),
// comentarios (jsonb, se agregan con la RPC atómica `seguimiento_comentar`).
// Ver migrations/2026-10-01_seguimiento_tablero.sql.
//
// Guardado INMEDIATO por acción (como Trello), optimista: se cambia STATE y se
// repinta al instante; si la base rechaza, se revierte y se avisa. Escriben
// admins, KAMs y quien tenga el grant `write:seguimiento` (RLS es la seguridad
// real; acá solo se decide qué mostrar).

export const SEG_STATE = {
  partner: null,           // tablero abierto
  view: "tablero",         // "tablero" | "cartera" | "cronograma"
  kam: null,               // null = aún sin decidir (se toma STATE.myKam); "all" = todos
  abierta: null,           // id de la tarjeta abierta en la ventana
  alta: "",                // lista con el alta rápida abierta
  soloVencidas: false, resp: "", search: ""
};

const _LISTA_LBL = { pendiente: "seg.tb.lista.pendiente", en_curso: "seg.tb.lista.en_curso", bloqueado: "seg.tb.lista.bloqueado", hecho: "seg.tb.lista.hecho" };
const _VISTA_LBL = { tablero: "seg.tb.vista.tablero", cartera: "seg.tb.vista.cartera", cronograma: "seg.tb.vista.cronograma" };
export const SEG_VIEWS = [
  { k: "tablero", icon: "presentation" },
  { k: "cartera", icon: "users" },
  { k: "cronograma", icon: "calendar" }
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


// ── HOJA DEL DECK: "Plan de trabajo" en Kanban (1-oct-2026) ─────────────────
// Manuel la eligió (maqueta ?ui=segdeck, propuesta D): cuatro columnas en SU
// orden — Logrados · Bloqueados · En proceso · Próximos pasos — para que el
// partner vea de un vistazo qué se logró, qué está trabado, en qué se avanza y
// qué sigue. Reemplaza al Gantt (que sigue en la pestaña como Cronograma).
//   - Logrados = SOLO lo cerrado en el período del deck (desde el primer
//     período de la ventana), por la fecha real de cierre `completed_at`.
//   - Hasta 4 tarjetas por columna y hoja; lo demás sigue en otra hoja (1/2).
//     Antes, con muchas tareas, el Gantt se cortaba en silencio.
//   - Los comentarios internos NO van al partner.
// Colores literales donde importa al PDF (html2canvas); el del proyecto sale de
// los tokens, como en el Gantt.
const SEG_POR_COLUMNA = 4;
export function p2PartnerHasSeguimiento(partner) {
  return (STATE.seguimientoData || []).some(r => r.partner === partner && (r.task || "").trim() && visibleParaPartner(r));
}
function _segKanbanDe(partner, desde) {
  // Las tarjetas internas (visible_partner = false) no existen para el partner: ni en la hoja ni en sus conteos.
  return kanbanDeck(_segRealTasks((STATE.seguimientoData || []).filter(r => r.partner === partner && visibleParaPartner(r))), desde || "0000", SEG_POR_COLUMNA);
}
/** Cuántas hojas ocupa el Kanban del partner (p2Deck las agrega todas). */
export function p2SegPaginas(partner, desde) { return _segKanbanDe(partner, desde).paginas.length; }

const _SGK = {
  hecho:     { col: "#16a34a", ico: "✓" },
  bloqueado: { col: "#dc2626", ico: "!" },
  en_curso:  { col: "#0284c7", ico: "→" },
  pendiente: { col: "#6b7280", ico: "•" }
};
export function buildSlide2Seguimiento(partner, idx, pag = 0, dates = null) {
  // El idioma del deck es de PRESENT2_STATE (el del partner), no el de la app.
  const L = (typeof PRESENT2_STATE !== "undefined" ? PRESENT2_STATE.lang : "es") || "es";
  const T = (es, en, ru) => pick({ es, en, ru }, L);
  const desde = (dates && dates[0]) || "0000";
  const k = _segKanbanDe(partner, desde);
  const n = k.paginas.length, hoja = k.paginas[Math.min(pag, n - 1)];
  const hoy = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const fd = d => { const x = _segParseDate(d); return x ? `${x.getDate()} ${mesNombre(x.getMonth(), L, { corto: true }).toLowerCase()}` : ""; };
  const desdeTxt = desde !== "0000" ? fd(desde) : "";
  const TIT = {
    hecho:     [T("Logrados", "Achieved", "Достигнуто"), desdeTxt ? T(`cerrados desde el ${desdeTxt}`, `closed since ${desdeTxt}`, `закрыто с ${desdeTxt}`) : T("cerrados", "closed", "закрыто")],
    bloqueado: [T("Bloqueados", "Blocked", "Заблокировано"), T("necesitan una acción", "need an action", "требуют действия")],
    en_curso:  [T("En proceso", "In progress", "В работе"), T("avanzando", "moving forward", "продвигаются")],
    pendiente: [T("Próximos pasos", "Next steps", "Следующие шаги"), T("por fecha", "by date", "по сроку")]
  };
  const card = (r, l, num) => {
    const items = checklistDe(r.checklist), av = avanceChecklist(items), venc = vencida(r, hoy);
    const fecha = l === "hecho" ? T(`Cerrado el ${fd(fechaCierre(r))}`, `Closed ${fd(fechaCierre(r))}`, `Закрыто ${fd(fechaCierre(r))}`)
      : !r.end_date ? T("Sin fecha", "No date", "Без срока")
      : venc ? T(`Vencía el ${fd(r.end_date)}`, `Was due ${fd(r.end_date)}`, `Срок был ${fd(r.end_date)}`)
      : T(`Para el ${fd(r.end_date)}`, `Due ${fd(r.end_date)}`, `Срок ${fd(r.end_date)}`);
    return `<div class="sgk-card" style="border-left-color:${_SGK[l].col}">
      <div class="sgk-top">${r.project ? `<span class="sgk-proy"><span class="sgk-sq" style="background:${_segProjColor(r.project, partner)}"></span>${escapeHTML(r.project)}</span>` : "<span></span>"}${l === "pendiente" ? `<span class="sgk-n">${num}</span>` : ""}</div>
      <div class="sgk-t">${escapeHTML(r.task)}</div>
      ${r.expected_result ? `<div class="sgk-res">🎯 ${escapeHTML(r.expected_result)}</div>` : ""}
      ${motivoVisible(r) ? `<div class="sgk-motivo">🚧 ${escapeHTML(motivoVisible(r))}</div>` : ""}
      ${l === "en_curso" && av.total ? `<div class="sgk-chk"><div class="sgk-bar"><span style="width:${av.pct}%"></span></div><span>${T(`${av.hechos}/${av.total} pasos`, `${av.hechos}/${av.total} steps`, `${av.hechos}/${av.total} шагов`)}</span></div>` : ""}
      <div class="sgk-meta"><span class="${venc ? "sgk-venc" : ""}">${escapeHTML(fecha)}</span><span>${escapeHTML(r.owner || "")}</span></div>
      ${necesitaAlPartner(r) ? `<div class="sgk-nec">${escapeHTML(T("Necesitamos de ti para destrabarlo", "We need you to unblock it", "Нужна ваша помощь, чтобы разблокировать"))}</div>` : ""}
    </div>`;
  };
  const cols = LISTAS_ORDEN_DECK.map(l => {
    const lista = hoja[l], resto = k.conteo[l] - (pag + 1) * SEG_POR_COLUMNA;
    const vacio = pag === 0 ? (l === "bloqueado" ? T("Nada bloqueado", "Nothing blocked", "Ничего не заблокировано") : "—") : "";
    return `<section class="sgk-col">
      <header class="sgk-h" style="background:${_SGK[l].col}"><span class="sgk-ico">${_SGK[l].ico}</span><span class="sgk-h__t"><b>${escapeHTML(TIT[l][0])}</b><span>${escapeHTML(TIT[l][1])}</span></span><span class="sgk-cnt">${k.conteo[l]}</span></header>
      <div class="sgk-body">${lista.map((r, j) => card(r, l, pag * SEG_POR_COLUMNA + j + 1)).join("") || `<div class="sgk-vacio">${escapeHTML(vacio)}</div>`}
        ${resto > 0 ? `<div class="sgk-mas">${escapeHTML(T(`+${resto} en la hoja siguiente`, `+${resto} on the next page`, `+${resto} на следующей странице`))}</div>` : ""}</div>
    </section>`;
  }).join("");
  const sub = n > 1 ? ` (${pag + 1}/${n})` : "";
  const header = (typeof p2BrandHeader === "function")
    ? p2BrandHeader(partner, T("Plan de trabajo", "Work plan", "План работ") + sub, T("En qué estamos: logrado, bloqueado, en proceso y próximos pasos", "Where we are: achieved, blocked, in progress and next steps", "Где мы: достигнуто, заблокировано, в работе и следующие шаги"))
    : `<h2>${escapeHTML(partner)}</h2>`;
  const footer = (typeof p2BrandFooter === "function") ? p2BrandFooter(idx) : "";
  return `<div class="agy-style-365">
    ${header}
    <div class="sgk-sum">
      <div class="sgk-av"><b>${k.pct}%</b> ${escapeHTML(T("del plan completado", "of the plan completed", "плана выполнено"))} <span class="sgk-av__sub">${k.hechas}/${k.total}</span><div class="sgk-bar sgk-bar--av"><span style="width:${k.pct}%"></span></div></div>
      ${LISTAS_ORDEN_DECK.map(l => `<div class="sgk-mini"><b style="color:${_SGK[l].col}">${k.conteo[l]}</b>${escapeHTML(TIT[l][0].toLowerCase())}</div>`).join("")}
      ${k.logradosAntes ? `<div class="sgk-antes">${escapeHTML(T(`+${k.logradosAntes} logrados antes del ${desdeTxt}`, `+${k.logradosAntes} achieved before ${desdeTxt}`, `+${k.logradosAntes} достигнуто до ${desdeTxt}`))}</div>` : ""}
    </div>
    <div class="sgk">${cols}</div>
    ${footer}
  </div>`;
}
const LISTAS_ORDEN_DECK = ["hecho", "bloqueado", "en_curso", "pendiente"];

// ── TABLERO: datos ───────────────────────────────────────────────────────────
// Fecha de HOY en hora local, "YYYY-MM-DD" (las fechas de la tarjeta no tienen hora).
function _hoy() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
// ¿Puede crear/mover/editar? Admin, KAM o el grant puntual. RLS manda.
export function segPuedeEscribir() {
  return STATE.userRole === "kam" || userCan("write:seguimiento");
}
// KAM del filtro: la primera vez arranca en el KAM del login (si tiene) y si no en "todos".
function _kamFiltro() {
  if (SEG_STATE.kam === null) SEG_STATE.kam = STATE.myKam || "all";
  return SEG_STATE.kam;
}
const _filas = () => _segRealTasks(STATE.seguimientoData);
// Tarjetas del alcance de la vista: partner abierto (tablero) o cartera del KAM.
function _alcance() {
  const k = _kamFiltro();
  if (SEG_STATE.view === "cartera") return _filas().filter(r => k === "all" || _segKamOf(r.partner) === k);
  return _filas().filter(r => r.partner === SEG_STATE.partner);
}
function _filtradas(rows) {
  const hoy = _hoy();
  return rows.filter(r => (!SEG_STATE.soloVencidas || vencida(r, hoy)) && (!SEG_STATE.resp || (r.owner || "") === SEG_STATE.resp));
}
// Partners para los botones: los del KAM con tarjetas, más el abierto (aunque esté vacío).
function _partnersConTablero() {
  const k = _kamFiltro();
  const set = new Set(_filas().filter(r => k === "all" || _segKamOf(r.partner) === k).map(r => r.partner));
  if (SEG_STATE.partner) set.add(SEG_STATE.partner);
  return [...set].filter(Boolean).sort();
}
const _fCorta = d => { const x = _segParseDate(d); return x ? `${x.getDate()} ${mesNombre(x.getMonth(), getLang(), { corto: true }).toLowerCase()}` : ""; };
// "manuel.santillana@x.com" → "Manuel Santillana" (el autor del comentario viene del JWT).
const _nombre = q => String(q || "").split("@")[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const _ini = n => String(n || "").replace(/\(.*\)/, "").replace(/[._-]+/g, " ").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
const _av = n => n ? `<span class="sgt-av" title="${escapeHTML(n)}">${escapeHTML(_ini(n))}</span>` : "";
const _lbl = (p, partner) => p ? `<span class="sgt-lbl" style="background:${_segProjColor(p, partner)}">${escapeHTML(p)}</span>` : "";

// ── TABLERO: render ──────────────────────────────────────────────────────────
function _tarjeta(r, conPartner) {
  const hoy = _hoy(), chk = avanceChecklist(checklistDe(r.checklist)), ncom = Array.isArray(r.comentarios) ? r.comentarios.length : 0;
  const fin = (r.end_date || "").slice(0, 10);
  const tono = r.status === "hecho" ? " sgt-badge--ok" : vencida(r, hoy) ? " sgt-badge--bad" : vencePronto(r, hoy) ? " sgt-badge--warn" : "";
  const badges = [
    fin ? `<span class="sgt-badge${tono}" title="${escapeHTML(t("seg.tb.vence"))}">${iconSvg("clock", { size: 12 })}${escapeHTML(_fCorta(fin))}</span>` : "",
    chk.total ? `<span class="sgt-badge${chk.hechos === chk.total ? " sgt-badge--ok" : ""}">${iconSvg("check-circle", { size: 12 })}${chk.hechos}/${chk.total}</span>` : "",
    ncom ? `<span class="sgt-badge">${iconSvg("file-text", { size: 12 })}${ncom}</span>` : "",
    r.depende_partner ? `<span class="sgt-chip sgt-chip--dep" title="${escapeHTML(t("seg.tb.depende"))}">${iconSvg("users", { size: 12 })}${escapeHTML(t("seg.tb.chipPartner"))}</span>` : "",
    visibleParaPartner(r) ? "" : `<span class="sgt-chip sgt-chip--int" title="${escapeHTML(t("seg.tb.visibleAyudaOff"))}">${iconSvg("lock", { size: 12 })}${escapeHTML(t("seg.tb.chipInterna"))}</span>`,
    r.expected_result ? `<span class="sgt-badge" title="${escapeHTML(t("seg.tb.tieneDesc"))}">${iconSvg("menu", { size: 12 })}</span>` : ""
  ].join("");
  return `<article class="sgt-card${SEG_STATE.abierta === r.id ? " is-open" : ""}" draggable="${segPuedeEscribir()}" data-card="${escapeHTML(r.id)}" data-act="segAbrir" data-id="${escapeHTML(r.id)}" tabindex="0">
    ${conPartner ? `<div class="sgt-card__partner">${escapeHTML(r.partner)}</div>` : ""}
    ${r.project ? `<div class="sgt-card__lbls">${_lbl(r.project, r.partner)}</div>` : ""}
    <div class="sgt-card__t">${escapeHTML(r.task)}</div>
    ${r.status === "bloqueado" ? `<div class="sgt-motivo${motivoVisible(r) ? "" : " sgt-motivo--vacio"}">${iconSvg("alert-circle", { size: 12 })}<span>${escapeHTML(motivoVisible(r) || t("seg.tb.sinMotivo"))}</span></div>` : ""}
    ${badges || r.owner ? `<div class="sgt-card__foot"><span class="sgt-card__badges">${badges}</span>${_av(r.owner)}</div>` : ""}
  </article>`;
}
function _altaRapida(lista) {
  if (!segPuedeEscribir() || SEG_STATE.view !== "tablero") return "";
  if (SEG_STATE.alta === lista) {
    return `<div class="sgt-alta"><textarea id="segAltaTxt" rows="2" placeholder="${escapeHTML(t("seg.tb.phTitulo"))}" data-act-keydown="segAltaKey" data-lista="${lista}"></textarea>
      <div class="sgt-alta__row">${btn({ label: t("seg.tb.anadir"), variant: "primary", size: "sm", act: "segAltaOk", data: { lista } })}
      <button type="button" class="sgt-x" data-act="segAltaNo" aria-label="${escapeHTML(t("dialogo.cancelar"))}">${iconSvg("x", { size: 16 })}</button></div></div>`;
  }
  return `<button type="button" class="sgt-add" data-act="segAlta" data-lista="${lista}">${iconSvg("plus", { size: 14 })}${escapeHTML(t("seg.tb.anadirTarjeta"))}</button>`;
}
function _tablero(rows) {
  const conPartner = SEG_STATE.view === "cartera";
  const listas = LISTAS_SEG.map(l => {
    const cards = ordenLista(rows, l);
    return `<section class="sgt-list" aria-label="${escapeHTML(_segStatusLabel(l, getLang()))}">
      <header class="sgt-list__h"><span class="sg-dot" style="background:${_segStatusColor(l)}"></span><strong>${escapeHTML(t(_LISTA_LBL[l]))}</strong><span class="sgt-list__n">${cards.length}</span></header>
      <div class="sgt-list__body" data-drop="${l}">${cards.map(r => _tarjeta(r, conPartner)).join("") || `<div class="sgt-list__vacia">${escapeHTML(t(segPuedeEscribir() ? "seg.tb.soltaAqui" : "seg.tb.sinTarjetas"))}</div>`}</div>
      ${_altaRapida(l)}
    </section>`;
  }).join("");
  return `<div class="sgt-board" id="segBoard">${listas}</div>`;
}

function _cabecera() {
  const hoy = _hoy(), rows = _alcance();
  const abiertas = rows.filter(r => r.status !== "hecho").length, venc = rows.filter(r => vencida(r, hoy)).length;
  const bloq = rows.filter(r => r.status === "bloqueado").length, pronto = rows.filter(r => vencePronto(r, hoy)).length;
  const vistas = SEG_VIEWS.map(v => {
    const dis = v.k !== "cartera" && !SEG_STATE.partner;
    return `<button type="button" class="${SEG_STATE.view === v.k ? "is-on" : ""}"${dis ? ` disabled title="${escapeHTML(t("seg.eligePartner"))}"` : ` data-act="segSetView" data-view="${v.k}"`}>${iconSvg(v.icon, { size: 14 })}${escapeHTML(t(_VISTA_LBL[v.k]))}</button>`;
  }).join("");
  const pills = _partnersConTablero().map(p => {
    const de = _filas().filter(r => r.partner === p), v = de.filter(r => vencida(r, hoy)).length;
    const on = SEG_STATE.view !== "cartera" && SEG_STATE.partner === p;
    return `<button type="button" class="sgt-pill${on ? " is-on" : ""}" data-act="segSelectPartner" data-partner="${escapeHTML(p)}">${escapeHTML(p)} <span class="sgt-pill__n">${de.filter(r => r.status !== "hecho").length}</span>${v ? `<span class="sgt-pill__bad" title="${escapeHTML(t("seg.tb.nVencidas", { n: v }))}">${v}</span>` : ""}</button>`;
  }).join("");
  const kams = [...new Set(_segPartners().map(_segKamOf))].filter(k => k && k !== SIN_KAM).sort();
  const resp = [...new Set(rows.map(r => r.owner).filter(Boolean))].sort();
  return `<div class="sgt-head ui-card">
    <div class="sgt-head__row">
      <div class="sgt-seg" role="group" aria-label="${escapeHTML(t("seg.lblVista"))}">${vistas}</div>
      <div class="sgt-kpis">
        <span><b>${abiertas}</b> ${escapeHTML(t("seg.tb.abiertas"))}</span>
        <span class="${venc ? "is-bad" : ""}"><b>${venc}</b> ${escapeHTML(t("seg.tb.vencidas"))}</span>
        <span class="${bloq ? "is-bad" : ""}"><b>${bloq}</b> ${escapeHTML(t("seg.tb.bloqueadas"))}</span>
        <span><b>${pronto}</b> ${escapeHTML(t("seg.tb.estaSemana"))}</span>
      </div>
    </div>
    <div class="sgt-head__row">
      <div class="sgt-pills">${pills}
        <div class="sgt-buscar">
          <button type="button" class="sgt-pill sgt-pill--add" data-act="segFocusSearch">${iconSvg("plus", { size: 13 })}${escapeHTML(t("seg.tb.abrirPartner"))}</button>
          <div class="sgt-buscar__pop" id="segBuscarPop" hidden>
            <input id="segSearch" type="text" class="ui-input ui-input--sm" autocomplete="off" role="combobox" aria-controls="segPartnerList"
              placeholder="${escapeHTML(t("seg.phBuscar"))}" value="${escapeHTML(SEG_STATE.search)}"
              data-act-input="segFilterPartners" data-act-blur="segHidePartnerListDelayed" data-act-keydown="segSearchKeydown"/>
            <div id="segPartnerList" class="sg-partner-list sg-partner-list--open" role="listbox"></div>
          </div>
        </div>
      </div>
      <div class="sgt-filtros">
        <select class="ui-select ui-select--sm" data-act-change="segSetKam" aria-label="KAM">
          <option value="all"${_kamFiltro() === "all" ? " selected" : ""}>${escapeHTML(t("seg.tb.todosKams"))}</option>
          ${kams.map(k => `<option value="${escapeHTML(k)}"${_kamFiltro() === k ? " selected" : ""}>${escapeHTML(kamLabel(k))}</option>`).join("")}
        </select>
        <select class="ui-select ui-select--sm" data-act-change="segSetResp" aria-label="${escapeHTML(t("seg.tb.responsable"))}">
          <option value="">${escapeHTML(t("seg.tb.todosResp"))}</option>
          ${resp.map(r => `<option value="${escapeHTML(r)}"${r === SEG_STATE.resp ? " selected" : ""}>${escapeHTML(r)}</option>`).join("")}
        </select>
        <label class="sgt-chk-f"><input type="checkbox"${SEG_STATE.soloVencidas ? " checked" : ""} data-act-change="segSoloVencidas">${escapeHTML(t("seg.tb.soloVencidas"))}</label>
      </div>
    </div>
  </div>`;
}

// ── Ventana de la tarjeta ────────────────────────────────────────────────────
function _detalle(r) {
  const puede = segPuedeEscribir(), hoy = _hoy();
  const dis = puede ? "" : " disabled";
  const items = checklistDe(r.checklist), av = avanceChecklist(items);
  const coms = (Array.isArray(r.comentarios) ? r.comentarios : []).slice().reverse();
  const proys = [...new Set(_filas().filter(x => x.partner === r.partner).map(x => x.project || ""))].filter(Boolean).sort();
  const fin = (r.end_date || "").slice(0, 10);
  const opt = (v, l, sel) => `<option value="${escapeHTML(v)}"${sel ? " selected" : ""}>${escapeHTML(l)}</option>`;
  const fecha = d => { const x = new Date(d); return isNaN(+x) ? "" : `${x.getDate()} ${mesNombre(x.getMonth(), getLang(), { corto: true }).toLowerCase()} · ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  return `<div class="sgt-det">
    <header class="sgt-det__h">
      <span class="sgt-det__ico">${iconSvg("list-check", { size: 18 })}</span>
      <div class="sgt-det__tit">
        <input class="sgt-det__title" value="${escapeHTML(r.task)}" data-act-change="segCampo" data-id="${escapeHTML(r.id)}" data-campo="task" aria-label="${escapeHTML(xl("seg.tarea", getLang()))}"${dis}>
        <div class="sgt-det__sub">${escapeHTML(t("seg.tb.enLista", { l: t(_LISTA_LBL[r.status || "pendiente"] || _LISTA_LBL.pendiente), p: r.partner }))}</div>
      </div>
      <button type="button" class="sgt-x" data-act="segCerrar" aria-label="${escapeHTML(t("seg.tb.cerrar"))}">${iconSvg("x", { size: 18 })}</button>
    </header>
    <div class="sgt-det__grid">
      <div class="sgt-det__main">
        <div class="sgt-det__chips">
          ${r.project ? `<div><span class="sgt-det__lbl">${escapeHTML(t("seg.tb.proyecto"))}</span>${_lbl(r.project, r.partner)}</div>` : ""}
          ${r.owner ? `<div><span class="sgt-det__lbl">${escapeHTML(t("seg.tb.responsable"))}</span><span class="sgt-det__resp">${_av(r.owner)}${escapeHTML(r.owner)}</span></div>` : ""}
          ${fin ? `<div><span class="sgt-det__lbl">${escapeHTML(t("seg.tb.vence"))}</span><span class="sgt-badge${r.status === "hecho" ? " sgt-badge--ok" : vencida(r, hoy) ? " sgt-badge--bad" : vencePronto(r, hoy) ? " sgt-badge--warn" : ""}">${iconSvg("clock", { size: 12 })}${escapeHTML(_fCorta(fin))}${vencida(r, hoy) ? " · " + escapeHTML(t("seg.vencida")) : ""}</span></div>` : ""}
        </div>
        ${r.status === "bloqueado" ? `<h4 class="sgt-det__sec">${iconSvg("alert-circle", { size: 15 })}${escapeHTML(t("seg.tb.motivo"))}</h4>
        <textarea class="sgt-in sgt-in--area sgt-in--bloq" rows="2" placeholder="${escapeHTML(t("seg.tb.phMotivo"))}" data-act-change="segCampo" data-id="${escapeHTML(r.id)}" data-campo="motivo_bloqueo"${dis}>${escapeHTML(r.motivo_bloqueo || "")}</textarea>
        <div class="sgt-ayuda">${escapeHTML(t(visibleParaPartner(r) ? "seg.tb.motivoAyuda" : "seg.tb.visibleAyudaOff"))}</div>` : ""}
        <h4 class="sgt-det__sec">${iconSvg("menu", { size: 15 })}${escapeHTML(t("seg.tb.descripcion"))}</h4>
        <textarea class="sgt-in sgt-in--area" rows="3" placeholder="${escapeHTML(t("seg.tb.phDesc"))}" data-act-change="segCampo" data-id="${escapeHTML(r.id)}" data-campo="expected_result"${dis}>${escapeHTML(r.expected_result || "")}</textarea>
        <h4 class="sgt-det__sec">${iconSvg("check-circle", { size: 15 })}${escapeHTML(t("seg.tb.checklist"))}${av.total ? `<span class="sgt-det__pct">${av.pct}%</span>` : ""}</h4>
        ${av.total ? `<div class="sgt-prog"><span style="width:${av.pct}%"></span></div>` : ""}
        <ul class="sgt-chk">${items.map((x, i) => `<li><label><input type="checkbox"${x.ok ? " checked" : ""} data-act-change="segCheck" data-id="${escapeHTML(r.id)}" data-i="${i}"${dis}><span class="${x.ok ? "is-ok" : ""}">${escapeHTML(x.t)}</span></label>
          ${puede ? `<button type="button" class="sgt-x sgt-x--sm" data-act="segCheckDel" data-id="${escapeHTML(r.id)}" data-i="${i}" aria-label="${escapeHTML(t("seg.tb.quitar"))}">${iconSvg("x", { size: 13 })}</button>` : ""}</li>`).join("")}</ul>
        ${puede ? `<div class="sgt-inline"><input class="sgt-in" id="segChkNuevo" placeholder="${escapeHTML(t("seg.tb.phItem"))}" data-act-keydown="segCheckKey" data-id="${escapeHTML(r.id)}">${btn({ label: t("seg.tb.anadir"), size: "sm", act: "segCheckAdd", data: { id: r.id } })}</div>` : ""}
        <h4 class="sgt-det__sec">${iconSvg("file-text", { size: 15 })}${escapeHTML(t("seg.tb.comentarios"))}</h4>
        ${puede ? `<div class="sgt-inline">${_av(STATE.userEmail || "")}<input class="sgt-in" id="segComNuevo" placeholder="${escapeHTML(t("seg.tb.phComentario"))}" data-act-keydown="segComKey" data-id="${escapeHTML(r.id)}">${btn({ label: t("seg.tb.enviar"), size: "sm", act: "segComAdd", data: { id: r.id } })}</div>` : ""}
        <ul class="sgt-com">${coms.map(c => `<li>${_av(_nombre(c.quien))}<div><div class="sgt-com__h"><b>${escapeHTML(_nombre(c.quien) || "—")}</b><span>${escapeHTML(fecha(c.at))}</span></div><div class="sgt-com__t">${escapeHTML(c.txt || "")}</div></div></li>`).join("") || (puede ? "" : `<li class="sgt-com__vacio">${escapeHTML(t("seg.tb.sinComentarios"))}</li>`)}</ul>
      </div>
      <aside class="sgt-det__side">
        <span class="sgt-det__lbl">${escapeHTML(xl("seg.estado", getLang()))}</span>
        <select class="sgt-in" data-act-change="segEstado" data-id="${escapeHTML(r.id)}"${dis}>${LISTAS_SEG.map(l => opt(l, t(_LISTA_LBL[l]), l === (r.status || "pendiente"))).join("")}</select>
        <span class="sgt-det__lbl">${escapeHTML(t("seg.tb.proyecto"))}</span>
        <select class="sgt-in" data-act-change="segProyecto" data-id="${escapeHTML(r.id)}"${dis}>${opt("", xl("seg.sinProyecto", getLang()), !r.project)}${proys.map(p => opt(p, p, p === r.project)).join("")}${puede ? opt("__nuevo__", t("seg.tb.nuevoProyecto"), false) : ""}</select>
        <span class="sgt-det__lbl">${escapeHTML(t("seg.tb.responsable"))}</span>
        <input class="sgt-in" value="${escapeHTML(r.owner || "")}" placeholder="${escapeHTML(t("seg.tb.phResp"))}" data-act-change="segCampo" data-id="${escapeHTML(r.id)}" data-campo="owner"${dis}>
        <span class="sgt-det__lbl">${escapeHTML(t("seg.tb.inicio"))}</span>
        <input class="sgt-in" type="date" value="${escapeHTML((r.start_date || "").slice(0, 10))}" data-act-change="segCampo" data-id="${escapeHTML(r.id)}" data-campo="start_date"${dis}>
        <span class="sgt-det__lbl">${escapeHTML(t("seg.tb.vence"))}</span>
        <input class="sgt-in" type="date" value="${escapeHTML(fin)}" data-act-change="segCampo" data-id="${escapeHTML(r.id)}" data-campo="end_date"${dis}>
        <div class="sgt-bloque"><span class="sgt-det__lbl">${escapeHTML(t("seg.tb.presentacion"))}</span>
          <label class="sgt-sw"><input type="checkbox"${r.depende_partner ? " checked" : ""} data-act-change="segFlag" data-id="${escapeHTML(r.id)}" data-campo="depende_partner"${dis}><span class="sgt-sw__t"><b>${escapeHTML(t("seg.tb.depende"))}</b><small>${escapeHTML(t("seg.tb.dependeAyuda"))}</small></span></label>
          <label class="sgt-sw"><input type="checkbox"${visibleParaPartner(r) ? " checked" : ""} data-act-change="segFlag" data-id="${escapeHTML(r.id)}" data-campo="visible_partner"${dis}><span class="sgt-sw__t"><b>${escapeHTML(t("seg.tb.visible"))}</b><small>${escapeHTML(t(visibleParaPartner(r) ? "seg.tb.visibleAyudaOn" : "seg.tb.visibleAyudaOff"))}</small></span></label>
        </div>
        ${puede ? `<hr>
        ${r.status !== "hecho" ? `<button type="button" class="sgt-side-btn" data-act="segSiguiente" data-id="${escapeHTML(r.id)}">${iconSvg("arrow-right", { size: 14 })}${escapeHTML(t("seg.tb.siguiente"))}</button>` : ""}
        <button type="button" class="sgt-side-btn sgt-side-btn--bad" data-act="segBorrar" data-id="${escapeHTML(r.id)}">${iconSvg("trash", { size: 14 })}${escapeHTML(t("seg.tb.eliminar"))}</button>` : ""}
      </aside>
    </div>
  </div>`;
}

// ── RENDER DEL TAB ──────────────────────────────────────────────────────────
export function renderSeguimiento() {
  const host = document.getElementById("tab-seguimiento");
  if (!host) return;
  if (!_segPartners().length) {
    host.innerHTML = `<div class="sg">${emptyState({ icon: "database", title: t("seg.cargaRendTit"), text: t("seg.cargaRendTxt") })}</div>`;
    return;
  }
  // Sin partner abierto: el primero con tarjetas del KAM; si no hay ninguno, "Mi cartera".
  if (!SEG_STATE.partner && SEG_STATE.view !== "cartera") {
    const p = _partnersConTablero()[0];
    if (p) SEG_STATE.partner = p; else SEG_STATE.view = "cartera";
  }
  const sx = document.getElementById("segBoard")?.scrollLeft || 0;
  const rows = _filtradas(_alcance());
  let cuerpo;
  if (SEG_STATE.view === "cronograma") {
    const de = _alcance();
    cuerpo = de.length
      ? `<section class="sg-sec ui-card sg-sec--card"><div id="segGantt">${_segBuildGantt(de, { lang: getLang(), partner: SEG_STATE.partner })}</div></section>`
      : emptyState({ icon: "calendar", title: t("seg.ganttVacio", { p: SEG_STATE.partner }), text: t("seg.tb.ganttVacioTxt") });
  } else if (SEG_STATE.view === "cartera" && !_alcance().length) {
    cuerpo = emptyState({ icon: "list-check", title: t("seg.tb.carteraVacia"), text: t("seg.tb.carteraVaciaTxt"),
      action: segPuedeEscribir() ? btn({ label: t("seg.tb.abrirPartner"), icon: "plus", variant: "primary", act: "segFocusSearch" }) : undefined });
  } else {
    cuerpo = _tablero(rows);
  }
  const titulo = SEG_STATE.view === "cartera"
    ? t("seg.tb.tituloCartera", { k: _kamFiltro() === "all" ? t("seg.tb.todosKams") : kamLabel(_kamFiltro()) })
    : t("seg.tb.tituloPartner", { p: SEG_STATE.partner || "" });
  const kamP = SEG_STATE.view !== "cartera" && SEG_STATE.partner ? _segKamOf(SEG_STATE.partner) : "";
  const abierta = SEG_STATE.abierta && _filas().find(r => r.id === SEG_STATE.abierta);
  if (SEG_STATE.abierta && !abierta) SEG_STATE.abierta = null;
  // La ventana de la tarjeta se rearma con todo el tablero en cada cambio: sin
  // esto volvía arriba (marcar un ítem del checklist al pie te subía) y el campo
  // con el foco se destruía (en el celular se cerraba el teclado). 3-oct-2026.
  const modalAntes = host.querySelector(".sgt-modal");
  const scrollModal = modalAntes ? modalAntes.scrollTop : 0;
  const foco = _claveFoco(document.activeElement);
  host.innerHTML = `<div class="sg sgt">
      <div class="sgt-titulo"><h2>${escapeHTML(titulo)}</h2>${kamP && kamP !== SIN_KAM ? `<span class="sgt-titulo__kam">${iconSvg("user", { size: 13 })}${escapeHTML(kamLabel(kamP))}</span>` : ""}
        ${segPuedeEscribir() ? "" : `<span class="sgt-titulo__ro">${iconSvg("lock", { size: 13 })}${escapeHTML(t("seg.tb.soloLectura"))}</span>`}</div>
      ${_cabecera()}
      ${cuerpo}
      ${abierta ? `<div class="sgt-modal" data-act="segFondo"><div class="sgt-modal__box" role="dialog" aria-modal="true">${_detalle(abierta)}</div></div>` : ""}
    </div>`;
  const b = document.getElementById("segBoard"); if (b) b.scrollLeft = sx;
  const modal = host.querySelector(".sgt-modal");
  if (modal && scrollModal) modal.scrollTop = scrollModal;
  if (modal && foco) {
    const el = modal.querySelector(foco) as HTMLElement | null;
    if (el && el.focus) el.focus({ preventScroll: true });
  }
  if (SEG_STATE.alta) document.getElementById("segAltaTxt")?.focus();
  _instalarDnD(host);
}

// Selector que vuelve a encontrar el campo enfocado de la ventana de la tarjeta
// después de repintar (null si el foco no está en la ventana).
function _claveFoco(el) {
  if (!el || !el.closest || !el.closest(".sgt-modal")) return null;
  const esc = v => (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/"/g, '\\"');
  const campo = el.getAttribute("data-campo");
  if (campo) return `[data-campo="${esc(campo)}"]`;
  if (el.id) return `#${esc(el.id)}`;
  const act = el.getAttribute("data-act-change") || el.getAttribute("data-act");
  if (!act) return null;
  const i = el.getAttribute("data-i");
  return `[data-act-change="${esc(act)}"]${i != null ? `[data-i="${esc(i)}"]` : ""}, [data-act="${esc(act)}"]${i != null ? `[data-i="${esc(i)}"]` : ""}`;
}

// ── GUARDADO (inmediato y optimista) ─────────────────────────────────────────
function _fila(id) { return (STATE.seguimientoData || []).find(r => r.id === id); }
async function _error(err) {
  const msg = (err && err.message) || String(err || "");
  await alertDialog({ title: t("seg.dlg.errTit"), body: /42501|row-level security|permission/i.test(msg) ? t("seg.errPermiso") : t("seg.errGuardar") + msg, tone: "bad" });
}
// Aplica `patch` a varias filas: primero en STATE (se ve al instante) y después
// en la base. Si la base falla o no actualiza nada (RLS deja 0 filas sin error),
// se vuelve a lo anterior.
async function _actualizar(cambios) {
  const antes = cambios.map(c => ({ fila: _fila(c.id), prev: {} }));
  cambios.forEach((c, i) => { const f = antes[i].fila; if (!f) return; Object.keys(c.patch).forEach(k => { antes[i].prev[k] = f[k]; f[k] = c.patch[k]; }); });
  // En la próxima vuelta del event loop, no en el acto: el `change` de un campo
  // corre DURANTE el blur (Tab o tocar otro campo), antes de que el foco llegue
  // al campo siguiente. Repintando ahí, ese campo se destruía antes de recibir
  // el foco. Un instante después el foco ya está en él y renderSeguimiento lo
  // restaura en el nodo nuevo.
  setTimeout(renderSeguimiento, 0);
  try {
    const now = new Date().toISOString();
    const res = await Promise.all(cambios.map(c => sb.from("seguimiento").update({ ...c.patch, updated_at: now }).eq("id", c.id).select("id")));
    const err = res.find(r => r.error)?.error || (res.some(r => !(r.data || []).length) ? { message: "42501" } : null);
    if (err) throw err;
  } catch (err) {
    antes.forEach(({ fila, prev }) => fila && Object.assign(fila, prev));
    renderSeguimiento();
    await _error(err);
  }
}
const _patch = (id, patch) => _actualizar([{ id, patch }]);

async function _crear(lista, titulo) {
  const partner = SEG_STATE.partner;
  if (!partner || !titulo) return;
  const kam = _segKamOf(partner);
  const row = { partner, task: titulo, status: lista, sort_order: ordenAlFinal(_filas().filter(r => r.partner === partner), lista),
    kam: kam && kam !== SIN_KAM ? kam : null, owner: null, checklist: [], comentarios: [] };
  const { data, error } = await sb.from("seguimiento").insert(row).select("*").single();
  if (error) { await _error(error); return; }
  (STATE.seguimientoData = STATE.seguimientoData || []).push(data);
  renderSeguimiento();
}
async function _borrar(id) {
  const r = _fila(id); if (!r) return;
  const ok = await confirmDialog({ title: t("seg.tb.eliminarTit"), body: t("seg.tb.eliminarTxt", { tarea: r.task }), confirmLabel: t("seg.tb.eliminar"), danger: true });
  if (!ok) return;
  const { data, error } = await sb.from("seguimiento").delete().eq("id", id).select("id");
  if (error || !(data || []).length) { await _error(error || { message: "42501" }); return; }
  STATE.seguimientoData = STATE.seguimientoData.filter(x => x.id !== id);
  SEG_STATE.abierta = null;
  renderSeguimiento();
}
async function _comentar(id, txt) {
  if (!txt) return;
  const { data, error } = await sb.rpc("seguimiento_comentar", { p_id: id, p_texto: txt });
  if (error || !data) { await _error(error || { message: "42501" }); return; }
  const r = _fila(id); if (r) r.comentarios = data;
  renderSeguimiento();
  document.getElementById("segComNuevo")?.focus();
}
// Cuadro al pasar a Bloqueado: motivo (opcional) y "depende del partner". null = canceló.
function _segPedirBloqueo(r) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const backdrop = el("div", "ui-dialog-backdrop");
    const dialog = el("div", "ui-dialog");
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
    const h = el("h2", "ui-dialog__title", t("seg.dlg.bloqTit")); h.id = "segBloqT";
    dialog.setAttribute("aria-labelledby", h.id);
    const tarea = el("p", "sgt-dlg__tarea", r.task);
    const field = el("label", "ui-field");
    const area = el("textarea", "ui-input"); area.rows = 3; area.value = r.motivo_bloqueo || ""; area.placeholder = t("seg.tb.phMotivo");
    field.append(el("span", "ui-field__label", t("seg.dlg.bloqLabel")), area);
    const dep = el("label", "sgt-dlg__chk"); const cb = el("input"); cb.type = "checkbox"; cb.checked = !!r.depende_partner;
    dep.append(cb, el("span", null, t("seg.dlg.bloqDep")));
    const actions = el("div", "ui-dialog__actions");
    const cancel = el("button", "ui-btn ui-btn--secondary", t("dialogo.cancelar"));
    const ok = el("button", "ui-btn ui-btn--primary", t("seg.dlg.bloqOk"));
    cancel.type = ok.type = "button";
    actions.append(cancel, ok);
    dialog.append(h, tarea, field, dep, actions);
    backdrop.appendChild(dialog);
    let done = false;
    const close = v => {
      if (done) return; done = true; backdrop.remove();
      if (prevFocus && typeof prevFocus.focus === "function" && document.contains(prevFocus)) prevFocus.focus();
      resolve(v);
    };
    cancel.addEventListener("click", () => close(null));
    ok.addEventListener("click", () => close({ motivo: area.value.trim(), depende: cb.checked }));
    backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) close(null); });
    backdrop.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); close(null); return; }
      if (e.key === "Tab") {
        const items = [area, cb, cancel, ok]; const i = items.indexOf(document.activeElement);
        e.preventDefault(); items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
      }
    });
    document.body.appendChild(backdrop);
    area.focus();
  });
}
async function _mover(id, destino, antesDe) {
  const r = _fila(id); if (!r) return;
  let extra = null;
  if (destino === "bloqueado" && (r.status || "pendiente") !== "bloqueado") {
    const res = await _segPedirBloqueo(r);
    if (!res) { renderSeguimiento(); return; }   // canceló: el <select> nativo ya había cambiado, se repinta
    extra = { motivo_bloqueo: res.motivo || null, depende_partner: res.depende };
  }
  const mismas = _filas().filter(x => x.partner === r.partner);
  const cambios = moverTarjeta(mismas, id, destino, antesDe);
  if (!cambios.length && !extra) return;
  // completed_at lo pone la BASE (trigger); acá solo se refleja al instante.
  const ahora = new Date().toISOString();
  cambios.forEach(c => { const f = _fila(c.id); if (f && (f.status === "hecho") !== (c.status === "hecho")) f.completed_at = c.status === "hecho" ? ahora : null; });
  const lista = cambios.map(c => ({ id: c.id, patch: { status: c.status, sort_order: c.sort_order, ...(extra && c.id === id ? extra : {}) } }));
  if (extra && !lista.some(c => c.id === id)) lista.push({ id, patch: { ...extra } });
  _actualizar(lista);
}
async function _checklist(id, fn) {
  const r = _fila(id); if (!r) return;
  const items = fn(checklistDe(r.checklist));
  await _patch(id, { checklist: items });
  document.getElementById("segChkNuevo")?.focus();
}

// ── Arrastrar y soltar (HTML5). Se instala una vez por host. ─────────────────
let _drag = null;
function _instalarDnD(host) {
  if (host._segDnD) return;
  host._segDnD = true;
  host.addEventListener("dragstart", ev => {
    const el = ev.target.closest && ev.target.closest("[data-card]");
    if (!el || !segPuedeEscribir()) return;
    _drag = el.dataset.card; el.classList.add("is-drag");
    if (ev.dataTransfer) ev.dataTransfer.setData("text/plain", _drag);
  });
  host.addEventListener("dragend", () => { _drag = null; host.querySelectorAll(".is-drag,.is-over").forEach(x => x.classList.remove("is-drag", "is-over")); });
  host.addEventListener("dragover", ev => {
    const z = ev.target.closest && ev.target.closest("[data-drop]");
    if (!z || !_drag) return;
    ev.preventDefault();
    host.querySelectorAll(".is-over").forEach(x => x !== z && x.classList.remove("is-over"));
    z.classList.add("is-over");
  });
  host.addEventListener("drop", ev => {
    const z = ev.target.closest && ev.target.closest("[data-drop]");
    if (!z || !_drag) return;
    ev.preventDefault();
    const sobre = ev.target.closest("[data-card]");
    const id = _drag; _drag = null;
    _mover(id, z.dataset.drop, sobre && sobre.dataset.card !== id ? sobre.dataset.card : null);
  });
}

// ── INTERACCIONES ────────────────────────────────────────────────────────────
export function segSetView(v) { SEG_STATE.view = v; SEG_STATE.abierta = null; SEG_STATE.alta = ""; SEG_STATE.resp = ""; renderSeguimiento(); }
export function segSetKam(k)  { SEG_STATE.kam = k; renderSeguimiento(); }
export function segSelectPartner(p) {
  segHidePartnerList();
  SEG_STATE.partner = p; SEG_STATE.search = ""; SEG_STATE.abierta = null; SEG_STATE.alta = ""; SEG_STATE.resp = "";
  if (SEG_STATE.view === "cartera") SEG_STATE.view = "tablero";
  renderSeguimiento();
}
async function _altaOk(lista) {
  const v = (document.getElementById("segAltaTxt")?.value || "").trim();
  if (!v) { SEG_STATE.alta = ""; renderSeguimiento(); return; }
  SEG_STATE.alta = lista;
  await _crear(lista, v);
}
async function _proyecto(id, v) {
  if (v === "__nuevo__") {
    const n = await _segPedirTexto({ title: t("seg.dlg.nuevoProyectoTit"), label: t("seg.promptProyecto"), placeholder: t("seg.ph.proyecto"), okLabel: t("seg.dlg.crear") });
    if (n === null || !n.trim()) { renderSeguimiento(); return; }
    v = n.trim();
  }
  _patch(id, { project: v || null });
}

// ── Buscador para abrir el tablero de otro partner ──────────────────────────
// Ofrece PRIMERO los partners que ya tienen tarjetas, después el resto.
export function _segPaintPartnerList(q) {
  const list = document.getElementById("segPartnerList");
  if (!list) return;
  const lower = (q || "").toLowerCase().trim();
  const con = new Set(_filas().map(r => r.partner));
  const match = p => !lower || p.toLowerCase().includes(lower);
  const a = [...con].filter(Boolean).sort().filter(match), b = _segPartners().filter(p => !con.has(p) && match(p));
  if (!a.length && !b.length) { list.innerHTML = `<div class="sg-opt sg-opt--empty">${escapeHTML(t("seg.sinCoincidencias"))}</div>`; return; }
  const opt = (p, has) => `<div class="sg-opt${p === SEG_STATE.partner ? " sg-opt--sel" : ""}" role="option" data-partner="${escapeHTML(p)}" data-act-mousedown="segSelectPartner">
      <span class="sg-opt__name">${escapeHTML(p)}</span>${has ? `<span class="sg-opt__tag">${escapeHTML(t("seg.conSegTag"))}</span>` : ""}</div>`;
  list.innerHTML = a.slice(0, 60).map(p => opt(p, true)).join("") + b.slice(0, 60).map(p => opt(p, false)).join("");
}
export function segFocusSearch() {
  const pop = document.getElementById("segBuscarPop"), i = document.getElementById("segSearch");
  if (!pop || !i) return;
  pop.hidden = false; _segPaintPartnerList(i.value); i.focus();
}
export function segFilterPartners(q) { SEG_STATE.search = q; _segPaintPartnerList(q); }
export function segHidePartnerList() { const p = document.getElementById("segBuscarPop"); if (p) p.hidden = true; }
// El blur corre ANTES del mousedown de la opción: el delay le da tiempo.
export function segHidePartnerListDelayed() { setTimeout(segHidePartnerList, 150); }
export function segSearchKeydown(e) {
  if (e.key === "Enter") {
    const f = document.querySelector("#segPartnerList .sg-opt[data-partner]");
    if (f) f.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    e.preventDefault();
  } else if (e.key === "Escape") { segHidePartnerList(); }
}

// Esc cierra la ventana de la tarjeta (una sola vez por sesión).
if (typeof document !== "undefined" && !window._segEsc) {
  window._segEsc = true;
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && SEG_STATE.abierta && STATE.curTab === "seguimiento" && !document.querySelector(".ui-dialog-backdrop")) { SEG_STATE.abierta = null; renderSeguimiento(); }
  });
}

// ── ACCIONES DELEGADAS ───────────────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";

registerActions({
  segSetView:        d => segSetView(d.view),
  segSetKam:         (d, el) => segSetKam(el.value),
  segSetResp:        (d, el) => { SEG_STATE.resp = el.value; renderSeguimiento(); },
  segSoloVencidas:   (d, el) => { SEG_STATE.soloVencidas = el.checked; renderSeguimiento(); },
  segSelectPartner:  d => segSelectPartner(d.partner),
  segFocusSearch,
  segFilterPartners: (d, el) => segFilterPartners(el.value),
  segHidePartnerListDelayed,
  segSearchKeydown:  (d, el, e) => segSearchKeydown(e),
  segAbrir:          d => { SEG_STATE.abierta = d.id; SEG_STATE.alta = ""; renderSeguimiento(); },
  segCerrar:         () => { SEG_STATE.abierta = null; renderSeguimiento(); },
  segFondo:          (d, el, e) => { if (e.target === el) { SEG_STATE.abierta = null; renderSeguimiento(); } },
  segAlta:           d => { SEG_STATE.alta = d.lista; renderSeguimiento(); },
  segAltaNo:         () => { SEG_STATE.alta = ""; renderSeguimiento(); },
  segAltaOk:         d => _altaOk(d.lista),
  segAltaKey:        (d, el, e) => { if (e.key === "Enter") { e.preventDefault(); _altaOk(d.lista); } else if (e.key === "Escape") { SEG_STATE.alta = ""; renderSeguimiento(); } },
  segFlag:           (d, el) => _patch(d.id, { [d.campo]: el.checked }),
  segCampo:          (d, el) => { const v = el.value.trim(); if (d.campo === "task" && !v) { renderSeguimiento(); return; } _patch(d.id, { [d.campo]: v || null }); },
  segEstado:         (d, el) => _mover(d.id, el.value, null),
  segSiguiente:      d => { const r = _fila(d.id); if (r) _mover(d.id, LISTAS_SEG[Math.min(LISTAS_SEG.indexOf(r.status || "pendiente") + 1, LISTAS_SEG.length - 1)], null); },
  segProyecto:       (d, el) => _proyecto(d.id, el.value),
  segCheck:          (d, el) => _checklist(d.id, l => l.map((x, i) => i === +d.i ? { ...x, ok: el.checked } : x)),
  segCheckDel:       d => _checklist(d.id, l => l.filter((_, i) => i !== +d.i)),
  segCheckAdd:       d => { const v = (document.getElementById("segChkNuevo")?.value || "").trim(); if (v) _checklist(d.id, l => [...l, { t: v, ok: false }]); },
  segCheckKey:       (d, el, e) => { if (e.key === "Enter") { const v = el.value.trim(); if (v) _checklist(d.id, l => [...l, { t: v, ok: false }]); } },
  segComAdd:         d => _comentar(d.id, (document.getElementById("segComNuevo")?.value || "").trim()),
  segComKey:         (d, el, e) => { if (e.key === "Enter") _comentar(d.id, el.value.trim()); },
  segBorrar:         d => _borrar(d.id)
});
