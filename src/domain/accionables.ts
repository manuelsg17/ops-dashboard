// domain/accionables.ts — recomendaciones automáticas sobre los datos de
// Desempeño (EXPERIMENTAL, pedido de Manuel 30-sep-2026: "algo que mi gerente
// vea y que, gracias a la data que tenemos, nos recomiende accionables en el
// mercado, por partner o por KAM").
//
// Son REGLAS explícitas, no un modelo: cada accionable dice qué dato lo
// dispara (params) para que se pueda auditar y descartar. Se ordenan por
// IMPACTO medido en conductores (o conductores equivalentes), así lo de arriba
// es lo que más mueve la aguja.
//
// Puro: sin STATE ni DOM. La vista traduce `tipo` + `params` a texto.

export type K3 = { ad: number | null; nr: number | null; sh: number | null };

export interface PartnerIn {
  partner: string;
  kam: string;
  ad: number; pad: number;          // conductores activos: período y anterior
  nr: number; pnr: number;          // nuevos + reactivados
  re: number; pre: number;          // reactivados
  sh: number; psh: number;          // horas de conexión
  ns: number;                       // nuevos que vienen del servicio (leads Yango)
  perdidos: number;
  retencion: number | null;         // 0..1
  eva?: K3 | null;                  // % esperado al cierre (proyección o ritmo)
  /** N+R contra la meta del mes (Combinado/TukTuk con meta). */
  nrMeta?: { meta: number; actual: number } | null;
  declive?: boolean;
}
export interface CiudadIn { city: string; evaNr: number | null; faltaNr: number | null }
export interface MercadoIn {
  retencion: number | null;
  retencionPrev: number | null;
  entran: number;                   // nuevos + reactivados + intermitentes
  perdidos: number;
  serieRe: number[];                // reactivados por período, del más viejo al último
  ciudades: CiudadIn[];
}
export type Nivel = "mercado" | "kam" | "partner";
export interface Accionable {
  nivel: Nivel;
  tipo: string;
  sujeto: string;
  kam?: string;
  impacto: number;
  prioridad: "alta" | "media";
  params: Record<string, number | string>;
}

// Umbrales (a la vista para poder discutirlos).
export const UMBRAL = {
  bajoMeta: 95,          // % esperado al cierre por debajo del cual hay brecha
  metaCritica: 80,
  faltaMin: 10,          // N+R mínimos que tienen que faltar para avisar
  retGap: 0.03,          // retención 3 pp bajo el país
  retGapAlta: 0.06,
  perdidosMin: 15,
  baseMin: 150,          // AD previo mínimo para reglas de proporción
  reactFactor: 0.5,      // reactiva menos de la mitad que el país
  leadsAdMin: 300,
  horasCaida: 0.08,      // horas por conductor −8%
  replicarCrec: 0.2,     // N+R +20%
  concentracion: 0.6,    // 3 partners explican ≥60% de la brecha del KAM
  retCaeMercado: 0.015,
  maxPorPartner: 2
};

const pct1 = (v: number) => Math.round(v * 1000) / 10;
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + (f(x) || 0), 0);

export function generarAccionables(opts: {
  partners: PartnerIn[];
  mercado: MercadoIn;
  semanasRestantes: number;
  semanasTranscurridas?: number;
}): { mercado: Accionable[]; kam: Accionable[]; partner: Accionable[] } {
  const { partners, mercado } = opts;
  const semRest = Math.max(opts.semanasRestantes || 0, 1);
  const semTrans = Math.max(opts.semanasTranscurridas || 0, 1);
  // Brecha de N+R AL CIERRE (meta − lo que proyecta): es la que ordena y la
  // que se reparte por KAM. "Faltan en el mes" (meta − actual) va al texto.
  const brechaCierre = (p: PartnerIn) => {
    const ev = p.eva?.nr, m = p.nrMeta;
    if (ev == null || !m || !(m.meta > 0)) return 0;
    return Math.max(Math.round(m.meta * (1 - ev / 100)), 0);
  };
  const out: Accionable[] = [];
  const baseTot = sum(partners, p => p.pad);
  const tasaRePais = baseTot > 0 ? sum(partners, p => p.re) / baseTot : 0;
  const adTot = sum(partners, p => p.ad);
  const leadsPais = adTot > 0 ? sum(partners, p => p.ns) / adTot : 0;
  const horasCondPais = adTot > 0 ? sum(partners, p => p.sh) / adTot : 0;
  const retPais = mercado.retencion;

  // ── Partner ────────────────────────────────────────────────────────────
  for (const p of partners) {
    const base = { nivel: "partner" as const, sujeto: p.partner, kam: p.kam };
    const evNr = p.eva?.nr, bc = brechaCierre(p);
    if (evNr != null && evNr < UMBRAL.bajoMeta && bc >= UMBRAL.faltaMin && p.nrMeta) {
      const faltaMes = Math.max(p.nrMeta.meta - p.nrMeta.actual, 0);
      out.push({ ...base, tipo: "brecha_nr", impacto: bc, prioridad: evNr < UMBRAL.metaCritica ? "alta" : "media",
        params: { falta: Math.round(faltaMes), pct: Math.round(evNr * 10) / 10, porSem: Math.ceil(faltaMes / semRest),
                  ritmo: Math.round(p.nrMeta.actual / semTrans), cierre: Math.round(bc) } });
    }
    let fuga = false;
    if (p.retencion != null && retPais != null && p.pad >= 100 && p.perdidos >= UMBRAL.perdidosMin
        && p.retencion < retPais - UMBRAL.retGap) {
      const esperados = p.pad * (1 - retPais);
      fuga = true;
      out.push({ ...base, tipo: "fuga", impacto: Math.max(p.perdidos - esperados, 0),
        prioridad: p.retencion < retPais - UMBRAL.retGapAlta ? "alta" : "media",
        params: { perdidos: p.perdidos, ret: pct1(p.retencion), retPais: pct1(retPais), extra: Math.round(p.perdidos - esperados) } });
    }
    if (p.pad >= UMBRAL.baseMin && tasaRePais > 0) {
      const tasa = p.re / p.pad;
      if (tasa < tasaRePais * UMBRAL.reactFactor) {
        const potencial = Math.round((tasaRePais - tasa) * p.pad);
        if (potencial >= 5) out.push({ ...base, tipo: "reactivar", impacto: potencial, prioridad: "media",
          params: { re: p.re, tasa: pct1(tasa), tasaPais: pct1(tasaRePais), potencial } });
      }
    }
    if (p.ns === 0 && p.ad >= UMBRAL.leadsAdMin && leadsPais > 0) {
      out.push({ ...base, tipo: "sin_leads", impacto: Math.round(p.ad * leadsPais), prioridad: "media",
        params: { ad: p.ad, potencial: Math.round(p.ad * leadsPais) } });
    }
    // Si ya salió por fuga, el declive dice lo mismo con otras palabras.
    if (p.declive && !fuga) {
      out.push({ ...base, tipo: "declive", impacto: Math.max(p.pad - p.ad, 1), prioridad: p.pad - p.ad > 50 ? "alta" : "media",
        params: { caida: Math.max(p.pad - p.ad, 0) } });
    }
    if (p.pad >= UMBRAL.baseMin && p.ad > 0 && p.psh > 0 && horasCondPais > 0) {
      const hNow = p.sh / p.ad, hPrev = p.psh / p.pad;
      if (hNow < hPrev * (1 - UMBRAL.horasCaida)) {
        out.push({ ...base, tipo: "horas", impacto: Math.round((hPrev - hNow) * p.ad / horasCondPais), prioridad: "media",
          params: { hNow: Math.round(hNow * 10) / 10, hPrev: Math.round(hPrev * 10) / 10, caida: pct1(1 - hNow / hPrev) } });
      }
    }
    if (p.pnr >= 10 && p.nr > p.pnr * (1 + UMBRAL.replicarCrec) && (retPais == null || (p.retencion ?? 0) >= retPais)) {
      out.push({ ...base, tipo: "replicar", impacto: p.nr - p.pnr, prioridad: "media",
        params: { nr: p.nr, crec: pct1(p.nr / p.pnr - 1) } });
    }
  }
  // Máximo por partner (lo de más impacto) para que uno solo no llene la lista.
  const porP = new Map<string, number>();
  const partnerAcc = out.sort((a, b) => b.impacto - a.impacto).filter(a => {
    const n = porP.get(a.sujeto) || 0;
    if (n >= UMBRAL.maxPorPartner) return false;
    porP.set(a.sujeto, n + 1);
    return true;
  });

  // ── KAM ────────────────────────────────────────────────────────────────
  const kamAcc: Accionable[] = [];
  const porKam = new Map<string, PartnerIn[]>();
  partners.forEach(p => { const a = porKam.get(p.kam) || []; a.push(p); porKam.set(p.kam, a); });
  porKam.forEach((ps, kam) => {
    const conBrecha = ps.filter(p => (p.eva?.nr ?? 999) < UMBRAL.bajoMeta && brechaCierre(p) > 0)
      .sort((a, b) => brechaCierre(b) - brechaCierre(a));
    const total = sum(conBrecha, brechaCierre);
    if (conBrecha.length >= 2 && total >= 30) {
      const top = conBrecha.slice(0, 3);
      const share = sum(top, brechaCierre) / total;
      if (share >= UMBRAL.concentracion) kamAcc.push({ nivel: "kam", tipo: "kam_concentracion", sujeto: kam, kam,
        impacto: total, prioridad: "alta",
        params: { share: Math.round(share * 100), falta: Math.round(total), lista: top.map(p => p.partner).join(", "), n: top.length } });
      else kamAcc.push({ nivel: "kam", tipo: "kam_brecha", sujeto: kam, kam, impacto: total, prioridad: "media",
        params: { falta: Math.round(total), n: conBrecha.length } });
    }
    const base = sum(ps, p => p.retencion == null ? 0 : p.pad);
    if (retPais != null && base >= 200) {
      const ret = sum(ps, p => p.retencion == null ? 0 : p.retencion * p.pad) / base;
      if (ret < retPais - 0.02) kamAcc.push({ nivel: "kam", tipo: "kam_retencion", sujeto: kam, kam,
        impacto: Math.round((retPais - ret) * base), prioridad: ret < retPais - UMBRAL.retGapAlta ? "alta" : "media",
        params: { ret: pct1(ret), retPais: pct1(retPais), extra: Math.round((retPais - ret) * base) } });
    }
    const pad = sum(ps, p => p.pad);
    if (pad >= 300 && tasaRePais > 0) {
      const tasa = sum(ps, p => p.re) / pad;
      if (tasa < tasaRePais * 0.7) kamAcc.push({ nivel: "kam", tipo: "kam_reactivar", sujeto: kam, kam,
        impacto: Math.round((tasaRePais - tasa) * pad), prioridad: "media",
        params: { tasa: pct1(tasa), tasaPais: pct1(tasaRePais), potencial: Math.round((tasaRePais - tasa) * pad) } });
    }
  });
  kamAcc.sort((a, b) => b.impacto - a.impacto);

  // ── Mercado ────────────────────────────────────────────────────────────
  const merc: Accionable[] = [];
  const s = mercado.serieRe.filter(v => Number.isFinite(v));
  if (s.length >= 3) {
    const [a, b, c] = s.slice(-3);
    if (a > b && b > c) merc.push({ nivel: "mercado", tipo: "re_cae", sujeto: "", impacto: a - c, prioridad: (a - c) / a > 0.1 ? "alta" : "media",
      params: { a, b, c, caida: pct1(1 - c / a) } });
  }
  if (mercado.perdidos > mercado.entran && mercado.entran >= 0) {
    merc.push({ nivel: "mercado", tipo: "base_cae", sujeto: "", impacto: mercado.perdidos - mercado.entran, prioridad: "alta",
      params: { perdidos: mercado.perdidos, entran: mercado.entran, neto: mercado.perdidos - mercado.entran } });
  }
  if (mercado.retencion != null && mercado.retencionPrev != null && mercado.retencion < mercado.retencionPrev - UMBRAL.retCaeMercado) {
    merc.push({ nivel: "mercado", tipo: "ret_cae", sujeto: "", prioridad: "media",
      impacto: Math.round((mercado.retencionPrev - mercado.retencion) * (baseTot || 0)),
      params: { ret: pct1(mercado.retencion), retPrev: pct1(mercado.retencionPrev) } });
  }
  mercado.ciudades.forEach(c => {
    if (c.evaNr != null && c.evaNr < UMBRAL.bajoMeta && (c.faltaNr ?? 0) > 0) merc.push({ nivel: "mercado", tipo: "ciudad_brecha", sujeto: c.city,
      impacto: c.faltaNr || 0, prioridad: c.evaNr < UMBRAL.metaCritica ? "alta" : "media",
      params: { pct: Math.round(c.evaNr * 10) / 10, falta: Math.round(c.faltaNr || 0) } });
  });
  if (partners.length && tasaRePais > 0) {
    const ent = sum(partners, p => p.nr), re = sum(partners, p => p.re);
    if (ent > 0 && re / ent >= 0.55) merc.push({ nivel: "mercado", tipo: "depende_react", sujeto: "", impacto: 0, prioridad: "media",
      params: { pct: Math.round(re / ent * 100) } });
  }
  merc.sort((a, b) => (a.prioridad === "alta" ? 0 : 1) - (b.prioridad === "alta" ? 0 : 1) || b.impacto - a.impacto);

  return { mercado: merc, kam: kamAcc, partner: partnerAcc };
}
