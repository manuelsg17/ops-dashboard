import { describe, it, expect } from "vitest";
import { tieneCuotaTk, coberturaCuotaTk, sumaCuotaTk } from "./cuotaTk";

describe("tieneCuotaTk", () => {
  it("NULL en los tres = sin cuota (no se estima nada)", () => {
    expect(tieneCuotaTk({ mtkAD: null, mtkNR: null, mtkSH: null })).toBe(false);
    expect(tieneCuotaTk({})).toBe(false);
    expect(tieneCuotaTk(null)).toBe(false);
  });
  it("cualquiera de AD / N+R / Horas alcanza", () => {
    expect(tieneCuotaTk({ mtkAD: 10 })).toBe(true);
    expect(tieneCuotaTk({ mtkNR: 3 })).toBe(true);
    expect(tieneCuotaTk({ mtkSH: 1200 })).toBe(true);
  });
  it("un 0 guardado ES una cuota declarada (NULL ≠ 0)", () => {
    expect(tieneCuotaTk({ mtkAD: 0 })).toBe(true);
  });
});

describe("coberturaCuotaTk", () => {
  it("un KAM declaró si CUALQUIERA de sus filas tiene cuota", () => {
    const c = coberturaCuotaTk([
      { kam: "Manuel", tieneCuota: false },
      { kam: "Manuel", tieneCuota: true },
      { kam: "Miguel", tieneCuota: false },
      { kam: "Matías", tieneCuota: false },
    ]);
    expect(c.declarados).toEqual(["Manuel"]);
    expect(c.sinDeclarar).toEqual(["Matías", "Miguel"]);
    expect(c.total).toBe(3);
    expect(c.completa).toBe(false);
  });
  it("todos declararon → completa (la vista no muestra aviso)", () => {
    const c = coberturaCuotaTk([{ kam: "Ana", tieneCuota: true }, { kam: "Beto", tieneCuota: true }]);
    expect(c.completa).toBe(true);
    expect(c.sinDeclarar).toEqual([]);
  });
  it("nadie declaró → todos sin declarar", () => {
    const c = coberturaCuotaTk([{ kam: "Ana", tieneCuota: false }, { kam: "Beto", tieneCuota: false }]);
    expect(c.declarados).toEqual([]);
    expect(c.sinDeclarar).toEqual(["Ana", "Beto"]);
    expect(c.completa).toBe(false);
  });
  it("el bucket No KAM y los KAM vacíos no cuentan como personas", () => {
    const c = coberturaCuotaTk([
      { kam: "No KAM", tieneCuota: false }, { kam: "", tieneCuota: false }, { kam: "Ana", tieneCuota: true },
    ], ["No KAM"]);
    expect(c.total).toBe(1);
    expect(c.completa).toBe(true);
  });
  it("sin filas: completa y total 0", () => {
    expect(coberturaCuotaTk([])).toEqual({ declarados: [], sinDeclarar: [], total: 0, completa: true });
  });
});

describe("sumaCuotaTk", () => {
  it("suma solo los valores guardados", () => {
    expect(sumaCuotaTk([10, null, 5, undefined])).toBe(15);
  });
  it("sin ningún valor → null (no un 0 que parezca cuota cero)", () => {
    expect(sumaCuotaTk([null, undefined])).toBeNull();
    expect(sumaCuotaTk([])).toBeNull();
  });
  it("un 0 guardado cuenta como valor", () => {
    expect(sumaCuotaTk([0, null])).toBe(0);
  });
});
