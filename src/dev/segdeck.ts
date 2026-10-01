// dev/segdeck.ts — Maquetas de la hoja de SEGUIMIENTO del deck (SOLO dev): ?ui=segdeck
//
// Pedido de Manuel (1-oct-2026): "revisa cómo se va a visualizar en la
// presentación de los partners para evidenciar sus avances". Hallazgos sobre la
// hoja actual (solo el Gantt):
//   1. Con muchas tareas se CORTA en silencio (overflow:hidden): con 18 tareas
//      el partner ve ~10 y el resto desaparece del PDF.
//   2. No dice cuánto se avanzó, qué se logró en el período, qué sigue ni qué se
//      necesita del partner; el checklist de las tarjetas no aparece.
// Tres propuestas a 1280×720 (tamaño del PDF), con paginación cuando no entra.
// Vendor.ts la importa detrás de `import.meta.env.DEV`: no llega a producción.

import "./segdeck.css";
import { registerActions } from "../shared/actions";
import { escapeHTML as e } from "../core/security";

type Prop = "a" | "b" | "c" | "d";
interface T { t: string; st: "pendiente" | "en_curso" | "bloqueado" | "hecho"; p: string; o: string; ini: string; fin: string; res: string; chk: [number, number] }
const HOY = "2026-10-01", DESDE = "2026-09-01", HASTA = "2026-09-30";
const ST_COL = { pendiente: "#9ca3af", en_curso: "#0284c7", bloqueado: "#dc2626", hecho: "#16a34a" };
const ST_LBL = { pendiente: "Pendiente", en_curso: "En curso", bloqueado: "Bloqueado", hecho: "Hecho" };
const P_COL = ["#2a78d6", "#eb6834", "#1baf7a", "#a855f7", "#eda100"];

const CHICO: T[] = [
  { t: "Activar campaña de scouts en SJL", st: "hecho", p: "Captación Q3", o: "Ana", ini: "2026-08-01", fin: "2026-09-12", res: "+120 conductores nuevos", chk: [3, 3] },
  { t: "Onboarding presencial semanal", st: "en_curso", p: "Captación Q3", o: "Partner", ini: "2026-08-15", fin: "2026-10-15", res: "Activación a 1 viaje > 40%", chk: [2, 4] },
  { t: "Brandear 80 autos de la flota propia", st: "en_curso", p: "Brandeo", o: "Ana", ini: "2026-08-10", fin: "2026-10-10", res: "80 autos brandeados", chk: [1, 3] },
  { t: "Conseguir proveedor de vinilos en Trujillo", st: "bloqueado", p: "Brandeo", o: "Partner", ini: "2026-09-01", fin: "2026-09-20", res: "Proveedor contratado", chk: [0, 2] },
  { t: "Llamar a conductores inactivos 30+ días", st: "pendiente", p: "Reactivación", o: "Ana", ini: "2026-10-02", fin: "2026-10-15", res: "+60 reactivados", chk: [0, 0] },
  { t: "Bono de reactivación de S/20", st: "hecho", p: "Reactivación", o: "Partner", ini: "2026-09-05", fin: "2026-09-25", res: "", chk: [2, 2] }
];
const GRANDE: T[] = [...CHICO, ...Array.from({ length: 12 }, (_, i): T => ({
  t: ["Capacitación de calidad", "Revisar tarifas TukTuk", "Reporte de cancelaciones", "Alta de 15 autos", "Leads Yango en el panel", "Pagos diarios a conductores"][i % 6] + (i > 5 ? " (fase 2)" : ""),
  st: (["hecho", "en_curso", "pendiente", "hecho", "bloqueado", "en_curso"] as const)[i % 6], p: ["Calidad de servicio", "Flota TukTuk", "Captación Q3", "Reactivación"][i % 4],
  o: i % 3 ? "Ana" : "Partner", ini: `2026-0${8 + (i % 2)}-0${1 + (i % 9)}`, fin: `2026-${["09", "10", "11"][i % 3]}-${String(5 + i).padStart(2, "0")}`, res: i % 2 ? "+30 activos" : "", chk: [i % 3, 3]
}))];

const CV = { prop: "d" as Prop, grande: false, pag: 0 };
const fC = (d: string) => { const [, m, dd] = d.split("-"); return `${+dd} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][+m - 1]}`; };
const proys = (ts: T[]) => [...new Set(ts.map(t => t.p))];
const pcol = (ts: T[], p: string) => P_COL[proys(ts).indexOf(p) % P_COL.length];
const logrado = (t: T) => t.st === "hecho" && t.fin >= DESDE && t.fin <= HASTA;
const necesita = (t: T) => t.st !== "hecho" && (t.st === "bloqueado" || /partner/i.test(t.o));
const pill = (st: T["st"]) => `<span class="sd-pill" style="background:${ST_COL[st]}">${ST_LBL[st]}</span>`;

function cabecera(sub: string, pag: string): string {
  return `<div class="sd-head">
    <div><span class="sd-badge">🚕 TAXI</span><div class="sd-partner">ANDINA MOVILIDAD</div><div class="sd-sub">${e(sub)}</div></div>
    <div class="sd-head__r"><span class="sd-brand"><span class="sd-brand__sq"></span>YANGO <b>Partners</b></span><div class="sd-title">SEGUIMIENTO · AVANCE DEL PLAN${pag}</div><span class="sd-mode">📅 MENSUAL</span></div>
  </div>`;
}
const pie = (n: number) => `<div class="sd-foot"><span>YANGO Partners · Confidencial</span><span>pág. ${n}/18</span></div>`;
function anillo(pct: number, size = 150): string {
  const r = size / 2 - 12, c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef0f3" stroke-width="14"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#16a34a" stroke-width="14" stroke-linecap="round" stroke-dasharray="${c * pct / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="48%" text-anchor="middle" font-size="${size * .22}" font-weight="900" fill="#111" font-family="-apple-system,Segoe UI,Roboto,sans-serif">${pct}%</text>
    <text x="50%" y="64%" text-anchor="middle" font-size="12" fill="#6b7280" font-family="-apple-system,Segoe UI,Roboto,sans-serif">del plan</text></svg>`;
}
function barraProy(ts: T[], p: string): string {
  const de = ts.filter(t => t.p === p), h = de.filter(t => t.st === "hecho").length, c = de.filter(t => t.st === "en_curso").length, b = de.filter(t => t.st === "bloqueado").length;
  const w = (n: number) => `${de.length ? n / de.length * 100 : 0}%`;
  return `<div class="sd-pb"><div class="sd-pb__h"><span class="sd-sq" style="background:${pcol(ts, p)}"></span><b>${e(p)}</b><span>${h} de ${de.length}</span></div>
    <div class="sd-pb__bar"><span style="width:${w(h)};background:#16a34a"></span><span style="width:${w(c)};background:#0284c7"></span><span style="width:${w(b)};background:#dc2626"></span></div></div>`;
}
function item(t: T, ts: T[], conFecha = true, conChk = false): string {
  return `<li class="sd-it"><span class="sd-sq" style="background:${pcol(ts, t.p)}"></span><div><div class="sd-it__t">${e(t.t)}</div>
    <div class="sd-it__m">${conFecha && t.fin ? `${t.st === "hecho" ? "Cerrado" : "Para el"} ${fC(t.fin)}` : ""}${t.o ? ` · ${e(t.o)}` : ""}${conChk && t.chk[1] ? ` · ${t.chk[0]}/${t.chk[1]} pasos` : ""}${t.res ? ` · <i>${e(t.res)}</i>` : ""}</div></div>${necesita(t) && t.st !== "hecho" ? `<span class="sd-nec">${t.st === "bloqueado" ? "Bloqueado" : "Partner"}</span>` : ""}</li>`;
}

// ── A · Avance y próximos pasos ─────────────────────────────────────────────
function propA(ts: T[]): string[] {
  const hechas = ts.filter(t => t.st === "hecho").length, pct = Math.round(hechas / ts.length * 100);
  const log = ts.filter(logrado), cur = ts.filter(t => t.st === "en_curso"), prox = ts.filter(t => t.st === "pendiente" || t.st === "bloqueado").sort((a, b) => a.fin.localeCompare(b.fin));
  const MAX = 4, mas = (n: number) => n > MAX ? `<li class="sd-mas">+${n - MAX} más en el anexo</li>` : "";
  const hoja1 = `<div class="sd-slide">${cabecera("Qué logramos en septiembre y qué sigue", "")}
    <div class="sd-a">
      <div class="sd-a__left">${anillo(pct)}
        <div class="sd-a__stats"><div><b style="color:#16a34a">${log.length}</b>logradas en sep</div><div><b style="color:#0284c7">${cur.length}</b>en curso</div><div><b style="color:#dc2626">${ts.filter(necesita).length}</b>necesitan de ti</div></div>
      </div>
      <div class="sd-a__proys"><div class="sd-h3">Avance por proyecto</div>${proys(ts).map(p => barraProy(ts, p)).join("")}
        <div class="sd-ley"><span><i style="background:#16a34a"></i>Hecho</span><span><i style="background:#0284c7"></i>En curso</span><span><i style="background:#dc2626"></i>Bloqueado</span><span><i style="background:#eef0f3"></i>Por hacer</span></div></div>
    </div>
    <div class="sd-cols">
      <div class="sd-col"><div class="sd-col__h" style="border-color:#16a34a">✓ Logrado en septiembre</div><ul>${log.slice(0, MAX).map(t => item(t, ts)).join("") || `<li class="sd-mas">Sin cierres en el período</li>`}${mas(log.length)}</ul></div>
      <div class="sd-col"><div class="sd-col__h" style="border-color:#0284c7">→ En curso</div><ul>${cur.slice(0, MAX).map(t => item(t, ts, true, true)).join("")}${mas(cur.length)}</ul></div>
      <div class="sd-col"><div class="sd-col__h" style="border-color:#111">Próximos pasos</div><ul>${prox.slice(0, MAX).map(t => item(t, ts)).join("")}${mas(prox.length)}</ul></div>
    </div>${pie(16)}</div>`;
  const resto = [...log.slice(MAX), ...cur.slice(MAX), ...prox.slice(MAX)];
  if (!resto.length) return [hoja1];
  return [hoja1, `<div class="sd-slide">${cabecera("Anexo · el resto del plan", "")}<ul class="sd-anexo">${resto.map(t => `<li>${pill(t.st)}${item(t, ts, true, true)}</li>`).join("")}</ul>${pie(17)}</div>`];
}

// ── B · Por proyecto (tarjetas) ─────────────────────────────────────────────
function propB(ts: T[]): string[] {
  const ps = proys(ts), POR = 4, hojas: string[] = [];
  for (let i = 0; i < ps.length; i += POR) {
    const n = Math.ceil(ps.length / POR), pag = n > 1 ? ` (${i / POR + 1}/${n})` : "";
    const cards = ps.slice(i, i + POR).map(p => {
      const de = ts.filter(t => t.p === p), h = de.filter(t => t.st === "hecho").length, pct = Math.round(h / de.length * 100);
      const orden = [...de].sort((a, b) => ["hecho", "en_curso", "bloqueado", "pendiente"].indexOf(a.st) - ["hecho", "en_curso", "bloqueado", "pendiente"].indexOf(b.st));
      const MAX = 5;
      return `<div class="sd-pc" style="border-top-color:${pcol(ts, p)}">
        <div class="sd-pc__h"><b>${e(p)}</b><span class="sd-pc__pct">${pct}%</span></div>
        <div class="sd-pb__bar"><span style="width:${pct}%;background:#16a34a"></span></div>
        <ul>${orden.slice(0, MAX).map(t => `<li class="sd-pc__it is-${t.st}"><span class="sd-ck">${t.st === "hecho" ? "✓" : t.st === "bloqueado" ? "!" : t.st === "en_curso" ? "◐" : ""}</span>
          <div><div class="sd-it__t">${e(t.t)}</div><div class="sd-it__m">${t.st === "hecho" ? "Cerrado " : "Para el "}${fC(t.fin)} · ${e(t.o)}${t.chk[1] && t.st !== "hecho" ? ` · ${t.chk[0]}/${t.chk[1]} pasos` : ""}</div></div></li>`).join("")}
          ${orden.length > MAX ? `<li class="sd-mas">+${orden.length - MAX} tareas más</li>` : ""}</ul>
      </div>`;
    }).join("");
    hojas.push(`<div class="sd-slide">${cabecera("Avance de cada proyecto del plan", pag)}<div class="sd-b">${cards}</div>${pie(16 + i / POR)}</div>`);
  }
  return hojas;
}

// ── C · Cronograma mejorado (Gantt con resumen y paginado) ───────────────────
function propC(ts: T[]): string[] {
  const hechas = ts.filter(t => t.st === "hecho").length, pct = Math.round(hechas / ts.length * 100);
  const POR = 9, n = Math.ceil(ts.length / POR), hojas: string[] = [];
  const meses = ["ago", "sep", "oct", "nov"], col = (d: string) => (+d.slice(5, 7) - 8) + (+d.slice(8, 10) - 1) / 31;
  const orden = [...ts].sort((a, b) => a.p.localeCompare(b.p) || a.ini.localeCompare(b.ini));
  for (let k = 0; k < n; k++) {
    const pag = n > 1 ? ` (${k + 1}/${n})` : "";
    const filas = orden.slice(k * POR, (k + 1) * POR).map(t => {
      const a = Math.max(0, col(t.ini)), b = Math.min(4, col(t.fin) + .03);
      return `<div class="sd-g__row"><div class="sd-g__name"><span class="sd-sq" style="background:${pcol(ts, t.p)}"></span><div><div class="sd-it__t">${e(t.t)}</div><div class="sd-it__m">${e(t.p)} · ${e(t.o)}${t.res ? ` · <i>${e(t.res)}</i>` : ""}</div></div></div>
        <div class="sd-g__st">${pill(t.st)}</div>
        <div class="sd-g__track">${meses.map(() => "<span></span>").join("")}<i class="sd-g__bar" style="left:${a / 4 * 100}%;width:${(b - a) / 4 * 100}%;background:${ST_COL[t.st]}"></i><i class="sd-g__hoy" style="left:${col(HOY) / 4 * 100}%"></i></div></div>`;
    }).join("");
    hojas.push(`<div class="sd-slide">${cabecera("Cronograma del plan", pag)}
      <div class="sd-c__sum"><div><b>${pct}%</b> del plan completado</div><div><b style="color:#16a34a">${ts.filter(logrado).length}</b> logradas en sep</div><div><b style="color:#0284c7">${ts.filter(t => t.st === "en_curso").length}</b> en curso</div><div><b style="color:#dc2626">${ts.filter(necesita).length}</b> necesitan de ti</div></div>
      <div class="sd-g"><div class="sd-g__row sd-g__row--h"><div>Tarea</div><div>Estado</div><div class="sd-g__track sd-g__track--h">${meses.map(m => `<span>${m}</span>`).join("")}</div></div>${filas}</div>${pie(16 + k)}</div>`);
  }
  return hojas;
}


// ── D · Kanban (pedido de Manuel: "una vista de kanban de los logrados,
// bloqueados, en proceso y backlog… fácil de entender rápidamente qué falta,
// cuáles son los next steps, en cuál estamos avanzando y cuál se bloqueó").
// Columnas en SU orden. Hasta 4 tarjetas por columna y hoja; lo que no entra
// sigue en otra hoja (2/2) — nunca se corta.
function propD(ts: T[]): string[] {
  const COLS: { st: T["st"]; tit: string; sub: string; col: string; ico: string }[] = [
    { st: "hecho", tit: "Logrados", sub: "cerrados", col: "#16a34a", ico: "✓" },
    { st: "bloqueado", tit: "Bloqueados", sub: "necesitan una acción", col: "#dc2626", ico: "!" },
    { st: "en_curso", tit: "En proceso", sub: "avanzando", col: "#0284c7", ico: "→" },
    { st: "pendiente", tit: "Próximos pasos", sub: "backlog, por fecha", col: "#6b7280", ico: "•" }
  ];
  // 4 y no 5: una tarjeta de "En proceso" con su barra de pasos es más alta
  // y la quinta quedaba cortada en la hoja de 720 px.
  const POR = 4;
  const grupos = COLS.map(c => {
    const de = ts.filter(t => t.st === c.st);
    // Logrados: lo más reciente primero. El resto: lo más urgente primero.
    return de.sort((a, b) => c.st === "hecho" ? b.fin.localeCompare(a.fin) : a.fin.localeCompare(b.fin));
  });
  const nHojas = Math.max(1, ...grupos.map(g => Math.ceil(g.length / POR)));
  const pct = Math.round(ts.filter(t => t.st === "hecho").length / ts.length * 100);
  const venc = (t: T) => t.st !== "hecho" && t.fin < HOY;
  const card = (t: T, c: typeof COLS[number], n: number) => {
    const chk = t.chk[1] ? Math.round(t.chk[0] / t.chk[1] * 100) : null;
    const fecha = t.st === "hecho" ? `Cerrado el ${fC(t.fin)}` : venc(t) ? `Vencía el ${fC(t.fin)}` : `Para el ${fC(t.fin)}`;
    return `<div class="sd-k__card" style="border-left-color:${c.col}">
      <div class="sd-k__top"><span class="sd-k__proy"><span class="sd-sq" style="background:${pcol(ts, t.p)};margin-top:0"></span>${e(t.p)}</span>${c.st === "pendiente" ? `<span class="sd-k__n">${n}</span>` : ""}</div>
      <div class="sd-k__t">${e(t.t)}</div>
      ${t.res ? `<div class="sd-k__res">🎯 ${e(t.res)}</div>` : ""}
      ${c.st === "en_curso" && chk != null ? `<div class="sd-k__chk"><div class="sd-pb__bar"><span style="width:${chk}%;background:#0284c7"></span></div><span>${t.chk[0]}/${t.chk[1]} pasos</span></div>` : ""}
      <div class="sd-k__meta"><span class="${venc(t) ? "sd-k__venc" : ""}">${fecha}</span><span>${e(t.o)}</span></div>
      ${c.st === "bloqueado" ? `<div class="sd-k__nec">${/partner/i.test(t.o) ? "Necesitamos de ti para destrabarlo" : "Lo estamos destrabando con Yango"}</div>` : ""}
    </div>`;
  };
  const hojas: string[] = [];
  for (let k = 0; k < nHojas; k++) {
    const pag = nHojas > 1 ? ` (${k + 1}/${nHojas})` : "";
    const cols = COLS.map((c, i) => {
      const g = grupos[i], trozo = g.slice(k * POR, (k + 1) * POR), resto = g.length - (k + 1) * POR;
      return `<section class="sd-k__col">
        <header class="sd-k__h" style="background:${c.col}"><span class="sd-k__ico">${c.ico}</span><div><b>${c.tit}</b><span>${c.sub}</span></div><span class="sd-k__cnt">${g.length}</span></header>
        <div class="sd-k__body">${trozo.map((t, j) => card(t, c, k * POR + j + 1)).join("") || (k === 0 ? `<div class="sd-k__vacio">${c.st === "bloqueado" ? "Nada bloqueado 🎉" : "—"}</div>` : "")}
          ${resto > 0 ? `<div class="sd-mas">+${resto} en la hoja siguiente</div>` : ""}</div>
      </section>`;
    }).join("");
    hojas.push(`<div class="sd-slide">${cabecera("Plan de trabajo · en qué estamos", pag)}
      <div class="sd-k__sum">
        <div class="sd-k__avance"><b>${pct}%</b> del plan completado<div class="sd-pb__bar"><span style="width:${pct}%;background:#16a34a"></span></div></div>
        ${COLS.map((c, i) => `<div class="sd-k__mini"><b style="color:${c.col}">${grupos[i].length}</b>${c.tit.toLowerCase()}</div>`).join("")}
      </div>
      <div class="sd-k">${cols}</div>${pie(16 + k)}</div>`);
  }
  return hojas;
}

const PROPS = [
  { k: "d" as Prop, t: "D · Kanban", d: "Lo que pediste: cuatro columnas — Logrados · Bloqueados · En proceso · Próximos pasos (backlog numerado por fecha). Arriba el % del plan y cuántas hay en cada columna. En proceso muestra la barra de pasos del checklist; Bloqueados dice si se necesita al partner; lo vencido va en rojo. Hasta 4 tarjetas por columna y hoja; el resto sigue en la hoja siguiente, nunca se corta." },
  { k: "a" as Prop, t: "A · Avance y próximos pasos", d: "Una hoja que se lee en 10 segundos: % del plan completado, avance por proyecto, y tres columnas (logrado en el período · en curso con sus pasos · próximos pasos), con lo que necesita del partner marcado. Si no entra todo, el resto va a una hoja de anexo; nunca se corta." },
  { k: "b" as Prop, t: "B · Por proyecto", d: "Una tarjeta por proyecto con su % y la lista de tareas con check (hecha, en curso, bloqueada, por hacer) y los pasos del checklist. 4 proyectos por hoja; si hay más, sigue en otra hoja (1/2, 2/2)." },
  { k: "c" as Prop, t: "C · Cronograma mejorado", d: "El Gantt de hoy con letra más grande, un resumen arriba (% del plan, logradas, en curso, necesitan de ti) y paginado: 9 tareas por hoja, nunca se corta." }
];
function page(): string {
  const ts = CV.grande ? GRANDE : CHICO;
  const hojas = CV.prop === "a" ? propA(ts) : CV.prop === "b" ? propB(ts) : CV.prop === "c" ? propC(ts) : propD(ts);
  const W = Math.min(1100, (document.getElementById("sdRoot")?.clientWidth || innerWidth) - 60), s = W / 1280;
  const seg = (act: string, val: string, ops: [string, string][]) => `<div class="sdp-seg">${ops.map(([k, l]) => `<button class="${k === val ? "is-on" : ""}" data-act="${act}" data-v="${k}">${e(l)}</button>`).join("")}</div>`;
  return `<div class="sdp-bar"><strong>Hoja de Seguimiento del deck · propuestas</strong>
      ${seg("sdProp", CV.prop, PROPS.map(p => [p.k, p.t]))}
      ${seg("sdCaso", CV.grande ? "g" : "c", [["c", "Partner con 6 tareas"], ["g", "Partner con 18 tareas"]])}</div>
    <p class="sdp-desc">${e(PROPS.find(p => p.k === CV.prop)!.d)}</p>
    ${hojas.map((h, i) => `<figure class="sdp-fig"><figcaption>Hoja ${i + 1} de ${hojas.length}</figcaption><div class="sdp-frame" style="width:${1280 * s}px;height:${720 * s}px"><div style="transform:scale(${s});transform-origin:0 0;width:1280px;height:720px">${h}</div></div></figure>`).join("")}`;
}
function render(): void { const r = document.getElementById("sdRoot"); if (r) r.innerHTML = page(); }
export function mountSegDeck(): void {
  const root = document.createElement("div"); root.id = "sdRoot"; root.className = "sdp-root"; document.body.appendChild(root);
  registerActions({
    sdProp: (d: DOMStringMap) => { CV.prop = d.v as Prop; render(); },
    sdCaso: (d: DOMStringMap) => { CV.grande = d.v === "g"; render(); }
  } as any);
  render();
  addEventListener("resize", render);
}
