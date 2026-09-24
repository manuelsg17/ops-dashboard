// dev/proto/model.ts — Cálculos del prototipo ?ui=proto (SOLO desarrollo).
//
// Reproduce, sobre el fixture estático, las MISMAS lecturas que hace la app
// (último período = snapshot de Active Drivers; N+R/horas/viajes = acumulado del
// rango; avance contra la meta del mes con proyección AD = máx × 1.4 y flujos
// por ritmo del mes). No lee STATE ni toca la base: es un modelo de juguete para
// ver el diseño con números con forma real, no una segunda implementación.

import { FX } from "./fixture";
import { fmt, fmtSmart } from "../../core/format";

export const CIUDADES = ["LIMA", "TRUJILLO", "AREQUIPA"];
export const SIN_KAM = "Sin KAM";
export type Linea = "comb" | "agg" | "fleet" | "tk";
export type Kpi = "ad" | "nr" | "sh" | "tr";

export interface Fila {
  clid: string; partner: string; kam: string; city: string; week: string;
  tk: boolean; fleet: boolean;
  ad: number; nr: number; sh: number; tr: number; gmv: number;
  np: number; ns: number; re: number; oc: number; ish: number; acc: number; br: number; co: number;
}

export interface Filtros {
  escala: "diario" | "semanal" | "mensual";
  desde: string; hasta: string;
  ciudad: string;          // "all" | LIMA…
  kam: string;             // "all" | Ana…
  buscar: string;
  sel: Set<string>;        // partners marcados en el panel
}

// ── Partners: nombre y KAM (partners → flotas → Sin KAM) ────────────────────
const _P = new Map<string, { name: string; kam: string; fleet: boolean; tuktuk: boolean; alta: boolean }>();
for (const p of FX.partners) _P.set(p.clid, { name: p.name, kam: p.kam || SIN_KAM, fleet: !!p.fleet, tuktuk: !!p.tuktuk, alta: true });
for (const [clid, nombre, kam] of FX.flotas) {
  if (!_P.has(clid)) _P.set(clid, { name: nombre || clid, kam: kam || SIN_KAM, fleet: false, tuktuk: false, alta: false });
}
export const partnerDe = (clid: string) => _P.get(clid) || { name: clid, kam: SIN_KAM, fleet: false, tuktuk: false, alta: false };

export const FILAS: Fila[] = FX.rows.map(r => {
  const p = partnerDe(r[0]);
  return {
    clid: r[0], city: r[1], week: r[2], tk: r[3] === "tk", fleet: !!r[4], partner: p.name, kam: p.kam,
    ad: r[5], nr: r[6], sh: +r[7], tr: r[8], gmv: +r[9], np: r[10], ns: r[11], re: r[12], oc: r[13], ish: +r[14], acc: +r[15], br: r[16], co: +r[17]
  };
});

export const SEMANAS: string[] = [...new Set(FILAS.map(f => f.week))].sort();
export const PARTNERS: string[] = [...new Set(FILAS.map(f => f.partner))].sort((a, b) => a.localeCompare(b));
export const KAM_DE_PARTNER = new Map<string, string>();
FILAS.forEach(f => KAM_DE_PARTNER.set(f.partner, f.kam));
export const KAMS: string[] = [...new Set(FILAS.map(f => f.kam))].filter(k => k !== SIN_KAM).sort();
export const KAMS_CON_SIN = [...KAMS, SIN_KAM];
export const partnersDeKam = (k: string) => PARTNERS.filter(p => KAM_DE_PARTNER.get(p) === k);

// ── Fechas ──────────────────────────────────────────────────────────────────
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const _d = (s: string) => new Date(s + "T00:00:00Z");
const _iso = (d: Date) => d.toISOString().slice(0, 10);
export const finSemana = (w: string) => { const d = _d(w); d.setUTCDate(d.getUTCDate() + 6); return _iso(d); };
/** Mes al que pertenece una semana: el de su domingo (como la app). */
export const mesDeSemana = (w: string) => finSemana(w).slice(0, 7);
export const d2s = (s: string) => s ? s.split("-").reverse().join("/") : "—";
export const mesNombre = (ym: string, cap = true) => {
  const n = MESES[+ym.slice(5, 7) - 1] || "";
  return cap ? n.charAt(0).toUpperCase() + n.slice(1) : n;
};
export const mesLargo = (ym: string) => `${mesNombre(ym)} ${ym.slice(0, 4)}`;
export const mesCorto = (ym: string) => mesNombre(ym, false).slice(0, 3);
const _diasMes = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();

export const cityLabel = (c: string) => c.charAt(0) + c.slice(1).toLowerCase();
export const pct1 = (v: number | null) => v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
export const signo = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
export const varPct = (c: number, p: number) => p ? ((c - p) / p) * 100 : null;
export const fmtKpi = (k: Kpi | string, v: number | null) => v == null ? "—" : (k === "sh" || k === "tr") && Math.abs(v) >= 100000 ? fmtSmart(v) : fmt(v);
export const fmtK$ = (n: number) => "$" + (n / 1000).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "K";

// ── Filtros ─────────────────────────────────────────────────────────────────
export function filtrosPorDefecto(): Filtros {
  return { escala: "semanal", desde: SEMANAS[1], hasta: SEMANAS[SEMANAS.length - 1], ciudad: "all", kam: "all", buscar: "", sel: new Set(PARTNERS) };
}
export function enLinea(f: Fila, l: Linea) {
  return l === "comb" ? true : l === "agg" ? !f.tk : l === "tk" ? f.tk : f.fleet;
}
export function filtrar(l: Linea, F: Filtros, semanas?: string[]) {
  const ws = semanas ? new Set(semanas) : null;
  return FILAS.filter(f => enLinea(f, l) && (!ws || ws.has(f.week)) &&
    (F.ciudad === "all" || f.city === F.ciudad) && (F.kam === "all" || f.kam === F.kam) && F.sel.has(f.partner));
}
export const semanasRango = (F: Filtros) => SEMANAS.filter(w => w >= F.desde && w <= F.hasta);

const sum = (rs: Fila[], k: keyof Fila) => rs.reduce((s, r) => s + (+r[k] || 0), 0);
export const sumK = sum;

// ── Metas ───────────────────────────────────────────────────────────────────
const _MES_NUM: Record<string, string> = { ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04", MAYO: "05", JUNIO: "06", JULIO: "07", AGOSTO: "08", SEPTIEMBRE: "09", OCTUBRE: "10", NOVIEMBRE: "11", DICIEMBRE: "12" };
export interface Meta { clid: string; city: string; ym: string; ad: number | null; nr: number | null; sh: number | null; tkAd: number | null; tkNr: number | null; tkSh: number | null; shAuto: number | null; acc: number | null; util: number | null }
export const METAS: Meta[] = FX.metas.map(m => ({
  clid: m[0], city: m[1], ym: `${m[3]}-${_MES_NUM[m[2]]}`,
  ad: m[4], nr: m[5], sh: m[6], tkAd: m[7], tkNr: m[8], tkSh: m[9], shAuto: m[10], acc: m[11], util: m[12]
}));
/** Meta de un KPI para la línea (Combinado = paraguas; Agregador = paraguas − TukTuk). */
export function metaLinea(m: Meta, l: Linea, k: "ad" | "nr" | "sh"): number | null {
  const um = m[k], tk = m[("tk" + k.charAt(0).toUpperCase() + k.slice(1)) as "tkAd"];
  if (l === "comb") return um;
  if (l === "tk") return tk;
  if (l === "agg") return um == null ? null : um - (tk || 0);
  return null;
}
export const metasDelMes = (ym: string) => METAS.filter(m => m.ym === ym);
export const MESES_META = [...new Set(METAS.map(m => m.ym))].sort().reverse();

// ── Avance del mes (lo que muestran la tarjeta de Rendimiento y Metas) ─────
export interface Avance { ym: string; actual: number; meta: number; pct: number | null; proj: number; projPct: number | null; nPer: number; nTot: number }
export function avanceMes(l: Linea, F: Filtros, ym: string, k: "ad" | "nr" | "sh", unidades?: Set<string>): Avance | null {
  const semMes = semanasRango(F).filter(w => mesDeSemana(w) === ym);
  const tot = SEMANAS.filter(w => mesDeSemana(w) === ym).length;
  if (!semMes.length) return null;
  const rows = filtrar(l, F, semMes).filter(r => !unidades || unidades.has(r.partner + "@" + r.city));
  const porSem = semMes.map(w => sum(rows.filter(r => r.week === w), k));
  const ult = semMes[semMes.length - 1];
  const actual = k === "ad" ? porSem[porSem.length - 1] : porSem.reduce((a, b) => a + b, 0);
  const idx = new Set(rows.map(r => r.clid + "@" + r.city));
  let meta = 0;
  for (const m of metasDelMes(ym)) {
    const p = partnerDe(m.clid);
    if (F.ciudad !== "all" && m.city !== F.ciudad) continue;
    if (F.kam !== "all" && p.kam !== F.kam) continue;
    if (!F.sel.has(p.name)) continue;
    if (unidades && !unidades.has(p.name + "@" + m.city)) continue;
    const v = metaLinea(m, l, k);
    if (v != null && (v > 0 || idx.has(m.clid + "@" + m.city))) meta += v;
  }
  const dias = +finSemana(ult).slice(8, 10);
  const proj = k === "ad" ? Math.max(...porSem) * 1.4 : actual * _diasMes(ym) / Math.min(dias, _diasMes(ym));
  return { ym, actual, meta, pct: meta ? actual / meta * 100 : null, proj, projPct: meta ? proj / meta * 100 : null, nPer: semMes.length, nTot: tot };
}
export function captionAvance(k: "ad" | "nr" | "sh", a: Avance | null): string {
  if (!a || !a.meta) return "Sin meta mensual";
  const f = (v: number) => k === "sh" ? fmtSmart(v) : fmt(Math.round(v));
  const pre = k === "ad" ? `${mesNombre(a.ym)}, nivel actual: ` : `${mesNombre(a.ym)}: `;
  return `${pre}${f(a.actual)} de ${f(a.meta)} · ${pct1(a.pct)} · proyección ${pct1(a.projPct)}`;
}

// ── Rendimiento ─────────────────────────────────────────────────────────────
export function modeloRend(l: Linea, F: Filtros) {
  const ws = semanasRango(F);
  const L = ws[ws.length - 1];
  const P = SEMANAS[SEMANAS.indexOf(L) - 1] || "";
  const rango = filtrar(l, F, ws);
  const last = rango.filter(r => r.week === L);
  const prev = P ? filtrar(l, F, [P]) : [];
  const nrOf = (rs: Fila[]) => sum(rs, "nr");
  const k = {
    ad: { v: sum(last, "ad"), c: sum(last, "ad"), p: sum(prev, "ad") },
    nr: { v: nrOf(rango), c: nrOf(last), p: nrOf(prev) },
    sh: { v: sum(rango, "sh"), c: sum(last, "sh"), p: sum(prev, "sh") },
    tr: { v: sum(rango, "tr"), c: sum(last, "tr"), p: sum(prev, "tr") }
  };
  const ym = L ? mesDeSemana(L) : "";
  const av = { ad: avanceMes(l, F, ym, "ad"), nr: avanceMes(l, F, ym, "nr"), sh: avanceMes(l, F, ym, "sh") };
  const ciudades = CIUDADES.map(c => {
    const a = last.filter(r => r.city === c), b = prev.filter(r => r.city === c);
    return { city: c, ad: sum(a, "ad"), nr: sum(a, "nr"), sh: sum(a, "sh"), tr: sum(a, "tr"), pad: sum(b, "ad"), pnr: sum(b, "nr"), psh: sum(b, "sh"), ptr: sum(b, "tr") };
  }).filter(c => c.ad || c.pad).sort((a, b) => b.ad - a.ad);
  // Por partner
  const porP = new Map<string, { partner: string; kam: string; ad: number; nr: number; sh: number; tr: number; co: number; ns: number; pad: number; serie: number[] }>();
  const get = (p: string) => { let o = porP.get(p); if (!o) { o = { partner: p, kam: KAM_DE_PARTNER.get(p) || SIN_KAM, ad: 0, nr: 0, sh: 0, tr: 0, co: 0, ns: 0, pad: 0, serie: ws.map(() => 0) }; porP.set(p, o); } return o; };
  last.forEach(r => { const o = get(r.partner); o.ad += r.ad; o.nr += r.nr; o.sh += r.sh; o.tr += r.tr; o.co += r.co; o.ns += r.ns; });
  prev.forEach(r => { get(r.partner).pad += r.ad; });
  rango.forEach(r => { get(r.partner).serie[ws.indexOf(r.week)] += r.ad; });
  const partners = [...porP.values()];
  const movers = partners.filter(p => p.pad > 0).map(p => ({ partner: p.partner, delta: p.ad - p.pad, pct: (p.ad - p.pad) / p.pad * 100 }));
  const suben = movers.filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const bajan = movers.filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
  // Por KAM
  const kams = KAMS_CON_SIN.map(kk => {
    const a = last.filter(r => r.kam === kk), b = prev.filter(r => r.kam === kk), g = rango.filter(r => r.kam === kk);
    return { kam: kk, ad: sum(a, "ad"), nr: sum(a, "nr"), sh: sum(a, "sh"), tr: sum(a, "tr"),
      pad: sum(b, "ad"), pnr: sum(b, "nr"), psh: sum(b, "sh"), ptr: sum(b, "tr"),
      gnr: sum(g, "nr"), gsh: sum(g, "sh"), gtr: sum(g, "tr") };
  }).filter(x => x.ad || x.gnr).sort((a, b) => b.gnr - a.gnr);
  const prod = (rs: Fila[]) => { const ad = sum(rs, "ad"), sh = sum(rs, "sh"), tr = sum(rs, "tr"); return { shAd: ad ? sh / ad : 0, trAd: ad ? tr / ad : 0, trSh: sh ? tr / sh : 0 }; };
  // Series
  const top = partners.slice().sort((a, b) => b.ad - a.ad).slice(0, 8).map(p => p.partner);
  const serieDe = (rs: Fila[], kk: Kpi) => ws.map(w => rs.filter(r => r.week === w).reduce((s, r) => s + (r[kk] || 0), 0));
  const series = (kk: Kpi) => top.map(p => ({ name: p, data: serieDe(rango.filter(r => r.partner === p), kk) }));
  const restoPie = (kk: Kpi) => {
    const topS = new Set(top);
    const resto = rango.filter(r => r.week === L && !topS.has(r.partner)).reduce((s, r) => s + (r[kk] || 0), 0);
    return partners.length <= top.length ? `Todos los partners (${partners.length})` :
      `${top.length} de ${partners.length} partners, los más grandes en conductores activos. El resto suma ${kk === "tr" || kk === "sh" ? fmtSmart(resto) : fmt(resto)} en la última semana.`;
  };
  const ciudadSerie = (kk: Kpi) => CIUDADES.filter(c => rango.some(r => r.city === c)).map(c => ({ city: c, data: serieDe(rango.filter(r => r.city === c), kk) }));
  // Fleet
  const fleetK = (rs: Fila[]) => {
    const oc = sum(rs, "oc"), ish = sum(rs, "ish"), tr = sum(rs, "tr"), br = sum(rs, "br");
    const acc = tr ? rs.reduce((s, r) => s + r.acc * r.tr, 0) / tr * 100 : null;
    return { oc, shCar: oc ? ish / oc : null, acc, br };
  };
  return { ws, L, P, ym, k, av, ciudades, partners, suben, bajan, kams, prodL: prod(last), prodP: prod(prev), top, series, restoPie, ciudadSerie,
    fleetL: fleetK(last), fleetP: fleetK(prev), fleetSerie: (kk: "oc" | "shCar") => ws.map(w => { const f = fleetK(rango.filter(r => r.week === w)); return kk === "oc" ? f.oc : f.shCar; }),
    serieTotal: (kk: Kpi) => serieDe(rango, kk) };
}
export type ModeloRend = ReturnType<typeof modeloRend>;

// ── Metas ───────────────────────────────────────────────────────────────────
export interface UnidadMeta {
  key: string; partner: string; city: string; kam: string; sinMeta: boolean;
  act: Record<"ad" | "nr" | "sh", number>; meta: Record<"ad" | "nr" | "sh", number | null>; pct: Record<"ad" | "nr" | "sh", number | null>;
  estado: "bajo" | "en" | "sobre" | "sin"; peor: number | null;
}
export function modeloMetas(l: Linea, F: Filtros, ym: string) {
  const semMes = semanasRango(F).filter(w => mesDeSemana(w) === ym);
  const ult = semMes[semMes.length - 1];
  const rows = filtrar(l === "fleet" ? "comb" : l, F, semMes);
  const U = new Map<string, UnidadMeta>();
  const nueva = (partner: string, city: string, kam: string): UnidadMeta => ({ key: partner + "@" + city, partner, city, kam, sinMeta: true,
    act: { ad: 0, nr: 0, sh: 0 }, meta: { ad: null, nr: null, sh: null }, pct: { ad: null, nr: null, sh: null }, estado: "sin", peor: null });
  for (const m of metasDelMes(ym)) {
    const p = partnerDe(m.clid);
    if ((F.ciudad !== "all" && m.city !== F.ciudad) || (F.kam !== "all" && p.kam !== F.kam) || !F.sel.has(p.name)) continue;
    const vals = { ad: metaLinea(m, l, "ad"), nr: metaLinea(m, l, "nr"), sh: metaLinea(m, l, "sh") };
    if (!((vals.ad || 0) > 0 || (vals.nr || 0) > 0 || (vals.sh || 0) > 0)) continue;   // "tener meta" = >0
    const key = p.name + "@" + m.city;
    const u = U.get(key) || nueva(p.name, m.city, p.kam);
    u.sinMeta = false;
    (["ad", "nr", "sh"] as const).forEach(k => { if (vals[k] != null) u.meta[k] = (u.meta[k] || 0) + (vals[k] as number); });
    U.set(key, u);
  }
  for (const r of rows) {
    const key = r.partner + "@" + r.city;
    const u = U.get(key) || nueva(r.partner, r.city, r.kam);
    if (r.week === ult) u.act.ad += r.ad;
    u.act.nr += r.nr; u.act.sh += r.sh;
    U.set(key, u);
  }
  const unidades = [...U.values()];
  unidades.forEach(u => {
    (["ad", "nr", "sh"] as const).forEach(k => { u.pct[k] = u.meta[k] ? u.act[k] / (u.meta[k] as number) * 100 : null; });
    const ps = (["ad", "nr", "sh"] as const).map(k => u.pct[k]).filter(v => v != null) as number[];
    u.peor = ps.length ? Math.min(...ps) : null;
    u.estado = u.sinMeta ? "sin" : ps.some(v => v < 95) ? "bajo" : ps.every(v => v >= 100) ? "sobre" : "en";
  });
  const grupo = (keyFn: (u: UnidadMeta) => string, orden: string[]) => orden.map(g => {
    const us = unidades.filter(u => keyFn(u) === g);
    if (!us.length) return null;
    const set = new Set(us.map(u => u.key));
    const kp = (["ad", "nr", "sh"] as const).map(k => ({ k, ...(avanceMes(l === "fleet" ? "comb" : l, F, ym, k, set) || { actual: 0, meta: 0, pct: null, proj: 0, projPct: null }) }));
    return { g, n: us.length, kp };
  }).filter(Boolean);
  const pais = (["ad", "nr", "sh"] as const).map(k => ({ k, a: avanceMes(l === "fleet" ? "comb" : l, F, ym, k) }));
  // Delta "vs mes anterior al mismo punto"
  const ymPrev = (() => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); })();
  const semPrev = SEMANAS.filter(w => mesDeSemana(w) === ymPrev).slice(0, semMes.length);
  const rPrev = filtrar(l === "fleet" ? "comb" : l, F, semPrev);
  const deltaPais = {
    ad: semPrev.length ? varPct(sum(rows.filter(r => r.week === ult), "ad"), sum(rPrev.filter(r => r.week === semPrev[semPrev.length - 1]), "ad")) : null,
    nr: semPrev.length ? varPct(sum(rows, "nr"), sum(rPrev, "nr")) : null,
    sh: semPrev.length ? varPct(sum(rows, "sh"), sum(rPrev, "sh")) : null
  };
  return {
    ym, ymPrev, semMes, ult, unidades, pais, deltaPais,
    ciudades: grupo(u => u.city, CIUDADES), kams: grupo(u => u.kam, KAMS_CON_SIN),
    nSinMeta: unidades.filter(u => u.sinMeta).length
  };
}
export type ModeloMetas = ReturnType<typeof modeloMetas>;

// ── Calculadora: base del reparto (agosto) ─────────────────────────────────
export interface UnidadCalc { key: string; partner: string; city: string; clid: string; fleet: boolean; tieneMeta: boolean; base: Record<"ad" | "nr" | "sh", number>; tk: Record<"ad" | "nr" | "sh", number>; semanas: number[] }
export function unidadesCalc(kam: string, ymBase = "2026-08", ymMeta = "2026-09"): UnidadCalc[] {
  const U = new Map<string, UnidadCalc>();
  const fleetClids = new Set(FILAS.filter(f => f.fleet).map(f => f.clid));
  for (const [clid, city, mes, ad, nr, sh, esTk] of FX.mensual) {
    if (mes !== ymBase) continue;
    const p = partnerDe(clid);
    if (p.kam !== kam) continue;
    const key = p.name + "@" + city;
    const u = U.get(key) || { key, partner: p.name, city, clid, fleet: fleetClids.has(clid) || p.fleet, tieneMeta: false, base: { ad: 0, nr: 0, sh: 0 }, tk: { ad: 0, nr: 0, sh: 0 }, semanas: [] };
    u.base.ad += ad; u.base.nr += nr; u.base.sh += +sh;
    if (esTk) { u.tk.ad += ad; u.tk.nr += nr; u.tk.sh += +sh; }
    U.set(key, u);
  }
  const conMeta = new Set(metasDelMes(ymMeta).filter(m => (m.ad || 0) > 0).map(m => m.clid + "@" + m.city));
  const us = [...U.values()];
  us.forEach(u => {
    u.tieneMeta = conMeta.has(u.clid + "@" + u.city);
    u.semanas = SEMANAS.map(w => FILAS.filter(f => f.clid === u.clid && f.city === u.city && f.week === w).reduce((s, f) => s + f.ad, 0));
  });
  return us.sort((a, b) => b.base.ad - a.base.ad);
}
/** Reparto proporcional con las filas fijadas a mano; resto mayor para que cuadre exacto. */
export function repartir(goal: number, bases: number[], fijos: (number | null)[]): number[] {
  const fijado = fijos.reduce((s, v) => s + (v ?? 0), 0);
  const libres = bases.map((b, i) => fijos[i] == null ? b : 0);
  const totLib = libres.reduce((a, b) => a + b, 0);
  const resto = Math.max(0, goal - fijado);
  const crudo = libres.map(b => totLib ? resto * b / totLib : 0);
  const out = crudo.map(Math.floor);
  let falta = Math.round(resto) - out.reduce((a, b) => a + b, 0);
  const orden = crudo.map((v, i) => ({ i, f: v - Math.floor(v) })).filter(x => fijos[x.i] == null && libres[x.i] > 0).sort((a, b) => b.f - a.f);
  for (let j = 0; falta > 0 && orden.length; j = (j + 1) % orden.length, falta--) out[orden[j].i]++;
  return out.map((v, i) => fijos[i] ?? v);
}

// ── Configuración ───────────────────────────────────────────────────────────
export interface FilaMaestro { clid: string; nombre: string; kam: string; ciudades: string[]; alta: boolean; sinKam: boolean; subflotas: number; fleet: boolean; tuktuk: boolean; activo: boolean }
export function filasMaestro(): FilaMaestro[] {
  const clids = new Set<string>([...FX.partners.map(p => p.clid), ...FX.flotas.map(f => f[0]), ...FILAS.map(f => f.clid)]);
  const flot = new Map(FX.flotas.map(f => [f[0], f]));
  return [...clids].map(clid => {
    const p = partnerDe(clid);
    const subs = FX.fleetrooms.filter(r => r[1] === clid);
    const fl: any = flot.get(clid);
    return {
      clid, nombre: p.name, kam: p.kam === SIN_KAM ? "" : p.kam,
      ciudades: [...new Set(FILAS.filter(f => f.clid === clid).map(f => f.city))].sort().map(cityLabel),
      alta: p.alta, sinKam: p.kam === SIN_KAM, subflotas: subs.length,
      fleet: subs.some(s => s[4]) || p.fleet, tuktuk: subs.some(s => s[5]) || p.tuktuk, activo: !fl || fl[4] !== false
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
export const FLEETROOMS = FX.fleetrooms.map(r => ({ dbId: r[0], clid: r[1], nombre: r[2], city: r[3], fleet: !!r[4], tuktuk: !!r[5], delivery: !!r[6], cargo: !!r[7], excluir: !!r[8] }));

export const USUARIOS = [
  { email: "admin@local.test", rol: "admin", kam: null, acceso: "hace 2 horas", tono: "ok", alta: "02/06/2026", yo: true },
  { email: "kam@local.test", rol: "kam", kam: "Ana", acceso: "hace 25 minutos", tono: "ok", alta: "02/06/2026" },
  { email: "beto.kam@local.test", rol: "kam", kam: "Beto", acceso: "hace 3 días", tono: "ok", alta: "15/07/2026" },
  { email: "carla.kam@local.test", rol: "kam", kam: "", acceso: "hace 12 días", tono: "warn", alta: "15/07/2026" },
  { email: "viewer@local.test", rol: "viewer", kam: null, acceso: "hace 41 días", tono: "bad", alta: "02/06/2026" },
  { email: "partner@local.test", rol: "partner", kam: null, acceso: "Nunca ingresó", tono: "bad", alta: "02/06/2026", clids: ["900000000001"] }
];
