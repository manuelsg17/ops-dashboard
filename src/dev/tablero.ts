// dev/tablero.ts — Maquetas de Seguimiento "tipo Trello" (SOLO desarrollo): ?ui=tablero
//
// Pedido de Manuel (1-oct-2026): "mejorar el seguimiento de tareas de mis
// partners… similar a Trello". Decisiones ya tomadas: UN TABLERO POR PARTNER
// (+ una vista "Mi cartera" con las tarjetas de todos sus partners) y edición
// para admins Y KAMs (cambia RLS en producción: se confirma al implementar).
//
// Tres distribuciones del mismo tablero, con datos de muestra y todo
// interactivo en memoria (nada se guarda):
//   A · Clásico: listas en horizontal y la tarjeta se abre en un modal.
//   B · Con panel: la tarjeta se abre en un panel lateral, el tablero sigue a la vista.
//   C · Por proyecto: filas = proyectos, columnas = estados.
// Arrastrar y soltar (entre listas y para ordenar), alta rápida, checklist,
// comentarios, etiquetas de proyecto, responsable, fechas y vencidas.
//
// Vendor.ts la importa detrás de `import.meta.env.DEV`: no llega a producción.
//
// ELEGIDA (1-oct-2026): "A · Clásico". Implementada en src/seguimiento.ts; esta
// página queda como referencia de las tres propuestas.

import "./tablero.css";
import { registerActions } from "../shared/actions";
import { escapeHTML as e } from "../core/security";
import { iconSvg } from "../shared/icons";

type Prop = "a" | "b" | "c";
type Lista = "pendiente" | "en_curso" | "bloqueado" | "hecho";
interface Check { t: string; ok: boolean }
interface Coment { quien: string; cuando: string; txt: string }
interface Card { id: number; partner: string; lista: Lista; orden: number; titulo: string; proyecto: string; resp: string; ini: string; fin: string; desc: string; checks: Check[]; coments: Coment[] }

const HOY = "2026-10-01";
const LISTAS: { k: Lista; l: string; color: string }[] = [
  { k: "pendiente", l: "Por hacer", color: "var(--cat-other)" },
  { k: "en_curso", l: "En curso", color: "var(--color-info-solid)" },
  { k: "bloqueado", l: "Bloqueado", color: "var(--color-bad-solid)" },
  { k: "hecho", l: "Hecho", color: "var(--color-ok-solid)" }
];
const PROY_COLOR: Record<string, string> = {
  "Reactivación": "var(--cat-1)", "Captación con scouts": "var(--cat-2)", "Flota TukTuk": "var(--cat-4)",
  "Calidad de servicio": "var(--cat-7)", "Leads Yango": "var(--cat-3)", "": "var(--cat-other)"
};
const PARTNERS = ["ANDINA MOVILIDAD", "RUTA SUR", "NUEVO AMANECER", "COSTA VERDE"];

let _id = 0;
const c = (partner: string, lista: Lista, titulo: string, proyecto: string, resp: string, ini: string, fin: string, desc = "", checks: [string, boolean][] = [], coments: [string, string, string][] = []): Card =>
  ({ id: ++_id, partner, lista, orden: _id, titulo, proyecto, resp, ini, fin, desc, checks: checks.map(([t, ok]) => ({ t, ok })), coments: coments.map(([quien, cuando, txt]) => ({ quien, cuando, txt })) });

const CARDS: Card[] = [
  c("ANDINA MOVILIDAD", "pendiente", "Campaña de reactivación a conductores inactivos de 30-60 días", "Reactivación", "Ana", "2026-10-02", "2026-10-15", "Meta: recuperar 300 conductores en octubre. Usar la base de inactivos del panel del partner.", [["Pedir base de inactivos", true], ["Armar mensaje con bono", false], ["Enviar por WhatsApp", false]], [["Ana", "28 sep", "El partner confirma que tiene presupuesto para bono de S/20."]]),
  c("ANDINA MOVILIDAD", "pendiente", "Revisar tarifas de la flota TukTuk en Lima Sur", "Flota TukTuk", "Luis (partner)", "", "2026-10-08"),
  c("ANDINA MOVILIDAD", "en_curso", "Contratar 2 scouts para Arequipa", "Captación con scouts", "Ana", "2026-09-20", "2026-09-30", "Perfil: experiencia en captación de conductores, zona Cayma y Cerro Colorado.", [["Publicar aviso", true], ["Entrevistas", true], ["Firmar contratos", false]], [["Luis (partner)", "29 sep", "Tenemos 3 candidatos finales."], ["Ana", "30 sep", "Perfecto, agendemos el jueves."]]),
  c("ANDINA MOVILIDAD", "en_curso", "Activar leads de Yango en el panel del partner", "Leads Yango", "Ana", "2026-09-25", "2026-10-10", "", [["Habilitar permiso en el panel", true], ["Capacitar al equipo del partner", false]]),
  c("ANDINA MOVILIDAD", "bloqueado", "Integración de pagos diarios a conductores", "Calidad de servicio", "Equipo Yango", "2026-09-10", "2026-09-26", "Esperando respuesta del área de pagos sobre el banco del partner.", [], [["Ana", "26 sep", "Escalé con pagos, sin fecha todavía."]]),
  c("ANDINA MOVILIDAD", "hecho", "Capacitación de calidad: cancelaciones", "Calidad de servicio", "Ana", "2026-09-01", "2026-09-12", "", [["Material", true], ["Sesión", true]]),
  c("ANDINA MOVILIDAD", "hecho", "Bono de bienvenida para nuevos conductores", "Captación con scouts", "Luis (partner)", "2026-08-25", "2026-09-05"),
  c("RUTA SUR", "pendiente", "Plan de captación para Trujillo", "Captación con scouts", "Dario", "", "2026-10-20"),
  c("RUTA SUR", "en_curso", "Reactivar conductores TukTuk", "Reactivación", "Dario", "2026-09-22", "2026-09-29", "", [["Lista de inactivos", true], ["Llamadas", false]]),
  c("RUTA SUR", "bloqueado", "Firma de adenda de comisión", "", "Gerencia del partner", "2026-09-15", "2026-09-30"),
  c("NUEVO AMANECER", "en_curso", "Mejorar aceptación de viajes (meta 85%)", "Calidad de servicio", "Ana", "2026-09-28", "2026-10-25", "", [["Reporte por conductor", false]]),
  c("NUEVO AMANECER", "hecho", "Alta de 15 autos nuevos", "", "Ana", "2026-09-01", "2026-09-20")
];

const ST = {
  prop: "a" as Prop, vista: "partner" as "partner" | "cartera", partner: "ANDINA MOVILIDAD",
  abierta: 0, soloVencidas: false, resp: "", alta: "" as "" | Lista, drag: 0
};

// ── Utilidades ───────────────────────────────────────────────────────────────
const ico = (n: string, s = 14) => iconSvg(n as any, { size: s });
const vencida = (k: Card) => !!k.fin && k.fin < HOY && k.lista !== "hecho";
const pronto = (k: Card) => !!k.fin && !vencida(k) && k.lista !== "hecho" && k.fin <= "2026-10-08";
const fCorta = (d: string) => { if (!d) return ""; const [, m, dd] = d.split("-"); return `${+dd} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][+m - 1]}`; };
const ini = (n: string) => n.replace(/\(.*\)/, "").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const avatar = (n: string) => n ? `<span class="tb-av" title="${e(n)}">${e(ini(n))}</span>` : "";
const delPartner = () => CARDS.filter(k => k.partner === ST.partner);
const filtradas = (arr: Card[]) => arr.filter(k => (!ST.soloVencidas || vencida(k)) && (!ST.resp || k.resp === ST.resp));
const enLista = (arr: Card[], l: Lista) => arr.filter(k => k.lista === l).sort((a, b) => a.orden - b.orden);

function etiqueta(p: string): string {
  return p ? `<span class="tb-lbl" style="background:${PROY_COLOR[p] || "var(--cat-other)"}">${e(p)}</span>` : "";
}
function tarjeta(k: Card, conPartner = false): string {
  const hechos = k.checks.filter(x => x.ok).length;
  const fecha = k.fin ? `<span class="tb-badge${k.lista === "hecho" ? " tb-badge--ok" : vencida(k) ? " tb-badge--bad" : pronto(k) ? " tb-badge--warn" : ""}">${ico("clock", 12)}${fCorta(k.fin)}</span>` : "";
  const chk = k.checks.length ? `<span class="tb-badge${hechos === k.checks.length ? " tb-badge--ok" : ""}">${ico("check-circle", 12)}${hechos}/${k.checks.length}</span>` : "";
  const com = k.coments.length ? `<span class="tb-badge">${ico("file-text", 12)}${k.coments.length}</span>` : "";
  const desc = k.desc ? `<span class="tb-badge" title="Tiene descripción">${ico("menu", 12)}</span>` : "";
  return `<article class="tb-card${ST.abierta === k.id ? " is-open" : ""}" draggable="true" data-card="${k.id}" data-act="tbAbrir" data-id="${k.id}" tabindex="0">
    ${conPartner ? `<div class="tb-card__partner">${e(k.partner)}</div>` : ""}
    ${k.proyecto ? `<div class="tb-card__lbls">${etiqueta(k.proyecto)}</div>` : ""}
    <div class="tb-card__t">${e(k.titulo)}</div>
    <div class="tb-card__foot"><span class="tb-card__badges">${fecha}${chk}${com}${desc}</span>${avatar(k.resp)}</div>
  </article>`;
}
function altaRapida(l: Lista): string {
  if (ST.alta === l) return `<div class="tb-alta"><textarea id="tbAltaTxt" rows="2" placeholder="Título de la tarjeta…" data-act-keydown="tbAltaKey" data-lista="${l}"></textarea>
    <div class="tb-alta__row"><button class="ui-btn ui-btn--primary ui-btn--sm" data-act="tbAltaOk" data-lista="${l}">Añadir tarjeta</button><button class="tb-x" data-act="tbAltaNo" aria-label="Cancelar">${ico("x", 16)}</button></div></div>`;
  return `<button class="tb-add" data-act="tbAlta" data-lista="${l}">${ico("plus", 14)}Añadir tarjeta</button>`;
}
function lista(l: typeof LISTAS[number], cards: Card[], conPartner = false, conAlta = true): string {
  return `<section class="tb-list" data-lista="${l.k}">
    <header class="tb-list__h"><span class="tb-dot" style="background:${l.color}"></span><strong>${l.l}</strong><span class="tb-list__n">${cards.length}</span></header>
    <div class="tb-list__body" data-drop="${l.k}">${cards.map(k => tarjeta(k, conPartner)).join("") || `<div class="tb-list__vacia">Suelta aquí una tarjeta</div>`}</div>
    ${conAlta ? altaRapida(l.k) : ""}
  </section>`;
}

// ── Detalle de la tarjeta (modal en A y C, panel en B) ───────────────────────
function detalle(k: Card): string {
  const hechos = k.checks.filter(x => x.ok).length, pct = k.checks.length ? Math.round(hechos / k.checks.length * 100) : 0;
  const sel = (act: string, val: string, ops: [string, string][]) => `<select class="tb-in" data-act-change="${act}" data-id="${k.id}">${ops.map(([v, l]) => `<option value="${e(v)}"${v === val ? " selected" : ""}>${e(l)}</option>`).join("")}</select>`;
  return `<div class="tb-det">
    <header class="tb-det__h">
      <span class="tb-det__ico">${ico("list-check", 18)}</span>
      <div class="tb-det__tit"><input class="tb-det__title" value="${e(k.titulo)}" data-act-change="tbTitulo" data-id="${k.id}" aria-label="Título">
        <div class="tb-det__sub">en la lista <b>${LISTAS.find(l => l.k === k.lista)!.l}</b> · ${e(k.partner)}</div></div>
      <button class="tb-x" data-act="tbCerrar" aria-label="Cerrar">${ico("x", 18)}</button>
    </header>
    <div class="tb-det__grid">
      <div class="tb-det__main">
        <div class="tb-det__chips">
          ${k.proyecto ? `<div><span class="tb-det__lbl">Proyecto</span>${etiqueta(k.proyecto)}</div>` : ""}
          ${k.resp ? `<div><span class="tb-det__lbl">Responsable</span><span class="tb-det__resp">${avatar(k.resp)}${e(k.resp)}</span></div>` : ""}
          ${k.fin ? `<div><span class="tb-det__lbl">Vence</span><span class="tb-badge${vencida(k) ? " tb-badge--bad" : k.lista === "hecho" ? " tb-badge--ok" : ""}">${ico("clock", 12)}${fCorta(k.fin)}${vencida(k) ? " · vencida" : ""}</span></div>` : ""}
        </div>
        <h4 class="tb-det__sec">${ico("menu", 15)}Descripción</h4>
        <textarea class="tb-in tb-in--area" rows="3" placeholder="Añade el detalle o el resultado esperado…" data-act-change="tbDesc" data-id="${k.id}">${e(k.desc)}</textarea>
        <h4 class="tb-det__sec">${ico("check-circle", 15)}Checklist ${k.checks.length ? `<span class="tb-det__pct">${pct}%</span>` : ""}</h4>
        ${k.checks.length ? `<div class="tb-prog"><span style="width:${pct}%"></span></div>` : ""}
        <ul class="tb-chk">${k.checks.map((x, i) => `<li><label><input type="checkbox"${x.ok ? " checked" : ""} data-act-change="tbCheck" data-id="${k.id}" data-i="${i}"><span class="${x.ok ? "is-ok" : ""}">${e(x.t)}</span></label></li>`).join("")}</ul>
        <div class="tb-inline"><input class="tb-in" id="tbChkNuevo" placeholder="Añadir un elemento…" data-act-keydown="tbChkKey" data-id="${k.id}"><button class="ui-btn ui-btn--secondary ui-btn--sm" data-act="tbChkAdd" data-id="${k.id}">Añadir</button></div>
        <h4 class="tb-det__sec">${ico("file-text", 15)}Comentarios y actividad</h4>
        <div class="tb-inline"><span class="tb-av">AN</span><input class="tb-in" id="tbComNuevo" placeholder="Escribe un comentario…" data-act-keydown="tbComKey" data-id="${k.id}"><button class="ui-btn ui-btn--secondary ui-btn--sm" data-act="tbComAdd" data-id="${k.id}">Enviar</button></div>
        <ul class="tb-com">${k.coments.slice().reverse().map(x => `<li>${avatar(x.quien)}<div><div class="tb-com__h"><b>${e(x.quien)}</b><span>${e(x.cuando)}</span></div><div class="tb-com__t">${e(x.txt)}</div></div></li>`).join("")}</ul>
      </div>
      <aside class="tb-det__side">
        <span class="tb-det__lbl">Estado</span>${sel("tbLista", k.lista, LISTAS.map(l => [l.k, l.l]))}
        <span class="tb-det__lbl">Proyecto</span>${sel("tbProy", k.proyecto, Object.keys(PROY_COLOR).map(p => [p, p || "Sin proyecto"]))}
        <span class="tb-det__lbl">Responsable</span><input class="tb-in" value="${e(k.resp)}" data-act-change="tbResp" data-id="${k.id}">
        <span class="tb-det__lbl">Inicio</span><input class="tb-in" type="date" value="${k.ini}" data-act-change="tbIni" data-id="${k.id}">
        <span class="tb-det__lbl">Vence</span><input class="tb-in" type="date" value="${k.fin}" data-act-change="tbFin" data-id="${k.id}">
        <hr>
        <button class="tb-side-btn" data-act="tbMover" data-id="${k.id}">${ico("arrow-right", 14)}Pasar a la siguiente lista</button>
        <button class="tb-side-btn tb-side-btn--bad" data-act="tbBorrar" data-id="${k.id}">${ico("trash", 14)}Eliminar tarjeta</button>
      </aside>
    </div>
  </div>`;
}

// ── Cabecera de la pestaña ───────────────────────────────────────────────────
function cabecera(): string {
  const resp = [...new Set((ST.vista === "partner" ? delPartner() : CARDS).map(k => k.resp).filter(Boolean))];
  const pills = PARTNERS.map(p => {
    const arr = CARDS.filter(k => k.partner === p), v = arr.filter(vencida).length;
    return `<button class="tb-pill${ST.vista === "partner" && ST.partner === p ? " is-on" : ""}" data-act="tbPartner" data-p="${e(p)}">${e(p)} <span class="tb-pill__n">${arr.filter(k => k.lista !== "hecho").length}</span>${v ? `<span class="tb-pill__bad" title="${v} vencida(s)">${v}</span>` : ""}</button>`;
  }).join("");
  const arr = ST.vista === "partner" ? delPartner() : CARDS;
  const abiertas = arr.filter(k => k.lista !== "hecho").length, venc = arr.filter(vencida).length, bloq = arr.filter(k => k.lista === "bloqueado").length, sem = arr.filter(pronto).length;
  return `<div class="tb-head ui-card">
    <div class="tb-head__row">
      <div class="tb-seg"><button class="${ST.vista === "partner" ? "is-on" : ""}" data-act="tbVista" data-v="partner">${ico("presentation", 14)}Tablero del partner</button><button class="${ST.vista === "cartera" ? "is-on" : ""}" data-act="tbVista" data-v="cartera">${ico("users", 14)}Mi cartera</button></div>
      <div class="tb-kpis">
        <span><b>${abiertas}</b> abiertas</span><span class="${venc ? "is-bad" : ""}"><b>${venc}</b> vencidas</span><span class="${bloq ? "is-bad" : ""}"><b>${bloq}</b> bloqueadas</span><span><b>${sem}</b> vencen esta semana</span>
      </div>
    </div>
    <div class="tb-head__row">
      <div class="tb-pills">${pills}<button class="tb-pill tb-pill--add" data-act="tbToast">${ico("plus", 13)}Partner</button></div>
      <div class="tb-filtros">
        <label class="tb-chk-f"><input type="checkbox"${ST.soloVencidas ? " checked" : ""} data-act-change="tbSoloVenc">Solo vencidas</label>
        <select class="tb-in tb-in--sm" data-act-change="tbFResp"><option value="">Todos los responsables</option>${resp.map(r => `<option${r === ST.resp ? " selected" : ""}>${e(r)}</option>`).join("")}</select>
      </div>
    </div>
  </div>`;
}

// ── Cuerpos según la propuesta ───────────────────────────────────────────────
function tableroListas(cards: Card[], conPartner: boolean, conAlta: boolean): string {
  return `<div class="tb-board" id="tbBoard">${LISTAS.map(l => lista(l, enLista(cards, l.k), conPartner, conAlta)).join("")}
    ${conAlta ? `<button class="tb-newlist" data-act="tbToast">${ico("plus", 14)}Añadir otra lista</button>` : ""}</div>`;
}
function tableroProyectos(cards: Card[]): string {
  const proys = [...new Set(cards.map(k => k.proyecto))].sort((a, b) => (a === "") as any - ((b === "") as any) || a.localeCompare(b));
  const cab = `<div class="tb-sw__cab"><span></span>${LISTAS.map(l => `<div class="tb-sw__col"><span class="tb-dot" style="background:${l.color}"></span>${l.l}</div>`).join("")}</div>`;
  const filas = proys.map(p => {
    const de = cards.filter(k => k.proyecto === p), hechos = de.filter(k => k.lista === "hecho").length;
    return `<div class="tb-sw__fila">
      <div class="tb-sw__proy"><span class="tb-lbl" style="background:${PROY_COLOR[p] || "var(--cat-other)"}">${e(p || "Sin proyecto")}</span>
        <span class="tb-sw__avance">${hechos}/${de.length} hechas</span><div class="tb-prog"><span style="width:${de.length ? hechos / de.length * 100 : 0}%"></span></div></div>
      ${LISTAS.map(l => `<div class="tb-sw__celda" data-drop="${l.k}" data-proy="${e(p)}">${enLista(de, l.k).map(k => tarjeta(k)).join("")}</div>`).join("")}
    </div>`;
  }).join("");
  return `<div class="tb-sw">${cab}${filas}<button class="tb-add tb-add--sw" data-act="tbAlta" data-lista="pendiente">${ico("plus", 14)}Añadir tarjeta en "Por hacer"</button>${ST.alta ? altaRapida("pendiente") : ""}</div>`;
}

const PROPS: { k: Prop; t: string; d: string }[] = [
  { k: "a", t: "A · Clásico", d: "Como Trello: listas en horizontal, arrastras las tarjetas entre ellas y cada tarjeta se abre en una ventana con checklist, comentarios, fechas y responsable." },
  { k: "b", t: "B · Con panel lateral", d: "El mismo tablero, pero la tarjeta se abre en un panel a la derecha: sigues viendo el tablero mientras editas y puedes saltar de una tarjeta a otra con un clic." },
  { k: "c", t: "C · Por proyecto", d: "Filas = proyectos del partner (con su avance), columnas = estados. Sirve para partners con varios frentes abiertos a la vez." }
];

function page(): string {
  const prop = PROPS.find(x => x.k === ST.prop)!;
  const base = ST.vista === "partner" ? filtradas(delPartner()) : filtradas(CARDS);
  const card = ST.abierta ? CARDS.find(k => k.id === ST.abierta) : null;
  let cuerpo: string;
  if (ST.vista === "cartera") cuerpo = tableroListas(base, true, false);
  else if (ST.prop === "c") cuerpo = tableroProyectos(base);
  else cuerpo = tableroListas(base, false, true);
  const panel = ST.prop === "b" && card;
  return `<div class="tbp-bar">
      <strong>Seguimiento tipo Trello · propuestas</strong>
      <div class="tbp-seg">${PROPS.map(x => `<button class="${ST.prop === x.k ? "is-on" : ""}" data-act="tbProp" data-v="${x.k}">${x.t}</button>`).join("")}</div>
    </div>
    <p class="tbp-desc">${e(prop.d)} <span class="tbp-hint">Prueba: arrastra tarjetas, ábrelas, marca el checklist, comenta, cambia de partner o pasa a "Mi cartera". Nada se guarda.</span></p>
    <div class="tb-app${panel ? " tb-app--panel" : ""}">
      <div class="tb-main">
        <div class="tb-pagehead"><div><h2>Seguimiento</h2><p>${ST.vista === "partner" ? `Tablero de <b>${e(ST.partner)}</b> · KAM Ana` : "Todas las tarjetas de tus partners · KAM Ana"}</p></div></div>
        ${cabecera()}
        ${cuerpo}
      </div>
      ${panel ? `<aside class="tb-panel">${detalle(card!)}</aside>` : ""}
    </div>
    ${card && ST.prop !== "b" ? `<div class="tb-modal" data-act="tbFondo"><div class="tb-modal__box" role="dialog" aria-modal="true">${detalle(card)}</div></div>` : ""}
    <div class="tb-toast" id="tbToast" hidden></div>`;
}

function render(): void {
  const root = document.getElementById("tbRoot");
  if (!root) return;
  const sx = document.getElementById("tbBoard")?.scrollLeft ?? 0, sy = root.scrollTop;
  root.innerHTML = page();
  const b = document.getElementById("tbBoard"); if (b) b.scrollLeft = sx;
  root.scrollTop = sy;
  if (ST.alta) (document.getElementById("tbAltaTxt") as HTMLTextAreaElement | null)?.focus();
}
function toast(msg: string): void {
  const t = document.getElementById("tbToast"); if (!t) return;
  t.textContent = msg; t.hidden = false; setTimeout(() => { t.hidden = true; }, 2400);
}
const byId = (d: DOMStringMap) => CARDS.find(k => k.id === Number(d.id))!;
function altaOk(l: Lista): void {
  const v = (document.getElementById("tbAltaTxt") as HTMLTextAreaElement | null)?.value.trim();
  if (v) CARDS.push({ id: ++_id, partner: ST.vista === "partner" ? ST.partner : PARTNERS[0], lista: l, orden: 1e6 + _id, titulo: v, proyecto: "", resp: "Ana", ini: "", fin: "", desc: "", checks: [], coments: [] });
  ST.alta = v ? l : ""; render();
}

// ── Arrastrar y soltar (HTML5) ───────────────────────────────────────────────
function instalarDnD(root: HTMLElement): void {
  root.addEventListener("dragstart", ev => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-card]");
    if (!el) return;
    ST.drag = Number(el.dataset.card); el.classList.add("is-drag");
    ev.dataTransfer?.setData("text/plain", String(ST.drag));
  });
  root.addEventListener("dragend", () => { ST.drag = 0; root.querySelectorAll(".is-drag,.is-over").forEach(x => x.classList.remove("is-drag", "is-over")); });
  root.addEventListener("dragover", ev => {
    const zona = (ev.target as HTMLElement).closest<HTMLElement>("[data-drop]");
    if (!zona || !ST.drag) return;
    ev.preventDefault();
    root.querySelectorAll(".is-over").forEach(x => x !== zona && x.classList.remove("is-over"));
    zona.classList.add("is-over");
  });
  root.addEventListener("drop", ev => {
    const zona = (ev.target as HTMLElement).closest<HTMLElement>("[data-drop]");
    const k = CARDS.find(x => x.id === ST.drag);
    if (!zona || !k) return;
    ev.preventDefault();
    k.lista = zona.dataset.drop as Lista;
    if (zona.dataset.proy !== undefined) k.proyecto = zona.dataset.proy;
    // Orden: delante de la tarjeta sobre la que se soltó, o al final.
    const sobre = (ev.target as HTMLElement).closest<HTMLElement>("[data-card]");
    const otra = sobre && CARDS.find(x => x.id === Number(sobre.dataset.card));
    k.orden = otra && otra !== k ? otra.orden - 0.5 : 1e6 + _id++;
    ST.drag = 0; render();
  });
}

export function mountTablero(): void {
  const q = new URLSearchParams(location.search);
  if (q.get("prop")) ST.prop = q.get("prop") as Prop;
  const root = document.createElement("div");
  root.id = "tbRoot"; root.className = "tbp-root";
  document.body.appendChild(root);
  registerActions({
    tbProp: (d: DOMStringMap) => { ST.prop = d.v as Prop; ST.abierta = 0; render(); },
    tbVista: (d: DOMStringMap) => { ST.vista = d.v as any; ST.abierta = 0; ST.resp = ""; render(); },
    tbPartner: (d: DOMStringMap) => { ST.partner = d.p!; ST.vista = "partner"; ST.abierta = 0; ST.resp = ""; render(); },
    tbAbrir: (d: DOMStringMap) => { ST.abierta = Number(d.id); render(); },
    tbCerrar: () => { ST.abierta = 0; render(); },
    tbFondo: (_d: DOMStringMap, _el: HTMLElement, ev: Event) => { if ((ev.target as HTMLElement).classList.contains("tb-modal")) { ST.abierta = 0; render(); } },
    tbAlta: (d: DOMStringMap) => { ST.alta = d.lista as Lista; render(); },
    tbAltaNo: () => { ST.alta = ""; render(); },
    tbAltaOk: (d: DOMStringMap) => altaOk(d.lista as Lista),
    tbAltaKey: (d: DOMStringMap, _el: HTMLElement, ev: KeyboardEvent) => { if (ev.key === "Enter") { ev.preventDefault(); altaOk(d.lista as Lista); } if (ev.key === "Escape") { ST.alta = ""; render(); } },
    tbTitulo: (d: DOMStringMap, el: HTMLInputElement) => { byId(d).titulo = el.value; render(); },
    tbDesc: (d: DOMStringMap, el: HTMLTextAreaElement) => { byId(d).desc = el.value; render(); },
    tbLista: (d: DOMStringMap, el: HTMLSelectElement) => { byId(d).lista = el.value as Lista; render(); },
    tbProy: (d: DOMStringMap, el: HTMLSelectElement) => { byId(d).proyecto = el.value; render(); },
    tbResp: (d: DOMStringMap, el: HTMLInputElement) => { byId(d).resp = el.value; render(); },
    tbIni: (d: DOMStringMap, el: HTMLInputElement) => { byId(d).ini = el.value; render(); },
    tbFin: (d: DOMStringMap, el: HTMLInputElement) => { byId(d).fin = el.value; render(); },
    tbCheck: (d: DOMStringMap, el: HTMLInputElement) => { byId(d).checks[Number(d.i)].ok = el.checked; render(); },
    tbChkAdd: (d: DOMStringMap) => { const v = (document.getElementById("tbChkNuevo") as HTMLInputElement).value.trim(); if (v) { byId(d).checks.push({ t: v, ok: false }); render(); (document.getElementById("tbChkNuevo") as HTMLInputElement)?.focus(); } },
    tbChkKey: (d: DOMStringMap, _el: HTMLElement, ev: KeyboardEvent) => { if (ev.key === "Enter") { const v = (ev.target as HTMLInputElement).value.trim(); if (v) { byId(d).checks.push({ t: v, ok: false }); render(); (document.getElementById("tbChkNuevo") as HTMLInputElement)?.focus(); } } },
    tbComAdd: (d: DOMStringMap) => { const v = (document.getElementById("tbComNuevo") as HTMLInputElement).value.trim(); if (v) { byId(d).coments.push({ quien: "Ana", cuando: "ahora", txt: v }); render(); } },
    tbComKey: (d: DOMStringMap, _el: HTMLElement, ev: KeyboardEvent) => { if (ev.key === "Enter") { const v = (ev.target as HTMLInputElement).value.trim(); if (v) { byId(d).coments.push({ quien: "Ana", cuando: "ahora", txt: v }); render(); } } },
    tbMover: (d: DOMStringMap) => { const k = byId(d), i = LISTAS.findIndex(l => l.k === k.lista); k.lista = LISTAS[Math.min(i + 1, LISTAS.length - 1)].k; render(); },
    tbBorrar: (d: DOMStringMap) => { const i = CARDS.findIndex(k => k.id === Number(d.id)); CARDS.splice(i, 1); ST.abierta = 0; render(); toast("Tarjeta eliminada (en el real pide confirmación)."); },
    tbSoloVenc: (_d: DOMStringMap, el: HTMLInputElement) => { ST.soloVencidas = el.checked; render(); },
    tbFResp: (_d: DOMStringMap, el: HTMLSelectElement) => { ST.resp = el.value; render(); },
    tbToast: () => toast("En la maqueta esto no hace nada real.")
  } as any);
  instalarDnD(root);
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && ST.abierta) { ST.abierta = 0; render(); } });
  render();
}
