// dev/proto/proto.ts — Prototipo navegable de alta fidelidad (SOLO desarrollo).
//
// Se abre con `npm run dev` + `?ui=proto` (vendor.ts lo importa detrás de
// `import.meta.env.DEV`, así que NO llega al build de producción). Monta una
// capa fija por encima de todo, sin sesión, con la estructura REAL de la app
// (shell.ts/index.html), el sistema de diseño (tokens, componentes, ui.ts,
// icons.ts), gráficos reales de ApexCharts (charts.buildLineChart) y datos
// estáticos con forma real (fixture.ts, sacado del seed sintético local).
//
// Sirve para comparar 4 versiones × 4 páginas antes de implementar:
//   Elegida (la actual, más suave · suave.css) · A Lienzo abierto · B Suave ·
//   C Mesa de trabajo. Nada se escribe: ni en la base ni en localStorage.
//
// Parámetros de URL (para compartir un estado): v=elegida|a|b|c,
// p=rend|metas|calc|config, theme=light|dark, sec=<sección de Configuración>,
// paso=0..4 (asistente de la Calculadora B), shot=1 (oculta el selector).

import "./proto.css";
import "./suave.css";
import "./calc2.css";
import "./perf.css";
import { registerActions } from "../../shared/actions";
import { confirmDialog, alertDialog } from "../../shared/confirmDialog";
import { destroyAllCharts, ensureApex } from "../../charts";
import { PS, resetFiltros, type Version, type Pagina, type SeccionCfg, type CalcV, type K3, type PerfV } from "./state";
import { topbar, nav, filtros, encabezado, selector, PAGE_DE_NAV } from "./chrome";
import { renderRend, chartsRend } from "./pRend";
import { renderMetas, chartsMetas } from "./pMetas";
import { refrescarCalc, dist } from "./pCalc";
import { renderCalc2, totalesCalc2 } from "./pCalc2";
import { renderPerf, chartsPerf } from "./pPerf";
import { renderConfig } from "./pConfig";
import { SEMANAS, PARTNERS, partnersDeKam, mesDeSemana, filtrosPorDefecto, unidadesCalc } from "./model";

const ROOT = "protoRoot";
let _prevTheme: string | null = null;
let _prevRail = false;
let _toastT: any = null;
let _shot = false;

function contenido(): string {
  switch (PS.page) {
    case "rend": return renderRend();
    case "metas": return renderMetas();
    case "perf": return renderPerf();
    case "calc": return renderCalc2();   // segunda vuelta (29-sep); la anterior sigue en pCalc.ts
    case "config": return renderConfig();
  }
}

// Foco y scroll sobreviven al repintado (se repinta todo en cada acción).
function _claveFoco(el: Element | null): string | null {
  if (!el || !(el instanceof HTMLElement) || !el.closest("#" + ROOT)) return null;
  if (el.id) return "#" + el.id;
  const a = el.getAttribute("data-act-input") || el.getAttribute("data-act-change");
  if (!a) return null;
  const k = el.getAttribute("data-k"), key = el.getAttribute("data-key");
  return `[data-act-input="${a}"]${k ? `[data-k="${k}"]` : ""}${key ? `[data-key="${CSS.escape(key)}"]` : ""},[data-act-change="${a}"]${k ? `[data-k="${k}"]` : ""}${key ? `[data-key="${CSS.escape(key)}"]` : ""}`;
}

export function render(): void {
  const root = document.getElementById(ROOT);
  if (!root) return;
  const main = root.querySelector(".pr-main") as HTMLElement | null;
  const scroll = { root: root.scrollTop, plist: (root.querySelector(".plist") as HTMLElement | null)?.scrollTop ?? 0,
    list: (root.querySelector(".pr-c-list__body") as HTMLElement | null)?.scrollTop ?? 0, main: main?.scrollTop ?? 0 };
  const foco = _claveFoco(document.activeElement);
  const sel = foco && (document.activeElement as HTMLInputElement).selectionStart;
  destroyAllCharts();
  document.body.classList.toggle("nav-rail", PS.rail);
  document.documentElement.setAttribute("data-theme", PS.theme);
  const conPanel = PS.page === "rend" || PS.page === "metas" || PS.page === "perf";
  root.className = `pr-root pr-v-${PS.v} pr-p-${PS.page}${_shot ? " pr-shot" : ""}`;
  root.innerHTML = topbar() +
    `<div class="layout">${nav()}${conPanel ? filtros() : ""}` +
    `<main class="main pr-main" id="prMain" tabindex="-1"><div class="shell-content">${encabezado()}<div class="pr-page">${contenido()}</div></div></main></div>` +
    selector() + `<div class="pr-toast" id="prToast" role="status" aria-live="polite" hidden></div>`;
  root.scrollTop = scroll.root;
  const pl = root.querySelector(".plist") as HTMLElement | null; if (pl) pl.scrollTop = scroll.plist;
  const cl = root.querySelector(".pr-c-list__body") as HTMLElement | null; if (cl) cl.scrollTop = scroll.list;
  if (foco) {
    const el = root.querySelector(foco) as HTMLInputElement | null;
    if (el) { el.focus(); try { if (sel != null) el.setSelectionRange(sel, sel); } catch (_) { /* select */ } }
  }
  _url();
  // Gráficas: después de pintar (ApexCharts mide el contenedor).
  ensureApex().then(() => setTimeout(() => {
    if (PS.page === "rend") chartsRend();
    if (PS.page === "metas") chartsMetas();
    if (PS.page === "perf") chartsPerf();
  }, 0));
}

function _url(): void {
  const u = new URL(location.href);
  u.searchParams.set("ui", "proto");
  u.searchParams.set("v", PS.v); u.searchParams.set("p", PS.page); u.searchParams.set("theme", PS.theme);
  if (PS.page === "config") u.searchParams.set("sec", PS.cfg.sec); else u.searchParams.delete("sec");
  if (PS.page === "calc") u.searchParams.set("cv", PS.c2.v); else u.searchParams.delete("cv");
  if (PS.page === "perf") u.searchParams.set("pv", PS.perf.v); else u.searchParams.delete("pv");
  history.replaceState(null, "", u.toString());
}

export function toast(msg: string): void {
  const el = document.getElementById("prToast");
  if (!el) return;
  el.textContent = msg || "En el prototipo esta acción no hace nada real.";
  el.hidden = false;
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { el.hidden = true; }, 2600);
}

const _dec = (s: string) => { const n = parseFloat(String(s || "").replace(",", ".").replace(/[^\d.]/g, "")); return Number.isFinite(n) ? n : null; };
const _num = (s: string) => { const n = parseInt(String(s || "").replace(/[^\d]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const _calcHayCambios = () => Object.keys(PS.calc.fijos).length > 0;

function _quitarChip(k: string): void {
  const D = filtrosPorDefecto();
  if (k === "escala") PS.F.escala = "semanal";
  if (k === "rango") { PS.F.desde = D.desde; PS.F.hasta = D.hasta; }
  if (k === "ciudad") PS.F.ciudad = "all";
  if (k === "kam") { PS.F.kam = "all"; PS.F.sel = new Set(PARTNERS); }
  if (k === "linea") { if (PS.page === "metas") PS.metasLine = "comb"; else PS.rendLine = "comb"; }
  if (k === "partners") PS.F.sel = new Set(PS.F.kam === "all" ? PARTNERS : partnersDeKam(PS.F.kam));
}

registerActions({
  // Estructura
  prNav: (d: DOMStringMap) => {
    const p = PAGE_DE_NAV[d.tab || ""];
    if (!p) { toast("Seguimiento, Presentación y Data Raw no están en este prototipo: siguen como hoy."); return; }
    PS.page = p; PS.menu = ""; render();
    (document.getElementById(ROOT) as HTMLElement).scrollTop = 0;
  },
  prPage: (d: DOMStringMap) => { PS.page = d.value as Pagina; PS.menu = ""; render(); (document.getElementById(ROOT) as HTMLElement).scrollTop = 0; },
  prVer: (d: DOMStringMap) => { PS.v = d.value as Version; render(); },
  prTheme: (d: DOMStringMap) => { PS.theme = d.value === "dark" ? "dark" : "light"; PS.menu = ""; render(); },
  prRail: () => { PS.rail = !PS.rail; render(); setTimeout(() => window.dispatchEvent(new Event("resize")), 220); },
  prFiltros: () => { PS.filtros = !PS.filtros; render(); setTimeout(() => window.dispatchEvent(new Event("resize")), 60); },
  prSwitch: () => { PS.switchAbierto = !PS.switchAbierto; render(); },
  prCerrar: () => cerrarProto(),
  prToast: (d: DOMStringMap) => toast(d.msg || ""),
  prToastIn: (d: DOMStringMap) => toast(d.msg || ""),
  prMenu: (d: DOMStringMap) => { PS.menu = PS.menu === d.value ? "" : (d.value as any); render(); },
  prLang: (_d: DOMStringMap, el: HTMLSelectElement) => { el.value = "es"; toast("El prototipo está solo en español; la app sigue en ES / EN / RU."); },
  prIrCfg: (d: DOMStringMap) => { PS.page = "config"; PS.cfg.sec = (d.value || "partners") as SeccionCfg; PS.menu = ""; render(); },
  // Filtros
  prEscala: (d: DOMStringMap) => {
    PS.F.escala = d.value as any; render();
    if (d.value !== "semanal") toast("En el prototipo los datos son semanales: la escala solo cambia los rótulos y el aviso.");
  },
  prDesde: (_d: DOMStringMap, el: HTMLSelectElement) => { PS.F.desde = el.value; if (PS.F.hasta < PS.F.desde) PS.F.hasta = PS.F.desde; render(); },
  prHasta: (_d: DOMStringMap, el: HTMLSelectElement) => { PS.F.hasta = el.value; if (PS.F.desde > PS.F.hasta) PS.F.desde = PS.F.hasta; render(); },
  prPreset: (d: DOMStringMap) => {
    const ult = SEMANAS[SEMANAS.length - 1];
    PS.F.hasta = ult;
    PS.F.desde = d.value === "week" ? ult : d.value === "fortnight" ? SEMANAS[SEMANAS.length - 2] : SEMANAS.find(w => mesDeSemana(w) === mesDeSemana(ult)) || ult;
    render();
  },
  prCiudad: (_d: DOMStringMap, el: HTMLSelectElement) => { PS.F.ciudad = el.value; render(); },
  prKam: (_d: DOMStringMap, el: HTMLSelectElement) => { PS.F.kam = el.value; PS.F.sel = new Set(el.value === "all" ? PARTNERS : partnersDeKam(el.value)); render(); },
  prBuscar: (_d: DOMStringMap, el: HTMLInputElement) => { PS.F.buscar = el.value; render(); },
  prPart: (d: DOMStringMap, el: HTMLInputElement) => { if (el.checked) PS.F.sel.add(d.p || ""); else PS.F.sel.delete(d.p || ""); render(); },
  prTodos: () => { PS.F.sel = new Set(PS.F.kam === "all" ? PARTNERS : partnersDeKam(PS.F.kam)); render(); },
  prNinguno: () => { PS.F.sel = new Set(); render(); },
  prQuitarChip: (d: DOMStringMap) => { _quitarChip(d.k || ""); render(); },
  prReset: () => { resetFiltros(); render(); },
  // Rendimiento
  prRendLine: (d: DOMStringMap) => { PS.rendLine = d.value as any; render(); },
  prCiudadModo: (d: DOMStringMap) => { PS.ciudadModo = d.value as any; render(); },
  prSort: (d: DOMStringMap) => {
    const c = d.col || "ad";
    if (PS.sort.col === c) PS.sort.dir = PS.sort.dir === "asc" ? "desc" : "asc";
    else { PS.sort.col = c; PS.sort.dir = c === "partner" || c === "kam" ? "asc" : "desc"; }
    render();
  },
  prRSel: (d: DOMStringMap) => { PS.rSel = d.p || null; render(); },
  // Metas
  prMetasLine: (d: DOMStringMap) => { PS.metasLine = d.value as any; render(); },
  prMetasMes: (_d: DOMStringMap, el: HTMLSelectElement) => { PS.metasMes = el.value; render(); },
  prMetasFiltro: (d: DOMStringMap) => { PS.metasFiltro = d.value as any; render(); },
  prMetasSort: (d: DOMStringMap) => {
    const c = d.col || "peor";
    if (PS.metasSort.col === c) PS.metasSort.dir = PS.metasSort.dir === "asc" ? "desc" : "asc";
    else { PS.metasSort.col = c; PS.metasSort.dir = ["partner", "city", "kam", "peor"].includes(c) || c.endsWith("_pct") ? "asc" : "desc"; }
    render();
  },
  prMetasVista: (d: DOMStringMap) => { PS.metasVista = d.value as any; render(); },
  prMSel: (d: DOMStringMap) => { PS.mSel = d.p || null; render(); },
  prPdf: () => toast("Generaría el PDF de Metas (siempre en claro, con marca de agua)."),
  prBorrarMetas: async () => {
    PS.menu = ""; render();
    const ok = await confirmDialog({ title: "Eliminar metas de Septiembre 2026", danger: true, requireText: "SEPTIEMBRE", confirmLabel: "Eliminar 61 filas",
      body: "Se eliminarán 61 filas de metas (6 KAMs, 3 ciudades).\nEsta acción no se puede deshacer." });
    toast(ok ? "Prototipo: no se borró nada." : "Cancelado.");
  },
  // Calculadora
  prCalcGoal: (d: DOMStringMap, el: HTMLInputElement) => {
    const k = d.k as "ad" | "sh" | "nr";
    PS.calc.goals[k] = _num(el.value);
    if (!refrescarCalc()) render();
  },
  prCalcAtajo: (d: DOMStringMap) => {
    const k = d.k as "ad" | "sh" | "nr", f = parseFloat(d.f || "1");
    const base = dist().base[k];
    PS.calc.goals[k] = Math.round(base * f);
    render();
  },
  prCalcCell: (d: DOMStringMap, el: HTMLInputElement) => {
    const key = d.key || "", k = d.k as "ad" | "sh" | "nr";
    const v = _num(el.value);
    const f = PS.calc.fijos[key] || {};
    if (v == null) delete f[k]; else f[k] = v;
    if (Object.keys(f).length) PS.calc.fijos[key] = f; else delete PS.calc.fijos[key];
    render();
  },
  prCalcSoltar: (d: DOMStringMap) => { delete PS.calc.fijos[d.key || ""]; render(); },
  prCalcKam: async (_d: DOMStringMap, el: HTMLSelectElement) => {
    const nuevo = el.value, antes = PS.calc.kam;
    if (_calcHayCambios()) {
      const ok = await confirmDialog({ title: `¿Cambiar a ${nuevo}?`, confirmLabel: `Empezar con ${nuevo}`,
        body: `Tienes celdas fijadas a mano para ${antes} sin guardar. Si cambias de KAM se descartan y empiezas de cero con la cartera de ${nuevo}.` });
      if (!ok) { el.value = antes; return; }
    }
    PS.calc.kam = nuevo; PS.calc.fijos = {}; PS.calc.sel = null; render();
  },
  prCalcKamBtn: (d: DOMStringMap) => { PS.calc.kam = d.value || PS.calc.kam; PS.calc.fijos = {}; PS.calc.paso = 1; render(); },
  prCalcTk: (d: DOMStringMap, el: HTMLInputElement) => { PS.calc.tkPct[d.k as "ad"] = el.value.trim(); render(); },
  prCalcModo: (d: DOMStringMap) => { PS.calc.modo = d.value as any; },
  prCalcVista: (d: DOMStringMap) => { PS.calc.vista = d.value as any; render(); },
  prCalcRef: (_d: DOMStringMap, el: HTMLElement) => { const det = el.closest("details"); PS.calc.refAbierta = !(det && det.open); },
  prCalcAdv: (_d: DOMStringMap, el: HTMLElement) => { const det = el.closest("details"); PS.calc.avanzados = !(det && det.open); },
  prCalcPaso: (d: DOMStringMap) => { PS.calc.paso = Math.max(0, Math.min(4, +(d.value || 0))); render(); },
  prCalcSel: (d: DOMStringMap) => { PS.calc.sel = d.key || null; render(); },
  prCalcGuardar: async () => {
    const n = unidadesCalc(PS.calc.kam).length;
    const modo = PS.calc.modo === "full" ? "Reparto completo" : "Solo lo que cambié";
    const ok = await confirmDialog({ title: `Guardar metas de ${PS.calc.kam} · Septiembre 2026`, confirmLabel: "Guardar",
      body: `Se escribirán ${n} filas (${modo}): conductores activos, horas y N+R por partner-ciudad.\nReemplaza las metas de ese mes; no se acumulan.` });
    if (ok) await alertDialog({ title: "Prototipo", body: "No se guardó nada: esto es una maqueta con datos fijos." });
  },
  // Desempeño (pPerf.ts)
  pfVer: (d: DOMStringMap) => { PS.perf.v = d.value as PerfV; render(); },
  pfLine: (d: DOMStringMap) => { PS.perf.line = d.value as any; render(); },
  pfMes: (_d: DOMStringMap, el: HTMLSelectElement) => { PS.metasMes = el.value; render(); },
  pfFiltro: (d: DOMStringMap) => { PS.perf.filtro = d.value as any; render(); },
  pfSort: (d: DOMStringMap) => { PS.perf.sort = d.value as any; render(); },
  pfTab: (d: DOMStringMap) => { PS.perf.tab = d.value as any; render(); },
  // Calculadora · segunda vuelta (pCalc2.ts)
  c2Ver: (d: DOMStringMap) => { PS.c2.v = d.value as CalcV; render(); },
  c2Kam: async (_d: DOMStringMap, el: HTMLSelectElement) => {
    const nuevo = el.value, antes = PS.c2.kam;
    if (Object.keys(PS.c2.fijos).length) {
      const ok = await confirmDialog({ title: `¿Cambiar a ${nuevo}?`, confirmLabel: `Empezar con ${nuevo}`,
        body: `Tienes celdas fijadas a mano para ${antes} sin guardar. Si cambias de KAM se descartan.` });
      if (!ok) { el.value = antes; return; }
    }
    PS.c2.kam = nuevo; PS.c2.fijos = {}; PS.c2.fleet = {}; render();
  },
  c2Total: (d: DOMStringMap, el: HTMLInputElement) => { PS.c2.total[d.k as K3] = _num(el.value); render(); },
  c2Atajo: (d: DOMStringMap) => {
    const k = d.k as K3, D = totalesCalc2();
    PS.c2.total[k] = Math.round((D.baseTot.taxi[k] + D.baseTot.tk[k]) * parseFloat(d.f || "1")); render();
  },
  c2Tk: (d: DOMStringMap, el: HTMLInputElement) => {
    const k = d.k as K3;
    if (PS.c2.tkModo === "pct") PS.c2.tkPct[k] = _dec(el.value); else PS.c2.tkAbs[k] = _num(el.value);
    render();
  },
  c2TkModo: (d: DOMStringMap) => {
    const D = totalesCalc2();
    const modo = d.value === "abs" ? "abs" : "pct";
    // Al cambiar de modo se conserva el valor equivalente, no se pierde lo cargado.
    (["ad", "sh", "nr"] as K3[]).forEach(k => {
      const g = D.tkSugerido[k] ? null : D.goal.tk[k], T = PS.c2.total[k];
      if (modo === "abs") PS.c2.tkAbs[k] = g;
      else PS.c2.tkPct[k] = g != null && T ? Math.round(g / T * 1000) / 10 : null;
    });
    PS.c2.tkModo = modo; render();
  },
  c2Tab: (d: DOMStringMap) => { PS.c2.tab = d.value as any; render(); },
  c2Kpi: (d: DOMStringMap) => { if (d.value === "fleet") PS.c2.tab = "fleet"; else { PS.c2.kpi = d.value as K3; PS.c2.tab = "taxi"; } render(); },
  c2Cell: (d: DOMStringMap, el: HTMLInputElement) => {
    const key = `${d.key}|${d.ln}|${d.k}`, v = _num(el.value);
    if (v == null) delete PS.c2.fijos[key]; else PS.c2.fijos[key] = v;
    render();
  },
  c2Soltar: (d: DOMStringMap) => { Object.keys(PS.c2.fijos).filter(x => x.startsWith(d.key + "|")).forEach(x => delete PS.c2.fijos[x]); render(); },
  c2Fleet: (d: DOMStringMap, el: HTMLInputElement) => { PS.c2.fleet[`${d.key}|${d.m}`] = _dec(el.value); render(); },
  c2Guardar: async () => {
    const D = totalesCalc2();
    const sug = (["ad", "sh", "nr"] as K3[]).some(k => D.tkSugerido[k]);
    const ok = await confirmDialog({ title: `Guardar metas de ${PS.c2.kam} · Septiembre 2026`, confirmLabel: "Guardar",
      body: `Se escribirán ${D.us.length} filas. Por partner: meta total = Taxi + TukTuk, y la parte TukTuk aparte.` +
        (sug ? `\n\nTukTuk no está declarado: se guardará el sugerido según el peso real de agosto.` : "") });
    if (ok) await alertDialog({ title: "Prototipo", body: "No se guardó nada: esto es una maqueta con datos fijos." });
  },
  // Configuración
  prCfgSec: (d: DOMStringMap) => { PS.cfg.sec = d.value as SeccionCfg; PS.cfg.panel = null; render(); },
  prCfgPanel: (d: DOMStringMap) => { PS.cfg.panel = d.clid ? (PS.cfg.panel === d.clid && PS.v !== "c" ? null : d.clid) : null; if (PS.cfg.sec !== "partners") PS.cfg.sec = "partners"; render(); },
  prCfgBuscar: (_d: DOMStringMap, el: HTMLInputElement) => { PS.cfg.buscar = el.value; render(); },
  prCfgKam: (_d: DOMStringMap, el: HTMLSelectElement) => { PS.cfg.kam = el.value; render(); },
  prCfgEstado: (d: DOMStringMap) => { PS.cfg.estado = d.value as any; render(); },
  prCfgUsuario: (d: DOMStringMap) => { PS.cfg.usuario = +(d.value || 0); render(); },
  prCfgGuardar: () => { toast("Prototipo: cambios «guardados» solo en pantalla."); PS.cfg.panel = null; render(); },
  prCfgBorrar: async (d: DOMStringMap) => {
    const ok = await confirmDialog({ title: `Eliminar el CLID ${d.clid}`, danger: true, confirmLabel: "Eliminar",
      body: "Se quita de Partners. Sus datos de rendimiento quedan, pero se verán bajo «Sin KAM» con el número de CLID." });
    toast(ok ? "Prototipo: no se eliminó nada." : "Cancelado.");
  }
});

function _fueraDeMenus(ev: Event): void {
  if (!PS.menu) return;
  const t = ev.target as Element | null;
  if (t && t.closest && t.closest(".upload-dropdown, .user-menu-wrap, .mt-menu-wrap")) return;
  PS.menu = ""; render();
}
function _escape(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && PS.menu && !document.querySelector(".ui-dialog-backdrop")) { PS.menu = ""; render(); }
}

export function cerrarProto(): void {
  destroyAllCharts();
  document.getElementById(ROOT)?.remove();
  document.body.classList.remove("pr-on");
  document.body.classList.toggle("nav-rail", _prevRail);
  if (_prevTheme) document.documentElement.setAttribute("data-theme", _prevTheme);
  document.removeEventListener("click", _fueraDeMenus, true);
  document.removeEventListener("keydown", _escape);
  document.body.style.overflow = "";
  const u = new URL(location.href);
  ["ui", "v", "p", "theme", "sec", "paso", "shot", "cv", "pv"].forEach(k => u.searchParams.delete(k));
  history.replaceState(null, "", u.toString());
}

export function mountProto(): void {
  if (document.getElementById(ROOT)) return;
  const q = new URLSearchParams(location.search);
  const v = q.get("v"); if (v === "a" || v === "b" || v === "c" || v === "elegida") PS.v = v;
  const p = q.get("p"); if (p === "rend" || p === "metas" || p === "perf" || p === "calc" || p === "config") PS.page = p;
  const pv = q.get("pv"); if (pv === "d1" || pv === "d2" || pv === "d3") PS.perf.v = pv;
  PS.theme = q.get("theme") === "dark" ? "dark" : "light";
  const sec = q.get("sec"); if (sec) PS.cfg.sec = sec as SeccionCfg;
  const paso = q.get("paso"); if (paso != null) PS.calc.paso = +paso;
  const cv = q.get("cv"); if (cv === "p1" || cv === "p2" || cv === "p3") PS.c2.v = cv;
  _shot = q.get("shot") === "1";
  // Mismo criterio que la app: barra de iconos en 1024–1279 px y filtros flotantes (cerrados) ≤ 1024.
  PS.rail = window.innerWidth < 1280;
  PS.filtros = window.innerWidth > 1024;
  _prevTheme = document.documentElement.getAttribute("data-theme");
  _prevRail = document.body.classList.contains("nav-rail");
  const root = document.createElement("div");
  root.id = ROOT;
  document.body.appendChild(root);
  document.body.classList.add("pr-on");
  document.body.style.overflow = "hidden";
  document.addEventListener("click", _fueraDeMenus, true);
  document.addEventListener("keydown", _escape);
  render();
}
