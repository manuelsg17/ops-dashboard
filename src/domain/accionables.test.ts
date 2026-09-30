import { describe, it, expect } from "vitest";
import { generarAccionables, type PartnerIn } from "./accionables";

const P = (o: Partial<PartnerIn>): PartnerIn => ({
  partner: "X", kam: "Ana", ad: 500, pad: 500, nr: 50, pnr: 50, re: 30, pre: 30, sh: 10000, psh: 10000,
  ns: 10, perdidos: 50, retencion: 0.9, eva: null, nrMeta: null, declive: false, ...o
});
const M = { retencion: 0.9, retencionPrev: 0.9, entran: 100, perdidos: 90, serieRe: [], ciudades: [] };

describe("accionables", () => {
  it("un partner sano no genera nada", () => {
    const r = generarAccionables({ partners: [P({})], mercado: M, semanasRestantes: 2 });
    expect(r.partner).toEqual([]);
    expect(r.kam).toEqual([]);
  });
  it("brecha de N+R: lo que falta en el mes, por semana, y la brecha al cierre para ordenar", () => {
    const r = generarAccionables({ partners: [P({ eva: { ad: 100, nr: 70, sh: 100 }, nrMeta: { meta: 400, actual: 160 } })],
      mercado: M, semanasRestantes: 3, semanasTranscurridas: 2 });
    const a = r.partner.find(x => x.tipo === "brecha_nr")!;
    expect(a).toMatchObject({ prioridad: "alta", impacto: 120 });       // 400 × (1 − 70%)
    expect(a.params).toMatchObject({ falta: 240, porSem: 80, ritmo: 80, cierre: 120 });
  });
  it("fuga y declive del mismo partner: solo sale la fuga", () => {
    const r = generarAccionables({ partners: [P({ retencion: 0.7, perdidos: 150, declive: true })], mercado: M, semanasRestantes: 2 });
    expect(r.partner.map(x => x.tipo)).toEqual(["fuga"]);
  });
  it("fuga: retención 3pp bajo el país y bajas por encima de lo esperado", () => {
    const r = generarAccionables({ partners: [P({ retencion: 0.8, perdidos: 100 })], mercado: M, semanasRestantes: 2 });
    const a = r.partner.find(x => x.tipo === "fuga")!;
    expect(a.params.extra).toBe(50);                // 100 perdidos − 500×10% esperados
    expect(a.prioridad).toBe("alta");
  });
  it("reactivación baja contra el país, con su potencial", () => {
    const ps = [P({ partner: "A", re: 5 }), P({ partner: "B", re: 55 })];   // país 60/1000 = 6%
    const a = generarAccionables({ partners: ps, mercado: M, semanasRestantes: 2 }).partner.find(x => x.tipo === "reactivar")!;
    expect(a.sujeto).toBe("A");
    expect(a.params.potencial).toBe(25);            // (6% − 1%) × 500
  });
  it("máximo 2 accionables por partner", () => {
    const r = generarAccionables({ partners: [P({ ns: 0, declive: true, retencion: 0.7, perdidos: 150, re: 0,
      eva: { ad: 90, nr: 60, sh: 90 }, nrMeta: { meta: 500, actual: 100 } }), P({ partner: "B", re: 60 })], mercado: M, semanasRestantes: 2 });
    expect(r.partner.filter(x => x.sujeto === "X").length).toBe(2);
  });
  it("KAM: la brecha concentrada en pocos partners", () => {
    const ps = [
      P({ partner: "A", eva: { ad: 100, nr: 60, sh: 100 }, nrMeta: { meta: 250, actual: 100 } }),   // brecha 100
      P({ partner: "B", eva: { ad: 100, nr: 80, sh: 100 }, nrMeta: { meta: 100, actual: 50 } }),    // 20
      P({ partner: "C", eva: { ad: 100, nr: 90, sh: 100 }, nrMeta: { meta: 50, actual: 30 } }),     // 5
      P({ partner: "D", eva: { ad: 100, nr: 90, sh: 100 }, nrMeta: { meta: 50, actual: 30 } })      // 5
    ];
    const k = generarAccionables({ partners: ps, mercado: M, semanasRestantes: 2 }).kam.find(x => x.tipo === "kam_concentracion")!;
    expect(k.params).toMatchObject({ falta: 130, share: 96, lista: "A, B, C" });
  });
  it("mercado: reactivados cayendo 3 períodos y base que se achica", () => {
    const r = generarAccionables({ partners: [P({})], semanasRestantes: 1,
      mercado: { ...M, serieRe: [1724, 1649, 1510], entran: 1100, perdidos: 1900 } });
    expect(r.mercado.map(x => x.tipo)).toEqual(expect.arrayContaining(["re_cae", "base_cae"]));
    expect(r.mercado.find(x => x.tipo === "base_cae")!.params.neto).toBe(800);
  });
});
