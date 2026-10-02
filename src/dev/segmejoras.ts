// dev/segmejoras.ts — Maqueta de las 3 mejoras de Seguimiento (SOLO dev): ?ui=segmejoras
//
// Pedido de Manuel (2-oct-2026): implementar las 3 primeras del backlog y ver
// primero el flujo. Todo en memoria, nada se guarda; usa el CSS REAL de la
// pestaña (sgt-*) y de la hoja del deck (sgk-*), así lo que se ve es lo que saldría.
//   1. "Depende del partner" (casilla) → reemplaza la heurística sobre `owner`.
//   2. Motivo del bloqueo → se pide al bloquear y sale en la hoja.
//   3. "Visible para el partner" → las internas no salen en la presentación.
// Vendor.ts la importa detrás de `import.meta.env.DEV`: no llega a producción.

import "./segmejoras.css";
import { registerActions } from "../shared/actions";
import { escapeHTML as e } from "../core/security";
import { iconSvg } from "../shared/icons";

type L = "pendiente" | "en_curso" | "bloqueado" | "hecho";
interface C { id: number; l: L; t: string; proy: string; col: string; resp: string; fin: string; res: string; dep: boolean; motivo: string; vis: boolean; chk?: [number, number]; cierre?: string }
const LBL: Record<L, string> = { pendiente: "Por hacer", en_curso: "En curso", bloqueado: "Bloqueado", hecho: "Hecho" };
const COL: Record<L, string> = { pendiente: "#6b7280", en_curso: "#0284c7", bloqueado: "#dc2626", hecho: "#16a34a" };
const ICO: Record<L, string> = { pendiente: "•", en_curso: "→", bloqueado: "!", hecho: "✓" };
const ORDEN_DECK: L[] = ["hecho", "bloqueado", "en_curso", "pendiente"];
const TIT: Record<L, [string, string]> = { hecho: ["Logrados", "cerrados desde el 1 sep"], bloqueado: ["Bloqueados", "necesitan una acción"], en_curso: ["En proceso", "avanzando"], pendiente: ["Próximos pasos", "por fecha"] };

const cards: C[] = [
  { id: 1, l: "hecho", t: "Activar campaña de scouts en SJL", proy: "Captación Q3", col: "var(--cat-1)", resp: "Ana", fin: "12 sep", res: "+120 conductores nuevos", dep: false, motivo: "", vis: true, cierre: "12 sep" },
  { id: 2, l: "hecho", t: "Revisión interna de tarifas con Pricing", proy: "Interno", col: "var(--cat-4)", resp: "Ana", fin: "18 sep", res: "", dep: false, motivo: "", vis: false, cierre: "18 sep" },
  { id: 3, l: "bloqueado", t: "Conseguir proveedor de vinilos en Trujillo", proy: "Brandeo", col: "var(--cat-2)", resp: "Partner", fin: "20 sep", res: "Proveedor contratado", dep: true, motivo: "Esperando cotización del proveedor local", vis: true, chk: [0, 2] },
  { id: 4, l: "bloqueado", t: "Aprobación legal del bono de reactivación", proy: "Reactivación", col: "var(--cat-3)", resp: "Ana", fin: "28 sep", res: "Bono S/20 aprobado", dep: false, motivo: "Pendiente de Legal Yango (sin fecha)", vis: true },
  { id: 5, l: "en_curso", t: "Onboarding presencial semanal", proy: "Captación Q3", col: "var(--cat-1)", resp: "Partner", fin: "15 oct", res: "Activación a 1 viaje > 40%", dep: true, motivo: "", vis: true, chk: [2, 4] },
  { id: 6, l: "en_curso", t: "Negociar comisión con la gerencia de Yango", proy: "Interno", col: "var(--cat-4)", resp: "Ana", fin: "10 oct", res: "", dep: false, motivo: "", vis: false },
  { id: 7, l: "pendiente", t: "Llamar a conductores inactivos 30+ días", proy: "Reactivación", col: "var(--cat-3)", resp: "Ana", fin: "15 oct", res: "+60 reactivados", dep: false, motivo: "", vis: true }
];
const ST = { tab: "tablero" as "tablero" | "flujo" | "deck", abierta: 0, dialogo: 0, pendMov: null as null | { id: number; a: L }, vistaPartner: true };
const byId = (id: number | string) => cards.find(c => c.id === +id)!;
const root = () => document.getElementById("smRoot")!;

function chipsInternos(c: C): string {
  return `${c.dep ? `<span class="sgm-chip sgm-chip--dep" title="Depende del partner">${iconSvg("users", { size: 12 })}Partner</span>` : ""}${!c.vis ? `<span class="sgm-chip sgm-chip--int" title="Interna: no sale en la presentación">${iconSvg("lock", { size: 12 })}Interna</span>` : ""}`;
}
function tarjeta(c: C): string {
  return `<article class="sgt-card${ST.abierta === c.id ? " is-open" : ""}" data-act="smAbrir" data-id="${c.id}" tabindex="0">
    <div class="sgt-card__lbls"><span class="sgt-lbl" style="background:${c.col}">${e(c.proy)}</span></div>
    <div class="sgt-card__t">${e(c.t)}</div>
    ${c.l === "bloqueado" && c.motivo ? `<div class="sgm-motivo">${iconSvg("alert-circle", { size: 12 })}<span>${e(c.motivo)}</span></div>` : ""}
    ${c.l === "bloqueado" && !c.motivo ? `<div class="sgm-motivo sgm-motivo--vacio">${iconSvg("alert-circle", { size: 12 })}<span>Sin motivo</span></div>` : ""}
    <div class="sgt-card__foot"><span class="sgt-card__badges"><span class="sgt-badge">${iconSvg("clock", { size: 12 })}${e(c.fin)}</span>${chipsInternos(c)}</span><span class="sgt-av">${e(c.resp[0])}</span></div>
  </article>`;
}
function tablero(): string {
  const listas = (["pendiente", "en_curso", "bloqueado", "hecho"] as L[]).map(l => {
    const cs = cards.filter(c => c.l === l);
    return `<section class="sgt-list"><header class="sgt-list__h"><span class="sg-dot" style="background:${COL[l]}"></span><strong>${LBL[l]}</strong><span class="sgt-list__n">${cs.length}</span></header>
      <div class="sgt-list__body">${cs.map(tarjeta).join("")}</div></section>`;
  }).join("");
  const internas = cards.filter(c => !c.vis).length;
  return `<p class="sgm-nota">Tablero de ANDINA MOVILIDAD. Las tarjetas ahora pueden llevar dos marcas pequeñas (<b>Partner</b> e <b>Interna</b>) y las bloqueadas muestran su motivo. <b>${internas} tarjetas internas</b> no saldrán en la presentación. Haz clic en una tarjeta.</p>
    <div class="sgt-board">${listas}</div>`;
}

function interruptor(act: string, id: number, on: boolean, titulo: string, ayuda: string): string {
  return `<label class="sgm-sw"><input type="checkbox"${on ? " checked" : ""} data-act-change="${act}" data-id="${id}"><span class="sgm-sw__t"><b>${titulo}</b><small>${ayuda}</small></span></label>`;
}
function modal(c: C): string {
  const bloq = c.l === "bloqueado";
  return `<div class="sgt-modal" data-act="smFondo"><div class="sgt-modal__box"><div class="sgt-det">
    <header class="sgt-det__h"><span class="sgt-det__ico">${iconSvg("list-check", { size: 18 })}</span>
      <div class="sgt-det__tit"><input class="sgt-det__title" value="${e(c.t)}" readonly><div class="sgt-det__sub">en la lista ${LBL[c.l]} · ANDINA MOVILIDAD</div></div>
      <button type="button" class="sgt-x" data-act="smCerrar">${iconSvg("x", { size: 18 })}</button></header>
    <div class="sgt-det__grid"><div class="sgt-det__main">
      <div class="sgt-det__chips"><div><span class="sgt-det__lbl">Proyecto</span><span class="sgt-lbl" style="background:${c.col}">${e(c.proy)}</span></div><div><span class="sgt-det__lbl">Responsable</span><span class="sgt-det__resp"><span class="sgt-av">${e(c.resp[0])}</span>${e(c.resp)}</span></div></div>
      ${bloq ? `<h4 class="sgt-det__sec">${iconSvg("alert-circle", { size: 15 })}Motivo del bloqueo</h4>
        <textarea class="sgt-in sgt-in--area sgm-area--bloq" rows="2" placeholder="¿Qué lo tiene detenido? Ej.: esperando cotización del proveedor" data-act-change="smMotivo" data-id="${c.id}">${e(c.motivo)}</textarea>
        <div class="sgm-ayuda">Sale en la hoja del partner, en la tarjeta bloqueada.</div>` : ""}
      <h4 class="sgt-det__sec">${iconSvg("menu", { size: 15 })}Descripción</h4>
      <textarea class="sgt-in sgt-in--area" rows="2" readonly>${e(c.res)}</textarea>
      <h4 class="sgt-det__sec">${iconSvg("check-circle", { size: 15 })}Checklist y comentarios</h4>
      <div class="sgm-ayuda">(sin cambios: igual que hoy)</div>
    </div>
    <aside class="sgt-det__side">
      <span class="sgt-det__lbl">Estado</span>
      <select class="sgt-in" data-act-change="smEstado" data-id="${c.id}">${(["pendiente", "en_curso", "bloqueado", "hecho"] as L[]).map(l => `<option value="${l}"${l === c.l ? " selected" : ""}>${LBL[l]}</option>`).join("")}</select>
      <div class="sgm-bloque"><span class="sgt-det__lbl">Presentación al partner</span>
        ${interruptor("smDep", c.id, c.dep, "Depende del partner", "Si está bloqueada, la hoja dirá “Necesitamos de ti”.")}
        ${interruptor("smVis", c.id, c.vis, "Visible para el partner", c.vis ? "Aparece en la hoja Plan de trabajo." : "Interna: NO aparece en la hoja ni en sus conteos.")}
      </div>
    </aside></div></div></div></div>`;
}

function dialogoBloqueo(): string {
  const p = ST.pendMov!, c = byId(p.id);
  return `<div class="sgt-modal sgm-modal-sm"><div class="sgt-modal__box sgm-dlg"><div class="sgt-det">
    <h3 class="sgm-dlg__h">${iconSvg("alert-circle", { size: 18 })}Pasar a Bloqueado</h3>
    <p class="sgm-dlg__t"><b>${e(c.t)}</b></p>
    <span class="sgt-det__lbl">¿Por qué se bloquea? <i>(opcional)</i></span>
    <textarea id="smMotivoNuevo" class="sgt-in sgt-in--area" rows="2" placeholder="Ej.: esperando cotización del proveedor"></textarea>
    <label class="sgm-chk"><input type="checkbox" id="smDepNuevo"${c.dep ? " checked" : ""}> Depende del partner (la hoja dirá “Necesitamos de ti”)</label>
    <div class="sgm-dlg__f"><button type="button" class="ui-btn ui-btn--ghost" data-act="smBloqCancel">Cancelar</button><button type="button" class="ui-btn ui-btn--ghost" data-act="smBloqOmitir">Bloquear sin motivo</button><button type="button" class="ui-btn ui-btn--primary" data-act="smBloqOk">Bloquear</button></div>
  </div></div></div>`;
}

function flujo(): string {
  const paso = (n: number, t: string, d: string) => `<li><span class="sgm-n">${n}</span><div><b>${t}</b><p>${d}</p></div></li>`;
  return `<div class="sgm-flujo">
    <h3>Flujo propuesto</h3>
    <ol class="sgm-pasos">
      ${paso(1, "El KAM arrastra una tarjeta a Bloqueado (o cambia el estado en la ventana)", "En vez de moverse en silencio, aparece un cuadro corto. No es obligatorio: “Bloquear sin motivo” la mueve igual y la tarjeta queda con la marca “Sin motivo” para que se complete luego.")}
      ${paso(2, "Escribe el motivo y marca si depende del partner", "Una línea y una casilla. Si la tarjeta ya tenía la casilla marcada, viene precargada.")}
      ${paso(3, "Se ve en el tablero y en la hoja del partner", "La tarjeta bloqueada muestra el motivo (1 línea). En la presentación, el motivo y el aviso “Necesitamos de ti” (solo si depende del partner).")}
      ${paso(4, "Al sacarla de Bloqueado", "El motivo se conserva guardado pero deja de mostrarse; si vuelve a bloquearse, el cuadro lo trae precargado.")}
    </ol>
    <button type="button" class="ui-btn ui-btn--primary" data-act="smProbarBloqueo">Probarlo: bloquear “Llamar a conductores inactivos”</button>
    <h3>Dónde se cuida el solapamiento con lo que ya existe</h3>
    <ul class="sgm-lista">
      <li><b>“Necesitamos de ti” hoy:</b> sale de adivinar por el nombre del responsable (¿dice “partner”?). Pasa a depender SOLO de la casilla. Hoy hay 0 tarjetas en producción, así que no hay nada que migrar.</li>
      <li><b>Responsable ≠ “depende del partner”:</b> el responsable puede ser Ana y aun así depender del partner (ej.: espera su documento). Por eso son campos separados.</li>
      <li><b>Comentarios internos:</b> siguen sin salir en el PDF. El motivo del bloqueo es un campo aparte, pensado para que lo lea el partner.</li>
      <li><b>Cronograma (Gantt) y Mi cartera:</b> son vistas del KAM; siguen mostrando TODAS las tarjetas, incluidas las internas.</li>
      <li><b>Presentación:</b> el % del plan, los conteos y las páginas de la hoja se calculan solo con las visibles. Si un partner solo tiene tarjetas internas, la hoja no se genera (igual que hoy sin tarjetas).</li>
      <li><b>Permisos / RLS:</b> nada cambia: son 3 columnas nuevas de la misma tabla, con los mismos permisos. El partner sigue sin poder leer Seguimiento (eso es la mejora 9, aparte).</li>
    </ul></div>`;
}

function hojaDeck(): string {
  const vis = ST.vistaPartner ? cards.filter(c => c.vis) : cards;
  const hechas = vis.filter(c => c.l === "hecho").length, pct = vis.length ? Math.round(hechas / vis.length * 100) : 0;
  const col = (l: L) => {
    const cs = vis.filter(c => c.l === l);
    return `<section class="sgk-col"><header class="sgk-h" style="background:${COL[l]}"><span class="sgk-ico">${ICO[l]}</span><span class="sgk-h__t"><b>${TIT[l][0]}</b><span>${TIT[l][1]}</span></span><span class="sgk-cnt">${cs.length}</span></header>
      <div class="sgk-body">${cs.map((c, j) => `<div class="sgk-card" style="border-left-color:${COL[l]}${!c.vis ? ";outline:2px dashed #9ca3af" : ""}">
        <div class="sgk-top"><span class="sgk-proy"><span class="sgk-sq" style="background:${c.col}"></span>${e(c.proy)}</span>${l === "pendiente" ? `<span class="sgk-n">${j + 1}</span>` : ""}${!c.vis ? `<span class="sgm-int">INTERNA</span>` : ""}</div>
        <div class="sgk-t">${e(c.t)}</div>
        ${c.res ? `<div class="sgk-res">🎯 ${e(c.res)}</div>` : ""}
        ${l === "bloqueado" && c.motivo ? `<div class="sgm-dk-motivo">🚧 ${e(c.motivo)}</div>` : ""}
        ${l === "en_curso" && c.chk ? `<div class="sgk-chk"><div class="sgk-bar"><span style="width:${c.chk[0] / c.chk[1] * 100}%"></span></div><span>${c.chk[0]}/${c.chk[1]} pasos</span></div>` : ""}
        <div class="sgk-meta"><span>${l === "hecho" ? "Cerrado el " + (c.cierre || c.fin) : "Para el " + c.fin}</span><span>${e(c.resp)}</span></div>
        ${l === "bloqueado" && c.dep ? `<div class="sgk-nec">Necesitamos de ti para destrabarlo</div>` : ""}
      </div>`).join("") || `<div class="sgk-vacio">${l === "bloqueado" ? "Nada bloqueado" : "—"}</div>`}</div></section>`;
  };
  const ocultas = cards.filter(c => !c.vis).length;
  return `<div class="sgm-barra"><div class="sgm-seg"><button class="${ST.vistaPartner ? "is-on" : ""}" data-act="smVista" data-v="1">Lo que ve el partner</button><button class="${!ST.vistaPartner ? "is-on" : ""}" data-act="smVista" data-v="0">Lo que ve el KAM (con las internas)</button></div>
    <span class="sgm-nota" style="margin:0">${ST.vistaPartner ? `${ocultas} tarjetas internas quedan fuera, y también de los conteos y del % del plan.` : "Las internas se ven punteadas solo para comparar; en el PDF no existen."}</span></div>
    <div class="sgm-slide"><div class="agy-style-365">
      <div class="sgm-dk-head"><div><span class="sgm-dk-badge">🚕 TAXI</span><div class="sgm-dk-partner">ANDINA MOVILIDAD</div></div><div class="sgm-dk-ttl">PLAN DE TRABAJO · septiembre 2026</div></div>
      <div class="sgk-sum"><div class="sgk-av"><b>${pct}%</b> del plan completado <span class="sgk-av__sub">${hechas}/${vis.length}</span><div class="sgk-bar sgk-bar--av"><span style="width:${pct}%"></span></div></div>
        ${ORDEN_DECK.map(l => `<div class="sgk-mini"><b style="color:${COL[l]}">${vis.filter(c => c.l === l).length}</b>${TIT[l][0].toLowerCase()}</div>`).join("")}</div>
      <div class="sgk">${ORDEN_DECK.map(col).join("")}</div></div></div>`;
}

function render(): void {
  const r = root(), sx = r.scrollTop;
  const tabs: [string, string][] = [["tablero", "1 · Tablero y tarjeta"], ["flujo", "2 · Flujo al bloquear"], ["deck", "3 · Hoja del partner"]];
  r.innerHTML = `<div class="sgm-bar"><div class="sgm-seg">${tabs.map(([k, n]) => `<button class="${ST.tab === k ? "is-on" : ""}" data-act="smTab" data-v="${k}">${n}</button>`).join("")}</div></div>
    ${ST.tab === "tablero" ? tablero() : ST.tab === "flujo" ? flujo() : hojaDeck()}
    ${ST.abierta ? modal(byId(ST.abierta)) : ""}${ST.pendMov ? dialogoBloqueo() : ""}`;
  r.scrollTop = sx;
}
function mover(id: number, a: L): void {
  const c = byId(id);
  if (a === "bloqueado" && c.l !== "bloqueado") { ST.pendMov = { id, a }; render(); return; }
  c.l = a; if (a === "hecho") c.cierre = "2 oct"; render();
}
export function mountSegMejoras(): void {
  const root0 = document.createElement("div"); root0.id = "smRoot"; root0.className = "sgm-root"; document.body.appendChild(root0);
  registerActions({
    smTab: (d: DOMStringMap) => { ST.tab = d.v as any; ST.abierta = 0; render(); },
    smAbrir: (d: DOMStringMap) => { ST.abierta = +d.id!; render(); },
    smCerrar: () => { ST.abierta = 0; render(); },
    smFondo: (_d: DOMStringMap, _el: HTMLElement, ev: Event) => { if ((ev.target as HTMLElement).classList.contains("sgt-modal")) { ST.abierta = 0; render(); } },
    smEstado: (d: DOMStringMap, el: HTMLSelectElement) => mover(+d.id!, el.value as L),
    smMotivo: (d: DOMStringMap, el: HTMLTextAreaElement) => { byId(d.id!).motivo = el.value; render(); },
    smDep: (d: DOMStringMap, el: HTMLInputElement) => { byId(d.id!).dep = el.checked; render(); },
    smVis: (d: DOMStringMap, el: HTMLInputElement) => { byId(d.id!).vis = el.checked; render(); },
    smVista: (d: DOMStringMap) => { ST.vistaPartner = d.v === "1"; render(); },
    smProbarBloqueo: () => { ST.tab = "tablero"; mover(7, "bloqueado"); },
    smBloqCancel: () => { ST.pendMov = null; render(); },
    smBloqOmitir: () => { const p = ST.pendMov!; ST.pendMov = null; byId(p.id).l = p.a; render(); },
    smBloqOk: () => { const p = ST.pendMov!, c = byId(p.id); c.motivo = (document.getElementById("smMotivoNuevo") as HTMLTextAreaElement).value.trim(); c.dep = (document.getElementById("smDepNuevo") as HTMLInputElement).checked; c.l = p.a; ST.pendMov = null; render(); }
  });
  render();
}
