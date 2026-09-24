import { describe, it, expect } from "vitest";
import { modeloRend, modeloMetas, filtrosPorDefecto, captionAvance, repartir, unidadesCalc, filasMaestro } from "./model";

// El prototipo tiene que mostrar las MISMAS cifras que la app con el seed
// local (verificado contra la app corriendo el 24-sep-2026): si el fixture o el
// modelo se desvían, la maqueta dejaría de ser una vista fiel.
describe("modelo del prototipo ?ui=proto", () => {
  const F = filtrosPorDefecto();

  it("Rendimiento Combinado cuadra con la app", () => {
    const m = modeloRend("comb", F);
    expect(m.k.ad.v).toBe(28668);
    expect(m.k.nr.v).toBe(14993);
    expect(m.k.tr.v).toBe(7949601);
    expect(captionAvance("ad", m.av.ad)).toBe("Septiembre, nivel actual: 28,668 de 37,248 · 77.0% · proyección 107.8%");
    expect(captionAvance("nr", m.av.nr)).toBe("Septiembre: 6,371 de 8,758 · 72.7% · proyección 109.1%");
    expect(m.ciudades.map(c => c.ad)).toEqual([22392, 3325, 2951]);
  });

  it("Metas cuenta también a las cuentas sin meta (8)", () => {
    const mm = modeloMetas("comb", F, "2026-09");
    expect(mm.unidades.length).toBe(66);
    expect(mm.nSinMeta).toBe(8);
  });

  it("el reparto cuadra exacto y respeta lo fijado a mano", () => {
    const us = unidadesCalc("Ana");
    const bases = us.map(u => u.base.ad);
    const libre = repartir(10000, bases, bases.map(() => null));
    expect(libre.reduce((a, b) => a + b, 0)).toBe(10000);
    const fijos = bases.map((_, i) => (i === 0 ? 5000 : null));
    const conFijo = repartir(10000, bases, fijos);
    expect(conFijo[0]).toBe(5000);
    expect(conFijo.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it("Configuración: 60 CLIDs, 58 de alta, 5 pendientes", () => {
    const f = filasMaestro();
    expect(f.length).toBe(60);
    expect(f.filter(x => x.alta).length).toBe(58);
    expect(f.filter(x => !x.alta || x.sinKam).length).toBe(5);
  });
});
