// dev/portal.ts — Maqueta del PORTAL DEL PARTNER (SOLO dev): ?ui=portal
//
// Pedido de Manuel (2-oct-2026): enfocarse en el portal del partner:
//   1. Seguridad: que solo vea SU información (RLS; ver la auditoría en CLAUDE.md).
//   2. Desempeño propio en diario/semanal/mensual + "Mis datos" para descargar SUS datos.
//   3. Métricas y análisis completos con sus números, con división por subflotas.
// Segunda vuelta (mismo día): filtros de fechas en TODO el portal (rango Desde/Hasta
// + atajos) y la FASE 2, comparación con el mercado: solo tasas y promedios (nunca
// volúmenes, participación ni posición), de al menos 5 partners de su ciudad.
// Ocultos por decisión de Manuel: participación de mercado (trips/supply_hours/
// commission share), subsidios y % de fraude. Solicitudes a soporte: se muestran.
// Datos de MUESTRA (no salen de la base): un partner con 6 subflotas.
// Prefijo de clases `ppm-` porque el portal real ya usa `pp-`.
// Vendor.ts la importa detrás de `import.meta.env.DEV`: no llega a producción.

import "./portal.css";
import { registerActions } from "../shared/actions";
import { escapeHTML as e } from "../core/security";
import { iconSvg } from "../shared/icons";

type Escala = "diario" | "semanal" | "mensual";
type Tab = "resumen" | "desempeno" | "subflotas" | "datos";
interface Sub { id: string; nombre: string; ciudad: string; tipo: "Taxi" | "Fleet" | "TukTuk" | "Delivery" | "Cargo"; base: number; tend: number; col: string; enTotal: boolean }
interface Fila { periodo: string; sub: string; ad: number; nuevos: number; react: number; horas: number; viajes: number; comision: number; gmv: number; acept: number; compl: number; rating: number; soporte: number; propios: number; yango: number; a50: number }

const SUBS: Sub[] = [
  { id: "lima", nombre: "Andina Lima", ciudad: "Lima", tipo: "Fleet", base: 1650, tend: 0.012, col: "#2a78d6", enTotal: true },
  { id: "truj", nombre: "Andina Trujillo", ciudad: "Trujillo", tipo: "Taxi", base: 420, tend: -0.025, col: "#eb6834", enTotal: true },
  { id: "areq", nombre: "Andina Arequipa", ciudad: "Arequipa", tipo: "Taxi", base: 380, tend: 0.03, col: "#1baf7a", enTotal: true },
  { id: "tk", nombre: "Andina TukTuk", ciudad: "Lima", tipo: "TukTuk", base: 260, tend: 0.04, col: "#a855f7", enTotal: true },
  { id: "dlv", nombre: "Andina Delivery", ciudad: "Lima", tipo: "Delivery", base: 90, tend: 0.01, col: "#eda100", enTotal: false },
  { id: "crg", nombre: "Andina Cargo", ciudad: "Lima", tipo: "Cargo", base: 40, tend: 0, col: "#64748b", enTotal: false }
];
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function dias(desde: string, n: number, paso: number): string[] {
  const d = new Date(desde + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) => { const x = new Date(d); x.setUTCDate(d.getUTCDate() + i * paso); return `${x.getUTCDate()} ${MES[x.getUTCMonth()]}`; });
}
const PER: Record<Escala, string[]> = {
  diario: dias("2026-08-18", 28, 1),
  semanal: dias("2026-05-25", 17, 7),
  mensual: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep (en curso)"]
};
const ATAJOS: Record<Escala, [string, number][]> = {
  diario: [["Últimos 7 días", 7], ["Últimos 14", 14], ["Últimos 28", 28]],
  semanal: [["Última semana", 1], ["4 semanas", 4], ["8 semanas", 8], ["Todo", 99]],
  mensual: [["Este mes", 1], ["3 meses", 3], ["6 meses", 6], ["Todo", 99]]
};
const DEF_N: Record<Escala, number> = { diario: 14, semanal: 8, mensual: 6 };
const ESC_F: Record<Escala, number> = { diario: 0.42, semanal: 1, mensual: 1.75 };
const FLUJO_F: Record<Escala, number> = { diario: 0.16, semanal: 1, mensual: 4.2 };
const ST = { tab: "resumen" as Tab, esc: "semanal" as Escala, desde: PER.semanal.length - 8, hasta: PER.semanal.length - 1, sub: "todas", ciudad: "todas",
  metrica: "ad" as keyof Fila, cols: new Set(["base", "adq"]), mercado: "Lima" };

function ruido(i: number, j: number) { const x = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; }
function datos(esc: Escala): Fila[] {
  const out: Fila[] = [];
  PER[esc].forEach((p, i) => SUBS.forEach((s, j) => {
    const ad = Math.round(s.base * ESC_F[esc] * (1 + s.tend * (i - 8) * (esc === "diario" ? 0.15 : 1)) * (1 + ruido(i, j) * 0.06));
    const ff = FLUJO_F[esc];
    const nuevos = Math.round(s.base * 0.05 * ff * (1 + ruido(i + 3, j) * 0.4)), react = Math.round(s.base * 0.08 * ff * (1 + ruido(i + 7, j) * 0.4));
    const horas = Math.round(ad * (esc === "diario" ? 7.5 : esc === "semanal" ? 31 : 118) * (1 + ruido(i + 1, j) * 0.08));
    const viajes = Math.round(horas * (s.tipo === "TukTuk" ? 2.4 : 1.65) * (1 + ruido(i + 2, j) * 0.05));
    const gmv = Math.round(viajes * (s.tipo === "TukTuk" ? 6.5 : 13.8));
    out.push({ periodo: p, sub: s.id, ad, nuevos, react, horas, viajes, gmv, comision: Math.round(gmv * 0.031),
      acept: 0.74 + ruido(i + 4, j) * 0.08, compl: 0.9 + ruido(i + 5, j) * 0.04, rating: 4.78 + ruido(i + 6, j) * 0.1, soporte: 0.021 + ruido(i + 8, j) * 0.008,
      propios: Math.round(nuevos * 0.45), yango: nuevos - Math.round(nuevos * 0.45), a50: Math.round(nuevos * 0.31) });
  }));
  return out;
}
const n0 = (v: number) => Math.round(v).toLocaleString("es-PE");
const pc = (v: number, d = 1) => (v * 100).toFixed(d) + "%";
const sol = (v: number) => "S/ " + n0(v);
const rango = () => PER[ST.esc].slice(ST.desde, ST.hasta + 1);
const subsFiltradas = () => SUBS.filter(s => (ST.sub === "todas" ? s.enTotal : s.id === ST.sub) && (ST.ciudad === "todas" || s.ciudad === ST.ciudad));
function serie(f: Fila[], k: keyof Fila, subs = subsFiltradas()) {
  const ids = new Set(subs.map(s => s.id));
  return rango().map(p => f.filter(r => r.periodo === p && ids.has(r.sub)).reduce((a, r) => a + (r[k] as number), 0));
}
function serieTasa(f: Fila[], k: keyof Fila, peso: keyof Fila, subs = subsFiltradas()) {
  const ids = new Set(subs.map(s => s.id));
  return rango().map(p => { const rs = f.filter(r => r.periodo === p && ids.has(r.sub)); const w = rs.reduce((a, r) => a + (r[peso] as number), 0); return w ? rs.reduce((a, r) => a + (r[k] as number) * (r[peso] as number), 0) / w : 0; });
}
const ult = (s: number[]) => s[s.length - 1], ant = (s: number[]) => s.length > 1 ? s[s.length - 2] : 0;
const sum = (s: number[]) => s.reduce((a, b) => a + b, 0);
const per = () => ({ diario: "día", semanal: "semana", mensual: "mes" } as const)[ST.esc];
const ultimoPer = () => ST.esc === "semanal" ? "última semana" : `último ${per()}`;
const rangoTxt = () => { const r = rango(); return r.length === 1 ? r[0] : `${r[0]} – ${r[r.length - 1]}`; };
function delta(a: number, b: number, inv = false) {
  if (!b) return "";
  const d = (a - b) / b, bueno = inv ? d < 0 : d > 0;
  return `<span class="ppm-d ${Math.abs(d) < 0.005 ? "" : bueno ? "is-up" : "is-down"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(1)}%</span>`;
}
function linea(vals: number[], col = "#2a78d6", h = 120, w = 520, extra: { banda?: [number, number] } = {}) {
  const labsP = rango();
  if (vals.length < 2) return `<p class="ppm-mut">Elige un rango de 2 o más períodos para ver la evolución.</p>`;
  const lo = Math.min(...vals, extra.banda ? extra.banda[0] : Infinity), hi = Math.max(...vals, extra.banda ? extra.banda[1] : -Infinity);
  const max = hi + (hi - lo) * 0.15 + 1e-9, min = lo - (hi - lo) * 0.15;
  const x = (i: number) => 30 + i * (w - 40) / Math.max(1, vals.length - 1), y = (v: number) => h - 18 - (v - min) / (max - min || 1) * (h - 30);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const cada = Math.ceil(vals.length / 9);
  const labs = labsP.map((p, i) => i % cada ? "" : `<text x="${x(i)}" y="${h - 3}" text-anchor="middle" class="ppm-ax">${p}</text>`).join("");
  const banda = extra.banda ? `<rect x="30" width="${w - 40}" y="${y(extra.banda[1])}" height="${y(extra.banda[0]) - y(extra.banda[1])}" class="ppm-banda"/><text x="${w - 12}" y="${y(extra.banda[1]) - 4}" text-anchor="end" class="ppm-ax">rango típico del mercado</text>` : "";
  return `<svg viewBox="0 0 ${w} ${h}" class="ppm-svg">${banda}<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5"/>${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${col}"><title>${labsP[i]}: ${n0(v)}</title></circle>`).join("")}${labs}</svg>`;
}
function apiladas(f: Fila[], k: keyof Fila, subs: Sub[], h = 170, w = 560) {
  const per0 = rango(), tot = per0.map(p => subs.reduce((a, s) => a + (f.find(r => r.periodo === p && r.sub === s.id)![k] as number), 0));
  const max = Math.max(...tot) * 1.05, bw = (w - 40) / per0.length, cada = Math.ceil(per0.length / 9);
  let svg = "";
  per0.forEach((p, i) => {
    let acc = 0;
    subs.forEach(s => { const v = f.find(r => r.periodo === p && r.sub === s.id)![k] as number; const hh = v / max * (h - 26); svg += `<rect x="${32 + i * bw}" y="${h - 18 - acc - hh}" width="${bw * 0.7}" height="${hh}" fill="${s.col}"><title>${s.nombre} · ${p}: ${n0(v)}</title></rect>`; acc += hh; });
    if (!(i % cada)) svg += `<text x="${32 + i * bw + bw * 0.35}" y="${h - 3}" text-anchor="middle" class="ppm-ax">${p}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" class="ppm-svg">${svg}</svg>`;
}
const card = (tit: string, cuerpo: string, extra = "") => `<section class="ppm-card ${extra}"><h3>${tit}</h3>${cuerpo}</section>`;
function kpi(lbl: string, v: string, d: string, sub: string, mkt = "") { return `<div class="ppm-kpi"><span class="ppm-kpi__l">${lbl}</span><b>${v}</b>${d}<small>${sub}</small>${mkt}</div>`; }
function anillo(pct: number, col: string) {
  const r = 30, c = 2 * Math.PI * r;
  return `<svg width="76" height="76" viewBox="0 0 76 76"><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--color-fill-soft)" stroke-width="8"/><circle cx="38" cy="38" r="${r}" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c * Math.min(pct, 1)} ${c}" transform="rotate(-90 38 38)"/><text x="38" y="43" text-anchor="middle" class="ppm-ring">${Math.round(pct * 100)}%</text></svg>`;
}

// ── Fase 2: referencia del mercado (SOLO tasas; ≥5 partners de la ciudad) ────
interface Ref { k: string; l: string; tu: number; prom: number; p25: number; p75: number; fmt: (v: number) => string; menosEsMejor?: boolean; n: number }
function refs(f: Fila[]): Ref[] {
  const ad = serie(f, "ad"), hr = serie(f, "horas"), vj = serie(f, "viajes"), gm = serie(f, "gmv"), nu = serie(f, "nuevos"), re = serie(f, "react"), a50 = serie(f, "a50");
  const ganados = ult(nu) + ult(re), ret = ant(ad) ? (ult(ad) - ganados) / ant(ad) : 0.85;
  const acc = serieTasa(f, "acept", "viajes"), com = serieTasa(f, "compl", "viajes"), sop = serieTasa(f, "soporte", "viajes");
  const n = ST.mercado === "Lima" ? 31 : ST.mercado === "Perú" ? 74 : 9;
  const m = (prom: number, sp: number) => ({ prom, p25: prom * (1 - sp), p75: prom * (1 + sp) });
  return [
    { k: "ret", l: "Retención de conductores", tu: ret, ...m(0.821, 0.05), fmt: v => pc(v), n },
    { k: "react", l: "% de reactivados en lo que entra", tu: ult(re) / ganados, ...m(0.55, 0.12), fmt: v => pc(v, 0), n },
    { k: "a50", l: "Nuevos que llegan a 50 viajes", tu: sum(a50) / sum(nu), ...m(0.27, 0.18), fmt: v => pc(v, 0), n },
    { k: "hpc", l: "Horas por conductor", tu: ult(hr) / ult(ad), ...m(28.4, 0.1), fmt: v => v.toFixed(1), n },
    { k: "vph", l: "Viajes por hora", tu: ult(vj) / ult(hr), ...m(1.62, 0.07), fmt: v => v.toFixed(2), n },
    { k: "iph", l: "Ingreso por hora del conductor", tu: ult(gm) / ult(hr), ...m(21.1, 0.08), fmt: v => "S/ " + v.toFixed(1), n },
    { k: "acc", l: "Aceptación", tu: ult(acc), ...m(0.761, 0.05), fmt: v => pc(v), n },
    { k: "com", l: "Viajes completados", tu: ult(com), ...m(0.905, 0.025), fmt: v => pc(v), n },
    { k: "sop", l: "Solicitudes a soporte", tu: ult(sop), ...m(0.024, 0.2), fmt: v => pc(v), menosEsMejor: true, n }
  ];
}
function veredicto(r: Ref) {
  const mejor = r.menosEsMejor ? r.tu < r.p25 : r.tu > r.p75, peor = r.menosEsMejor ? r.tu > r.p75 : r.tu < r.p25;
  return mejor ? ["is-up", "Mejor que la mayoría"] : peor ? ["is-down", "Por debajo de la mayoría"] : ["", "Dentro de lo habitual"];
}
function chipMercado(r: Ref) { const [c] = veredicto(r); return `<span class="ppm-mkt ${c}">Mercado ${ST.mercado}: ${r.fmt(r.prom)}</span>`; }
function tablaMercado(f: Fila[]) {
  const rs = refs(f);
  return card(`Cómo te comparas con el mercado <span class="ppm-chip ppm-chip--f2">Fase 2</span>`, `<div class="ppm-row"><span class="ppm-lbl">Comparar con</span><div class="ppm-seg">${["Lima", "Arequipa", "Perú"].map(c => `<button class="${ST.mercado === c ? "is-on" : ""}" data-act="ppMercado" data-v="${c}">${c === "Perú" ? "Todo Perú" : "Mercado de " + c}</button>`).join("")}</div></div>
    <div class="ppm-cmp">${rs.map(r => { const lo = Math.min(r.p25, r.tu) * 0.9, hi = Math.max(r.p75, r.tu) * 1.08, X = (v: number) => (v - lo) / (hi - lo) * 100; const [c, t] = veredicto(r);
      return `<div class="ppm-cmp__row"><span>${r.l}</span><div class="ppm-cmp__bar"><span class="ppm-cmp__band" style="left:${X(r.p25)}%;width:${X(r.p75) - X(r.p25)}%"></span><span class="ppm-cmp__avg" style="left:${X(r.prom)}%" title="Promedio ${r.fmt(r.prom)}"></span><span class="ppm-cmp__tu" style="left:${X(r.tu)}%" title="Tú ${r.fmt(r.tu)}"></span></div><b>${r.fmt(r.tu)}</b><small>prom. ${r.fmt(r.prom)}</small><span class="ppm-d ${c}">${t}</span></div>`; }).join("")}</div>
    <div class="ppm-leg"><span><i class="ppm-cmp__tu ppm-cmp__tu--leg"></i>Tú</span><span><i class="ppm-cmp__avg ppm-cmp__avg--leg"></i>Promedio</span><span><i class="ppm-cmp__band ppm-cmp__band--leg"></i>Rango típico (la mitad central de los partners)</span></div>
    <p class="ppm-mut">Promedio de ${rs[0].n} partners de ${ST.mercado === "Perú" ? "todo Perú" : ST.mercado}, mismo período y escala. Solo tasas y promedios: nunca se muestran volúmenes del mercado, participación ni el puesto de nadie, ni datos de un partner en particular. Si hay menos de 5 partners para comparar, no se muestra.</p>`, "ppm-span2");
}

// ── Pestañas ────────────────────────────────────────────────────────────────
function resumen(f: Fila[]): string {
  const ad = serie(f, "ad"), nr = rango().map((_, i) => serie(f, "nuevos")[i] + serie(f, "react")[i]), hr = serie(f, "horas"), vj = serie(f, "viajes"), cm = serie(f, "comision");
  const metas = [{ l: "Conductores activos", act: 2950, meta: 3100, proy: 3080 }, { l: "Nuevos + reactivados", act: 1290, meta: 2000, proy: 1880 }, { l: "Horas de conexión", act: 236000, meta: 400000, proy: 378000 }];
  const subsT = SUBS.filter(s => s.enTotal), totAd = subsT.reduce((a, s) => a + ult(serie(f, "ad", [s])), 0);
  const ret = refs(f)[0];
  return `<div class="ppm-grid2">
    ${card(`¿Llegas a tu meta de septiembre? <span class="ppm-chip">quedan 16 días</span>`, `<div class="ppm-metas">${metas.map(m => { const p = m.proy / m.meta; const col = p >= 1 ? "var(--color-ok-solid)" : p >= 0.95 ? "#d97706" : "var(--color-bad-solid)";
      return `<div class="ppm-meta-it">${anillo(m.act / m.meta, col)}<div><b>${m.l}</b><span>${n0(m.act)} de ${n0(m.meta)}</span><span style="color:${col}">Proyección al cierre: ${n0(m.proy)} (${Math.round(p * 100)}%)</span>${p < 1 ? `<span class="ppm-mut">Te faltan ${n0(m.meta - m.proy)} · ~${n0((m.meta - m.act) / 2.3)} por semana</span>` : `<span class="ppm-mut">Vas por encima del ritmo</span>`}</div></div>`; }).join("")}</div>
      <p class="ppm-mut">La meta es la del mes en curso, sin importar el rango elegido.</p>`, "ppm-span2")}
    ${card(`${ultimoPer()[0].toUpperCase() + ultimoPer().slice(1)} del rango vs el período anterior <span class="ppm-chip">${e(rango().at(-1) || "")}</span>`, `<div class="ppm-kpis">${kpi("Conductores activos", n0(ult(ad)), delta(ult(ad), ant(ad)), "")}${kpi("Nuevos + reactivados", n0(ult(nr)), delta(ult(nr), ant(nr)), "entraron a tu flota")}${kpi("Horas de conexión", n0(ult(hr)), delta(ult(hr), ant(hr)), "")}${kpi("Viajes", n0(ult(vj)), delta(ult(vj), ant(vj)), "")}${kpi("Tu comisión", sol(ult(cm)), delta(ult(cm), ant(cm)), "comisión del partner")}${kpi("Horas por conductor", (ult(hr) / ult(ad)).toFixed(1), delta(ult(hr) / ult(ad), ant(hr) / ant(ad)), "productividad")}</div>
      <p class="ppm-mut">En todo el rango (${e(rangoTxt())}): ${n0(sum(nr))} nuevos + reactivados · ${n0(sum(hr))} horas · ${n0(sum(vj))} viajes · ${sol(sum(cm))} de comisión.</p>`, "ppm-span2")}
    ${card("Lo que cambió", `<ul class="ppm-insights">
      <li class="is-bad">${iconSvg("trending-down", { size: 16 })}<span><b>Trujillo perdió conductores 3 ${per()}s seguidas</b> (−7% acumulado). Revisa bajas y reactivación ahí.</span></li>
      <li class="is-ok">${iconSvg("trending-up", { size: 16 })}<span><b>TukTuk creció +4% por ${per()}</b> y ya es el 9% de tus conductores activos.</span></li>
      <li>${iconSvg("users", { size: 16 })}<span><b>62% de lo que entra son reactivados.</b> De tus nuevos, 31% llegó a 50 viajes.</span></li>
      <li class="ppm-f2">${iconSvg("target", { size: 16 })}<span><b>Retienes ${ret.fmt(ret.tu)} de tus conductores; el mercado de ${ST.mercado}, ${ret.fmt(ret.prom)}.</b> <span class="ppm-chip ppm-chip--f2">Fase 2</span></span></li></ul>`)}
    ${card("Cómo se compone tu flota", `<div class="ppm-comp">${subsT.map(s => { const v = ult(serie(f, "ad", [s])); return `<div class="ppm-comp__row"><span><i style="background:${s.col}"></i>${e(s.nombre)} <small>${s.tipo}</small></span><div class="ppm-bar"><span style="width:${v / totAd * 100}%;background:${s.col}"></span></div><b>${n0(v)}</b><small>${pc(v / totAd, 0)}</small></div>`; }).join("")}
      <button class="ppm-link" data-act="ppTab" data-v="subflotas">Ver el detalle por subflota →</button></div>`)}
  </div>`;
}
function desempeno(f: Fila[]): string {
  const ad = serie(f, "ad"), nu = serie(f, "nuevos"), re = serie(f, "react"), hr = serie(f, "horas"), vj = serie(f, "viajes"), cm = serie(f, "comision"), gm = serie(f, "gmv");
  const prop = serie(f, "propios"), yan = serie(f, "yango"), a50 = serie(f, "a50");
  const acc = serieTasa(f, "acept", "viajes"), com = serieTasa(f, "compl", "viajes"), rat = serieTasa(f, "rating", "viajes"), sop = serieTasa(f, "soporte", "viajes");
  const R = Object.fromEntries(refs(f).map(r => [r.k, r]));
  const ganados = ult(nu) + ult(re), perdidos = Math.max(0, ant(ad) + ganados - ult(ad));
  const hpc = hr.map((h, i) => h / ad[i]), vph = vj.map((v, i) => v / hr[i]), iph = gm.map((g, i) => g / hr[i]);
  return `<div class="ppm-grid2">
    ${card("Conductores", `<div class="ppm-kpis ppm-kpis--4">${kpi("Activos", n0(ult(ad)), delta(ult(ad), ant(ad)), `${ultimoPer()} del rango`)}${kpi("Nuevos", n0(ult(nu)), delta(ult(nu), ant(nu)), `${n0(sum(nu))} en el rango`)}${kpi("Reactivados", n0(ult(re)), delta(ult(re), ant(re)), `${n0(sum(re))} en el rango`, chipMercado(R.react))}${kpi("Se fueron", n0(perdidos), "", `retención ${pc(R.ret.tu)}`, chipMercado(R.ret))}</div>${linea(ad, "#2a78d6", 150, 1150)}<p class="ppm-mut">Neto del período más reciente: ${ult(ad) - ant(ad) >= 0 ? "+" : ""}${n0(ult(ad) - ant(ad))} = ${n0(ganados)} que entraron − ${n0(perdidos)} que se fueron.</p>`, "ppm-span2")}
    ${card("De dónde vienen tus nuevos", `<div class="ppm-kpis ppm-kpis--3">${kpi("Captados por ti", n0(sum(prop)), "", "canal propio · en el rango")}${kpi("Captados por Yango", n0(sum(yan)), "", "leads de Yango · en el rango")}${kpi("Llegaron a 50 viajes", n0(sum(a50)), "", `${pc(sum(a50) / sum(nu), 0)} de los nuevos`, chipMercado(R.a50))}</div>${apiladas(f, "nuevos", subsFiltradas())}`)}
    ${card("Productividad", `<div class="ppm-kpis ppm-kpis--3">${kpi("Horas por conductor", ult(hpc).toFixed(1), delta(ult(hpc), ant(hpc)), "", chipMercado(R.hpc))}${kpi("Viajes por hora", ult(vph).toFixed(2), delta(ult(vph), ant(vph)), "", chipMercado(R.vph))}${kpi("Ingreso por hora", "S/ " + ult(iph).toFixed(1), delta(ult(iph), ant(iph)), "lo que factura un conductor", chipMercado(R.iph))}</div>${linea(hpc, "#1baf7a", 120, 520, { banda: [R.hpc.p25, R.hpc.p75] })}`)}
    ${card("Calidad del servicio", `<div class="ppm-kpis ppm-kpis--4">${kpi("Aceptación", pc(ult(acc)), delta(ult(acc), ant(acc)), "", chipMercado(R.acc))}${kpi("Completados", pc(ult(com)), delta(ult(com), ant(com)), "", chipMercado(R.com))}${kpi("Calificación", ult(rat).toFixed(2), "", "promedio")}${kpi("Solicitudes a soporte", pc(ult(sop)), delta(ult(sop), ant(sop), true), "de los viajes", chipMercado(R.sop))}</div>${linea(acc.map(v => v * 100), "#eb6834", 120, 520, { banda: [R.acc.p25 * 100, R.acc.p75 * 100] })}`)}
    ${card("Ingresos", `<div class="ppm-kpis ppm-kpis--3">${kpi("Facturación (GMV)", sol(sum(gm)), "", "en el rango")}${kpi("Tu comisión", sol(sum(cm)), "", "en el rango")}${kpi("Viajes", n0(sum(vj)), "", "en el rango")}</div>${linea(cm, "#a855f7")}`)}
    ${card("Flota propia <span class='ppm-chip'>solo subflotas Fleet</span>", `<div class="ppm-kpis ppm-kpis--4">${kpi("Autos activos", "312", delta(312, 305), "")}${kpi("Brandeados", "248", "", "79% de tus autos")}${kpi("Horas por auto", "96.4", delta(96.4, 99.1), "")}${kpi("Utilización", "71%", "", "meta 85%")}</div>`)}
    ${tablaMercado(f)}
  </div>`;
}
function subflotas(f: Fila[]): string {
  const k = ST.metrica, lbl: Record<string, string> = { ad: "Conductores activos", nuevos: "Nuevos", horas: "Horas", viajes: "Viajes", comision: "Comisión" };
  const tot = SUBS.filter(s => s.enTotal).reduce((a, s) => a + ult(serie(f, k, [s])), 0);
  const filas = SUBS.map(s => { const sr = serie(f, k, [s]), a = serie(f, "ad", [s]), h = serie(f, "horas", [s]);
    return `<tr class="${s.enTotal ? "" : "is-fuera"}"><td><i class="ppm-dot" style="background:${s.col}"></i><b>${e(s.nombre)}</b><small>${s.ciudad} · ${s.tipo}</small></td><td class="r">${n0(ult(a))} ${delta(ult(a), ant(a))}</td><td class="r">${n0(sum(serie(f, "nuevos", [s])) + sum(serie(f, "react", [s])))}</td><td class="r">${n0(sum(h))}</td><td class="r">${(ult(h) / ult(a)).toFixed(1)}</td><td class="r">${n0(sum(serie(f, "viajes", [s])))}</td><td class="r">${sol(sum(serie(f, "comision", [s])))}</td><td class="r">${s.enTotal ? pc(ult(sr) / tot, 0) : "—"}</td><td>${sr.length > 1 ? linea(sr, s.col, 34, 110).replace('class="ppm-svg"', 'class="ppm-spark"').replace(/<text[^>]*>[^<]*<\/text>/g, "") : ""}</td><td><button class="ppm-link" data-act="ppVerSub" data-v="${s.id}">Ver →</button></td></tr>`; }).join("");
  return `${card(`Composición por subflota · ${lbl[k]}`, `<div class="ppm-seg">${Object.entries(lbl).map(([v, l]) => `<button class="${k === v ? "is-on" : ""}" data-act="ppMetrica" data-v="${v}">${l}</button>`).join("")}</div>
      <div class="ppm-leg">${SUBS.filter(s => s.enTotal).map(s => `<span><i style="background:${s.col}"></i>${e(s.nombre)}</span>`).join("")}</div>${apiladas(f, k, SUBS.filter(s => s.enTotal))}`)}
    ${card(`Detalle por subflota · ${e(rangoTxt())}`, `<div class="ppm-tw"><table class="ppm-tbl"><thead><tr><th>Subflota</th><th class="r">Activos (${ultimoPer()})</th><th class="r">N+R</th><th class="r">Horas</th><th class="r">Horas/cond.</th><th class="r">Viajes</th><th class="r">Comisión</th><th class="r">% de tu flota</th><th>Tendencia</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
      <p class="ppm-mut">N+R, horas, viajes y comisión suman todo el rango; activos es la foto del período más reciente. Delivery y Cargo se muestran aparte y no suman al total (igual que en el reporte de tu KAM). "Ver →" abre Desempeño filtrado a esa subflota.</p>`)}`;
}
const GRUPOS: Record<string, [string, string[]]> = {
  base: ["Básicos", ["Fecha", "Ciudad", "Subflota", "Conductores activos", "Horas", "Viajes"]],
  adq: ["Adquisición", ["Nuevos (tuyos)", "Nuevos (Yango)", "Reactivados", "Nuevos a 50 viajes"]],
  cal: ["Calidad", ["Aceptación", "Completados", "Calificación", "Mal calificados", "Solicitudes a soporte"]],
  ing: ["Ingresos", ["GMV", "Comisión", "Ingreso por hora", "Tarifa promedio"]],
  flo: ["Flota propia", ["Autos activos", "Brandeados", "Horas internas", "Horas por auto"]]
};
function datosTab(f: Fila[]): string {
  const cols = [...ST.cols].flatMap(g => GRUPOS[g][1]);
  const ids = new Set(subsFiltradas().map(s => s.id).concat(ST.sub === "todas" ? SUBS.filter(s => !s.enTotal && (ST.ciudad === "todas" || s.ciudad === ST.ciudad)).map(s => s.id) : []));
  const enRango = new Set(rango());
  const todas = f.filter(r => ids.has(r.sub) && enRango.has(r.periodo));
  const filas = todas.slice(-8).reverse();
  const val = (r: Fila, c: string) => { const s = SUBS.find(x => x.id === r.sub)!;
    return ({ "Fecha": r.periodo, "Ciudad": s.ciudad, "Subflota": s.nombre, "Conductores activos": n0(r.ad), "Horas": n0(r.horas), "Viajes": n0(r.viajes), "Nuevos (tuyos)": n0(r.propios), "Nuevos (Yango)": n0(r.yango), "Reactivados": n0(r.react), "Nuevos a 50 viajes": n0(r.a50), "Aceptación": pc(r.acept), "Completados": pc(r.compl), "Calificación": r.rating.toFixed(2), "Solicitudes a soporte": pc(r.soporte), "GMV": n0(r.gmv), "Comisión": n0(r.comision), "Ingreso por hora": (r.gmv / r.horas).toFixed(1) } as Record<string, string>)[c] ?? "…"; };
  return card("Mis datos", `<p class="ppm-mut">Tus datos tal como los tenemos, por subflota y ${per()}, en el rango y los filtros de arriba. Solo ves y descargas lo de tu empresa.</p>
    <div class="ppm-dl"><div><span class="ppm-lbl">Columnas</span><div class="ppm-chips">${Object.entries(GRUPOS).map(([k, [l]]) => `<label class="ppm-ck"><input type="checkbox" data-act-change="ppCol" data-v="${k}"${ST.cols.has(k) ? " checked" : ""}> ${l}</label>`).join("")}</div></div>
      <div class="ppm-dl__btns"><button class="ui-btn ui-btn--secondary">${iconSvg("download", { size: 15 })} CSV</button><button class="ui-btn ui-btn--primary">${iconSvg("download", { size: 15 })} Excel (${n0(todas.length)} filas · ${e(rangoTxt())})</button></div></div>
    <div class="ppm-tw"><table class="ppm-tbl ppm-tbl--raw"><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${filas.map(r => `<tr>${cols.map(c => `<td>${e(val(r, c))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="ppm-mut">Vista previa de las últimas 8 filas. El archivo trae todo el rango. No incluye datos internos de Yango (KAM, clasificación interna, participación de mercado, subsidios).</p>`);
}

function filtros(): string {
  const P = PER[ST.esc], n = ST.hasta - ST.desde + 1;
  const opt = (sel: number, desdeMin = 0) => P.map((p, i) => `<option value="${i}"${i === sel ? " selected" : ""}${i < desdeMin ? " disabled" : ""}>${p}</option>`).join("");
  const subOpts = `<option value="todas">Todas (Taxi + TukTuk)</option>${SUBS.map(s => `<option value="${s.id}"${ST.sub === s.id ? " selected" : ""}>${e(s.nombre)}${s.enTotal ? "" : " · fuera del total"}</option>`).join("")}`;
  return `<div class="ppm-filtros">
    <div class="ppm-seg">${(["diario", "semanal", "mensual"] as Escala[]).map(x => `<button class="${ST.esc === x ? "is-on" : ""}" data-act="ppEsc" data-v="${x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join("")}</div>
    <div class="ppm-fecha"><span class="ppm-lbl">Desde</span><select class="ui-select ui-select--sm" data-act-change="ppDesde">${opt(ST.desde)}</select></div>
    <div class="ppm-fecha"><span class="ppm-lbl">Hasta</span><select class="ui-select ui-select--sm" data-act-change="ppHasta">${opt(ST.hasta, ST.desde)}</select></div>
    <div class="ppm-atajos">${ATAJOS[ST.esc].map(([l, k]) => { const on = (k >= P.length ? n === P.length : n === k) && ST.hasta === P.length - 1; return `<button class="${on ? "is-on" : ""}" data-act="ppAtajo" data-v="${k}">${l}</button>`; }).join("")}</div>
    <select class="ui-select ui-select--sm" data-act-change="ppCiudad"><option value="todas">Todas las ciudades</option>${["Lima", "Trujillo", "Arequipa"].map(c => `<option${ST.ciudad === c ? " selected" : ""}>${c}</option>`).join("")}</select>
    <select class="ui-select ui-select--sm" data-act-change="ppSub">${subOpts}</select>
    ${ST.tab === "datos" ? "" : `<button class="ui-btn ui-btn--secondary ppm-pdf">${iconSvg("download", { size: 14 })} PDF</button>`}
  </div>`;
}
function render(): void {
  const f = datos(ST.esc), r = document.getElementById("ppRoot")!, sy = r.scrollTop;
  const tabs: [Tab, string, string][] = [["resumen", "Resumen", "activity"], ["desempeno", "Desempeño", "chart-line"], ["subflotas", "Subflotas", "users"], ["datos", "Mis datos", "table"]];
  r.innerHTML = `<div class="ppm-shell">
    <header class="ppm-top"><div class="ppm-brand"><span class="ppm-logo">AM</span><div><b>ANDINA MOVILIDAD</b><small>Portal del partner · datos al 14 sep 2026</small></div></div>
      <span class="ppm-lock">${iconSvg("lock", { size: 13 })}Solo ves la información de tu empresa</span></header>
    <nav class="ppm-tabs">${tabs.map(([k, l, ic]) => `<button class="${ST.tab === k ? "is-on" : ""}" data-act="ppTab" data-v="${k}">${iconSvg(ic, { size: 15 })}${l}</button>`).join("")}</nav>
    ${filtros()}
    ${ST.tab === "resumen" ? resumen(f) : ST.tab === "desempeno" ? desempeno(f) : ST.tab === "subflotas" ? subflotas(f) : datosTab(f)}
  </div>`;
  r.scrollTop = sy;
}
function ponerEscala(x: Escala) { ST.esc = x; ST.hasta = PER[x].length - 1; ST.desde = Math.max(0, ST.hasta - DEF_N[x] + 1); }
export function mountPortal(): void {
  const root = document.createElement("div"); root.id = "ppRoot"; root.className = "ppm-root"; document.body.appendChild(root);
  registerActions({
    ppTab: (d: DOMStringMap) => { ST.tab = d.v as Tab; render(); },
    ppEsc: (d: DOMStringMap) => { ponerEscala(d.v as Escala); render(); },
    ppDesde: (_d: DOMStringMap, el: HTMLSelectElement) => { ST.desde = +el.value; if (ST.hasta < ST.desde) ST.hasta = ST.desde; render(); },
    ppHasta: (_d: DOMStringMap, el: HTMLSelectElement) => { ST.hasta = Math.max(+el.value, ST.desde); render(); },
    ppAtajo: (d: DOMStringMap) => { const L = PER[ST.esc].length; ST.hasta = L - 1; ST.desde = Math.max(0, L - Math.min(+d.v!, L)); render(); },
    ppSub: (_d: DOMStringMap, el: HTMLSelectElement) => { ST.sub = el.value; render(); },
    ppCiudad: (_d: DOMStringMap, el: HTMLSelectElement) => { ST.ciudad = el.value === "Todas las ciudades" ? "todas" : el.value; render(); },
    ppMetrica: (d: DOMStringMap) => { ST.metrica = d.v as keyof Fila; render(); },
    ppMercado: (d: DOMStringMap) => { ST.mercado = d.v!; render(); },
    ppVerSub: (d: DOMStringMap) => { ST.sub = d.v!; ST.tab = "desempeno"; render(); },
    ppCol: (d: DOMStringMap, el: HTMLInputElement) => { if (el.checked) ST.cols.add(d.v!); else ST.cols.delete(d.v!); render(); }
  });
  render();
}
